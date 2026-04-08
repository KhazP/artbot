import { describe, expect, it, vi } from "vitest";
import type { AdapterExtractionContext } from "../types.js";
import { GenericSourceAdapter } from "./generic-adapter.js";

const mocks = vi.hoisted(() => ({
  fetchCheapestFirstMock: vi.fn(async () => ({
    url: "https://example.com/final",
    html: "<html><body>Realized: 100000 TL</body></html>",
    markdown: "Realized: 100000 TL",
    status: 200,
    parserUsed: "mock-fetch"
  }))
}));

vi.mock("@artbot/extraction", () => {
  return {
    fetchCheapestFirst: mocks.fetchCheapestFirstMock,
    parseGenericLotFields: vi.fn(() => ({
      title: "Untitled",
      lotNumber: "12",
      estimateLow: null,
      estimateHigh: null,
      priceAmount: 100000,
      priceType: "realized_price",
      currency: "TRY",
      saleDate: "2026-01-01",
      priceHidden: false
    }))
  };
});

function context(
  mode: AdapterExtractionContext["accessContext"]["mode"],
  sourceAccessStatus: AdapterExtractionContext["accessContext"]["sourceAccessStatus"] = "public_access"
): AdapterExtractionContext {
  return {
    runId: "run-1",
    traceId: "trace-1",
    query: {
      artist: "Artist",
      scope: "turkey_plus_international",
      turkeyFirst: true,
      manualLoginCheckpoint: false,
      allowLicensed: false,
      licensedIntegrations: []
    },
    accessContext: {
      mode,
      sourceAccessStatus,
      licensedIntegrations: []
    },
    evidenceDir: "/tmp/artbot-test"
  };
}

describe("GenericSourceAdapter access handling", () => {
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
      { url: "https://example.com/public", sourcePageType: "lot" },
      context("anonymous", "public_access")
    );

    expect(result.attempt.source_access_status).toBe("public_access");
    expect(result.attempt.accepted).toBe(true);
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
      { url: "https://example.com/auth", sourcePageType: "price_db" },
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
      { url: "https://example.com/auth", sourcePageType: "price_db" },
      context("authorized", "auth_required")
    );

    expect(result.attempt.accepted).toBe(true);
    expect(result.record?.price_amount).toBe(100000);
    expect(result.needsBrowserVerification).toBe(true);
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
      { url: "https://example.com/licensed", sourcePageType: "price_db" },
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
      { url: "https://example.com/blocked", sourcePageType: "price_db" },
      context("anonymous", "blocked")
    );

    expect(result.attempt.source_access_status).toBe("blocked");
    expect(result.attempt.accepted).toBe(false);
    expect(result.record).toBeNull();
    expect(mocks.fetchCheapestFirstMock).toHaveBeenCalledTimes(0);
  });
});
