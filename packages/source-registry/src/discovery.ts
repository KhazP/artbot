import type { ResearchQuery, SourcePageType } from "@artbot/shared-types";
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
  webDiscoveryProvider: "brave" | "none";
  webDiscoveryApiKey?: string;
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

function normalizeUrl(candidateUrl: string): string | null {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || lower === "gclid" || lower === "fbclid" || lower === "ref") {
        parsed.searchParams.delete(key);
      }
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
  if (/(\/lot\/|\/lots\/|\/auction\/lot|\/lot-)/.test(lower)) return "lot";
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
  const providerRaw = (process.env.WEB_DISCOVERY_PROVIDER ?? "none").trim().toLowerCase();
  const provider = providerRaw === "brave" ? "brave" : "none";
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const analysisModeResolved = analysisMode ?? "balanced";
  const explicitWebDiscoveryEnabled = parseBoolean(process.env.WEB_DISCOVERY_ENABLED, analysisModeResolved === "comprehensive");
  const webDiscoveryEnabled =
    explicitWebDiscoveryEnabled && analysisModeResolved === "comprehensive" && provider === "brave" && Boolean(apiKey);

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
    webDiscoveryApiKey: apiKey || undefined,
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

function withVariant(url: string, variant: string): string | null {
  try {
    const parsed = new URL(url);
    const keys = ["q", "query", "term", "entry", "s", "search"];
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

  return rescored.sort((a, b) => b.score - a.score).slice(0, config.maxCandidatesPerSource);
}

export async function discoverWebCandidates(
  query: ResearchQuery,
  config: DiscoveryConfig,
  fetchImpl: typeof fetch = fetch
): Promise<SourceCandidate[]> {
  if (!config.webDiscoveryEnabled || config.webDiscoveryProvider === "none") {
    return [];
  }

  if (config.webDiscoveryProvider !== "brave" || !config.webDiscoveryApiKey) {
    return [];
  }

  const variants = buildQueryVariants(query, Math.min(config.maxQueryVariants, 8));
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

  for (const variant of variants) {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.searchParams.set("q", variant);
    endpoint.searchParams.set("count", "20");
    endpoint.searchParams.set("safesearch", "moderate");

    let payload: BraveSearchPayload | null = null;
    try {
      const response = await fetchImpl(endpoint.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": config.webDiscoveryApiKey
        }
      });
      if (!response.ok) {
        continue;
      }
      payload = (await response.json()) as BraveSearchPayload;
    } catch {
      continue;
    }

    const results = payload.web?.results ?? [];
    for (let index = 0; index < results.length; index += 1) {
      const rawUrl = results[index]?.url;
      if (!rawUrl) continue;
      const normalizedUrl = normalizeUrl(rawUrl);
      if (!normalizedUrl || seenUrls.has(normalizedUrl) || isAssetLikePath(normalizedUrl)) {
        continue;
      }

      const host = hostFromUrl(normalizedUrl);
      if (!host || !isHostAllowed(host, config)) {
        continue;
      }
      const quality = hostQualityScore(host);
      if (quality < minHostQualityScore) {
        continue;
      }

      const currentDomainCandidates = perDomainUrls.get(host) ?? [];
      if (currentDomainCandidates.length >= config.maxUrlsPerDiscoveredDomain) {
        continue;
      }

      seenUrls.add(normalizedUrl);
      const baseScore = Math.max(0.42, 0.92 - index * 0.03);
      const candidate: SourceCandidate = {
        url: normalizedUrl,
        sourcePageType: inferSourcePageType(normalizedUrl),
        provenance: "web_discovery",
        score: scoreWithTurkeyPriority(
          {
            url: normalizedUrl,
            sourcePageType: inferSourcePageType(normalizedUrl),
            provenance: "web_discovery",
            score: Math.max(0, Math.min(1, baseScore + Math.min(0.12, quality * 0.2)))
          },
          query
        ),
        discoveredFromUrl: null
      };
      currentDomainCandidates.push(candidate);
      perDomainUrls.set(host, currentDomainCandidates);
    }
  }

  const discoveredHosts = [...perDomainUrls.keys()].slice(0, config.maxDiscoveredDomainsPerRun);
  const flattened = discoveredHosts.flatMap((host) => perDomainUrls.get(host) ?? []);

  return flattened
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxTotalCandidatesPerRun);
}
