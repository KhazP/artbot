import { extractWithGeminiSchema, fetchCheapestFirst, parseGenericLotFields, type GenericParsedFields } from "@artbot/extraction";
import type { SourceAccessStatus, SourceAttempt } from "@artbot/shared-types";
import type { AdapterExtractionContext, AdapterExtractionResult, SourceAdapter, SourceCandidate } from "../types.js";
import { deriveDefaultSourceCapabilities } from "../types.js";
import {
  buildBlockedResult,
  buildRecordFromParsed,
  ensureRawPath,
  evaluateAcceptance,
  evaluateAccessDecision,
  extractHrefCandidates,
  toCandidate,
  writeRawSnapshot
} from "./custom-adapter-utils.js";

interface DeterministicAdapterOptions {
  id: string;
  sourceName: string;
  venueName: string;
  venueType: SourceAdapter["venueType"];
  sourcePageType: SourceAdapter["sourcePageType"];
  tier: SourceAdapter["tier"];
  country: string | null;
  city: string | null;
  baseUrl: string;
  searchPaths: string[];
  lotUrlMatchers: RegExp[];
  signatureIndicators?: string[];
  venueRouteTemplates?: string[];
  turkeyVenueHostPatterns?: RegExp[];
  requiresAuth?: boolean;
  requiresLicense?: boolean;
  supportedAccessModes?: SourceAdapter["supportedAccessModes"];
  crawlStrategies?: SourceAdapter["crawlStrategies"];
  capabilities?: SourceAdapter["capabilities"];
}

function hasAnySignature(content: string, indicators: string[]): boolean {
  const normalized = content.toLowerCase();
  return indicators.some((indicator) => normalized.includes(indicator.toLowerCase()));
}

function buildPrimaryQuery(query: AdapterExtractionContext["query"]): string {
  return [query.artist, query.title].filter(Boolean).join(" ").trim();
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function hostForUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isAllowedVenueUrl(url: string, allowedHosts: Set<string>): boolean {
  const host = hostForUrl(url);
  return host ? allowedHosts.has(host) : false;
}

function extractVenueOrigins(html: string, pageUrl: string, patterns: RegExp[]): string[] {
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set<string>();
  const origins: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;

    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }

    const host = resolved.hostname.toLowerCase();
    if (!patterns.some((pattern) => pattern.test(host))) {
      continue;
    }

    const origin = resolved.origin;
    if (seen.has(origin)) {
      continue;
    }
    seen.add(origin);
    origins.push(origin);
  }

  return origins;
}

function buildVenueRouteCandidates(
  origins: string[],
  routeTemplates: string[],
  query: AdapterExtractionContext["query"],
  sourcePageType: SourceCandidate["sourcePageType"],
  discoveredFromUrl: string
): SourceCandidate[] {
  if (origins.length === 0 || routeTemplates.length === 0) {
    return [];
  }

  const term = encodeURIComponent(buildPrimaryQuery(query));
  const candidates: SourceCandidate[] = [];
  const seen = new Set<string>();

  for (const origin of origins) {
    for (const template of routeTemplates) {
      const route = template.replace("{q}", term);
      const url = `${origin}${route}`;
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push(toCandidate(url, sourcePageType, "signature_expansion", 0.78, discoveredFromUrl));
    }
  }

  return candidates;
}

export function detectMuzayedeSignature(content: string, sourceUrl: string): boolean {
  return hasAnySignature(content, ["powered by müzayede app", "powered by muzayede app", "muzayede.app"]) ||
    /muzayede\.app|muzayedeapp\.com/i.test(sourceUrl);
}

function detectOutageReason(content: string, sourceUrl: string): string | null {
  const normalized = content.toLowerCase();
  const indicators = [
    "we apologize for the inconvenience",
    "working to bring our website back online",
    "temporarily unavailable",
    "site is under maintenance",
    "service unavailable",
    "maintenance mode",
    "error 503",
    "bad gateway",
    "gateway timeout"
  ];

  if (indicators.some((indicator) => normalized.includes(indicator))) {
    return "Publisher maintenance or outage page detected.";
  }

  if (/\/maintenance|\/unavailable|\/503/i.test(sourceUrl)) {
    return "Publisher maintenance endpoint detected.";
  }

  return null;
}

function normalizeEntityText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLeadingArtistFromTitle(title: string | null | undefined): string | null {
  const raw = (title ?? "").trim();
  if (!raw) {
    return null;
  }

  if (!/\s+[|:-]\s+/.test(raw)) {
    return null;
  }

  const segment = raw.split(/\s+[|:-]\s+/)[0]?.trim() ?? raw;
  const normalized = normalizeEntityText(segment);
  return normalized.length >= 4 ? normalized : null;
}

function normalizeArtistTokens(value: string): string[] {
  return normalizeEntityText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function titleIndicatesDifferentArtist(parsedTitle: string | null | undefined, queryArtist: string): boolean {
  const leadingArtist = extractLeadingArtistFromTitle(parsedTitle);
  if (!leadingArtist) {
    return false;
  }

  const normalizedQueryArtist = normalizeEntityText(queryArtist);
  if (!normalizedQueryArtist) {
    return false;
  }

  if (leadingArtist === normalizedQueryArtist) {
    return false;
  }

  const queryTokens = normalizeArtistTokens(queryArtist);
  if (queryTokens.some((token) => leadingArtist.includes(token))) {
    return false;
  }

  return queryTokens.length > 0;
}

function looksLikeSearchShell(candidateUrl: string, extractedUrl: string, html: string): boolean {
  const combined = `${html}`.toLowerCase();
  const urlLooksLikeSearch = /\/search\b|\/arama(?:\.html)?\b|[?&](?:q|query|term|search|search_words)=/i.test(
    `${candidateUrl} ${extractedUrl}`
  );
  const pageLooksLikeSearch = [
    /results found/i,
    /arama:/i,
    /için\s+\d+\s+sonuç\s+bulundu/i,
    /pagetype":"search"/i,
    /name=["']search_words["']/i,
    /class=["'][^"']*search-input/i,
    /tbfiltersearch/i,
    /btn-search/i
  ].some((pattern) => pattern.test(combined));

  return urlLooksLikeSearch && pageLooksLikeSearch;
}

function matchesRequestedEntityInContent(
  content: string,
  query: AdapterExtractionContext["query"]
): boolean {
  const normalizedContent = normalizeEntityText(content);
  const normalizedArtist = normalizeEntityText(query.artist);
  const normalizedTitle = normalizeEntityText(query.title ?? "");

  if (normalizedTitle && normalizedContent.includes(normalizedTitle)) {
    return true;
  }

  if (!normalizedArtist) {
    return true;
  }

  return normalizedContent.includes(normalizedArtist);
}

function looksLikeEntityMismatch(candidateUrl: string, content: string, query: AdapterExtractionContext["query"]): boolean {
  if (matchesRequestedEntityInContent(content, query)) {
    return false;
  }

  let pathname = "";
  try {
    pathname = new URL(candidateUrl).pathname.toLowerCase();
  } catch {
    return false;
  }

  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
  const normalizedSegment = normalizeEntityText(lastSegment.replace(/\.(html|php|aspx?)$/i, ""));
  if (!normalizedSegment) {
    return false;
  }

  const strippedSegment = normalizedSegment
    .replace(/\b(?:lot|item|product|products|urun|ürün|eser|resim|catalog|katalog|auction|muzayede|hemen al)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (strippedSegment.length < 6 || !/[a-z]/i.test(strippedSegment)) {
    return false;
  }

  const normalizedArtist = normalizeEntityText(query.artist);
  const normalizedTitle = normalizeEntityText(query.title ?? "");
  if (normalizedArtist && (strippedSegment.includes(normalizedArtist) || normalizedArtist.includes(strippedSegment))) {
    return false;
  }
  if (normalizedTitle && (strippedSegment.includes(normalizedTitle) || normalizedTitle.includes(strippedSegment))) {
    return false;
  }

  return true;
}

function inferCandidatePageType(
  url: string,
  fallback: SourceCandidate["sourcePageType"] = "lot"
): SourceCandidate["sourcePageType"] {
  const lower = url.toLowerCase();
  if (
    /\/(?:cart|sepet|account|giris|login|contact|iletisim|about|hakkimizda|download-app|siparislerim|desteklerim|privacy|gizlilik|uyelik|kargo|odeme|rss|feed)\b/.test(lower)
  ) {
    return "other";
  }
  if (/\/(?:en\/)?products\//.test(lower)) return "lot";
  if (
    /\/(?:artist|search)\/(?:artwork-detail|result-detail|artist-result)\//.test(lower) ||
    /\/urun\//.test(lower) ||
    /\/lot\//.test(lower) ||
    /\/eser\//.test(lower) ||
    /\/item\/\d+/.test(lower) ||
    /\/hemen-al\/[^/?#]+\/\d+/.test(lower) ||
    /\/hemen-al\/\d+\//.test(lower)
  ) {
    return "lot";
  }
  if (/\/muzayede\/\d+\//.test(lower) || /\/canli-muzayede\/\d+\//.test(lower)) {
    return "listing";
  }
  if (/\/archive|\/arsiv|\/catalog|\/search|\/arama|\/hemen-al\b|\?search=/.test(lower)) {
    return "listing";
  }
  return fallback;
}

function hasNumericValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEmbeddedNumber(value: string): number | null {
  const cleaned = value.replace(/[^0-9,.\-]/g, "").trim();
  if (!cleaned) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  let normalized = cleaned;

  if (commaCount > 0 && dotCount > 0) {
    const decimalIsComma = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".");
    normalized = decimalIsComma
      ? cleaned.replace(/\./g, "").replace(/,/g, ".")
      : cleaned.replace(/,/g, "");
  } else if (commaCount > 1) {
    normalized = cleaned.replace(/,/g, "");
  } else if (dotCount > 1) {
    normalized = cleaned.replace(/\./g, "");
  } else if (commaCount === 1) {
    const [integer, fraction = ""] = cleaned.split(",");
    normalized = fraction.length === 3 ? `${integer}${fraction}` : `${integer}.${fraction}`;
  } else if (dotCount === 1) {
    const [integer, fraction = ""] = cleaned.split(".");
    normalized = fraction.length === 3 ? `${integer}${fraction}` : `${integer}.${fraction}`;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEmbeddedCurrencyCell(value: string): { amount: number | null; currency: string | null } {
  const amount = normalizeEmbeddedNumber(value);
  const upper = value.toUpperCase();
  if (upper.includes("TL") || upper.includes("TRY") || value.includes("₺")) {
    return { amount, currency: "TRY" };
  }
  if (upper.includes("USD") || value.includes("$")) {
    return { amount, currency: "USD" };
  }
  if (upper.includes("EUR") || value.includes("€")) {
    return { amount, currency: "EUR" };
  }
  return { amount, currency: null };
}

function parseSanatfiyatTrendTable(html: string): GenericParsedFields | null {
  if (!/Eser Fiyat Trend Analizi/i.test(html) || !/A[çc][iı]l[iı][şs] Fiyat[iı]/i.test(html)) {
    return null;
  }

  const rowMatch = html.match(
    /<tbody[\s\S]*?<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/i
  );
  if (!rowMatch) {
    return null;
  }

  const saleDate = rowMatch[1]?.trim() || null;
  const opening = parseEmbeddedCurrencyCell(rowMatch[2] ?? "");
  const hammerTry = parseEmbeddedCurrencyCell(rowMatch[4] ?? "");
  const hammerUsd = parseEmbeddedCurrencyCell(rowMatch[5] ?? "");
  const hammerEur = parseEmbeddedCurrencyCell(rowMatch[6] ?? "");

  let priceType: GenericParsedFields["priceType"] = "unknown";
  let priceAmount: number | null = null;
  let currency: string | null = null;

  if (hasNumericValue(hammerTry.amount) && hammerTry.amount > 0) {
    priceType = "hammer_price";
    priceAmount = hammerTry.amount;
    currency = hammerTry.currency ?? "TRY";
  } else if (hasNumericValue(hammerUsd.amount) && hammerUsd.amount > 0) {
    priceType = "hammer_price";
    priceAmount = hammerUsd.amount;
    currency = hammerUsd.currency ?? "USD";
  } else if (hasNumericValue(hammerEur.amount) && hammerEur.amount > 0) {
    priceType = "hammer_price";
    priceAmount = hammerEur.amount;
    currency = hammerEur.currency ?? "EUR";
  } else if (hasNumericValue(opening.amount) && opening.amount > 0) {
    // Sanatfiyat trend rows often expose only the opening bid when the hammer columns are zero.
    priceType = "asking_price";
    priceAmount = opening.amount;
    currency = opening.currency ?? "TRY";
  }

  return {
    title: null,
    artistName: null,
    medium: null,
    dimensionsText: null,
    year: null,
    imageUrl: null,
    lotNumber: null,
    estimateLow: null,
    estimateHigh: null,
    priceAmount,
    priceType,
    currency,
    saleDate,
    priceHidden: false,
    buyersPremiumIncluded: null
  };
}

function sourceSpecificKeywordsForAdapter(adapterId: string): string[] {
  if (adapterId === "bayrak-muzayede-listing" || adapterId === "bayrak-muzayede-lot") {
    return ["tahmini", "çekiç", "cekic", "lot no", "lot"];
  }
  if (adapterId === "muzayedeapp-platform") {
    return ["müzayede", "muzayede", "sanatçı", "sanatci", "lot", "realized", "tahmini"];
  }
  if (adapterId === "clar-buy-now") {
    return ["hemen al", "fiyat", "price", "urun", "ürün", "lot"];
  }
  if (adapterId === "portakal-catalog") {
    return ["price", "fiyat", "lot", "katalog", "catalog"];
  }
  if (adapterId === "invaluable-lot-detail-adapter") {
    return ["estimate", "realized", "lot", "sold"];
  }
  if (adapterId === "liveauctioneers-public-lot-adapter") {
    return ["estimate", "sold", "lot", "item"];
  }
  return [];
}

function parseSourceSpecificPatch(adapterId: string, html: string, markdown: string): GenericParsedFields | null {
  if (adapterId === "sanatfiyat-licensed-extractor") {
    const trendPatch = parseSanatfiyatTrendTable(html);
    if (trendPatch) {
      return trendPatch;
    }
  }

  const keywords = sourceSpecificKeywordsForAdapter(adapterId);
  if (keywords.length === 0) {
    return null;
  }

  const rawText = `${html.replace(/<[^>]+>/g, " ")} ${markdown}`.replace(/\s+/g, " ");
  const lowerText = rawText.toLowerCase();
  const snippets: string[] = [];

  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    let fromIndex = 0;
    while (fromIndex < lowerText.length) {
      const matchIndex = lowerText.indexOf(needle, fromIndex);
      if (matchIndex < 0) {
        break;
      }
      const start = Math.max(0, matchIndex - 90);
      const end = Math.min(rawText.length, matchIndex + 180);
      snippets.push(rawText.slice(start, end));
      fromIndex = matchIndex + needle.length;
    }
  }

  const sampled = snippets.join(" | ").trim();
  if (sampled.length < 24) {
    return null;
  }

  const parsed = parseGenericLotFields(sampled);
  const hasSignal =
    parsed.priceType !== "unknown" ||
    hasNumericValue(parsed.priceAmount) ||
    hasNumericValue(parsed.estimateLow) ||
    hasNumericValue(parsed.estimateHigh) ||
    Boolean(parsed.currency);

  return hasSignal ? parsed : null;
}

function mergeSourceSpecificParsed(
  base: GenericParsedFields,
  patch: GenericParsedFields | null,
  preferPatchPrice = false
): GenericParsedFields {
  if (!patch) {
    return base;
  }

  const merged: GenericParsedFields = {
    ...base,
    title: base.title ?? patch.title,
    artistName: base.artistName ?? patch.artistName,
    medium: base.medium ?? patch.medium,
    dimensionsText: base.dimensionsText ?? patch.dimensionsText,
    year: base.year ?? patch.year,
    imageUrl: base.imageUrl ?? patch.imageUrl,
    lotNumber: base.lotNumber ?? patch.lotNumber,
    estimateLow: base.estimateLow ?? patch.estimateLow,
    estimateHigh: base.estimateHigh ?? patch.estimateHigh,
    priceAmount:
      preferPatchPrice && hasNumericValue(patch.priceAmount)
        ? patch.priceAmount
        : hasNumericValue(base.priceAmount)
          ? base.priceAmount
          : patch.priceAmount,
    currency: preferPatchPrice && patch.currency ? patch.currency : base.currency ?? patch.currency,
    saleDate: preferPatchPrice && patch.saleDate ? patch.saleDate : base.saleDate ?? patch.saleDate,
    priceType:
      preferPatchPrice && patch.priceType !== "unknown"
        ? patch.priceType
        : base.priceType === "unknown" ||
            (base.priceType === "asking_price" &&
              (patch.priceType === "realized_price" || patch.priceType === "hammer_price" || patch.priceType === "estimate"))
          ? patch.priceType
          : base.priceType,
    priceHidden: base.priceHidden || patch.priceHidden,
    buyersPremiumIncluded:
      preferPatchPrice && patch.buyersPremiumIncluded !== null && patch.buyersPremiumIncluded !== undefined
        ? patch.buyersPremiumIncluded
        : base.buyersPremiumIncluded !== null && base.buyersPremiumIncluded !== undefined
        ? base.buyersPremiumIncluded
        : patch.buyersPremiumIncluded
  };

  return merged;
}

function sourceSpecificLinkMatchersForAdapter(adapterId: string): RegExp[] {
  if (adapterId === "bayrak-muzayede-listing" || adapterId === "bayrak-muzayede-lot") {
    return [/\/lot\//i, /\/eser\//i, /\/urun\//i, /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i];
  }
  if (adapterId === "muzayedeapp-platform") {
    return [
      /\/lot\//i,
      /\/eser\//i,
      /\/urun\//i,
      /\/tumurunler\.html/i,
      /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i
    ];
  }
  if (adapterId === "clar-buy-now") {
    return [/\/urun\//i, /\/lot\//i, /\/hemen-al\/[^/?#]+\/\d+/i, /\/hemen-al\/\d+\//i];
  }
  if (adapterId === "portakal-catalog") {
    return [/\/lot\//i, /\/auction\//i, /\/catalog\//i, /\/(?:en\/)?products\//i];
  }
  if (adapterId === "invaluable-lot-detail-adapter") {
    return [/\/auction-lot\//i, /\/lot\//i, /\/item\//i];
  }
  if (adapterId === "liveauctioneers-public-lot-adapter") {
    return [/\/item\/\d+/i, /\/lot\//i, /\/catalog\/\d+/i];
  }
  if (adapterId === "sanatfiyat-licensed-extractor") {
    return [
      /\/(?:artist|search)\/artist-detail\//i,
      /\/(?:artist|search)\/(?:artwork-detail|result-detail|artist-result)\//i
    ];
  }
  return [];
}

function extractCandidatesFromSelectors(
  adapterId: string,
  html: string,
  pageUrl: string
): SourceCandidate[] {
  const hrefMatchers = sourceSpecificLinkMatchersForAdapter(adapterId);
  if (hrefMatchers.length === 0) {
    return [];
  }

  const candidates: SourceCandidate[] = [];
  const seen = new Set<string>();
  const normalizeSelectorHref = (href: string): string | null => {
    let parsed: URL;
    try {
      parsed = new URL(href, pageUrl);
    } catch {
      return null;
    }

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

    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname.endsWith(".oembed")
      || /\.(?:xml|rss|jpg|jpeg|png|gif|webp|svg|css|js|pdf|zip|mp3|mp4|ico)$/i.test(pathname)
    ) {
      return null;
    }

    return parsed.toString();
  };
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    const resolved = normalizeSelectorHref(href);
    if (!resolved) continue;
    if (!hrefMatchers.some((matcher) => matcher.test(resolved)) || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    candidates.push(toCandidate(resolved, inferCandidatePageType(resolved), "listing_expansion", 0.79, pageUrl));
  }

  return candidates;
}

export class DeterministicVenueAdapter implements SourceAdapter {
  public readonly id: string;
  public readonly sourceName: string;
  public readonly venueName: string;
  public readonly venueType: SourceAdapter["venueType"];
  public readonly sourcePageType: SourceAdapter["sourcePageType"];
  public readonly tier: SourceAdapter["tier"];
  public readonly country: string | null;
  public readonly city: string | null;
  public readonly requiresAuth: boolean;
  public readonly requiresLicense: boolean;
  public readonly supportedAccessModes: SourceAdapter["supportedAccessModes"];
  public readonly crawlStrategies: SourceAdapter["crawlStrategies"];
  public readonly capabilities: SourceAdapter["capabilities"];

  private readonly baseUrl: string;
  private readonly searchPaths: string[];
  private readonly lotUrlMatchers: RegExp[];
  private readonly signatureIndicators: string[];
  private readonly venueRouteTemplates: string[];
  private readonly turkeyVenueHostPatterns: RegExp[];

  constructor(options: DeterministicAdapterOptions) {
    this.id = options.id;
    this.sourceName = options.sourceName;
    this.venueName = options.venueName;
    this.venueType = options.venueType;
    this.sourcePageType = options.sourcePageType;
    this.tier = options.tier;
    this.country = options.country;
    this.city = options.city;
    this.baseUrl = options.baseUrl;
    this.searchPaths = options.searchPaths;
    this.lotUrlMatchers = options.lotUrlMatchers;
    this.signatureIndicators = options.signatureIndicators ?? [];
    this.venueRouteTemplates = options.venueRouteTemplates ?? [];
    this.turkeyVenueHostPatterns = options.turkeyVenueHostPatterns ?? [/\.tr$/i, /muzayede/i, /auction/i];
    this.requiresAuth = Boolean(options.requiresAuth);
    this.requiresLicense = Boolean(options.requiresLicense);
    this.supportedAccessModes = options.supportedAccessModes ?? ["anonymous", "authorized", "licensed"];
    this.crawlStrategies = options.crawlStrategies ?? ["search", "listing_to_lot"];
    this.capabilities = options.capabilities ?? deriveDefaultSourceCapabilities({
      id: this.id,
      supportedAccessModes: this.supportedAccessModes,
      requiresAuth: this.requiresAuth,
      sourcePageType: this.sourcePageType,
      crawlStrategies: this.crawlStrategies
    });
  }

  public async discoverCandidates(query: AdapterExtractionContext["query"]): Promise<SourceCandidate[]> {
    const encodedQuery = encodeURIComponent(buildPrimaryQuery(query));
    const seeds: SourceCandidate[] = this.searchPaths.map((searchPath) =>
      toCandidate(`${this.baseUrl}${searchPath}${encodedQuery}`, this.sourcePageType, "seed", 0.9)
    );
    return seeds;
  }

  public async extract(candidate: SourceCandidate, context: AdapterExtractionContext): Promise<AdapterExtractionResult> {
    const decision = evaluateAccessDecision(context, this.requiresAuth, this.requiresLicense);
    if (!decision.canProceed) {
      return buildBlockedResult(this, candidate, context, decision);
    }

    const fetchedAt = new Date().toISOString();
    const extracted = await fetchCheapestFirst(candidate.url, context.sessionContext);
    const rawSnapshotPath = ensureRawPath(context.evidenceDir, `${this.id}-${Date.now()}-deterministic.html`);
    writeRawSnapshot(rawSnapshotPath, extracted.html || extracted.markdown);

    const combinedContent = `${extracted.markdown} ${extracted.html}`;
    let parsed = parseGenericLotFields(combinedContent, extracted.url);
    const sourceSpecificPatch = parseSourceSpecificPatch(this.id, extracted.html, extracted.markdown);
    parsed = mergeSourceSpecificParsed(parsed, sourceSpecificPatch, this.id === "sanatfiyat-licensed-extractor");

    let modelUsed: string | null = null;
    if (parsed.priceType === "unknown" && combinedContent.length > 120) {
      const structured = await extractWithGeminiSchema({
        content: combinedContent
      });

      if (structured) {
        parsed.priceType = structured.priceType;
        parsed.estimateLow = structured.estimateLow;
        parsed.estimateHigh = structured.estimateHigh;
        parsed.priceAmount = structured.priceAmount;
        parsed.currency = structured.currency;
        parsed.lotNumber = structured.lotNumber;
        parsed.saleDate = structured.saleDate;
        parsed.priceHidden = structured.priceHidden;
        parsed.buyersPremiumIncluded = structured.buyersPremiumIncluded;
        modelUsed = process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
      }
    }

    const signatureMatched =
      (this.signatureIndicators.length > 0 && hasAnySignature(combinedContent, this.signatureIndicators)) ||
      detectMuzayedeSignature(combinedContent, extracted.url);
    const outageReason = detectOutageReason(combinedContent, extracted.url);

    const lotCandidates = extractHrefCandidates(
      extracted.html,
      extracted.url,
      "lot",
      signatureMatched ? "signature_expansion" : "listing_expansion",
      signatureMatched ? 0.82 : 0.72,
      this.lotUrlMatchers
    );
    const selectorCandidates = extractCandidatesFromSelectors(this.id, extracted.html, extracted.url);
    const venueOrigins = signatureMatched
      ? extractVenueOrigins(extracted.html, extracted.url, this.turkeyVenueHostPatterns)
      : [];
    const venueRouteCandidates = buildVenueRouteCandidates(
      venueOrigins,
      this.venueRouteTemplates,
      context.query,
      "listing",
      extracted.url
    );
    const allowedHosts = new Set<string>();
    for (const candidateUrl of [this.baseUrl, candidate.url, extracted.url]) {
      const host = hostForUrl(candidateUrl);
      if (host) {
        allowedHosts.add(host);
      }
    }
    for (const origin of venueOrigins) {
      const host = hostForUrl(origin);
      if (host) {
        allowedHosts.add(host);
      }
    }
    const discoveredCandidates = outageReason
      ? []
      : [...lotCandidates, ...selectorCandidates, ...venueRouteCandidates]
        .map((discovered) => ({
          ...discovered,
          sourcePageType: inferCandidatePageType(discovered.url, discovered.sourcePageType)
        }))
        .filter((candidate, index, array) => {
        return isAllowedVenueUrl(candidate.url, allowedHosts) && array.findIndex((entry) => entry.url === candidate.url) === index;
      });

    const effectiveSourceStatus: SourceAccessStatus = parsed.priceHidden
      ? "price_hidden"
      : outageReason
        ? "blocked"
        : decision.sourceAccessStatus;
    let acceptance = evaluateAcceptance(parsed, effectiveSourceStatus, {
      sourceName: this.sourceName,
      sourcePageType: candidate.sourcePageType,
      candidateUrl: candidate.url,
      queryArtist: context.query.artist,
      queryTitle: context.query.title
    });
    if (effectiveSourceStatus !== "blocked" && looksLikeSearchShell(candidate.url, extracted.url, extracted.html)) {
      acceptance = {
        acceptedForEvidence: false,
        acceptedForValuation: false,
        valuationLane: "none",
        acceptanceReason: "generic_shell_page",
        rejectionReason: "Search/listing shell page detected; retained only for discovery expansion.",
        valuationEligibilityReason: "Search shells are excluded from evidence and valuation."
      };
    } else if (
      effectiveSourceStatus !== "blocked"
      && (
        titleIndicatesDifferentArtist(parsed.title, context.query.artist)
        || (
          candidate.sourcePageType !== "price_db"
          && looksLikeEntityMismatch(candidate.url, combinedContent, context.query)
        )
      )
    ) {
      acceptance = {
        acceptedForEvidence: false,
        acceptedForValuation: false,
        valuationLane: "none",
        acceptanceReason: "entity_mismatch",
        rejectionReason: "Extracted record did not match the requested artist or work.",
        valuationEligibilityReason: "Entity mismatch records are excluded from evidence and valuation."
      };
    }
    const record = buildRecordFromParsed(this, candidate, context, parsed, rawSnapshotPath, acceptance);
    record.source_access_status = effectiveSourceStatus;

    const accepted = acceptance.acceptedForEvidence;
    const attempt: SourceAttempt = {
      run_id: context.runId,
      source_name: this.sourceName,
      source_url: candidate.url,
      canonical_url: extracted.url,
      access_mode: context.accessContext.mode,
      source_access_status: effectiveSourceStatus,
      failure_class: outageReason ? "transport_other" : undefined,
      access_reason: outageReason ? `${decision.accessReason} ${outageReason}` : decision.accessReason,
      blocker_reason: outageReason,
      transport_kind: null,
      transport_provider: null,
      transport_host: null,
      transport_status_code: null,
      transport_retryable: null,
      extracted_fields: {
        lot_number: parsed.lotNumber,
        estimate_low: parsed.estimateLow,
        estimate_high: parsed.estimateHigh,
        price_type: parsed.priceType,
        price_amount: parsed.priceAmount,
        currency: parsed.currency,
        buyers_premium_included: parsed.buyersPremiumIncluded
      },
      discovery_provenance: candidate.provenance,
      discovery_score: candidate.score,
      discovered_from_url: candidate.discoveredFromUrl ?? null,
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: rawSnapshotPath,
      trace_path: null,
      har_path: null,
      fetched_at: fetchedAt,
      parser_used: extracted.parserUsed,
      model_used: modelUsed,
      extraction_confidence: record.extraction_confidence,
      entity_match_confidence: record.entity_match_confidence,
      source_reliability_confidence: record.source_reliability_confidence,
      confidence_score: record.overall_confidence,
      accepted,
      accepted_for_evidence: acceptance.acceptedForEvidence,
      accepted_for_valuation: acceptance.acceptedForValuation,
      valuation_lane: acceptance.valuationLane,
      acceptance_reason: acceptance.acceptanceReason,
      rejection_reason: acceptance.rejectionReason,
      valuation_eligibility_reason: acceptance.valuationEligibilityReason
    };

    const shouldEscalateForMissingPrice =
      acceptance.acceptedForEvidence &&
      !acceptance.acceptedForValuation &&
      parsed.priceType !== "inquiry_only" &&
      !parsed.priceHidden;
    const shouldSuppressBrowserVerification = acceptance.acceptanceReason === "generic_shell_page";

    return {
      attempt,
      record: accepted ? record : null,
      discoveredCandidates,
      needsBrowserVerification:
        !shouldSuppressBrowserVerification &&
        (shouldEscalateForMissingPrice || !accepted || context.accessContext.mode !== "anonymous")
    };
  }
}

export function buildSpecializedAdapters(): SourceAdapter[] {
  return [
    new DeterministicVenueAdapter({
      id: "muzayedeapp-platform",
      sourceName: "Muzayede App Platform",
      venueName: "Muzayede App",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: null,
      baseUrl: "https://muzayede.app",
      searchPaths: ["/arama.html?search_words=", "/search?q="],
      lotUrlMatchers: [
        /\/lot\//i,
        /\/eser\//i,
        /\/urun\//i,
        /\/lots?\//i,
        /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i,
        /\/[^/?#]*m(?:u|ü)zayedesi[^/?#]*\.html(?:\?.*)?$/i,
        /\/[^/?#]*mezat[^/?#]*\.html(?:\?.*)?$/i
      ],
      signatureIndicators: ["powered by müzayede app", "powered by muzayede app", "muzayede.app"],
      venueRouteTemplates: ["/arama.html?search_words={q}", "/search?q={q}", "/muzayede?q={q}", "/arsiv?q={q}"],
      turkeyVenueHostPatterns: [
        /\.tr$/i,
        /artmezat/i,
        /bayrakmuzayede/i,
        /clarmuzayede/i,
        /turelart/i,
        /antikasa/i,
        /rportakal/i,
        /muzayede/i
      ]
    }),
    new DeterministicVenueAdapter({
      id: "bayrak-muzayede-listing",
      sourceName: "Bayrak Muzayede Listing",
      venueName: "Bayrak Muzayede",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.bayrakmuzayede.com",
      searchPaths: ["/arama.html?search_words=", "/search?q="],
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i, /\/urun\//i, /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i]
    }),
    new DeterministicVenueAdapter({
      id: "bayrak-muzayede-lot",
      sourceName: "Bayrak Muzayede Lot",
      venueName: "Bayrak Muzayede",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.bayrakmuzayede.com",
      searchPaths: ["/arama.html?search_words=", "/lot?q=", "/eser?q="],
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i, /\/urun\//i, /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i]
    }),
    new DeterministicVenueAdapter({
      id: "turel-art-listing",
      sourceName: "Turel Art Listing",
      venueName: "Turel Art",
      venueType: "gallery",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.turelart.com",
      searchPaths: ["/search?q=", "/?s="],
      lotUrlMatchers: [/\/tablo\//i, /\/urun\//i, /\/product\//i]
    }),
    new DeterministicVenueAdapter({
      id: "antikasa-lot-adapter",
      sourceName: "Antik A.S. Lot",
      venueName: "Antik A.S.",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.antikasa.com.tr",
      searchPaths: ["/arama?q=", "/lot?q="],
      lotUrlMatchers: [/\/lot\//i, /\/muzayede\//i]
    }),
    new DeterministicVenueAdapter({
      id: "portakal-catalog",
      sourceName: "Portakal Online Catalog",
      venueName: "Portakal Art and Culture House",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.rportakal.com",
      searchPaths: ["/search?q=", "/en/search?q="],
      lotUrlMatchers: [/\/lot\//i, /\/auction\//i, /\/catalog\//i, /\/(?:en\/)?products\//i]
    }),
    new DeterministicVenueAdapter({
      id: "clar-buy-now",
      sourceName: "Clar Buy Now",
      venueName: "Clar Müzayede",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.clarmuzayede.com",
      searchPaths: ["/hemen-al?search=", "/hemen-al?q="],
      lotUrlMatchers: [
        /\/lot\//i,
        /\/urun\//i,
        /\/buy-now\//i,
        /\/hemen-al\/[^/?#]+\/\d+/i,
        /\/hemen-al\/\d+\//i
      ],
      crawlStrategies: ["search", "listing_to_lot", "rendered_dom"]
    }),
    new DeterministicVenueAdapter({
      id: "clar-archive",
      sourceName: "Clar Auction Archive",
      venueName: "Clar Müzayede",
      venueType: "auction_house",
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.clarmuzayede.com",
      searchPaths: ["/muzayede-arsivi?search=", "/auction-archive?q=", "/arsiv?q="],
      lotUrlMatchers: [
        /\/lot\//i,
        /\/archive\//i,
        /\/auction\//i,
        /\/muzayede-arsivi\/[^/?#]+\/\d+/i,
        /\/muzayede\/\d+\//i,
        /\/canli-muzayede\/\d+\//i
      ],
      crawlStrategies: ["search", "listing_to_lot", "rendered_dom"]
    }),
    new DeterministicVenueAdapter({
      id: "invaluable-lot-detail-adapter",
      sourceName: "Invaluable Lot Detail",
      venueName: "Invaluable",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 3,
      country: null,
      city: null,
      baseUrl: "https://www.invaluable.com",
      searchPaths: ["/search?query=", "/search?keyword="],
      lotUrlMatchers: [/\/auction-lot\//i, /\/lot\//i, /\/item\//i]
    }),
    new DeterministicVenueAdapter({
      id: "liveauctioneers-public-lot-adapter",
      sourceName: "LiveAuctioneers Public Lots",
      venueName: "LiveAuctioneers",
      venueType: "marketplace",
      sourcePageType: "listing",
      tier: 3,
      country: null,
      city: null,
      baseUrl: "https://www.liveauctioneers.com",
      searchPaths: ["/search/?keyword=", "/search/?q="],
      lotUrlMatchers: [/\/item\/\d+/i, /\/catalog\/\d+/i, /\/lot\//i]
    }),
    new DeterministicVenueAdapter({
      id: "sanatfiyat-licensed-extractor",
      sourceName: "Sanatfiyat",
      venueName: "Sanatfiyat",
      venueType: "database",
      sourcePageType: "price_db",
      tier: 2,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://www.sanatfiyat.com",
      searchPaths: ["/search?q=", "/artist?q="],
      lotUrlMatchers: [/\/lot\//i, /\/result\//i, /\/eser\//i],
      requiresAuth: true,
      requiresLicense: true,
      supportedAccessModes: ["licensed"]
    })
  ];
}
