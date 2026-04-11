import { describe, expect, it } from "vitest";
import type { PriceRecord } from "@artbot/shared-types";
import { rankComparablesWithScores } from "./ranking.js";

function record(overrides: Partial<PriceRecord>): PriceRecord {
  return {
    artist_name: "Burhan Dogancay",
    work_title: "Mavi Kompozisyon",
    alternate_title: null,
    year: "1995",
    medium: "Oil on canvas",
    support: null,
    dimensions_text: "100 x 80 cm",
    height_cm: 100,
    width_cm: 80,
    depth_cm: null,
    signed: null,
    dated: null,
    edition_info: null,
    is_unique_work: null,
    venue_name: "Venue",
    venue_type: "auction_house",
    city: "Istanbul",
    country: "Turkey",
    source_name: "Source",
    source_url: "https://example.com/lot/1",
    source_page_type: "lot",
    sale_or_listing_date: "2025-01-10",
    lot_number: "1",
    price_type: "realized_price",
    estimate_low: null,
    estimate_high: null,
    price_amount: 250000,
    currency: "TRY",
    normalized_price_try: 250000,
    normalized_price_usd: null,
    normalized_price_usd_nominal: null,
    normalized_price_usd_2026: null,
    fx_source: null,
    fx_date_used: null,
    inflation_source: null,
    inflation_base_year: null,
    buyers_premium_included: null,
    image_url: null,
    screenshot_path: null,
    raw_snapshot_path: null,
    visual_match_score: null,
    metadata_match_score: null,
    extraction_confidence: 0.8,
    entity_match_confidence: 0.8,
    source_reliability_confidence: 0.8,
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

describe("rankComparablesWithScores", () => {
  it("prioritizes title/medium/year/dimension similarity when a target is provided", () => {
    const highSimilarity = record({
      source_name: "High Similarity",
      source_url: "https://example.com/high",
      work_title: "Mavi Kompozisyon",
      medium: "Oil on canvas",
      year: "1995",
      dimensions_text: "100 x 80 cm"
    });
    const lowSimilarity = record({
      source_name: "Low Similarity",
      source_url: "https://example.com/low",
      work_title: "Kirmizi Duvar",
      medium: "Acrylic on paper",
      year: "1972",
      dimensions_text: "230 x 180 cm"
    });

    const ranked = rankComparablesWithScores([lowSimilarity, highSimilarity], {
      title: "Mavi Kompozisyon",
      medium: "Oil on canvas",
      year: "1995",
      dimensions: { heightCm: 100, widthCm: 80 }
    });

    expect(ranked[0]?.record.source_name).toBe("High Similarity");
    expect(ranked[0]?.breakdown.modelComponents.titleSimilarityBoost).toBeGreaterThan(
      ranked[1]?.breakdown.modelComponents.titleSimilarityBoost ?? 0
    );
  });

  it("keeps deterministic ordering by score then price", () => {
    const lowPrice = record({
      source_name: "Low Price",
      source_url: "https://example.com/low-price",
      normalized_price_try: 100000
    });
    const highPrice = record({
      source_name: "High Price",
      source_url: "https://example.com/high-price",
      normalized_price_try: 300000
    });

    const ranked = rankComparablesWithScores([lowPrice, highPrice]);
    expect(ranked[0]?.record.source_name).toBe("High Price");
  });
});
