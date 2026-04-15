import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Jimp } from "jimp";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "@artbot/browser-core";
import { isTransportError, parseGenericLotFields, TransportErrorKind } from "@artbot/extraction";
import { logger } from "@artbot/observability";
import { applyConfidenceModel, FxRateProvider, normalizeRecordCurrencies } from "@artbot/normalization";
import {
  renderArtistMarketInventoryReport,
  renderClustersCsv,
  renderInventoryCsv,
  renderReviewQueueCsv,
  writeJsonFile
} from "@artbot/report-generation";
import {
  acceptanceReasonList,
  artistMarketInventorySummarySchema,
  type CanaryResult,
  crawlModeSchema,
  type DiscoveryProviderDiagnostics,
  type CrawlLane,
  failureClassList,
  type ArtistMarketInventorySummary,
  type ArtworkCluster,
  type ArtworkImage,
  type ClusterMembership,
  type CrawlCheckpoint,
  type FrontierItem,
  type InventoryRecord,
  type LocalAiDecisionTrace,
  type PriceVisibility,
  type PriceRecord,
  type SaleChannel,
  type PriceType,
  type ReviewItem,
  type RunEntity,
  type RunSummary,
  type SourceAccessStatus,
  type SourceSurface,
  type SourceAttempt,
  type SourceHealthRecord,
  type SourceHost
} from "@artbot/shared-types";
import { evaluateAcceptance, type SourceCandidate, type SourceAdapter } from "@artbot/source-adapters";
import {
  buildDiscoveryConfigFromEnv,
  buildSourcePlanItems,
  inferSourceFamilyBucket,
  planSourcesWithDiagnostics,
  SourceRegistry,
  type PlannedSource,
  type SourceFamilyBucket,
  type SourcePlanningResult
} from "@artbot/source-registry";
import { ArtbotStorage, artistKeyFromName, buildDefaultGcPolicyFromEnv, buildRunArtifactManifest, writeArtifactManifest } from "@artbot/storage";
import {
  buildLocalAiAnalysisSummary,
  buildLocalAiRelevanceConfigFromEnv,
  evaluateBorderlinePairWithLocalAi,
  type LocalAiRelevanceConfig
} from "./local-ai-relevance.js";
import {
  applyRuntimeAttemptToFairnessStats,
  buildFairnessConfig,
  createRuntimeFairnessStats,
  scoreFrontierItem
} from "./frontier-fairness.js";
import { applyMergedLaneOutcome, captureLaneOutcome, mergeLaneOutcome, type LaneOutcome } from "./lane-outcomes.js";
import { buildEvaluationMetrics, buildRecommendedActions } from "./run-insights.js";

interface TargetImageFeatures {
  sha256: string;
  perceptualHash: string | null;
  embeddingVector: number[] | null;
}

interface PairDecision {
  action: "auto" | "review" | "none";
  confidence: number;
  reasons: string[];
  recommendedAction?: ReviewItem["recommended_action"];
}

interface ClusterBuildResult {
  clusters: ArtworkCluster[];
  memberships: ClusterMembership[];
  reviewItems: ReviewItem[];
  inventory: InventoryRecord[];
  localAiDecisions: LocalAiDecisionTrace[];
}

interface SourceRuntimeStats {
  sourceName: string;
  host: string;
  seedUrl: string | null;
  discoveredCount: number;
  newRecords: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeDiscoveryHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function normalizeCandidateUrl(url: string): string {
  try {
    const parsed = new URL(url);
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
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function inferSourcePageType(url: string): FrontierItem["source_page_type"] {
  const lower = url.toLowerCase();
  if (
    /\/(?:cart|sepet|account|giris|login|contact|iletisim|about|hakkimizda|download-app|siparislerim|desteklerim|privacy|gizlilik|uyelik|kargo|odeme|rss|feed)\b/.test(
      lower
    )
  ) {
    return "other";
  }
  if (
    /\/artist\/artwork-detail\//.test(lower)
    || /\/artist\/result-detail\//.test(lower)
    || /\/search\/result-detail\//.test(lower)
    || /\/search\/artwork-detail\//.test(lower)
    || /\/artist\/artist-result\//.test(lower)
    || /(\/lot\/|\/lots\/|\/auction\/lot|\/auction-lot\/|\/item\/\d+|\/lot-|\/(?:en\/)?products\/|\/urun\/|\/eser\/)/.test(lower)
    || /\/hemen-al\/[^/?#]+\/\d+/i.test(lower)
    || /\/hemen-al\/\d+\//i.test(lower)
    || /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i.test(lower)
  ) {
    return "lot";
  }
  if (/(\/artist\/|\/artists\/)/.test(lower)) return "artist_page";
  if (/(\/price|\/result|\/catalog|\/arsiv|\/archive|\/search|\/arama|\/hemen-al\b|\/muzayede\/\d+\/|page=)/.test(lower)) {
    return "listing";
  }
  return "other";
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

class CandidateTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly url: string) {
    super(`Frontier candidate timed out after ${timeoutMs}ms: ${url}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new CandidateTimeoutError(timeoutMs, url)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

const RENDERED_DISCOVERY_BLOCK_HOSTS = [
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "youtube.com",
  "x.com",
  "twitter.com",
  "whatsapp.com"
];

const RENDERED_DISCOVERY_BLOCK_PATH_PATTERNS = [
  /\/(?:cart|sepet)(?:[/?#.]|$)/i,
  /\/(?:account|hesabim|uyelik|login|register|signup|sign-in|sign-up)(?:[/?#.]|$)/i,
  /\/giris[^/]*(?:[/?#.]|$)/i,
  /\/[^/?#]*login(?:-[^/?#]*)?(?:\.html|[/?#]|$)/i,
  /\/(?:contact|iletisim|about|hakkimizda|privacy|gizlilik|terms|kosullar|sartlar-ve-kosullar)(?:[/?#.]|$)/i,
  /\/(?:download-app|siparislerim|desteklerim|sifremi(?:unuttum)?|odeme_bilgilendirme|kargo_bilgileri)(?:[/?#.]|$)/i,
  /\/(?:collections\/shop|collections\/private-sales|pages\/|shop|dukkan\.html|tumurunler\.html|muzayedeler\.html)(?:[/?#]|$)/i,
  /\/(?:rss|feed)(?:[/?#.]|$)/i
];

const GENERIC_DISCOVERED_URL_TOKENS = new Set([
  "lot",
  "lots",
  "item",
  "items",
  "product",
  "products",
  "urun",
  "urunler",
  "eser",
  "eserler",
  "resim",
  "tablo",
  "art",
  "auction",
  "muzayede",
  "muzayedesi",
  "hemen",
  "buy",
  "now",
  "canli",
  "arsiv",
  "archive",
  "catalog",
  "katalog",
  "search",
  "arama",
  "page",
  "sayfa"
]);

function normalizeEntityTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function urlReferencesQueryEntity(url: string, query: RunEntity["query"]): boolean {
  const haystack = url
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ");
  const titleTokens = normalizeEntityTokens(query.title ?? "");
  if (titleTokens.length > 0 && titleTokens.every((token) => haystack.includes(token))) {
    return true;
  }

  const artistTokens = normalizeEntityTokens(query.artist);
  return artistTokens.length > 0 && artistTokens.every((token) => haystack.includes(token));
}

function searchParamsReferenceQueryEntity(url: string, query: RunEntity["query"]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const keys = ["q", "query", "term", "entry", "s", "search", "search_words"];
  const values = keys
    .flatMap((key) => parsed.searchParams.getAll(key))
    .map((value) =>
      value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    )
    .filter(Boolean);

  if (values.length === 0) {
    return false;
  }

  const titleTokens = normalizeEntityTokens(query.title ?? "");
  if (titleTokens.length > 0 && values.some((value) => titleTokens.every((token) => value.includes(token)))) {
    return true;
  }

  const artistTokens = normalizeEntityTokens(query.artist);
  return artistTokens.length > 0 && values.some((value) => artistTokens.every((token) => value.includes(token)));
}

function looksLikeSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/\/(?:search|arama)\b/i.test(parsed.pathname)) {
      return true;
    }

    return ["q", "query", "term", "entry", "s", "search", "search_words"].some((key) => parsed.searchParams.has(key));
  } catch {
    return false;
  }
}

function discoveredUrlLooksLikeDifferentEntity(url: string, query: RunEntity["query"]): boolean {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  const tokens = pathname
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_DISCOVERED_URL_TOKENS.has(token) && !/^\d+$/.test(token));

  if (tokens.length < 2) {
    return false;
  }

  const queryTokens = [...normalizeEntityTokens(query.artist), ...normalizeEntityTokens(query.title ?? "")];
  if (queryTokens.length === 0) {
    return false;
  }

  return !tokens.some((token) => queryTokens.some((queryToken) => token.includes(queryToken) || queryToken.includes(token)));
}

function discoveredUrlLooksLikeAccessCheckpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const normalizedPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return RENDERED_DISCOVERY_BLOCK_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
  } catch {
    return false;
  }
}

function sourceSurfaceForPageType(sourcePageType: FrontierItem["source_page_type"]): SourceSurface {
  if (sourcePageType === "lot") return "auction_result";
  if (sourcePageType === "artist_page") return "artist_page";
  if (sourcePageType === "price_db") return "price_db";
  if (sourcePageType === "listing") return "auction_catalog";
  return "aggregator";
}

function saleChannelForPriceType(priceType: PriceRecord["price_type"]): SaleChannel {
  if (priceType === "estimate") return "estimate";
  if (priceType === "asking_price") return "asking";
  if (priceType === "hammer_price" || priceType === "realized_price") return "hammer";
  if (priceType === "realized_with_buyers_premium") return "bp_inclusive";
  if (priceType === "inquiry_only") return "private_sale_poa";
  return "unknown";
}

function priceVisibilityForStatus(sourceAccessStatus: SourceAccessStatus, priceHidden = false): PriceVisibility {
  if (priceHidden || sourceAccessStatus === "price_hidden") {
    return "hidden";
  }
  if (sourceAccessStatus === "public_access" || sourceAccessStatus === "licensed_access") {
    return "visible";
  }
  return "unknown";
}

function annotateAttemptLaneAndSurface(
  attempt: SourceAttempt,
  sourcePageType: FrontierItem["source_page_type"],
  lane: CrawlLane
): void {
  attempt.crawl_lane = lane;
  attempt.source_surface = sourceSurfaceForPageType(sourcePageType);
  const extracted = attempt.extracted_fields as { price_type?: PriceRecord["price_type"] } | undefined;
  attempt.sale_channel = saleChannelForPriceType(extracted?.price_type ?? "unknown");
  attempt.price_visibility = priceVisibilityForStatus(attempt.source_access_status);
}

function annotateRecordLaneAndSurface(
  record: PriceRecord,
  sourcePageType: FrontierItem["source_page_type"],
  lane: CrawlLane
): void {
  record.crawl_lane = lane;
  record.source_surface = sourceSurfaceForPageType(sourcePageType);
  record.sale_channel = saleChannelForPriceType(record.price_type);
  record.price_visibility = record.price_hidden ? "hidden" : "visible";
}

function shouldTriggerCrawleeForAttempt(attempt: SourceAttempt, sourcePageType: FrontierItem["source_page_type"]): boolean {
  if (attempt.source_access_status === "blocked" || attempt.source_access_status === "auth_required") {
    return false;
  }
  if (
    attempt.acceptance_reason === "generic_shell_page"
    || attempt.acceptance_reason === "missing_numeric_price"
    || attempt.acceptance_reason === "missing_currency"
    || attempt.acceptance_reason === "missing_estimate_range"
    || attempt.acceptance_reason === "unknown_price_type"
  ) {
    return true;
  }
  return attempt.acceptance_reason === "entity_mismatch" && sourcePageType !== "lot";
}

function isDataInsufficientAcceptanceReason(reason: SourceAttempt["acceptance_reason"]): boolean {
  return (
    reason === "generic_shell_page"
    || reason === "missing_numeric_price"
    || reason === "missing_currency"
    || reason === "missing_estimate_range"
    || reason === "unknown_price_type"
  );
}

function shouldTriggerCrawleeForTransport(
  kind: TransportErrorKind | undefined,
  accessStatus: SourceAccessStatus
): boolean {
  if (!kind) return false;
  if (accessStatus === "blocked" || accessStatus === "auth_required") return false;
  if (kind === TransportErrorKind.AUTH_INVALID || kind === TransportErrorKind.LEGAL_BLOCK) return false;
  return (
    kind === TransportErrorKind.DNS_FAILED
    || kind === TransportErrorKind.TCP_TIMEOUT
    || kind === TransportErrorKind.TCP_REFUSED
    || kind === TransportErrorKind.TLS_FAILED
    || kind === TransportErrorKind.RATE_LIMITED
    || kind === TransportErrorKind.WAF_BLOCK
    || kind === TransportErrorKind.UNKNOWN_NETWORK
    || kind === TransportErrorKind.HTTP_ERROR
  );
}

function semanticLaneForPriceType(priceType: PriceType): InventoryRecord["semantic_lane"] {
  if (priceType === "asking_price") return "asking";
  if (priceType === "estimate") return "estimate";
  if (priceType === "hammer_price" || priceType === "realized_price" || priceType === "realized_with_buyers_premium") {
    return "realized";
  }
  if (priceType === "inquiry_only") return "inquiry";
  return "unknown";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numericStats(values: number[]): { count: number; min: number | null; avg: number | null; max: number | null } {
  if (values.length === 0) {
    return { count: 0, min: null, avg: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    avg: average(sorted),
    max: sorted[sorted.length - 1] ?? null
  };
}

function isDiscoveryBackedRecord(record: Pick<PriceRecord, "notes">): boolean {
  return record.notes.some((note) => note.startsWith("discovery:") && note !== "discovery:seed");
}

function buildRecordKey(record: PriceRecord, canonicalUrl: string): string {
  return createHash("sha1")
    .update(
      [
        normalizeText(record.artist_name),
        normalizeText(record.work_title),
        record.source_name,
        canonicalUrl,
        record.lot_number ?? "",
        record.sale_or_listing_date ?? "",
        record.price_type,
        record.price_amount ?? "",
        record.currency ?? ""
      ].join("|")
    )
    .digest("hex");
}

function canonicalClusterAttribute(value: string | null | undefined, fallback: string): string {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : fallback;
}

function buildCanonicalClusterId(input: {
  artistKey: string;
  title: string | null | undefined;
  year: string | null | undefined;
  medium: string | null | undefined;
}): string {
  const key = [
    input.artistKey,
    canonicalClusterAttribute(input.title, "untitled"),
    canonicalClusterAttribute(input.year, "unknown_year"),
    canonicalClusterAttribute(input.medium, "unknown_medium")
  ].join("|");
  return `cluster-${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}

function titleSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0.45;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function mediumCompatible(left: PriceRecord, right: PriceRecord): boolean {
  const a = normalizeText(left.medium);
  const b = normalizeText(right.medium);
  return !a || !b || a === b;
}

function yearCompatible(left: PriceRecord, right: PriceRecord): boolean {
  if (!left.year || !right.year) return true;
  return left.year === right.year;
}

function dimensionsCompatible(left: PriceRecord, right: PriceRecord): boolean {
  const dimensions = (record: PriceRecord): [number | null, number | null] => {
    if (record.height_cm && record.width_cm) {
      return [record.height_cm, record.width_cm];
    }
    const match = record.dimensions_text?.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (!match) return [null, null];
    return [Number(match[1].replace(",", ".")), Number(match[2].replace(",", "."))];
  };

  const [leftH, leftW] = dimensions(left);
  const [rightH, rightW] = dimensions(right);
  if (!leftH || !leftW || !rightH || !rightW) return true;
  const tolerance = 0.08;
  return (
    Math.abs(leftH - rightH) / Math.max(leftH, rightH) <= tolerance &&
    Math.abs(leftW - rightW) / Math.max(leftW, rightW) <= tolerance
  );
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftMagnitude += l * l;
    rightMagnitude += r * r;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function priceValueForStats(record: InventoryRecord): number | null {
  const value = record.payload.normalized_price_try ?? record.payload.price_amount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickExtension(contentType: string | null, imageUrl: string): string {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("bmp")) return ".bmp";
  const pathname = (() => {
    try {
      return new URL(imageUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const known = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];
  return known.find((extension) => pathname.endsWith(extension)) ?? ".jpg";
}

async function computeImageFeatures(buffer: Buffer): Promise<{
  perceptualHash: string | null;
  embeddingVector: number[] | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const image = await Jimp.read(buffer);
    const normalized = image.clone().resize({ w: 8, h: 8 }).greyscale();
    const vector: number[] = [];
    for (let index = 0; index < normalized.bitmap.data.length; index += 4) {
      const red = normalized.bitmap.data[index] ?? 0;
      vector.push(Number((red / 255).toFixed(6)));
    }

    return {
      perceptualHash: image.hash(),
      embeddingVector: vector,
      width: image.bitmap.width,
      height: image.bitmap.height
    };
  } catch {
    return {
      perceptualHash: null,
      embeddingVector: null,
      width: null,
      height: null
    };
  }
}

export class ArtistMarketInventoryOrchestrator {
  constructor(
    private readonly storage: ArtbotStorage,
    private readonly registry: SourceRegistry,
    private readonly authManager: AuthManager,
    private readonly browserClient: BrowserClient,
    private readonly fxRates: FxRateProvider
  ) {}

  public async processRun(run: RunEntity): Promise<void> {
    const traceId = `market_${run.id.slice(0, 8)}`;
    const runRoot = this.storage.getRunRoot(run.id);
    const evidenceDir = path.join(runRoot, "evidence");
    const exportsDir = path.join(runRoot, "exports");
    const artistKey = artistKeyFromName(run.query.artist);
    const crawlMode = crawlModeSchema.parse(run.query.crawlMode ?? "backfill");
    const localAiConfig = buildLocalAiRelevanceConfigFromEnv();

    logger.info("Starting artist market inventory run", {
      traceId,
      runId: run.id,
      artist: run.query.artist,
      crawlMode
    });

    const targetFeatures = await this.loadTargetImageFeatures(run.query.imagePath);
    const planning = await this.planInventorySources(run);
    const plannedSources = planning.plannedSources;
    const sourcePlan = buildSourcePlanItems(
      plannedSources,
      buildDiscoveryConfigFromEnv(run.query.analysisMode).maxCandidatesPerSource,
      run.query.analysisMode
    );
    const selectedSourceIds = new Set(
      sourcePlan.filter((item) => item.selection_state === "selected").map((item) => item.adapter_id)
    );
    const sourceRuntime = new Map<string, SourceRuntimeStats>();
    const sourceContexts = new Map<string, {
      planned: PlannedSource;
      host: string;
      sourceFamily: string;
      sourceFamilyBucket: SourceFamilyBucket;
    }>();
    const gaps: string[] = [];
    let discoveredHosts = 0;
    const crawleeFallbackEnabled = toBoolean(process.env.CRAWLEE_FALLBACK_ENABLED, true);
    const crawleeMaxPagesPerCandidate = toPositiveInt(process.env.CRAWLEE_MAX_PAGES_PER_CANDIDATE, 4);
    const crawleeMaxDiscoveredLinks = toPositiveInt(process.env.CRAWLEE_MAX_DISCOVERED_LINKS, 150);
    const crawleeTimeoutMs = toPositiveInt(process.env.CRAWLEE_TIMEOUT_MS, 45_000);
    const frontierTaskTimeoutMs = toPositiveInt(
      process.env.INVENTORY_CANDIDATE_TIMEOUT_MS,
      Math.max(60_000, crawleeTimeoutMs + 15_000)
    );
    const renderedDiscoveryTimeoutMs = toPositiveInt(
      process.env.INVENTORY_RENDERED_DISCOVERY_TIMEOUT_MS,
      Math.max(crawleeTimeoutMs + 15_000, 60_000)
    );
    const fairnessConfig = buildFairnessConfig(run.query.analysisMode ?? "balanced");
    const fairnessStats = createRuntimeFairnessStats();
    const fairnessSelectionWindow = toPositiveInt(process.env.INVENTORY_FRONTIER_SELECTION_WINDOW, 120);

    for (const planned of plannedSources.filter((entry) => selectedSourceIds.has(entry.adapter.id))) {
      const seedHost = hostFromUrl(planned.candidates[0]?.url ?? "");
      if (!seedHost) {
        continue;
      }

      const checkpoint = this.storage.getCrawlCheckpoint(artistKey, seedHost, "default");
      if (
        crawlMode === "refresh" &&
        checkpoint &&
        checkpoint.consecutive_unchanged_windows >= 2 &&
        this.wasRecentlyCrawled(checkpoint.last_seen_at)
      ) {
        gaps.push(`${planned.adapter.sourceName}: skipped refresh seed due to stable checkpoint.`);
        continue;
      }

      this.storage.upsertSourceHost(this.toSourceHost(planned, seedHost));
      if (!sourceRuntime.has(seedHost)) {
        discoveredHosts += 1;
        sourceRuntime.set(seedHost, {
          sourceName: planned.adapter.sourceName,
          host: seedHost,
          seedUrl: planned.candidates[0]?.url ?? null,
          discoveredCount: 0,
          newRecords: 0
        });
      }
      sourceContexts.set(planned.adapter.id, {
        planned,
        host: seedHost,
        sourceFamily: planned.adapter.capabilities.source_family,
        sourceFamilyBucket: inferSourceFamilyBucket({
          sourceFamily: planned.adapter.capabilities.source_family,
          sourceName: planned.adapter.sourceName,
          hosts: [seedHost]
        })
      });

      for (const candidate of planned.candidates) {
        this.enqueueCandidate(run, artistKey, planned, seedHost, candidate);
      }
    }

    const attempts: SourceAttempt[] = [];
    const currentRunRecords: PriceRecord[] = [];

    while (true) {
      const pendingFrontier = this.storage.listPendingFrontier(
        run.id,
        fairnessConfig.enabled ? fairnessSelectionWindow : 1
      );
      const frontierSelection = pendingFrontier
        .map((item) => {
          const sourceContext = sourceContexts.get(item.adapter_id);
          if (!sourceContext) {
            return null;
          }
          const sourceFamilyBucket = item.source_family_bucket
            ?? sourceContext.sourceFamilyBucket
            ?? inferSourceFamilyBucket({
              sourceFamily: item.source_family ?? sourceContext.sourceFamily,
              sourceName: item.source_name,
              hosts: [item.source_host]
            });
          const score = scoreFrontierItem(
            {
              sourceFamilyBucket,
              sourceHost: item.source_host,
              sourcePageType: item.source_page_type,
              provenance: item.provenance,
              baseScore: item.score,
              isPreverifiedLot: item.source_page_type === "lot" && item.provenance === "direct_lot"
            },
            fairnessStats,
            fairnessConfig
          );
          return {
            item,
            sourceContext,
            sourceFamilyBucket,
            score
          };
        })
        .filter((entry): entry is {
          item: FrontierItem;
          sourceContext: {
            planned: PlannedSource;
            host: string;
            sourceFamily: string;
            sourceFamilyBucket: SourceFamilyBucket;
          };
          sourceFamilyBucket: SourceFamilyBucket;
          score: number;
        } => Boolean(entry))
        .sort((left, right) => right.score - left.score)[0];
      const frontier = frontierSelection?.item ?? null;
      if (!frontier) {
        break;
      }

      this.storage.markFrontierProcessing(frontier.id);
      const sourceContext = frontierSelection?.sourceContext ?? sourceContexts.get(frontier.adapter_id);
      if (!sourceContext) {
        this.storage.markFrontierSkipped(frontier.id, `Missing adapter context for ${frontier.adapter_id}`);
        gaps.push(`Skipped ${frontier.url} because adapter context was unavailable.`);
        continue;
      }
      const frontierFamilyBucket = frontierSelection?.sourceFamilyBucket
        ?? sourceContext.sourceFamilyBucket
        ?? inferSourceFamilyBucket({
          sourceFamily: frontier.source_family ?? sourceContext.sourceFamily,
          sourceName: frontier.source_name,
          hosts: [frontier.source_host]
        });

      const candidate: SourceCandidate = {
        url: frontier.url,
        sourcePageType: frontier.source_page_type,
        provenance: frontier.provenance,
        score: frontier.score,
        discoveredFromUrl: frontier.discovered_from_url
      };

      try {
        const result = await withTimeout(
          sourceContext.planned.adapter.extract(candidate, {
            runId: run.id,
            traceId,
            query: run.query,
            accessContext: sourceContext.planned.accessContext,
            evidenceDir
          }),
          frontierTaskTimeoutMs,
          frontier.url
        );
        annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "cheap_fetch");
        if (result.record) {
          annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "cheap_fetch");
        }
        let bestLaneOutcome: LaneOutcome | null = captureLaneOutcome(
          result.attempt.crawl_lane ?? "cheap_fetch",
          result.attempt,
          result.record
        );

        let renderedArtifacts = null;
        if (
          crawleeFallbackEnabled &&
          (
            sourceContext.planned.adapter.crawlStrategies.includes("rendered_dom") ||
            frontier.source_page_type !== "lot" ||
            result.needsBrowserVerification ||
            shouldTriggerCrawleeForAttempt(result.attempt, frontier.source_page_type)
          )
        ) {
          renderedArtifacts = await withTimeout(
            this.browserClient.discoverRenderedArtifacts({
              traceId,
              sourceName: sourceContext.planned.adapter.sourceName,
              url: frontier.url,
              runId: run.id,
              evidenceDir,
              accessContext: sourceContext.planned.accessContext,
              timeoutMs: crawleeTimeoutMs,
              maxLinks: crawleeMaxDiscoveredLinks,
              maxPages:
                frontier.source_page_type === "listing"
                  ? crawleeMaxPagesPerCandidate
                  : Math.max(2, Math.min(3, crawleeMaxPagesPerCandidate))
            }),
            renderedDiscoveryTimeoutMs,
            frontier.url
          );
        }
        if (renderedArtifacts) {
          annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "crawlee");
          if (result.record) {
            annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "crawlee");
          }
        }

        if (renderedArtifacts?.requiresAuthDetected) {
          result.attempt.source_access_status = "auth_required";
          result.attempt.failure_class = "access_blocked";
          result.attempt.accepted = false;
          result.attempt.accepted_for_evidence = false;
          result.attempt.accepted_for_valuation = false;
          result.attempt.valuation_lane = "none";
          result.attempt.acceptance_reason = "blocked_access";
          result.attempt.rejection_reason = "Authorized session required to access this source.";
          result.attempt.valuation_eligibility_reason = "Authorized session required.";
          result.attempt.blocker_reason = "Authorized session required.";
          annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "crawlee");
          if (result.record) {
            result.record.source_access_status = "auth_required";
            result.record.accepted_for_evidence = false;
            result.record.accepted_for_valuation = false;
            result.record.valuation_lane = "none";
            result.record.acceptance_reason = "blocked_access";
            result.record.rejection_reason = "Authorized session required to access this source.";
            result.record.valuation_eligibility_reason = "Authorized session required.";
            result.record.valuation_confidence = 0;
            result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.35);
            annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "crawlee");
          }
        } else if (renderedArtifacts?.blockedDetected) {
          const preservePriorValuationAcceptance =
            Boolean(result.attempt.accepted_for_valuation)
            && result.attempt.source_access_status !== "blocked"
            && result.attempt.source_access_status !== "auth_required";
          if (preservePriorValuationAcceptance) {
            result.attempt.failure_class = result.attempt.failure_class ?? "waf_challenge";
            result.attempt.blocker_reason = result.attempt.blocker_reason ?? "Browser lane encountered anti-bot challenge.";
            annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "crawlee");
            if (result.record) {
              annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "crawlee");
            }
          } else {
          result.attempt.source_access_status = "blocked";
          result.attempt.failure_class = "waf_challenge";
          result.attempt.accepted = false;
          result.attempt.accepted_for_evidence = false;
          result.attempt.accepted_for_valuation = false;
          result.attempt.valuation_lane = "none";
          result.attempt.acceptance_reason = "blocked_access";
          result.attempt.rejection_reason = "Access blocked or anti-bot page detected.";
          result.attempt.valuation_eligibility_reason = "Technical blocking detected.";
          result.attempt.blocker_reason = "Technical blocking detected.";
          annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "crawlee");
          if (result.record) {
            result.record.source_access_status = "blocked";
            result.record.accepted_for_evidence = false;
            result.record.accepted_for_valuation = false;
            result.record.valuation_lane = "none";
            result.record.acceptance_reason = "blocked_access";
            result.record.rejection_reason = "Access blocked or anti-bot page detected.";
            result.record.valuation_eligibility_reason = "Technical blocking detected.";
            result.record.valuation_confidence = 0;
            result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.2);
            annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "crawlee");
          }
          }
        } else if (renderedArtifacts?.rawSnapshotPaths[0]) {
          const shouldReevaluateRenderedSnapshot =
            Boolean(result.record)
            && (
              isDataInsufficientAcceptanceReason(result.attempt.acceptance_reason)
              || (result.attempt.acceptance_reason === "entity_mismatch" && frontier.source_page_type !== "lot")
            );
          if (shouldReevaluateRenderedSnapshot) {
            try {
              const html = fs.readFileSync(renderedArtifacts.rawSnapshotPaths[0], "utf-8");
              const parsed = parseGenericLotFields(html);
              const recoveredSourceStatus: SourceAccessStatus = parsed.priceHidden
                ? "price_hidden"
                : sourceContext.planned.accessContext.sourceAccessStatus;
              const acceptance = evaluateAcceptance(parsed, recoveredSourceStatus, {
                sourceName: result.attempt.source_name,
                sourcePageType: frontier.source_page_type,
                candidateUrl: frontier.url,
                queryArtist: run.query.artist,
                queryTitle: run.query.title
              });

              result.attempt.source_access_status = recoveredSourceStatus;
              result.attempt.accepted = acceptance.acceptedForEvidence;
              result.attempt.accepted_for_evidence = acceptance.acceptedForEvidence;
              result.attempt.accepted_for_valuation = acceptance.acceptedForValuation;
              result.attempt.valuation_lane = acceptance.valuationLane;
              result.attempt.acceptance_reason = acceptance.acceptanceReason;
              result.attempt.rejection_reason = acceptance.rejectionReason;
              result.attempt.valuation_eligibility_reason = acceptance.valuationEligibilityReason;
              result.attempt.failure_class = undefined;
              result.attempt.blocker_reason = acceptance.rejectionReason;
              result.attempt.extracted_fields = {
                ...result.attempt.extracted_fields,
                lot_number: parsed.lotNumber,
                estimate_low: parsed.estimateLow,
                estimate_high: parsed.estimateHigh,
                price_type: parsed.priceType,
                price_amount: parsed.priceAmount,
                currency: parsed.currency,
                buyers_premium_included: parsed.buyersPremiumIncluded
              };
              annotateAttemptLaneAndSurface(result.attempt, frontier.source_page_type, "crawlee");

              if (result.record) {
                result.record.price_type = parsed.priceType;
                result.record.price_amount = parsed.priceAmount;
                result.record.estimate_low = parsed.estimateLow;
                result.record.estimate_high = parsed.estimateHigh;
                result.record.currency = parsed.currency;
                result.record.buyers_premium_included = parsed.buyersPremiumIncluded;
                result.record.lot_number = parsed.lotNumber ?? result.record.lot_number;
                result.record.sale_or_listing_date = parsed.saleDate ?? result.record.sale_or_listing_date;
                result.record.price_hidden = parsed.priceHidden;
                result.record.raw_snapshot_path = renderedArtifacts.rawSnapshotPaths[0];
                result.record.source_access_status = recoveredSourceStatus;
                result.record.accepted_for_evidence = acceptance.acceptedForEvidence;
                result.record.accepted_for_valuation = acceptance.acceptedForValuation;
                result.record.valuation_lane = acceptance.valuationLane;
                result.record.acceptance_reason = acceptance.acceptanceReason;
                result.record.rejection_reason = acceptance.rejectionReason;
                result.record.valuation_eligibility_reason = acceptance.valuationEligibilityReason;
                result.record.valuation_confidence = acceptance.acceptedForValuation
                  ? Math.max(result.record.valuation_confidence, result.record.overall_confidence, 0.6)
                  : 0;
                annotateRecordLaneAndSurface(result.record, frontier.source_page_type, "crawlee");
              }
            } catch {
              // Best-effort rendered snapshot re-evaluation.
            }
          }
        }

        const postCrawleeMerge = mergeLaneOutcome(
          bestLaneOutcome,
          captureLaneOutcome(result.attempt.crawl_lane ?? "cheap_fetch", result.attempt, result.record)
        );
        applyMergedLaneOutcome(result, postCrawleeMerge.outcome);
        bestLaneOutcome = postCrawleeMerge.outcome;

        const attempt = {
          ...result.attempt,
          screenshot_path: result.attempt.screenshot_path ?? renderedArtifacts?.screenshotPaths[0] ?? null,
          raw_snapshot_path: result.attempt.raw_snapshot_path ?? renderedArtifacts?.rawSnapshotPaths[0] ?? null
        } satisfies SourceAttempt;
        attempts.push(attempt);
        this.storage.saveAttempt(run.id, attempt);
        this.storage.recordSourceAttempt(attempt);
        this.storage.recordHostAttempt(frontier.source_host, attempt);
        applyRuntimeAttemptToFairnessStats(fairnessStats, {
          sourceFamilyBucket: frontierFamilyBucket,
          sourceHost: frontier.source_host,
          acceptedForEvidence: Boolean(attempt.accepted_for_evidence ?? attempt.accepted),
          pricedAcceptance:
            attempt.acceptance_reason === "valuation_ready"
            || attempt.acceptance_reason === "estimate_range_ready"
            || attempt.acceptance_reason === "asking_price_ready",
          sourceAccessStatus: attempt.source_access_status
        });

        if (result.record) {
          let normalized = applyConfidenceModel(await normalizeRecordCurrencies(result.record, this.fxRates));
          if (!normalized.image_url && renderedArtifacts?.discoveredImageUrls[0]) {
            normalized = {
              ...normalized,
              image_url: renderedArtifacts.discoveredImageUrls[0]
            };
          }
          annotateRecordLaneAndSurface(
            normalized,
            frontier.source_page_type,
            renderedArtifacts ? "crawlee" : "cheap_fetch"
          );

          const canonicalUrl = attempt.canonical_url ?? frontier.url;
          const recordKey = buildRecordKey(normalized, canonicalUrl);
          const image = normalized.image_url
            ? await this.captureArtworkImage({
                run,
                runRoot,
                artistKey,
                recordKey,
                sourceUrl: canonicalUrl,
                imageUrl: normalized.image_url
              })
            : null;

          if (image?.image.embedding_vector && targetFeatures?.embeddingVector) {
            normalized = {
              ...normalized,
              visual_match_score: Number(
                cosineSimilarity(image.image.embedding_vector, targetFeatures.embeddingVector).toFixed(4)
              )
            };
          }

          this.storage.saveRecord(run.id, normalized);
          currentRunRecords.push(normalized);
          const saved = this.storage.upsertInventoryRecord({
            run_id: run.id,
            artist_key: artistKey,
            record_key: recordKey,
            source_host: frontier.source_host,
            semantic_lane: semanticLaneForPriceType(normalized.price_type),
            cluster_id: null,
            payload: normalized
          });

          if (image) {
            this.storage.upsertArtworkImage({
              run_id: run.id,
              artist_key: artistKey,
              record_key: recordKey,
              source_url: canonicalUrl,
              image_url: image.image.image_url,
              stored_path: image.image.stored_path,
              sha256: image.image.sha256,
              perceptual_hash: image.image.perceptual_hash,
              embedding_vector: image.image.embedding_vector,
              width: image.image.width,
              height: image.image.height,
              mime_type: image.image.mime_type,
              bytes: image.image.bytes
            });
          }

          if (saved.inserted) {
            sourceRuntime.get(frontier.source_host)!.newRecords += 1;
          }
        }

        const adapterDiscoveredCandidates = (result.discoveredCandidates ?? [])
          .map((candidate) =>
            this.toDiscoveredCandidate(candidate.url, candidate.discoveredFromUrl ?? frontier.url, run.query)
          )
          .filter((item): item is SourceCandidate => Boolean(item));

        const renderedCandidates = (renderedArtifacts?.discoveredUrls ?? [])
          .map((url) => this.toDiscoveredCandidate(url, frontier.url, run.query))
          .filter((item): item is SourceCandidate => Boolean(item));

        for (const discoveredCandidate of [...adapterDiscoveredCandidates, ...renderedCandidates]) {
          const host = hostFromUrl(discoveredCandidate.url);
          if (!host) continue;
          const hostRecord = this.storage.getSourceHost(host) ?? this.storage.upsertSourceHost(this.toSourceHost(sourceContext.planned, host, "discovered"));
          if (!sourceContexts.has(sourceContext.planned.adapter.id) || sourceContext.host === frontier.source_host) {
            sourceContexts.set(sourceContext.planned.adapter.id, sourceContext);
          }
          if (!sourceRuntime.has(host)) {
            discoveredHosts += 1;
            sourceRuntime.set(host, {
              sourceName: hostRecord.source_name,
              host,
              seedUrl: discoveredCandidate.discoveredFromUrl ?? discoveredCandidate.url,
              discoveredCount: 0,
              newRecords: 0
            });
          }
          sourceRuntime.get(host)!.discoveredCount += 1;
          this.enqueueCandidate(run, artistKey, sourceContext.planned, host, discoveredCandidate);
        }

        this.storage.markFrontierCompleted(frontier.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transportKind = isTransportError(error)
          ? error.kind
          : error instanceof CandidateTimeoutError
            ? TransportErrorKind.TCP_TIMEOUT
            : undefined;
        const failedAttempt = this.buildFailureAttempt(
          run,
          frontier,
          sourceContext.sourceFamily,
          sourceContext.planned.accessContext.sourceAccessStatus,
          message,
          transportKind
        );
        let recoveredViaCrawlee = false;

        if (
          crawleeFallbackEnabled
          && shouldTriggerCrawleeForTransport(transportKind, sourceContext.planned.accessContext.sourceAccessStatus)
        ) {
          try {
            const renderedArtifacts = await withTimeout(
              this.browserClient.discoverRenderedArtifacts({
                traceId,
                sourceName: sourceContext.planned.adapter.sourceName,
                url: frontier.url,
                runId: run.id,
                evidenceDir,
                accessContext: sourceContext.planned.accessContext,
                timeoutMs: crawleeTimeoutMs,
                maxLinks: crawleeMaxDiscoveredLinks,
                maxPages:
                  frontier.source_page_type === "listing"
                    ? crawleeMaxPagesPerCandidate
                    : Math.max(2, Math.min(3, crawleeMaxPagesPerCandidate))
              }),
              renderedDiscoveryTimeoutMs,
              frontier.url
            );
            failedAttempt.screenshot_path = renderedArtifacts.screenshotPaths[0] ?? null;
            failedAttempt.raw_snapshot_path = renderedArtifacts.rawSnapshotPaths[0] ?? null;
            failedAttempt.canonical_url = renderedArtifacts.finalUrl;
            failedAttempt.parser_used = "crawlee-recovery";
            failedAttempt.extracted_fields = {
              ...failedAttempt.extracted_fields,
              recovery_trigger: transportKind ? `transport:${transportKind}` : "transport:unknown"
            };
            annotateAttemptLaneAndSurface(failedAttempt, frontier.source_page_type, "crawlee");

            if (failedAttempt.raw_snapshot_path) {
              try {
                const html = fs.readFileSync(failedAttempt.raw_snapshot_path, "utf-8");
                const parsed = parseGenericLotFields(html);
                const recoveredSourceStatus: SourceAccessStatus = parsed.priceHidden
                  ? "price_hidden"
                  : sourceContext.planned.accessContext.sourceAccessStatus;
                const acceptance = evaluateAcceptance(parsed, recoveredSourceStatus, {
                  sourceName: failedAttempt.source_name,
                  sourcePageType: frontier.source_page_type,
                  candidateUrl: frontier.url,
                  queryArtist: run.query.artist,
                  queryTitle: run.query.title
                });
                failedAttempt.source_access_status = recoveredSourceStatus;
                failedAttempt.accepted = acceptance.acceptedForEvidence;
                failedAttempt.accepted_for_evidence = acceptance.acceptedForEvidence;
                failedAttempt.accepted_for_valuation = acceptance.acceptedForValuation;
                failedAttempt.valuation_lane = acceptance.valuationLane;
                failedAttempt.acceptance_reason = acceptance.acceptanceReason;
                failedAttempt.rejection_reason = acceptance.rejectionReason;
                failedAttempt.valuation_eligibility_reason = acceptance.valuationEligibilityReason;
                failedAttempt.failure_class = undefined;
                failedAttempt.extracted_fields = {
                  ...failedAttempt.extracted_fields,
                  lot_number: parsed.lotNumber,
                  estimate_low: parsed.estimateLow,
                  estimate_high: parsed.estimateHigh,
                  price_type: parsed.priceType,
                  price_amount: parsed.priceAmount,
                  currency: parsed.currency,
                  buyers_premium_included: parsed.buyersPremiumIncluded
                };
                failedAttempt.sale_channel = saleChannelForPriceType(parsed.priceType);
                failedAttempt.price_visibility = priceVisibilityForStatus(recoveredSourceStatus, parsed.priceHidden);
              } catch {
                // Best-effort parse on crawlee fallback.
              }
            }

            const renderedCandidates = (renderedArtifacts.discoveredUrls ?? [])
              .map((url) => this.toDiscoveredCandidate(url, frontier.url, run.query))
              .filter((item): item is SourceCandidate => Boolean(item));
            for (const discoveredCandidate of renderedCandidates) {
              const host = hostFromUrl(discoveredCandidate.url);
              if (!host) continue;
              this.enqueueCandidate(run, artistKey, sourceContext.planned, host, discoveredCandidate);
            }
            recoveredViaCrawlee = renderedCandidates.length > 0 || Boolean(failedAttempt.raw_snapshot_path);
          } catch {
            recoveredViaCrawlee = false;
          }
        }

        attempts.push(failedAttempt);
        this.storage.saveAttempt(run.id, failedAttempt);
        this.storage.recordSourceAttempt(failedAttempt);
        this.storage.recordHostAttempt(frontier.source_host, failedAttempt);
        applyRuntimeAttemptToFairnessStats(fairnessStats, {
          sourceFamilyBucket: frontierFamilyBucket,
          sourceHost: frontier.source_host,
          acceptedForEvidence: Boolean(failedAttempt.accepted_for_evidence ?? failedAttempt.accepted),
          pricedAcceptance:
            failedAttempt.acceptance_reason === "valuation_ready"
            || failedAttempt.acceptance_reason === "estimate_range_ready"
            || failedAttempt.acceptance_reason === "asking_price_ready",
          sourceAccessStatus: failedAttempt.source_access_status
        });
        if (recoveredViaCrawlee) {
          this.storage.markFrontierCompleted(frontier.id);
        } else {
          this.storage.markFrontierFailed(frontier.id, message);
          gaps.push(`${sourceContext.planned.adapter.sourceName}: ${message}`);
        }
      }
    }

    this.persistCheckpoints(run, artistKey, sourceRuntime, crawlMode);

    const clustered = await this.buildClusters(run, targetFeatures, localAiConfig);
    const inventorySummary = this.buildInventorySummary(
      run,
      artistKey,
      clustered.inventory,
      this.storage.listArtworkImagesByArtist(artistKey),
      discoveredHosts,
      clustered.clusters,
      clustered.reviewItems,
      gaps,
      sourceRuntime
    );
    const persistedHostHealth = this.storage.listHostHealth(12);
    const persistedSourceMetrics = this.storage.listSourceHealth(12);
    const recentCanaries = this.storage.listCanaryResults(8);
    const summary = this.buildRunSummary(
      run,
      attempts,
      currentRunRecords,
      clustered,
      inventorySummary,
      sourcePlan,
      persistedHostHealth,
      persistedSourceMetrics,
      planning.discoveryDiagnostics,
      recentCanaries,
      buildLocalAiAnalysisSummary(clustered.localAiDecisions)
    );
    const evaluationMetrics = summary.evaluation_metrics;
    const recommendedActions = buildRecommendedActions({
      sourcePlan,
      attempts,
      acceptedRecords: summary.accepted_records,
      discoveredCandidates: summary.discovered_candidates,
      discoveryDiagnostics: planning.discoveryDiagnostics,
      hostHealth: persistedHostHealth,
      evaluationMetrics
    });

    this.storage.replaceClustersForArtist(artistKey, clustered.clusters, clustered.memberships, clustered.reviewItems);
    for (const record of clustered.inventory) {
      this.storage.upsertInventoryRecord(record);
    }

    const inventoryPath = path.join(runRoot, "inventory.json");
    const clustersPath = path.join(runRoot, "clusters.json");
    const reviewQueuePath = path.join(runRoot, "review-queue.json");
    const resultsPath = path.join(runRoot, "results.json");
    const reportPath = path.join(runRoot, "report.md");
    const inventoryCsvPath = path.join(exportsDir, "inventory.csv");
    const clustersCsvPath = path.join(exportsDir, "clusters.csv");
    const reviewCsvPath = path.join(exportsDir, "review-queue.csv");
    const sourceHosts = this.storage
      .listSourceHosts()
      .filter((sourceHost) => sourceRuntime.has(sourceHost.host));
    const checkpoints = this.storage.listCrawlCheckpointsForArtist(artistKey);

    writeJsonFile(inventoryPath, clustered.inventory);
    writeJsonFile(clustersPath, {
      clusters: clustered.clusters,
      memberships: clustered.memberships
    });
    writeJsonFile(reviewQueuePath, clustered.reviewItems);
    fs.writeFileSync(
      reportPath,
      renderArtistMarketInventoryReport({
        artist: run.query.artist,
        summary: inventorySummary,
        inventory: clustered.inventory,
        clusters: clustered.clusters,
        memberships: clustered.memberships,
        reviewItems: clustered.reviewItems
      }),
      "utf-8"
    );
    fs.writeFileSync(inventoryCsvPath, renderInventoryCsv(clustered.inventory), "utf-8");
    fs.writeFileSync(clustersCsvPath, renderClustersCsv(clustered.clusters), "utf-8");
    fs.writeFileSync(reviewCsvPath, renderReviewQueueCsv(clustered.reviewItems), "utf-8");

    writeJsonFile(resultsPath, {
      run,
      summary,
      local_ai_decisions: clustered.localAiDecisions,
      source_plan: sourcePlan,
      recommended_actions: recommendedActions,
      persisted_source_health: persistedHostHealth,
      inventory_summary: inventorySummary,
      inventory: clustered.inventory,
      clusters: clustered.clusters,
      cluster_memberships: clustered.memberships,
      review_queue: clustered.reviewItems,
      source_hosts: sourceHosts,
      checkpoints,
      artifacts: {
        report_path: reportPath,
        inventory_path: inventoryPath,
        clusters_path: clustersPath,
        review_queue_path: reviewQueuePath,
        inventory_csv_path: inventoryCsvPath,
        clusters_csv_path: clustersCsvPath,
        review_queue_csv_path: reviewCsvPath
      }
    });

    const artifactManifest = buildRunArtifactManifest({
      runId: run.id,
      runRoot,
      reportPath,
      resultsPath,
      attempts,
      extraPaths: [inventoryPath, clustersPath, reviewQueuePath, inventoryCsvPath, clustersCsvPath, reviewCsvPath],
      policy: buildDefaultGcPolicyFromEnv()
    });
    writeArtifactManifest(runRoot, artifactManifest);

    this.storage.completeRun(run.id, reportPath, resultsPath);
  }

  private async planInventorySources(run: RunEntity): Promise<SourcePlanningResult> {
    const allowedClasses = new Set(run.query.sourceClasses ?? ["auction_house", "gallery", "dealer", "marketplace", "database"]);
    const adapters = this.registry.list().filter((adapter) => allowedClasses.has(adapter.venueType));
    return planSourcesWithDiagnostics(run.query, adapters, this.authManager, this.storage.listHostHealth(50));
  }

  private toSourceHost(planned: PlannedSource, host: string, mode: SourceHost["host_status"] = "seeded"): Omit<SourceHost, "id" | "created_at" | "updated_at"> {
    const accessMode: SourceHost["auth_mode"] =
      planned.adapter.requiresLicense ? "licensed" : planned.adapter.requiresAuth ? "authorized" : "public";
    const now = new Date().toISOString();
    return {
      host,
      source_name: planned.adapter.sourceName,
      venue_name: planned.adapter.venueName,
      source_class: planned.adapter.venueType,
      host_status: mode,
      trust_tier: planned.adapter.tier <= 2 ? "formal" : "validated",
      auth_mode: accessMode,
      crawl_strategies: planned.adapter.crawlStrategies,
      base_url: `https://${host}`,
      country: planned.adapter.country,
      last_crawled_at: null,
      last_success_at: null
    };
  }

  private enqueueCandidate(
    run: RunEntity,
    artistKey: string,
    planned: PlannedSource,
    sourceHost: string,
    candidate: SourceCandidate
  ): void {
    const sourceFamily = planned.adapter.capabilities.source_family;
    this.storage.enqueueFrontierItem({
      run_id: run.id,
      artist_key: artistKey,
      source_host: sourceHost,
      adapter_id: planned.adapter.id,
      source_name: planned.adapter.sourceName,
      source_family: sourceFamily,
      source_family_bucket: inferSourceFamilyBucket({
        sourceFamily,
        sourceName: planned.adapter.sourceName,
        hosts: [sourceHost]
      }),
      url: candidate.url,
      source_page_type: candidate.sourcePageType,
      provenance: candidate.provenance,
      score: candidate.score,
      discovered_from_url: candidate.discoveredFromUrl ?? null
    });
  }

  private toDiscoveredCandidate(
    url: string,
    discoveredFromUrl: string,
    query: RunEntity["query"]
  ): SourceCandidate | null {
    const normalizedUrl = normalizeCandidateUrl(url);
    if (!normalizedUrl) {
      return null;
    }

    let candidateParsed: URL;
    let discoveredFromParsed: URL;
    try {
      candidateParsed = new URL(normalizedUrl);
      discoveredFromParsed = new URL(discoveredFromUrl);
    } catch {
      return null;
    }

    const candidateHost = normalizeDiscoveryHost(candidateParsed.hostname);
    const discoveredFromHost = normalizeDiscoveryHost(discoveredFromParsed.hostname);
    if (candidateHost !== discoveredFromHost) {
      return null;
    }

    if (
      RENDERED_DISCOVERY_BLOCK_HOSTS.some(
        (blockedHost) => candidateHost === blockedHost || candidateHost.endsWith(`.${blockedHost}`)
      )
    ) {
      return null;
    }

    if (discoveredUrlLooksLikeAccessCheckpoint(normalizedUrl)) {
      return null;
    }

    const sourcePageType = inferSourcePageType(normalizedUrl);
    const entityReferenced =
      urlReferencesQueryEntity(normalizedUrl, query) || searchParamsReferenceQueryEntity(normalizedUrl, query);
    const discoveredFromReferencesQuery =
      urlReferencesQueryEntity(discoveredFromUrl, query) || searchParamsReferenceQueryEntity(discoveredFromUrl, query);

    if (looksLikeSearchUrl(normalizedUrl) && !entityReferenced) {
      return null;
    }

    if (sourcePageType === "other" && !entityReferenced) {
      return null;
    }

    if (sourcePageType === "lot" && !entityReferenced && discoveredFromReferencesQuery) {
      return {
        url: normalizedUrl,
        sourcePageType,
        provenance: "listing_expansion",
        score: 0.86,
        discoveredFromUrl
      };
    }

    if (sourcePageType === "lot" && !entityReferenced && discoveredUrlLooksLikeDifferentEntity(normalizedUrl, query)) {
      return null;
    }

    const score =
      sourcePageType === "artist_page" && entityReferenced
        ? 0.98
        : sourcePageType === "lot" && entityReferenced
          ? 0.94
          : 0.72;

    return {
      url: normalizedUrl,
      sourcePageType,
      provenance: "listing_expansion",
      score,
      discoveredFromUrl
    };
  }

  private buildFailureAttempt(
    run: RunEntity,
    frontier: FrontierItem,
    sourceFamily: string,
    sourceAccessStatus: SourceAccessStatus,
    error: string,
    transportKind?: TransportErrorKind
  ): SourceAttempt {
    return {
      run_id: run.id,
      source_name: frontier.source_name,
      source_family: sourceFamily,
      source_url: frontier.url,
      canonical_url: frontier.url,
      access_mode: "anonymous",
      source_access_status: sourceAccessStatus,
      source_surface: sourceSurfaceForPageType(frontier.source_page_type),
      crawl_lane: "cheap_fetch",
      sale_channel: "unknown",
      price_visibility: priceVisibilityForStatus(sourceAccessStatus),
      failure_class: "transport_other",
      access_reason: error,
      blocker_reason: error,
      transport_kind: transportKind ?? null,
      transport_provider: null,
      transport_host: frontier.source_host,
      transport_status_code: null,
      transport_retryable: false,
      extracted_fields: {},
      discovery_provenance: frontier.provenance,
      discovery_score: frontier.score,
      discovered_from_url: frontier.discovered_from_url,
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: null,
      trace_path: null,
      har_path: null,
      fetched_at: new Date().toISOString(),
      parser_used: "none",
      model_used: null,
      extraction_confidence: 0,
      entity_match_confidence: 0,
      source_reliability_confidence: 0,
      confidence_score: 0,
      accepted: false,
      accepted_for_evidence: false,
      accepted_for_valuation: false,
      valuation_lane: "none",
      acceptance_reason: "blocked_access",
      rejection_reason: error,
      valuation_eligibility_reason: error
    };
  }

  private async captureArtworkImage(args: {
    run: RunEntity;
    runRoot: string;
    artistKey: string;
    recordKey: string;
    sourceUrl: string;
    imageUrl: string;
  }): Promise<{ image: Omit<ArtworkImage, "id" | "created_at" | "updated_at"> } | null> {
    try {
      const response = await fetch(args.imageUrl);
      if (!response.ok) {
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const contentType = response.headers.get("content-type");
      const extension = pickExtension(contentType, args.imageUrl);
      const storedPath = path.join(args.runRoot, "images", `${args.recordKey}${extension}`);
      fs.writeFileSync(storedPath, buffer);
      const features = await computeImageFeatures(buffer);

      return {
        image: {
          run_id: args.run.id,
          artist_key: args.artistKey,
          record_key: args.recordKey,
          source_url: args.sourceUrl,
          image_url: args.imageUrl,
          stored_path: storedPath,
          sha256,
          perceptual_hash: features.perceptualHash,
          embedding_vector: features.embeddingVector,
          width: features.width,
          height: features.height,
          mime_type: contentType,
          bytes: buffer.length
        }
      };
    } catch {
      return null;
    }
  }

  private async loadTargetImageFeatures(imagePath?: string): Promise<TargetImageFeatures | null> {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return null;
    }
    const buffer = fs.readFileSync(imagePath);
    const features = await computeImageFeatures(buffer);
    return {
      sha256: createHash("sha256").update(buffer).digest("hex"),
      perceptualHash: features.perceptualHash,
      embeddingVector: features.embeddingVector
    };
  }

  private wasRecentlyCrawled(lastSeenAt: string): boolean {
    const deltaMs = Date.now() - new Date(lastSeenAt).getTime();
    return deltaMs < 14 * 24 * 60 * 60 * 1000;
  }

  private persistCheckpoints(
    run: RunEntity,
    artistKey: string,
    sourceRuntime: Map<string, SourceRuntimeStats>,
    crawlMode: "backfill" | "refresh"
  ): void {
    const now = new Date().toISOString();
    for (const runtime of sourceRuntime.values()) {
      const existing = this.storage.getCrawlCheckpoint(artistKey, runtime.host, "default");
      const unchanged = runtime.newRecords === 0 ? (existing?.consecutive_unchanged_windows ?? 0) + 1 : 0;
      const payload: Omit<CrawlCheckpoint, "id" | "updated_at"> = {
        artist_key: artistKey,
        source_host: runtime.host,
        section_key: "default",
        url: runtime.seedUrl ?? `https://${runtime.host}`,
        source_page_type: "listing",
        crawl_mode: crawlMode,
        consecutive_unchanged_windows: unchanged,
        last_discovered_count: runtime.discoveredCount,
        last_record_count: runtime.newRecords,
        last_seen_at: now,
        last_changed_at: runtime.newRecords > 0 ? now : existing?.last_changed_at ?? null
      };
      this.storage.upsertCrawlCheckpoint(payload);
    }
  }

  private async buildClusters(
    run: RunEntity,
    targetFeatures: TargetImageFeatures | null,
    localAiConfig: LocalAiRelevanceConfig
  ): Promise<ClusterBuildResult> {
    const artistKey = artistKeyFromName(run.query.artist);
    const inventory = this.storage.listInventoryRecordsByArtist(artistKey);
    const images = this.storage.listArtworkImagesByArtist(artistKey);
    const existingClustersById = new Map(
      this.storage.listArtworkClustersByArtist(artistKey).map((cluster) => [cluster.id, cluster] as const)
    );
    const existingMembershipByClusterRecord = new Map(
      this.storage
        .listClusterMemberships(artistKey)
        .map((membership) => [`${membership.cluster_id}::${membership.record_key}`, membership] as const)
    );
    const existingReviewByPair = new Map(
      this.storage
        .listReviewItemsByArtist(artistKey)
        .map((item) => [[item.left_record_key, item.right_record_key].sort().join("::"), item] as const)
    );
    const imageByRecord = new Map(images.map((image) => [image.record_key, image]));
    const parent = new Map<string, string>();

    for (const record of inventory) {
      parent.set(record.record_key, record.record_key);
    }

    const find = (key: string): string => {
      const current = parent.get(key);
      if (!current || current === key) return key;
      const resolved = find(current);
      parent.set(key, resolved);
      return resolved;
    };
    const union = (left: string, right: string): void => {
      const a = find(left);
      const b = find(right);
      if (a !== b) {
        parent.set(b, a);
      }
    };

    const reviewItems: ReviewItem[] = [];
    const seenReviewPairs = new Set<string>();
    const localAiDecisions: LocalAiDecisionTrace[] = [];

    for (let leftIndex = 0; leftIndex < inventory.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < inventory.length; rightIndex += 1) {
        const left = inventory[leftIndex]!;
        const right = inventory[rightIndex]!;
        const decision = await this.compareInventoryPair(
          left,
          right,
          imageByRecord.get(left.record_key) ?? null,
          imageByRecord.get(right.record_key) ?? null,
          localAiConfig
        );
        if (decision.trace) {
          localAiDecisions.push(decision.trace);
        }
        if (decision.action === "auto") {
          union(left.record_key, right.record_key);
          continue;
        }

        if (decision.action === "review") {
          const pairKey = [left.record_key, right.record_key].sort().join("::");
          if (!seenReviewPairs.has(pairKey)) {
            seenReviewPairs.add(pairKey);
            const existing = existingReviewByPair.get(pairKey);
            const now = new Date().toISOString();
            reviewItems.push({
              id: existing?.id ?? uuid(),
              run_id: run.id,
              artist_key: artistKey,
              review_type: "cluster_match",
              status: existing?.status ?? "pending",
              left_record_key: left.record_key,
              right_record_key: right.record_key,
              recommended_action: decision.recommendedAction ?? existing?.recommended_action ?? "keep_separate",
              confidence: decision.confidence,
              reasons: decision.reasons,
              created_at: existing?.created_at ?? now,
              updated_at: now
            });
          }
        }
      }
    }

    const grouped = new Map<string, InventoryRecord[]>();
    for (const record of inventory) {
      const root = find(record.record_key);
      const list = grouped.get(root) ?? [];
      list.push(record);
      grouped.set(root, list);
    }

    const clusters: ArtworkCluster[] = [];
    const memberships: ClusterMembership[] = [];
    const updatedInventory: InventoryRecord[] = [];

    for (const members of grouped.values()) {
      const titleValues = members
        .map((record) => record.payload.work_title)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .sort((left, right) => normalizeText(left).localeCompare(normalizeText(right)));
      const yearValues = members
        .map((record) => record.payload.year)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .sort();
      const mediumValues = members
        .map((record) => record.payload.medium)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .sort((left, right) => normalizeText(left).localeCompare(normalizeText(right)));
      const recordCount = members.length;
      const primary = members
        .slice()
        .sort((left, right) => (right.payload.visual_match_score ?? 0) - (left.payload.visual_match_score ?? 0))[0]!;
      const clusterTitle = titleValues[0] ?? primary.payload.work_title ?? "Untitled";
      const clusterYear = yearValues[0] ?? primary.payload.year;
      const clusterMedium = mediumValues[0] ?? primary.payload.medium;
      const clusterId = buildCanonicalClusterId({
        artistKey,
        title: clusterTitle,
        year: clusterYear,
        medium: clusterMedium
      });
      const existingCluster = existingClustersById.get(clusterId);
      const now = new Date().toISOString();
      const autoMatchCount = Math.max(0, recordCount - 1);
      const clusterStatus = autoMatchCount > 0 ? "auto_confirmed" : "confirmed";
      const confidence = Number(
        (average(
          members.map((record) => {
            const image = imageByRecord.get(record.record_key);
            const targetScore =
              targetFeatures && image?.embedding_vector
                ? cosineSimilarity(image.embedding_vector, targetFeatures.embeddingVector)
                : record.payload.visual_match_score ?? record.payload.overall_confidence;
            return targetScore ?? record.payload.overall_confidence;
          })
        ) ?? 0.72).toFixed(4)
      );

      clusters.push({
        id: clusterId,
        run_id: run.id,
        artist_key: artistKey,
        title: clusterTitle,
        year: clusterYear ?? null,
        medium: clusterMedium ?? null,
        cluster_status: clusterStatus,
        confidence,
        record_count: recordCount,
        auto_match_count: autoMatchCount,
        created_at: existingCluster?.created_at ?? now,
        updated_at: now
      });

      for (const member of members) {
        const membershipKey = `${clusterId}::${member.record_key}`;
        const existingMembership = existingMembershipByClusterRecord.get(membershipKey as `${string}::${string}`);
        memberships.push({
          id: existingMembership?.id ?? `membership-${createHash("sha1").update(membershipKey).digest("hex").slice(0, 16)}`,
          run_id: run.id,
          artist_key: artistKey,
          cluster_id: clusterId,
          record_key: member.record_key,
          status: clusterStatus,
          confidence,
          reasons: autoMatchCount > 0 ? ["strict_exact_work_match"] : ["single_record_cluster"],
          created_at: existingMembership?.created_at ?? now,
          updated_at: now
        });
        updatedInventory.push({
          ...member,
          cluster_id: clusterId,
          updated_at: now
        });
      }
    }

    return {
      clusters,
      memberships,
      reviewItems,
      inventory: updatedInventory,
      localAiDecisions
    };
  }

  private async compareInventoryPair(
    left: InventoryRecord,
    right: InventoryRecord,
    leftImage: ArtworkImage | null,
    rightImage: ArtworkImage | null,
    localAiConfig: LocalAiRelevanceConfig
  ): Promise<PairDecision & { trace?: LocalAiDecisionTrace }> {
    const reasons: string[] = [];
    const titleScore = titleSimilarity(left.payload.work_title, right.payload.work_title);
    const mediumOk = mediumCompatible(left.payload, right.payload);
    const yearOk = yearCompatible(left.payload, right.payload);
    const dimensionsOk = dimensionsCompatible(left.payload, right.payload);

    if (!mediumOk) {
      return { action: "none", confidence: 0.02, reasons: ["medium_conflict"] };
    }
    if (!yearOk) {
      return { action: "none", confidence: 0.02, reasons: ["year_conflict"] };
    }
    if (!dimensionsOk) {
      return { action: "none", confidence: 0.02, reasons: ["dimension_conflict"] };
    }

    if (leftImage?.sha256 && rightImage?.sha256 && leftImage.sha256 === rightImage.sha256) {
      reasons.push("identical_image_sha256");
      return {
        action: titleScore >= 0.45 ? "auto" : "review",
        confidence: titleScore >= 0.45 ? 0.99 : 0.78,
        reasons,
        recommendedAction: titleScore >= 0.45 ? undefined : "merge"
      };
    }

    const perceptualMatch =
      leftImage?.perceptual_hash && rightImage?.perceptual_hash && leftImage.perceptual_hash === rightImage.perceptual_hash;
    const vectorSimilarity = cosineSimilarity(leftImage?.embedding_vector ?? null, rightImage?.embedding_vector ?? null);
    if (perceptualMatch) {
      reasons.push("identical_perceptual_hash");
    }
    if (vectorSimilarity > 0.98) {
      reasons.push(`image_similarity:${vectorSimilarity.toFixed(3)}`);
    }
    if (titleScore > 0.8) {
      reasons.push(`title_similarity:${titleScore.toFixed(2)}`);
    }

    const strongImageSignal = perceptualMatch || vectorSimilarity > 0.995;
    if (strongImageSignal && titleScore >= 0.72) {
      return {
        action: "auto",
        confidence: Number(Math.max(0.9, vectorSimilarity).toFixed(4)),
        reasons
      };
    }

    if ((perceptualMatch || vectorSimilarity > 0.98) && titleScore >= 0.45) {
      const adjudication = await this.adjudicateBorderlinePair(left, right, reasons, localAiConfig);
      return {
        action: "review",
        confidence: adjudication?.confidence ?? Number(Math.max(vectorSimilarity, 0.74).toFixed(4)),
        reasons: adjudication?.reasons ?? reasons,
        recommendedAction: adjudication?.recommendedAction,
        trace: adjudication?.trace
      };
    }

    return {
      action: "none",
      confidence: Number(Math.max(titleScore, vectorSimilarity).toFixed(4)),
      reasons: reasons.length > 0 ? reasons : ["insufficient_exact_work_signal"]
    };
  }

  private async adjudicateBorderlinePair(
    left: InventoryRecord,
    right: InventoryRecord,
    reasons: string[],
    localAiConfig: LocalAiRelevanceConfig
  ): Promise<{ confidence: number; reasons: string[]; recommendedAction: ReviewItem["recommended_action"]; trace?: LocalAiDecisionTrace } | null> {
    const trace = await evaluateBorderlinePairWithLocalAi(localAiConfig, {
      left: left.payload as Record<string, unknown>,
      right: right.payload as Record<string, unknown>,
      reasons
    });
    if (!trace) {
      return null;
    }

    return {
      confidence: trace.confidence,
      reasons: trace.reasons.length > 0 ? trace.reasons : reasons,
      recommendedAction: trace.action === "accept_candidate" ? "merge" : "keep_separate",
      trace
    };
  }

  private buildInventorySummary(
    run: RunEntity,
    artistKey: string,
    inventory: InventoryRecord[],
    images: ArtworkImage[],
    discoveredHosts: number,
    clusters: ArtworkCluster[],
    reviewItems: ReviewItem[],
    gaps: string[],
    sourceRuntime: Map<string, SourceRuntimeStats>
  ): ArtistMarketInventorySummary {
    const priceTypeBreakdown: ArtistMarketInventorySummary["price_type_breakdown"] = {
      asking_price: 0,
      estimate: 0,
      hammer_price: 0,
      realized_price: 0,
      realized_with_buyers_premium: 0,
      inquiry_only: 0,
      unknown: 0
    };
    const perSourceRecordCounts: Record<string, number> = {};
    const realizedValues: number[] = [];
    const askingValues: number[] = [];
    const estimateValues: number[] = [];

    for (const record of inventory) {
      priceTypeBreakdown[record.payload.price_type] = (priceTypeBreakdown[record.payload.price_type] ?? 0) + 1;
      perSourceRecordCounts[record.payload.source_name] = (perSourceRecordCounts[record.payload.source_name] ?? 0) + 1;
      const value = priceValueForStats(record);
      if (value === null) continue;
      if (record.semantic_lane === "realized") realizedValues.push(value);
      if (record.semantic_lane === "asking") askingValues.push(value);
      if (record.semantic_lane === "estimate") estimateValues.push(value);
    }

    return artistMarketInventorySummarySchema.parse({
      run_id: run.id,
      artist_key: artistKey,
      crawl_mode: run.query.crawlMode ?? "backfill",
      total_inventory_records: inventory.length,
      new_records_added: [...sourceRuntime.values()].reduce((sum, source) => sum + source.newRecords, 0),
      total_images: images.length,
      discovered_hosts: discoveredHosts,
      total_clusters: clusters.length,
      auto_confirmed_clusters: clusters.filter((cluster) => cluster.cluster_status === "auto_confirmed").length,
      review_queue_count: reviewItems.length,
      crawl_gap_count: gaps.length,
      per_source_record_counts: perSourceRecordCounts,
      price_type_breakdown: priceTypeBreakdown,
      price_stats: {
        realized: numericStats(realizedValues),
        asking: numericStats(askingValues),
        estimate: numericStats(estimateValues)
      },
      crawl_gaps: gaps
    });
  }

  private buildRunSummary(
    run: RunEntity,
    attempts: SourceAttempt[],
    _currentRunRecords: PriceRecord[],
    clustered: ClusterBuildResult,
    inventorySummary: ArtistMarketInventorySummary,
    sourcePlan: import("@artbot/shared-types").SourcePlanItem[],
    persistedSourceHealth: import("@artbot/shared-types").HostHealthRecord[],
    persistedSourceMetrics: SourceHealthRecord[],
    discoveryProviderDiagnostics: DiscoveryProviderDiagnostics[],
    recentCanaries: CanaryResult[],
    localAiAnalysis?: RunSummary["local_ai_analysis"]
  ): RunSummary {
    const inventoryPriceBreakdown = inventorySummary.price_type_breakdown;
    const currentRunInventory = clustered.inventory.filter((record) => record.run_id === run.id);
    const sourceStatusBreakdown: Record<SourceAccessStatus, number> = {
      public_access: 0,
      auth_required: 0,
      licensed_access: 0,
      blocked: 0,
      price_hidden: 0
    };
    const authModeBreakdown: Record<"anonymous" | "authorized" | "licensed", number> = {
      anonymous: 0,
      authorized: 0,
      licensed: 0
    };
    const failureClassBreakdown = Object.fromEntries(failureClassList.map((item) => [item, 0])) as Record<
      (typeof failureClassList)[number],
      number
    >;
    const acceptanceReasonBreakdown = Object.fromEntries(acceptanceReasonList.map((item) => [item, 0])) as Record<
      (typeof acceptanceReasonList)[number],
      number
    >;
    const crawlLaneBreakdown: Record<CrawlLane, number> = {
      deterministic: 0,
      cheap_fetch: 0,
      crawlee: 0,
      browser: 0
    };
    const priceVisibilityBreakdown: Record<PriceVisibility, number> = {
      visible: 0,
      hidden: 0,
      sold_no_price: 0,
      unknown: 0
    };
    const sourceFamilyCoverage: NonNullable<RunSummary["source_family_coverage"]> = {};
    const scrapeRecoveryByTrigger: Record<string, number> = {};
    const scrapeRecoveryByTransportKind: Record<string, number> = {};
    const scrapeRecoveryByAcceptanceReason: Record<string, number> = {};
    let scrapeRecoveryAttempted = 0;
    let scrapeRecoverySucceeded = 0;
    let browserOverwritePreventedCount = 0;
    const confidenceMix: NonNullable<RunSummary["confidence_mix"]> = {
      high: 0,
      medium: 0,
      low: 0
    };
    const freshnessMix: NonNullable<RunSummary["freshness_mix"]> = {
      fresh: 0,
      stale: 0,
      undated: 0
    };
    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
      if (attempt.failure_class) {
        failureClassBreakdown[attempt.failure_class] += 1;
      }
      acceptanceReasonBreakdown[attempt.acceptance_reason] += 1;
      const lane = attempt.crawl_lane ?? "cheap_fetch";
      crawlLaneBreakdown[lane] += 1;
      priceVisibilityBreakdown[attempt.price_visibility ?? "unknown"] += 1;
      if ((attempt.extracted_fields as { browser_overwrite_prevented?: unknown } | undefined)?.browser_overwrite_prevented === true) {
        browserOverwritePreventedCount += 1;
      }
      if (attempt.accepted_for_evidence ?? attempt.accepted) {
        if (attempt.confidence_score >= 0.75) {
          confidenceMix.high += 1;
        } else if (attempt.confidence_score >= 0.45) {
          confidenceMix.medium += 1;
        } else {
          confidenceMix.low += 1;
        }
      }
      const dateCandidate =
        (attempt.extracted_fields as { sale_or_listing_date?: unknown; sale_date?: unknown; listed_date?: unknown } | undefined)
          ?.sale_or_listing_date
        ?? (attempt.extracted_fields as { sale_or_listing_date?: unknown; sale_date?: unknown; listed_date?: unknown } | undefined)
          ?.sale_date
        ?? (attempt.extracted_fields as { sale_or_listing_date?: unknown; sale_date?: unknown; listed_date?: unknown } | undefined)
          ?.listed_date;
      if (typeof dateCandidate === "string") {
        const parsed = Date.parse(dateCandidate);
        if (Number.isFinite(parsed)) {
          const ageMs = Date.now() - parsed;
          const fifteenYearsMs = 15 * 365 * 24 * 60 * 60 * 1000;
          if (ageMs <= fifteenYearsMs) {
            freshnessMix.fresh += 1;
          } else {
            freshnessMix.stale += 1;
          }
        } else {
          freshnessMix.undated += 1;
        }
      } else {
        freshnessMix.undated += 1;
      }

      const sourceFamily = attempt.source_family ?? "unknown";
      const coverage = sourceFamilyCoverage[sourceFamily] ?? {
        planned: 0,
        selected: 0,
        attempted: 0,
        accepted: 0
      };
      coverage.attempted += 1;
      if (attempt.accepted_for_evidence ?? attempt.accepted) {
        coverage.accepted += 1;
      }
      sourceFamilyCoverage[sourceFamily] = coverage;

      if (lane === "crawlee") {
        scrapeRecoveryAttempted += 1;
        if (attempt.accepted_for_evidence ?? attempt.accepted) {
          scrapeRecoverySucceeded += 1;
        }
        const trigger =
          typeof (attempt.extracted_fields as { recovery_trigger?: unknown })?.recovery_trigger === "string"
            ? String((attempt.extracted_fields as { recovery_trigger?: string }).recovery_trigger)
            : `acceptance:${attempt.acceptance_reason}`;
        scrapeRecoveryByTrigger[trigger] = (scrapeRecoveryByTrigger[trigger] ?? 0) + 1;
        if (attempt.transport_kind) {
          scrapeRecoveryByTransportKind[attempt.transport_kind] =
            (scrapeRecoveryByTransportKind[attempt.transport_kind] ?? 0) + 1;
        }
        scrapeRecoveryByAcceptanceReason[attempt.acceptance_reason] =
          (scrapeRecoveryByAcceptanceReason[attempt.acceptance_reason] ?? 0) + 1;
      }
    }
    for (const item of sourcePlan) {
      const coverage = sourceFamilyCoverage[item.source_family] ?? {
        planned: 0,
        selected: 0,
        attempted: 0,
        accepted: 0
      };
      coverage.planned += 1;
      if (item.selection_state === "selected") {
        coverage.selected += 1;
      }
      sourceFamilyCoverage[item.source_family] = coverage;
    }

    const attemptedSources = new Set(attempts.map((attempt) => attempt.source_name));
    const crawledSources = new Set(
      attempts.filter((attempt) => attempt.source_access_status !== "blocked" && attempt.source_access_status !== "auth_required").map((attempt) => attempt.source_name)
    );
    const pricedSources = new Set(
      attempts
        .filter(
          (attempt) =>
            attempt.acceptance_reason === "valuation_ready"
            || attempt.acceptance_reason === "estimate_range_ready"
            || attempt.acceptance_reason === "asking_price_ready"
        )
        .map((attempt) => attempt.source_name)
    );
    const currentRunValuationEligible = currentRunInventory.filter((record) => record.payload.accepted_for_valuation).length;
    const pricedSourceCoverageRatio =
      attemptedSources.size === 0 ? 0 : Number((pricedSources.size / attemptedSources.size).toFixed(4));
    const pricedCrawledSourceCoverageRatio =
      crawledSources.size === 0 ? 0 : Number((pricedSources.size / crawledSources.size).toFixed(4));
    const familyShareBreakdown = Object.fromEntries(
      Object.entries(
        attempts.reduce<Record<string, number>>((acc, attempt) => {
          const sourceFamily = attempt.source_family ?? "unknown";
          acc[sourceFamily] = (acc[sourceFamily] ?? 0) + 1;
          return acc;
        }, {})
      ).map(([family, count]) => [family, Number((count / Math.max(1, attempts.length)).toFixed(4))])
    );
    const laneHostHealthBreakdown = Object.fromEntries(
      persistedSourceHealth.map((record) => {
        const dimensions = Object.values((record as { dimensions?: Record<string, unknown> }).dimensions ?? {});
        const laneTotals = dimensions.reduce<Record<string, number>>((acc, value) => {
          const lane = typeof (value as { crawl_lane?: unknown }).crawl_lane === "string"
            ? String((value as { crawl_lane?: string }).crawl_lane)
            : "unknown";
          const attemptsForLane = Number((value as { total_attempts?: unknown }).total_attempts ?? 0);
          acc[lane] = (acc[lane] ?? 0) + attemptsForLane;
          return acc;
        }, {});
        return [record.host, laneTotals];
      })
    );
    const unverifiedSearchSeedCount = attempts.filter((attempt) => {
      if ((attempt.discovery_provenance ?? "seed") !== "seed") {
        return false;
      }
      const family = (attempt.source_family ?? "").toLowerCase();
      const isDynamicFamily = family.includes("open-web") || family.includes("dynamic-web") || family.includes("host-fingerprint");
      return isDynamicFamily && /(\/search|\/arama|[?&](?:q|query|term|search|search_words)=)/i.test(attempt.source_url);
    }).length;
    const duplicateListingCount = Math.max(0, attempts.filter((attempt) => attempt.accepted_for_evidence ?? attempt.accepted).length - currentRunInventory.length);
    const promotionCandidates = Object.entries(
      attempts.reduce<Record<string, { source_family: string; attempted: number; accepted: number; confidenceSum: number }>>(
        (acc, attempt) => {
          const host = attempt.transport_host ?? hostFromUrl(attempt.source_url) ?? "unknown";
          if (!host) return acc;
          const sourceFamily = attempt.source_family ?? "unknown";
          const isOpenWeb =
            sourceFamily.includes("open-web")
            || sourceFamily.includes("dynamic-web")
            || attempt.source_name.toLowerCase().includes("web discovery");
          if (!isOpenWeb) return acc;
          const current = acc[host] ?? {
            source_family: sourceFamily,
            attempted: 0,
            accepted: 0,
            confidenceSum: 0
          };
          current.attempted += 1;
          if (attempt.accepted_for_evidence ?? attempt.accepted) {
            current.accepted += 1;
            current.confidenceSum += attempt.confidence_score;
          }
          acc[host] = current;
          return acc;
        },
        {}
      )
    )
      .filter(([, value]) => value.accepted > 0)
      .map(([host, value]) => ({
        host,
        source_family: value.source_family,
        accepted_attempts: value.accepted,
        attempted: value.attempted,
        confidence_avg: Number((value.confidenceSum / Math.max(1, value.accepted)).toFixed(4)),
        reason: value.accepted >= 2
          ? "Repeated accepted evidence from dynamic host."
          : "Dynamic host produced accepted evidence."
      }))
      .sort((left, right) => right.accepted_attempts - left.accepted_attempts)
      .slice(0, 12);

    return {
      run_id: run.id,
      total_records: currentRunInventory.length,
      total_attempts: attempts.length,
      evidence_records: currentRunInventory.length,
      valuation_eligible_records: currentRunValuationEligible,
      accepted_records: currentRunInventory.length,
      rejected_candidates: attempts.filter((attempt) => !(attempt.accepted_for_evidence ?? attempt.accepted)).length,
      discovered_candidates: attempts.filter((attempt) => (attempt.discovery_provenance ?? "seed") !== "seed").length,
      accepted_from_discovery: currentRunInventory.filter((record) => isDiscoveryBackedRecord(record.payload)).length,
      unverified_search_seed_count: unverifiedSearchSeedCount,
      priced_source_coverage_ratio: pricedSourceCoverageRatio,
      priced_crawled_source_coverage_ratio: pricedCrawledSourceCoverageRatio,
      price_type_breakdown: {
        realized:
          (inventoryPriceBreakdown.realized_price ?? 0) +
          (inventoryPriceBreakdown.realized_with_buyers_premium ?? 0) +
          (inventoryPriceBreakdown.hammer_price ?? 0),
        estimate: inventoryPriceBreakdown.estimate ?? 0,
        asking: inventoryPriceBreakdown.asking_price ?? 0,
        inquiry: inventoryPriceBreakdown.inquiry_only ?? 0,
        unknown: inventoryPriceBreakdown.unknown ?? 0
      },
      cluster_count: clustered.clusters.length,
      auto_clustered_records: clustered.memberships.filter((membership) => membership.status === "auto_confirmed").length,
      review_item_count: clustered.reviewItems.length,
      source_candidate_breakdown: attempts.reduce<Record<string, number>>((acc, attempt) => {
        acc[attempt.source_name] = (acc[attempt.source_name] ?? 0) + 1;
        return acc;
      }, {}),
      source_status_breakdown: sourceStatusBreakdown,
      auth_mode_breakdown: authModeBreakdown,
      failure_class_breakdown: failureClassBreakdown,
      acceptance_reason_breakdown: acceptanceReasonBreakdown,
      scrape_recovery_diagnostics: {
        attempted: scrapeRecoveryAttempted,
        succeeded: scrapeRecoverySucceeded,
        by_trigger: scrapeRecoveryByTrigger,
        by_transport_kind: scrapeRecoveryByTransportKind,
        by_acceptance_reason: scrapeRecoveryByAcceptanceReason
      },
      browser_overwrite_prevented_count: browserOverwritePreventedCount,
      crawl_lane_breakdown: crawlLaneBreakdown,
      family_share_breakdown: familyShareBreakdown,
      lane_host_health_breakdown: laneHostHealthBreakdown,
      source_family_coverage: sourceFamilyCoverage,
      price_visibility_breakdown: priceVisibilityBreakdown,
      unique_artwork_count: currentRunInventory.length,
      duplicate_listing_count: duplicateListingCount,
      confidence_mix: confidenceMix,
      freshness_mix: freshnessMix,
      promotion_candidates: promotionCandidates,
      evaluation_metrics: buildEvaluationMetrics({
        attempts,
        sourcePlan,
        acceptedRecords: currentRunInventory.length,
        valuationEligibleRecords: currentRunValuationEligible,
        pricedRecordCount: currentRunValuationEligible,
        corePriceEvidenceCount: currentRunValuationEligible,
        uniqueArtworkCount: currentRunInventory.length,
        manualOverrideCount: clustered.reviewItems.filter((item) => item.status !== "pending").length
      }),
      discovery_provider_diagnostics: discoveryProviderDiagnostics,
      local_ai_analysis: localAiAnalysis,
      persisted_source_health: persistedSourceHealth,
      persisted_source_metrics: persistedSourceMetrics,
      recent_canaries: recentCanaries,
      valuation_generated: false,
      valuation_reason: "Deep inventory run reports separated price stats instead of a blended valuation range."
    };
  }
}

function uuid(): string {
  return createHash("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex");
}

export async function processArtistMarketInventoryRun(
  run: RunEntity,
  deps: {
    storage: ArtbotStorage;
    authManager: AuthManager;
    browserClient: BrowserClient;
    adapters: SourceAdapter[];
    normalizeRecord?: (record: PriceRecord) => Promise<PriceRecord>;
  }
): Promise<void> {
  const orchestrator = new ArtistMarketInventoryOrchestrator(
    deps.storage,
    new SourceRegistry(deps.adapters),
    deps.authManager,
    deps.browserClient,
    new FxRateProvider()
  );
  await orchestrator.processRun(run);
}
