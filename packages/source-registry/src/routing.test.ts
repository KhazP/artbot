import { describe, expect, it } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import { researchQuerySchema } from "@artbot/shared-types";
import type { SourceAdapter } from "@artbot/source-adapters";
import { planSources } from "./routing.js";

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

function adapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id: "a1",
    sourceName: "Source",
    venueName: "Venue",
    venueType: "database",
    sourcePageType: "price_db",
    tier: 2,
    country: null,
    city: null,
    requiresAuth: false,
    requiresLicense: false,
    supportedAccessModes: ["anonymous", "authorized", "licensed"],
    crawlStrategies: ["search"],
    discoverCandidates: async () => [
      { url: "https://example.com/search?q=artist", sourcePageType: "price_db", provenance: "seed", score: 0.9 }
    ],
    extract: async () => {
      throw new Error("not used");
    },
    ...overrides
  };
}

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
});
