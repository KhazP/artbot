import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateFixtureContract } from "./contract-harness.js";

const repoRoot = path.resolve(process.cwd(), "../..");
const fixture = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, "data/fixtures/adapters", relativePath), "utf-8");

describe("fixture contract harness", () => {
  const fixtures = [
    { sourceName: "Muzayede App", sourcePageType: "lot" as const, path: "muzayedeapp/lot.html", expectsPriceSignal: true },
    { sourceName: "Muzayede App", sourcePageType: "listing" as const, path: "muzayedeapp/listing.html", expectsPriceSignal: false },
    { sourceName: "Bayrak", sourcePageType: "listing" as const, path: "bayrak/listing.html", expectsPriceSignal: true },
    { sourceName: "Türel", sourcePageType: "listing" as const, path: "turel/listing.html", expectsPriceSignal: true },
    { sourceName: "Portakal", sourcePageType: "listing" as const, path: "portakal/listing.html", expectsPriceSignal: true },
    { sourceName: "Clar", sourcePageType: "listing" as const, path: "clar/archive.html", expectsPriceSignal: true },
    { sourceName: "Sanatfiyat", sourcePageType: "listing" as const, path: "sanatfiyat/licensed.html", expectsPriceSignal: true },
    { sourceName: "Invaluable", sourcePageType: "lot" as const, path: "invaluable/lot.html", expectsPriceSignal: true },
    { sourceName: "LiveAuctioneers", sourcePageType: "lot" as const, path: "liveauctioneers/lot.html", expectsPriceSignal: true }
  ];

  it.each(fixtures)("keeps $path parseable and classifiable", (item) => {
    const result = evaluateFixtureContract({
      sourceName: item.sourceName,
      sourcePageType: item.sourcePageType,
      html: fixture(item.path),
      url: `https://fixture.local/${item.path}`
    });
    if (item.expectsPriceSignal) {
      expect(
        result.parsed.priceType !== "unknown"
        || result.parsed.priceHidden
        || typeof result.parsed.priceAmount === "number"
        || typeof result.parsed.estimateLow === "number"
        || typeof result.parsed.estimateHigh === "number"
      ).toBe(true);
      return;
    }

    expect(fixture(item.path)).toMatch(/\/(?:lot|eser|urun)\//i);
  });
});
