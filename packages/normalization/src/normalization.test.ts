import { describe, expect, it } from "vitest";
import type { PriceRecord } from "@artbot/shared-types";
import { dedupeRecords } from "./dedupe.js";
import { normalizeRecordCurrencies } from "./currency.js";
import { FxRateProvider } from "./rates-cache.js";

function baseRecord(overrides: Partial<PriceRecord> = {}): PriceRecord {
  return {
    artist_name: "Test Artist",
    work_title: "Blue Work",
    alternate_title: null,
    year: "1990",
    medium: "oil on canvas",
    support: null,
    dimensions_text: null,
    height_cm: 100,
    width_cm: 80,
    depth_cm: null,
    signed: null,
    dated: null,
    edition_info: null,
    is_unique_work: true,
    venue_name: "Venue",
    venue_type: "auction_house",
    city: null,
    country: "Turkey",
    source_name: "Source",
    source_url: "https://example.com/lot",
    source_page_type: "lot",
    sale_or_listing_date: "2026-04-08",
    lot_number: "10",
    price_type: "realized_price",
    estimate_low: null,
    estimate_high: null,
    price_amount: 100000,
    currency: "TRY",
    normalized_price_try: null,
    normalized_price_usd: null,
    buyers_premium_included: null,
    image_url: null,
    screenshot_path: null,
    raw_snapshot_path: null,
    visual_match_score: null,
    metadata_match_score: null,
    extraction_confidence: 0.8,
    entity_match_confidence: 0.75,
    source_reliability_confidence: 0.7,
    valuation_confidence: 0.8,
    overall_confidence: 0.8,
    accepted_for_evidence: true,
    accepted_for_valuation: true,
    valuation_lane: "realized",
    acceptance_reason: "valuation_ready",
    rejection_reason: null,
    valuation_eligibility_reason: null,
    price_hidden: false,
    source_access_status: "public_access",
    notes: [],
    ...overrides
  };
}

describe("normalization", () => {
  it("normalizes TRY to USD", () => {
    const provider = new FxRateProvider();
    const normalized = normalizeRecordCurrencies(baseRecord(), provider);

    expect(normalized.normalized_price_try).toBeCloseTo(100000, 0);
    expect(normalized.normalized_price_usd).toBeGreaterThan(2000);
  });

  it("dedupes strongly matching records", () => {
    const a = baseRecord();
    const b = baseRecord({ source_url: "https://example.com/lot-duplicate", lot_number: "11" });

    const result = dedupeRecords([a, b]);
    expect(result.uniqueRecords).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("keeps separate works with medium mismatch", () => {
    const a = baseRecord({ medium: "oil on canvas" });
    const b = baseRecord({ medium: "acrylic on canvas", source_url: "https://example.com/other" });

    const result = dedupeRecords([a, b]);
    expect(result.uniqueRecords).toHaveLength(2);
  });
});
