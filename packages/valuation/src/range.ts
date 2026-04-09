import type { PriceRecord } from "@artbot/shared-types";
import type { ScoredComparable } from "./ranking.js";
import { removeOutliers } from "./outliers.js";

export interface PriceRange {
  low: number;
  high: number;
}

export interface ValuationOutcome {
  generated: boolean;
  reason: string;
  turkeyRange: PriceRange | null;
  internationalRange: PriceRange | null;
  blendedRange: PriceRange | null;
  laneRanges: {
    realized: PriceRange | null;
    estimate: PriceRange | null;
    asking: PriceRange | null;
  };
  topComparables: Array<{
    sourceName: string;
    workTitle: string | null;
    valuationLane: "realized" | "estimate" | "asking" | "none";
    acceptedForValuation: boolean;
    score: number;
    reasons: string[];
    normalizedPriceTry: number | null;
    nativePrice: number | null;
    currency: string | null;
    sourceUrl: string;
  }>;
  valuationCandidateCount: number;
  outlierValuesTry: number[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function toRange(values: number[]): PriceRange | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: quantile(sorted, 0.2),
    high: quantile(sorted, 0.8)
  };
}

function pickPriceTry(record: PriceRecord): number | null {
  if (record.normalized_price_try && Number.isFinite(record.normalized_price_try)) {
    return record.normalized_price_try;
  }

  if (record.currency === "TRY" && record.price_amount && Number.isFinite(record.price_amount)) {
    return record.price_amount;
  }

  if (record.currency === "TRY") {
    const low = record.estimate_low;
    const high = record.estimate_high;
    if (low !== null && high !== null) {
      return (low + high) / 2;
    }
    return low ?? high ?? null;
  }

  return null;
}

export function buildValuation(records: PriceRecord[], minComps = 5, scoredRecords?: ScoredComparable[]): ValuationOutcome {
  const topComparables = buildTopComparables(records, scoredRecords);
  const highConfidence = records.filter((record) => record.accepted_for_valuation && record.overall_confidence >= 0.6);
  const realizedValues = highConfidence
    .filter((record) => record.valuation_lane === "realized")
    .map(pickPriceTry)
    .filter((value): value is number => value !== null);
  const estimateValues = highConfidence
    .filter((record) => record.valuation_lane === "estimate")
    .map(pickPriceTry)
    .filter((value): value is number => value !== null);
  const askingValues = highConfidence
    .filter((record) => record.valuation_lane === "asking")
    .map(pickPriceTry)
    .filter((value): value is number => value !== null);

  if (highConfidence.length < minComps) {
    return {
      generated: false,
      reason: `Insufficient valuation-eligible comparables (${highConfidence.length}/${minComps}).`,
      turkeyRange: null,
      internationalRange: null,
      blendedRange: null,
      laneRanges: {
        realized: toRange(realizedValues),
        estimate: toRange(estimateValues),
        asking: toRange(askingValues)
      },
      topComparables,
      valuationCandidateCount: highConfidence.length,
      outlierValuesTry: []
    };
  }

  const turkeyValues = highConfidence
    .filter((record) => record.country === "Turkey")
    .map(pickPriceTry)
    .filter((value): value is number => value !== null);

  const internationalValues = highConfidence
    .filter((record) => record.country !== "Turkey")
    .map(pickPriceTry)
    .filter((value): value is number => value !== null);

  const combined = [...turkeyValues, ...internationalValues];
  const { kept, removed } = removeOutliers(combined);

  if (kept.length < minComps) {
    return {
      generated: false,
      reason: `Valuation skipped after outlier filtering (${kept.length}/${minComps}).`,
      turkeyRange: toRange(turkeyValues),
      internationalRange: toRange(internationalValues),
      blendedRange: null,
      laneRanges: {
        realized: toRange(realizedValues),
        estimate: toRange(estimateValues),
        asking: toRange(askingValues)
      },
      topComparables,
      valuationCandidateCount: highConfidence.length,
      outlierValuesTry: removed
    };
  }

  return {
    generated: true,
    reason: "Generated from valuation-eligible comparables with semantic lanes and Turkey-first ranking.",
    turkeyRange: toRange(turkeyValues),
    internationalRange: toRange(internationalValues),
    blendedRange: toRange(kept),
    laneRanges: {
      realized: toRange(realizedValues),
      estimate: toRange(estimateValues),
      asking: toRange(askingValues)
    },
    topComparables,
    valuationCandidateCount: highConfidence.length,
    outlierValuesTry: removed
  };
}

export function buildTopComparables(
  records: PriceRecord[],
  scoredRecords?: ScoredComparable[],
  limit = 5
): ValuationOutcome["topComparables"] {
  if (scoredRecords && scoredRecords.length > 0) {
    const prioritized = [
      ...scoredRecords.filter((entry) => entry.record.accepted_for_valuation),
      ...scoredRecords.filter((entry) => !entry.record.accepted_for_valuation)
    ];
    const deduped = new Map<string, ScoredComparable>();
    for (const entry of prioritized) {
      const key = `${entry.record.source_name}:${entry.record.source_url}`;
      if (!deduped.has(key)) {
        deduped.set(key, entry);
      }
    }

    return Array.from(deduped.values())
      .slice(0, limit)
      .map((entry) => ({
        sourceName: entry.record.source_name,
        workTitle: entry.record.work_title,
        valuationLane: entry.record.valuation_lane,
        acceptedForValuation: entry.record.accepted_for_valuation,
        score: Number(entry.breakdown.score.toFixed(4)),
        reasons: entry.breakdown.reasons,
        normalizedPriceTry: entry.record.normalized_price_try,
        nativePrice: entry.record.price_amount,
        currency: entry.record.currency,
        sourceUrl: entry.record.source_url
      }));
  }

  return records.slice(0, limit).map((record) => ({
    sourceName: record.source_name,
    workTitle: record.work_title,
    valuationLane: record.valuation_lane,
    acceptedForValuation: record.accepted_for_valuation,
    score: Number(record.overall_confidence.toFixed(4)),
    reasons: ["fallback confidence ranking"],
    normalizedPriceTry: record.normalized_price_try,
    nativePrice: record.price_amount,
    currency: record.currency,
    sourceUrl: record.source_url
  }));
}
