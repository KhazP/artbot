import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { researchQuerySchema } from "@artbot/shared-types";
import type { AdapterExtractionContext, SourceCandidate } from "../types.js";
import { DeterministicVenueAdapter, detectMuzayedeSignature } from "./specialized-adapters.js";

const repoRoot = path.resolve(process.cwd(), "../../");

const fixture = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, "data/fixtures/adapters", relativePath), "utf-8");

const fetchMock = vi.hoisted(() => {
  const fixtureFromRoot = (relativePath: string): string =>
    fs.readFileSync(path.resolve(process.cwd(), "../../data/fixtures/adapters", relativePath), "utf-8");

  return vi.fn(async (url: string) => {
    if (url.includes("bayrakmuzayede") && /\/lot\//i.test(url)) {
      return {
        url,
        html: fixtureFromRoot("bayrak/lot.html"),
        markdown: fixtureFromRoot("bayrak/lot.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("bayrakmuzayede")) {
      return {
        url,
        html: fixtureFromRoot("bayrak/listing.html"),
        markdown: fixtureFromRoot("bayrak/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("muzayede") && (/\/lot\//i.test(url) || /\/eser\//i.test(url))) {
      return {
        url,
        html: fixtureFromRoot("muzayedeapp/lot.html"),
        markdown: fixtureFromRoot("muzayedeapp/lot.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("muzayede")) {
      return {
        url,
        html: fixtureFromRoot("muzayedeapp/listing.html"),
        markdown: fixtureFromRoot("muzayedeapp/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("portakal")) {
      return {
        url,
        html: fixtureFromRoot("portakal/listing.html"),
        markdown: fixtureFromRoot("portakal/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("clar-buy")) {
      return {
        url,
        html: fixtureFromRoot("clar/buy-now.html"),
        markdown: fixtureFromRoot("clar/buy-now.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("clar-archive")) {
      return {
        url,
        html: fixtureFromRoot("clar/archive.html"),
        markdown: fixtureFromRoot("clar/archive.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("turelart")) {
      return {
        url,
        html: fixtureFromRoot("turel/listing.html"),
        markdown: fixtureFromRoot("turel/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("antikasa")) {
      return {
        url,
        html: fixtureFromRoot("antikasa/lot.html"),
        markdown: fixtureFromRoot("antikasa/lot.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("sanatfiyat")) {
      return {
        url,
        html: fixtureFromRoot("sanatfiyat/licensed.html"),
        markdown: fixtureFromRoot("sanatfiyat/licensed.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("invaluable.com") && /\/auction-lot\/|\/lot\//i.test(url)) {
      return {
        url,
        html: fixtureFromRoot("invaluable/lot.html"),
        markdown: fixtureFromRoot("invaluable/lot.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("invaluable.com")) {
      return {
        url,
        html: fixtureFromRoot("invaluable/listing.html"),
        markdown: fixtureFromRoot("invaluable/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("liveauctioneers.com") && /\/item\/\d+|\/lot\//i.test(url)) {
      return {
        url,
        html: fixtureFromRoot("liveauctioneers/lot.html"),
        markdown: fixtureFromRoot("liveauctioneers/lot.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }
    if (url.includes("liveauctioneers.com")) {
      return {
        url,
        html: fixtureFromRoot("liveauctioneers/listing.html"),
        markdown: fixtureFromRoot("liveauctioneers/listing.html"),
        status: 200,
        parserUsed: "fixture-fetch"
      };
    }

    return {
      url,
      html: "<html><body>No price</body></html>",
      markdown: "No price",
      status: 200,
      parserUsed: "fixture-fetch"
    };
  });
});

vi.mock("@artbot/extraction", async () => {
  const parserModuleUrl = pathToFileURL(path.resolve(process.cwd(), "../extraction/src/lot-parser.ts")).href;
  const { parseGenericLotFields } = await import(parserModuleUrl);
  return {
    fetchCheapestFirst: fetchMock,
    parseGenericLotFields,
    extractWithGeminiSchema: vi.fn(async () => null)
  };
});

function context(
  mode: AdapterExtractionContext["accessContext"]["mode"],
  sourceAccessStatus: AdapterExtractionContext["accessContext"]["sourceAccessStatus"]
): AdapterExtractionContext {
  return {
    runId: "run-1",
    traceId: "trace-1",
    query: researchQuerySchema.parse({
      artist: "Burhan Dogancay",
      title: "Mavi Kompozisyon",
      scope: "turkey_plus_international",
      turkeyFirst: true,
      analysisMode: "balanced",
      priceNormalization: "usd_dual",
      manualLoginCheckpoint: false,
      allowLicensed: true,
      licensedIntegrations: ["Sanatfiyat"],
      crawlMode: "backfill",
      sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
    }),
    accessContext: {
      mode,
      sourceAccessStatus,
      allowLicensed: true,
      licensedIntegrations: ["Sanatfiyat"]
    },
    evidenceDir: "/tmp/artbot-specialized-test"
  };
}

function candidate(url: string, sourcePageType: SourceCandidate["sourcePageType"] = "listing"): SourceCandidate {
  return {
    url,
    sourcePageType,
    provenance: "seed",
    score: 0.9
  };
}

describe("specialized adapters", () => {
  it("detects Müzayede App signature", () => {
    expect(detectMuzayedeSignature(fixture("muzayedeapp/listing.html"), "https://example.com")).toBe(true);
    expect(detectMuzayedeSignature("<html>No signature</html>", "https://example.com")).toBe(false);
  });

  it("extracts Müzayede listing and discovers lot URLs", async () => {
    const adapter = new DeterministicVenueAdapter({
      id: "muzayede-test",
      sourceName: "Muzayede Test",
      venueName: "Muzayede",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: null,
      baseUrl: "https://muzayede.app",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i],
      signatureIndicators: ["powered by müzayede app"],
      venueRouteTemplates: ["/arama?q={q}", "/search?q={q}"],
      turkeyVenueHostPatterns: [/bayrakmuzayede/i, /turelart/i, /\.tr$/i]
    });

    const result = await adapter.extract(candidate("https://muzayede.app/search?q=dogancay"), context("anonymous", "public_access"));
    expect(result.discoveredCandidates?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect((result.discoveredCandidates ?? []).some((entry) => entry.url.includes("muzayede.app/lot/12345"))).toBe(true);
    expect(
      (result.discoveredCandidates ?? []).some((entry) => entry.url.includes("bayrakmuzayede.com/search?q="))
    ).toBe(true);
    expect(result.attempt.discovery_provenance).toBe("seed");
  });

  it("types Portakal and Clar pages correctly", async () => {
    const portakal = new DeterministicVenueAdapter({
      id: "portakal-test",
      sourceName: "Portakal",
      venueName: "Portakal",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://portakal.com",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const clarBuy = new DeterministicVenueAdapter({
      id: "clar-buy-test",
      sourceName: "Clar Buy",
      venueName: "Clar",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://clar-buy.test",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/urun\//i]
    });

    const clarArchive = new DeterministicVenueAdapter({
      id: "clar-archive-test",
      sourceName: "Clar Archive",
      venueName: "Clar",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://clar-archive.test",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const portakalResult = await portakal.extract(candidate("https://portakal.com/search?q=dogancay"), context("anonymous", "public_access"));
    expect(portakalResult.record?.price_type).toBe("asking_price");

    const clarBuyResult = await clarBuy.extract(candidate("https://clar-buy.test/search?q=dogancay"), context("anonymous", "public_access"));
    expect(clarBuyResult.record).toBeNull();
    expect(clarBuyResult.attempt.acceptance_reason).toBe("entity_mismatch");
    expect((clarBuyResult.discoveredCandidates ?? []).some((entry) => /\/urun\/4455$/i.test(entry.url))).toBe(true);

    const clarArchiveResult = await clarArchive.extract(candidate("https://clar-archive.test/search?q=dogancay"), context("anonymous", "public_access"));
    expect(clarArchiveResult.record).toBeNull();
    expect(clarArchiveResult.attempt.acceptance_reason).toBe("entity_mismatch");
    expect((clarArchiveResult.discoveredCandidates ?? []).some((entry) => /\/auction\/lot\/7788$/i.test(entry.url))).toBe(true);
  });

  it("rejects title-led entity mismatches even when the page mentions the query artist elsewhere", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      const html = `
        <html>
          <body>
            <h1>FERRUH BASAGA - KADIN PORTRESI</h1>
            <p>ABIDIN DINO 1913-1993 biyografi metni referans olarak asagida yer alir.</p>
            <p>Hemen Al: 320.000 TL</p>
          </body>
        </html>
      `;
      return {
        url,
        html,
        markdown: html,
        status: 200,
        parserUsed: "fixture-fetch"
      };
    });

    const adapter = new DeterministicVenueAdapter({
      id: "clar-buy-test",
      sourceName: "Clar Buy",
      venueName: "Clar",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://clar-buy.test",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/urun\//i]
    });

    const result = await adapter.extract(candidate("https://clar-buy.test/urun/4455", "lot"), context("anonymous", "public_access"));
    expect(result.attempt.accepted).toBe(false);
    expect(result.attempt.acceptance_reason).toBe("entity_mismatch");
    expect(result.record).toBeNull();
  });

  it("discovers Clar archive event pages and keeps them typed as listing pages", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      const html = `
        <html>
          <body>
            <a href="/muzayede/34308/karma-eserler-muzayedesi">Karma Eserler Muzayedesi</a>
            <a href="/canli-muzayede/34308/karma-eserler-muzayedesi">Canli Muzayede</a>
            <p>Estimate: 300.000 TL - 450.000 TL</p>
          </body>
        </html>
      `;
      return {
        url,
        html,
        markdown: html,
        status: 200,
        parserUsed: "fixture-fetch"
      };
    });

    const adapter = new DeterministicVenueAdapter({
      id: "clar-archive",
      sourceName: "Clar Archive",
      venueName: "Clar",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://clar-archive.test",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i, /\/muzayede\/\d+\//i, /\/canli-muzayede\/\d+\//i]
    });

    const result = await adapter.extract(candidate("https://clar-archive.test/search?q=dogancay"), context("anonymous", "public_access"));
    expect((result.discoveredCandidates ?? []).some((entry) => /\/muzayede\/34308\//i.test(entry.url))).toBe(true);
    expect((result.discoveredCandidates ?? []).some((entry) => /\/canli-muzayede\/34308\//i.test(entry.url))).toBe(true);
    expect(
      (result.discoveredCandidates ?? [])
        .filter((entry) => /34308/.test(entry.url))
        .every((entry) => entry.sourcePageType === "listing")
    ).toBe(true);
  });

  it("marks maintenance pages as blocked", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      const html = `
        <html>
          <body>
            <h1>We apologize for the inconvenience.</h1>
            <p>We are currently working to bring our website back online as soon as possible.</p>
          </body>
        </html>
      `;
      return {
        url,
        html,
        markdown: html,
        status: 200,
        parserUsed: "fixture-fetch"
      };
    });

    const adapter = new DeterministicVenueAdapter({
      id: "maintenance-test",
      sourceName: "Maintenance Source",
      venueName: "Maintenance",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "USA",
      city: "New York",
      baseUrl: "https://www.phillips.com",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const result = await adapter.extract(candidate("https://www.phillips.com/search?q=dogancay"), context("anonymous", "public_access"));
    expect(result.attempt.source_access_status).toBe("blocked");
    expect(result.attempt.acceptance_reason).toBe("blocked_access");
    expect(result.attempt.blocker_reason).toContain("maintenance");
    expect(result.record).toBeNull();
    expect(result.discoveredCandidates ?? []).toHaveLength(0);
  });

  it("enforces Sanatfiyat licensed mode transitions", async () => {
    const sanatfiyat = new DeterministicVenueAdapter({
      id: "sanatfiyat-test",
      sourceName: "Sanatfiyat",
      venueName: "Sanatfiyat",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://sanatfiyat.com",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/result\//i],
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    });

    const blocked = await sanatfiyat.extract(candidate("https://sanatfiyat.com/search?q=dogancay", "price_db"), context("anonymous", "blocked"));
    expect(blocked.attempt.source_access_status).toBe("blocked");
    expect(blocked.attempt.accepted).toBe(false);

    const licensed = await sanatfiyat.extract(candidate("https://sanatfiyat.com/search?q=dogancay", "price_db"), context("licensed", "licensed_access"));
    expect(licensed.attempt.source_access_status).toBe("licensed_access");
    expect(licensed.record?.price_type).toBe("realized_with_buyers_premium");
  });

  it("discovers Sanatfiyat artwork-detail pages from artist-detail pages", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      const html = `
        <html>
          <body>
            <h1>Abidin Dino</h1>
            <a href="https://sanatfiyat.com/artist/artwork-detail/138211/isimsiz">Isimsiz</a>
            <a href="https://sanatfiyat.com/artist/artwork-detail/138209/eller-serisinden">Eller Serisinden</a>
          </body>
        </html>
      `;
      return {
        url,
        html,
        markdown: html,
        status: 200,
        parserUsed: "fixture-fetch"
      };
    });

    const sanatfiyat = new DeterministicVenueAdapter({
      id: "sanatfiyat-licensed-extractor",
      sourceName: "Sanatfiyat",
      venueName: "Sanatfiyat",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://sanatfiyat.com",
      searchPaths: ["/search?q=", "/artist?q="],
      lotUrlMatchers: [/\/lot\//i, /\/result\//i, /\/eser\//i],
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    });

    const result = await sanatfiyat.extract(
      candidate("https://sanatfiyat.com/artist/artist-detail/95/abidin-dino", "artist_page"),
      context("licensed", "licensed_access")
    );

    expect(result.discoveredCandidates?.some((entry) => entry.url.includes("/artist/artwork-detail/138211/isimsiz"))).toBe(true);
    expect(
      result.discoveredCandidates?.find((entry) => entry.url.includes("/artist/artwork-detail/138209/eller-serisinden"))
        ?.sourcePageType
    ).toBe("lot");
  });

  it("parses Sanatfiyat opening-bid rows as asking prices when hammer columns are zero", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      const html = `
        <html>
          <body>
            <div class="title"><h3>Eser Fiyat Trend Analizi</h3></div>
            <table class="table table-striped table-inverse">
              <thead>
                <tr>
                  <th>Müzayede Tarihi</th>
                  <th>Açılış Fiyatı</th>
                  <th>Pey</th>
                  <th>TL</th>
                  <th>Çekiç Fiyatı USD</th>
                  <th>EUR</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>14-04-2024</td>
                  <td>55.000 TL</td>
                  <td>0</td>
                  <td>0 TL</td>
                  <td>0 USD</td>
                  <td>0 EUR</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `;
      return {
        url,
        html,
        markdown: html,
        status: 200,
        parserUsed: "fixture-fetch"
      };
    });

    const sanatfiyat = new DeterministicVenueAdapter({
      id: "sanatfiyat-licensed-extractor",
      sourceName: "Sanatfiyat",
      venueName: "Sanatfiyat",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://sanatfiyat.com",
      searchPaths: ["/search?q=", "/artist?q="],
      lotUrlMatchers: [/\/lot\//i, /\/result\//i, /\/eser\//i],
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    });

    const result = await sanatfiyat.extract(
      candidate("https://sanatfiyat.com/artist/artwork-detail/141936/", "lot"),
      context("licensed", "licensed_access")
    );

    expect(result.record?.price_type).toBe("asking_price");
    expect(result.record?.price_amount).toBe(55000);
    expect(result.record?.currency).toBe("TRY");
    expect(result.record?.accepted_for_valuation).toBe(true);
  });

  it("types Bayrak/Turel/Antikasa pages with strict semantics", async () => {
    const bayrakListing = new DeterministicVenueAdapter({
      id: "bayrak-listing-test",
      sourceName: "Bayrak Listing",
      venueName: "Bayrak",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://bayrakmuzayede.com",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const bayrakLot = new DeterministicVenueAdapter({
      id: "bayrak-lot-test",
      sourceName: "Bayrak Lot",
      venueName: "Bayrak",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://bayrakmuzayede.com",
      searchPaths: ["/lot?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const turelListing = new DeterministicVenueAdapter({
      id: "turel-listing-test",
      sourceName: "Turel Listing",
      venueName: "Turel",
      venueType: "gallery",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://turelart.com",
      searchPaths: ["/search?q="],
      lotUrlMatchers: [/\/tablo\//i]
    });

    const antikasaLot = new DeterministicVenueAdapter({
      id: "antikasa-lot-test",
      sourceName: "Antikasa Lot",
      venueName: "Antikasa",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://antikasa.com",
      searchPaths: ["/lot?q="],
      lotUrlMatchers: [/\/lot\//i]
    });

    const bayrakListingResult = await bayrakListing.extract(
      candidate("https://bayrakmuzayede.com/search?q=dogancay"),
      context("anonymous", "public_access")
    );
    expect(bayrakListingResult.record).toBeNull();
    expect(bayrakListingResult.attempt.acceptance_reason).toBe("entity_mismatch");
    expect((bayrakListingResult.discoveredCandidates ?? []).some((entry) => /\/lot\/7001$/i.test(entry.url))).toBe(true);
    expect(bayrakListingResult.attempt.canonical_url).toContain("bayrakmuzayede.com");
    expect(bayrakListingResult.attempt.raw_snapshot_path).toContain("/tmp/artbot-specialized-test");
    expect(bayrakListingResult.attempt.parser_used).toBe("fixture-fetch");

    const bayrakLotResult = await bayrakLot.extract(
      candidate("https://bayrakmuzayede.com/lot/7001", "lot"),
      context("anonymous", "public_access")
    );
    expect(bayrakLotResult.record?.price_type).toBe("hammer_price");
    expect(bayrakLotResult.record?.buyers_premium_included).toBe(false);

    const turelResult = await turelListing.extract(
      candidate("https://turelart.com/search?q=dogancay"),
      context("anonymous", "public_access")
    );
    expect(turelResult.record).toBeNull();
    expect(turelResult.attempt.acceptance_reason).toBe("entity_mismatch");
    expect(turelResult.attempt.canonical_url).toContain("turelart.com");

    const antikasaResult = await antikasaLot.extract(
      candidate("https://antikasa.com/lot/992", "lot"),
      context("anonymous", "public_access")
    );
    expect(antikasaResult.record?.price_type).toBe("realized_price");
    expect(antikasaResult.record?.estimate_low).toBe(750000);
    expect(antikasaResult.record?.estimate_high).toBe(980000);
    expect(antikasaResult.attempt.canonical_url).toContain("antikasa.com");
    expect(antikasaResult.attempt.parser_used).toBe("fixture-fetch");
  });

  it("extracts Invaluable and LiveAuctioneers lot-detail adapters", async () => {
    const invaluable = new DeterministicVenueAdapter({
      id: "invaluable-lot-detail-adapter",
      sourceName: "Invaluable Lot Detail",
      venueName: "Invaluable",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 3,
      country: null,
      city: null,
      baseUrl: "https://www.invaluable.com",
      searchPaths: ["/search?query="],
      lotUrlMatchers: [/\/auction-lot\//i, /\/lot\//i]
    });

    const liveauctioneers = new DeterministicVenueAdapter({
      id: "liveauctioneers-public-lot-adapter",
      sourceName: "LiveAuctioneers Public Lots",
      venueName: "LiveAuctioneers",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 3,
      country: null,
      city: null,
      baseUrl: "https://www.liveauctioneers.com",
      searchPaths: ["/search/?keyword="],
      lotUrlMatchers: [/\/item\/\d+/i, /\/lot\//i]
    });

    const invaluableListing = await invaluable.extract(
      candidate("https://www.invaluable.com/search?query=dogancay"),
      context("anonymous", "public_access")
    );
    expect((invaluableListing.discoveredCandidates ?? []).some((entry) => /auction-lot/i.test(entry.url))).toBe(true);

    const invaluableLot = await invaluable.extract(
      candidate("https://www.invaluable.com/auction-lot/burhan-dogancay-mavi-kompozisyon-55-c-ABCD1234", "lot"),
      context("anonymous", "public_access")
    );
    expect(invaluableLot.record?.price_type).toBe("realized_price");
    expect(invaluableLot.record?.currency).toBe("USD");
    expect(invaluableLot.record?.price_amount).toBe(18500);

    const liveListing = await liveauctioneers.extract(
      candidate("https://www.liveauctioneers.com/search/?keyword=dogancay"),
      context("anonymous", "public_access")
    );
    expect((liveListing.discoveredCandidates ?? []).some((entry) => /\/item\/\d+/i.test(entry.url))).toBe(true);

    const liveLot = await liveauctioneers.extract(
      candidate("https://www.liveauctioneers.com/item/198765432-burhan-dogancay-mavi-kompozisyon", "lot"),
      context("anonymous", "public_access")
    );
    expect(liveLot.record?.price_type).toBe("realized_price");
    expect(liveLot.record?.currency).toBe("USD");
    expect(liveLot.record?.price_amount).toBe(11750);
  });

  it("meets fixture-level 2x coverage uplift target", async () => {
    const adapterRuns: Array<{ adapter: DeterministicVenueAdapter; seedUrl: string }> = [
      {
        adapter: new DeterministicVenueAdapter({
          id: "muzayede-test",
          sourceName: "Muzayede Test",
          venueName: "Muzayede",
          venueType: "marketplace",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: null,
          baseUrl: "https://muzayede.app",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/lot\//i, /\/eser\//i]
        }),
        seedUrl: "https://muzayede.app/search?q=dogancay"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "portakal-test",
          sourceName: "Portakal",
          venueName: "Portakal",
          venueType: "auction_house",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://portakal.com",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/lot\//i]
        }),
        seedUrl: "https://portakal.com/search?q=dogancay"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "bayrak-listing-test",
          sourceName: "Bayrak Listing",
          venueName: "Bayrak",
          venueType: "auction_house",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://bayrakmuzayede.com",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/lot\//i]
        }),
        seedUrl: "https://bayrakmuzayede.com/search?q=dogancay"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "clar-buy-test",
          sourceName: "Clar Buy",
          venueName: "Clar",
          venueType: "auction_house",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://clar-buy.test",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/urun\//i]
        }),
        seedUrl: "https://clar-buy.test/search?q=dogancay"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "turel-listing-test",
          sourceName: "Turel Listing",
          venueName: "Turel",
          venueType: "gallery",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://turelart.com",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/tablo\//i]
        }),
        seedUrl: "https://turelart.com/search?q=dogancay"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "antikasa-lot-test",
          sourceName: "Antikasa Lot",
          venueName: "Antikasa",
          venueType: "auction_house",
          sourcePageType: "lot",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://antikasa.com",
          searchPaths: ["/lot?q="],
          lotUrlMatchers: [/\/lot\//i]
        }),
        seedUrl: "https://antikasa.com/lot/992"
      },
      {
        adapter: new DeterministicVenueAdapter({
          id: "clar-archive-test",
          sourceName: "Clar Archive",
          venueName: "Clar",
          venueType: "auction_house",
          sourcePageType: "listing",
          tier: 1,
          country: "Turkey",
          city: "Istanbul",
          baseUrl: "https://clar-archive.test",
          searchPaths: ["/search?q="],
          lotUrlMatchers: [/\/lot\//i]
        }),
        seedUrl: "https://clar-archive.test/search?q=dogancay"
      }
    ];

    let accepted = 0;
    const seen = new Set<string>();

    for (const run of adapterRuns) {
      const queue: SourceCandidate[] = [candidate(run.seedUrl)];

      while (queue.length > 0) {
        const next = queue.shift() as SourceCandidate;
        if (seen.has(next.url)) continue;
        seen.add(next.url);

        const result = await run.adapter.extract(next, context("anonymous", "public_access"));
        if (result.attempt.accepted && result.record) {
          accepted += 1;
        }

        for (const discovered of result.discoveredCandidates ?? []) {
          if (!seen.has(discovered.url)) {
            queue.push(discovered);
          }
        }
      }
    }

    expect(accepted).toBeGreaterThanOrEqual(2);
    expect(seen.has("https://muzayede.app/lot/12345")).toBe(true);
    expect(seen.has("https://bayrakmuzayede.com/lot/7001")).toBe(true);
    expect(seen.has("https://clar-buy.test/urun/4455")).toBe(true);
    expect([...seen].some((url) => url.includes(".oembed"))).toBe(false);
  });
});
