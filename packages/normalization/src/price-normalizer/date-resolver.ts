import type { NormalizationDateConfidence } from "@artbot/shared-types";
import type { PriceRecord } from "@artbot/shared-types";

export interface ResolvedNormalizationDate {
  eventDate: string | null;
  confidence: NormalizationDateConfidence;
  notes: string[];
  warnings: string[];
}

export function resolveNormalizationDate(record: PriceRecord): ResolvedNormalizationDate {
  const notes: string[] = [];
  const warnings: string[] = [];
  const rawDate = record.sale_or_listing_date?.trim();

  if (rawDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return {
        eventDate: rawDate,
        confidence: "exact",
        notes,
        warnings
      };
    }

    if (/^\d{4}-\d{2}$/.test(rawDate)) {
      notes.push("Used month-level sale/listing date midpoint for FX lookup.");
      return {
        eventDate: `${rawDate}-15`,
        confidence: "month",
        notes,
        warnings
      };
    }

    if (/^\d{4}$/.test(rawDate)) {
      notes.push("Used year-level sale/listing date midpoint for FX lookup.");
      return {
        eventDate: `${rawDate}-06-30`,
        confidence: "year",
        notes,
        warnings
      };
    }

    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      notes.push("Normalized a non-ISO sale/listing date for FX lookup.");
      return {
        eventDate: parsed.toISOString().slice(0, 10),
        confidence: "exact",
        notes,
        warnings
      };
    }
  }

  if (record.year && /^\d{4}$/.test(record.year)) {
    warnings.push("Used artwork year as a fallback event date; verify against the actual sale/listing date.");
    return {
      eventDate: `${record.year}-06-30`,
      confidence: "year",
      notes,
      warnings
    };
  }

  warnings.push("No usable event date was available for historical FX normalization.");
  return {
    eventDate: null,
    confidence: "unknown",
    notes,
    warnings
  };
}
