import { z } from "zod";
import type {
  ResearchRunReportData,
  ResearchRunReportItem,
  ReportAction,
  ReportComparable,
  ReportDistributionItem,
  ReportMetric,
  ReportRange,
  ReportReasonItem,
  ReportSourcePlanItem,
  ReportTone
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatCurrency(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "TRY" ? 0 : 2
    }).format(value);
  } catch {
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function toneForStatus(status: string): ReportTone {
  if (status.includes("accepted") || status.includes("ready") || status.includes("public")) return "success";
  if (status.includes("blocked") || status.includes("missing") || status.includes("rejected") || status.includes("failed")) return "danger";
  if (status.includes("auth") || status.includes("estimate") || status.includes("warning")) return "warning";
  if (status.includes("coverage") || status.includes("asking")) return "accent";
  return "muted";
}

function toneForDistribution(label: string): ReportTone {
  switch (label) {
    case "public_access":
      return "success";
    case "blocked":
      return "danger";
    case "auth_required":
    case "price_hidden":
    case "licensed_access":
      return "warning";
    default:
      return "muted";
  }
}

function range(label: string, low: number | null | undefined, high: number | null | undefined, currency = "TRY"): ReportRange | null {
  if (low == null && high == null) return null;
  return {
    label,
    low: low ?? null,
    high: high ?? null,
    currency
  };
}

function compareNumericDesc(left: number | null | undefined, right: number | null | undefined): number {
  const a = left ?? Number.NEGATIVE_INFINITY;
  const b = right ?? Number.NEGATIVE_INFINITY;
  return b - a;
}

const externalItemSchema = z.object({
  id: z.string().optional(),
  work_title: z.string().optional(),
  year: z.string().nullable().optional(),
  venue_name: z.string().optional(),
  source_url: z.string().optional(),
  price_type: z.string().optional(),
  price_amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  normalized_price_usd: z.number().nullable().optional(),
  image_url: z.string().nullable().optional(),
  valuation_confidence: z.number().nullable().optional(),
  accepted_for_valuation: z.boolean().optional(),
  acceptance_reason: z.string().nullable().optional()
}).passthrough();

const externalReportSchema = z.object({
  runId: z.string(),
  artist: z.string(),
  status: z.string().default("completed"),
  analysisMode: z.string().optional(),
  metrics: z.object({
    accepted: z.number().int().nonnegative().default(0),
    rejected: z.number().int().nonnegative().default(0),
    discoveredCandidates: z.number().int().nonnegative().default(0),
    acceptedFromDiscovery: z.number().int().nonnegative().default(0),
    pricedCoverageCrawled: z.number().nullable().optional(),
    pricedCoverageAttempted: z.number().nullable().optional()
  }),
  valuation: z.object({
    generated: z.boolean().default(false),
    reason: z.string().default("No valuation output available.")
  }).optional(),
  sourceHealth: z.record(z.string(), z.number()).default({}),
  inventory: z.array(externalItemSchema).default([])
}).passthrough();

const runPayloadSchema = z.object({
  run: z.object({
    id: z.string(),
    runType: z.string().optional(),
    status: z.string().default("completed"),
    createdAt: z.string().optional(),
    query: z.object({
      artist: z.string().optional(),
      analysisMode: z.string().optional()
    }).passthrough().optional(),
    resultsPath: z.string().optional()
  }).passthrough(),
  summary: z.object({
    accepted_records: z.number().int().nonnegative().default(0),
    rejected_candidates: z.number().int().nonnegative().default(0),
    discovered_candidates: z.number().int().nonnegative().default(0),
    accepted_from_discovery: z.number().int().nonnegative().default(0),
    total_attempts: z.number().int().nonnegative().optional(),
    total_records: z.number().int().nonnegative().optional(),
    valuation_eligible_records: z.number().int().nonnegative().optional(),
    priced_source_coverage_ratio: z.number().nullable().optional(),
    priced_crawled_source_coverage_ratio: z.number().nullable().optional(),
    evaluation_metrics: z.object({
      accepted_record_precision: z.number(),
      priced_source_recall: z.number(),
      source_completeness_ratio: z.number(),
      valuation_readiness_ratio: z.number(),
      manual_override_rate: z.number(),
      coverage_target: z.number(),
      coverage_target_met: z.boolean()
    }).optional(),
    source_status_breakdown: z.record(z.string(), z.number()).default({}),
    acceptance_reason_breakdown: z.record(z.string(), z.number()).default({}),
    failure_class_breakdown: z.record(z.string(), z.number()).optional(),
    valuation_generated: z.boolean().optional(),
    valuation_reason: z.string().optional()
  }).optional(),
  valuation: z.object({
    generated: z.boolean().optional(),
    reason: z.string().optional(),
    valuationCandidateCount: z.number().nullable().optional(),
    valuationCandidateCountUsed: z.number().nullable().optional(),
    turkeyRange: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
    internationalRange: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
    blendedRange: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
    laneRanges: z.object({
      realized: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
      estimate: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
      asking: z.object({ low: z.number(), high: z.number() }).nullable().optional()
    }).optional(),
    topComparables: z.array(z.object({
      sourceName: z.string(),
      workTitle: z.string(),
      nativePrice: z.number().nullable().optional(),
      normalizedPriceTry: z.number().nullable().optional(),
      currency: z.string().optional(),
      valuationLane: z.string().optional(),
      score: z.number().nullable().optional()
    })).optional()
  }).nullable().optional(),
  records: z.array(z.object({
    work_title: z.string().optional(),
    source_name: z.string().optional(),
    venue_name: z.string().optional(),
    source_url: z.string().optional(),
    image_url: z.string().nullable().optional(),
    price_type: z.string().optional(),
    price_amount: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    normalized_price_usd: z.number().nullable().optional(),
    normalized_price_usd_nominal: z.number().nullable().optional(),
    sale_or_listing_date: z.string().nullable().optional(),
    dimensions_text: z.string().nullable().optional(),
    year: z.string().nullable().optional(),
    overall_confidence: z.number().nullable().optional(),
    acceptance_reason: z.string().nullable().optional(),
    accepted_for_valuation: z.boolean().optional(),
    source_access_status: z.string().nullable().optional()
  }).passthrough()).optional(),
  inventory: z.array(z.unknown()).optional(),
  attempts: z.array(z.object({
    blocker_reason: z.string().nullable().optional()
  }).passthrough()).optional(),
  source_plan: z.array(z.object({
    source_name: z.string(),
    venue_name: z.string(),
    source_family: z.string().optional(),
    access_mode: z.string(),
    source_access_status: z.string(),
    candidate_count: z.number().int().nonnegative(),
    status: z.string(),
    selection_state: z.string().optional(),
    selection_reason: z.string().nullable().optional(),
    priority_rank: z.number().int().positive().optional(),
    skip_reason: z.string().nullable().optional()
  })).optional(),
  recommended_actions: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    severity: z.enum(["info", "warning", "critical"])
  })).optional(),
  gaps: z.array(z.string()).optional()
}).passthrough();

function buildSourceHealthItems(sourceHealth: Record<string, number>): ReportDistributionItem[] {
  return Object.entries(sourceHealth)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label: toLabel(label),
      value,
      tone: toneForDistribution(label)
    }));
}

function buildReasonItems(input: Record<string, number> | undefined): ReportReasonItem[] {
  return Object.entries(input ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label: toLabel(label),
      count,
      tone: toneForStatus(label.toLowerCase())
    }));
}

function buildOverviewMetrics(data: ResearchRunReportData): ReportMetric[] {
  return [
    {
      label: "Accepted",
      value: formatInteger(data.metrics.accepted),
      tone: "success"
    },
    {
      label: "Rejected",
      value: formatInteger(data.metrics.rejected),
      tone: data.metrics.rejected > 0 ? "danger" : "muted"
    },
    {
      label: "Discovered",
      value: formatInteger(data.metrics.discoveredCandidates),
      tone: data.metrics.discoveredCandidates > 0 ? "accent" : "muted"
    },
    {
      label: "Accepted From Discovery",
      value: formatInteger(data.metrics.acceptedFromDiscovery),
      tone: data.metrics.acceptedFromDiscovery > 0 ? "success" : "muted"
    },
    {
      label: "Crawled Coverage",
      value: formatPercent(data.metrics.pricedCoverageCrawled),
      tone: (data.metrics.pricedCoverageCrawled ?? 0) >= 0.5 ? "success" : "warning"
    },
    {
      label: "Attempted Coverage",
      value: formatPercent(data.metrics.pricedCoverageAttempted),
      tone: (data.metrics.pricedCoverageAttempted ?? 0) >= 0.5 ? "success" : "warning"
    }
  ];
}

function buildCoverageMetrics(data: ResearchRunReportData): ReportMetric[] {
  return [
    {
      label: "Total Attempts",
      value: formatInteger(data.metrics.totalAttempts),
      tone: "muted"
    },
    {
      label: "Records In Report",
      value: formatInteger(data.metrics.totalRecords),
      tone: "accent"
    },
    {
      label: "Valuation Eligible",
      value: formatInteger(data.metrics.valuationEligible),
      tone: (data.metrics.valuationEligible ?? 0) > 0 ? "success" : "warning"
    },
    {
      label: "Run Status",
      value: toLabel(data.status),
      tone: toneForStatus(data.status)
    }
  ];
}

function buildEvaluationMetricItems(
  input: z.infer<typeof runPayloadSchema>["summary"] | undefined
): ReportMetric[] {
  const metrics = input?.evaluation_metrics;
  if (!metrics) {
    return [];
  }

  return [
    {
      label: "Accepted Precision",
      value: formatPercent(metrics.accepted_record_precision),
      tone: metrics.accepted_record_precision >= 0.5 ? "success" : "warning"
    },
    {
      label: "Priced Evidence Coverage",
      value: formatPercent(metrics.valuation_readiness_ratio),
      tone: metrics.coverage_target_met ? "success" : "danger",
      hint: `Target ${Math.round(metrics.coverage_target * 100)}%`
    },
    {
      label: "Priced Source Recall",
      value: formatPercent(metrics.priced_source_recall),
      tone: metrics.priced_source_recall >= metrics.coverage_target ? "success" : "warning"
    },
    {
      label: "Source Completeness",
      value: formatPercent(metrics.source_completeness_ratio),
      tone: metrics.source_completeness_ratio >= 0.6 ? "success" : "warning"
    },
    {
      label: "Manual Override Rate",
      value: formatPercent(metrics.manual_override_rate),
      tone: metrics.manual_override_rate === 0 ? "muted" : "warning"
    }
  ];
}

function normalizeExternalItem(item: z.infer<typeof externalItemSchema>, index: number): ResearchRunReportItem {
  const nativeCurrency = item.currency ?? "USD";
  const nativePriceLabel = item.price_amount != null ? formatCurrency(item.price_amount, nativeCurrency) : null;
  const normalizedPriceUsd = item.normalized_price_usd ?? null;
  return {
    id: item.id ?? `inventory-${index + 1}`,
    title: item.work_title ?? "Untitled",
    venueName: item.venue_name ?? "Unknown venue",
    sourceUrl: item.source_url ?? null,
    imageUrl: item.image_url ?? null,
    year: item.year ?? null,
    date: null,
    priceType: item.price_type ?? "unknown",
    priceLabel: normalizedPriceUsd != null ? formatCurrency(normalizedPriceUsd, "USD") : nativePriceLabel ?? "n/a",
    nativePriceLabel,
    normalizedPriceUsd,
    valuationConfidence: item.valuation_confidence ?? null,
    acceptedForValuation: Boolean(item.accepted_for_valuation),
    acceptanceReason: item.acceptance_reason ?? null,
    sourceAccessStatus: null,
    detail: null
  };
}

function normalizeRunRecord(item: Record<string, unknown>, index: number): ResearchRunReportItem {
  const nativeCurrency = typeof item.currency === "string" ? item.currency : "TRY";
  const nativePrice = typeof item.price_amount === "number" ? item.price_amount : null;
  const normalizedPriceUsd =
    typeof item.normalized_price_usd_nominal === "number"
      ? item.normalized_price_usd_nominal
      : typeof item.normalized_price_usd === "number"
        ? item.normalized_price_usd
        : null;
  const nativePriceLabel = nativePrice != null ? formatCurrency(nativePrice, nativeCurrency) : null;
  const detailParts = [
    typeof item.sale_or_listing_date === "string" ? item.sale_or_listing_date : null,
    typeof item.dimensions_text === "string" ? item.dimensions_text : null
  ].filter((entry): entry is string => Boolean(entry));

  return {
    id: typeof item.id === "string" ? item.id : `record-${index + 1}`,
    title: typeof item.work_title === "string" ? item.work_title : "Untitled",
    venueName:
      typeof item.venue_name === "string"
        ? item.venue_name
        : typeof item.source_name === "string"
          ? item.source_name
          : "Unknown source",
    sourceUrl: typeof item.source_url === "string" ? item.source_url : null,
    imageUrl: typeof item.image_url === "string" ? item.image_url : null,
    year: typeof item.year === "string" ? item.year : null,
    date: typeof item.sale_or_listing_date === "string" ? item.sale_or_listing_date : null,
    priceType: typeof item.price_type === "string" ? item.price_type : "unknown",
    priceLabel: normalizedPriceUsd != null ? formatCurrency(normalizedPriceUsd, "USD") : nativePriceLabel ?? "n/a",
    nativePriceLabel,
    normalizedPriceUsd,
    valuationConfidence:
      typeof item.overall_confidence === "number"
        ? item.overall_confidence
        : typeof item.valuation_confidence === "number"
          ? item.valuation_confidence
          : null,
    acceptedForValuation: Boolean(item.accepted_for_valuation),
    acceptanceReason: typeof item.acceptance_reason === "string" ? item.acceptance_reason : null,
    sourceAccessStatus: typeof item.source_access_status === "string" ? item.source_access_status : null,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null
  };
}

function unwrapInventoryItem(item: unknown): Record<string, unknown> {
  if (!isRecord(item)) {
    return {};
  }

  if (!isRecord(item.payload)) {
    return item;
  }

  return {
    ...item.payload,
    id:
      typeof item.record_key === "string"
        ? item.record_key
        : typeof item.id === "string"
          ? item.id
          : typeof item.payload.id === "string"
            ? item.payload.id
            : undefined
  };
}

function buildComparables(input: Array<Record<string, unknown>> | undefined): ReportComparable[] {
  return (input ?? []).slice(0, 6).map((item) => ({
    sourceName: typeof item.sourceName === "string" ? item.sourceName : "Unknown source",
    workTitle: typeof item.workTitle === "string" ? item.workTitle : "Untitled",
    lane: typeof item.valuationLane === "string" ? toLabel(item.valuationLane) : "Comparable",
    score: typeof item.score === "number" ? item.score : null,
    valueLabel:
      typeof item.nativePrice === "number"
        ? formatCurrency(item.nativePrice, typeof item.currency === "string" ? item.currency : "TRY")
        : typeof item.normalizedPriceTry === "number"
          ? formatCurrency(item.normalizedPriceTry, "TRY")
          : "n/a"
  }));
}

function buildActions(
  input: Array<{ title: string; reason: string; severity: "info" | "warning" | "critical" }> | undefined
): ReportAction[] {
  return (input ?? []).map((item) => ({
    title: item.title,
    reason: item.reason,
    severity: item.severity
  }));
}

function buildSourcePlanItems(
  input: Array<{
    source_name: string;
    venue_name: string;
    source_family?: string;
    access_mode: string;
    source_access_status: string;
    candidate_count: number;
    status: string;
    selection_state?: string;
    selection_reason?: string | null;
    priority_rank?: number;
    skip_reason?: string | null;
  }> | undefined
): ReportSourcePlanItem[] {
  return (input ?? []).map((item) => ({
    sourceName: item.source_name,
    venueName: item.venue_name,
    sourceFamily: item.source_family ?? "unknown",
    accessMode: item.access_mode,
    accessStatus: item.source_access_status,
    candidateCount: item.candidate_count,
    status: item.status,
    selectionState: item.selection_state ?? item.status,
    selectionReason: item.selection_reason ?? null,
    priorityRank: item.priority_rank ?? 0,
    skipReason: item.skip_reason ?? null
  }));
}

function finalizeReport(data: Omit<ResearchRunReportData, "overviewMetrics" | "coverageMetrics" | "sourceHealthItems">): ResearchRunReportData {
  const report: ResearchRunReportData = {
    ...data,
    sourceHealthItems: buildSourceHealthItems(data.sourceHealth),
    overviewMetrics: [] as ReportMetric[],
    coverageMetrics: [] as ReportMetric[]
  };
  report.overviewMetrics = buildOverviewMetrics(report);
  report.coverageMetrics = buildCoverageMetrics(report);
  return report;
}

function normalizeExternalReport(input: z.infer<typeof externalReportSchema>): ResearchRunReportData {
  const sourceHealth = input.sourceHealth;
  const records = input.inventory.map(normalizeExternalItem).sort((left, right) => {
    if (left.acceptedForValuation !== right.acceptedForValuation) return left.acceptedForValuation ? -1 : 1;
    return compareNumericDesc(left.valuationConfidence, right.valuationConfidence);
  });

  return finalizeReport({
    runId: input.runId,
    artist: input.artist,
    status: input.status,
    runType: "external_report",
    analysisMode: input.analysisMode ?? null,
    createdAt: null,
    metrics: {
      accepted: input.metrics.accepted,
      rejected: input.metrics.rejected,
      discoveredCandidates: input.metrics.discoveredCandidates,
      acceptedFromDiscovery: input.metrics.acceptedFromDiscovery,
      pricedCoverageCrawled: input.metrics.pricedCoverageCrawled ?? null,
      pricedCoverageAttempted: input.metrics.pricedCoverageAttempted ?? null,
      totalAttempts: input.metrics.accepted + input.metrics.rejected,
      totalRecords: records.length,
      valuationEligible: records.filter((item) => item.acceptedForValuation).length
    },
    sourceHealth,
    valuation: {
      generated: input.valuation?.generated ?? false,
      reason: input.valuation?.reason ?? "No valuation output available.",
      valuationCandidateCount: records.filter((item) => item.acceptedForValuation).length,
      ranges: [],
      topComparables: []
    },
    records,
    evaluationMetrics: [],
    recommendedActions: [],
    sourcePlan: [],
    reasonBreakdown: buildReasonItems(
      records.reduce<Record<string, number>>((acc, item) => {
        if (!item.acceptanceReason) return acc;
        acc[item.acceptanceReason] = (acc[item.acceptanceReason] ?? 0) + 1;
        return acc;
      }, {})
    ),
    failureBreakdown: [],
    gaps: [],
    diagnosticsNotes: input.valuation?.generated
      ? []
      : [input.valuation?.reason ?? "Valuation was not generated for this run."]
  });
}

function normalizeRunPayload(input: z.infer<typeof runPayloadSchema>): ResearchRunReportData {
  const summary = input.summary;
  const sourceHealth = summary?.source_status_breakdown ?? {};
  const recordsSource =
    input.run.runType === "artist_market_inventory" || (input.inventory?.length ?? 0) > 0
      ? (input.inventory ?? []).map((item) => unwrapInventoryItem(item))
      : input.records ?? [];
  const records = recordsSource
    .map((item, index) => normalizeRunRecord(item, index))
    .sort((left, right) => {
      if (left.acceptedForValuation !== right.acceptedForValuation) return left.acceptedForValuation ? -1 : 1;
      return compareNumericDesc(left.valuationConfidence, right.valuationConfidence);
    });

  const valuationReason = input.valuation?.reason ?? summary?.valuation_reason ?? "No valuation output available.";
  const ranges = [
    range("Blended", input.valuation?.blendedRange?.low, input.valuation?.blendedRange?.high, "TRY"),
    range("Turkey", input.valuation?.turkeyRange?.low, input.valuation?.turkeyRange?.high, "TRY"),
    range("International", input.valuation?.internationalRange?.low, input.valuation?.internationalRange?.high, "TRY"),
    range("Realized Lane", input.valuation?.laneRanges?.realized?.low, input.valuation?.laneRanges?.realized?.high, "TRY"),
    range("Estimate Lane", input.valuation?.laneRanges?.estimate?.low, input.valuation?.laneRanges?.estimate?.high, "TRY"),
    range("Asking Lane", input.valuation?.laneRanges?.asking?.low, input.valuation?.laneRanges?.asking?.high, "TRY")
  ].filter((entry): entry is ReportRange => Boolean(entry));

  return finalizeReport({
    runId: input.run.id,
    artist: input.run.query?.artist ?? "Unknown artist",
    status: input.run.status,
    runType: input.run.runType ?? "artist",
    analysisMode: input.run.query?.analysisMode ?? null,
    createdAt: input.run.createdAt ?? null,
    metrics: {
      accepted: summary?.accepted_records ?? records.filter((item) => item.acceptedForValuation).length,
      rejected: summary?.rejected_candidates ?? 0,
      discoveredCandidates: summary?.discovered_candidates ?? 0,
      acceptedFromDiscovery: summary?.accepted_from_discovery ?? 0,
      pricedCoverageCrawled: summary?.priced_crawled_source_coverage_ratio ?? null,
      pricedCoverageAttempted: summary?.priced_source_coverage_ratio ?? null,
      totalAttempts: summary?.total_attempts ?? records.length,
      totalRecords: summary?.total_records ?? records.length,
      valuationEligible: summary?.valuation_eligible_records ?? records.filter((item) => item.acceptedForValuation).length
    },
    sourceHealth,
    valuation: {
      generated: Boolean(input.valuation?.generated ?? summary?.valuation_generated),
      reason: valuationReason,
      valuationCandidateCount:
        input.valuation?.valuationCandidateCount
        ?? input.valuation?.valuationCandidateCountUsed
        ?? summary?.valuation_eligible_records
        ?? null,
      ranges,
      topComparables: buildComparables(
        input.valuation?.topComparables as Array<Record<string, unknown>> | undefined
      )
    },
    records,
    evaluationMetrics: buildEvaluationMetricItems(summary),
    recommendedActions: buildActions(input.recommended_actions),
    sourcePlan: buildSourcePlanItems(input.source_plan),
    reasonBreakdown: buildReasonItems(summary?.acceptance_reason_breakdown),
    failureBreakdown: buildReasonItems(summary?.failure_class_breakdown),
    gaps: input.gaps ?? [],
    diagnosticsNotes: [
      ...(input.valuation?.generated ?? summary?.valuation_generated ? [] : [valuationReason]),
      ...((input.attempts ?? [])
        .map((attempt) => (isRecord(attempt) && typeof attempt.blocker_reason === "string" ? attempt.blocker_reason : null))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 4))
    ]
  });
}

export function normalizeResearchRunReport(input: unknown): ResearchRunReportData {
  const externalCandidate = externalReportSchema.safeParse(input);
  if (externalCandidate.success) {
    return normalizeExternalReport(externalCandidate.data);
  }

  const runPayload = runPayloadSchema.safeParse(input);
  if (runPayload.success) {
    return normalizeRunPayload(runPayload.data);
  }

  if (isRecord(input) && isRecord(input.reportData)) {
    return normalizeResearchRunReport(input.reportData);
  }

  throw new Error("Unsupported report payload.");
}
