import type { PriceRecord } from "@artbot/shared-types";
import { dimensionsMatch } from "./dimensions.js";

function normalizeTitle(title: string | null): string {
  return (title ?? "").toLowerCase().replace(/[^a-z0-9çğıöşü\s]/gi, "").replace(/\s+/g, " ").trim();
}

export interface DedupeResult {
  uniqueRecords: PriceRecord[];
  duplicates: PriceRecord[];
}

export function dedupeRecords(records: PriceRecord[]): DedupeResult {
  const unique: PriceRecord[] = [];
  const duplicates: PriceRecord[] = [];

  for (const candidate of records) {
    const found = unique.find((existing) => {
      if (existing.artist_name.toLowerCase() !== candidate.artist_name.toLowerCase()) {
        return false;
      }

      const titleA = normalizeTitle(existing.work_title);
      const titleB = normalizeTitle(candidate.work_title);
      const titleMatch = titleA && titleB ? titleA === titleB : false;

      const mediumMatch = (existing.medium ?? "").toLowerCase() === (candidate.medium ?? "").toLowerCase();
      const yearMatch = existing.year && candidate.year ? existing.year === candidate.year : false;
      const dimensionClose = dimensionsMatch(existing, candidate);

      return titleMatch && mediumMatch && (yearMatch || dimensionClose);
    });

    if (found) {
      duplicates.push(candidate);
    } else {
      unique.push(candidate);
    }
  }

  return { uniqueRecords: unique, duplicates };
}
