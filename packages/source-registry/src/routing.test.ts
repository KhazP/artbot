import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import { researchQuerySchema, type HostHealthRecord } from "@artbot/shared-types";
import { deriveDefaultSourceCapabilities, type SourceAdapter } from "@artbot/source-adapters";
import { buildSourcePlanItems, planSources, planSourcesWithDiagnostics } from "./routing.js";

const baseQuery = researchQuerySchema.parse({
  artist: "Artist",
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

type HostHealthDimension = {
  source_family: string;
  crawl_lane: "deterministic" | "cheap_fetch" | "crawlee" | "browser";
  access_mode: "anonymous" | "authorized" | "licensed";
  total_attempts: number;
  success_count: number;
  blocked_count: number;
  auth_required_count: number;
  failure_count: number;
  reliability_score: number;
  last_status: HostHealthRecord["last_status"];
  last_failure_class: HostHealthRecord["last_failure_class"];
  last_attempt_at: string;
  updated_at: string;
};

type HostHealthRecordWithDimensions = Omit<HostHealthRecord, "dimensions"> & {
  dimensions: Record<string, HostHealthDimension>;
};

function adapter(overrides: Partial<SourceAdapter> & { baseUrl?: string } = {}): SourceAdapter {
  const id = overrides.id ?? "a1";
  const supportedAccessModes = overrides.supportedAccessModes ?? ["anonymous", "authorized", "licensed"];
  const requiresAuth = overrides.requiresAuth ?? false;
  const sourcePageType = overrides.sourcePageType ?? "price_db";
  const crawlStrategies = overrides.crawlStrategies ?? ["search"];

  return {
    id,
    sourceName: "Source",
    venueName: "Venue",
    venueType: "database",
    sourcePageType,
    tier: 2,
    country: null,
    city: null,
    requiresAuth,
    requiresLicense: false,
    supportedAccessModes,
    crawlStrategies,
    capabilities:
      overrides.capabilities
      ?? deriveDefaultSourceCapabilities({
        id,
        supportedAccessModes,
        requiresAuth,
        sourcePageType,
        crawlStrategies
      }),
    discoverCandidates: async () => [
      { url: "https://example.com/search?q=artist", sourcePageType: "price_db", provenance: "seed", score: 0.9 }
    ],
    extract: async () => {
      throw new Error("not used");
    },
    ...overrides
  };
}

function healthRecord(overrides: Partial<HostHealthRecordWithDimensions> = {}): HostHealthRecordWithDimensions {
  return {
    host: "example.com",
    total_attempts: 12,
    success_count: 0,
    blocked_count: 0,
    auth_required_count: 0,
    failure_count: 12,
    consecutive_failures: 12,
    reliability_score: 0,
    last_status: "public_access",
    last_failure_class: "not_found",
    last_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dimensions: {},
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planSources", () => {
  it("keeps anonymous sources as public_access", async () => {
    const plans = await planSources(baseQuery, [adapter()], new AuthManager([]));
    expect(plans[0].accessContext.sourceAccessStatus).toBe("public_access");
    expect(plans[0].candidates.length).toBeGreaterThan(0);
  });

  it("marks auth-required sources when credentials are absent", async () => {
    const plans = await planSources(
      baseQuery,
      [
        adapter({
          sourceName: "Artsy",
          requiresAuth: true
        })
      ],
      new AuthManager([])
    );

    expect(plans[0].accessContext.sourceAccessStatus).toBe("auth_required");
    expect(plans[0].accessContext.mode).toBe("anonymous");
  });

  it("keeps auth-required sources selected when an auth profile is available", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        authProfileId: "artsy-profile"
      },
      [
        adapter({
          id: "artsy-source",
          sourceName: "Artsy",
          requiresAuth: true
        })
      ],
      new AuthManager([
        {
          id: "artsy-profile",
          mode: "authorized",
          sourcePatterns: ["Artsy"]
        }
      ])
    );

    expect(plans[0].accessContext.sourceAccessStatus).toBe("auth_required");
    expect(plans[0].accessContext.mode).toBe("authorized");
    const sourcePlan = buildSourcePlanItems(plans, 12, "balanced");
    expect(sourcePlan[0]?.selection_state).toBe("selected");
  });

  it("uses licensed_access when integration is allowed", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        allowLicensed: true,
        licensedIntegrations: ["askART"]
      },
      [
        adapter({
          sourceName: "askART",
          requiresAuth: true,
          requiresLicense: true,
          supportedAccessModes: ["licensed"]
        })
      ],
      new AuthManager([])
    );

    expect(plans[0].accessContext.sourceAccessStatus).toBe("licensed_access");
    expect(plans[0].accessContext.mode).toBe("licensed");
  });

  it("marks blocked when mode unsupported", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        authProfileId: "licensed-profile"
      },
      [
        adapter({
          supportedAccessModes: ["anonymous"]
        })
      ],
      new AuthManager([
        {
          id: "licensed-profile",
          mode: "licensed",
          sourcePatterns: ["Source"]
        }
      ])
    );

    expect(plans[0].accessContext.sourceAccessStatus).toBe("blocked");
  });

  it("blocks probe adapters unless optional probes are enabled", async () => {
    const prior = process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS;
    try {
      process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS = "false";

      const plans = await planSources(
        baseQuery,
        [
          adapter({
            id: "askart-probe",
            sourceName: "askART"
          })
        ],
        new AuthManager([])
      );

      expect(plans[0].accessContext.sourceAccessStatus).toBe("blocked");
      expect(plans[0].accessContext.blockerReason).toContain("probe adapters are opt-in");
    } finally {
      process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS = prior;
    }
  });

  it("blocks licensed-only adapters without explicit licensed allowlist", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        allowLicensed: true,
        licensedIntegrations: []
      },
      [
        adapter({
          id: "sanatfiyat-licensed-extractor",
          sourceName: "Sanatfiyat",
          requiresAuth: true,
          requiresLicense: true,
          supportedAccessModes: ["licensed"]
        })
      ],
      new AuthManager([])
    );

    expect(plans[0].accessContext.sourceAccessStatus).toBe("blocked");
    expect(plans[0].accessContext.blockerReason).toContain("not explicitly allowed");
  });

  it("classifies selected, skipped, and deprioritized plan rows", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        analysisMode: "fast"
      },
      [
        adapter({ id: "muzayedeapp-platform", sourceName: "Muzayede App", country: "Turkey" }),
        adapter({ id: "auth-required-source", sourceName: "Artsy", requiresAuth: true }),
        adapter({ id: "invaluable-lot-detail-adapter", sourceName: "Invaluable" }),
        adapter({ id: "la-1", sourceName: "LiveAuctioneers" }),
        adapter({ id: "a5", sourceName: "Source 5" }),
        adapter({ id: "a6", sourceName: "Source 6" }),
        adapter({ id: "a7", sourceName: "Source 7" })
      ],
      new AuthManager([])
    );

    const sourcePlan = buildSourcePlanItems(plans, 12, "fast");
    expect(sourcePlan[0]?.selection_state).toBe("selected");
    expect(sourcePlan.some((item) => item.selection_state === "skipped")).toBe(true);
    expect(sourcePlan.some((item) => item.selection_state === "deprioritized")).toBe(true);
  });

  it("widens comprehensive mode to keep more source families selected", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        analysisMode: "comprehensive"
      },
      [
        adapter({ id: "muzayedeapp-platform", sourceName: "Muzayede App", country: "Turkey" }),
        adapter({ id: "portakal-catalog", sourceName: "Portakal", country: "Turkey" }),
        adapter({ id: "bayrak-muzayede-listing", sourceName: "Bayrak", country: "Turkey" }),
        adapter({ id: "antikasa-lot-adapter", sourceName: "Antik A.S.", country: "Turkey" }),
        adapter({ id: "artam-auction-records", sourceName: "Artam", country: "Turkey" }),
        adapter({ id: "clar-archive", sourceName: "Clar Archive", country: "Turkey" }),
        adapter({ id: "turel-art-listing", sourceName: "Turel", country: "Turkey" }),
        adapter({ id: "alifart-lot", sourceName: "Alif Art", country: "Turkey" }),
        adapter({ id: "liveauctioneers-public-lot-adapter", sourceName: "LiveAuctioneers" }),
        adapter({ id: "invaluable-lot-detail-adapter", sourceName: "Invaluable" }),
        adapter({ id: "overflow-1", sourceName: "Overflow 1" }),
        adapter({ id: "overflow-2", sourceName: "Overflow 2" })
      ],
      new AuthManager([])
    );

    const sourcePlan = buildSourcePlanItems(plans, 80, "comprehensive");
    expect(sourcePlan.filter((item) => item.selection_state === "selected").length).toBeGreaterThanOrEqual(10);
  });

  it("prioritizes sources with entity-bearing lot candidates over low-yield generic search sources", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "generic-turkish-search",
          sourceName: "Generic Turkish Search",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://example.com/arama.html?search_words=antika",
              sourcePageType: "listing",
              provenance: "query_variant",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "invaluable-lot-detail-adapter",
          sourceName: "Invaluable",
          discoverCandidates: async () => [
            {
              url: "https://www.invaluable.com/auction-lot/abidin-dino-composition-ABCD1234",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.9
            }
          ]
        })
      ],
      new AuthManager([])
    );

    expect(plans[0]?.adapter.id).toBe("invaluable-lot-detail-adapter");
  });

  it("prefers artam over bayrak when candidate quality is otherwise similar", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "bayrak-muzayede-lot",
          sourceName: "Bayrak",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.bayrakmuzayede.com/abidin-dino-kompozisyon123.html",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "artam-auction-records",
          sourceName: "Artam",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://artam.com/en/auction-lot/abidin-dino-composition-123",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.9
            }
          ]
        })
      ],
      new AuthManager([])
    );

    expect(plans[0]?.adapter.id).toBe("artam-auction-records");
  });

  it("keeps public sources routable in comprehensive mode despite repeated not-found health failures", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "artam-auction-records",
          sourceName: "Artam",
          country: "Turkey",
          baseUrl: "https://artam.com",
          discoverCandidates: async () => [
            {
              url: "https://artam.com/en/auction-lot/abidin-dino-composition-123",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "clar-archive",
          sourceName: "Clar Archive",
          country: "Turkey",
          baseUrl: "https://www.clarmuzayede.com",
          discoverCandidates: async () => [
            {
              url: "https://www.clarmuzayede.com/muzayede-arsivi/abidin-dino/123",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.82
            }
          ]
        })
      ],
      new AuthManager([]),
      [healthRecord({ host: "artam.com" })]
    );

    const sourcePlan = buildSourcePlanItems(plans, 80, "comprehensive");
    const artamItem = sourcePlan.find((item) => item.adapter_id === "artam-auction-records");
    expect(artamItem?.selection_state).not.toBe("skipped");
    expect(artamItem?.skip_reason).toBeNull();
    expect(artamItem?.selection_reason).toContain("Comprehensive mode keeps this host eligible");
    expect(plans[0]?.adapter.id).toBe("clar-archive");
  });

  it("keeps public sources routable in comprehensive mode despite repeated transport health failures", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "alifart-listing",
          sourceName: "Alif Art",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://alifart.com.tr/?s=Abidin%20Dino",
              sourcePageType: "listing",
              provenance: "seed",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "clar-buy-now",
          sourceName: "Clar Buy Now",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.clarmuzayede.com/hemen-al/resim/9596",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.88
            }
          ]
        })
      ],
      new AuthManager([]),
      [
        healthRecord({
          host: "alifart.com.tr",
          total_attempts: 9,
          success_count: 0,
          failure_count: 9,
          consecutive_failures: 9,
          reliability_score: 0,
          last_failure_class: "transport_dns"
        })
      ]
    );

    const sourcePlan = buildSourcePlanItems(plans, 80, "comprehensive");
    const alifItem = sourcePlan.find((item) => item.adapter_id === "alifart-listing");
    expect(alifItem?.selection_state).not.toBe("skipped");
    expect(alifItem?.skip_reason).toBeNull();
    expect(alifItem?.selection_reason).toContain("Comprehensive mode keeps this host eligible");
    expect(plans[0]?.adapter.id).toBe("clar-buy-now");
  });

  it("does not apply host-level skip decisions across sibling adapters on the same hostname", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "bayrak-muzayede-listing",
          sourceName: "Bayrak Listing",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.bayrakmuzayede.com/arama.html?search_words=Abidin%20Dino",
              sourcePageType: "listing",
              provenance: "seed",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "bayrak-muzayede-lot",
          sourceName: "Bayrak Lot",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.bayrakmuzayede.com/abidin-dino-kompozisyon123.html",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.92
            }
          ]
        })
      ],
      new AuthManager([]),
      [healthRecord({ host: "bayrakmuzayede.com" })]
    );

    const sourcePlan = buildSourcePlanItems(plans, 80, "comprehensive");
    expect(sourcePlan.find((item) => item.adapter_id === "bayrak-muzayede-listing")?.selection_state).not.toBe("skipped");
    expect(sourcePlan.find((item) => item.adapter_id === "bayrak-muzayede-lot")?.selection_state).not.toBe("skipped");
  });

  it("applies hard skip decisions in balanced mode even when sibling adapters share the same hostname", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "balanced"
      },
      [
        adapter({
          id: "bayrak-muzayede-listing",
          sourceName: "Bayrak Listing",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.bayrakmuzayede.com/arama.html?search_words=Abidin%20Dino",
              sourcePageType: "listing",
              provenance: "seed",
              score: 0.9
            }
          ]
        }),
        adapter({
          id: "bayrak-muzayede-lot",
          sourceName: "Bayrak Lot",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://www.bayrakmuzayede.com/abidin-dino-kompozisyon123.html",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.92
            }
          ]
        })
      ],
      new AuthManager([]),
      [healthRecord({ host: "bayrakmuzayede.com" })]
    );

    const sourcePlan = buildSourcePlanItems(plans, 24, "balanced");
    expect(sourcePlan.find((item) => item.adapter_id === "bayrak-muzayede-listing")?.selection_state).toBe("skipped");
    expect(sourcePlan.find((item) => item.adapter_id === "bayrak-muzayede-lot")?.selection_state).toBe("skipped");
  });

  it("enables preferred discovery providers outside comprehensive mode", async () => {
    vi.stubGlobal("fetch", (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("duckduckgo.com/html")) {
        return {
          ok: true,
          text: async () => `
            <html>
              <body>
                <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://www.rportakal.com/en/products/abidin-dino-works")}">Result</a>
              </body>
            </html>
          `
        } as Response;
      }

      throw new Error(`unexpected discovery fetch ${url}`);
    }) as typeof fetch);

    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "balanced",
        preferredDiscoveryProviders: ["brave"]
      },
      [],
      new AuthManager([])
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]?.adapter.sourceName).toContain("rportakal.com");
    expect(plans[0]?.candidates[0]?.url).toBe("https://www.rportakal.com/en/products/abidin-dino-works");
    expect(plans[0]?.candidates[0]?.provenance).toBe("web_discovery");
  });

  it("uses searxng as preferred discovery provider outside comprehensive mode", async () => {
    vi.stubGlobal("fetch", (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/search") && url.includes("format=json")) {
        return {
          ok: true,
          json: async () => ({
            results: [{ url: "https://www.rportakal.com/en/products/abidin-dino-works" }]
          })
        } as Response;
      }
      throw new Error(`unexpected discovery fetch ${url}`);
    }) as typeof fetch);

    const priorSearxngBaseUrl = process.env.SEARXNG_BASE_URL;
    try {
      process.env.SEARXNG_BASE_URL = "http://127.0.0.1:8080";
      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          artist: "Abidin Dino",
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["searxng"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.plannedSources).toHaveLength(1);
      expect(planning.plannedSources[0]?.adapter.sourceName).toContain("rportakal.com");
      expect(planning.discoveryDiagnostics[0]?.provider).toBe("searxng");
      expect(planning.discoveryDiagnostics[0]?.candidates_kept).toBe(1);
    } finally {
      process.env.SEARXNG_BASE_URL = priorSearxngBaseUrl;
    }
  });

  it("fails over to the secondary provider when the primary provider is unavailable", async () => {
    const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
    const priorTavily = process.env.TAVILY_API_KEY;
    try {
      process.env.BRAVE_SEARCH_API_KEY = "brave-token";
      process.env.TAVILY_API_KEY = "tavily-token";
      vi.stubGlobal("fetch", (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.search.brave.com")) {
          throw new Error("brave unavailable");
        }
        if (url.includes("api.tavily.com/search")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ url: "https://www.rportakal.com/en/products/abidin-dino-works" }]
            })
          } as Response;
        }
        throw new Error(`unexpected discovery fetch ${url}`);
      }) as typeof fetch);

      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["brave", "tavily"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.plannedSources).toHaveLength(1);
      expect(planning.discoveryDiagnostics[0]?.provider).toBe("brave");
      expect(planning.discoveryDiagnostics[0]?.failover_invoked).toBe(true);
      expect(planning.discoveryDiagnostics[1]?.provider).toBe("tavily");
      expect(planning.discoveryDiagnostics[1]?.candidates_kept).toBe(1);
    } finally {
      process.env.BRAVE_SEARCH_API_KEY = priorBrave;
      process.env.TAVILY_API_KEY = priorTavily;
    }
  });

  it("fails over to the secondary provider when the primary provider yields no usable candidates", async () => {
    const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
    const priorTavily = process.env.TAVILY_API_KEY;
    try {
      process.env.BRAVE_SEARCH_API_KEY = "brave-token";
      process.env.TAVILY_API_KEY = "tavily-token";
      vi.stubGlobal("fetch", (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.search.brave.com")) {
          return {
            ok: true,
            json: async () => ({ web: { results: [] } })
          } as Response;
        }
        if (url.includes("api.tavily.com/search")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ url: "https://www.clarmuzayede.com/hemen-al/resim/9596" }]
            })
          } as Response;
        }
        throw new Error(`unexpected discovery fetch ${url}`);
      }) as typeof fetch);

      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["brave", "tavily"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.discoveryDiagnostics[0]?.reason).toContain("Failed over");
      expect(planning.discoveryDiagnostics[1]?.failover_invoked).toBe(true);
      expect(planning.plannedSources[0]?.adapter.sourceName).toContain("clarmuzayede.com");
    } finally {
      process.env.BRAVE_SEARCH_API_KEY = priorBrave;
      process.env.TAVILY_API_KEY = priorTavily;
    }
  });

  it("records discovery cap trimming and budget exhaustion", async () => {
    const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
    const priorTotal = process.env.WEB_DISCOVERY_MAX_TOTAL_CANDIDATES;
    try {
      process.env.BRAVE_SEARCH_API_KEY = "brave-token";
      process.env.WEB_DISCOVERY_MAX_TOTAL_CANDIDATES = "1";
      vi.stubGlobal("fetch", (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.search.brave.com")) {
          return {
            ok: true,
            json: async () => ({
              web: {
                results: [
                  { url: "https://www.rportakal.com/en/products/abidin-dino-works" },
                  { url: "https://www.rportakal.com/en/products/abidin-dino-study" }
                ]
              }
            })
          } as Response;
        }
        throw new Error(`unexpected discovery fetch ${url}`);
      }) as typeof fetch);

      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["brave"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.discoveryDiagnostics[0]?.candidates_kept).toBe(1);
      expect(planning.discoveryDiagnostics[0]?.trimmed_by_caps).toBe(true);
      expect(planning.discoveryDiagnostics[0]?.budget_exhausted).toBe(true);
    } finally {
      process.env.BRAVE_SEARCH_API_KEY = priorBrave;
      process.env.WEB_DISCOVERY_MAX_TOTAL_CANDIDATES = priorTotal;
    }
  });

  it("uses discovered lot/detail URL directly for dynamic hosts instead of forcing synthetic search paths", async () => {
    const priorSearxngBaseUrl = process.env.SEARXNG_BASE_URL;
    try {
      process.env.SEARXNG_BASE_URL = "http://127.0.0.1:8080";
      vi.stubGlobal("fetch", (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/search") && url.includes("format=json")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ url: "https://example-auctions.test/lot/abidin-dino-1234" }]
            })
          } as Response;
        }
        throw new Error(`unexpected discovery fetch ${url}`);
      }) as typeof fetch);

      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["searxng"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.plannedSources).toHaveLength(1);
      expect(planning.plannedSources[0]?.candidates[0]?.url).toBe("https://example-auctions.test/lot/abidin-dino-1234");
      expect(planning.plannedSources[0]?.candidates[0]?.sourcePageType).toBe("lot");
      const dynamicSeeds = await planning.plannedSources[0]!.adapter.discoverCandidates(baseQuery);
      expect(dynamicSeeds[0]?.url).toBe("https://example-auctions.test/lot/abidin-dino-1234");
    } finally {
      process.env.SEARXNG_BASE_URL = priorSearxngBaseUrl;
    }
  });

  it("uses lane-aware host health dimensions and avoids global skips when rendered lanes are healthy", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        analysisMode: "balanced"
      },
      [
        adapter({
          id: "artam-auction-records",
          sourceName: "Artam",
          country: "Turkey",
          sourcePageType: "listing",
          crawlStrategies: ["search", "rendered_dom"],
          discoverCandidates: async () => [
            {
              url: "https://artam.com/en/archive?q=Artist",
              sourcePageType: "listing",
              provenance: "seed",
              score: 0.9
            }
          ]
        })
      ],
      new AuthManager([]),
      [
        healthRecord({
          host: "artam.com",
          total_attempts: 20,
          success_count: 0,
          failure_count: 20,
          consecutive_failures: 20,
          reliability_score: 0,
          last_failure_class: "transport_timeout",
          dimensions: {
            "artam-auction-records::cheap_fetch::anonymous": {
              source_family: "artam-auction-records",
              crawl_lane: "cheap_fetch",
              access_mode: "anonymous",
              total_attempts: 14,
              success_count: 0,
              blocked_count: 0,
              auth_required_count: 0,
              failure_count: 14,
              reliability_score: 0,
              last_status: "public_access",
              last_failure_class: "transport_timeout",
              last_attempt_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            "artam-auction-records::crawlee::anonymous": {
              source_family: "artam-auction-records",
              crawl_lane: "crawlee",
              access_mode: "anonymous",
              total_attempts: 6,
              success_count: 5,
              blocked_count: 0,
              auth_required_count: 0,
              failure_count: 1,
              reliability_score: 0.8333,
              last_status: "public_access",
              last_failure_class: null,
              last_attempt_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          }
        })
      ]
    );

    const sourcePlan = buildSourcePlanItems(plans, 24, "balanced");
    expect(sourcePlan[0]?.selection_state).toBe("selected");
    expect(sourcePlan[0]?.skip_reason).toBeNull();
  });

  it("uses family entrypoints without synthetic search urls for open-web hosts that do not advertise search endpoints", async () => {
    const priorSearxngBaseUrl = process.env.SEARXNG_BASE_URL;
    try {
      process.env.SEARXNG_BASE_URL = "http://127.0.0.1:8080";
      vi.stubGlobal("fetch", (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/search") && url.includes("format=json")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ url: "https://example-auction-openweb.test/" }]
            })
          } as Response;
        }
        throw new Error(`unexpected discovery fetch ${url}`);
      }) as typeof fetch);

      const planning = await planSourcesWithDiagnostics(
        {
          ...baseQuery,
          analysisMode: "balanced",
          preferredDiscoveryProviders: ["searxng"]
        },
        [],
        new AuthManager([])
      );

      expect(planning.plannedSources).toHaveLength(1);
      const urls = planning.plannedSources[0]?.candidates.map((candidate) => candidate.url) ?? [];
      expect(urls.some((url) => url.includes("/search") || url.includes("?q="))).toBe(false);
      expect(urls.some((url) => url.endsWith("/sitemap.xml"))).toBe(true);
      expect(urls.some((url) => url.endsWith("/robots.txt"))).toBe(true);
    } finally {
      process.env.SEARXNG_BASE_URL = priorSearxngBaseUrl;
    }
  });

  it("does not globally skip a host when lane-scoped health shows successful crawlee recovery", async () => {
    const now = new Date().toISOString();
    const plans = await planSources(
      {
        ...baseQuery,
        artist: "Abidin Dino",
        analysisMode: "comprehensive"
      },
      [
        adapter({
          id: "artam-auction-records",
          sourceName: "Artam",
          country: "Turkey",
          discoverCandidates: async () => [
            {
              url: "https://artam.com/en/auction-lot/abidin-dino-composition-123",
              sourcePageType: "lot",
              provenance: "listing_expansion",
              score: 0.9
            }
          ]
        })
      ],
      new AuthManager([]),
      [
        healthRecord({
          host: "artam.com",
          total_attempts: 18,
          success_count: 0,
          failure_count: 18,
          consecutive_failures: 18,
          reliability_score: 0,
          last_failure_class: "transport_timeout",
          dimensions: {
            "artam-auction-records::cheap_fetch::anonymous": {
              source_family: "artam-auction-records",
              crawl_lane: "cheap_fetch",
              access_mode: "anonymous",
              total_attempts: 12,
              success_count: 0,
              blocked_count: 0,
              auth_required_count: 0,
              failure_count: 12,
              reliability_score: 0,
              last_status: "public_access",
              last_failure_class: "transport_timeout",
              last_attempt_at: now,
              updated_at: now
            },
            "artam-auction-records::crawlee::anonymous": {
              source_family: "artam-auction-records",
              crawl_lane: "crawlee",
              access_mode: "anonymous",
              total_attempts: 6,
              success_count: 4,
              blocked_count: 0,
              auth_required_count: 0,
              failure_count: 2,
              reliability_score: 0.6667,
              last_status: "public_access",
              last_failure_class: null,
              last_attempt_at: now,
              updated_at: now
            }
          }
        })
      ]
    );

    const sourcePlan = buildSourcePlanItems(plans, 80, "comprehensive");
    expect(sourcePlan.find((item) => item.adapter_id === "artam-auction-records")?.selection_state).not.toBe("skipped");
  });

  it("respects family quota minimums in fast mode", async () => {
    const plans = await planSources(
      {
        ...baseQuery,
        analysisMode: "fast"
      },
      [
        adapter({ id: "artam-auction-records", sourceName: "Artam", country: "Turkey" }),
        adapter({ id: "muzayedeapp-platform", sourceName: "Muzayede App", country: "Turkey" }),
        adapter({ id: "sothebys-major", sourceName: "Sothebys", country: "United Kingdom" }),
        adapter({ id: "liveauctioneers-public-lot-adapter", sourceName: "LiveAuctioneers", country: "United States" }),
        adapter({ id: "overflow-1", sourceName: "Overflow 1", country: "Turkey" })
      ],
      new AuthManager([])
    );

    const sourcePlan = buildSourcePlanItems(plans, 12, "fast");
    const selected = sourcePlan.filter((item) => item.selection_state === "selected");
    expect(selected).toHaveLength(4);
    expect(selected.some((item) => item.adapter_id.includes("artam"))).toBe(true);
    expect(selected.some((item) => item.adapter_id.includes("muzayedeapp"))).toBe(true);
    expect(selected.some((item) => item.adapter_id.includes("sothebys"))).toBe(true);
    expect(selected.some((item) => item.adapter_id.includes("liveauctioneers"))).toBe(true);
  });
});
