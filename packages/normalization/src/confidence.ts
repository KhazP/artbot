import type { PriceRecord } from "@artbot/shared-types";

export function scoreRecord(record: PriceRecord): number {
  let score = 0.3;

  if (record.price_type !== "unknown") score += 0.2;
  if (record.price_amount !== null) score += 0.2;
  if (record.currency) score += 0.1;
  if (record.sale_or_listing_date) score += 0.05;
  if (record.lot_number) score += 0.05;
  if (record.work_title) score += 0.05;
  if (record.screenshot_path) score += 0.05;

  return Math.min(1, score);
}
