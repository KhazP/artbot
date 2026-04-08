import { describe, expect, it } from "vitest";
import { buildQueryVariants, expandCandidatesLight } from "./discovery.js";

const query = {
  artist: "Burhan Dogancay",
  title: "Mavi Kompozisyon",
  scope: "turkey_plus_international" as const,
  turkeyFirst: true,
  manualLoginCheckpoint: false,
  allowLicensed: false,
  licensedIntegrations: []
};

describe("discovery", () => {
  it("builds multilingual query variants", () => {
    const variants = buildQueryVariants(query, 4);
    expect(variants.length).toBe(4);
    expect(variants.some((variant) => variant.includes("tablo"))).toBe(true);
    expect(variants.some((variant) => variant.includes("painting"))).toBe(true);
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
        domainThrottlePerSource: 5
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
        domainThrottlePerSource: 4
      }
    );

    expect(expanded[0].url).toContain("bayrakmuzayede.com");
    expect(expanded[0].score).toBeGreaterThanOrEqual(expanded[1].score);
  });
});
