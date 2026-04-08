import fs from "node:fs";
import path from "node:path";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "@artbot/browser-core";
import { logger } from "@artbot/observability";
import { dedupeRecords, FxRateProvider, normalizeRecordCurrencies, scoreRecord } from "@artbot/normalization";
import { renderMarkdownReport, writeJsonFile } from "@artbot/report-generation";
import { planSources, SourceRegistry } from "@artbot/source-registry";
import { ArtbotStorage } from "@artbot/storage";
import type { PriceRecord, RunEntity, RunSummary, SourceAccessStatus, SourceAttempt } from "@artbot/shared-types";
import { buildValuation, rankComparables } from "@artbot/valuation";

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

  constructor(private readonly storage: ArtbotStorage, options: OrchestratorOptions = {}) {
    this.registry = new SourceRegistry();
    this.authManager = new AuthManager();
    this.browserClient = new BrowserClient(this.authManager);
    this.fxRates = new FxRateProvider();
    this.minValuationComps = options.minValuationComps ?? 5;
    this.modelCheapDefault = options.modelCheapDefault ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
    this.modelCheapFallback = options.modelCheapFallback ?? process.env.MODEL_CHEAP_FALLBACK ?? "gemini-2.5-flash-lite";
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

    for (const planned of plannedSources) {
      for (const candidate of planned.candidates) {
        try {
          const result = await planned.adapter.extract(candidate, {
            runId: run.id,
            traceId,
            query: run.query,
            accessContext: planned.accessContext,
            evidenceDir
          });

          if (result.needsBrowserVerification) {
            const browserCapture = await this.browserClient.withRetries(
              () =>
                this.browserClient.capture({
                  traceId,
                  sourceName: planned.adapter.id,
                  url: candidate.url,
                  runId: run.id,
                  evidenceDir,
                  accessContext: planned.accessContext
                }),
              3,
              1_000,
              traceId
            );

            result.attempt.screenshot_path = browserCapture.screenshotPath;
            result.attempt.pre_auth_screenshot_path = browserCapture.preAuthScreenshotPath;
            result.attempt.post_auth_screenshot_path = browserCapture.postAuthScreenshotPath;
            result.attempt.raw_snapshot_path = browserCapture.rawSnapshotPath;
            result.attempt.canonical_url = browserCapture.finalUrl;
            result.attempt.model_used = browserCapture.modelUsed;

            if (browserCapture.requiresAuthDetected && planned.accessContext.mode === "anonymous") {
              result.attempt.source_access_status = "auth_required";
              result.attempt.accepted = false;
              result.attempt.acceptance_reason = "Login gate detected without authorized session.";
              result.attempt.blocker_reason = "Authentication required.";
              if (result.record) {
                result.record.source_access_status = "auth_required";
                result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.35);
              }
            }

            if (browserCapture.blockedDetected) {
              result.attempt.source_access_status = "blocked";
              result.attempt.accepted = false;
              result.attempt.acceptance_reason = "Access blocked or anti-bot page detected.";
              result.attempt.blocker_reason = "Technical blocking detected.";
              if (result.record) {
                result.record.source_access_status = "blocked";
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

          if (result.record && result.attempt.accepted) {
            const normalized = this.normalizeRecord(result.record);
            candidateRecords.push(normalized);
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
            screenshot_path: null,
            pre_auth_screenshot_path: null,
            post_auth_screenshot_path: null,
            raw_snapshot_path: null,
            fetched_at: new Date().toISOString(),
            parser_used: "adapter-error",
            model_used: null,
            confidence_score: 0,
            accepted: false,
            acceptance_reason: "Adapter execution failed."
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

    const rankedRecords = rankComparables(uniqueRecords);
    for (const record of rankedRecords) {
      this.storage.saveRecord(run.id, record);
    }

    const valuation = buildValuation(rankedRecords, this.minValuationComps);
    const summary = this.buildSummary(run.id, rankedRecords.length, attempts, valuation.generated);

    const resultsPath = path.join(runRoot, "results.json");
    const reportPath = path.join(runRoot, "report.md");

    const payload = {
      run,
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
    return {
      ...currencyNormalized,
      overall_confidence: scoreRecord(currencyNormalized)
    };
  }

  private buildSummary(
    runId: string,
    acceptedRecords: number,
    attempts: SourceAttempt[],
    valuationGenerated: boolean
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

    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
    }

    return {
      run_id: runId,
      total_records: attempts.length,
      accepted_records: acceptedRecords,
      rejected_candidates: attempts.filter((attempt) => !attempt.accepted).length,
      source_status_breakdown: sourceStatusBreakdown,
      auth_mode_breakdown: authModeBreakdown,
      valuation_generated: valuationGenerated,
      valuation_reason: valuationGenerated ? "Comparable threshold met." : "Comparable threshold not met."
    };
  }
}
