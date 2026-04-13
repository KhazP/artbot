import type {
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

function isRunnableSelection(item: SourcePlanItem): boolean {
  return item.selection_state === "selected";
}

export function buildEvaluationMetrics(input: {
  attempts: SourceAttempt[];
  sourcePlan: SourcePlanItem[];
  acceptedRecords: number;
  valuationEligibleRecords: number;
  manualOverrideCount?: number;
  coverageTarget?: number;
}): EvaluationMetrics {
  const coverageTarget = input.coverageTarget ?? 0.75;
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
  const coverageTargetMet = valuationReadinessRatio >= coverageTarget;

  return {
    accepted_record_precision: acceptedRecordPrecision,
    priced_source_recall: pricedSourceRecall,
    source_completeness_ratio: sourceCompletenessRatio,
    valuation_readiness_ratio: valuationReadinessRatio,
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

  if (input.discoveredCandidates === 0) {
    actions.push({
      title: "Enable multi-provider discovery",
      reason: "No discovery expansion was recorded for this run; add or enable a secondary discovery provider.",
      severity: "info"
    });
  }

  if (
    input.evaluationMetrics
    && input.evaluationMetrics.valuation_readiness_ratio < input.evaluationMetrics.coverage_target
  ) {
    actions.push({
      title: "Improve priced evidence coverage",
      reason: `Priced evidence coverage is ${(input.evaluationMetrics.valuation_readiness_ratio * 100).toFixed(0)}%, below the ${(input.evaluationMetrics.coverage_target * 100).toFixed(0)}% target.`,
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
