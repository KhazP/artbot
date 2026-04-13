import fs from "node:fs";
import path from "node:path";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "@artbot/browser-core";
import { isTransportError, parseGenericLotFields, TransportErrorKind } from "@artbot/extraction";
import { logger } from "@artbot/observability";
import { applyConfidenceModel, dedupeRecords, FxRateProvider, normalizeRecordCurrencies } from "@artbot/normalization";
import { buildPerPaintingStats, renderMarkdownReport, writeJsonFile } from "@artbot/report-generation";
import { buildDiscoveryConfigFromEnv, buildSourcePlanItems, planSources, SourceRegistry, type PlannedSource } from "@artbot/source-registry";
import { evaluateAcceptance, type SourceCandidate } from "@artbot/source-adapters";
import { ArtbotStorage, buildDefaultGcPolicyFromEnv, buildRunArtifactManifest, writeArtifactManifest } from "@artbot/storage";
import {
  acceptanceReasonList,
  failureClassList,
  type AcceptanceReason,
  type FailureClass,
  type HostHealthRecord,
  type PriceRecord,
  type RunEntity,
  type RunSummary,
  type SourceAccessStatus,
  type SourceAttempt
} from "@artbot/shared-types";
import { buildValuation, rankComparablesWithScores } from "@artbot/valuation";
import { processArtistMarketInventoryRun } from "./artist-market-inventory.js";
import { buildEvaluationMetrics, buildRecommendedActions } from "./run-insights.js";

export interface OrchestratorOptions {
  minValuationComps?: number;
  modelCheapDefault?: string;
  modelCheapFallback?: string;
}

export type NetworkHealthState = "HEALTHY" | "DEGRADED" | "OUTAGE_SUSPECTED" | "OUTAGE_CONFIRMED";

interface CandidateTask {
  source: SourceWorkState;
  candidate: SourceCandidate;
  host: string | null;
}

interface CandidateTaskOutcome {
  task: CandidateTask;
  attempt: SourceAttempt;
  acceptedRecord: PriceRecord | null;
  discoveredCandidates: SourceCandidate[];
  gap?: string;
  transportKind?: TransportErrorKind;
  transportHost?: string;
  succeeded: boolean;
}

interface SourceWorkState {
  planned: PlannedSource;
  sourceName: string;
  queue: SourceCandidate[];
  seen: Set<string>;
}

interface ConcurrencyConfig {
  healthy: number;
  degraded: number;
  suspected: number;
}

interface TransportMetadata {
  kind: TransportErrorKind;
  provider: string;
  host?: string;
  statusCode?: number;
  retryable: boolean;
}

const OUTAGE_RELEVANT_TRANSPORT_KINDS: TransportErrorKind[] = [
  TransportErrorKind.DNS_FAILED,
  TransportErrorKind.TCP_TIMEOUT,
  TransportErrorKind.TCP_REFUSED,
  TransportErrorKind.TLS_FAILED,
  TransportErrorKind.UNKNOWN_NETWORK
];

export function isOutageRelevantTransportKind(kind: TransportErrorKind): boolean {
  return OUTAGE_RELEVANT_TRANSPORT_KINDS.includes(kind);
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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

function inferSourcePageType(url: string): SourceCandidate["sourcePageType"] {
  const lower = url.toLowerCase();
  if (
    /\/(?:cart|sepet|account|giris|login|contact|iletisim|about|hakkimizda|download-app|siparislerim|desteklerim|privacy|gizlilik|uyelik|kargo|odeme|rss|feed)\b/.test(lower)
  ) {
    return "other";
  }
  if (
    /\/artist\/artwork-detail\//.test(lower)
    || /\/artist\/result-detail\//.test(lower)
    || /\/search\/result-detail\//.test(lower)
    || /\/search\/artwork-detail\//.test(lower)
    || /\/artist\/artist-result\//.test(lower)
    ||
    /(\/lot\/|\/lots\/|\/auction\/lot|\/auction-lot\/|\/item\/\d+|\/lot-|\/(?:en\/)?products\/|\/urun\/)/.test(lower)
    || /\/hemen-al\/[^/?#]+\/\d+/i.test(lower)
    || /\/hemen-al\/\d+\//i.test(lower)
    || /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i.test(lower)
  ) {
    return "lot";
  }
  if (/(\/artist\/|\/artists\/)/.test(lower)) return "artist_page";
  if (/(\/price|\/result|\/archive|\/catalog|\/arsiv|\/search|\/arama|\/hemen-al\b|\/muzayede\/\d+\/|page=)/.test(lower)) {
    return "listing";
  }
  return "other";
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteAmount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPricedAcceptanceReason(reason: AcceptanceReason): boolean {
  return reason === "valuation_ready" || reason === "estimate_range_ready" || reason === "asking_price_ready";
}

function isCrawledSourceStatus(status: SourceAccessStatus): boolean {
  return status !== "blocked" && status !== "auth_required";
}

function gatedContentReasonForAccessMode(mode: "anonymous" | "authorized" | "licensed"): {
  status: SourceAccessStatus;
  failureClass: FailureClass;
  rejectionReason: string;
  valuationReason: string;
  blockerReason: string;
} {
  if (mode === "anonymous") {
    return {
      status: "auth_required",
      failureClass: "access_blocked",
      rejectionReason: "Login gate detected without authorized session.",
      valuationReason: "Authentication required.",
      blockerReason: "Authentication required."
    };
  }

  return {
    status: "blocked",
    failureClass: "access_blocked",
    rejectionReason: "Saved session did not unlock gated content; refresh the session or verify source entitlements.",
    valuationReason: "Saved session did not unlock gated content.",
    blockerReason: "Saved session did not unlock gated content."
  };
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
  /\/(?:account|hesabim|uyelik|uyelik-sozlesmesi|login|register|signup|sign-in|sign-up)(?:[/?#.]|$)/i,
  /\/giris[^/]*(?:[/?#.]|$)/i,
  /\/[^/?#]*giris(?:-[^/?#]*)?(?:\.html|[/?#]|$)/i,
  /\/[^/?#]*login(?:-[^/?#]*)?(?:\.html|[/?#]|$)/i,
  /\/(?:contact|iletisim|about|hakkimizda|privacy|gizlilik|terms|kosullar|sartlar-ve-kosullar)(?:[/?#.]|$)/i,
  /\/(?:download-app|siparislerim|desteklerim|sifremi(?:unuttum)?|odeme_bilgilendirme|kargo_bilgileri)(?:[/?#.]|$)/i,
  /\/(?:collections\/shop|collections\/private-sales|pages\/|shop|dukkan\.html|tumurunler\.html|muzayedeler\.html)(?:[/?#]|$)/i,
  /\/(?:rss|feed)(?:[/?#.]|$)/i
];

function discoveredUrlLooksLikeAccessCheckpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const normalizedPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return RENDERED_DISCOVERY_BLOCK_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
  } catch {
    return false;
  }
}

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

function isSanatfiyatArtworkDetailUrl(url: URL): boolean {
  return /\/(?:artist|search)\/(?:artwork-detail|result-detail|artist-result)\//i.test(url.pathname);
}

function isSanatfiyatArtistDetailUrl(url: URL): boolean {
  return /\/(?:search\/)?artist-detail\//i.test(url.pathname);
}

export function shouldKeepRenderedDiscoveredUrl(
  url: string,
  discoveredFromUrl: string,
  adapterId: string,
  query: RunEntity["query"]
): boolean {
  let parsed: URL;
  let discoveredFrom: URL;
  try {
    parsed = new URL(url);
    discoveredFrom = new URL(discoveredFromUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const host = normalizeDiscoveryHost(parsed.hostname);
  const originHost = normalizeDiscoveryHost(discoveredFrom.hostname);
  if (host !== originHost) {
    return false;
  }

  if (RENDERED_DISCOVERY_BLOCK_HOSTS.some((blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`))) {
    return false;
  }

  if (discoveredUrlLooksLikeAccessCheckpoint(url)) {
    return false;
  }

  const normalizedPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (!normalizedPath || normalizedPath === "/") {
    return false;
  }

  if (RENDERED_DISCOVERY_BLOCK_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return false;
  }

  if (adapterId === "sanatfiyat-licensed-extractor" && isSanatfiyatArtworkDetailUrl(parsed)) {
    return (
      urlReferencesQueryEntity(discoveredFromUrl, query)
      || searchParamsReferenceQueryEntity(discoveredFromUrl, query)
      || urlReferencesQueryEntity(url, query)
    );
  }

  if (/\/(?:search\/)?artist-detail\//i.test(parsed.pathname)) {
    return urlReferencesQueryEntity(url, query);
  }

  if (/\/artist\//i.test(parsed.pathname) && !urlReferencesQueryEntity(url, query)) {
    return false;
  }

  if (
    adapterId === "muzayedeapp-platform" &&
    /\/[^/?#]*m(?:u|ü)zayedesi[^/?#]*\.html/i.test(parsed.pathname) &&
    !urlReferencesQueryEntity(url, query)
  ) {
    return false;
  }

  return true;
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
    return url;
  }
}

function queuePriority(candidate: SourceCandidate): number {
  const scorePenalty = (1 - clamp(candidate.score ?? 0.5)) / 100;
  if (candidate.sourcePageType === "lot") {
    return 0 + scorePenalty;
  }
  if (candidate.provenance === "web_discovery") {
    return 1 + scorePenalty;
  }
  if (candidate.provenance === "listing_expansion" || candidate.provenance === "signature_expansion") {
    return 2 + scorePenalty;
  }
  if (candidate.provenance === "seed") {
    return 3 + scorePenalty;
  }
  return 4 + scorePenalty;
}

export function insertDiscoveredCandidate(queue: SourceCandidate[], candidate: SourceCandidate): void {
  const candidateRank = queuePriority(candidate);
  const insertionIndex = queue.findIndex((entry) => queuePriority(entry) > candidateRank);
  if (insertionIndex === -1) {
    queue.push(candidate);
    return;
  }
  queue.splice(insertionIndex, 0, candidate);
}

function toRenderedDiscoveredCandidate(
  url: string,
  discoveredFromUrl: string,
  adapterId: string,
  query: RunEntity["query"]
): SourceCandidate | null {
  const normalizedUrl = normalizeCandidateUrl(url);

  if (!shouldKeepRenderedDiscoveredUrl(normalizedUrl, discoveredFromUrl, adapterId, query)) {
    return null;
  }

  const sourcePageType = inferSourcePageType(normalizedUrl);
  const entityReferenced = urlReferencesQueryEntity(normalizedUrl, query);
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

export function shouldQueueDiscoveredCandidate(candidate: SourceCandidate, query: RunEntity["query"]): boolean {
  if (candidate.provenance === "seed") {
    return true;
  }

  if (discoveredUrlLooksLikeAccessCheckpoint(candidate.url)) {
    return false;
  }

  if (candidate.sourcePageType === "other") {
    return urlReferencesQueryEntity(candidate.url, query);
  }

  if (looksLikeSearchUrl(candidate.url) && !searchParamsReferenceQueryEntity(candidate.url, query)) {
    return false;
  }

  if (candidate.discoveredFromUrl) {
    try {
      const candidateUrl = new URL(candidate.url);
      const discoveredFromUrl = new URL(candidate.discoveredFromUrl);
      if (
        isSanatfiyatArtworkDetailUrl(candidateUrl)
        && isSanatfiyatArtistDetailUrl(discoveredFromUrl)
        && (
          urlReferencesQueryEntity(candidate.discoveredFromUrl, query)
          || searchParamsReferenceQueryEntity(candidate.discoveredFromUrl, query)
        )
      ) {
        return true;
      }
    } catch {
      // Ignore malformed discovery links and fall through to default heuristics.
    }
  }

  if (candidate.sourcePageType !== "lot") {
    return true;
  }

  if (urlReferencesQueryEntity(candidate.url, query)) {
    return true;
  }

  return !discoveredUrlLooksLikeDifferentEntity(candidate.url, query);
}

export function classifyFailureClass(transport: TransportMetadata | null, blockerReason?: string | null): FailureClass {
  if (blockerReason?.includes("host_circuit_open")) {
    return "host_circuit";
  }

  if (!transport) {
    return "access_blocked";
  }

  if (transport.kind === TransportErrorKind.WAF_BLOCK || transport.kind === TransportErrorKind.RATE_LIMITED) {
    return "waf_challenge";
  }

  if (transport.kind === TransportErrorKind.DNS_FAILED) {
    return "transport_dns";
  }

  if (transport.kind === TransportErrorKind.TCP_TIMEOUT) {
    return "transport_timeout";
  }

  if (transport.kind === TransportErrorKind.HTTP_ERROR && transport.statusCode === 404) {
    return "not_found";
  }

  if (
    transport.kind === TransportErrorKind.AUTH_INVALID ||
    transport.kind === TransportErrorKind.LEGAL_BLOCK ||
    (transport.kind === TransportErrorKind.HTTP_ERROR &&
      (transport.statusCode === 401 || transport.statusCode === 403 || transport.statusCode === 451))
  ) {
    return "access_blocked";
  }

  return "transport_other";
}

export function sourceAccessStatusForFailure(
  failureClass: FailureClass,
  fallbackStatus: SourceAccessStatus
): SourceAccessStatus {
  if (failureClass === "access_blocked" || failureClass === "waf_challenge" || failureClass === "host_circuit") {
    return "blocked";
  }

  if (fallbackStatus === "blocked") {
    return "public_access";
  }

  return fallbackStatus;
}

function rejectionReasonForFailureClass(failureClass: FailureClass, transportKind?: TransportErrorKind): string {
  if (failureClass === "host_circuit") {
    return "Host circuit breaker open.";
  }
  if (failureClass === "not_found") {
    return "Target page returned 404 not found.";
  }
  if (failureClass === "waf_challenge") {
    return "WAF/challenge response detected.";
  }
  if (failureClass === "access_blocked") {
    return "Access blocked by source policy/auth/legal controls.";
  }
  if (failureClass === "transport_dns") {
    return "Transport failure (DNS resolution).";
  }
  if (failureClass === "transport_timeout") {
    return "Transport failure (timeout).";
  }
  return transportKind ? `Transport failure (${transportKind}).` : "Transport failure.";
}

export function resolveConcurrencyForState(state: NetworkHealthState, config: ConcurrencyConfig): number {
  if (state === "OUTAGE_SUSPECTED") return Math.max(1, config.suspected);
  if (state === "DEGRADED") return Math.max(1, config.degraded);
  return Math.max(1, config.healthy);
}

export function shouldExitProcessingLoop(options: {
  hasPendingCandidates: boolean;
  activeTaskCount: number;
  stopScheduling: boolean;
}): boolean {
  if (options.activeTaskCount > 0) {
    return false;
  }
  if (options.stopScheduling) {
    return true;
  }
  return !options.hasPendingCandidates;
}

export class HostCircuitRegistry {
  private readonly hosts = new Map<
    string,
    {
      consecutiveFailures: number;
      lastFailureAt: string;
      tripped: boolean;
    }
  >();

  constructor(private readonly threshold: number) {}

  public registerFailure(host: string): boolean {
    const current = this.hosts.get(host) ?? {
      consecutiveFailures: 0,
      lastFailureAt: new Date(0).toISOString(),
      tripped: false
    };

    const next = {
      consecutiveFailures: current.consecutiveFailures + 1,
      lastFailureAt: new Date().toISOString(),
      tripped: current.tripped || current.consecutiveFailures + 1 >= this.threshold
    };
    this.hosts.set(host, next);
    return !current.tripped && next.tripped;
  }

  public registerSuccess(host: string): void {
    const current = this.hosts.get(host);
    if (!current) return;
    this.hosts.set(host, {
      consecutiveFailures: 0,
      lastFailureAt: current.lastFailureAt,
      tripped: current.tripped
    });
  }

  public isTripped(host: string): boolean {
    return this.hosts.get(host)?.tripped ?? false;
  }
}

export class NetworkHealthTracker {
  private readonly recentSignals: boolean[] = [];
  private state: NetworkHealthState = "HEALTHY";
  private consecutiveOutageFailures = 0;

  constructor(
    private readonly degradedWindow = 6,
    private readonly suspectedWindow = 8,
    private readonly confirmedConsecutiveFailures = 12
  ) {}

  public registerOutageFailure(): NetworkHealthState {
    this.consecutiveOutageFailures += 1;
    this.recentSignals.push(true);
    this.state = this.computeState();
    return this.state;
  }

  public registerHealthySignal(): NetworkHealthState {
    this.consecutiveOutageFailures = 0;
    this.recentSignals.push(false);
    this.state = this.computeState();
    return this.state;
  }

  public current(): NetworkHealthState {
    return this.state;
  }

  private computeState(): NetworkHealthState {
    if (this.state === "OUTAGE_CONFIRMED") {
      return "OUTAGE_CONFIRMED";
    }

    while (this.recentSignals.length > 24) {
      this.recentSignals.shift();
    }

    if (this.consecutiveOutageFailures >= this.confirmedConsecutiveFailures) {
      return "OUTAGE_CONFIRMED";
    }

    const suspectedSlice = this.recentSignals.slice(-this.suspectedWindow);
    const degradedSlice = this.recentSignals.slice(-this.degradedWindow);

    if (suspectedSlice.length >= this.suspectedWindow) {
      const outageRate = suspectedSlice.filter(Boolean).length / suspectedSlice.length;
      if (outageRate >= 0.85) {
        return "OUTAGE_SUSPECTED";
      }
    }

    if (degradedSlice.length >= this.degradedWindow) {
      const degradedRate = degradedSlice.filter(Boolean).length / degradedSlice.length;
      if (degradedRate >= 0.5) {
        return "DEGRADED";
      }
    }

    return "HEALTHY";
  }
}

export class ResearchOrchestrator {
  private readonly registry: SourceRegistry;
  private readonly authManager: AuthManager;
  private readonly browserClient: BrowserClient;
  private readonly fxRates: FxRateProvider;
  private readonly minValuationComps: number;
  private readonly modelCheapDefault: string;
  private readonly modelCheapFallback: string;
  private readonly concurrency: ConcurrencyConfig;
  private readonly hostBreakerThreshold: number;
  private readonly candidateTimeoutMs: number;

  constructor(private readonly storage: ArtbotStorage, options: OrchestratorOptions = {}) {
    this.registry = new SourceRegistry();
    this.authManager = new AuthManager();
    this.browserClient = new BrowserClient(this.authManager);
    this.fxRates = new FxRateProvider();
    this.minValuationComps = options.minValuationComps ?? 5;
    this.modelCheapDefault = options.modelCheapDefault ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
    this.modelCheapFallback = options.modelCheapFallback ?? process.env.MODEL_CHEAP_FALLBACK ?? "gemini-2.5-flash-lite";

    this.concurrency = {
      healthy: toPositiveInt(process.env.PIPELINE_MAX_CONCURRENCY, 6),
      degraded: toPositiveInt(process.env.PIPELINE_DEGRADED_CONCURRENCY, 3),
      suspected: toPositiveInt(process.env.PIPELINE_SUSPECTED_CONCURRENCY, 1)
    };
    this.hostBreakerThreshold = toPositiveInt(process.env.PIPELINE_HOST_BREAKER_THRESHOLD, 3);
    this.candidateTimeoutMs = toPositiveInt(process.env.PIPELINE_CANDIDATE_TIMEOUT_MS, 45_000);
  }

  public async processRun(run: RunEntity): Promise<void> {
    if (run.runType === "artist_market_inventory") {
      await processArtistMarketInventoryRun(run, {
        storage: this.storage,
        authManager: this.authManager,
        browserClient: this.browserClient,
        adapters: this.registry.list(),
        normalizeRecord: (record) => this.normalizeRecord(record)
      });
      return;
    }

    const traceId = `run_${run.id.slice(0, 8)}`;
    const runRoot = this.storage.getRunRoot(run.id);
    const evidenceDir = path.join(runRoot, "evidence");

    logger.info("Starting research run", {
      traceId,
      runId: run.id,
      stage: "pipeline_start",
      artist: run.query.artist,
      scope: run.query.scope,
      concurrency: this.concurrency
    });

    const plannedSources = await planSources(run.query, this.registry.list(), this.authManager, this.storage.listHostHealth(50));
    const maxDiscoveredCandidatesPerSource = buildDiscoveryConfigFromEnv(run.query.analysisMode).maxCandidatesPerSource;
    const sourcePlan = buildSourcePlanItems(plannedSources, maxDiscoveredCandidatesPerSource, run.query.analysisMode);
    const selectedSourceIds = new Set(
      sourcePlan.filter((item) => item.selection_state === "selected").map((item) => item.adapter_id)
    );

    const sourceCandidateBreakdown: Record<string, number> = {};
    let discoveredCandidates = 0;

    const runnableSources = plannedSources.filter((planned) => selectedSourceIds.has(planned.adapter.id));

    const sources: SourceWorkState[] = runnableSources.map((planned) => {
      const queue = [...planned.candidates];
      const sourceName = planned.adapter.sourceName;
      sourceCandidateBreakdown[sourceName] = queue.length;
      discoveredCandidates += queue.filter((candidate) => candidate.provenance !== "seed").length;

      return {
        planned,
        sourceName,
        queue,
        seen: new Set(queue.map((candidate) => candidate.url))
      };
    });

    const attempts: SourceAttempt[] = [];
    const candidateRecords: PriceRecord[] = [];
    const gaps: string[] = [];
    let acceptedFromDiscovery = 0;
    let rrCursor = 0;

    const hostBreakers = new HostCircuitRegistry(this.hostBreakerThreshold);
    const networkHealth = new NetworkHealthTracker();
    let stopScheduling = false;
    let outageReason: string | null = null;

    const activeTasks = new Set<Promise<{ outcome: CandidateTaskOutcome }>>();

    const hasPendingCandidates = () => sources.some((source) => source.queue.length > 0);

    const dequeueTask = (): CandidateTask | null => {
      if (sources.length === 0) return null;

      for (let i = 0; i < sources.length; i += 1) {
        const index = (rrCursor + i) % sources.length;
        const source = sources[index];
        const candidate = source.queue.shift();
        if (!candidate) {
          continue;
        }
        rrCursor = (index + 1) % sources.length;
        return {
          source,
          candidate,
          host: hostFromUrl(candidate.url)
        };
      }

      return null;
    };

    const scheduleTask = (task: CandidateTask): void => {
      const promise = this.executeCandidateTaskWithTimeout(task, run, traceId, evidenceDir).then((outcome) => ({ outcome }));
      activeTasks.add(promise);
      void promise.finally(() => {
        activeTasks.delete(promise);
      });
    };

    while (hasPendingCandidates() || activeTasks.size > 0) {
      const targetConcurrency = resolveConcurrencyForState(networkHealth.current(), this.concurrency);

      while (!stopScheduling && activeTasks.size < targetConcurrency) {
        const nextTask = dequeueTask();
        if (!nextTask) break;

        if (nextTask.host && hostBreakers.isTripped(nextTask.host)) {
          const trippedAttempt = this.buildHostCircuitAttempt(run.id, nextTask);
          attempts.push(trippedAttempt);
          this.storage.saveAttempt(run.id, trippedAttempt);
          continue;
        }

        scheduleTask(nextTask);
      }

      if (activeTasks.size === 0) {
        if (
          shouldExitProcessingLoop({
            hasPendingCandidates: hasPendingCandidates(),
            activeTaskCount: activeTasks.size,
            stopScheduling
          })
        ) {
          break;
        }
        continue;
      }

      const settled = await Promise.race(activeTasks);
      const outcome = settled.outcome;

      attempts.push(outcome.attempt);
      this.storage.saveAttempt(run.id, outcome.attempt);
      if (outcome.transportHost) {
        this.storage.recordHostAttempt(outcome.transportHost, outcome.attempt);
      } else if (outcome.attempt.transport_host) {
        this.storage.recordHostAttempt(outcome.attempt.transport_host, outcome.attempt);
      } else if (outcome.task.host) {
        this.storage.recordHostAttempt(outcome.task.host, outcome.attempt);
      }

      if (outcome.gap) {
        gaps.push(outcome.gap);
      }

      if (outcome.succeeded) {
        if (outcome.task.host) {
          hostBreakers.registerSuccess(outcome.task.host);
        }
        networkHealth.registerHealthySignal();
      } else if (outcome.transportKind && outcome.transportHost && isOutageRelevantTransportKind(outcome.transportKind)) {
        const trippedNow = hostBreakers.registerFailure(outcome.transportHost);
        const state = networkHealth.registerOutageFailure();
        if (trippedNow) {
          gaps.push(`Host circuit opened for ${outcome.transportHost} after repeated transport failures.`);
        }
        if (state === "OUTAGE_CONFIRMED" && !stopScheduling) {
          stopScheduling = true;
          outageReason = "Confirmed transport outage: widespread DNS/network failures detected.";
          gaps.push(outageReason);
        }
      }

      if (outcome.acceptedRecord) {
        const normalized = await this.normalizeRecord(outcome.acceptedRecord);
        candidateRecords.push(normalized);
        if (outcome.task.candidate.provenance !== "seed") {
          acceptedFromDiscovery += 1;
        }
      }

      if (!stopScheduling && outcome.discoveredCandidates.length > 0) {
        for (const discovered of outcome.discoveredCandidates) {
          if (!shouldQueueDiscoveredCandidate(discovered, run.query)) {
            continue;
          }
          if (outcome.task.source.seen.has(discovered.url)) {
            continue;
          }
          if (sourceCandidateBreakdown[outcome.task.source.sourceName] >= maxDiscoveredCandidatesPerSource) {
            break;
          }

          outcome.task.source.seen.add(discovered.url);
          insertDiscoveredCandidate(outcome.task.source.queue, discovered);
          sourceCandidateBreakdown[outcome.task.source.sourceName] += 1;
          discoveredCandidates += 1;
        }
      }
    }

    const { uniqueRecords, duplicates } = dedupeRecords(candidateRecords);
    if (duplicates.length > 0) {
      gaps.push(`${duplicates.length} candidate records were excluded as duplicates.`);
    }

    const scoredComparables = rankComparablesWithScores(uniqueRecords, {
      title: run.query.title,
      medium: run.query.medium,
      year: run.query.year,
      dimensions: {
        heightCm: run.query.dimensions?.heightCm,
        widthCm: run.query.dimensions?.widthCm
      }
    });
    const rankedRecords = scoredComparables.map((entry) => entry.record);
    for (const record of rankedRecords) {
      this.storage.saveRecord(run.id, record);
    }

    if (outageReason) {
      logger.warn("Research run terminated early after transport outage", {
        traceId,
        runId: run.id,
        stage: "pipeline_outage_confirmed",
        attempts: attempts.length
      });
      throw new Error(outageReason);
    }

    const valuation = buildValuation(rankedRecords, this.minValuationComps, scoredComparables);
    const perPaintingStats = buildPerPaintingStats(rankedRecords);
    const valuationEligibleRecords = rankedRecords.filter((record) => record.accepted_for_valuation).length;
    const persistedHostHealth = this.storage.listHostHealth(12);
    const evaluationMetrics = buildEvaluationMetrics({
      attempts,
      sourcePlan,
      acceptedRecords: rankedRecords.length,
      valuationEligibleRecords
    });
    const recommendedActions = buildRecommendedActions({
      sourcePlan,
      attempts,
      acceptedRecords: rankedRecords.length,
      discoveredCandidates,
      hostHealth: persistedHostHealth,
      evaluationMetrics
    });
    const summary = this.buildSummary(
      run.id,
      rankedRecords.length,
      valuationEligibleRecords,
      attempts,
      valuation.generated,
      valuation.reason,
      discoveredCandidates,
      acceptedFromDiscovery,
      sourceCandidateBreakdown,
      persistedHostHealth,
      sourcePlan
    );

    const resultsPath = path.join(runRoot, "results.json");
    const reportPath = path.join(runRoot, "report.md");
    const completedRun = {
      ...run,
      status: "completed" as const,
      error: null,
      reportPath,
      resultsPath,
      updatedAt: new Date().toISOString()
    };

    const payload = {
      run: completedRun,
      model_policy: {
        preferred: this.modelCheapDefault,
        fallback: this.modelCheapFallback,
        hard_case_escalation_enabled: false
      },
      summary,
      valuation,
      records: rankedRecords,
      duplicates,
      per_painting_stats: perPaintingStats,
      source_plan: sourcePlan,
      recommended_actions: recommendedActions,
      persisted_source_health: persistedHostHealth,
      attempts,
      gaps
    };

    writeJsonFile(resultsPath, payload);
    fs.writeFileSync(reportPath, renderMarkdownReport(rankedRecords, summary, valuation, gaps, recommendedActions), "utf-8");
    const artifactManifest = buildRunArtifactManifest({
      runId: run.id,
      runRoot,
      reportPath,
      resultsPath,
      attempts,
      policy: buildDefaultGcPolicyFromEnv()
    });
    writeArtifactManifest(runRoot, artifactManifest);

    this.storage.completeRun(run.id, reportPath, resultsPath);

    logger.info("Research run completed", {
      traceId,
      runId: run.id,
      stage: "pipeline_done",
      acceptedRecords: rankedRecords.length,
      rejectedCandidates: summary.rejected_candidates,
      valuationGenerated: valuation.generated
    });
  }

  private async executeCandidateTask(
    task: CandidateTask,
    run: RunEntity,
    traceId: string,
    evidenceDir: string
  ): Promise<CandidateTaskOutcome> {
    try {
      const result = await task.source.planned.adapter.extract(task.candidate, {
        runId: run.id,
        traceId,
        query: run.query,
        accessContext: task.source.planned.accessContext,
        evidenceDir,
        sessionContext: {
          attemptCount: 1
        }
      });

      const shouldDiscoverRenderedArtifacts =
        task.source.planned.adapter.crawlStrategies.includes("rendered_dom") ||
        task.candidate.sourcePageType !== "lot" ||
        result.attempt.acceptance_reason === "generic_shell_page";
      const renderedArtifacts = shouldDiscoverRenderedArtifacts
        ? await this.browserClient.discoverRenderedArtifacts({
            traceId,
            sourceName: task.source.planned.adapter.id,
            url: task.candidate.url,
            runId: run.id,
            evidenceDir,
            accessContext: task.source.planned.accessContext,
            maxPages: task.candidate.sourcePageType === "listing" ? 4 : 2
          })
        : null;

      if (!result.attempt.screenshot_path && renderedArtifacts?.screenshotPaths[0]) {
        result.attempt.screenshot_path = renderedArtifacts.screenshotPaths[0];
      }
      if (!result.attempt.raw_snapshot_path && renderedArtifacts?.rawSnapshotPaths[0]) {
        result.attempt.raw_snapshot_path = renderedArtifacts.rawSnapshotPaths[0];
      }
      if (result.record && !result.record.screenshot_path && renderedArtifacts?.screenshotPaths[0]) {
        result.record.screenshot_path = renderedArtifacts.screenshotPaths[0];
      }
      if (result.record && !result.record.raw_snapshot_path && renderedArtifacts?.rawSnapshotPaths[0]) {
        result.record.raw_snapshot_path = renderedArtifacts.rawSnapshotPaths[0];
      }

      const renderedCandidates = (renderedArtifacts?.discoveredUrls ?? [])
        .map((url) => toRenderedDiscoveredCandidate(url, task.candidate.url, task.source.planned.adapter.id, run.query))
        .filter((candidate): candidate is SourceCandidate => Boolean(candidate));

      const captureAcceptedValuation = process.env.CAPTURE_BROWSER_FOR_ACCEPTED_VALUATION === "true";
      const acceptedForValuation = Boolean(result.attempt.accepted_for_valuation ?? result.record?.accepted_for_valuation);
      if (result.needsBrowserVerification || (captureAcceptedValuation && acceptedForValuation)) {
        const browserCapture = await this.browserClient.withRetries(
          () =>
            this.browserClient.capture({
              traceId,
              sourceName: task.source.planned.adapter.id,
              url: task.candidate.url,
              runId: run.id,
              evidenceDir,
              accessContext: task.source.planned.accessContext,
              captureHeavyEvidence: this.shouldCaptureHeavyEvidence(result)
            }),
          3,
          1_000,
          traceId
        );

        result.attempt.screenshot_path = browserCapture.screenshotPath;
        result.attempt.pre_auth_screenshot_path = browserCapture.preAuthScreenshotPath;
        result.attempt.post_auth_screenshot_path = browserCapture.postAuthScreenshotPath;
        result.attempt.raw_snapshot_path = browserCapture.rawSnapshotPath;
        result.attempt.trace_path = browserCapture.tracePath;
        result.attempt.har_path = browserCapture.harPath;
        result.attempt.canonical_url = browserCapture.finalUrl;
        result.attempt.model_used = browserCapture.modelUsed;

        if (browserCapture.requiresAuthDetected) {
          const gatedReason = gatedContentReasonForAccessMode(task.source.planned.accessContext.mode);
          result.attempt.source_access_status = gatedReason.status;
          result.attempt.failure_class = gatedReason.failureClass;
          result.attempt.accepted = false;
          result.attempt.accepted_for_evidence = false;
          result.attempt.accepted_for_valuation = false;
          result.attempt.valuation_lane = "none";
          result.attempt.acceptance_reason = "blocked_access";
          result.attempt.rejection_reason = gatedReason.rejectionReason;
          result.attempt.valuation_eligibility_reason = gatedReason.valuationReason;
          result.attempt.blocker_reason = gatedReason.blockerReason;
          if (result.record) {
            result.record.source_access_status = gatedReason.status;
            result.record.accepted_for_evidence = false;
            result.record.accepted_for_valuation = false;
            result.record.valuation_lane = "none";
            result.record.acceptance_reason = "blocked_access";
            result.record.rejection_reason = gatedReason.rejectionReason;
            result.record.valuation_eligibility_reason = gatedReason.valuationReason;
            result.record.valuation_confidence = 0;
            result.record.overall_confidence = Math.min(result.record.overall_confidence, 0.35);
          }
        }

        if (browserCapture.blockedDetected) {
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
          }
        }

        if (result.record) {
          result.record.screenshot_path = browserCapture.screenshotPath;
          result.record.raw_snapshot_path = browserCapture.rawSnapshotPath;
        }

        if (
          browserCapture.rawSnapshotPath
          && !browserCapture.blockedDetected
          && !browserCapture.requiresAuthDetected
        ) {
          result.record = this.tryRecoverPriceFromBrowserSnapshot(task, run, result, browserCapture.rawSnapshotPath);
        }
      }

      const acceptedForEvidence = Boolean(result.attempt.accepted_for_evidence ?? result.attempt.accepted);
      return {
        task,
        attempt: result.attempt,
        acceptedRecord: result.record && acceptedForEvidence ? result.record : null,
        discoveredCandidates: [...(result.discoveredCandidates ?? []), ...renderedCandidates],
        succeeded: true
      };
    } catch (error) {
      const transport = this.resolveTransportMetadata(error, task.host);
      const failedAttempt = this.buildFailedAttempt(run.id, task, error, transport);
      const gapReason = error instanceof Error ? error.message : String(error);

      const recovery = transport?.kind === TransportErrorKind.TCP_TIMEOUT
        ? await this.attemptBrowserTimeoutRecovery(task, run, traceId, evidenceDir, failedAttempt)
        : null;

      if (recovery) {
        return recovery;
      }

      return {
        task,
        attempt: failedAttempt,
        acceptedRecord: null,
        discoveredCandidates: [],
        gap: `${task.source.sourceName}: ${gapReason}`,
        transportKind: transport?.kind,
        transportHost: transport?.host,
        succeeded: false
      };
    }
  }

  private async executeCandidateTaskWithTimeout(
    task: CandidateTask,
    run: RunEntity,
    traceId: string,
    evidenceDir: string
  ): Promise<CandidateTaskOutcome> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutMs = this.candidateTimeoutMs;
    const taskPromise = this.executeCandidateTask(task, run, traceId, evidenceDir);
    const timeoutPromise = new Promise<CandidateTaskOutcome>((resolve) => {
      timeoutHandle = setTimeout(() => {
        const timeoutError = new Error(`Candidate task timed out after ${timeoutMs}ms.`);
        const timeoutTransport: TransportMetadata = {
          kind: TransportErrorKind.TCP_TIMEOUT,
          provider: "pipeline_timeout",
          host: task.host ?? undefined,
          statusCode: undefined,
          retryable: true
        };
        resolve({
          task,
          attempt: this.buildFailedAttempt(run.id, task, timeoutError, timeoutTransport),
          acceptedRecord: null,
          discoveredCandidates: [],
          gap: `${task.source.sourceName}: ${timeoutError.message}`,
          transportKind: timeoutTransport.kind,
          transportHost: timeoutTransport.host,
          succeeded: false
        });
      }, timeoutMs);
    });

    try {
      const firstResult = await Promise.race([
        taskPromise.then((outcome) => ({ kind: "task" as const, outcome })),
        timeoutPromise.then((outcome) => ({ kind: "timeout" as const, outcome }))
      ]);
      if (firstResult.kind === "task") {
        return firstResult.outcome;
      }

      const timeoutOutcome = firstResult.outcome;
      if (timeoutOutcome.transportKind !== TransportErrorKind.TCP_TIMEOUT) {
        return timeoutOutcome;
      }

      const recoveryPromise = this.attemptBrowserTimeoutRecovery(task, run, traceId, evidenceDir, timeoutOutcome.attempt);
      const followUpResult = await Promise.race([
        taskPromise.then((outcome) => ({ kind: "task" as const, outcome })),
        recoveryPromise.then((outcome) => ({ kind: "recovery" as const, outcome }))
      ]);

      if (followUpResult.kind === "task") {
        return followUpResult.outcome;
      }

      const lateTaskOutcome = await this.awaitCandidateTaskGrace(taskPromise, Math.min(timeoutMs, 5_000));
      return lateTaskOutcome ?? followUpResult.outcome ?? timeoutOutcome;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async awaitCandidateTaskGrace(
    taskPromise: Promise<CandidateTaskOutcome>,
    graceMs: number
  ): Promise<CandidateTaskOutcome | null> {
    if (graceMs <= 0) {
      return null;
    }

    let graceHandle: NodeJS.Timeout | null = null;
    const gracePromise = new Promise<null>((resolve) => {
      graceHandle = setTimeout(() => resolve(null), graceMs);
    });

    try {
      return await Promise.race([taskPromise, gracePromise]);
    } finally {
      if (graceHandle) {
        clearTimeout(graceHandle);
      }
    }
  }

  private async attemptBrowserTimeoutRecovery(
    task: CandidateTask,
    run: RunEntity,
    traceId: string,
    evidenceDir: string,
    failedAttempt: SourceAttempt
  ): Promise<CandidateTaskOutcome | null> {
    const shouldTryBrowserRecovery =
      task.candidate.sourcePageType !== "lot"
      || task.source.planned.adapter.crawlStrategies.includes("rendered_dom")
      || task.source.planned.adapter.capabilities.browser_support !== "never";

    if (!shouldTryBrowserRecovery) {
      return null;
    }

    try {
      const renderedArtifacts = await this.browserClient.discoverRenderedArtifacts({
        traceId,
        sourceName: task.source.planned.adapter.id,
        url: task.candidate.url,
        runId: run.id,
        evidenceDir,
        accessContext: task.source.planned.accessContext,
        maxPages: task.candidate.sourcePageType === "listing" ? 4 : 2
      });

      failedAttempt.screenshot_path = renderedArtifacts.screenshotPaths[0] ?? null;
      failedAttempt.raw_snapshot_path = renderedArtifacts.rawSnapshotPaths[0] ?? null;
      failedAttempt.canonical_url = renderedArtifacts.finalUrl;
      failedAttempt.parser_used = "browser-timeout-recovery";
      failedAttempt.failure_class = renderedArtifacts.blockedDetected ? "waf_challenge" : undefined;
      failedAttempt.rejection_reason = renderedArtifacts.blockedDetected
        ? "Access blocked or anti-bot page detected."
        : renderedArtifacts.requiresAuthDetected
          ? gatedContentReasonForAccessMode(task.source.planned.accessContext.mode).rejectionReason
          : failedAttempt.rejection_reason;

      if (renderedArtifacts.requiresAuthDetected) {
        const gatedReason = gatedContentReasonForAccessMode(task.source.planned.accessContext.mode);
        failedAttempt.source_access_status = gatedReason.status;
        failedAttempt.failure_class = gatedReason.failureClass;
        failedAttempt.blocker_reason = gatedReason.blockerReason;
        failedAttempt.acceptance_reason = "blocked_access";
      } else if (renderedArtifacts.blockedDetected) {
        failedAttempt.source_access_status = "blocked";
        failedAttempt.blocker_reason = "Technical blocking detected.";
        failedAttempt.acceptance_reason = "blocked_access";
      } else if (failedAttempt.raw_snapshot_path) {
        try {
          const html = fs.readFileSync(failedAttempt.raw_snapshot_path, "utf-8");
          const parsed = parseGenericLotFields(html);
          const recoveredSourceStatus: SourceAccessStatus = parsed.priceHidden
            ? "price_hidden"
            : task.source.planned.accessContext.sourceAccessStatus;
          const acceptance = evaluateAcceptance(parsed, recoveredSourceStatus, {
            sourceName: failedAttempt.source_name,
            sourcePageType: task.candidate.sourcePageType,
            candidateUrl: task.candidate.url,
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
          failedAttempt.blocker_reason = acceptance.rejectionReason;
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
        } catch {
          // Best-effort browser timeout recovery.
        }
      }

      const renderedCandidates = (renderedArtifacts.discoveredUrls ?? [])
        .map((url) => toRenderedDiscoveredCandidate(url, task.candidate.url, task.source.planned.adapter.id, run.query))
        .filter((candidate): candidate is SourceCandidate => Boolean(candidate));

      const recoveredResult = { attempt: failedAttempt, record: null as PriceRecord | null };
      const recoveredRecord = failedAttempt.raw_snapshot_path && !renderedArtifacts.blockedDetected
        ? this.tryRecoverPriceFromBrowserSnapshot(task, run, recoveredResult, failedAttempt.raw_snapshot_path)
        : null;

      return {
        task,
        attempt: recoveredResult.attempt,
        acceptedRecord: recoveredRecord && recoveredResult.attempt.accepted_for_evidence ? recoveredRecord : null,
        discoveredCandidates: renderedCandidates,
        gap: renderedArtifacts.blockedDetected || renderedArtifacts.requiresAuthDetected ? undefined : `${task.source.sourceName}: recovered after transport timeout via browser render.`,
        succeeded: true
      };
    } catch {
      return null;
    }
  }

  private resolveTransportMetadata(error: unknown, candidateHost: string | null): TransportMetadata | null {
    if (!isTransportError(error)) {
      return null;
    }

    return {
      kind: error.kind,
      provider: error.provider,
      host: error.host ?? candidateHost ?? undefined,
      statusCode: error.statusCode,
      retryable: error.retryable
    };
  }

  private buildFailedAttempt(
    runId: string,
    task: CandidateTask,
    error: unknown,
    transport: TransportMetadata | null
  ): SourceAttempt {
    const failureReason = error instanceof Error ? error.message : String(error);
    const failureClass = classifyFailureClass(transport, failureReason);
    const sourceAccessStatus = sourceAccessStatusForFailure(
      failureClass,
      task.source.planned.accessContext.sourceAccessStatus
    );
    const blockerReason = transport
      ? `transport:${transport.kind}:${transport.provider}:${transport.host ?? "unknown"}${
          transport.statusCode ? `:${transport.statusCode}` : ""
        }`
      : failureReason;

    return {
      run_id: runId,
      source_name: task.source.sourceName,
      source_url: task.candidate.url,
      canonical_url: task.candidate.url,
      access_mode: task.source.planned.accessContext.mode,
      source_access_status: sourceAccessStatus,
      failure_class: failureClass,
      access_reason: task.source.planned.accessContext.accessReason ?? "Unexpected adapter failure.",
      blocker_reason: blockerReason,
      transport_kind: transport?.kind ?? null,
      transport_provider: transport?.provider ?? null,
      transport_host: transport?.host ?? null,
      transport_status_code: transport?.statusCode ?? null,
      transport_retryable: transport?.retryable ?? null,
      extracted_fields: transport
        ? {
            transport: {
              kind: transport.kind,
              provider: transport.provider,
              host: transport.host,
              statusCode: transport.statusCode ?? null,
              retryable: transport.retryable
            }
          }
        : {},
      discovery_provenance: task.candidate.provenance,
      discovery_score: task.candidate.score,
      discovered_from_url: task.candidate.discoveredFromUrl ?? null,
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: null,
      trace_path: null,
      har_path: null,
      fetched_at: new Date().toISOString(),
      parser_used: "adapter-error",
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
      rejection_reason: rejectionReasonForFailureClass(failureClass, transport?.kind),
      valuation_eligibility_reason: "Adapter execution failed."
    };
  }

  private buildHostCircuitAttempt(runId: string, task: CandidateTask): SourceAttempt {
    return {
      run_id: runId,
      source_name: task.source.sourceName,
      source_url: task.candidate.url,
      canonical_url: task.candidate.url,
      access_mode: task.source.planned.accessContext.mode,
      source_access_status: "blocked",
      failure_class: "host_circuit",
      access_reason: task.source.planned.accessContext.accessReason ?? "Source skipped due host circuit breaker.",
      blocker_reason: "target_unreachable:host_circuit_open",
      transport_kind: TransportErrorKind.UNKNOWN_NETWORK,
      transport_provider: "host_circuit",
      transport_host: task.host,
      transport_status_code: null,
      transport_retryable: false,
      extracted_fields: {
        transport: {
          kind: TransportErrorKind.UNKNOWN_NETWORK,
          provider: "host_circuit",
          host: task.host,
          statusCode: null,
          retryable: false
        }
      },
      discovery_provenance: task.candidate.provenance,
      discovery_score: task.candidate.score,
      discovered_from_url: task.candidate.discoveredFromUrl ?? null,
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: null,
      trace_path: null,
      har_path: null,
      fetched_at: new Date().toISOString(),
      parser_used: "host-circuit",
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
      rejection_reason: "Host circuit breaker open.",
      valuation_eligibility_reason: "Host marked temporarily unreachable."
    };
  }

  private async normalizeRecord(record: PriceRecord): Promise<PriceRecord> {
    const currencyNormalized = await normalizeRecordCurrencies(record, this.fxRates);
    return applyConfidenceModel(currencyNormalized, record.overall_confidence);
  }

  private valuationLaneFromPriceType(priceType: string): "realized" | "estimate" | "asking" | "none" {
    if (priceType === "estimate") return "estimate";
    if (priceType === "asking_price") return "asking";
    if (priceType === "hammer_price" || priceType === "realized_price" || priceType === "realized_with_buyers_premium") {
      return "realized";
    }
    return "none";
  }

  private tryRecoverPriceFromBrowserSnapshot(
    task: CandidateTask,
    run: RunEntity,
    result: { attempt: SourceAttempt; record: PriceRecord | null },
    rawSnapshotPath: string
  ): PriceRecord | null {
    try {
      const html = fs.readFileSync(rawSnapshotPath, "utf-8");
      const parsed = parseGenericLotFields(html);
      const nextSourceStatus: SourceAccessStatus = parsed.priceHidden
        ? "price_hidden"
        : result.attempt.source_access_status === "blocked" || result.attempt.source_access_status === "auth_required"
          ? task.source.planned.accessContext.sourceAccessStatus
          : result.attempt.source_access_status;
      result.attempt.source_access_status = nextSourceStatus;
      const hasPricingSignal =
        parsed.priceHidden ||
        parsed.priceType !== "unknown" ||
        Boolean(parsed.currency) ||
        isFiniteAmount(parsed.priceAmount) ||
        isFiniteAmount(parsed.estimateLow) ||
        isFiniteAmount(parsed.estimateHigh);

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

      let acceptance = evaluateAcceptance(parsed, nextSourceStatus, {
        sourceName: result.attempt.source_name,
        sourcePageType: result.record?.source_page_type ?? task.candidate.sourcePageType,
        candidateUrl: task.candidate.url,
        queryArtist: run.query.artist,
        queryTitle: run.query.title
      });
      if (!hasPricingSignal && looksLikeSearchUrl(task.candidate.url)) {
        acceptance = {
          acceptedForEvidence: false,
          acceptedForValuation: false,
          valuationLane: "none",
          acceptanceReason: "generic_shell_page",
          rejectionReason: "Search/listing shell page detected; retained only for discovery expansion.",
          valuationEligibilityReason: "Search shells are excluded from evidence and valuation."
        };
      }

      result.attempt.accepted = acceptance.acceptedForEvidence;
      result.attempt.accepted_for_evidence = acceptance.acceptedForEvidence;
      result.attempt.accepted_for_valuation = acceptance.acceptedForValuation;
      result.attempt.valuation_lane = acceptance.valuationLane;
      result.attempt.acceptance_reason = acceptance.acceptanceReason;
      result.attempt.rejection_reason = acceptance.rejectionReason;
      result.attempt.valuation_eligibility_reason = acceptance.valuationEligibilityReason;
      result.attempt.failure_class = undefined;
      result.attempt.blocker_reason = acceptance.rejectionReason;

      if (!hasPricingSignal) {
        return null;
      }

      const recoveredRecord = result.record ?? this.createRecoveredRecordFromSnapshot(task, run, result.attempt, parsed);
      if (!recoveredRecord) {
        return null;
      }

      if (parsed.title && (!recoveredRecord.work_title || recoveredRecord.work_title.toLowerCase() === "untitled")) {
        recoveredRecord.work_title = parsed.title;
      }
      recoveredRecord.price_type = parsed.priceType;
      recoveredRecord.price_amount = parsed.priceAmount;
      recoveredRecord.estimate_low = parsed.estimateLow;
      recoveredRecord.estimate_high = parsed.estimateHigh;
      recoveredRecord.currency = parsed.currency;
      recoveredRecord.buyers_premium_included = parsed.buyersPremiumIncluded;
      recoveredRecord.lot_number = parsed.lotNumber ?? recoveredRecord.lot_number;
      recoveredRecord.sale_or_listing_date = parsed.saleDate ?? recoveredRecord.sale_or_listing_date;
      recoveredRecord.price_hidden = parsed.priceHidden;
      recoveredRecord.raw_snapshot_path = rawSnapshotPath;
      recoveredRecord.source_access_status = nextSourceStatus;

      recoveredRecord.accepted_for_evidence = acceptance.acceptedForEvidence;
      recoveredRecord.accepted_for_valuation = acceptance.acceptedForValuation;
      recoveredRecord.valuation_lane = acceptance.valuationLane;
      recoveredRecord.acceptance_reason = acceptance.acceptanceReason;
      recoveredRecord.rejection_reason = acceptance.rejectionReason;
      recoveredRecord.valuation_eligibility_reason = acceptance.valuationEligibilityReason;
      if (acceptance.acceptedForValuation) {
        recoveredRecord.valuation_confidence = Math.max(recoveredRecord.valuation_confidence, recoveredRecord.overall_confidence, 0.6);
      } else {
        recoveredRecord.valuation_confidence = 0;
      }
      return acceptance.acceptedForEvidence ? recoveredRecord : null;
    } catch {
      // Snapshot recovery is best-effort.
      return result.record;
    }
  }

  private createRecoveredRecordFromSnapshot(
    task: CandidateTask,
    run: RunEntity,
    attempt: SourceAttempt,
    parsed: ReturnType<typeof parseGenericLotFields>
  ): PriceRecord | null {
    const hasPricingSignal =
      parsed.priceHidden ||
      parsed.priceType !== "unknown" ||
      Boolean(parsed.currency) ||
      isFiniteAmount(parsed.priceAmount) ||
      isFiniteAmount(parsed.estimateLow) ||
      isFiniteAmount(parsed.estimateHigh);

    if (!hasPricingSignal) {
      return null;
    }

    const sourceReliability = clamp(0.86 - (task.source.planned.adapter.tier - 1) * 0.16);
    const extractionConfidence = parsed.priceType === "unknown" ? 0.45 : 0.66;
    const title = parsed.title ?? run.query.title ?? null;
    const normalizedParsedTitle = (parsed.title ?? "").toLowerCase().trim();
    const normalizedQueryTitle = (run.query.title ?? "").toLowerCase().trim();
    const entityMatchConfidence = normalizedParsedTitle
      ? normalizedQueryTitle && normalizedParsedTitle === normalizedQueryTitle
        ? 0.82
        : 0.66
      : 0.48;
    const overallConfidence = clamp(extractionConfidence * 0.48 + entityMatchConfidence * 0.2 + sourceReliability * 0.32);
    const sourceStatus: SourceAccessStatus = parsed.priceHidden ? "price_hidden" : attempt.source_access_status;

    return {
      artist_name: run.query.artist,
      work_title: title,
      alternate_title: null,
      year: parsed.year,
      medium: parsed.medium,
      support: null,
      dimensions_text: parsed.dimensionsText,
      height_cm: null,
      width_cm: null,
      depth_cm: null,
      signed: null,
      dated: null,
      edition_info: null,
      is_unique_work: null,
      venue_name: task.source.planned.adapter.venueName,
      venue_type: task.source.planned.adapter.venueType,
      city: task.source.planned.adapter.city,
      country: task.source.planned.adapter.country,
      source_name: task.source.sourceName,
      source_url: attempt.canonical_url ?? attempt.source_url,
      source_page_type: task.candidate.sourcePageType,
      sale_or_listing_date: parsed.saleDate,
      lot_number: parsed.lotNumber,
      price_type: parsed.priceType,
      estimate_low: parsed.estimateLow,
      estimate_high: parsed.estimateHigh,
      price_amount: parsed.priceAmount,
      currency: parsed.currency,
      normalized_price_try: null,
      normalized_price_usd: null,
      normalized_price_usd_nominal: null,
      normalized_price_usd_2026: null,
      fx_source: null,
      fx_date_used: null,
      inflation_source: null,
      inflation_base_year: null,
      buyers_premium_included: parsed.buyersPremiumIncluded,
      image_url: null,
      screenshot_path: attempt.screenshot_path,
      raw_snapshot_path: attempt.raw_snapshot_path,
      visual_match_score: null,
      metadata_match_score: null,
      extraction_confidence: extractionConfidence,
      entity_match_confidence: entityMatchConfidence,
      source_reliability_confidence: sourceReliability,
      valuation_confidence: 0,
      overall_confidence: overallConfidence,
      accepted_for_evidence: false,
      accepted_for_valuation: false,
      valuation_lane: "none",
      acceptance_reason: "unknown_price_type",
      rejection_reason: "Recovered snapshot record awaiting acceptance evaluation.",
      valuation_eligibility_reason: "Recovered snapshot record awaiting acceptance evaluation.",
      price_hidden: parsed.priceHidden,
      source_access_status: sourceStatus,
      notes: ["Recovered from browser-rendered snapshot."]
    };
  }

  private shouldCaptureHeavyEvidence(result: { attempt: SourceAttempt; record: PriceRecord | null }): boolean {
    const mode = (process.env.EVIDENCE_TRACE_MODE ?? "selective").toLowerCase();
    if (mode === "always") {
      return true;
    }
    if (mode === "off" || mode === "none") {
      return false;
    }

    if (!(result.attempt.accepted_for_evidence ?? result.attempt.accepted)) {
      return true;
    }
    if (!result.record) {
      return true;
    }
    return result.record.overall_confidence < 0.6;
  }

  private buildSummary(
    runId: string,
    acceptedEvidenceRecords: number,
    valuationEligibleRecords: number,
    attempts: SourceAttempt[],
    valuationGenerated: boolean,
    valuationReason: string,
    discoveredCandidates: number,
    acceptedFromDiscovery: number,
    sourceCandidateBreakdown: Record<string, number>,
    persistedSourceHealth: HostHealthRecord[],
    sourcePlan: import("@artbot/shared-types").SourcePlanItem[]
  ): RunSummary {
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
    const failureClassBreakdown: Record<FailureClass, number> = {
      access_blocked: 0,
      waf_challenge: 0,
      not_found: 0,
      transport_timeout: 0,
      transport_dns: 0,
      transport_other: 0,
      host_circuit: 0
    };
    const acceptanceReasonBreakdown: Record<AcceptanceReason, number> = {
      valuation_ready: 0,
      estimate_range_ready: 0,
      asking_price_ready: 0,
      inquiry_only_evidence: 0,
      price_hidden_evidence: 0,
      entity_mismatch: 0,
      generic_shell_page: 0,
      missing_numeric_price: 0,
      missing_currency: 0,
      missing_estimate_range: 0,
      unknown_price_type: 0,
      blocked_access: 0
    };

    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
      if (attempt.failure_class && failureClassList.includes(attempt.failure_class)) {
        failureClassBreakdown[attempt.failure_class] += 1;
      }
      if (attempt.acceptance_reason && acceptanceReasonList.includes(attempt.acceptance_reason)) {
        acceptanceReasonBreakdown[attempt.acceptance_reason] += 1;
      }
    }

    const attemptedSources = new Set(attempts.map((attempt) => attempt.source_name));
    const crawledSources = new Set(
      attempts.filter((attempt) => isCrawledSourceStatus(attempt.source_access_status)).map((attempt) => attempt.source_name)
    );
    const pricedSources = new Set(
      attempts
        .filter((attempt) => isPricedAcceptanceReason(attempt.acceptance_reason))
        .map((attempt) => attempt.source_name)
    );
    const pricedSourceCoverageRatio =
      attemptedSources.size === 0 ? 0 : Number((pricedSources.size / attemptedSources.size).toFixed(4));
    const pricedCrawledSourceCoverageRatio =
      crawledSources.size === 0 ? 0 : Number((pricedSources.size / crawledSources.size).toFixed(4));

    return {
      run_id: runId,
      total_records: attempts.length,
      total_attempts: attempts.length,
      evidence_records: acceptedEvidenceRecords,
      valuation_eligible_records: valuationEligibleRecords,
      accepted_records: acceptedEvidenceRecords,
      rejected_candidates: attempts.filter((attempt) => !(attempt.accepted_for_evidence ?? attempt.accepted)).length,
      discovered_candidates: discoveredCandidates,
      accepted_from_discovery: acceptedFromDiscovery,
      priced_source_coverage_ratio: pricedSourceCoverageRatio,
      priced_crawled_source_coverage_ratio: pricedCrawledSourceCoverageRatio,
      source_candidate_breakdown: sourceCandidateBreakdown,
      source_status_breakdown: sourceStatusBreakdown,
      auth_mode_breakdown: authModeBreakdown,
      failure_class_breakdown: failureClassBreakdown,
      acceptance_reason_breakdown: acceptanceReasonBreakdown,
      evaluation_metrics: buildEvaluationMetrics({
        attempts,
        sourcePlan,
        acceptedRecords: acceptedEvidenceRecords,
        valuationEligibleRecords
      }),
      persisted_source_health: persistedSourceHealth,
      valuation_generated: valuationGenerated,
      valuation_reason: valuationReason
    };
  }
}
