import { describe, expect, it } from "vitest";
import { buildResearchRunSpec, normalizeResearchRunReport, renderResearchRunHtml } from "./index.js";

describe("browser report normalization", () => {
  it("normalizes the external report payload", () => {
    const normalized = normalizeResearchRunReport({
      runId: "run-ext-1",
      artist: "Bedri Baykam",
      status: "completed",
      analysisMode: "fast",
      metrics: {
        accepted: 2,
        rejected: 43,
        discoveredCandidates: 33,
        acceptedFromDiscovery: 3,
        pricedCoverageCrawled: 0.1,
        pricedCoverageAttempted: 0.08
      },
      valuation: {
        generated: false,
        reason: "Insufficient valuation-eligible comparables (1/5)."
      },
      sourceHealth: {
        public_access: 39,
        auth_required: 2,
        blocked: 8
      },
      inventory: [
        {
          id: "rec_1",
          work_title: "Hemen Al | Clar Müzayede",
          venue_name: "Clar Müzayede",
          source_url: "https://example.com",
          price_type: "asking_price",
          price_amount: 20000,
          currency: "TRY",
          normalized_price_usd: 489.66,
          image_url: "https://example.com/work.jpg",
          valuation_confidence: 0.76,
          accepted_for_valuation: true,
          acceptance_reason: "asking_price_ready"
        }
      ]
    });

    expect(normalized.artist).toBe("Bedri Baykam");
    expect(normalized.metrics.accepted).toBe(2);
    expect(normalized.sourceHealth.public_access).toBe(39);
    expect(normalized.records[0]?.priceLabel).toContain("$");
  });

  it("normalizes the stored run payload", () => {
    const normalized = normalizeResearchRunReport({
      run: {
        id: "run-123",
        runType: "artist",
        status: "completed",
        createdAt: "2026-04-12T10:00:00.000Z",
        query: {
          artist: "Bedri Baykam",
          analysisMode: "balanced"
        }
      },
      summary: {
        accepted_records: 1,
        rejected_candidates: 3,
        discovered_candidates: 2,
        accepted_from_discovery: 1,
        total_attempts: 4,
        total_records: 1,
        valuation_eligible_records: 1,
        priced_source_coverage_ratio: 0.25,
        priced_crawled_source_coverage_ratio: 0.5,
        source_status_breakdown: {
          public_access: 2,
          auth_required: 1,
          blocked: 1
        },
        acceptance_reason_breakdown: {
          asking_price_ready: 1,
          missing_numeric_price: 2
        },
        failure_class_breakdown: {
          access_blocked: 1
        },
        discovery_provider_diagnostics: [
          {
            provider: "brave",
            enabled: true,
            reason: null,
            requests_used: 2,
            results_returned: 9
          }
        ],
        persisted_source_metrics: [
          {
            source_name: "Clar",
            source_family: "clar",
            venue_name: "Clar Müzayede",
            legal_posture: "public_permitted",
            total_attempts: 4,
            reachable_count: 4,
            parse_success_count: 3,
            price_signal_count: 2,
            accepted_for_evidence_count: 2,
            valuation_ready_count: 1,
            blocked_count: 0,
            auth_required_count: 0,
            failure_count: 1,
            reliability_score: 0.5,
            last_status: "public_access",
            updated_at: "2026-04-12T10:00:00.000Z"
          }
        ],
        recent_canaries: [
          {
            family: "clar",
            source_name: "Clar",
            fixture: "clar/archive.html",
            source_page_type: "listing",
            legal_posture: "public_permitted",
            expected_price_type: "asking_price",
            observed_price_type: "asking_price",
            acceptance_reason: "asking_price_ready",
            accepted_for_evidence: true,
            accepted_for_valuation: true,
            status: "pass",
            details: "Parsed asking price.",
            recorded_at: "2026-04-12T10:05:00.000Z"
          }
        ],
        valuation_generated: true,
        valuation_reason: "Generated"
      },
      valuation: {
        generated: true,
        reason: "Generated",
        blendedRange: { low: 100000, high: 140000 },
        topComparables: [
          {
            sourceName: "Clar",
            workTitle: "Untitled",
            currency: "TRY",
            nativePrice: 120000,
            valuationLane: "asking"
          }
        ]
      },
      records: [
        {
          work_title: "Untitled",
          source_name: "Clar",
          source_url: "https://example.com/work",
          price_type: "asking_price",
          price_amount: 120000,
          currency: "TRY",
          normalized_price_usd: 3000,
          accepted_for_valuation: true,
          acceptance_reason: "asking_price_ready",
          source_access_status: "public_access",
          access_mode: "anonymous",
          source_legal_posture: "public_permitted",
          access_provenance_label: "Anonymous public access.",
          acceptance_explanation: "Clar: accepted asking price evidence.",
          next_step_hint: "Capture another Turkish asking comparable."
        }
      ],
      gaps: ["Low priced coverage across crawled sources."]
    });

    expect(normalized.runId).toBe("run-123");
    expect(normalized.valuation.generated).toBe(true);
    expect(normalized.sourceMetrics[0]?.sourceName).toBe("Clar");
    expect(normalized.canaries[0]?.status).toBe("pass");
    expect(normalized.discoveryDiagnostics[0]?.provider).toBe("brave");
    expect(normalized.records[0]?.acceptanceExplanation).toContain("accepted asking price");
    expect(normalized.reasonBreakdown[0]?.label).toBe("Missing Numeric Price");
    expect(normalized.gaps[0]).toContain("Low priced coverage");
  });

  it("normalizes the artist market inventory payload", () => {
    const normalized = normalizeResearchRunReport({
      run: {
        id: "run-inventory-1",
        runType: "artist_market_inventory",
        status: "completed",
        query: { artist: "Bedri Baykam", analysisMode: "fast" }
      },
      summary: {
        accepted_records: 2,
        rejected_candidates: 5,
        discovered_candidates: 3,
        accepted_from_discovery: 1,
        total_attempts: 7,
        total_records: 7,
        valuation_eligible_records: 2,
        priced_source_coverage_ratio: 0.2,
        priced_crawled_source_coverage_ratio: 0.25,
        source_status_breakdown: { public_access: 4, auth_required: 1, blocked: 2 },
        acceptance_reason_breakdown: { asking_price_ready: 2, missing_numeric_price: 5 },
        valuation_generated: false,
        valuation_reason: "Inventory mode did not produce blended valuation."
      },
      inventory: [
        {
          id: "inventory-1",
          work_title: "Market Listing 1",
          venue_name: "Clar Müzayede",
          source_url: "https://example.com/inventory-1",
          price_type: "asking_price",
          price_amount: 40000,
          currency: "TRY",
          normalized_price_usd: 1000,
          valuation_confidence: 0.72,
          accepted_for_valuation: true,
          acceptance_reason: "asking_price_ready",
          source_access_status: "public_access"
        }
      ]
    });

    expect(normalized.runType).toBe("artist_market_inventory");
    expect(normalized.records[0]?.venueName).toBe("Clar Müzayede");
    expect(normalized.sourceHealthItems[0]?.label).toBe("Public Access");
  });

  it("normalizes the API run details payload for inventory runs with nested payload records", () => {
    const normalized = normalizeResearchRunReport({
      run: {
        id: "run-inventory-2",
        runType: "artist_market_inventory",
        status: "completed",
        createdAt: "2026-04-12T10:00:00.000Z",
        query: { artist: "Bedri Baykam", analysisMode: "fast" }
      },
      summary: {
        accepted_records: 1,
        rejected_candidates: 2,
        discovered_candidates: 1,
        accepted_from_discovery: 0,
        total_attempts: 3,
        total_records: 3,
        valuation_eligible_records: 1,
        priced_source_coverage_ratio: 0.33,
        priced_crawled_source_coverage_ratio: 0.5,
        source_status_breakdown: { public_access: 2, blocked: 1 },
        acceptance_reason_breakdown: { asking_price_ready: 1, missing_numeric_price: 2 },
        valuation_generated: false,
        valuation_reason: "Inventory mode did not produce blended valuation."
      },
      inventory: [
        {
          id: "inventory-row-1",
          run_id: "run-inventory-2",
          artist_key: "bedri-baykam",
          record_key: "clar-1",
          source_host: "example.com",
          semantic_lane: "asking",
          cluster_id: null,
          created_at: "2026-04-12T10:00:00.000Z",
          updated_at: "2026-04-12T10:00:00.000Z",
          payload: {
            artist_name: "Bedri Baykam",
            work_title: "Market Listing 1",
            alternate_title: null,
            year: "1995",
            medium: null,
            support: null,
            dimensions_text: "100 x 80 cm",
            height_cm: null,
            width_cm: null,
            depth_cm: null,
            signed: null,
            dated: null,
            edition_info: null,
            is_unique_work: null,
            venue_name: "Clar Müzayede",
            venue_type: "auction_house",
            city: null,
            country: null,
            source_name: "Clar Müzayede",
            source_url: "https://example.com/inventory-1",
            source_page_type: "listing",
            sale_or_listing_date: "2026-04-12",
            lot_number: null,
            price_type: "asking_price",
            estimate_low: null,
            estimate_high: null,
            price_amount: 40000,
            currency: "TRY",
            normalized_price_try: 40000,
            normalized_price_usd: 1000,
            normalized_price_usd_nominal: 1000,
            buyers_premium_included: null,
            image_url: null,
            screenshot_path: null,
            raw_snapshot_path: null,
            visual_match_score: null,
            metadata_match_score: null,
            extraction_confidence: 0.8,
            entity_match_confidence: 0.8,
            source_reliability_confidence: 0.8,
            valuation_confidence: 0.72,
            overall_confidence: 0.72,
            accepted_for_evidence: true,
            accepted_for_valuation: true,
            valuation_lane: "asking",
            acceptance_reason: "asking_price_ready",
            rejection_reason: null,
            valuation_eligibility_reason: null,
            price_hidden: false,
            source_access_status: "public_access",
            access_mode: "anonymous",
            source_legal_posture: "public_permitted",
            access_provenance_label: "Anonymous public access.",
            acceptance_explanation: "Clar accepted the record as priced evidence.",
            next_step_hint: "Find another realized comparable.",
            notes: []
          }
        }
      ]
    });

    expect(normalized.runType).toBe("artist_market_inventory");
    expect(normalized.records[0]?.id).toBe("clar-1");
    expect(normalized.records[0]?.venueName).toBe("Clar Müzayede");
    expect(normalized.records[0]?.accessProvenanceLabel).toContain("Anonymous public access");
    expect(normalized.records[0]?.priceLabel).toContain("$");
  });
});

describe("browser report rendering", () => {
  it("builds a json-render spec and full html document", () => {
    const normalized = normalizeResearchRunReport({
      runId: "run-ext-2",
      artist: "Fikret Mualla",
      status: "completed",
      metrics: {
        accepted: 0,
        rejected: 4,
        discoveredCandidates: 0,
        acceptedFromDiscovery: 0,
        pricedCoverageCrawled: 0,
        pricedCoverageAttempted: 0
      },
      valuation: {
        generated: false,
        reason: "No eligible comparables."
      },
      sourceHealth: {
        blocked: 2,
        auth_required: 1
      },
      inventory: []
    });

    const spec = buildResearchRunSpec(normalized) as { root: string; elements: Record<string, unknown> };
    const html = renderResearchRunHtml(normalized);

    expect(spec.root).toBeTruthy();
    expect(Object.keys(spec.elements).length).toBeGreaterThan(3);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Fikret Mualla");
    expect(html).toContain("No eligible comparables.");
    expect(html).toContain("Recent canaries");
  });
});
