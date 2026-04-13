import type { PriceRecord } from "@artbot/shared-types";
import { dimensionsMatch } from "./dimensions.js";

function normalizeTitle(title: string | null): string {
  return (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTitle(title: string | null): string[] {
  return normalizeTitle(title)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function titleSimilarity(left: string | null, right: string | null): number {
  const leftTokens = tokenizeTitle(left);
  const rightTokens = tokenizeTitle(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizeUrlIdentity(url: string | null | undefined): string {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeImageIdentity(url: string | null | undefined): string {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const basename = pathname.split("/").filter(Boolean).pop() ?? "";
    return basename.replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeComparableDate(value: string | null | undefined): string {
  return (value ?? "").trim();
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
      const fuzzyTitleMatch = !titleMatch && titleSimilarity(existing.work_title, candidate.work_title) >= 0.75;

      const mediumMatch = (existing.medium ?? "").toLowerCase() === (candidate.medium ?? "").toLowerCase();
      const yearMatch = existing.year && candidate.year ? existing.year === candidate.year : false;
      const dimensionClose = dimensionsMatch(existing, candidate);
      const sameSaleDate =
        normalizeComparableDate(existing.sale_or_listing_date) !== ""
        && normalizeComparableDate(existing.sale_or_listing_date) === normalizeComparableDate(candidate.sale_or_listing_date);
      const sameVenueLot =
        (existing.venue_name ?? "").toLowerCase() === (candidate.venue_name ?? "").toLowerCase()
        && (existing.lot_number ?? "").trim() !== ""
        && (existing.lot_number ?? "").trim() === (candidate.lot_number ?? "").trim();
      const sameSourceUrl =
        normalizeUrlIdentity(existing.source_url) !== "" &&
        normalizeUrlIdentity(existing.source_url) === normalizeUrlIdentity(candidate.source_url);
      const sameImage =
        normalizeImageIdentity(existing.image_url) !== "" &&
        normalizeImageIdentity(existing.image_url) === normalizeImageIdentity(candidate.image_url);

      if (sameSourceUrl || sameImage) {
        return true;
      }

      return (titleMatch || fuzzyTitleMatch) && mediumMatch && (yearMatch || dimensionClose) && (sameSaleDate || sameVenueLot);
    });

    if (found) {
      duplicates.push(candidate);
    } else {
      unique.push(candidate);
    }
  }

  return { uniqueRecords: unique, duplicates };
}
