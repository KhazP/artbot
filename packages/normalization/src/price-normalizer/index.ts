import type { PriceRecord } from "@artbot/shared-types";
import type { FxRateProvider } from "../rates-cache.js";
import { convertCanonicalAmount } from "./fx-converter.js";
import { parseNormalizationPrice } from "./parser.js";
import { resolveNormalizationDate } from "./date-resolver.js";
import { resolveTurkishLiraEra } from "./trl-try-rules.js";
import { summarizeNormalizationConfidence } from "./uncertainty.js";

export interface NormalizedPriceEnvelope {
  original_amount_raw: string | null;
  original_currency_raw: string | null;
  original_currency_canonical: PriceRecord["original_currency_canonical"];
  original_event_date: string | null;
  date_confidence: PriceRecord["date_confidence"];
  currency_interpretation_confidence: number;
  redenomination_applied: boolean;
  redenomination_factor: number | null;
  historical_price_try: number | null;
  historical_price_usd: number | null;
  historical_price_eur: number | null;
  historical_fx_source: string | null;
  current_price_try: number | null;
  current_price_usd: number | null;
  current_price_eur: number | null;
  current_price_as_of_date: string | null;
  current_fx_source: string | null;
  normalization_notes: string[];
  normalization_warnings: string[];
  normalization_confidence_score: number;
  normalization_confidence_reasons: string[];
  normalization_requires_manual_review: boolean;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function normalizePriceEnvelope(record: PriceRecord, provider: FxRateProvider): Promise<NormalizedPriceEnvelope | null> {
  const parsed = parseNormalizationPrice(record);
  if (parsed.amount === null || !parsed.rawCurrency) {
    return null;
  }

  const resolvedDate = resolveNormalizationDate(record);
  const interpreted = resolveTurkishLiraEra({
    amount: parsed.amount,
    rawCurrency: parsed.rawCurrency,
    rawText: parsed.rawAmount,
    eventDate: resolvedDate.eventDate
  });

  const today = todayIsoDate();
  const historicalRates = resolvedDate.eventDate ? await provider.getRates(resolvedDate.eventDate) : null;
  const currentRates = await provider.getRates(today);
  const historical = historicalRates
    ? convertCanonicalAmount(interpreted.canonicalAmount, interpreted.canonicalCurrency, historicalRates.rates)
    : { try: null, usd: null, eur: null };
  const current = convertCanonicalAmount(interpreted.canonicalAmount, interpreted.canonicalCurrency, currentRates.rates);
  const confidence = summarizeNormalizationConfidence({
    currencyConfidence: interpreted.confidence,
    dateConfidence: resolvedDate.confidence,
    warnings: [...resolvedDate.warnings, ...interpreted.warnings],
    notes: [...resolvedDate.notes, ...interpreted.notes],
    hasHistoricalValues: Object.values(historical).some((value) => typeof value === "number" && Number.isFinite(value))
  });

  return {
    original_amount_raw: parsed.rawAmount,
    original_currency_raw: parsed.rawCurrency,
    original_currency_canonical: interpreted.canonicalCurrency,
    original_event_date: resolvedDate.eventDate,
    date_confidence: resolvedDate.confidence,
    currency_interpretation_confidence: interpreted.confidence,
    redenomination_applied: interpreted.redenominationApplied,
    redenomination_factor: interpreted.redenominationFactor,
    historical_price_try: historical.try,
    historical_price_usd: historical.usd,
    historical_price_eur: historical.eur,
    historical_fx_source: historicalRates?.source ?? null,
    current_price_try: current.try,
    current_price_usd: current.usd,
    current_price_eur: current.eur,
    current_price_as_of_date: currentRates.date ?? today,
    current_fx_source: currentRates.source ?? null,
    normalization_notes: [...resolvedDate.notes, ...interpreted.notes],
    normalization_warnings: [...resolvedDate.warnings, ...interpreted.warnings],
    normalization_confidence_score: confidence.score,
    normalization_confidence_reasons: [...interpreted.reasons, ...confidence.reasons],
    normalization_requires_manual_review: confidence.requiresManualReview
  };
}

export * from "./date-resolver.js";
export * from "./fx-converter.js";
export * from "./parser.js";
export * from "./trl-try-rules.js";
export * from "./uncertainty.js";
