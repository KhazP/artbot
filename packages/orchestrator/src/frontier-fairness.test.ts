import { describe, expect, it } from "vitest";
import {
  buildFairnessConfig,
  createRuntimeFairnessStats,
  scoreFrontierItem,
  type RuntimeFairnessStats
} from "./frontier-fairness.js";

function withStats(overrides: Partial<RuntimeFairnessStats>): RuntimeFairnessStats {
  return {
    ...createRuntimeFairnessStats(),
    ...overrides
  };
}

describe("frontier fairness scoring", () => {
  it("boosts under-covered families during warmup and penalizes over-share families", () => {
    const config = buildFairnessConfig("comprehensive");
    const stats = withStats({
      totalAttempts: 90,
      attemptsByFamily: {
        turkey_first_party: 45,
        global_marketplace: 2
      },
      blockedByFamily: {
        turkey_first_party: 3
      },
      evidenceByFamily: {
        turkey_first_party: 12
      },
      attemptsByHost: {
        "major.example": 24,
        "market.example": 2
      },
      evidenceByHost: {
        "major.example": 5
      },
      pricedByHost: {
        "major.example": 2
      }
    });

    const underCovered = scoreFrontierItem(
      {
        sourceFamilyBucket: "global_marketplace",
        sourceHost: "market.example",
        sourcePageType: "lot",
        provenance: "listing_expansion",
        baseScore: 0.8
      },
      stats,
      config
    );
    const overShared = scoreFrontierItem(
      {
        sourceFamilyBucket: "turkey_first_party",
        sourceHost: "major.example",
        sourcePageType: "listing",
        provenance: "seed",
        baseScore: 0.8
      },
      stats,
      config
    );

    expect(underCovered).toBeGreaterThan(overShared);
  });

  it("heavily penalizes blocked zero-yield families after pause threshold", () => {
    const config = buildFairnessConfig("comprehensive");
    const stats = withStats({
      totalAttempts: 180,
      attemptsByFamily: {
        global_direct_sale: 18
      },
      blockedByFamily: {
        global_direct_sale: 16
      },
      evidenceByFamily: {
        global_direct_sale: 0
      },
      attemptsByHost: {
        "blocked.example": 18
      },
      evidenceByHost: {},
      pricedByHost: {}
    });

    const pausedScore = scoreFrontierItem(
      {
        sourceFamilyBucket: "global_direct_sale",
        sourceHost: "blocked.example",
        sourcePageType: "listing",
        provenance: "seed",
        baseScore: 0.9
      },
      stats,
      config
    );

    expect(pausedScore).toBeLessThan(-5);
  });
});
