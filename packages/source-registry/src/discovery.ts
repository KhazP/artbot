import type { DiscoveryProviderDiagnostics, DiscoveryProviderName, ResearchQuery, SourcePageType } from "@artbot/shared-types";
import type { SourceCandidate } from "@artbot/source-adapters";

export interface DiscoveryConfig {
  enabled: boolean;
  maxCandidatesPerSource: number;
  maxQueryVariants: number;
  domainThrottlePerSource: number;
  maxDiscoveredDomainsPerRun: number;
  maxUrlsPerDiscoveredDomain: number;
  maxTotalCandidatesPerRun: number;
  webDiscoveryEnabled: boolean;
  webDiscoveryProvider: DiscoveryProviderName;
  webDiscoverySecondaryProvider?: DiscoveryProviderName;
  webDiscoveryApiKey?: string;
  webDiscoverySecondaryApiKey?: string;
  searxngBaseUrl?: string;
  webDiscoveryDiagnostics?: DiscoveryProviderDiagnostics[];
  webDiscoveryAllowHostRegex?: string;
  webDiscoveryBlockHostTokens: string[];
  webDiscoveryPreferredHostTokens?: string[];
  webDiscoveryLowQualityHostTokens?: string[];
  webDiscoveryMinHostQualityScore?: number;
}

interface DiscoveryProfileDefaults {
  maxCandidatesPerSource: number;
  maxQueryVariants: number;
  domainThrottlePerSource: number;
  maxDiscoveredDomainsPerRun: number;
  maxUrlsPerDiscoveredDomain: number;
  maxTotalCandidatesPerRun: number;
}

interface BraveSearchResult {
  url?: string;
}

interface BraveSearchPayload {
  web?: {
    results?: BraveSearchResult[];
  };
}

interface TavilySearchPayload {
  results?: Array<{ url?: string }>;
}

interface SearxngSearchPayload {
  results?: Array<{ url?: string }>;
}

interface DiscoveryProviderClient {
  name: Exclude<DiscoveryProviderName, "none">;
  configured(config: DiscoveryConfig): boolean;
  search(variant: string, config: DiscoveryConfig, fetchImpl: typeof fetch): Promise<string[]>;
}

interface ProviderDiagnosticsAccumulator {
  provider: Exclude<DiscoveryProviderName, "none">;
  enabled: boolean;
  reason: string | null;
  requests_used: number;
  results_returned: number;
  candidates_considered: number;
  candidates_kept: number;
  failover_invoked: boolean;
  trimmed_by_caps: boolean;
  budget_exhausted: boolean;
}

const PROFILE_DEFAULTS: Record<ResearchQuery["analysisMode"], DiscoveryProfileDefaults> = {
  comprehensive: {
    maxCandidatesPerSource: 80,
    maxQueryVariants: 8,
    domainThrottlePerSource: 20,
    maxDiscoveredDomainsPerRun: 60,
    maxUrlsPerDiscoveredDomain: 12,
    maxTotalCandidatesPerRun: 1200
  },
  balanced: {
    maxCandidatesPerSource: 24,
    maxQueryVariants: 3,
    domainThrottlePerSource: 6,
    maxDiscoveredDomainsPerRun: 20,
    maxUrlsPerDiscoveredDomain: 6,
    maxTotalCandidatesPerRun: 300
  },
  fast: {
    maxCandidatesPerSource: 12,
    maxQueryVariants: 2,
    domainThrottlePerSource: 4,
    maxDiscoveredDomainsPerRun: 8,
    maxUrlsPerDiscoveredDomain: 3,
    maxTotalCandidatesPerRun: 120
  }
};

const TURKEY_DOMAIN_HINTS = [
  ".tr",
  "muzayede",
  "portakal",
  "clar",
  "bayrak",
  "turel",
  "antikasa",
  "artam",
  "alifart",
  "sanatfiyat"
];

const DEFAULT_DISCOVERY_BLOCK_HOST_TOKENS = [
  "google.",
  "facebook.",
  "instagram.",
  "linkedin.",
  "x.com",
  "twitter.com",
  "youtube.com",
  "wikipedia.org"
];

const DEFAULT_DISCOVERY_PREFERRED_HOST_TOKENS = [
  "auction",
  "müzayede",
  "muzayede",
  "lot",
  "art",
  "gallery",
  "invaluable",
  "liveauctioneers",
  "sothebys",
  "christies",
  "bonhams",
  "phillips",
  "portakal",
  "bayrak",
  "clar",
  "turel",
  "artam",
  "antikasa",
  "sanatfiyat",
  "alifart"
];

const DEFAULT_DISCOVERY_LOW_QUALITY_HOST_TOKENS = [
  "blogspot",
  "wordpress",
  "pinterest",
  "tiktok",
  "tumblr"
];

const TURKEY_PRIORITY_SITE_HOSTS = [
  "rportakal.com",
  "clarmuzayede.com",
  "artam.com",
  "muzayede.app",
  "sanatfiyat.com",
  "bayrakmuzayede.com",
  "antikasa.com",
  "alifart.com.tr",
  "turelart.com"
];

const INTERNATIONAL_PRIORITY_SITE_HOSTS = [
  "liveauctioneers.com",
  "invaluable.com",
  "sothebys.com",
  "phillips.com",
  "christies.com",
  "bonhams.com",
  "bidsquare.com",
  "1stdibs.com",
  "saatchiart.com",
  "barnebys.com"
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toPositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function discoveryRequestTimeoutMs(): number {
  const parsed = Number(process.env.WEB_DISCOVERY_REQUEST_TIMEOUT_MS ?? 8_000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8_000;
  }
  return Math.max(1_000, Math.floor(parsed));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {}
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), discoveryRequestTimeoutMs());
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearxngBaseUrl(value: string | undefined): string {
  const fallback = "http://127.0.0.1:8080";
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

function normalizeUrl(candidateUrl: string): string | null {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_")
        || lower === "gclid"
        || lower === "fbclid"
        || lower === "ref"
        || lower === "_pos"
        || lower === "_sid"
        || lower === "_ss"
      ) {
        parsed.searchParams.delete(key);
      }
    }
    if (parsed.pathname.toLowerCase().endsWith(".oembed")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAssetLikePath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(?:css|js|json|xml|jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|mp3|mp4)$/i.test(pathname);
  } catch {
    return true;
  }
}

function isHostAllowed(host: string, config: DiscoveryConfig): boolean {
  if (config.webDiscoveryAllowHostRegex) {
    try {
      const allowed = new RegExp(config.webDiscoveryAllowHostRegex, "i");
      if (!allowed.test(host)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return !config.webDiscoveryBlockHostTokens.some((token) => host.includes(token));
}

function inferSourcePageType(url: string): SourcePageType {
  const lower = url.toLowerCase();
  if (
    /(\/lot\/|\/lots\/|\/auction\/lot|\/lot-|\/(?:en\/)?products\/|\/hemen-al\/|\/muzayede-arsivi\/|\/urun\/)/.test(lower)
    || /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i.test(lower)
  ) {
    return "lot";
  }
  if (/(\/artist\/|\/artists\/)/.test(lower)) return "artist_page";
  if (/(\/price|\/result|\/archive|\/catalog|\/arsiv|\/search|\/arama)/.test(lower)) return "listing";
  return "other";
}

function transliterateTurkish(value: string): string {
  const map: Record<string, string> = {
    ç: "c",
    Ç: "C",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ö: "o",
    Ö: "O",
    ş: "s",
    Ş: "S",
    ü: "u",
    Ü: "U"
  };
  return value
    .split("")
    .map((char) => map[char] ?? char)
    .join("");
}

export function buildDiscoveryConfigFromEnv(analysisMode?: ResearchQuery["analysisMode"]): DiscoveryConfig {
  const profile = PROFILE_DEFAULTS[analysisMode ?? "balanced"] ?? PROFILE_DEFAULTS.balanced;
  const providerRaw = (process.env.WEB_DISCOVERY_PROVIDER ?? "searxng").trim().toLowerCase();
  const secondaryProviderRaw = (process.env.WEB_DISCOVERY_SECONDARY_PROVIDER ?? "none").trim().toLowerCase();
  const provider =
    providerRaw === "brave" || providerRaw === "tavily" || providerRaw === "searxng" ? providerRaw : "none";
  const secondaryProvider =
    secondaryProviderRaw === "brave" || secondaryProviderRaw === "tavily" || secondaryProviderRaw === "searxng"
      ? secondaryProviderRaw
      : "none";
  const apiKey =
    provider === "brave"
      ? process.env.BRAVE_SEARCH_API_KEY?.trim()
      : provider === "tavily"
        ? process.env.TAVILY_API_KEY?.trim()
        : undefined;
  const secondaryApiKey =
    secondaryProvider === "brave"
      ? process.env.BRAVE_SEARCH_API_KEY?.trim()
      : secondaryProvider === "tavily"
        ? process.env.TAVILY_API_KEY?.trim()
        : undefined;
  const analysisModeResolved = analysisMode ?? "balanced";
  const explicitWebDiscoveryEnabled = parseBoolean(process.env.WEB_DISCOVERY_ENABLED, analysisModeResolved === "comprehensive");
  const balancedInventoryDiscovery = parseBoolean(process.env.WEB_DISCOVERY_ENABLE_FOR_BALANCED_INVENTORY, true);
  const webDiscoveryEnabled =
    explicitWebDiscoveryEnabled
    && (
      analysisModeResolved === "comprehensive"
      || (analysisModeResolved === "balanced" && balancedInventoryDiscovery)
    );

  return {
    enabled: process.env.DISCOVERY_ENABLED !== "false",
    maxCandidatesPerSource: toPositiveInt(process.env.DISCOVERY_MAX_CANDIDATES_PER_SOURCE, profile.maxCandidatesPerSource),
    maxQueryVariants: toPositiveInt(process.env.DISCOVERY_MAX_VARIANTS, profile.maxQueryVariants),
    domainThrottlePerSource: toPositiveInt(process.env.DISCOVERY_DOMAIN_THROTTLE_PER_SOURCE, profile.domainThrottlePerSource),
    maxDiscoveredDomainsPerRun: toPositiveInt(
      process.env.WEB_DISCOVERY_MAX_DOMAINS_PER_RUN,
      profile.maxDiscoveredDomainsPerRun
    ),
    maxUrlsPerDiscoveredDomain: toPositiveInt(
      process.env.WEB_DISCOVERY_MAX_URLS_PER_DOMAIN,
      profile.maxUrlsPerDiscoveredDomain
    ),
    maxTotalCandidatesPerRun: toPositiveInt(process.env.WEB_DISCOVERY_MAX_TOTAL_CANDIDATES, profile.maxTotalCandidatesPerRun),
    webDiscoveryEnabled,
    webDiscoveryProvider: provider,
    webDiscoverySecondaryProvider: secondaryProvider,
    webDiscoveryApiKey: apiKey || undefined,
    webDiscoverySecondaryApiKey: secondaryApiKey || undefined,
    searxngBaseUrl: normalizeSearxngBaseUrl(process.env.SEARXNG_BASE_URL),
    webDiscoveryAllowHostRegex: process.env.WEB_DISCOVERY_ALLOW_HOST_REGEX?.trim() || undefined,
    webDiscoveryBlockHostTokens: parseCsv(process.env.WEB_DISCOVERY_BLOCK_HOST_TOKENS, DEFAULT_DISCOVERY_BLOCK_HOST_TOKENS),
    webDiscoveryPreferredHostTokens: parseCsv(
      process.env.WEB_DISCOVERY_PREFERRED_HOST_TOKENS,
      DEFAULT_DISCOVERY_PREFERRED_HOST_TOKENS
    ),
    webDiscoveryLowQualityHostTokens: parseCsv(
      process.env.WEB_DISCOVERY_LOW_QUALITY_HOST_TOKENS,
      DEFAULT_DISCOVERY_LOW_QUALITY_HOST_TOKENS
    ),
    webDiscoveryMinHostQualityScore: toNumber(process.env.WEB_DISCOVERY_MIN_HOST_QUALITY_SCORE, 0.12)
  };
}

const BRAVE_PROVIDER: DiscoveryProviderClient = {
  name: "brave",
  configured: (config) => Boolean(config.webDiscoveryApiKey),
  async search(variant, config, fetchImpl) {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.searchParams.set("q", variant);
    endpoint.searchParams.set("count", "20");
    endpoint.searchParams.set("safesearch", "moderate");

    const response = await fetchWithTimeout(fetchImpl, endpoint.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": config.webDiscoveryApiKey ?? ""
      }
    });
    if (!response?.ok) {
      return [];
    }
    const payload = (await response.json()) as BraveSearchPayload;
    return (payload.web?.results ?? []).map((entry) => entry.url ?? "").filter(Boolean);
  }
};

const TAVILY_PROVIDER: DiscoveryProviderClient = {
  name: "tavily",
  configured: (config) => Boolean(config.webDiscoveryApiKey),
  async search(variant, config, fetchImpl) {
    const response = await fetchWithTimeout(fetchImpl, "https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        api_key: config.webDiscoveryApiKey,
        query: variant,
        search_depth: "advanced",
        include_answer: false,
        include_images: false,
        max_results: 20
      })
    });
    if (!response?.ok) {
      return [];
    }
    const payload = (await response.json()) as TavilySearchPayload;
    return (payload.results ?? []).map((entry) => entry.url ?? "").filter(Boolean);
  }
};

const SEARXNG_PROVIDER: DiscoveryProviderClient = {
  name: "searxng",
  configured: (config) => Boolean(config.searxngBaseUrl),
  async search(variant, config, fetchImpl) {
    const baseUrl = normalizeSearxngBaseUrl(config.searxngBaseUrl);
    const endpoint = new URL("/search", `${baseUrl}/`);
    endpoint.searchParams.set("q", variant);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("safesearch", "0");
    endpoint.searchParams.set("language", "all");

    const response = await fetchWithTimeout(fetchImpl, endpoint.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ArtBot/1.0; +https://artbot.local)"
      }
    });
    if (!response?.ok) {
      return [];
    }
    const payload = (await response.json()) as SearxngSearchPayload;
    return (payload.results ?? []).map((entry) => entry.url ?? "").filter(Boolean);
  }
};

function resolveDiscoveryProviders(config: DiscoveryConfig): DiscoveryProviderClient[] {
  const byName: Record<Exclude<DiscoveryProviderName, "none">, DiscoveryProviderClient> = {
    brave: BRAVE_PROVIDER,
    tavily: TAVILY_PROVIDER,
    searxng: SEARXNG_PROVIDER
  };

  return unique(
    [config.webDiscoveryProvider, config.webDiscoverySecondaryProvider]
      .filter((name): name is Exclude<DiscoveryProviderName, "none"> => Boolean(name && name !== "none"))
  )
    .filter((name): name is Exclude<DiscoveryProviderName, "none"> => Boolean(name && name !== "none"))
    .map((name) => byName[name]);
}

function providerMissingConfigReason(provider: Exclude<DiscoveryProviderName, "none">): string {
  if (provider === "searxng") {
    return "Missing SearXNG base URL.";
  }
  return "Missing API key.";
}

export function buildQueryVariants(query: ResearchQuery, maxVariants: number): string[] {
  const artist = query.artist.trim();
  const title = query.title?.trim() ?? "";

  const baseCandidates = unique(
    [
      [artist, title].filter(Boolean).join(" ").trim(),
      [title, artist].filter(Boolean).join(" ").trim(),
      artist,
      title,
      title ? `"${title}" ${artist}`.trim() : ""
    ].filter(Boolean)
  );

  const transliteratedBase = unique(
    baseCandidates
      .map((candidate) => transliterateTurkish(candidate))
      .filter((candidate) => candidate && !baseCandidates.includes(candidate))
  );

  const keywordSuffixes = [
    "tablo",
    "müzayede sonucu",
    "auction result",
    "painting sold",
    "price realized",
    "estimate range",
    "hammer price",
    "bid now",
    "buy now",
    "private sale",
    "gallery inventory",
    "sold listing",
    "asking price",
    "hemen al",
    "listing price"
  ];

  const variants: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed || variants.includes(trimmed)) {
      return;
    }
    variants.push(trimmed);
  };

  for (const candidate of [...baseCandidates, ...transliteratedBase]) {
    push(candidate);
  }

  for (const candidate of [...baseCandidates, ...transliteratedBase]) {
    for (const suffix of keywordSuffixes) {
      push(`${candidate} ${suffix}`.trim());
    }
  }

  return variants.slice(0, Math.max(1, maxVariants));
}

function buildWebDiscoveryQueryVariants(query: ResearchQuery, maxVariants: number): string[] {
  const base = buildQueryVariants(query, maxVariants);
  const scopedQuery = [query.artist.trim(), query.title?.trim()].filter(Boolean).join(" ").trim() || query.artist.trim();
  const siteHosts = [
    ...(query.turkeyFirst ? TURKEY_PRIORITY_SITE_HOSTS.slice(0, 8) : []),
    ...(query.scope !== "turkey_only" ? INTERNATIONAL_PRIORITY_SITE_HOSTS.slice(0, 8) : [])
  ];
  const siteScoped = siteHosts.map((host) => `site:${host} "${scopedQuery}"`);
  if (siteScoped.length === 0) {
    return base;
  }

  const variants: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [...siteScoped, ...base]) {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    variants.push(trimmed);
    if (variants.length >= Math.max(1, maxVariants)) {
      break;
    }
  }

  return variants;
}

function withVariant(url: string, variant: string): string | null {
  try {
    const parsed = new URL(url);
    const keys = ["q", "query", "term", "entry", "s", "search", "search_words"];
    const key = keys.find((candidateKey) => parsed.searchParams.has(candidateKey));
    if (!key) {
      return null;
    }
    parsed.searchParams.set(key, variant);
    return parsed.toString();
  } catch {
    return null;
  }
}

function applyDomainThrottle(candidates: SourceCandidate[], maxPerDomain: number): SourceCandidate[] {
  const perDomain = new Map<string, number>();
  const accepted: SourceCandidate[] = [];

  for (const candidate of candidates) {
    const host = hostFromUrl(candidate.url) ?? "unknown";
    const count = perDomain.get(host) ?? 0;
    if (count >= maxPerDomain) {
      continue;
    }

    perDomain.set(host, count + 1);
    accepted.push(candidate);
  }

  return accepted;
}

export function scoreWithTurkeyPriority(candidate: SourceCandidate, query: ResearchQuery): number {
  if (!query.turkeyFirst) {
    return candidate.score;
  }

  const host = hostFromUrl(candidate.url);
  if (!host) {
    return candidate.score;
  }

  const isTurkeyLike = TURKEY_DOMAIN_HINTS.some((hint) => host.includes(hint));
  const boosted = isTurkeyLike ? candidate.score + 0.09 : candidate.score - 0.03;
  return Math.max(0, Math.min(1, boosted));
}

function candidatePriority(candidate: SourceCandidate): number {
  if (candidate.sourcePageType === "lot") {
    return 0;
  }
  if (candidate.provenance === "web_discovery") {
    return 1;
  }
  if (candidate.provenance === "listing_expansion" || candidate.provenance === "signature_expansion") {
    return 2;
  }
  if (candidate.provenance === "seed") {
    return 3;
  }
  if (candidate.provenance === "query_variant") {
    return 4;
  }
  return 5;
}

export function expandCandidatesLight(
  seeds: SourceCandidate[],
  query: ResearchQuery,
  config: DiscoveryConfig
): SourceCandidate[] {
  if (!config.enabled) {
    return seeds.slice(0, config.maxCandidatesPerSource);
  }

  const variants = buildQueryVariants(query, config.maxQueryVariants);
  const expanded: SourceCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: SourceCandidate): void => {
    if (!candidate.url || seen.has(candidate.url)) {
      return;
    }
    seen.add(candidate.url);
    expanded.push(candidate);
  };

  for (const seed of seeds) {
    push(seed);

    for (const variant of variants) {
      const variantUrl = withVariant(seed.url, variant);
      if (!variantUrl || variantUrl === seed.url) {
        continue;
      }
      push({
        ...seed,
        url: variantUrl,
        provenance: "query_variant",
        score: Math.max(0.4, seed.score - 0.22),
        discoveredFromUrl: seed.url
      });
    }
  }

  const throttled = applyDomainThrottle(expanded, config.domainThrottlePerSource);
  const rescored = throttled.map((candidate) => ({
    ...candidate,
    score: scoreWithTurkeyPriority(candidate, query)
  }));

  return rescored
    .sort((a, b) => {
      const aPriority = candidatePriority(a);
      const bPriority = candidatePriority(b);
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return b.score - a.score;
    })
    .slice(0, config.maxCandidatesPerSource);
}

export async function discoverWebCandidates(
  query: ResearchQuery,
  config: DiscoveryConfig,
  fetchImpl: typeof fetch = fetch
): Promise<SourceCandidate[]> {
  if (!config.webDiscoveryEnabled || config.webDiscoveryProvider === "none") {
    return [];
  }

  const providers = resolveDiscoveryProviders(config);
  const variants = buildWebDiscoveryQueryVariants(query, Math.min(config.maxQueryVariants, 8));
  const perDomainUrls = new Map<string, SourceCandidate[]>();
  const seenUrls = new Set<string>();
  const preferredHostTokens = config.webDiscoveryPreferredHostTokens ?? DEFAULT_DISCOVERY_PREFERRED_HOST_TOKENS;
  const lowQualityHostTokens = config.webDiscoveryLowQualityHostTokens ?? DEFAULT_DISCOVERY_LOW_QUALITY_HOST_TOKENS;
  const minHostQualityScore = config.webDiscoveryMinHostQualityScore ?? 0.12;

  const hostQualityScore = (host: string): number => {
    let score = 0;
    if (TURKEY_DOMAIN_HINTS.some((hint) => host.includes(hint))) {
      score += 0.28;
    }
    if (preferredHostTokens.some((token) => host.includes(token))) {
      score += 0.3;
    }
    if (host.endsWith(".tr")) {
      score += 0.18;
    }
    if (lowQualityHostTokens.some((token) => host.includes(token))) {
      score -= 0.45;
    }
    if (host.split(".").length < 2) {
      score -= 0.2;
    }
    return score;
  };

  const diagnostics: DiscoveryProviderDiagnostics[] = [];

  const pushCandidate = (
    normalizedUrl: string,
    index: number,
    quality: number,
    providerState?: ProviderDiagnosticsAccumulator
  ): void => {
    if (providerState) {
      providerState.candidates_considered += 1;
    }

    const host = hostFromUrl(normalizedUrl);
    if (!host || !isHostAllowed(host, config)) {
      return;
    }
    if (quality < minHostQualityScore) {
      return;
    }

    const currentDomainCandidates = perDomainUrls.get(host) ?? [];
    if (currentDomainCandidates.length >= config.maxUrlsPerDiscoveredDomain) {
      if (providerState) {
        providerState.trimmed_by_caps = true;
      }
      return;
    }
    if (!perDomainUrls.has(host) && perDomainUrls.size >= config.maxDiscoveredDomainsPerRun) {
      if (providerState) {
        providerState.trimmed_by_caps = true;
        providerState.budget_exhausted = true;
      }
      return;
    }
    if (seenUrls.size >= config.maxTotalCandidatesPerRun) {
      if (providerState) {
        providerState.trimmed_by_caps = true;
        providerState.budget_exhausted = true;
      }
      return;
    }

    seenUrls.add(normalizedUrl);
    const sourcePageType = inferSourcePageType(normalizedUrl);
    const baseScore = Math.max(0.42, 0.92 - index * 0.03);
    currentDomainCandidates.push({
      url: normalizedUrl,
      sourcePageType,
      provenance: "web_discovery",
      score: scoreWithTurkeyPriority(
        {
          url: normalizedUrl,
          sourcePageType,
          provenance: "web_discovery",
          score: Math.max(0, Math.min(1, baseScore + Math.min(0.12, quality * 0.2)))
        },
        query
      ),
      discoveredFromUrl: null
    });
    perDomainUrls.set(host, currentDomainCandidates);
    if (providerState) {
      providerState.candidates_kept += 1;
    }
  };

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex]!;
    const providerConfig =
      provider.name === config.webDiscoveryProvider
        ? config
        : {
            ...config,
            webDiscoveryProvider: provider.name,
            webDiscoveryApiKey: config.webDiscoverySecondaryApiKey ?? config.webDiscoveryApiKey
          };
    const providerState: ProviderDiagnosticsAccumulator = {
      provider: provider.name,
      enabled: false,
      reason: null,
      requests_used: 0,
      results_returned: 0,
      candidates_considered: 0,
      candidates_kept: 0,
      failover_invoked: providerIndex > 0,
      trimmed_by_caps: false,
      budget_exhausted: false
    };

    if (!provider.configured(providerConfig)) {
      providerState.reason = providerMissingConfigReason(provider.name);
      diagnostics.push(providerState);
      continue;
    }

    providerState.enabled = true;
    let providerUnavailable = false;

    for (const variant of variants) {
      let results: string[] = [];
      try {
        results = await provider.search(variant, providerConfig, fetchImpl);
        providerState.requests_used += 1;
      } catch {
        providerUnavailable = true;
        providerState.reason = "Provider request failed.";
        break;
      }

      providerState.results_returned += results.length;
      for (let index = 0; index < results.length; index += 1) {
        const rawUrl = results[index];
        if (!rawUrl) continue;
        const normalizedUrl = normalizeUrl(rawUrl);
        if (!normalizedUrl || seenUrls.has(normalizedUrl) || isAssetLikePath(normalizedUrl)) {
          continue;
        }

        const host = hostFromUrl(normalizedUrl);
        if (!host) {
          continue;
        }

        pushCandidate(normalizedUrl, index, hostQualityScore(host), providerState);
      }

      if (providerState.budget_exhausted) {
        break;
      }
    }

    if (!providerUnavailable && providerState.candidates_kept === 0 && providerState.reason == null) {
      providerState.reason = "No usable discovery candidates returned.";
    }

    const shouldFailover = providerIndex < providers.length - 1 && providerState.candidates_kept === 0;
    if (shouldFailover) {
      providerState.failover_invoked = true;
      providerState.reason = providerState.reason
        ? `${providerState.reason} Failed over to ${providers[providerIndex + 1]!.name}.`
        : `No usable discovery candidates returned; failed over to ${providers[providerIndex + 1]!.name}.`;
    }

    diagnostics.push(providerState);

    if (providerState.candidates_kept > 0 || providerState.budget_exhausted) {
      break;
    }
  }

  if (perDomainUrls.size === 0 && variants.length > 0) {
    for (const variant of variants) {
      let html = "";
      try {
        const endpoint = new URL("https://html.duckduckgo.com/html/");
        endpoint.searchParams.set("q", variant);
        const response = await fetchWithTimeout(fetchImpl, endpoint.toString(), {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0 (compatible; ArtBot/1.0; +https://artbot.local)"
          }
        });
        if (!response?.ok) {
          continue;
        }
        html = await response.text();
      } catch {
        continue;
      }

      const resultUrls: string[] = [];
      const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        const rawHref = decodeHtmlAttribute(match[1] ?? "");
        if (!rawHref) {
          continue;
        }

        let decodedHref = rawHref;
        try {
          const parsed = new URL(rawHref, "https://html.duckduckgo.com");
          const redirected = parsed.searchParams.get("uddg");
          if (redirected) {
            decodedHref = decodeURIComponent(redirected);
          } else if (parsed.hostname === "duckduckgo.com" || parsed.hostname === "html.duckduckgo.com") {
            continue;
          }
        } catch {
          // Ignore malformed search result urls.
        }

        resultUrls.push(decodedHref);
      }

      for (let index = 0; index < resultUrls.length; index += 1) {
        const normalizedUrl = normalizeUrl(resultUrls[index] ?? "");
        if (!normalizedUrl || seenUrls.has(normalizedUrl) || isAssetLikePath(normalizedUrl)) {
          continue;
        }

        const host = hostFromUrl(normalizedUrl);
        if (!host) {
          continue;
        }

        pushCandidate(normalizedUrl, index, hostQualityScore(host));
      }

      if (
        perDomainUrls.size >= config.maxDiscoveredDomainsPerRun
        || seenUrls.size >= config.maxTotalCandidatesPerRun
      ) {
        break;
      }
    }
  }

  const discoveredHosts = [...perDomainUrls.keys()].slice(0, config.maxDiscoveredDomainsPerRun);
  const flattened = discoveredHosts.flatMap((host) => perDomainUrls.get(host) ?? []);
  config.webDiscoveryDiagnostics = diagnostics;

  return flattened
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxTotalCandidatesPerRun);
}
