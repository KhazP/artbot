import { extractWithGeminiSchema, fetchCheapestFirst, parseGenericLotFields } from "@artbot/extraction";
import type { PriceRecord, SourceAttempt } from "@artbot/shared-types";
import type { AdapterExtractionContext, AdapterExtractionResult, SourceAdapter, SourceCandidate } from "../types.js";
import {
  buildBlockedResult,
  buildRecordFromParsed,
  ensureRawPath,
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

function confidenceFor(record: PriceRecord): number {
  if (record.price_hidden) return 0.78;
  if (record.price_type === "realized_with_buyers_premium") return 0.86;
  if (record.price_type === "realized_price" || record.price_type === "hammer_price") return 0.82;
  if (record.price_type === "estimate") return 0.74;
  if (record.price_type === "asking_price") return 0.68;
  return 0.3;
}

export function detectMuzayedeSignature(content: string, sourceUrl: string): boolean {
  return hasAnySignature(content, ["powered by müzayede app", "powered by muzayede app", "muzayede.app"]) ||
    /muzayede\.app|muzayedeapp\.com/i.test(sourceUrl);
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
    const extracted = await fetchCheapestFirst(candidate.url);
    const rawSnapshotPath = ensureRawPath(context.evidenceDir, `${this.id}-${Date.now()}-deterministic.html`);
    writeRawSnapshot(rawSnapshotPath, extracted.html || extracted.markdown);

    const combinedContent = `${extracted.markdown} ${extracted.html}`;
    const parsed = parseGenericLotFields(combinedContent);

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
    const lotCandidates = extractHrefCandidates(
      extracted.html,
      extracted.url,
      "lot",
      signatureMatched ? "signature_expansion" : "listing_expansion",
      signatureMatched ? 0.82 : 0.72,
      this.lotUrlMatchers
    );
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
    const discoveredCandidates = [...lotCandidates, ...venueRouteCandidates].filter((candidate, index, array) => {
      return isAllowedVenueUrl(candidate.url, allowedHosts) && array.findIndex((entry) => entry.url === candidate.url) === index;
    });

    const record = buildRecordFromParsed(this, candidate, context, parsed, rawSnapshotPath, 0.65);
    record.overall_confidence = confidenceFor(record);
    record.source_access_status = parsed.priceHidden ? "price_hidden" : decision.sourceAccessStatus;

    const accepted = parsed.priceType !== "unknown" || parsed.priceHidden;
    const attempt: SourceAttempt = {
      run_id: context.runId,
      source_name: this.sourceName,
      source_url: candidate.url,
      canonical_url: extracted.url,
      access_mode: context.accessContext.mode,
      source_access_status: record.source_access_status,
      access_reason: decision.accessReason,
      blocker_reason: null,
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
      confidence_score: record.overall_confidence,
      accepted,
      acceptance_reason: accepted
        ? "Deterministic extraction produced structured price data."
        : discoveredCandidates.length > 0
          ? `No direct price yet; discovered ${discoveredCandidates.length} lot candidates.`
          : "No reliable price fields found."
    };

    return {
      attempt,
      record: accepted ? record : null,
      discoveredCandidates,
      needsBrowserVerification: !accepted || context.accessContext.mode !== "anonymous"
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
      lotUrlMatchers: [/\/lot\//i, /\/eser\//i, /\/urun\//i, /\/lots?\//i],
      signatureIndicators: ["powered by müzayede app", "powered by muzayede app", "muzayede.app"],
      venueRouteTemplates: ["/arama?q={q}", "/search?q={q}", "/muzayede?q={q}", "/arsiv?q={q}"],
      turkeyVenueHostPatterns: [
        /\.tr$/i,
        /bayrakmuzayede/i,
        /clarauction/i,
        /turelart/i,
        /antikasa/i,
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
      baseUrl: "https://www.portakal.com",
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
      baseUrl: "https://clarauction.com",
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
      baseUrl: "https://clarauction.com",
      searchPaths: ["/auction-archive?q=", "/arsiv?q="],
      lotUrlMatchers: [/\/lot\//i, /\/archive\//i, /\/auction\//i]
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
