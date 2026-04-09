import fs from "node:fs";
import path from "node:path";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "@artbot/browser-core";
import { logger } from "@artbot/observability";
import { applyConfidenceModel, dedupeRecords, FxRateProvider, normalizeRecordCurrencies } from "@artbot/normalization";
import { renderMarkdownReport, writeJsonFile } from "@artbot/report-generation";
import { planSources, SourceRegistry } from "@artbot/source-registry";
import type { SourceCandidate } from "@artbot/source-adapters";
import { ArtbotStorage } from "@artbot/storage";
import {
  acceptanceReasonList,
  type AcceptanceReason,
  type PriceRecord,
  type RunEntity,
  type RunSummary,
  type SourceAccessStatus,
  type SourceAttempt
} from "@artbot/shared-types";
import { buildValuation, rankComparablesWithScores } from "@artbot/valuation";

export interface OrchestratorOptions {
  minValuationComps?: number;
  modelCheapDefault?: string;
  modelCheapFallback?: string;
}

export class ResearchOrchestrator {
  private readonly registry: SourceRegistry;
  private readonly authManager: AuthManager;
  private readonly browserClient: BrowserClient;
  private readonly fxRates: FxRateProvider;
  private readonly minValuationComps: number;
  private readonly modelCheapDefault: string;
  private readonly modelCheapFallback: string;
  private readonly maxDiscoveredCandidatesPerSource: number;

  constructor(private readonly storage: ArtbotStorage, options: OrchestratorOptions = {}) {
    this.registry = new SourceRegistry();
    this.authManager = new AuthManager();
    this.browserClient = new BrowserClient(this.authManager);
    this.fxRates = new FxRateProvider();
    this.minValuationComps = options.minValuationComps ?? 5;
    this.modelCheapDefault = options.modelCheapDefault ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
    this.modelCheapFallback = options.modelCheapFallback ?? process.env.MODEL_CHEAP_FALLBACK ?? "gemini-2.5-flash-lite";
    const maxDiscovered = Number(process.env.DISCOVERY_MAX_CANDIDATES_PER_SOURCE ?? 24);
    this.maxDiscoveredCandidatesPerSource = Number.isFinite(maxDiscovered) ? Math.max(1, maxDiscovered) : 24;
  }

  public async processRun(run: RunEntity): Promise<void> {
    const traceId = `run_${run.id.slice(0, 8)}`;
    const runRoot = this.storage.getRunRoot(run.id);
    const evidenceDir = path.join(runRoot, "evidence");

    logger.info("Starting research run", {
      traceId,
      runId: run.id,
      stage: "pipeline_start",
      artist: run.query.artist,
      scope: run.query.scope
    });

    const plannedSources = await planSources(run.query, this.registry.list(), this.authManager);

    const attempts: SourceAttempt[] = [];
    const candidateRecords: PriceRecord[] = [];
    const gaps: string[] = [];
    const sourceCandidateBreakdown: Record<string, number> = {};
    let discoveredCandidates = 0;
    let acceptedFromDiscovery = 0;

    for (const planned of plannedSources) {
      const sourceName = planned.adapter.sourceName;
      const queue: SourceCandidate[] = [...planned.candidates];
      const seen = new Set(queue.map((candidate) => candidate.url));
      sourceCandidateBreakdown[sourceName] = queue.length;
      discoveredCandidates += queue.filter((candidate) => candidate.provenance !== "seed").length;

      while (queue.length > 0) {
        const candidate = queue.shift() as SourceCandidate;

        try {
          const result = await planned.adapter.extract(candidate, {
            runId: run.id,
            traceId,
            query: run.query,
            accessContext: planned.accessContext,
            evidenceDir
          });

          if (result.discoveredCandidates && result.discoveredCandidates.length > 0) {
            for (const discoveredCandidate of result.discoveredCandidates) {
              if (seen.has(discoveredCandidate.url)) {
                continue;
              }
              if (sourceCandidateBreakdown[sourceName] >= this.maxDiscoveredCandidatesPerSource) {
                break;
              }

              seen.add(discoveredCandidate.url);
              queue.push(discoveredCandidate);
              sourceCandidateBreakdown[sourceName] += 1;
              discoveredCandidates += 1;
            }
          }

          const captureAcceptedValuation = process.env.CAPTURE_BROWSER_FOR_ACCEPTED_VALUATION === "true";
          const acceptedForValuation = Boolean(result.attempt.accepted_for_valuation ?? result.record?.accepted_for_valuation);
          if (result.needsBrowserVerification || (captureAcceptedValuation && acceptedForValuation)) {
            const browserCapture = await this.browserClient.withRetries(
              () =>
                this.browserClient.capture({
                  traceId,
                  sourceName: planned.adapter.id,
                  url: candidate.url,
                  runId: run.id,
                  evidenceDir,
                  accessContext: planned.accessContext,
                  captureHeavyEvidence: this.shouldCaptureHeavyEvidence(result)
                }),
              3,
              1_000,
              traceId
            );

            result.attempt.screenshot_path = browserCapture.screenshotPath;
            result.attempt.pre_auth_screenshot_path = browserCapture.preAuthScreenshotPath;
            result.attempt.post_auth_screenshot_path = browserCapture.postAuthScreenshotPath;
            result.attempt.raw_snapshot_path = browserCapture.rawSnapshotPath;
            result.attempt.trace_path = browserCapture.tracePath;
            result.attempt.har_path = browserCapture.harPath;
            result.attempt.canonical_url = browserCapture.finalUrl;
            result.attempt.model_used = browserCapture.modelUsed;

            if (browserCapture.requiresAuthDetected && planned.accessContext.mode === "anonymous") {
              result.attempt.source_access_status = "auth_required";
              result.attempt.accepted = false;
              result.attempt.accepted_for_evidence = false;
              result.attempt.accepted_for_valuation = false;
              result.attempt.valuation_lane = "none";
              result.attempt.acceptance_reason = "blocked_access";
              result.attempt.rejection_reason = "Login gate detected without authorized session.";
              result.attempt.valuation_eligibility_reason = "Authentication required.";
              result.attempt.blocker_reason = "Authentication required.";
              if (result.record) {
                result.record.source_access_status = "auth_required";
                result.record.accepted_for_evidence = false;
                result.record.accepted_for_valuation = false;
                result.record.valuation_lane = "none";
                result.record.acceptance_reason = "blocked_access";
                result.record.rejection_reason = "Login gate detected without authorized session.";
                result.record.valuation_eligibility_reason = "Authentication required.";
                result.record.valuation_confidence = 0;
                result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.35);
              }
            }

            if (browserCapture.blockedDetected) {
              result.attempt.source_access_status = "blocked";
              result.attempt.accepted = false;
              result.attempt.accepted_for_evidence = false;
              result.attempt.accepted_for_valuation = false;
              result.attempt.valuation_lane = "none";
              result.attempt.acceptance_reason = "blocked_access";
              result.attempt.rejection_reason = "Access blocked or anti-bot page detected.";
              result.attempt.valuation_eligibility_reason = "Technical blocking detected.";
              result.attempt.blocker_reason = "Technical blocking detected.";
              if (result.record) {
                result.record.source_access_status = "blocked";
                result.record.accepted_for_evidence = false;
                result.record.accepted_for_valuation = false;
                result.record.valuation_lane = "none";
                result.record.acceptance_reason = "blocked_access";
                result.record.rejection_reason = "Access blocked or anti-bot page detected.";
                result.record.valuation_eligibility_reason = "Technical blocking detected.";
                result.record.valuation_confidence = 0;
                result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.2);
              }
            }

            if (result.record) {
              result.record.screenshot_path = browserCapture.screenshotPath;
              result.record.raw_snapshot_path = browserCapture.rawSnapshotPath;
            }
          }

          attempts.push(result.attempt);
          this.storage.saveAttempt(run.id, result.attempt);

          const acceptedForEvidence = Boolean(result.attempt.accepted_for_evidence ?? result.attempt.accepted);
          if (result.record && acceptedForEvidence) {
            const normalized = this.normalizeRecord(result.record);
            candidateRecords.push(normalized);
            if (candidate.provenance !== "seed") {
              acceptedFromDiscovery += 1;
            }
          }
        } catch (error) {
          const failureReason = error instanceof Error ? error.message : String(error);
          gaps.push(`${planned.adapter.sourceName}: ${failureReason}`);

          const failedAttempt: SourceAttempt = {
            run_id: run.id,
            source_name: planned.adapter.sourceName,
            source_url: candidate.url,
            canonical_url: candidate.url,
            access_mode: planned.accessContext.mode,
            source_access_status: "blocked",
            access_reason: planned.accessContext.accessReason ?? "Unexpected adapter failure.",
            blocker_reason: failureReason,
            extracted_fields: {},
            discovery_provenance: candidate.provenance,
            discovery_score: candidate.score,
            discovered_from_url: candidate.discoveredFromUrl ?? null,
            screenshot_path: null,
            pre_auth_screenshot_path: null,
            post_auth_screenshot_path: null,
            raw_snapshot_path: null,
            trace_path: null,
            har_path: null,
            fetched_at: new Date().toISOString(),
            parser_used: "adapter-error",
            model_used: null,
            extraction_confidence: 0,
            entity_match_confidence: 0,
            source_reliability_confidence: 0,
            confidence_score: 0,
            accepted: false,
            accepted_for_evidence: false,
            accepted_for_valuation: false,
            valuation_lane: "none",
            acceptance_reason: "blocked_access",
            rejection_reason: "Adapter execution failed.",
            valuation_eligibility_reason: "Adapter execution failed."
          };

          attempts.push(failedAttempt);
          this.storage.saveAttempt(run.id, failedAttempt);
        }
      }
    }

    const { uniqueRecords, duplicates } = dedupeRecords(candidateRecords);
    if (duplicates.length > 0) {
      gaps.push(`${duplicates.length} candidate records were excluded as duplicates.`);
    }

    const scoredComparables = rankComparablesWithScores(uniqueRecords);
    const rankedRecords = scoredComparables.map((entry) => entry.record);
    for (const record of rankedRecords) {
      this.storage.saveRecord(run.id, record);
    }

    const valuation = buildValuation(rankedRecords, this.minValuationComps, scoredComparables);
    const valuationEligibleRecords = rankedRecords.filter((record) => record.accepted_for_valuation).length;
    const summary = this.buildSummary(
      run.id,
      rankedRecords.length,
      valuationEligibleRecords,
      attempts,
      valuation.generated,
      valuation.reason,
      discoveredCandidates,
      acceptedFromDiscovery,
      sourceCandidateBreakdown
    );

    const resultsPath = path.join(runRoot, "results.json");
    const reportPath = path.join(runRoot, "report.md");
    const completedRun = {
      ...run,
      status: "completed" as const,
      error: null,
      reportPath,
      resultsPath,
      updatedAt: new Date().toISOString()
    };

    const payload = {
      run: completedRun,
      model_policy: {
        preferred: this.modelCheapDefault,
        fallback: this.modelCheapFallback,
        hard_case_escalation_enabled: false
      },
      summary,
      valuation,
      records: rankedRecords,
      duplicates,
      attempts,
      gaps
    };

    writeJsonFile(resultsPath, payload);
    fs.writeFileSync(reportPath, renderMarkdownReport(rankedRecords, summary, valuation, gaps), "utf-8");

    this.storage.completeRun(run.id, reportPath, resultsPath);

    logger.info("Research run completed", {
      traceId,
      runId: run.id,
      stage: "pipeline_done",
      acceptedRecords: rankedRecords.length,
      rejectedCandidates: summary.rejected_candidates,
      valuationGenerated: valuation.generated
    });
  }

  private normalizeRecord(record: PriceRecord): PriceRecord {
    const currencyNormalized = normalizeRecordCurrencies(record, this.fxRates);
    return applyConfidenceModel(currencyNormalized, record.overall_confidence);
  }

  private shouldCaptureHeavyEvidence(result: { attempt: SourceAttempt; record: PriceRecord | null }): boolean {
    const mode = (process.env.EVIDENCE_TRACE_MODE ?? "selective").toLowerCase();
    if (mode === "always") {
      return true;
    }
    if (mode === "off" || mode === "none") {
      return false;
    }

    if (!(result.attempt.accepted_for_evidence ?? result.attempt.accepted)) {
      return true;
    }
    if (!result.record) {
      return true;
    }
    return result.record.overall_confidence < 0.6;
  }

  private buildSummary(
    runId: string,
    acceptedEvidenceRecords: number,
    valuationEligibleRecords: number,
    attempts: SourceAttempt[],
    valuationGenerated: boolean,
    valuationReason: string,
    discoveredCandidates: number,
    acceptedFromDiscovery: number,
    sourceCandidateBreakdown: Record<string, number>
  ): RunSummary {
    const sourceStatusBreakdown: Record<SourceAccessStatus, number> = {
      public_access: 0,
      auth_required: 0,
      licensed_access: 0,
      blocked: 0,
      price_hidden: 0
    };

    const authModeBreakdown: Record<"anonymous" | "authorized" | "licensed", number> = {
      anonymous: 0,
      authorized: 0,
      licensed: 0
    };
    const acceptanceReasonBreakdown: Record<AcceptanceReason, number> = {
      valuation_ready: 0,
      estimate_range_ready: 0,
      asking_price_ready: 0,
      inquiry_only_evidence: 0,
      price_hidden_evidence: 0,
      missing_numeric_price: 0,
      missing_currency: 0,
      missing_estimate_range: 0,
      unknown_price_type: 0,
      blocked_access: 0
    };

    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
      if (attempt.acceptance_reason && acceptanceReasonList.includes(attempt.acceptance_reason)) {
        acceptanceReasonBreakdown[attempt.acceptance_reason] += 1;
      }
    }

    return {
      run_id: runId,
      total_records: attempts.length,
      total_attempts: attempts.length,
      evidence_records: acceptedEvidenceRecords,
      valuation_eligible_records: valuationEligibleRecords,
      accepted_records: acceptedEvidenceRecords,
      rejected_candidates: attempts.filter((attempt) => !(attempt.accepted_for_evidence ?? attempt.accepted)).length,
      discovered_candidates: discoveredCandidates,
      accepted_from_discovery: acceptedFromDiscovery,
      source_candidate_breakdown: sourceCandidateBreakdown,
      source_status_breakdown: sourceStatusBreakdown,
      auth_mode_breakdown: authModeBreakdown,
      acceptance_reason_breakdown: acceptanceReasonBreakdown,
      valuation_generated: valuationGenerated,
      valuation_reason: valuationReason
    };
  }
}
