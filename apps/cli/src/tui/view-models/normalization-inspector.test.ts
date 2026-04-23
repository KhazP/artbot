import { describe, expect, it } from "vitest";
import { buildNormalizationInspectorModel } from "./normalization-inspector.js";

describe("buildNormalizationInspectorModel", () => {
  it("builds inspector entries from normalized records", () => {
    const model = buildNormalizationInspectorModel({
      run: { id: "run-1", status: "completed" },
      records: [
        {
          artist_name: "Abidin Dino",
          work_title: "Untitled",
          source_name: "Artam",
          price_type: "realized_price",
          price_amount: 5_500_000_000,
          currency: "TRL",
          original_amount_raw: "5500000000",
          original_currency_raw: "TRL",
          original_currency_canonical: "TRL_OLD",
          original_event_date: "2004-05-10",
          redenomination_applied: true,
          historical_price_try: 5500,
          historical_price_usd: 550,
          historical_price_eur: 275,
          normalized_price_usd_2026: 968,
          normalized_price_eur_2026: 484,
          inflation_base_year: 2026,
          current_price_try: 220000,
          current_price_usd: 5000,
          current_price_eur: 4600,
          current_price_as_of_date: "2026-04-23",
          normalization_confidence_score: 0.94,
          date_confidence: "exact",
          currency_interpretation_confidence: 0.99,
          normalization_requires_manual_review: false
        }
      ]
    });

    expect(model.totalRecords).toBe(1);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]?.interpretedLine).toContain("TRL_OLD");
    expect(model.entries[0]?.historicalLine).toContain("Hist");
    expect(model.entries[0]?.inflationLine).toContain("2026");
    expect(model.entries[0]?.currentLine).toContain("2026-04-23");
  });
});
