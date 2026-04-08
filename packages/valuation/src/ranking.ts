import type { PriceRecord } from "@artbot/shared-types";

function basePrice(record: PriceRecord): number | null {
  return record.normalized_price_try ?? record.price_amount;
}

export function rankComparables(records: PriceRecord[]): PriceRecord[] {
  return [...records].sort((a, b) => {
    const scoreA = (a.overall_confidence ?? 0) + (a.country === "Turkey" ? 0.15 : 0);
    const scoreB = (b.overall_confidence ?? 0) + (b.country === "Turkey" ? 0.15 : 0);

    if (scoreA !== scoreB) return scoreB - scoreA;

    const priceA = basePrice(a) ?? 0;
    const priceB = basePrice(b) ?? 0;
    return priceB - priceA;
  });
}
