import { extractWithGeminiSchema, fetchCheapestFirst, parseGenericLotFields, type GenericParsedFields } from "@artbot/extraction";
import type { SourceAccessStatus, SourceAttempt } from "@artbot/shared-types";
import type { AdapterExtractionContext, AdapterExtractionResult, SourceAdapter, SourceCandidate } from "../types.js";
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

function hasNumericValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function mergeSourceSpecificParsed(base: GenericParsedFields, patch: GenericParsedFields | null): GenericParsedFields {
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
    priceAmount: hasNumericValue(base.priceAmount) ? base.priceAmount : patch.priceAmount,
    currency: base.currency ?? patch.currency,
    saleDate: base.saleDate ?? patch.saleDate,
    priceType:
      base.priceType === "unknown" ||
      (base.priceType === "asking_price" &&
        (patch.priceType === "realized_price" || patch.priceType === "hammer_price" || patch.priceType === "estimate"))
        ? patch.priceType
        : base.priceType,
    priceHidden: base.priceHidden || patch.priceHidden,
    buyersPremiumIncluded:
      base.buyersPremiumIncluded !== null && base.buyersPremiumIncluded !== undefined
        ? base.buyersPremiumIncluded
        : patch.buyersPremiumIncluded
  };

  return merged;
}

function sourceSpecificLinkMatchersForAdapter(adapterId: string): RegExp[] {
  if (adapterId === "bayrak-muzayede-listing" || adapterId === "bayrak-muzayede-lot") {
    return [/\/lot\//i, /\/eser\//i, /\/urun\//i];
  }
  if (adapterId === "muzayedeapp-platform") {
    return [/\/lot\//i, /\/eser\//i, /\/urun\//i];
  }
  if (adapterId === "clar-buy-now") {
    return [/\/urun\//i, /\/lot\//i];
  }
  if (adapterId === "portakal-catalog") {
    return [/\/lot\//i, /\/auction\//i, /\/catalog\//i];
  }
  if (adapterId === "invaluable-lot-detail-adapter") {
    return [/\/auction-lot\//i, /\/lot\//i, /\/item\//i];
  }
  if (adapterId === "liveauctioneers-public-lot-adapter") {
    return [/\/item\/\d+/i, /\/lot\//i, /\/catalog\/\d+/i];
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
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!hrefMatchers.some((matcher) => matcher.test(resolved)) || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    candidates.push(toCandidate(resolved, "lot", "listing_expansion", 0.79, pageUrl));
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
    parsed = mergeSourceSpecificParsed(parsed, parseSourceSpecificPatch(this.id, extracted.html, extracted.markdown));

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
    const discoveredCandidates = outageReason
      ? []
      : [...lotCandidates, ...selectorCandidates, ...venueRouteCandidates].filter((candidate, index, array) => {
        return isAllowedVenueUrl(candidate.url, allowedHosts) && array.findIndex((entry) => entry.url === candidate.url) === index;
      });

    const effectiveSourceStatus: SourceAccessStatus = parsed.priceHidden
      ? "price_hidden"
      : outageReason
        ? "blocked"
        : decision.sourceAccessStatus;
    const acceptance = evaluateAcceptance(parsed, effectiveSourceStatus, {
      sourceName: this.sourceName,
      sourcePageType: candidate.sourcePageType
    });
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
      searchPaths: ["/arama?q=", "/search?q="],
      lotUrlMatchers: [
        /\/lot\//i,
        /\/eser\//i,
        /\/urun\//i,
        /\/lots?\//i,
        /\/[^/?#]*m(?:u|ü)zayedesi[^/?#]*\.html(?:\?.*)?$/i,
        /\/[^/?#]*mezat[^/?#]*\.html(?:\?.*)?$/i
      ],
      signatureIndicators: ["powered by müzayede app", "powered by muzayede app", "muzayede.app"],
      venueRouteTemplates: ["/arama?q={q}", "/search?q={q}", "/muzayede?q={q}", "/arsiv?q={q}"],
      turkeyVenueHostPatterns: [
        /\.tr$/i,
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
      searchPaths: ["/arama?q=", "/search?q="],
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i, /\/urun\//i]
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
      searchPaths: ["/lot?q=", "/eser?q="],
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i, /\/urun\//i]
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
      lotUrlMatchers: [/\/lot\//i, /\/auction\//i, /\/catalog\//i]
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
      searchPaths: ["/buy-now?q=", "/hemen-al?q="],
      lotUrlMatchers: [/\/lot\//i, /\/urun\//i, /\/buy-now\//i]
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
      searchPaths: ["/auction-archive?q=", "/arsiv?q="],
      lotUrlMatchers: [/\/lot\//i, /\/archive\//i, /\/auction\//i]
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
