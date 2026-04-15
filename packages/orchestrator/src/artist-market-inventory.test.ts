import { describe, expect, it } from "vitest";
import type { ArtistMarketInventorySummary, ClusterMembership, InventoryRecord, PriceRecord, ReviewItem, RunEntity, SourceAttempt, SourceHost, ArtworkCluster } from "@artbot/shared-types";
import { ArtistMarketInventoryOrchestrator } from "./artist-market-inventory.js";

function makeRun(): RunEntity {
  return {
    id: "run-current",
    runType: "artist_market_inventory",
    query: {
      artist: "Artist",
      scope: "turkey_plus_international",
      turkeyFirst: true,
      analysisMode: "balanced",
      priceNormalization: "usd_dual",
      manualLoginCheckpoint: false,
      allowLicensed: false,
      licensedIntegrations: [],
      preferredDiscoveryProviders: [],
      crawlMode: "backfill",
      sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
    },
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function makeRecord(overrides: Partial<PriceRecord> = {}): PriceRecord {
  return {
    artist_name: "Artist",
    work_title: "Work",
    alternate_title: null,
    year: null,
    medium: null,
    support: null,
    dimensions_text: null,
    height_cm: null,
    width_cm: null,
    depth_cm: null,
    signed: null,
    dated: null,
    edition_info: null,
    is_unique_work: null,
    venue_name: "Venue",
    venue_type: "auction_house",
    city: null,
    country: "Turkey",
    source_name: "Source",
    source_url: "https://example.com/lot/1",
    source_page_type: "lot",
    sale_or_listing_date: "2025-01-01",
    lot_number: null,
    price_type: "asking_price",
    estimate_low: null,
    estimate_high: null,
    price_amount: 1000,
    currency: "USD",
    normalized_price_try: 1000,
    normalized_price_usd: 1000,
    normalized_price_usd_nominal: 1000,
    normalized_price_usd_2026: 1100,
    fx_source: "static",
    fx_date_used: "2025-01-01",
    inflation_source: "us_cpi_static",
    inflation_base_year: 2026,
    buyers_premium_included: null,
    image_url: null,
    screenshot_path: null,
    raw_snapshot_path: null,
    visual_match_score: null,
    metadata_match_score: null,
    extraction_confidence: 0.8,
    entity_match_confidence: 0.8,
    source_reliability_confidence: 0.8,
    valuation_confidence: 0,
    overall_confidence: 0.8,
    accepted_for_evidence: true,
    accepted_for_valuation: false,
    valuation_lane: "asking",
    acceptance_reason: "asking_price_ready",
    rejection_reason: null,
    valuation_eligibility_reason: null,
    price_hidden: false,
    source_access_status: "public_access",
    notes: ["discovery:seed"],
    ...overrides
  };
}

function makeInventoryRecord(runId: string, recordKey: string, payload: PriceRecord): InventoryRecord {
  return {
    id: `${recordKey}-id`,
    run_id: runId,
    artist_key: "artist",
    record_key: recordKey,
    source_host: "example.com",
    semantic_lane: "asking",
    cluster_id: null,
    payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

describe("ArtistMarketInventoryOrchestrator buildRunSummary", () => {
  it("counts only current-run inventory rows in run-level totals", () => {
    const run = makeRun();
    const currentAccepted = makeInventoryRecord(
      run.id,
      "current-1",
      makeRecord({ notes: ["discovery:listing_expansion"], accepted_for_valuation: true })
    );
    const historicAccepted = makeInventoryRecord(
      "run-previous",
      "historic-1",
      makeRecord({ source_url: "https://example.com/lot/2" })
    );

    const attempts: SourceAttempt[] = [
      {
        run_id: run.id,
        source_name: "Source",
        source_url: "https://example.com/lot/1",
        canonical_url: "https://example.com/lot/1",
        access_mode: "anonymous",
        source_access_status: "public_access",
        access_reason: "ok",
        blocker_reason: null,
        extracted_fields: {},
        discovery_provenance: "listing_expansion",
        discovery_score: 0.8,
        discovered_from_url: null,
        screenshot_path: null,
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: null,
        har_path: null,
        fetched_at: new Date().toISOString(),
        parser_used: "test",
        model_used: null,
        extraction_confidence: 0.8,
        entity_match_confidence: 0.8,
        source_reliability_confidence: 0.8,
        confidence_score: 0.8,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "asking",
        acceptance_reason: "asking_price_ready",
        rejection_reason: null,
        valuation_eligibility_reason: null
      }
    ];

    const buildRunSummary = (ArtistMarketInventoryOrchestrator.prototype as any).buildRunSummary as (
      run: RunEntity,
      attempts: SourceAttempt[],
      currentRunRecords: PriceRecord[],
      clustered: {
        inventory: InventoryRecord[];
        clusters: ArtworkCluster[];
        memberships: ClusterMembership[];
        reviewItems: ReviewItem[];
      },
      inventorySummary: ArtistMarketInventorySummary,
      sourcePlan: any[],
      persistedSourceHealth: any[]
    ) => any;

    const summary = buildRunSummary.call(
      {},
      run,
      attempts,
      [currentAccepted.payload],
      {
        inventory: [currentAccepted, historicAccepted],
        clusters: [],
        memberships: [],
        reviewItems: []
      },
      {
        run_id: run.id,
        artist_key: "artist",
        crawl_mode: "backfill",
        total_inventory_records: 2,
        new_records_added: 1,
        total_images: 0,
        discovered_hosts: 1,
        total_clusters: 0,
        auto_confirmed_clusters: 0,
        review_queue_count: 0,
        crawl_gap_count: 0,
        per_source_record_counts: { Source: 2 },
        price_type_breakdown: {
          asking_price: 2,
          estimate: 0,
          hammer_price: 0,
          realized_price: 0,
          realized_with_buyers_premium: 0,
          inquiry_only: 0,
          unknown: 0
        },
        price_stats: {
          realized: { count: 0, min: null, avg: null, max: null },
          asking: { count: 2, min: 1000, avg: 1000, max: 1000 },
          estimate: { count: 0, min: null, avg: null, max: null }
        },
        crawl_gaps: []
      },
      [],
      []
    ) as any;

    expect(summary.total_records).toBe(1);
    expect(summary.evidence_records).toBe(1);
    expect(summary.accepted_records).toBe(1);
    expect(summary.valuation_eligible_records).toBe(1);
    expect(summary.accepted_from_discovery).toBe(1);
  });
});

describe("ArtistMarketInventoryOrchestrator buildFailureAttempt", () => {
  it("uses the provided source family instead of adapter id", () => {
    const run = makeRun();
    const buildFailureAttempt = (ArtistMarketInventoryOrchestrator.prototype as any).buildFailureAttempt as (
      run: RunEntity,
      frontier: any,
      sourceFamily: string,
      sourceAccessStatus: SourceAttempt["source_access_status"],
      error: string
    ) => SourceAttempt;

    const attempt = buildFailureAttempt.call(
      {},
      run,
      {
        source_name: "Source",
        adapter_id: "adapter-id",
        source_host: "example.com",
        source_page_type: "listing",
        provenance: "seed",
        score: 0.4,
        discovered_from_url: null,
        url: "https://example.com/listing",
      },
      "artam-auction-family",
      "public_access",
      "timeout"
    );

    expect(attempt.source_family).toBe("artam-auction-family");
    expect(attempt.source_family).not.toBe("adapter-id");
  });
});
