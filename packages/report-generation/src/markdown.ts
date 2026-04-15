import type { PriceRecord, RecommendedAction, RunSummary, SourcePlanItem } from "@artbot/shared-types";
import type { ValuationOutcome } from "@artbot/valuation";

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function mdCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim() || "-";
}

function recordLine(record: PriceRecord): string {
  return [
    mdCell(record.artist_name),
    mdCell(record.work_title),
    mdCell(record.source_name),
    mdCell(record.country),
    mdCell(record.price_type),
    mdCell(record.valuation_lane),
    record.accepted_for_valuation ? "yes" : "no",
    mdCell(record.acceptance_reason),
    mdCell(record.source_access_status),
    mdCell(record.source_legal_posture),
    mdCell(record.access_provenance_label),
    mdCell(record.acceptance_explanation),
    mdCell(record.next_step_hint),
    mdCell(`${fmt(record.price_amount)} ${record.currency ?? ""}`.trim()),
    mdCell(`${fmt(record.normalized_price_try)} TRY`),
    mdCell(record.source_url)
  ].join(" | ");
}

function sourceMetricLine(metric: NonNullable<RunSummary["persisted_source_metrics"]>[number]): string {
  return `- ${metric.source_name} (${metric.source_family}) · legal=${metric.legal_posture} · reliability=${Math.round(metric.reliability_score * 100)}% · attempts=${metric.total_attempts} · reachable=${metric.reachable_count} · parsed=${metric.parse_success_count} · priced=${metric.price_signal_count} · evidence=${metric.accepted_for_evidence_count} · valuation=${metric.valuation_ready_count} · blocked=${metric.blocked_count} · auth=${metric.auth_required_count} · last=${metric.last_status}`;
}

function canaryLine(canary: NonNullable<RunSummary["recent_canaries"]>[number]): string {
  return `- [${canary.status.toUpperCase()}] ${canary.family} / ${canary.source_name} / ${canary.fixture} · ${canary.observed_price_type}${canary.expected_price_type ? ` (expected ${canary.expected_price_type})` : ""} · ${canary.legal_posture} · ${canary.details}`;
}

function sourcePlanLine(item: SourcePlanItem): string {
  return `- #${item.priority_rank} ${item.source_name} (${item.source_family}) · ${item.selection_state} · ${item.source_access_status} · legal=${item.legal_posture ?? "unknown"} · candidates=${item.candidate_count}/${item.candidate_cap}${item.selection_reason ? ` · ${item.selection_reason}` : item.skip_reason ? ` · ${item.skip_reason}` : ""}`;
}

export function renderMarkdownReport(
  records: PriceRecord[],
  summary: RunSummary,
  valuation: ValuationOutcome,
  gaps: string[],
  recommendedActions: RecommendedAction[] = [],
  sourcePlan: SourcePlanItem[] = []
): string {
  const turkey = records.filter((record) => record.country === "Turkey");
  const international = records.filter((record) => record.country !== "Turkey");

  return [
    "# ArtBot Price Research Report",
    "",
    "## Run Summary",
    `- Run ID: ${summary.run_id}`,
    `- Total accepted records: ${summary.accepted_records}`,
    `- Valuation-eligible records: ${summary.valuation_eligible_records ?? 0}`,
    `- Total rejected candidates: ${summary.rejected_candidates}`,
    `- Discovered candidates: ${summary.discovered_candidates}`,
    `- Accepted from discovery: ${summary.accepted_from_discovery}`,
    ...(summary.cluster_count != null ? [`- Cluster count: ${summary.cluster_count}`] : []),
    ...(summary.review_item_count != null ? [`- Review queue count: ${summary.review_item_count}`] : []),
    `- Source status breakdown: ${JSON.stringify(summary.source_status_breakdown)}`,
    `- Auth mode breakdown: ${JSON.stringify(summary.auth_mode_breakdown)}`,
    `- Failure class breakdown: ${JSON.stringify(summary.failure_class_breakdown ?? {})}`,
    `- Crawl lane breakdown: ${JSON.stringify(summary.crawl_lane_breakdown ?? {})}`,
    `- Price visibility breakdown: ${JSON.stringify(summary.price_visibility_breakdown ?? {})}`,
    `- Source candidate breakdown: ${JSON.stringify(summary.source_candidate_breakdown)}`,
    ...(summary.evaluation_metrics
      ? [
          `- Accepted precision: ${Math.round(summary.evaluation_metrics.accepted_record_precision * 100)}%`,
          `- Priced evidence coverage: ${Math.round(summary.evaluation_metrics.valuation_readiness_ratio * 100)}%`,
          `- Priced record count: ${summary.evaluation_metrics.priced_record_count}`,
          `- Core price evidence count: ${summary.evaluation_metrics.core_price_evidence_count}`,
          `- Family coverage ratio: ${Math.round(summary.evaluation_metrics.family_coverage_ratio * 100)}%`,
          `- Unique artwork count: ${summary.evaluation_metrics.unique_artwork_count}`,
          `- Blocked access share: ${Math.round(summary.evaluation_metrics.blocked_access_share * 100)}%`,
          `- Priced source recall: ${Math.round(summary.evaluation_metrics.priced_source_recall * 100)}%`,
          `- Source completeness: ${Math.round(summary.evaluation_metrics.source_completeness_ratio * 100)}%`,
          `- Manual override rate: ${Math.round(summary.evaluation_metrics.manual_override_rate * 100)}%`,
          `- Coverage target met: ${summary.evaluation_metrics.coverage_target_met ? "yes" : "no"}`
        ]
      : []),
    ...(summary.discovery_provider_diagnostics && summary.discovery_provider_diagnostics.length > 0
      ? [
          `- Discovery providers: ${summary.discovery_provider_diagnostics
            .map(
              (item) =>
                `${item.provider}=${item.enabled ? "enabled" : "disabled"} requests=${item.requests_used} results=${item.results_returned} kept=${item.candidates_kept} failover=${item.failover_invoked ? "yes" : "no"} caps=${item.trimmed_by_caps ? "trimmed" : "ok"}${item.reason ? ` (${item.reason})` : ""}`
            )
            .join("; ")}`
        ]
      : []),
    ...(summary.scrape_recovery_diagnostics
      ? [
          `- Recovery lanes: attempted=${summary.scrape_recovery_diagnostics.attempted}, succeeded=${summary.scrape_recovery_diagnostics.succeeded}, triggers=${JSON.stringify(summary.scrape_recovery_diagnostics.by_trigger)}`
        ]
      : []),
    ...(summary.browser_overwrite_prevented_count != null
      ? [`- Browser overwrite prevented: ${summary.browser_overwrite_prevented_count}`]
      : []),
    ...(summary.unverified_search_seed_count != null
      ? [`- Unverified search seeds: ${summary.unverified_search_seed_count}`]
      : []),
    ...(summary.family_share_breakdown
      ? [`- Family share breakdown: ${JSON.stringify(summary.family_share_breakdown)}`]
      : []),
    ...(summary.unique_artwork_count != null
      ? [`- Unique artworks: ${summary.unique_artwork_count}`]
      : []),
    ...(summary.duplicate_listing_count != null
      ? [`- Duplicate listings: ${summary.duplicate_listing_count}`]
      : []),
    ...(summary.source_family_coverage
      ? [
          `- Source family coverage: ${Object.entries(summary.source_family_coverage)
            .map(
              ([family, value]) =>
                `${family} planned=${value.planned} selected=${value.selected} attempted=${value.attempted} accepted=${value.accepted}`
            )
            .join("; ")}`
        ]
      : []),
    ...(summary.local_ai_analysis
      ? [
          `- Local AI decisions: accepted=${summary.local_ai_analysis.decisions.accepted}, queued=${summary.local_ai_analysis.decisions.queued}, rejected=${summary.local_ai_analysis.decisions.rejected}, deterministic_vetoes=${summary.local_ai_analysis.deterministic_veto_count}${summary.local_ai_analysis.model ? `, model=${summary.local_ai_analysis.model}` : ""}`
        ]
      : []),
    "",
    "## Valuation",
    `- Generated: ${valuation.generated}`,
    `- Reason: ${valuation.reason}`,
    `- Turkey Range (TRY): ${valuation.turkeyRange ? `${fmt(valuation.turkeyRange.low)} - ${fmt(valuation.turkeyRange.high)}` : "N/A"}`,
    `- International Range (TRY): ${valuation.internationalRange ? `${fmt(valuation.internationalRange.low)} - ${fmt(valuation.internationalRange.high)}` : "N/A"}`,
    `- Blended Range (TRY): ${valuation.blendedRange ? `${fmt(valuation.blendedRange.low)} - ${fmt(valuation.blendedRange.high)}` : "N/A"}`,
    "",
    "## Top Comparable Drivers",
    ...(valuation.topComparables.length > 0
      ? valuation.topComparables.map(
          (comp, index) =>
            `${index + 1}. ${comp.sourceName} | ${comp.workTitle ?? "-"} | lane=${comp.valuationLane} | score=${comp.score.toFixed(3)} | valuation_eligible=${comp.acceptedForValuation ? "yes" : "no"} | reasons=${comp.reasons.join(", ")} | TRY=${fmt(comp.normalizedPriceTry)} | native=${fmt(comp.nativePrice)} ${comp.currency ?? ""} | ${comp.sourceUrl}`
        )
      : ["- No comparable drivers available."]),
    "",
    "## Next Actions",
    ...(recommendedActions.length > 0
      ? recommendedActions.map((action) => `- [${action.severity}] ${action.title}: ${action.reason}`)
      : ["- No operator follow-up actions were generated for this run."]),
    "",
    "## Source Reliability",
    ...(summary.persisted_source_metrics && summary.persisted_source_metrics.length > 0
      ? summary.persisted_source_metrics.slice(0, 12).map(sourceMetricLine)
      : ["- No persisted source metrics were available."]),
    "",
    "## Canary History",
    ...(summary.recent_canaries && summary.recent_canaries.length > 0
      ? summary.recent_canaries.slice(0, 12).map(canaryLine)
      : ["- No canary history was available."]),
    "",
    "## Source Plan",
    ...(sourcePlan.length > 0
      ? sourcePlan.slice(0, 16).map(sourcePlanLine)
      : ["- No source plan was captured for this run."]),
    "",
    "## Comparable Sales",
    "| Artist | Work | Source | Country | Price Type | Lane | Valuation Eligible | Acceptance Reason | Access Status | Legal Posture | Provenance | Explanation | Next Step | Native Price | Normalized TRY | URL |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...records.map((record) => `| ${recordLine(record)} |`),
    "",
    "## Turkey-First Notes",
    turkey.length > 0
      ? `- Included ${turkey.length} Turkey records and ${international.length} international comparables.`
      : "- No Turkey comps found; expanded internationally.",
    "",
    "## Comp Selection Notes",
    "- Ranked by confidence components + semantic lane weighting + Turkey-first uplift.",
    "- Valuation excludes evidence-only records and applies outlier filtering on valuation-eligible comps.",
    "",
    "## Outlier Exclusions",
    ...(valuation.outlierValuesTry.length > 0
      ? [`- Excluded TRY values: ${valuation.outlierValuesTry.map((value) => fmt(value)).join(", ")}`]
      : ["- No outlier exclusions applied."]),
    "",
    "## Gaps and Uncertainties",
    ...(gaps.length > 0 ? gaps.map((gap) => `- ${gap}`) : ["- None reported."])
  ].join("\n");
}
