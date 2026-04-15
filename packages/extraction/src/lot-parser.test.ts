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

  it("extracts sale price and currency from non-JSON-LD script payloads", () => {
    const content = `
      <html>
        <body>
          <script>
            window.__NUXT__ = {
              lot: {
                "lotNumber": "218",
                "salePrice": "1.250.000",
                "currency": "TRY",
                "saleDate": "2020-10-11"
              }
            };
          </script>
        </body>
      </html>
    `;

    const parsed = parseGenericLotFields(content);
    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBe(1250000);
    expect(parsed.currency).toBe("TRY");
    expect(parsed.lotNumber).toBe("218");
    expect(parsed.saleDate).toBe("2020-10-11");
  });

  it("extracts estimate ranges from non-JSON-LD script payloads", () => {
    const content = `
      <html>
        <body>
          <script>
            window.__APP_DATA__ = {
              "estimateLow": "45,000",
              "estimateHigh": "65,000",
              "priceCurrency": "USD"
            };
          </script>
        </body>
      </html>
    `;

    const parsed = parseGenericLotFields(content);
    expect(parsed.priceType).toBe("estimate");
    expect(parsed.estimateLow).toBe(45000);
    expect(parsed.estimateHigh).toBe(65000);
    expect(parsed.currency).toBe("USD");
  });

  it("extracts estimate ranges from unquoted Next.js payload fields", () => {
    const content = `
      <html>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"lotData":{"auctionLots":[{"price":{"GBPHighEstimate":52486.05,"GBPLowEstimate":36740.24,"estimateHigh":100000,"estimateLow":70000,"hammerPrice":0}}]}}}}
          </script>
        </body>
      </html>
    `;

    const parsed = parseGenericLotFields(content);
    expect(parsed.priceType).toBe("estimate");
    expect(parsed.estimateLow).toBe(70000);
    expect(parsed.estimateHigh).toBe(100000);
  });

  it("parses Artam JSON detail payloads with hidden-price marker", () => {
    const content = JSON.stringify({
      status: true,
      product: {
        id: 60455,
        artistName: "Abidin Dino (1913-1993)",
        name: "Untitled",
        lotno: "112",
        auction_price: 0,
        opening_price: "15000.00",
        estimatedMin: "60000.00",
        estimatedMax: "90000.00",
        isShowPrice: false,
        currency: {
          code: "TRY"
        }
      }
    });

    const parsed = parseGenericLotFields(content);
    expect(parsed.artistName).toContain("Abidin Dino");
    expect(parsed.title).toBe("Untitled");
    expect(parsed.lotNumber).toBe("112");
    expect(parsed.priceType).toBe("estimate");
    expect(parsed.estimateLow).toBe(60000);
    expect(parsed.estimateHigh).toBe(90000);
    expect(parsed.currency).toBe("TRY");
    expect(parsed.priceHidden).toBe(true);
  });

  it("treats inquiry-only pages with Shopify placeholder pricing as inquiry_only", () => {
    const content = `
      <html>
        <head>
          <title>ABIDIN DINO - PEYZAJ</title>
        </head>
        <body>
          <h1>ABIDIN DINO - PEYZAJ</h1>
          <span>Fiyat istek üzerine verilir. Daha fazla bilgi için lütfen bize ulasin.</span>
          <select>
            <option>Default Title - 1.00TL</option>
          </select>
          <script>
            window.ShopifyAnalytics = {
              meta: {
                product: {
                  variants: [{ price: 100 }]
                }
              }
            };
          </script>
        </body>
      </html>
    `;

    const parsed = parseGenericLotFields(content);
    expect(parsed.priceType).toBe("inquiry_only");
    expect(parsed.priceAmount).toBeNull();
    expect(parsed.estimateLow).toBeNull();
    expect(parsed.estimateHigh).toBeNull();
    expect(parsed.currency).toBeNull();
    expect(parsed.priceHidden).toBe(true);
  });

  it("does not infer asking_price from site chrome currency without numeric pricing", () => {
    const content = `
      <html>
        <head>
          <title>Artist Listing</title>
          <meta property="og:title" content="Artist Listing" />
        </head>
        <body>
          <header>
            <a href="/currency">TRY</a>
            <a href="/currency">USD</a>
          </header>
          <main>
            <h1>Artist Listing</h1>
            <p>Biography and exhibition history only.</p>
          </main>
        </body>
      </html>
    `;

    const parsed = parseGenericLotFields(content);
    expect(parsed.priceType).toBe("unknown");
    expect(parsed.priceAmount).toBeNull();
    expect(parsed.currency).toBeNull();
  });
});
