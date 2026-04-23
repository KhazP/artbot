import type { PriceRecord } from "@artbot/shared-types";

export interface ParsedNormalizationPrice {
  amount: number | null;
  rawAmount: string | null;
  rawCurrency: string | null;
  source: "price_amount" | "estimate_midpoint" | "missing";
}

export function parseNormalizationPrice(record: PriceRecord): ParsedNormalizationPrice {
  if (typeof record.price_amount === "number" && Number.isFinite(record.price_amount)) {
    return {
      amount: record.price_amount,
      rawAmount: record.price_amount.toString(),
      rawCurrency: record.currency ?? null,
      source: "price_amount"
    };
  }

  const low = record.estimate_low;
  const high = record.estimate_high;
  if (
    record.currency &&
    ((typeof low === "number" && Number.isFinite(low)) || (typeof high === "number" && Number.isFinite(high)))
  ) {
    const normalizedLow = low ?? high ?? null;
    const normalizedHigh = high ?? low ?? null;
    if (
      typeof normalizedLow === "number" &&
      Number.isFinite(normalizedLow) &&
      typeof normalizedHigh === "number" &&
      Number.isFinite(normalizedHigh)
    ) {
      return {
        amount: (normalizedLow + normalizedHigh) / 2,
        rawAmount: `${normalizedLow}-${normalizedHigh}`,
        rawCurrency: record.currency,
        source: "estimate_midpoint"
      };
    }
  }

  return {
    amount: null,
    rawAmount: null,
    rawCurrency: record.currency ?? null,
    source: "missing"
  };
}
