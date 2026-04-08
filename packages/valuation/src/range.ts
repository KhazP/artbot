import type { PriceRecord } from "@artbot/shared-types";
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

  return null;
}

export function buildValuation(records: PriceRecord[], minComps = 5): ValuationOutcome {
  const highConfidence = records.filter((record) => record.overall_confidence >= 0.65);

  if (highConfidence.length < minComps) {
    return {
      generated: false,
      reason: `Insufficient high-confidence comparables (${highConfidence.length}/${minComps}).`,
      turkeyRange: null,
      internationalRange: null,
      blendedRange: null,
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
      outlierValuesTry: removed
    };
  }

  return {
    generated: true,
    reason: "Generated from high-confidence comparables with Turkey-first weighting.",
    turkeyRange: toRange(turkeyValues),
    internationalRange: toRange(internationalValues),
    blendedRange: toRange(kept),
    outlierValuesTry: removed
  };
}
