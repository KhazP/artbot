export type SourceFamilyBucket =
  | "turkey_first_party"
  | "turkey_platform"
  | "turkey_gallery_shop_private_sale"
  | "global_major"
  | "global_marketplace"
  | "global_direct_sale"
  | "db_meta"
  | "open_web";

export interface SourceFamilyPack {
  id: string;
  bucket: SourceFamilyBucket;
  trust_tier: "high" | "medium" | "low";
  legal_posture: "public_permitted" | "public_contract_sensitive" | "auth_required" | "licensed_only";
  supported_surfaces: string[];
  host_patterns: string[];
  query_lexicon: string[];
  supports_search_endpoints: boolean;
  entry_paths: string[];
  verified_search_paths?: string[];
  crawl_budget: {
    max_requests_per_candidate: number;
    max_pages_per_candidate: number;
    max_depth: number;
  };
}

const SOURCE_FAMILY_PACKS: SourceFamilyPack[] = [
  {
    id: "turkey-first-party-auctions",
    bucket: "turkey_first_party",
    trust_tier: "high",
    legal_posture: "public_permitted",
    supported_surfaces: ["auction_result", "auction_catalog", "artist_page"],
    host_patterns: [
      "rportakal.com",
      "clarmuzayede.com",
      "bayrakmuzayede.com",
      "antikasa.com",
      "turelart.com",
      "alifart.com.tr"
    ],
    query_lexicon: ["muzayede sonucu", "auction result", "lot", "archive", "artist"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/archive", "/arsiv", "/catalog", "/artists"],
    crawl_budget: { max_requests_per_candidate: 12, max_pages_per_candidate: 4, max_depth: 2 }
  },
  {
    id: "artam-auction-family",
    bucket: "turkey_first_party",
    trust_tier: "high",
    legal_posture: "public_permitted",
    supported_surfaces: ["auction_result", "auction_catalog", "artist_page"],
    host_patterns: ["artam.com"],
    query_lexicon: ["muzayede sonucu", "auction result", "lot", "archive", "artist"],
    supports_search_endpoints: false,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/muzayede"],
    crawl_budget: { max_requests_per_candidate: 12, max_pages_per_candidate: 4, max_depth: 2 }
  },
  {
    id: "turkey-platform-ecosystem",
    bucket: "turkey_platform",
    trust_tier: "high",
    legal_posture: "public_contract_sensitive",
    supported_surfaces: ["auction_catalog", "marketplace_listing", "shop"],
    host_patterns: ["muzayede.app"],
    query_lexicon: ["müzayede", "hemen al", "listing", "catalog"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/arama.html", "/arama.html?search_words=", "/hemen-al", "/muzayede-arsivi"],
    verified_search_paths: ["/arama.html?search_words="],
    crawl_budget: { max_requests_per_candidate: 12, max_pages_per_candidate: 4, max_depth: 2 }
  },
  {
    id: "turkey-gallery-private-sale-shop",
    bucket: "turkey_gallery_shop_private_sale",
    trust_tier: "medium",
    legal_posture: "public_permitted",
    supported_surfaces: ["gallery_inventory", "private_sale", "shop", "marketplace_listing"],
    host_patterns: ["leylart.com", "pgart.com", "gallery", "galeri"],
    query_lexicon: ["gallery", "private sale", "shop", "sold"],
    supports_search_endpoints: false,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/artists", "/works", "/catalog"],
    crawl_budget: { max_requests_per_candidate: 10, max_pages_per_candidate: 3, max_depth: 2 }
  },
  {
    id: "global-major-houses",
    bucket: "global_major",
    trust_tier: "high",
    legal_posture: "public_contract_sensitive",
    supported_surfaces: ["auction_result", "auction_catalog", "private_sale", "artist_page"],
    host_patterns: ["sothebys.com", "christies.com", "phillips.com", "bonhams.com", "dorotheum.com", "lempertz.com"],
    query_lexicon: ["auction result", "private sale", "catalog", "lot"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/en/results", "/en/buy", "/auctions"],
    crawl_budget: { max_requests_per_candidate: 10, max_pages_per_candidate: 3, max_depth: 2 }
  },
  {
    id: "global-marketplaces",
    bucket: "global_marketplace",
    trust_tier: "high",
    legal_posture: "public_permitted",
    supported_surfaces: ["marketplace_listing", "auction_result", "auction_catalog", "artist_page"],
    host_patterns: ["liveauctioneers.com", "invaluable.com", "bidsquare.com"],
    query_lexicon: ["auction result", "artist", "listing", "lot"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/search", "/auctions", "/artists"],
    crawl_budget: { max_requests_per_candidate: 12, max_pages_per_candidate: 4, max_depth: 2 }
  },
  {
    id: "global-direct-sale",
    bucket: "global_direct_sale",
    trust_tier: "medium",
    legal_posture: "public_contract_sensitive",
    supported_surfaces: ["marketplace_listing", "gallery_inventory", "shop", "private_sale"],
    host_patterns: ["1stdibs.com", "saatchiart.com", "artsy.net"],
    query_lexicon: ["buy now", "asking price", "inventory", "sold"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/artworks", "/art", "/search"],
    crawl_budget: { max_requests_per_candidate: 10, max_pages_per_candidate: 4, max_depth: 2 }
  },
  {
    id: "databases-meta-search",
    bucket: "db_meta",
    trust_tier: "medium",
    legal_posture: "public_contract_sensitive",
    supported_surfaces: ["price_db", "aggregator", "artist_page", "auction_result"],
    host_patterns: ["barnebys.com", "mutualart.com", "askart.com", "sanatfiyat.com", "artprice.com"],
    query_lexicon: ["price database", "results", "artist profile"],
    supports_search_endpoints: true,
    entry_paths: ["/", "/sitemap.xml", "/robots.txt", "/search", "/artist", "/artists"],
    crawl_budget: { max_requests_per_candidate: 8, max_pages_per_candidate: 3, max_depth: 2 }
  }
];

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isSearchPath(path: string): boolean {
  return /(\/search|\/arama|[?&](?:q|query|term|search|search_words)=)/i.test(path);
}

function valueMatchesHostPattern(value: string, pattern: string): boolean {
  const normalizedValue = normalizeHost(value);
  const normalizedPattern = normalizeHost(pattern);
  return normalizedValue === normalizedPattern || normalizedValue.endsWith(`.${normalizedPattern}`);
}

export function listSourceFamilyPacks(): SourceFamilyPack[] {
  return SOURCE_FAMILY_PACKS;
}

export function resolveFamilyPackByHost(host: string): SourceFamilyPack | null {
  const normalizedHost = normalizeHost(host);
  for (const pack of SOURCE_FAMILY_PACKS) {
    if (pack.host_patterns.some((pattern) => valueMatchesHostPattern(normalizedHost, pattern))) {
      return pack;
    }
  }
  return null;
}

export function inferSourceFamilyBucket(input: {
  sourceFamily?: string | null;
  sourceName?: string | null;
  hosts?: string[];
}): SourceFamilyBucket {
  const candidates = [
    input.sourceFamily ?? "",
    input.sourceName ?? "",
    ...(input.hosts ?? [])
  ]
    .join(" ")
    .toLowerCase();

  for (const pack of SOURCE_FAMILY_PACKS) {
    if (
      pack.host_patterns.some((pattern) => {
        const normalizedPattern = normalizeHost(pattern);
        const stemmedPattern = normalizedPattern.replace(/\.(?:com|net|org|co|io|tr|art|app)$/i, "");
        return candidates.includes(normalizedPattern) || candidates.includes(stemmedPattern);
      })
    ) {
      return pack.bucket;
    }
  }

  return "open_web";
}

export function buildEntrypointsForHost(host: string, discoveredUrl: string, supportsSearch: boolean): string[] {
  const normalizedHost = normalizeHost(host);
  const pack = resolveFamilyPackByHost(normalizedHost);
  const allowUnverifiedSearchSeeds = process.env.ALLOW_UNVERIFIED_SEARCH_SEEDS === "true";
  const paths = pack?.entry_paths ?? ["/", "/sitemap.xml", "/robots.txt", "/archive", "/catalog", "/artists"];
  const verifiedSearchPaths = new Set((pack?.verified_search_paths ?? []).map((path) => normalizePath(path)));
  const urls = new Set<string>();
  urls.add(discoveredUrl);
  for (const item of paths) {
    const path = normalizePath(item);
    const shouldSkipUnverifiedSearch =
      !supportsSearch &&
      isSearchPath(path) &&
      !verifiedSearchPaths.has(path) &&
      !allowUnverifiedSearchSeeds;
    if (shouldSkipUnverifiedSearch) {
      continue;
    }
    urls.add(`https://${normalizedHost}${path}`);
  }
  return [...urls];
}
