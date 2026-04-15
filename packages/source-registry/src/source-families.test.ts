import { describe, expect, it } from "vitest";
import { buildEntrypointsForHost } from "./source-families.js";

describe("buildEntrypointsForHost", () => {
  it("does not emit unverified search seeds when search is not explicitly supported", () => {
    const entrypoints = buildEntrypointsForHost(
      "invaluable.com",
      "https://www.invaluable.com/artist/abidine-dino-c5plzo7nwe/",
      false
    );

    expect(entrypoints.some((url) => /\/search\b/i.test(url))).toBe(false);
  });

  it("emits verified search paths when search support is enabled", () => {
    const entrypoints = buildEntrypointsForHost(
      "muzayede.app",
      "https://www.muzayede.app/acik-muzayedeler.html",
      true
    );

    expect(entrypoints.some((url) => url.includes("/arama.html?search_words="))).toBe(true);
  });
});
