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
    const originalBalancedInventory = process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY;
    const originalKey = process.env.BRAVE_SEARCH_API_KEY;
    try {
      process.env.WEB_DISCOVERY_PROVIDER = "brave";
      process.env.WEB_DISCOVERY_ENABLED = "true";
      process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY = "false";
      process.env.BRAVE_SEARCH_API_KEY = "test-key";

      const balanced = buildDiscoveryConfigFromEnv("balanced");
      const comprehensive = buildDiscoveryConfigFromEnv("comprehensive");

      expect(balanced.webDiscoveryEnabled).toBe(false);
      expect(comprehensive.webDiscoveryEnabled).toBe(true);
    } finally {
      process.env.WEB_DISCOVERY_PROVIDER = originalProvider;
      process.env.WEB_DISCOVERY_ENABLED = originalEnabled;
      process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY = originalBalancedInventory;
      process.env.BRAVE_SEARCH_API_KEY = originalKey;
    }
  });

  it("can enable web discovery in balanced mode when inventory toggle is enabled", () => {
    const originalEnabled = process.env.WEB_DISCOVERY_ENABLED;
    const originalBalancedInventory = process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY;
    try {
      process.env.WEB_DISCOVERY_ENABLED = "true";
      process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY = "true";

      const balanced = buildDiscoveryConfigFromEnv("balanced");
      expect(balanced.webDiscoveryEnabled).toBe(true);
    } finally {
      process.env.WEB_DISCOVERY_ENABLED = originalEnabled;
      process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY = originalBalancedInventory;
    }
  });

  it("keeps comprehensive web discovery eligible before provider override is applied", () => {
    const originalProvider = process.env.WEB_DISCOVERY_PROVIDER;
    const originalEnabled = process.env.WEB_DISCOVERY_ENABLED;
    try {
      delete process.env.WEB_DISCOVERY_PROVIDER;
      delete process.env.WEB_DISCOVERY_ENABLED;

      const comprehensive = buildDiscoveryConfigFromEnv("comprehensive");
      const balanced = buildDiscoveryConfigFromEnv("balanced");

      expect(comprehensive.webDiscoveryEnabled).toBe(true);
      expect(comprehensive.webDiscoveryProvider).toBe("searxng");
      expect(comprehensive.searxngBaseUrl).toBe("http://127.0.0.1:8080");
      expect(balanced.webDiscoveryEnabled).toBe(false);
    } finally {
      process.env.WEB_DISCOVERY_PROVIDER = originalProvider;
      process.env.WEB_DISCOVERY_ENABLED = originalEnabled;
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

  it("expands urls that use search_words query params", () => {
    const expanded = expandCandidatesLight(
      [
        {
          url: "https://www.bayrakmuzayede.com/arama.html?search_words=foo",
          sourcePageType: "listing",
          provenance: "seed",
          score: 0.84
        }
      ],
      query,
      {
        enabled: true,
        maxCandidatesPerSource: 4,
        maxQueryVariants: 3,
        domainThrottlePerSource: 4,
        maxDiscoveredDomainsPerRun: 3,
        maxUrlsPerDiscoveredDomain: 2,
        maxTotalCandidatesPerRun: 20,
        webDiscoveryEnabled: false,
        webDiscoveryProvider: "none",
        webDiscoveryBlockHostTokens: [],
      }
    );

    expect(
      expanded.some(
        (candidate) =>
          candidate.provenance === "query_variant"
          && candidate.discoveredFromUrl === "https://www.bayrakmuzayede.com/arama.html?search_words=foo"
          && candidate.url.includes("search_words=")
      )
    ).toBe(true);
  });

  it("prioritizes discovered lot-detail pages ahead of additional query variants", () => {
    const expanded = expandCandidatesLight(
      [
        {
          url: "https://www.rportakal.com/search?q=Abidin%20Dino",
          sourcePageType: "listing",
          provenance: "seed",
          score: 0.9
        },
        {
          url: "https://www.rportakal.com/products/abidin-dino-work",
          sourcePageType: "lot",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.rportakal.com/search?q=Abidin%20Dino"
        }
      ],
      query,
      {
        enabled: true,
        maxCandidatesPerSource: 5,
        maxQueryVariants: 3,
        domainThrottlePerSource: 8,
        maxDiscoveredDomainsPerRun: 3,
        maxUrlsPerDiscoveredDomain: 2,
        maxTotalCandidatesPerRun: 20,
        webDiscoveryEnabled: false,
        webDiscoveryProvider: "none",
        webDiscoveryBlockHostTokens: [],
      }
    );

    expect(expanded[0]?.url).toBe("https://www.rportakal.com/products/abidin-dino-work");
    expect(expanded[1]?.provenance).toBe("seed");
    expect(expanded.some((candidate) => candidate.provenance === "query_variant")).toBe(true);
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

  it("queries searxng and normalizes usable candidates", async () => {
    const config = {
      enabled: true,
      maxCandidatesPerSource: 10,
      maxQueryVariants: 1,
      domainThrottlePerSource: 5,
      maxDiscoveredDomainsPerRun: 10,
      maxUrlsPerDiscoveredDomain: 1,
      maxTotalCandidatesPerRun: 20,
      webDiscoveryEnabled: true,
      webDiscoveryProvider: "searxng" as const,
      searxngBaseUrl: "http://127.0.0.1:8080",
      webDiscoveryBlockHostTokens: [],
    };

    const mockFetch: typeof fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("127.0.0.1:8080/search")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { url: "https://example-auction.com/lot/123?utm_source=searx" },
              { url: "https://example-auction.com/lot/456" }
            ]
          })
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const candidates = await discoverWebCandidates(query, config, mockFetch);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe("https://example-auction.com/lot/123");
    expect(candidates[0]?.provenance).toBe("web_discovery");
  });

  it("falls back to duckduckgo when searxng is unavailable", async () => {
    const config: Parameters<typeof discoverWebCandidates>[1] = {
      enabled: true,
      maxCandidatesPerSource: 10,
      maxQueryVariants: 1,
      domainThrottlePerSource: 5,
      maxDiscoveredDomainsPerRun: 10,
      maxUrlsPerDiscoveredDomain: 2,
      maxTotalCandidatesPerRun: 20,
      webDiscoveryEnabled: true,
      webDiscoveryProvider: "searxng" as const,
      searxngBaseUrl: "http://127.0.0.1:8080",
      webDiscoveryBlockHostTokens: [],
    };

    const mockFetch: typeof fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("127.0.0.1:8080/search")) {
        throw new Error("searxng offline");
      }
      if (url.includes("duckduckgo.com/html")) {
        return {
          ok: true,
          text: async () => `
            <html>
              <body>
                <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rportakal.com%2Fen%2Fproducts%2Fabidin-dino-works">Result</a>
              </body>
            </html>
          `
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const candidates = await discoverWebCandidates({ ...query, analysisMode: "comprehensive" }, config, mockFetch);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe("https://www.rportakal.com/en/products/abidin-dino-works");
    expect(config.webDiscoveryDiagnostics?.[0]?.provider).toBe("searxng");
    expect(config.webDiscoveryDiagnostics?.[0]?.failover_invoked).toBe(false);
  });

  it("falls back to unauthenticated web discovery when providers are selected but api keys are missing", async () => {
    const config = {
      enabled: true,
      maxCandidatesPerSource: 10,
      maxQueryVariants: 1,
      domainThrottlePerSource: 5,
      maxDiscoveredDomainsPerRun: 10,
      maxUrlsPerDiscoveredDomain: 2,
      maxTotalCandidatesPerRun: 20,
      webDiscoveryEnabled: true,
      webDiscoveryProvider: "brave" as const,
      webDiscoverySecondaryProvider: "tavily" as const,
      webDiscoveryBlockHostTokens: [],
    };

    const mockFetch: typeof fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("duckduckgo.com/html")) {
        return {
          ok: true,
          text: async () => `
            <html>
              <body>
                <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rportakal.com%2Fen%2Fproducts%2Fabidin-dino-works">Result</a>
              </body>
            </html>
          `
        } as Response;
      }

      throw new Error(`unexpected provider fetch ${url}`);
    }) as typeof fetch;

    const candidates = await discoverWebCandidates({ ...query, analysisMode: "comprehensive" }, config, mockFetch);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe("https://www.rportakal.com/en/products/abidin-dino-works");
    expect(candidates[0]?.provenance).toBe("web_discovery");
  });

  it("keeps scanning duckduckgo fallback variants until multiple hosts are discovered", async () => {
    const config = {
      enabled: true,
      maxCandidatesPerSource: 10,
      maxQueryVariants: 3,
      domainThrottlePerSource: 5,
      maxDiscoveredDomainsPerRun: 3,
      maxUrlsPerDiscoveredDomain: 2,
      maxTotalCandidatesPerRun: 20,
      webDiscoveryEnabled: true,
      webDiscoveryProvider: "brave" as const,
      webDiscoverySecondaryProvider: "tavily" as const,
      webDiscoveryBlockHostTokens: [],
    };

    let fallbackCall = 0;
    const mockFetch: typeof fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("duckduckgo.com/html")) {
        fallbackCall += 1;
        const href =
          fallbackCall === 1
            ? "https://www.rportakal.com/en/products/abidin-dino-works"
            : fallbackCall === 2
              ? "https://www.sothebys.com/en/buy/auction/2021/modern-art-online/abidin-dino"
              : "https://www.phillips.com/detail/abidin-dino/12345";
        return {
          ok: true,
          text: async () => `
            <html>
              <body>
                <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent(href)}">Result</a>
              </body>
            </html>
          `
        } as Response;
      }

      throw new Error(`unexpected provider fetch ${url}`);
    }) as typeof fetch;

    const candidates = await discoverWebCandidates({ ...query, analysisMode: "comprehensive" }, config, mockFetch);
    expect(candidates.map((candidate) => new URL(candidate.url).hostname)).toEqual([
      "www.rportakal.com",
      "www.sothebys.com",
      "www.phillips.com"
    ]);
    expect(fallbackCall).toBeGreaterThan(1);
  });
});
