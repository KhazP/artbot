import { describe, expect, it } from "vitest";
import { researchQuerySchema } from "@artbot/shared-types";
import { buildDiscoveryConfigFromEnv, buildQueryVariants, discoverWebCandidates, expandCandidatesLight } from "./discovery.js";

const query = researchQuerySchema.parse({
  artist: "Burhan Dogancay",
  title: "Mavi Kompozisyon",
  scope: "turkey_plus_international" as const,
  turkeyFirst: true,
  analysisMode: "balanced" as const,
  priceNormalization: "usd_dual" as const,
  manualLoginCheckpoint: false,
  allowLicensed: false,
  licensedIntegrations: [],
  crawlMode: "backfill" as const,
  sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
});

describe("discovery", () => {
  it("builds multilingual query variants", () => {
    const variants = buildQueryVariants(query, 12);
    expect(variants.length).toBe(12);
    expect(variants.some((variant) => variant.includes("tablo"))).toBe(true);
    expect(variants.some((variant) => variant.includes("auction result") || variant.includes("painting sold"))).toBe(true);
  });

  it("adds transliterated and reordered variants with bounded output", () => {
    const transliterated = buildQueryVariants(
      {
        ...query,
        artist: "Burhan Doğançay",
        title: "Mavi Kompozisyon"
      },
      20
    );

    expect(transliterated.length).toBeLessThanOrEqual(20);
    expect(transliterated.some((variant) => variant.includes("Dogancay"))).toBe(true);
    expect(transliterated.some((variant) => variant.includes("Mavi Kompozisyon Burhan"))).toBe(true);
  });

  it("enables Brave web discovery only in comprehensive mode with api key", () => {
    const originalProvider = process.env.WEB_DISCOVERY_PROVIDER;
    const originalEnabled = process.env.WEB_DISCOVERY_ENABLED;
    const originalKey = process.env.BRAVE_SEARCH_API_KEY;
    try {
      process.env.WEB_DISCOVERY_PROVIDER = "brave";
      process.env.WEB_DISCOVERY_ENABLED = "true";
      process.env.BRAVE_SEARCH_API_KEY = "test-key";

      const balanced = buildDiscoveryConfigFromEnv("balanced");
      const comprehensive = buildDiscoveryConfigFromEnv("comprehensive");

      expect(balanced.webDiscoveryEnabled).toBe(false);
      expect(comprehensive.webDiscoveryEnabled).toBe(true);
    } finally {
      process.env.WEB_DISCOVERY_PROVIDER = originalProvider;
      process.env.WEB_DISCOVERY_ENABLED = originalEnabled;
      process.env.BRAVE_SEARCH_API_KEY = originalKey;
    }
  });

  it("expands, dedupes and caps candidates", () => {
    const expanded = expandCandidatesLight(
      [
        {
          url: "https://example.com/search?q=foo",
          sourcePageType: "price_db",
          provenance: "seed",
          score: 0.9
        }
      ],
      query,
      {
        enabled: true,
        maxCandidatesPerSource: 3,
        maxQueryVariants: 5,
        domainThrottlePerSource: 5,
        maxDiscoveredDomainsPerRun: 3,
        maxUrlsPerDiscoveredDomain: 2,
        maxTotalCandidatesPerRun: 20,
        webDiscoveryEnabled: false,
        webDiscoveryProvider: "none",
        webDiscoveryBlockHostTokens: [],
      }
    );

    expect(expanded.length).toBeLessThanOrEqual(3);
    expect(expanded[0].provenance).toBe("seed");
    expect(expanded.some((candidate) => candidate.provenance === "query_variant")).toBe(true);
  });

  it("boosts turkey-like domains when turkeyFirst is enabled", () => {
    const expanded = expandCandidatesLight(
      [
        {
          url: "https://example.com/search?q=foo",
          sourcePageType: "price_db",
          provenance: "seed",
          score: 0.9
        },
        {
          url: "https://bayrakmuzayede.com/search?q=foo",
          sourcePageType: "listing",
          provenance: "seed",
          score: 0.84
        }
      ],
      query,
      {
        enabled: true,
        maxCandidatesPerSource: 4,
        maxQueryVariants: 1,
        domainThrottlePerSource: 4,
        maxDiscoveredDomainsPerRun: 3,
        maxUrlsPerDiscoveredDomain: 2,
        maxTotalCandidatesPerRun: 20,
        webDiscoveryEnabled: false,
        webDiscoveryProvider: "none",
        webDiscoveryBlockHostTokens: [],
      }
    );

    expect(expanded[0].url).toContain("bayrakmuzayede.com");
    expect(expanded[0].score).toBeGreaterThanOrEqual(expanded[1].score);
  });

  it("discovers web candidates with host filtering and per-domain caps", async () => {
    const config = {
      enabled: true,
      maxCandidatesPerSource: 10,
      maxQueryVariants: 2,
      domainThrottlePerSource: 5,
      maxDiscoveredDomainsPerRun: 10,
      maxUrlsPerDiscoveredDomain: 1,
      maxTotalCandidatesPerRun: 20,
      webDiscoveryEnabled: true,
      webDiscoveryProvider: "brave" as const,
      webDiscoveryApiKey: "test",
      webDiscoveryBlockHostTokens: ["blocked.com"],
    };

    const mockFetch: typeof fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          web: {
            results: [
              { url: "https://example-auction.com/lot/123?utm_source=test" },
              { url: "https://example-auction.com/lot/456" },
              { url: "https://blocked.com/item/1" },
            ]
          }
        })
      }) as Response) as typeof fetch;

    const candidates = await discoverWebCandidates(query, config, mockFetch);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toContain("example-auction.com/lot/123");
    expect(candidates[0].provenance).toBe("web_discovery");
  });
});
