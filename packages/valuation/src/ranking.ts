import type { PriceRecord } from "@artbot/shared-types";

export interface ComparableTarget {
  title?: string;
  medium?: string;
  year?: string;
  dimensions?: {
    heightCm?: number;
    widthCm?: number;
  };
}

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

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(" ").filter(Boolean));
  const setB = new Set(normB.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function parseYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\b((?:18|19|20)\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function yearSimilarity(recordYear: string | null | undefined, targetYear: string | null | undefined): number {
  const a = parseYear(recordYear);
  const b = parseYear(targetYear);
  if (a === null || b === null) return 0;
  const diff = Math.abs(a - b);
  if (diff === 0) return 1;
  if (diff <= 2) return 0.85;
  if (diff <= 5) return 0.6;
  if (diff <= 10) return 0.35;
  return 0.1;
}

function parseDimensionsFromText(dimensionsText: string | null | undefined): { h: number; w: number } | null {
  if (!dimensionsText) return null;
  const values = dimensionsText
    .replace(/[,]/g, ".")
    .match(/\d+(?:\.\d+)?/g)
    ?.map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  if (!values || values.length < 2) return null;
  return { h: values[0] as number, w: values[1] as number };
}

function dimensionSimilarity(record: PriceRecord, target?: ComparableTarget["dimensions"]): number {
  if (!target?.heightCm || !target.widthCm) return 0;
  const recordH = record.height_cm ?? parseDimensionsFromText(record.dimensions_text)?.h;
  const recordW = record.width_cm ?? parseDimensionsFromText(record.dimensions_text)?.w;
  if (!recordH || !recordW) return 0;

  const hd = Math.abs(recordH - target.heightCm) / Math.max(recordH, target.heightCm);
  const wd = Math.abs(recordW - target.widthCm) / Math.max(recordW, target.widthCm);
  const avg = (hd + wd) / 2;
  if (avg <= 0.03) return 1;
  if (avg <= 0.08) return 0.82;
  if (avg <= 0.15) return 0.55;
  if (avg <= 0.25) return 0.3;
  return 0.08;
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
    titleSimilarityBoost: number;
    mediumSimilarityBoost: number;
    yearSimilarityBoost: number;
    dimensionSimilarityBoost: number;
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
  if (components.titleSimilarityBoost > 0.09) reasons.push("strong title similarity");
  if (components.mediumSimilarityBoost > 0.04) reasons.push("medium similarity");
  if (components.yearSimilarityBoost > 0.03) reasons.push("year proximity");
  if (components.dimensionSimilarityBoost > 0.03) reasons.push("dimension proximity");
  if (record.entity_match_confidence < 0.55) reasons.push("weak entity match");
  if (record.extraction_confidence < 0.55) reasons.push("low extraction completeness");
  return reasons;
}

export function scoreComparable(record: PriceRecord, target?: ComparableTarget): ComparableScoreBreakdown {
  const countryBoost = record.country === "Turkey" ? 0.12 : 0;
  const valuationEligibilityBoost = record.accepted_for_valuation ? 0.2 : -0.15;
  const laneBoost = laneWeight(record);
  const recencyBoost = recencyWeight(record);
  const titleSimilarityBoost = target?.title ? tokenSimilarity(record.work_title, target.title) * 0.14 : 0;
  const mediumSimilarityBoost = target?.medium ? tokenSimilarity(record.medium, target.medium) * 0.08 : 0;
  const yearSimilarityBoost = target?.year ? yearSimilarity(record.year, target.year) * 0.06 : 0;
  const dimensionSimilarityBoost = target?.dimensions ? dimensionSimilarity(record, target.dimensions) * 0.07 : 0;

  const score =
    record.overall_confidence * 0.45 +
    record.extraction_confidence * 0.2 +
    record.entity_match_confidence * 0.15 +
    record.source_reliability_confidence * 0.2 +
    countryBoost +
    laneBoost +
    recencyBoost +
    valuationEligibilityBoost +
    titleSimilarityBoost +
    mediumSimilarityBoost +
    yearSimilarityBoost +
    dimensionSimilarityBoost;

  const modelComponents: ComparableScoreBreakdown["modelComponents"] = {
    overallConfidence: record.overall_confidence * 0.45,
    extractionConfidence: record.extraction_confidence * 0.2,
    entityMatchConfidence: record.entity_match_confidence * 0.15,
    sourceReliabilityConfidence: record.source_reliability_confidence * 0.2,
    countryBoost,
    laneBoost,
    recencyBoost,
    valuationEligibilityBoost,
    titleSimilarityBoost,
    mediumSimilarityBoost,
    yearSimilarityBoost,
    dimensionSimilarityBoost
  };

  return {
    score,
    modelComponents,
    reasons: buildReasons(record, modelComponents)
  };
}

export function rankComparablesWithScores(records: PriceRecord[], target?: ComparableTarget): ScoredComparable[] {
  return [...records]
    .map((record) => ({
      record,
      breakdown: scoreComparable(record, target)
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
