import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGenericLotFields } from "./lot-parser.js";

describe("parseGenericLotFields numeric normalization", () => {
  it("parses US thousands+decimal format", () => {
    const parsed = parseGenericLotFields("Realized: USD 1,200.50");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBeCloseTo(1200.5, 6);
    expect(parsed.currency).toBe("USD");
  });

  it("parses EU thousands+decimal format", () => {
    const parsed = parseGenericLotFields("Realized: EUR 1.200,50");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBeCloseTo(1200.5, 6);
    expect(parsed.currency).toBe("EUR");
  });

  it("parses dotted thousands format", () => {
    const parsed = parseGenericLotFields("Realized: 100.000 TL");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBe(100000);
    expect(parsed.currency).toBe("TRY");
  });

  it("parses Artam-style fixture with realized + estimate semantics", () => {
    const fixturePath = path.resolve(process.cwd(), "../../data/fixtures/adapters/artam/listing.html");
    const parsed = parseGenericLotFields(fs.readFileSync(fixturePath, "utf-8"));

    expect(parsed.artistName).toContain("Doğançay");
    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBe(1050000);
    expect(parsed.currency).toBe("TRY");
    expect(parsed.estimateLow).toBe(900000);
    expect(parsed.estimateHigh).toBe(1200000);
  });

  it("parses AlifArt-style fixture with asking-price semantics", () => {
    const fixturePath = path.resolve(process.cwd(), "../../data/fixtures/adapters/alifart/listing.html");
    const parsed = parseGenericLotFields(fs.readFileSync(fixturePath, "utf-8"));

    expect(parsed.artistName).toContain("Doğançay");
    expect(parsed.priceType).toBe("asking_price");
    expect(parsed.priceAmount).toBe(45000);
    expect(parsed.currency).toBe("USD");
    expect(parsed.lotNumber).toBe("72");
  });

  it("prefers pricing JSON-LD block when multiple scripts exist", () => {
    const content = `
      <html>
        <head>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"WebSite","name":"Auction Portal"}
          </script>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","name":"Doğançay Composition","offers":{"price":"45000","priceCurrency":"USD"}}
          </script>
        </head>
      </html>
    `;

    const parsed = parseGenericLotFields(content);

    expect(parsed.title).toBe("Doğançay Composition");
    expect(parsed.priceType).toBe("asking_price");
    expect(parsed.priceAmount).toBe(45000);
    expect(parsed.currency).toBe("USD");
  });
});
