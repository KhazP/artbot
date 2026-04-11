import type { PriceRecord } from "@artbot/shared-types";
import type { FxRateProvider } from "./rates-cache.js";

interface PriceForConversion {
  amount: number;
  currency: string;
}

function toEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amount;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

function fromEur(amountEur: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amountEur;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return amountEur * rate;
}

function resolveConversionDate(record: PriceRecord): string | undefined {
  if (record.sale_or_listing_date && /^\d{4}-\d{2}-\d{2}$/.test(record.sale_or_listing_date)) {
    return record.sale_or_listing_date;
  }
  if (record.sale_or_listing_date) {
    const parsed = new Date(record.sale_or_listing_date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  if (record.year && /^\d{4}$/.test(record.year)) {
    return `${record.year}-06-30`;
  }
  return undefined;
}

function sourcePrice(record: PriceRecord): PriceForConversion | null {
  if (record.currency && typeof record.price_amount === "number" && Number.isFinite(record.price_amount)) {
    return {
      amount: record.price_amount,
      currency: record.currency
    };
  }

  if (
    record.currency &&
    ((typeof record.estimate_low === "number" && Number.isFinite(record.estimate_low)) ||
      (typeof record.estimate_high === "number" && Number.isFinite(record.estimate_high)))
  ) {
    const low = record.estimate_low ?? record.estimate_high ?? null;
    const high = record.estimate_high ?? record.estimate_low ?? null;
    if (typeof low === "number" && Number.isFinite(low) && typeof high === "number" && Number.isFinite(high)) {
      return {
        amount: (low + high) / 2,
        currency: record.currency
      };
    }
  }

  return null;
}

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

export async function normalizeRecordCurrencies(record: PriceRecord, provider: FxRateProvider): Promise<PriceRecord> {
  const price = sourcePrice(record);
  if (!price) {
    return record;
  }

  const conversionDate = resolveConversionDate(record);
  const rateTable = await provider.getRates(conversionDate);
  const amountEur = toEur(price.amount, price.currency, rateTable.rates);
  if (amountEur === null) {
    return record;
  }

  const normalizedTry = fromEur(amountEur, "TRY", rateTable.rates);
  const normalizedUsd = fromEur(amountEur, "USD", rateTable.rates);
  const inflation = provider.getInflationTable();
  const fromYear = yearFromDate(rateTable.date || conversionDate);
  const usd2026 =
    typeof normalizedUsd === "number" && Number.isFinite(normalizedUsd)
      ? inflationAdjustedUsd(normalizedUsd, fromYear, inflation.cpiByYear, inflation.baseYear)
      : null;

  return {
    ...record,
    normalized_price_try: normalizedTry,
    normalized_price_usd: normalizedUsd,
    normalized_price_usd_nominal: normalizedUsd,
    normalized_price_usd_2026: usd2026,
    fx_source: rateTable.source,
    fx_date_used: rateTable.date,
    inflation_source: inflation.source,
    inflation_base_year: inflation.baseYear
  };
}
