import type { PriceRecord } from "@artbot/shared-types";

function basePrice(record: PriceRecord): number | null {
  return record.normalized_price_try ?? record.price_amount;
}

function laneWeight(record: PriceRecord): number {
  if (record.valuation_lane === "realized") return 0.18;
  if (record.valuation_lane === "estimate") return 0.08;
  if (record.valuation_lane === "asking") return 0.05;
  return -0.22;
}

function recencyWeight(record: PriceRecord): number {
  if (!record.sale_or_listing_date) return 0;
  const saleDate = new Date(record.sale_or_listing_date);
  if (Number.isNaN(saleDate.getTime())) return 0;

  const now = Date.now();
  const diffDays = Math.max(0, (now - saleDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 180) return 0.08;
  if (diffDays <= 365) return 0.05;
  if (diffDays <= 730) return 0.02;
  return -0.03;
}

export interface ComparableScoreBreakdown {
  score: number;
  modelComponents: {
    overallConfidence: number;
    extractionConfidence: number;
    entityMatchConfidence: number;
    sourceReliabilityConfidence: number;
    countryBoost: number;
    laneBoost: number;
    recencyBoost: number;
    valuationEligibilityBoost: number;
  };
  reasons: string[];
}

export interface ScoredComparable {
  record: PriceRecord;
  breakdown: ComparableScoreBreakdown;
}

function buildReasons(record: PriceRecord, components: ComparableScoreBreakdown["modelComponents"]): string[] {
  const reasons: string[] = [];
  if (record.country === "Turkey") reasons.push("Turkey-first source boost");
  if (record.accepted_for_valuation) reasons.push("valuation-eligible");
  if (!record.accepted_for_valuation) reasons.push("evidence-only penalty");
  if (record.valuation_lane === "realized") reasons.push("realized lane priority");
  if (record.valuation_lane === "estimate") reasons.push("estimate lane included");
  if (record.valuation_lane === "asking") reasons.push("asking lane included");
  if (components.recencyBoost > 0) reasons.push("recent market signal");
  if (record.entity_match_confidence < 0.55) reasons.push("weak entity match");
  if (record.extraction_confidence < 0.55) reasons.push("low extraction completeness");
  return reasons;
}

export function scoreComparable(record: PriceRecord): ComparableScoreBreakdown {
  const countryBoost = record.country === "Turkey" ? 0.12 : 0;
  const valuationEligibilityBoost = record.accepted_for_valuation ? 0.2 : -0.15;
  const laneBoost = laneWeight(record);
  const recencyBoost = recencyWeight(record);

  const score =
    record.overall_confidence * 0.45 +
    record.extraction_confidence * 0.2 +
    record.entity_match_confidence * 0.15 +
    record.source_reliability_confidence * 0.2 +
    countryBoost +
    laneBoost +
    recencyBoost +
    valuationEligibilityBoost;

  const modelComponents: ComparableScoreBreakdown["modelComponents"] = {
    overallConfidence: record.overall_confidence * 0.45,
    extractionConfidence: record.extraction_confidence * 0.2,
    entityMatchConfidence: record.entity_match_confidence * 0.15,
    sourceReliabilityConfidence: record.source_reliability_confidence * 0.2,
    countryBoost,
    laneBoost,
    recencyBoost,
    valuationEligibilityBoost
  };

  return {
    score,
    modelComponents,
    reasons: buildReasons(record, modelComponents)
  };
}

export function rankComparablesWithScores(records: PriceRecord[]): ScoredComparable[] {
  return [...records]
    .map((record) => ({
      record,
      breakdown: scoreComparable(record)
    }))
    .sort((a, b) => {
      if (a.breakdown.score !== b.breakdown.score) {
        return b.breakdown.score - a.breakdown.score;
      }
      const priceA = basePrice(a.record) ?? 0;
      const priceB = basePrice(b.record) ?? 0;
      return priceB - priceA;
    });
}

export function rankComparables(records: PriceRecord[]): PriceRecord[] {
  return rankComparablesWithScores(records).map((entry) => entry.record);
}
