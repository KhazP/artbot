import type {
  DiscoveryProviderDiagnostics,
  EvaluationMetrics,
  HostHealthRecord,
  RecommendedAction,
  SourceAttempt,
  SourcePlanItem
} from "@artbot/shared-types";

function isPricedAttempt(attempt: SourceAttempt): boolean {
  return (
    attempt.acceptance_reason === "valuation_ready"
    || attempt.acceptance_reason === "estimate_range_ready"
    || attempt.acceptance_reason === "asking_price_ready"
  );
}

function toThreshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRunnableSelection(item: SourcePlanItem): boolean {
  return item.selection_state === "selected";
}

export function buildEvaluationMetrics(input: {
  attempts: SourceAttempt[];
  sourcePlan: SourcePlanItem[];
  acceptedRecords: number;
  valuationEligibleRecords: number;
  pricedRecordCount?: number;
  corePriceEvidenceCount?: number;
  uniqueArtworkCount?: number;
  blockedAccessShare?: number;
  manualOverrideCount?: number;
  coverageTarget?: number;
}): EvaluationMetrics {
  const coverageTarget = input.coverageTarget ?? 0.85;
  const runnableAttempts = input.attempts.filter(
    (attempt) => attempt.source_access_status !== "blocked" && attempt.source_access_status !== "auth_required"
  );
  const pricedSources = new Set(input.attempts.filter((attempt) => isPricedAttempt(attempt)).map((attempt) => attempt.source_name));
  const attemptedSources = new Set(input.attempts.map((attempt) => attempt.source_name));
  const selectedSources = input.sourcePlan.filter((item) => item.selection_state === "selected");
  const runnableSources = input.sourcePlan.filter((item) => isRunnableSelection(item) && item.candidate_count > 0);
  const manualOverrideCount = input.manualOverrideCount ?? 0;

  const acceptedRecordPrecision =
    runnableAttempts.length === 0 ? 0 : Number((input.acceptedRecords / runnableAttempts.length).toFixed(4));
  const pricedSourceRecall =
    runnableSources.length === 0 ? 0 : Number((pricedSources.size / runnableSources.length).toFixed(4));
  const sourceCompletenessRatio =
    selectedSources.length === 0
      ? 0
      : Number((Math.min(1, attemptedSources.size / selectedSources.length)).toFixed(4));
  const valuationReadinessRatio =
    input.acceptedRecords === 0 ? 0 : Number((input.valuationEligibleRecords / input.acceptedRecords).toFixed(4));
  const manualOverrideRate =
    input.acceptedRecords === 0 ? 0 : Number((manualOverrideCount / input.acceptedRecords).toFixed(4));
  const pricedRecordCount = input.pricedRecordCount ?? input.valuationEligibleRecords;
  const corePriceEvidenceCount = input.corePriceEvidenceCount
    ?? input.attempts.filter((attempt) => isPricedAttempt(attempt) && (attempt.accepted_for_evidence ?? attempt.accepted)).length;
  const selectedFamilies = new Set(
    input.sourcePlan.filter((item) => item.selection_state === "selected").map((item) => item.source_family)
  );
  const pricedFamilies = new Set(
    input.attempts.filter((attempt) => isPricedAttempt(attempt)).map((attempt) => attempt.source_family ?? attempt.source_name)
  );
  let coveredFamilyCount = 0;
  for (const family of selectedFamilies) {
    if (pricedFamilies.has(family)) {
      coveredFamilyCount += 1;
    }
  }
  const familyCoverageRatio = selectedFamilies.size === 0
    ? 0
    : Number((coveredFamilyCount / selectedFamilies.size).toFixed(4));
  const uniqueArtworkCount = input.uniqueArtworkCount ?? input.acceptedRecords;
  const blockedAccessShare = input.blockedAccessShare
    ?? Number(
      (
        input.attempts.filter(
          (attempt) => attempt.source_access_status === "blocked" || attempt.source_access_status === "auth_required"
        ).length / Math.max(1, input.attempts.length)
      ).toFixed(4)
    );

  const minPricedRecordCount = toThreshold(process.env.COVERAGE_MIN_PRICED_RECORD_COUNT, 120);
  const minCorePriceEvidenceCount = toThreshold(process.env.COVERAGE_MIN_CORE_PRICE_EVIDENCE_COUNT, 80);
  const minFamilyCoverageRatio = toThreshold(process.env.COVERAGE_MIN_FAMILY_COVERAGE_RATIO, 0.7);
  const minUniqueArtworkCount = toThreshold(process.env.COVERAGE_MIN_UNIQUE_ARTWORK_COUNT, 150);
  const maxBlockedAccessShare = toThreshold(process.env.COVERAGE_MAX_BLOCKED_ACCESS_SHARE, 0.25);
  const coverageTargetMet =
    valuationReadinessRatio >= coverageTarget &&
    pricedRecordCount >= minPricedRecordCount &&
    corePriceEvidenceCount >= minCorePriceEvidenceCount &&
    familyCoverageRatio >= minFamilyCoverageRatio &&
    uniqueArtworkCount >= minUniqueArtworkCount &&
    blockedAccessShare < maxBlockedAccessShare;

  return {
    accepted_record_precision: acceptedRecordPrecision,
    priced_source_recall: pricedSourceRecall,
    source_completeness_ratio: sourceCompletenessRatio,
    valuation_readiness_ratio: valuationReadinessRatio,
    priced_record_count: pricedRecordCount,
    core_price_evidence_count: corePriceEvidenceCount,
    family_coverage_ratio: familyCoverageRatio,
    unique_artwork_count: uniqueArtworkCount,
    blocked_access_share: blockedAccessShare,
    manual_override_rate: manualOverrideRate,
    coverage_target: coverageTarget,
    coverage_target_met: coverageTargetMet
  };
}

export function buildRecommendedActions(input: {
  sourcePlan: SourcePlanItem[];
  attempts: SourceAttempt[];
  acceptedRecords: number;
  discoveredCandidates: number;
  discoveryDiagnostics?: DiscoveryProviderDiagnostics[];
  hostHealth: HostHealthRecord[];
  evaluationMetrics?: EvaluationMetrics | null;
}): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const blockedAuth = input.sourcePlan.find((item) => item.source_access_status === "auth_required");
  if (blockedAuth) {
    actions.push({
      title: `Authenticate ${blockedAuth.source_name}`,
      reason: `${blockedAuth.source_name} requires an authorized profile before it can contribute evidence.`,
      severity: "warning"
    });
  }

  const blockedLicensed = input.sourcePlan.find(
    (item) =>
      item.source_access_status === "blocked"
      && item.access_mode !== "licensed"
      && item.skip_reason?.toLowerCase().includes("licensed")
  );
  if (blockedLicensed) {
    actions.push({
      title: `Enable licensed access for ${blockedLicensed.source_name}`,
      reason: blockedLicensed.skip_reason ?? "Licensed integration is required for this source.",
      severity: "critical"
    });
  }

  const blockedAttempts = input.attempts.filter(
    (attempt) => attempt.failure_class === "waf_challenge" || attempt.failure_class === "host_circuit"
  );
  if (blockedAttempts.length > 0) {
    actions.push({
      title: "Review degraded hosts",
      reason: `${blockedAttempts.length} attempts hit WAF or host-circuit conditions; inspect host health before rerunning.`,
      severity: "warning"
    });
  }

  if (input.acceptedRecords === 0) {
    actions.push({
      title: "Replay captured evidence before touching live sources",
      reason: "This run produced no accepted evidence; use replay mode against stored snapshots to debug safely.",
      severity: "critical"
    });
  }

  const discoveryDiagnostics = input.discoveryDiagnostics ?? [];
  const discoveryConfigured = discoveryDiagnostics.some((item) => item.enabled);
  const discoveryYieldedCandidates = discoveryDiagnostics.some((item) => item.candidates_kept > 0);
  const discoveryFailover = discoveryDiagnostics.some((item) => item.failover_invoked);
  if (input.discoveredCandidates === 0 && !discoveryConfigured) {
    actions.push({
      title: "Enable multi-provider discovery",
      reason: "No discovery provider was enabled for this run; configure a primary provider and a failover provider.",
      severity: "info"
    });
  } else if (discoveryConfigured && !discoveryYieldedCandidates) {
    actions.push({
      title: "Tune discovery provider yield",
      reason: discoveryFailover
        ? "Discovery providers ran but produced no usable candidates after failover; inspect diagnostics, caps, and host filters."
        : "Discovery providers ran but produced no usable candidates; add a failover provider or relax discovery caps.",
      severity: "info"
    });
  }

  if (
    input.evaluationMetrics
    && !input.evaluationMetrics.coverage_target_met
  ) {
    actions.push({
      title: "Improve priced evidence coverage",
      reason:
        `Composite gate unmet: readiness ${(input.evaluationMetrics.valuation_readiness_ratio * 100).toFixed(0)}%, priced ${input.evaluationMetrics.priced_record_count}, family coverage ${(input.evaluationMetrics.family_coverage_ratio * 100).toFixed(0)}%, blocked ${(input.evaluationMetrics.blocked_access_share * 100).toFixed(0)}%.`,
      severity: "critical"
    });
  }

  if (
    input.evaluationMetrics
    && input.evaluationMetrics.valuation_readiness_ratio >= input.evaluationMetrics.coverage_target
    && input.evaluationMetrics.priced_source_recall < input.evaluationMetrics.coverage_target
  ) {
    actions.push({
      title: "Broaden priced source diversity",
      reason: `Priced evidence coverage is healthy, but priced source recall is only ${(input.evaluationMetrics.priced_source_recall * 100).toFixed(0)}%. Add one more priced source family to reduce single-source concentration.`,
      severity: "info"
    });
  }

  const degradedHost = input.hostHealth.find((entry) => entry.reliability_score < 0.5 && entry.total_attempts >= 2);
  if (degradedHost) {
    actions.push({
      title: `Canary ${degradedHost.host}`,
      reason: `${degradedHost.host} is trending unreliable across runs and should be covered by a canary.`,
      severity: "warning"
    });
  }

  const deprioritized = input.sourcePlan.filter((item) => item.selection_state === "deprioritized").length;
  if (deprioritized > 0) {
    actions.push({
      title: "Review deprioritized sources",
      reason: `${deprioritized} sources were deprioritized behind higher-value families; expand analysis mode or rerun with a narrower source scope if coverage is thin.`,
      severity: "info"
    });
  }

  return actions.slice(0, 5);
}
