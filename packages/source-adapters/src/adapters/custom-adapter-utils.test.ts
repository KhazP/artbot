import { describe, expect, it } from "vitest";
import { extractHrefCandidates } from "./custom-adapter-utils.js";

describe("extractHrefCandidates", () => {
  it("normalizes fragment URLs and drops self-anchor noise", () => {
    const html = `
      <a href="#main">self-anchor</a>
      <a href="/urun-etiketi/tablo/#main">tablo-main</a>
      <a href="/urun-etiketi/tablo/#quick-view">tablo-quick</a>
      <a href="/urun-etiketi/tablo/page/2/">tablo-page-2</a>
      <a href="/urun-etiketi/tablo/feed/">tablo-feed</a>
    `;

    const candidates = extractHrefCandidates(
      html,
      "https://www.turelart.com/urun-etiketi/tablo/",
      "listing",
      "listing_expansion",
      0.7,
      [/\/urun-etiketi\/tablo/i]
    );

    expect(candidates.map((entry) => entry.url)).toEqual(["https://www.turelart.com/urun-etiketi/tablo/page/2/"]);
  });

  it("strips tracking params and deduplicates equivalent links", () => {
    const html = `
      <a href="https://example.com/lot/123?utm_source=x&fbclid=y">a</a>
      <a href="https://example.com/lot/123">b</a>
    `;

    const candidates = extractHrefCandidates(
      html,
      "https://example.com/search?q=test",
      "lot",
      "listing_expansion",
      0.8,
      [/\/lot\/\d+/i]
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe("https://example.com/lot/123");
  });

  it("drops low-value navigation and social links during discovery expansion", () => {
    const html = `
      <a href="https://www.instagram.com/example">instagram</a>
      <a href="/cart">cart</a>
      <a href="/giris21.html">login</a>
      <a href="/lot/123">lot</a>
    `;

    const candidates = extractHrefCandidates(
      html,
      "https://example.com/search?q=test",
      "lot",
      "listing_expansion",
      0.8,
      [/.*/]
    );

    expect(candidates.map((entry) => entry.url)).toEqual(["https://example.com/lot/123"]);
  });
});
