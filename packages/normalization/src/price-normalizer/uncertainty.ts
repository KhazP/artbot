import type { NormalizationDateConfidence } from "@artbot/shared-types";

export interface NormalizationUncertaintyInput {
  currencyConfidence: number;
  dateConfidence: NormalizationDateConfidence;
  warnings: string[];
  notes: string[];
  hasHistoricalValues: boolean;
}

export interface NormalizationConfidenceSummary {
  score: number;
  reasons: string[];
  requiresManualReview: boolean;
}

const DATE_CONFIDENCE_SCORES: Record<NormalizationDateConfidence, number> = {
  exact: 1,
  month: 0.82,
  year: 0.62,
  unknown: 0.2
};

export function summarizeNormalizationConfidence(
  input: NormalizationUncertaintyInput
): NormalizationConfidenceSummary {
  const reasons = [...input.notes, ...input.warnings];
  if (!input.hasHistoricalValues) {
    reasons.push("Historical FX outputs could not be computed.");
  }

  const score = Math.max(
    0,
    Math.min(
      1,
      input.currencyConfidence * 0.6 + DATE_CONFIDENCE_SCORES[input.dateConfidence] * 0.4 - input.warnings.length * 0.05
    )
  );

  return {
    score,
    reasons,
    requiresManualReview:
      input.dateConfidence === "unknown"
      || input.currencyConfidence < 0.75
      || input.warnings.length > 0
      || !input.hasHistoricalValues
  };
}
