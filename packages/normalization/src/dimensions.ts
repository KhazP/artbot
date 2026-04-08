import type { PriceRecord } from "@artbot/shared-types";

export function dimensionsMatch(a: PriceRecord, b: PriceRecord, toleranceRatio = 0.03): boolean {
  if (!a.height_cm || !a.width_cm || !b.height_cm || !b.width_cm) {
    return false;
  }

  const heightDiff = Math.abs(a.height_cm - b.height_cm) / Math.max(a.height_cm, b.height_cm);
  const widthDiff = Math.abs(a.width_cm - b.width_cm) / Math.max(a.width_cm, b.width_cm);

  return heightDiff <= toleranceRatio && widthDiff <= toleranceRatio;
}
