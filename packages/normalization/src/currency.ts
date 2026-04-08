import type { PriceRecord } from "@artbot/shared-types";
import type { FxRateProvider } from "./rates-cache.js";

function toEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amount;
  const rate = rates[currency];
  if (!rate) return null;
  return amount / rate;
}

function fromEur(amountEur: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amountEur;
  const rate = rates[currency];
  if (!rate) return null;
  return amountEur * rate;
}

export function normalizeRecordCurrencies(record: PriceRecord, provider: FxRateProvider): PriceRecord {
  if (!record.price_amount || !record.currency) {
    return record;
  }

  const rates = provider.getRates(record.sale_or_listing_date ?? undefined).rates;
  const amountEur = toEur(record.price_amount, record.currency, rates);
  if (amountEur === null) {
    return record;
  }

  return {
    ...record,
    normalized_price_try: fromEur(amountEur, "TRY", rates),
    normalized_price_usd: fromEur(amountEur, "USD", rates)
  };
}
