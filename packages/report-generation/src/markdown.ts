import type { PriceRecord, RunSummary } from "@artbot/shared-types";
import type { ValuationOutcome } from "@artbot/valuation";

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function recordLine(record: PriceRecord): string {
  return `| ${record.artist_name} | ${record.work_title ?? "-"} | ${record.source_name} | ${record.country ?? "-"} | ${record.price_type} | ${record.valuation_lane} | ${record.accepted_for_valuation ? "yes" : "no"} | ${record.acceptance_reason} | ${fmt(record.price_amount)} ${record.currency ?? ""} | ${fmt(record.normalized_price_try)} TRY | ${record.source_url} |`;
}

export function renderMarkdownReport(
  records: PriceRecord[],
  summary: RunSummary,
  valuation: ValuationOutcome,
  gaps: string[]
): string {
  const turkey = records.filter((record) => record.country === "Turkey");
  const international = records.filter((record) => record.country !== "Turkey");

  return [
    "# Turkish Art Price Research Report",
    "",
    "## Run Summary",
    `- Run ID: ${summary.run_id}`,
    `- Total accepted records: ${summary.accepted_records}`,
    `- Valuation-eligible records: ${summary.valuation_eligible_records ?? 0}`,
    `- Total rejected candidates: ${summary.rejected_candidates}`,
    `- Discovered candidates: ${summary.discovered_candidates}`,
    `- Accepted from discovery: ${summary.accepted_from_discovery}`,
    `- Source status breakdown: ${JSON.stringify(summary.source_status_breakdown)}`,
    `- Auth mode breakdown: ${JSON.stringify(summary.auth_mode_breakdown)}`,
    `- Failure class breakdown: ${JSON.stringify(summary.failure_class_breakdown ?? {})}`,
    `- Source candidate breakdown: ${JSON.stringify(summary.source_candidate_breakdown)}`,
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
    "## Comparable Sales",
    "| Artist | Work | Source | Country | Price Type | Lane | Valuation Eligible | Acceptance Reason | Native Price | Normalized TRY | URL |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...records.map(recordLine),
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
