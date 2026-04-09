import type { PriceRecord } from "@artbot/shared-types";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sourceReliabilityFromStatus(record: Pick<PriceRecord, "source_access_status">): number {
  switch (record.source_access_status) {
    case "public_access":
      return 0.75;
    case "licensed_access":
      return 0.82;
    case "price_hidden":
      return 0.52;
    case "auth_required":
      return 0.4;
    case "blocked":
      return 0.2;
    default:
      return 0.5;
  }
}

function deriveExtractionConfidence(record: PriceRecord): number {
  let score = 0.28;
  if (record.price_type !== "unknown") score += 0.18;
  if (record.price_amount !== null) score += 0.18;
  if (record.estimate_low !== null || record.estimate_high !== null) score += 0.12;
  if (record.currency) score += 0.1;
  if (record.sale_or_listing_date) score += 0.06;
  if (record.lot_number) score += 0.04;
  if (record.work_title) score += 0.04;
  return clamp01(score);
}

function deriveEntityMatchConfidence(record: PriceRecord): number {
  let score = 0.42;
  if (record.work_title) score += 0.16;
  if (record.year) score += 0.08;
  if (record.medium) score += 0.08;
  if (record.height_cm !== null || record.width_cm !== null || record.dimensions_text) score += 0.1;
  if (record.image_url) score += 0.06;
  return clamp01(score);
}

export function scoreRecord(record: PriceRecord): number {
  const extraction = clamp01(record.extraction_confidence);
  const entity = clamp01(record.entity_match_confidence);
  const sourceReliability = clamp01(record.source_reliability_confidence);

  let score = extraction * 0.5 + entity * 0.25 + sourceReliability * 0.25;
  if (!record.accepted_for_valuation) {
    score = Math.min(score, 0.62);
  }
  if (record.price_type === "unknown") {
    score = Math.min(score, 0.45);
  }

  return clamp01(score);
}

export function applyConfidenceModel(record: PriceRecord, fallbackOverallConfidence?: number): PriceRecord {
  const extractionConfidence =
    record.extraction_confidence > 0 ? clamp01(record.extraction_confidence) : deriveExtractionConfidence(record);
  const entityMatchConfidence =
    record.entity_match_confidence > 0 ? clamp01(record.entity_match_confidence) : deriveEntityMatchConfidence(record);
  const sourceReliabilityConfidence =
    record.source_reliability_confidence > 0
      ? clamp01(record.source_reliability_confidence)
      : sourceReliabilityFromStatus(record);

  const provisional: PriceRecord = {
    ...record,
    extraction_confidence: extractionConfidence,
    entity_match_confidence: entityMatchConfidence,
    source_reliability_confidence: sourceReliabilityConfidence
  };

  const modelScore = scoreRecord(provisional);
  const blended =
    fallbackOverallConfidence !== undefined && Number.isFinite(fallbackOverallConfidence)
      ? clamp01(modelScore * 0.72 + clamp01(fallbackOverallConfidence) * 0.28)
      : modelScore;

  return {
    ...provisional,
    valuation_confidence: provisional.accepted_for_valuation ? blended : 0,
    overall_confidence: blended
  };
}
