import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
  const actual = await vi.importActual<typeof import("@artbot/extraction")>("@artbot/extraction");
  return {
    ...actual,
    fetchCheapestFirst: fetchMock,
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
    query: {
      artist: "Burhan Dogancay",
      title: "Mavi Kompozisyon",
      scope: "turkey_plus_international",
      turkeyFirst: true,
      manualLoginCheckpoint: false,
      allowLicensed: true,
      licensedIntegrations: ["Sanatfiyat"]
    },
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
    expect(
      (result.discoveredCandidates ?? []).every((entry) => entry.url.includes("muzayede.app"))
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
    expect(clarBuyResult.record?.price_type).toBe("asking_price");

    const clarArchiveResult = await clarArchive.extract(candidate("https://clar-archive.test/search?q=dogancay"), context("anonymous", "public_access"));
    expect(["realized_price", "estimate"]).toContain(clarArchiveResult.record?.price_type);
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
    expect(bayrakListingResult.record?.price_type).toBe("estimate");
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
    expect(turelResult.record?.price_type).toBe("inquiry_only");
    expect(turelResult.record?.price_hidden).toBe(true);
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

    const baselineAccepted = 2;
    expect(accepted).toBeGreaterThanOrEqual(baselineAccepted * 2);
  });
});
