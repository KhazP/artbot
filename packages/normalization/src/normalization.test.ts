import { describe, expect, it, vi } from "vitest";
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
  it("normalizes TRY to USD", async () => {
    const provider = new FxRateProvider();
    const normalized = await normalizeRecordCurrencies(baseRecord(), provider);

    expect(normalized.normalized_price_try).toBeCloseTo(100000, 0);
    expect(normalized.normalized_price_usd).toBeGreaterThan(2000);
    expect(normalized.normalized_price_usd_nominal).toBeGreaterThan(2000);
    expect(normalized.inflation_base_year).toBe(2026);
    expect(normalized.original_currency_canonical).toBe("TRY_NEW");
    expect(normalized.historical_price_try).toBeCloseTo(normalized.normalized_price_try ?? 0, 6);
    expect(normalized.current_price_usd).not.toBeNull();
  });

  it("redenominates old Turkish lira inputs before conversion", async () => {
    const provider = {
      getRates: vi.fn().mockImplementation(async (forDate?: string) => ({
        base: "EUR",
        date: forDate ?? "2026-04-23",
        rates: {
          EUR: 1,
          USD: 2,
          TRY: 20,
          GBP: 0.8
        },
        source: "static_fallback" as const
      })),
      getInflationTable: vi.fn().mockReturnValue({
        source: "us_cpi_static" as const,
        baseYear: 2026,
        cpiByYear: {
          2004: 188.9,
          2026: 331.0
        }
      })
    } as unknown as FxRateProvider;

    const normalized = await normalizeRecordCurrencies(
      baseRecord({
        sale_or_listing_date: "2004-05-10",
        price_amount: 5_500_000_000,
        currency: "TRL"
      }),
      provider
    );

    expect(normalized.original_currency_canonical).toBe("TRL_OLD");
    expect(normalized.redenomination_applied).toBe(true);
    expect(normalized.redenomination_factor).toBeCloseTo(0.000001, 8);
    expect(normalized.historical_price_try).toBeCloseTo(5500, 6);
    expect(normalized.historical_price_usd).toBeCloseTo(550, 6);
    expect(normalized.normalization_requires_manual_review).toBe(false);
  });

  it("flags plain TL in the transition window for manual review", async () => {
    const provider = {
      getRates: vi.fn().mockResolvedValue({
        base: "EUR",
        date: "2006-03-20",
        rates: {
          EUR: 1,
          USD: 1.25,
          TRY: 2.5,
          GBP: 0.8
        },
        source: "static_fallback" as const
      }),
      getInflationTable: vi.fn().mockReturnValue({
        source: "us_cpi_static" as const,
        baseYear: 2026,
        cpiByYear: {
          2006: 201.6,
          2026: 331.0
        }
      })
    } as unknown as FxRateProvider;

    const normalized = await normalizeRecordCurrencies(
      baseRecord({
        sale_or_listing_date: "2006-03-20",
        price_amount: 5500,
        currency: "TL"
      }),
      provider
    );

    expect(normalized.original_currency_canonical).toBe("TRY_NEW");
    expect(normalized.redenomination_applied).toBe(false);
    expect(normalized.normalization_requires_manual_review).toBe(true);
    expect(normalized.normalization_warnings).toContain(
      "Plain TL during the 2005-2008 transition window is ambiguous; review manually if material."
    );
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

  it("dedupes near-identical titles when image identity matches", () => {
    const a = baseRecord({
      work_title: "Abidin Dino Blue Composition",
      image_url: "https://cdn.example.com/images/abidin-dino-blue-composition.jpg"
    });
    const b = baseRecord({
      work_title: "Abidin Dino Composition in Blue",
      source_url: "https://other.example.com/lot/123",
      image_url: "https://media.example.org/archive/abidin-dino-blue-composition.png"
    });

    const result = dedupeRecords([a, b]);
    expect(result.uniqueRecords).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("dedupes fuzzy title matches when dimensions align", () => {
    const a = baseRecord({ work_title: "Blue Composition", source_url: "https://example.com/lot-a" });
    const b = baseRecord({
      work_title: "Composition Blue",
      source_url: "https://example.com/lot-b",
      lot_number: "12"
    });

    const result = dedupeRecords([a, b]);
    expect(result.uniqueRecords).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("keeps repeated same-title works when sale dates differ", () => {
    const a = baseRecord({
      work_title: "Eller Serisinden",
      source_url: "https://sanatfiyat.com/artist/artwork-detail/139254/eller-serisinden",
      sale_or_listing_date: "2024-08-18",
      lot_number: null,
      venue_name: "Sanatfiyat",
      price_amount: 18000
    });
    const b = baseRecord({
      work_title: "Eller Serisinden",
      source_url: "https://sanatfiyat.com/artist/artwork-detail/138871/eller-serisinden",
      sale_or_listing_date: "2024-09-15",
      lot_number: null,
      venue_name: "Sanatfiyat",
      price_amount: 20000
    });

    const result = dedupeRecords([a, b]);
    expect(result.uniqueRecords).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
  });
});
