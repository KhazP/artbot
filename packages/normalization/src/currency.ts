import type { PriceRecord } from "@artbot/shared-types";
import type { FxRateProvider } from "./rates-cache.js";
import { normalizePriceEnvelope } from "./price-normalizer/index.js";

function yearFromDate(dateValue?: string): number | null {
  if (!dateValue) return null;
  const match = dateValue.match(/^(\d{4})/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function inflationAdjustedUsd(
  nominalUsd: number,
  fromYear: number | null,
  cpiByYear: Record<number, number>,
  baseYear: number
): number | null {
  if (fromYear === null) return null;
  const fromCpi = cpiByYear[fromYear];
  const baseCpi = cpiByYear[baseYear];
  if (!fromCpi || !baseCpi || fromCpi <= 0 || baseCpi <= 0) {
    return null;
  }
  return nominalUsd * (baseCpi / fromCpi);
}

function inflationAdjustedEur(
  adjustedUsd: number | null,
  baseYearUsdPerEur: number | null
): number | null {
  if (adjustedUsd === null || baseYearUsdPerEur === null || !Number.isFinite(baseYearUsdPerEur) || baseYearUsdPerEur <= 0) {
    return null;
  }

  return adjustedUsd / baseYearUsdPerEur;
}

export async function normalizeRecordCurrencies(record: PriceRecord, provider: FxRateProvider): Promise<PriceRecord> {
  const envelope = await normalizePriceEnvelope(record, provider);
  if (!envelope) {
    return record;
  }

  const inflation = provider.getInflationTable();
  const fromYear = yearFromDate(envelope.original_event_date ?? undefined);
  const baseYearRates = await provider.getRates(`${inflation.baseYear}-06-30`);
  const usd2026 =
    typeof envelope.historical_price_usd === "number" && Number.isFinite(envelope.historical_price_usd)
      ? inflationAdjustedUsd(envelope.historical_price_usd, fromYear, inflation.cpiByYear, inflation.baseYear)
      : null;
  const eur2026 = inflationAdjustedEur(usd2026, baseYearRates.rates.USD ?? null);

  return {
    ...record,
    normalized_price_try: envelope.historical_price_try,
    normalized_price_usd: envelope.historical_price_usd,
    normalized_price_eur: envelope.historical_price_eur,
    normalized_price_usd_nominal: envelope.historical_price_usd,
    normalized_price_eur_nominal: envelope.historical_price_eur,
    normalized_price_usd_2026: usd2026,
    normalized_price_eur_2026: eur2026,
    fx_source: envelope.historical_fx_source,
    fx_date_used: envelope.original_event_date,
    inflation_source: `${inflation.source}+base_year_fx`,
    inflation_base_year: inflation.baseYear,
    original_amount_raw: envelope.original_amount_raw,
    original_currency_raw: envelope.original_currency_raw,
    original_currency_canonical: envelope.original_currency_canonical,
    original_event_date: envelope.original_event_date,
    date_confidence: envelope.date_confidence,
    currency_interpretation_confidence: envelope.currency_interpretation_confidence,
    redenomination_applied: envelope.redenomination_applied,
    redenomination_factor: envelope.redenomination_factor,
    historical_price_try: envelope.historical_price_try,
    historical_price_usd: envelope.historical_price_usd,
    historical_price_eur: envelope.historical_price_eur,
    current_price_try: envelope.current_price_try,
    current_price_usd: envelope.current_price_usd,
    current_price_eur: envelope.current_price_eur,
    current_price_as_of_date: envelope.current_price_as_of_date,
    normalization_notes: envelope.normalization_notes,
    normalization_warnings: envelope.normalization_warnings,
    normalization_confidence_score: envelope.normalization_confidence_score,
    normalization_confidence_reasons: envelope.normalization_confidence_reasons,
    normalization_requires_manual_review: envelope.normalization_requires_manual_review
  };
}
