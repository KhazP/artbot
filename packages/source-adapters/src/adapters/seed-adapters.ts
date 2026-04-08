import { GenericSourceAdapter } from "./generic-adapter.js";

export function buildSeedAdapters() {
  return [
    new GenericSourceAdapter({
      id: "artam-auction-records",
      sourceName: "Artam Auction Records",
      venueName: "Artam Antik A.S.",
      venueType: "auction_house",
      sourcePageType: "price_db",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://artam.com",
      searchPath: "/en/search?q="
    }),
    new GenericSourceAdapter({
      id: "artam-lot",
      sourceName: "Artam Lots",
      venueName: "Artam Antik A.S.",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://artam.com",
      searchPath: "/search?q="
    }),
    new GenericSourceAdapter({
      id: "alifart-lot",
      sourceName: "Alif Art",
      venueName: "Alif Art",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://alifart.com.tr",
      searchPath: "/?s="
    }),
    new GenericSourceAdapter({
      id: "turkish-auction-generic",
      sourceName: "Turkish Auction Generic",
      venueName: "Turkey Market",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 2,
      country: "Turkey",
      city: null,
      baseUrl: "https://www.google.com",
      searchPath: "/search?q=site:tr+"
    }),
    new GenericSourceAdapter({
      id: "sothebys-lot",
      sourceName: "Sothebys",
      venueName: "Sothebys",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: null,
      city: null,
      baseUrl: "https://www.sothebys.com",
      searchPath: "/en/search?query="
    }),
    new GenericSourceAdapter({
      id: "christies-lot",
      sourceName: "Christies",
      venueName: "Christies",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: null,
      city: null,
      baseUrl: "https://www.christies.com",
      searchPath: "/en/search?entry="
    }),
    new GenericSourceAdapter({
      id: "bonhams-lot",
      sourceName: "Bonhams",
      venueName: "Bonhams",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: null,
      city: null,
      baseUrl: "https://www.bonhams.com",
      searchPath: "/search/?q="
    }),
    new GenericSourceAdapter({
      id: "phillips-lot",
      sourceName: "Phillips",
      venueName: "Phillips",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: null,
      city: null,
      baseUrl: "https://www.phillips.com",
      searchPath: "/search/"
    }),
    new GenericSourceAdapter({
      id: "artsy-probe",
      sourceName: "Artsy",
      venueName: "Artsy Price Database",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://www.artsy.net",
      searchPath: "/search?term=",
      requiresAuth: true
    }),
    new GenericSourceAdapter({
      id: "mutualart-probe",
      sourceName: "MutualArt",
      venueName: "MutualArt",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://www.mutualart.com",
      searchPath: "/Search/",
      requiresAuth: true
    }),
    new GenericSourceAdapter({
      id: "askart-probe",
      sourceName: "askART",
      venueName: "askART",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://www.askart.com",
      searchPath: "/artist/",
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    }),
    new GenericSourceAdapter({
      id: "invaluable-listing",
      sourceName: "Invaluable",
      venueName: "Invaluable",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 2,
      country: null,
      city: null,
      baseUrl: "https://www.invaluable.com",
      searchPath: "/search?query="
    })
  ];
}
