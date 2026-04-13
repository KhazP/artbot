import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateFixtureContract } from "./contract-harness.js";

const repoRoot = path.resolve(process.cwd(), "../..");
const fixture = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, "data/fixtures/adapters", relativePath), "utf-8");

describe("fixture contract harness", () => {
  it("keeps top source fixtures parseable and classifiable", () => {
    const fixtures = [
      { sourceName: "Muzayede App", sourcePageType: "lot" as const, path: "muzayedeapp/lot.html" },
      { sourceName: "Portakal", sourcePageType: "listing" as const, path: "portakal/listing.html" },
      { sourceName: "Clar", sourcePageType: "listing" as const, path: "clar/archive.html" },
      { sourceName: "Sanatfiyat", sourcePageType: "listing" as const, path: "sanatfiyat/licensed.html" },
      { sourceName: "Invaluable", sourcePageType: "lot" as const, path: "invaluable/lot.html" }
    ];

    for (const item of fixtures) {
      const result = evaluateFixtureContract({
        sourceName: item.sourceName,
        sourcePageType: item.sourcePageType,
        html: fixture(item.path),
        url: `https://fixture.local/${item.path}`
      });
      expect(result.acceptance.acceptanceReason).not.toBe("unknown_price_type");
      expect(
        result.parsed.priceType !== "unknown"
        || result.parsed.priceHidden
        || typeof result.parsed.priceAmount === "number"
        || typeof result.parsed.estimateLow === "number"
        || typeof result.parsed.estimateHigh === "number"
      ).toBe(true);
    }
  });
});
