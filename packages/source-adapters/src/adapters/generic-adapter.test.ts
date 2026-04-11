import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenericParsedFields } from "@artbot/extraction";
import { researchQuerySchema } from "@artbot/shared-types";
import type { AdapterExtractionContext } from "../types.js";
import { GenericSourceAdapter } from "./generic-adapter.js";

const mocks = vi.hoisted(() => ({
  fetchCheapestFirstMock: vi.fn(async () => ({
    url: "https://example.com/final",
    html: "<html><body>Realized: 100000 TL</body></html>",
    markdown: "Realized: 100000 TL",
    status: 200,
    parserUsed: "mock-fetch"
  })),
  parseGenericLotFieldsMock: vi.fn<(content: string, baseUrl?: string) => GenericParsedFields>(() => ({
    title: "Untitled",
    artistName: "Artist",
    medium: null,
    dimensionsText: null,
    year: null,
    imageUrl: null,
    lotNumber: "12",
    estimateLow: null,
    estimateHigh: null,
    priceAmount: 100000,
    priceType: "realized_price",
    currency: "TRY",
    saleDate: "2026-01-01",
    priceHidden: false,
    buyersPremiumIncluded: null
  }))
}));

vi.mock("@artbot/extraction", () => {
  return {
    fetchCheapestFirst: mocks.fetchCheapestFirstMock,
    parseGenericLotFields: mocks.parseGenericLotFieldsMock
  };
});

function context(
  mode: AdapterExtractionContext["accessContext"]["mode"],
  sourceAccessStatus: AdapterExtractionContext["accessContext"]["sourceAccessStatus"] = "public_access"
): AdapterExtractionContext {
  return {
    runId: "run-1",
    traceId: "trace-1",
    query: researchQuerySchema.parse({
      artist: "Artist",
      scope: "turkey_plus_international",
      turkeyFirst: true,
      analysisMode: "balanced",
      priceNormalization: "usd_dual",
      manualLoginCheckpoint: false,
      allowLicensed: false,
      licensedIntegrations: [],
      crawlMode: "backfill",
      sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
    }),
    accessContext: {
      mode,
      sourceAccessStatus,
      licensedIntegrations: []
    },
    evidenceDir: "/tmp/artbot-test"
  };
}

describe("GenericSourceAdapter access handling", () => {
  beforeEach(() => {
    mocks.parseGenericLotFieldsMock.mockImplementation(() => ({
      title: "Untitled",
      artistName: "Artist",
      medium: null,
      dimensionsText: null,
      year: null,
      imageUrl: null,
      lotNumber: "12",
      estimateLow: null,
      estimateHigh: null,
      priceAmount: 100000,
      priceType: "realized_price",
      currency: "TRY",
      saleDate: "2026-01-01",
      priceHidden: false,
      buyersPremiumIncluded: null
    }));
  });

  it("extracts in anonymous mode for public source", async () => {
    const adapter = new GenericSourceAdapter({
      id: "public-source",
      sourceName: "Artam",
      venueName: "Artam",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://example.com",
      searchPath: "/q="
    });

    const result = await adapter.extract(
      { url: "https://example.com/public", sourcePageType: "lot", provenance: "seed", score: 0.9 },
      context("anonymous", "public_access")
    );

    expect(result.attempt.source_access_status).toBe("public_access");
    expect(result.attempt.accepted).toBe(true);
    expect(result.attempt.accepted_for_valuation).toBe(true);
    expect(result.record?.source_access_status).toBe("public_access");
  });

  it("returns auth_required without creds on auth sources", async () => {
    const adapter = new GenericSourceAdapter({
      id: "auth-source",
      sourceName: "Artsy",
      venueName: "Artsy",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://example.com",
      searchPath: "/q=",
      requiresAuth: true
    });

    const result = await adapter.extract(
      { url: "https://example.com/auth", sourcePageType: "price_db", provenance: "seed", score: 0.9 },
      context("anonymous", "auth_required")
    );

    expect(result.attempt.source_access_status).toBe("auth_required");
    expect(result.attempt.accepted).toBe(false);
    expect(result.attempt.raw_snapshot_path).toContain("-blocked.json");
    expect(result.record).toBeNull();
  });

  it("extracts in authorized mode", async () => {
    const adapter = new GenericSourceAdapter({
      id: "authorized-source",
      sourceName: "Artsy",
      venueName: "Artsy",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://example.com",
      searchPath: "/q=",
      requiresAuth: true
    });

    const result = await adapter.extract(
      { url: "https://example.com/auth", sourcePageType: "price_db", provenance: "seed", score: 0.9 },
      context("authorized", "auth_required")
    );

    expect(result.attempt.accepted).toBe(true);
    expect(result.record?.price_amount).toBe(100000);
    expect(result.needsBrowserVerification).toBe(true);
  });

  it("keeps non-numeric asking results as evidence only", async () => {
    mocks.parseGenericLotFieldsMock.mockImplementation(() => ({
      title: "Parsed Listing",
      artistName: "Artist",
      medium: null,
      dimensionsText: null,
      year: null,
      imageUrl: null,
      lotNumber: "33",
      estimateLow: null,
      estimateHigh: null,
      priceAmount: null,
      priceType: "asking_price",
      currency: "USD",
      saleDate: "2026-02-02",
      priceHidden: false,
      buyersPremiumIncluded: null
    }));

    const adapter = new GenericSourceAdapter({
      id: "public-source",
      sourceName: "Artam",
      venueName: "Artam",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://example.com",
      searchPath: "/q="
    });

    const result = await adapter.extract(
      { url: "https://example.com/public", sourcePageType: "listing", provenance: "seed", score: 0.9 },
      context("anonymous", "public_access")
    );

    expect(result.attempt.accepted_for_evidence).toBe(true);
    expect(result.attempt.accepted_for_valuation).toBe(false);
    expect(result.attempt.acceptance_reason).toBe("missing_numeric_price");
    expect(result.record?.accepted_for_valuation).toBe(false);
    expect(result.record?.work_title).toBe("Parsed Listing");
  });

  it("rejects generic shell pages instead of surfacing them as records", async () => {
    mocks.parseGenericLotFieldsMock.mockImplementation(() => ({
      title: "Anasayfa | Bayrak Müzayede",
      artistName: "Artist",
      medium: null,
      dimensionsText: null,
      year: null,
      imageUrl: null,
      lotNumber: null,
      estimateLow: null,
      estimateHigh: null,
      priceAmount: 16000,
      priceType: "asking_price",
      currency: "TRY",
      saleDate: "2026-02-02",
      priceHidden: false,
      buyersPremiumIncluded: null
    }));

    const adapter = new GenericSourceAdapter({
      id: "public-source",
      sourceName: "Bayrak Muzayede Listing",
      venueName: "Bayrak Muzayede",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://example.com",
      searchPath: "/q="
    });

    const result = await adapter.extract(
      { url: "https://example.com/public", sourcePageType: "listing", provenance: "seed", score: 0.9 },
      context("anonymous", "public_access")
    );

    expect(result.attempt.accepted).toBe(false);
    expect(result.attempt.acceptance_reason).toBe("generic_shell_page");
    expect(result.record).toBeNull();
    expect(result.needsBrowserVerification).toBe(false);
  });

  it("extracts in licensed mode for licensed source", async () => {
    const adapter = new GenericSourceAdapter({
      id: "licensed-source",
      sourceName: "askART",
      venueName: "askART",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://example.com",
      searchPath: "/q=",
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    });

    const result = await adapter.extract(
      { url: "https://example.com/licensed", sourcePageType: "price_db", provenance: "seed", score: 0.9 },
      context("licensed", "licensed_access")
    );

    expect(result.attempt.source_access_status).toBe("licensed_access");
    expect(result.attempt.accepted).toBe(true);
    expect(result.record?.source_access_status).toBe("licensed_access");
  });

  it("short-circuits blocked access without extraction call", async () => {
    mocks.fetchCheapestFirstMock.mockClear();

    const adapter = new GenericSourceAdapter({
      id: "blocked-source",
      sourceName: "Blocked",
      venueName: "Blocked",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://example.com",
      searchPath: "/q="
    });

    const result = await adapter.extract(
      { url: "https://example.com/blocked", sourcePageType: "price_db", provenance: "seed", score: 0.9 },
      context("anonymous", "blocked")
    );

    expect(result.attempt.source_access_status).toBe("blocked");
    expect(result.attempt.accepted).toBe(false);
    expect(result.record).toBeNull();
    expect(mocks.fetchCheapestFirstMock).toHaveBeenCalledTimes(0);
  });
});
