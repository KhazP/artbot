import { describe, expect, it } from "vitest";
import { renderMarketReport, type ReportData } from "./report.js";

function buildReportData(): ReportData {
  return {
    artistName: "Bedri Baykam",
    runId: "run-123",
    summary: {
      accepted_records: 1,
      valuation_generated: true,
      total_records: 2,
      total_attempts: 2,
      evidence_records: 1,
      valuation_eligible_records: 1,
      rejected_candidates: 1,
      discovered_candidates: 1,
      accepted_from_discovery: 1,
      priced_source_coverage_ratio: 0.5,
      priced_crawled_source_coverage_ratio: 0.5,
      source_candidate_breakdown: {
        "Bonhams": 1,
        "Bayrak Muzayede Listing": 1
      },
      source_status_breakdown: {
        public_access: 2,
        auth_required: 0,
        licensed_access: 0,
        blocked: 0,
        price_hidden: 0
      },
      acceptance_reason_breakdown: {
        valuation_ready: 1,
        estimate_range_ready: 0,
        asking_price_ready: 0,
        inquiry_only_evidence: 0,
        price_hidden_evidence: 0,
        generic_shell_page: 1,
        missing_numeric_price: 0,
        missing_currency: 0,
        missing_estimate_range: 0,
        unknown_price_type: 0,
        blocked_access: 0
      },
      valuation_reason: "ok"
    },
    valuation: {
      generated: true,
      blendedRange: { low: 0, high: 1000 },
      topComparables: [
        {
          sourceName: "Bonhams",
          workTitle: "Bonhams : Search",
          nativePrice: 0,
          normalizedPriceTry: 0,
          currency: "USD",
          valuationLane: "realized",
          score: 0.8
        }
      ]
    },
    records: [
      {
        artist_name: "Bedri Baykam",
        work_title: "Bonhams : Search",
        source_name: "Bonhams",
        price_type: "hammer_price",
        price_amount: 0,
        currency: "USD",
        normalized_price_usd_nominal: 0,
        normalized_price_usd_2026: 0,
        source_access_status: "public_access"
      }
    ],
    duplicates: [
      {
        artist_name: "Bedri Baykam",
        work_title: "Bonhams : Search",
        source_name: "Bonhams",
        price_type: "hammer_price",
        price_amount: 0,
        currency: "USD",
        normalized_price_usd_nominal: 0,
        normalized_price_usd_2026: 0,
        source_access_status: "public_access"
      }
    ]
  };
}

describe("renderMarketReport", () => {
  it("renders zero-value prices as real prices and keeps unique count aligned to normalized records", () => {
    const output = renderMarketReport(buildReportData());

    expect(output).toContain("$0");
    expect(output).toContain("1 unique records (2 total incl. duplicates)");
  });

  it("prioritizes valuation ahead of the broader market overview", () => {
    const output = renderMarketReport(buildReportData());

    expect(output.indexOf("VALUATION")).toBeGreaterThan(-1);
    expect(output.indexOf("MARKET OVERVIEW")).toBeGreaterThan(-1);
    expect(output.indexOf("VALUATION")).toBeLessThan(output.indexOf("MARKET OVERVIEW"));
  });
});
