import { GenericSourceAdapter } from "./generic-adapter.js";
import { buildSpecializedAdapters } from "./specialized-adapters.js";
import { parseGenericLotFields } from "@artbot/extraction";
import type { SourceAttempt } from "@artbot/shared-types";
import type { AdapterExtractionContext, AdapterExtractionResult, SourceCandidate } from "../types.js";
import {
  buildAcceptanceExplanation,
  buildBlockedResult,
  buildNextStepHint,
  buildRecordFromParsed,
  ensureRawPath,
  evaluateAcceptance,
  evaluateAccessDecision,
  writeRawSnapshot
} from "./custom-adapter-utils.js";

const ARTAM_SEARCH_ARTISTS_URL = "https://artam.com/api/v1/search/search-artists";
const ARTAM_SEARCH_AUCTION_PRODUCTS_URL = "https://artam.com/api/v1/search/search-auction-products";
const ARTAM_ARTIST_PRODUCTS_URL = "https://artam.com/api/v1/artist-detail/get-products";
const ARTAM_PRODUCT_DETAIL_URL = "https://artam.com/api/v1/auction/online-products/get-detail";
const ARTAM_ARTIST_PRODUCTS_MAX_PAGES = toPositiveInt(process.env.ARTAM_ARTIST_PRODUCTS_MAX_PAGES, 18);
const ARTAM_ARTIST_PRODUCTS_PAGE_SIZE = toPositiveInt(process.env.ARTAM_ARTIST_PRODUCTS_PAGE_SIZE, 24);
const ARTAM_CANDIDATE_LIMIT = toPositiveInt(process.env.ARTAM_CANDIDATE_LIMIT, 360);
const ARTAM_FETCH_TIMEOUT_MS = toPositiveInt(process.env.ARTAM_API_TIMEOUT_MS, 12_000);
const ARTAM_DETAIL_ENRICHMENT_ENABLED =
  process.env.ARTAM_DETAIL_ENRICHMENT_ENABLED !== "false" && process.env.NODE_ENV !== "test";
const ARTAM_FALLBACK_ENTRYPOINTS = [
  "https://artam.com/sanatcilar/abidin-dino-1913-1993",
  "https://artam.com/arama?q=Abidin%20Dino",
  "https://artam.com/muzayede",
  "https://artam.com/robots.txt"
];
const ARTAM_DISCOVERY_PROVENANCE = "signature_expansion" as const;
const artamCandidateCache = new Map<string, SourceCandidate[]>();
const artamArtistIdCache = new Map<string, number | null>();
const artamArtistProductsCache = new Map<string, ArtamProductSummary[]>();
const artamProductByCandidateUrl = new Map<string, ArtamProductSummary>();

interface ArtamProductSummary {
  id?: number;
  url?: string | null;
  artistName?: string | null;
  name?: string | null;
  lotno?: string | number | null;
  auction_price?: number | string | null;
  opening_price?: number | string | null;
  estimatedMin?: number | string | null;
  estimatedMax?: number | string | null;
  isShowPrice?: boolean | null;
  short_desc?: string | null;
  currency?:
    | {
      code?: string | null;
      name?: string | null;
      print?: string | null;
    }
    | string
    | null;
}

interface ArtamArtistSummary {
  id?: number;
  name?: string | null;
  products?: ArtamProductSummary[];
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeForMatching(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function queryTokensForArtam(query: { artist: string; title?: string | null }): string[] {
  const normalized = normalizeForMatching([query.artist, query.title].filter(Boolean).join(" "));
  return normalized
    .split("-")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 6);
}

function buildArtamQueryVariants(query: { artist: string; title?: string | null }): string[] {
  const variants = new Set<string>();
  const artist = query.artist.trim();
  const title = query.title?.trim();
  const artistTokens = artist.split(/\s+/).filter((token) => token.length >= 3);

  if (artist) {
    variants.add(artist);
  }
  if (artistTokens.length > 0) {
    variants.add(artistTokens.join(" "));
  }
  if (artistTokens.length > 1) {
    variants.add(artistTokens[0] ?? artist);
    variants.add(artistTokens[artistTokens.length - 1] ?? artist);
  }
  if (artist && title) {
    variants.add(`${artist} ${title}`);
  }

  const normalized = normalizeForMatching(artist);
  if (normalized) {
    variants.add(normalized.replace(/-/g, " "));
  }

  return [...variants].filter((variant) => variant.length >= 3).slice(0, 6);
}

function buildArtamDetailUrl(productId: number): string {
  return `${ARTAM_PRODUCT_DETAIL_URL}?id=${productId}`;
}

function isMatchingArtistName(name: string | null | undefined, query: { artist: string; title?: string | null }): boolean {
  if (!name) return false;
  const normalizedName = normalizeForMatching(name);
  const tokens = queryTokensForArtam(query);
  if (tokens.length === 0) return false;
  return tokens.every((token) => normalizedName.includes(token));
}

function productLooksRelevant(product: ArtamProductSummary, query: { artist: string; title?: string | null }): boolean {
  if (isMatchingArtistName(product.artistName, query)) {
    return true;
  }

  const normalized = normalizeForMatching(
    [product.artistName, product.name, product.url ?? ""].filter(Boolean).join(" ")
  );
  const tokens = queryTokensForArtam(query);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}

function candidateFromArtamProduct(product: ArtamProductSummary, discoveredFromUrl: string): SourceCandidate | null {
  if (typeof product.id === "number" && Number.isFinite(product.id) && product.id > 0) {
    return {
      url: buildArtamDetailUrl(product.id),
      sourcePageType: "lot",
      provenance: ARTAM_DISCOVERY_PROVENANCE,
      score: 0.97,
      discoveredFromUrl
    };
  }

  if (typeof product.url === "string" && product.url.trim().length > 0) {
    const absoluteUrl = product.url.startsWith("http") ? product.url : `https://artam.com${product.url}`;
    return {
      url: absoluteUrl,
      sourcePageType: "lot",
      provenance: ARTAM_DISCOVERY_PROVENANCE,
      score: 0.92,
      discoveredFromUrl
    };
  }

  return null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "ArtBot/0.2 (+https://artbot.local)"
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseArtamNumeric(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[^0-9,.\-]/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const normalized = cleaned.includes(",") && cleaned.includes(".")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.includes(",")
      ? cleaned.replace(",", ".")
      : cleaned;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasArtamPriceSignal(product: ArtamProductSummary | null | undefined): boolean {
  if (!product) {
    return false;
  }
  const opening = parseArtamNumeric(product.opening_price);
  const auction = parseArtamNumeric(product.auction_price);
  const estimateMin = parseArtamNumeric(product.estimatedMin);
  const estimateMax = parseArtamNumeric(product.estimatedMax);
  return (
    (typeof opening === "number" && opening > 0)
    || (typeof auction === "number" && auction > 0)
    || (typeof estimateMin === "number" && estimateMin > 0)
    || (typeof estimateMax === "number" && estimateMax > 0)
  );
}

async function fetchArtamDetailProduct(detailUrl: string): Promise<ArtamProductSummary | null> {
  const payload = (await fetchJson(detailUrl, ARTAM_FETCH_TIMEOUT_MS)) as { product?: ArtamProductSummary } | null;
  if (!payload || typeof payload.product !== "object" || payload.product === null) {
    return null;
  }
  return payload.product;
}

async function resolveArtamArtistLookup(query: {
  artist: string;
  title?: string | null;
}): Promise<{ artistId: number | null; products: ArtamProductSummary[] }> {
  const cacheKey = normalizeForMatching(query.artist);
  if (artamArtistIdCache.has(cacheKey) || artamArtistProductsCache.has(cacheKey)) {
    return {
      artistId: artamArtistIdCache.get(cacheKey) ?? null,
      products: artamArtistProductsCache.get(cacheKey) ?? []
    };
  }

  const endpoint = `${ARTAM_SEARCH_ARTISTS_URL}?q=${encodeURIComponent(query.artist)}`;
  const payload = (await fetchJson(endpoint, ARTAM_FETCH_TIMEOUT_MS)) as { artists?: ArtamArtistSummary[] } | null;
  const artists = payload?.artists ?? [];

  const matched = artists.find((artist) => isMatchingArtistName(artist.name, query) && typeof artist.id === "number");
  const artistId = typeof matched?.id === "number" ? matched.id : null;
  const products = Array.isArray(matched?.products) ? matched.products : [];
  artamArtistIdCache.set(cacheKey, artistId);
  artamArtistProductsCache.set(cacheKey, products);
  return { artistId, products };
}

async function fetchArtistProducts(artistId: number): Promise<ArtamProductSummary[]> {
  const products: ArtamProductSummary[] = [];
  for (let page = 1; page <= ARTAM_ARTIST_PRODUCTS_MAX_PAGES; page += 1) {
    if (products.length >= ARTAM_CANDIDATE_LIMIT) break;

    const endpoint = `${ARTAM_ARTIST_PRODUCTS_URL}?page=${page}&artist_id=${artistId}`;
    const payload = (await fetchJson(endpoint, ARTAM_FETCH_TIMEOUT_MS)) as { products?: ArtamProductSummary[] } | null;
    const pageItems = payload?.products ?? [];
    if (pageItems.length === 0) {
      break;
    }

    products.push(...pageItems);
    if (pageItems.length < ARTAM_ARTIST_PRODUCTS_PAGE_SIZE) {
      break;
    }
  }
  return products;
}

async function fetchSearchProducts(queryVariants: string[]): Promise<ArtamProductSummary[]> {
  const discovered: ArtamProductSummary[] = [];
  for (const variant of queryVariants) {
    if (discovered.length >= ARTAM_CANDIDATE_LIMIT) break;
    const endpoint = `${ARTAM_SEARCH_AUCTION_PRODUCTS_URL}?q=${encodeURIComponent(variant)}`;
    const payload = (await fetchJson(endpoint, ARTAM_FETCH_TIMEOUT_MS)) as { products?: ArtamProductSummary[] } | null;
    const pageItems = payload?.products ?? [];
    if (pageItems.length > 0) {
      discovered.push(...pageItems);
    }
  }
  return discovered;
}

async function discoverArtamCandidates(query: { artist: string; title?: string | null }): Promise<SourceCandidate[]> {
  const queryVariants = buildArtamQueryVariants(query);
  const cacheKey = queryVariants.join("|");
  const cached = artamCandidateCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  const candidatesByUrl = new Map<string, SourceCandidate>();
  const artistLookup = await resolveArtamArtistLookup(query);
  const artistId = artistLookup.artistId;
  const artistEndpoint = artistId ? `${ARTAM_ARTIST_PRODUCTS_URL}?page=1&artist_id=${artistId}` : ARTAM_SEARCH_ARTISTS_URL;

  for (const product of artistLookup.products) {
    if (candidatesByUrl.size >= ARTAM_CANDIDATE_LIMIT) break;
    const candidate = candidateFromArtamProduct(product, ARTAM_SEARCH_ARTISTS_URL);
    if (!candidate) continue;
    candidatesByUrl.set(candidate.url, candidate);
    artamProductByCandidateUrl.set(candidate.url, product);
  }

  if (artistId) {
    const products = await fetchArtistProducts(artistId);
    for (const product of products) {
      if (candidatesByUrl.size >= ARTAM_CANDIDATE_LIMIT) break;
      const candidate = candidateFromArtamProduct(product, artistEndpoint);
      if (!candidate) continue;
      candidatesByUrl.set(candidate.url, candidate);
      artamProductByCandidateUrl.set(candidate.url, product);
    }
  }

  if (candidatesByUrl.size < ARTAM_CANDIDATE_LIMIT) {
    const searchProducts = await fetchSearchProducts(queryVariants);
    for (const product of searchProducts) {
      if (candidatesByUrl.size >= ARTAM_CANDIDATE_LIMIT) break;
      if (!productLooksRelevant(product, query)) continue;
      const candidate = candidateFromArtamProduct(product, ARTAM_SEARCH_AUCTION_PRODUCTS_URL);
      if (!candidate) continue;
      candidatesByUrl.set(candidate.url, candidate);
      artamProductByCandidateUrl.set(candidate.url, product);
    }
  }

  const candidates = [...candidatesByUrl.values()];

  if (candidates.length > 0) {
    artamCandidateCache.set(cacheKey, candidates);
  }
  return candidates;
}

class ArtamApiAdapter extends GenericSourceAdapter {
  public override async discoverCandidates(
    query: Parameters<GenericSourceAdapter["discoverCandidates"]>[0]
  ): Promise<SourceCandidate[]> {
    if (process.env.NODE_ENV === "test" && process.env.ARTAM_API_DISCOVERY_TEST !== "true") {
      return super.discoverCandidates(query);
    }

    const apiCandidates = await discoverArtamCandidates(query);
    if (apiCandidates.length > 0) {
      return apiCandidates;
    }
    return ARTAM_FALLBACK_ENTRYPOINTS.map(
      (url): SourceCandidate => ({
        url,
        sourcePageType: "listing",
        provenance: ARTAM_DISCOVERY_PROVENANCE,
        score: 0.7,
        discoveredFromUrl: ARTAM_SEARCH_AUCTION_PRODUCTS_URL
      })
    );
  }

  public override async extract(
    candidate: SourceCandidate,
    context: AdapterExtractionContext
  ): Promise<AdapterExtractionResult> {
    const cachedProduct = artamProductByCandidateUrl.get(candidate.url) ?? null;
    let productForExtraction = cachedProduct;

    if (
      ARTAM_DETAIL_ENRICHMENT_ENABLED
      && candidate.url.startsWith(ARTAM_PRODUCT_DETAIL_URL)
      && !hasArtamPriceSignal(productForExtraction)
    ) {
      const detailProduct = await fetchArtamDetailProduct(candidate.url);
      if (detailProduct) {
        productForExtraction = {
          ...(productForExtraction ?? {}),
          ...detailProduct
        };
        artamProductByCandidateUrl.set(candidate.url, productForExtraction);
      }
    }

    if (!productForExtraction) {
      return super.extract(candidate, context);
    }

    const decision = evaluateAccessDecision(context, this.requiresAuth, this.requiresLicense);
    if (!decision.canProceed) {
      return buildBlockedResult(this, candidate, context, decision);
    }

    const fetchedAt = new Date().toISOString();
    const payload = JSON.stringify({
      product: {
        ...productForExtraction,
        artistName: productForExtraction.artistName ?? context.query.artist
      }
    });
    const rawSnapshotPath = ensureRawPath(context.evidenceDir, `${this.id}-${Date.now()}-artam-api.json`);
    writeRawSnapshot(rawSnapshotPath, payload, context.accessContext);

    const parsed = parseGenericLotFields(payload, candidate.url);
    if (!parsed.artistName && context.query.artist) {
      parsed.artistName = context.query.artist;
    }
    const sourceStatus = parsed.priceHidden ? "price_hidden" : decision.sourceAccessStatus;
    const acceptance = evaluateAcceptance(parsed, sourceStatus, {
      sourceName: this.sourceName,
      sourcePageType: candidate.sourcePageType,
      candidateUrl: candidate.url,
      queryArtist: context.query.artist,
      queryTitle: context.query.title
    });

    const record = buildRecordFromParsed(
      {
        venueName: this.venueName,
        venueType: this.venueType,
        sourceName: this.sourceName,
        city: this.city,
        country: this.country,
        tier: this.tier,
        capabilities: this.capabilities
      },
      candidate,
      context,
      parsed,
      rawSnapshotPath,
      acceptance
    );

    const attempt: SourceAttempt = {
      run_id: context.runId,
      source_name: this.sourceName,
      source_family: this.capabilities.source_family,
      venue_name: this.venueName,
      source_url: candidate.url,
      canonical_url: candidate.url,
      access_mode: context.accessContext.mode,
      source_legal_posture: context.accessContext.legalPosture,
      access_provenance_label: context.accessContext.accessProvenanceLabel ?? null,
      session_identity: context.accessContext.sessionIdentity ?? null,
      browser_identity: context.accessContext.browserIdentity ?? null,
      proxy_identity: context.accessContext.proxyIdentity ?? null,
      artifact_handling: context.accessContext.artifactHandling,
      source_access_status: sourceStatus,
      failure_class: undefined,
      access_reason: decision.accessReason,
      blocker_reason: null,
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
        buyers_premium_included: parsed.buyersPremiumIncluded,
        title: parsed.title,
        medium: parsed.medium,
        year: parsed.year,
        dimensions_text: parsed.dimensionsText
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
      parser_used: "artam-api-cache",
      model_used: null,
      extraction_confidence: record.extraction_confidence,
      entity_match_confidence: record.entity_match_confidence,
      source_reliability_confidence: record.source_reliability_confidence,
      confidence_score: record.overall_confidence,
      accepted: acceptance.acceptedForEvidence,
      accepted_for_evidence: acceptance.acceptedForEvidence,
      accepted_for_valuation: acceptance.acceptedForValuation,
      valuation_lane: acceptance.valuationLane,
      acceptance_reason: acceptance.acceptanceReason,
      rejection_reason: acceptance.rejectionReason,
      valuation_eligibility_reason: acceptance.valuationEligibilityReason,
      acceptance_explanation: buildAcceptanceExplanation(this.sourceName, acceptance, sourceStatus),
      next_step_hint: buildNextStepHint(this.sourceName, acceptance, sourceStatus)
    };

    const shouldEscalateForMissingPrice =
      acceptance.acceptedForEvidence &&
      !acceptance.acceptedForValuation &&
      parsed.priceType !== "inquiry_only" &&
      !parsed.priceHidden;
    const shouldSuppressBrowserVerification = acceptance.acceptanceReason === "generic_shell_page";

    return {
      attempt,
      record: acceptance.acceptedForEvidence ? record : null,
      needsBrowserVerification:
        !shouldSuppressBrowserVerification &&
        (shouldEscalateForMissingPrice || !acceptance.acceptedForEvidence || context.accessContext.mode !== "anonymous")
    };
  }
}

export function buildSeedAdapters() {
  const includeOptionalProbeAdapters = process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS === "true";

  const baselineAdapters = [
    ...buildSpecializedAdapters(),
    new ArtamApiAdapter({
      id: "artam-auction-records",
      sourceName: "Artam Auction Records",
      venueName: "Artam Antik A.S.",
      venueType: "auction_house",
      sourcePageType: "lot",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://artam.com",
      searchPath: "/en/search?q="
    }),
    new ArtamApiAdapter({
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
      sourcePageType: "listing",
      tier: 1,
      country: "Turkey",
      city: "Istanbul",
      baseUrl: "https://alifart.com.tr",
      searchPath: "/?s="
    }),
    new GenericSourceAdapter({
      id: "sothebys-lot",
      sourceName: "Sothebys",
      venueName: "Sothebys",
      venueType: "auction_house",
      sourcePageType: "listing",
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
      sourcePageType: "listing",
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
      sourcePageType: "listing",
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
      sourcePageType: "listing",
      tier: 1,
      country: null,
      city: null,
      baseUrl: "https://www.phillips.com",
      searchPath: "/search/"
    })
  ];

  const optionalProbeAdapters = [
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
    })
  ];

  return includeOptionalProbeAdapters
    ? [...baselineAdapters, ...optionalProbeAdapters]
    : baselineAdapters;
}
