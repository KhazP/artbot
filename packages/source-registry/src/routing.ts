import { AuthManager } from "@artbot/auth-manager";
import type {
  AccessContext,
  DiscoveryProviderDiagnostics,
  HostHealthRecord,
  ResearchQuery,
  SourcePlanItem,
  SourcePlanSelectionState
} from "@artbot/shared-types";
import { GenericSourceAdapter, type SourceAdapter, type SourceCandidate } from "@artbot/source-adapters";
import { buildDiscoveryConfigFromEnv, discoverWebCandidates, expandCandidatesLight } from "./discovery.js";
import { evaluateSourcePolicy } from "./source-policy.js";
import {
  buildEntrypointsForHost,
  inferSourceFamilyBucket,
  resolveFamilyPackByHost,
  type SourceFamilyPack,
  type SourceFamilyBucket
} from "./source-families.js";

export interface PlannedSource {
  adapter: SourceAdapter;
  accessContext: AccessContext;
  candidates: SourceCandidate[];
  selectionScore?: number;
  healthSkipReason?: string | null;
  healthSelectionNote?: string | null;
}

export interface SourcePlanningResult {
  plannedSources: PlannedSource[];
  discoveryDiagnostics: DiscoveryProviderDiagnostics[];
}

type HostHealthDimension = {
  source_family: string;
  crawl_lane: "deterministic" | "cheap_fetch" | "crawlee" | "browser";
  access_mode: "anonymous" | "authorized" | "licensed";
  total_attempts: number;
  success_count: number;
  blocked_count: number;
  auth_required_count: number;
  failure_count: number;
  reliability_score: number;
  last_status: HostHealthRecord["last_status"];
  last_failure_class: HostHealthRecord["last_failure_class"];
  last_attempt_at: string;
  updated_at: string;
};

type HostHealthRecordWithDimensions = HostHealthRecord & {
  dimensions?: Record<string, HostHealthDimension>;
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHealthHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function isLikelyTurkeyHost(host: string): boolean {
  return host.endsWith(".tr") || host.includes("muzayede") || host.includes("sanat");
}

function discoveredUrlLooksLikeRoutablePage(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /(\/lot\/|\/lots\/|\/auction\/lot|\/auction-lot\/|\/item\/\d+|\/lot-|\/products\/|\/urun\/|\/artist\/|\/artists\/)/.test(lower)
    || /(\/archive|\/catalog|\/arsiv|\/search|\/arama|\/results?)/.test(lower)
    || /\/[a-z0-9-]+\d+\.html(?:\?.*)?$/i.test(lower)
  );
}

function inferDynamicSourcePageType(url: string): SourceCandidate["sourcePageType"] {
  const lower = url.toLowerCase();
  if (discoveredUrlLooksLikeRoutablePage(url)) {
    if (/(\/artist\/|\/artists\/)/.test(lower)) {
      return "artist_page";
    }
    if (/(\/archive|\/catalog|\/arsiv|\/search|\/arama|\/results?)/.test(lower)) {
      return "listing";
    }
    return "lot";
  }
  if (/(\/archive|\/catalog|\/arsiv|\/search|\/arama|\/results?)/.test(lower)) {
    return "listing";
  }
  return "other";
}

function inferSearchPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const preferredKeys = ["search_words", "query", "entry", "keyword", "q", "term", "search", "s"];
    for (const key of preferredKeys) {
      if (parsed.searchParams.has(key)) {
        return `${parsed.pathname}?${key}=`;
      }
    }
  } catch {
    // Ignore malformed URLs.
  }
  return null;
}

function inferSearchPathFromPack(pack: SourceFamilyPack | null): string | null {
  if (!pack) {
    return null;
  }
  for (const path of pack.verified_search_paths ?? []) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (/[?&](?:q|query|entry|keyword|term|search|s|search_words)=/i.test(normalized)) {
      return normalized.replace(/([?&](?:q|query|entry|keyword|term|search|s|search_words)=).*/i, "$1");
    }
  }
  return null;
}

function buildHostFingerprintAdapter(input: {
  host: string;
  discoveredUrl: string;
  sourceHints?: string[];
  seedCandidates?: SourceCandidate[];
}): SourceAdapter {
  const familyPack = resolveFamilyPackByHost(input.host);
  const sourcePageType = inferDynamicSourcePageType(input.discoveredUrl);
  const verifiedSearchPath = inferSearchPathFromPack(familyPack);
  const allowUnverifiedSearchSeeds = process.env.ALLOW_UNVERIFIED_SEARCH_SEEDS === "true";
  const inferredUnverifiedSearchPath = inferSearchPathFromUrl(input.discoveredUrl);
  const searchPath = verifiedSearchPath ?? (allowUnverifiedSearchSeeds ? inferredUnverifiedSearchPath : null);
  const supportsSearch = Boolean(searchPath);
  const sourceFamily = familyPack?.id ?? `open-web-${input.host.replace(/[^a-z0-9]+/gi, "-")}`;
  const crawlStrategies = [
    supportsSearch ? "search" : null,
    sourcePageType === "lot" ? null : "listing_to_lot",
    familyPack?.entry_paths.some((entryPath) => /(sitemap|robots)/i.test(entryPath)) ? "sitemap" : null,
    familyPack?.entry_paths.some((entryPath) => /(archive|catalog|arsiv|artists?)/i.test(entryPath)) ? "archive_index" : null,
    "rendered_dom"
  ].filter((value): value is SourceAdapter["crawlStrategies"][number] => value !== null);
  const seedCandidates = (input.seedCandidates ?? []).slice(0, 32);
  const baseAdapter = new GenericSourceAdapter({
    id: `host-fingerprint-${input.host.replace(/[^a-z0-9]+/gi, "-")}`,
    sourceName: `Web Discovery (${input.host})`,
    venueName: input.host,
    venueType: "other",
    sourcePageType: sourcePageType === "other" ? "listing" : sourcePageType,
    tier: 4,
    country: isLikelyTurkeyHost(input.host) ? "Turkey" : null,
    city: null,
    baseUrl: `https://${input.host}`,
    searchPath: searchPath ?? "/",
    crawlStrategies,
    capabilities: {
      version: "1",
      source_family: sourceFamily,
      access_modes: ["anonymous", "authorized", "licensed"],
      browser_support: "optional",
      sale_modes: ["realized", "estimate", "asking", "unknown"],
      evidence_requirements: ["raw_snapshot", "screenshot"],
      structured_data_likelihood: sourcePageType === "lot" || sourcePageType === "artist_page" ? "medium" : "low",
      preferred_discovery: "web_discovery"
    }
  });

  return {
    ...baseAdapter,
    discoverCandidates: async () => {
      if (seedCandidates.length > 0) {
        return seedCandidates;
      }
      return buildEntrypointsForHost(input.host, input.discoveredUrl, supportsSearch).map((url) => ({
        url,
        sourcePageType: inferDynamicSourcePageType(url),
        provenance: "signature_expansion",
        score: 0.56,
        discoveredFromUrl: input.discoveredUrl
      }));
    },
    extract: (candidate, context) => baseAdapter.extract(candidate, context)
  };
}

function isTurkeySource(adapter: SourceAdapter): boolean {
  return adapter.country?.toLowerCase() === "turkey";
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

function urlReferencesQueryEntity(url: string, query: ResearchQuery): boolean {
  const haystack = url
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ");
  const titleTokens = normalizeEntityTokens(query.title);
  if (titleTokens.length > 0 && titleTokens.every((token) => haystack.includes(token))) {
    return true;
  }

  const artistTokens = normalizeEntityTokens(query.artist);
  return artistTokens.length > 0 && artistTokens.every((token) => haystack.includes(token));
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

function familyPriority(adapter: SourceAdapter): number {
  const family = adapter.capabilities.source_family.toLowerCase();
  if (family.includes("sanatfiyat")) return 0;
  if (family.includes("muzayedeapp")) return 1;
  if (family.includes("portakal")) return 2;
  if (family.includes("artam")) return 3;
  if (family.includes("clar")) return 4;
  if (family.includes("bayrak")) return 5;
  if (family.includes("antikasa")) return 6;
  if (family.includes("turel")) return 7;
  if (family.includes("alifart")) return 8;
  if (family.includes("liveauctioneers")) return 9;
  if (family.includes("invaluable")) return 10;
  if (family.includes("sothebys")) return 11;
  if (family.includes("christies")) return 12;
  if (family.includes("phillips")) return 13;
  if (family.includes("bonhams")) return 14;
  return 15;
}

function buildHostHealthIndex(hostHealth: HostHealthRecord[]): Map<string, HostHealthRecord[]> {
  const index = new Map<string, HostHealthRecord[]>();
  for (const entry of hostHealth) {
    const key = normalizeHealthHost(entry.host);
    const list = index.get(key) ?? [];
    list.push(entry);
    index.set(key, list);
  }
  return index;
}

function hostsForPlannedSource(adapter: SourceAdapter, candidates: SourceCandidate[]): string[] {
  const hosts = new Set<string>();
  for (const candidate of candidates) {
    const candidateHost = hostFromUrl(candidate.url);
    if (candidateHost) {
      hosts.add(normalizeHealthHost(candidateHost));
    }
  }
  return [...hosts];
}

function normalizeFamilyHealthKey(value: string): string {
  return value.toLowerCase().replace(/^(?:open-web|dynamic-web|host-fingerprint)-/, "");
}

function sourceFamiliesLikelyMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeFamilyHealthKey(left);
  const normalizedRight = normalizeFamilyHealthKey(right);
  return (
    normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
  );
}

function applyLaneAwareHealthScope(
  record: HostHealthRecord,
  adapter: SourceAdapter,
  accessMode: PlannedSource["accessContext"]["mode"]
): HostHealthRecord {
  const laneAwareRecord = record as HostHealthRecordWithDimensions;
  const dimensions = Object.values(laneAwareRecord.dimensions ?? {}).filter(
    (dimension) =>
      sourceFamiliesLikelyMatch(dimension.source_family, adapter.capabilities.source_family)
      && dimension.access_mode === accessMode
  );
  if (dimensions.length === 0) {
    return record;
  }
  const successfulDimensions = dimensions
    .filter((dimension) => dimension.success_count > 0)
    .sort((left, right) => {
      const reliabilityDelta = right.reliability_score - left.reliability_score;
      if (reliabilityDelta !== 0) {
        return reliabilityDelta;
      }
      const successDelta = right.success_count - left.success_count;
      if (successDelta !== 0) {
        return successDelta;
      }
      return right.updated_at.localeCompare(left.updated_at);
    });
  const primaryDimension = successfulDimensions[0]
    ?? [...dimensions].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
    ?? null;
  if (!primaryDimension) {
    return record;
  }

  return {
    ...record,
    total_attempts: primaryDimension.total_attempts,
    success_count: primaryDimension.success_count,
    blocked_count: primaryDimension.blocked_count,
    auth_required_count: primaryDimension.auth_required_count,
    failure_count: primaryDimension.failure_count,
    consecutive_failures:
      primaryDimension.success_count > 0
        ? 0
        : Math.min(record.consecutive_failures, Math.max(1, primaryDimension.total_attempts)),
    reliability_score: Number(primaryDimension.reliability_score.toFixed(4)),
    last_status: primaryDimension.last_status ?? record.last_status,
    last_failure_class: primaryDimension.last_failure_class ?? record.last_failure_class,
    last_attempt_at: primaryDimension.last_attempt_at ?? record.last_attempt_at,
    updated_at: primaryDimension.updated_at ?? record.updated_at
  };
}

function selectRelevantHostHealth(
  adapter: SourceAdapter,
  candidates: SourceCandidate[],
  hostHealthIndex: Map<string, HostHealthRecord[]>,
  accessMode: PlannedSource["accessContext"]["mode"]
): HostHealthRecord | null {
  const matches = hostsForPlannedSource(adapter, candidates)
    .flatMap((host) => hostHealthIndex.get(host) ?? [])
    .map((record) => applyLaneAwareHealthScope(record, adapter, accessMode))
    .sort((left, right) => right.total_attempts - left.total_attempts);

  return matches[0] ?? null;
}

function buildHostAdapterIndex(planned: PlannedSource[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const source of planned) {
    for (const host of hostsForPlannedSource(source.adapter, source.candidates)) {
      const adapters = index.get(host) ?? new Set<string>();
      adapters.add(source.adapter.id);
      index.set(host, adapters);
    }
  }
  return index;
}

function evaluateSourceHealthDecision(
  adapter: SourceAdapter,
  candidates: SourceCandidate[],
  hostHealthIndex: Map<string, HostHealthRecord[]>,
  hostAdapterIndex: Map<string, Set<string>>,
  accessMode: PlannedSource["accessContext"]["mode"],
  analysisMode: ResearchQuery["analysisMode"]
): { skipReason: string | null; scoreAdjustment: number; note: string | null } {
  const candidateHosts = hostsForPlannedSource(adapter, candidates);
  const hasSharedHost = candidateHosts.some((host) => (hostAdapterIndex.get(host)?.size ?? 0) > 1);

  const record = selectRelevantHostHealth(adapter, candidates, hostHealthIndex, accessMode);
  if (!record) {
    return { skipReason: null, scoreAdjustment: 0, note: null };
  }
  const allowHardSkip = analysisMode !== "comprehensive";
  const asDecision = (
    skipReason: string,
    scoreAdjustment: number,
    note: string,
    fallbackPenalty = -80
  ): { skipReason: string | null; scoreAdjustment: number; note: string | null } => {
    if (allowHardSkip) {
      return { skipReason, scoreAdjustment, note };
    }
    const deprioritizedNote = note.replace(/^Skipped because\s+/i, "Deprioritized because ");
    const sharedHostNote = hasSharedHost
      ? " Shared host with multiple adapters; comprehensive mode keeps this host eligible behind healthier families."
      : " Comprehensive mode keeps this host eligible behind healthier families.";
    return {
      skipReason: null,
      scoreAdjustment: Math.min(scoreAdjustment, fallbackPenalty),
      note: `${deprioritizedNote}${sharedHostNote}`
    };
  };

  const family = adapter.capabilities.source_family.toLowerCase();
  const publicOnlySource = !adapter.requiresAuth && !adapter.requiresLicense;

  if (
    publicOnlySource
    && record.total_attempts >= 10
    && record.success_count === 0
    && record.last_failure_class === "not_found"
  ) {
    return asDecision(
      `Persisted host health for ${record.host} shows ${record.total_attempts} attempts with no successful records and repeated not-found failures.`,
      -120,
      `Skipped because ${record.host} has repeated not-found failures across runs.`,
      -95
    );
  }

  if (
    publicOnlySource
    && record.total_attempts >= 8
    && record.success_count === 0
    && record.reliability_score === 0
    && (
      record.last_failure_class === "transport_dns"
      || record.last_failure_class === "transport_timeout"
      || record.last_failure_class === "host_circuit"
    )
  ) {
    return asDecision(
      `Persisted host health for ${record.host} shows ${record.total_attempts} attempts with zero successful records and repeated transport-level failures.`,
      -110,
      `Skipped because ${record.host} has repeated transport failures with no successful records across recent runs.`,
      -90
    );
  }

  if (
    adapter.id === "clar-archive"
    && record.total_attempts >= 20
    && (record.blocked_count >= 8 || record.last_failure_class === "waf_challenge")
    && record.reliability_score < 0.1
  ) {
    return asDecision(
      `Persisted host health for ${record.host} shows Clar archive pages are heavily blocked and rarely produce usable records.`,
      -90,
      "Skipped because Clar archive has persistent blocking with very low usable yield.",
      -105
    );
  }

  if (
    publicOnlySource
    && !family.includes("sanatfiyat")
    && record.total_attempts >= 16
    && record.success_count === 0
    && record.reliability_score === 0
  ) {
    return asDecision(
      `Persisted host health for ${record.host} shows ${record.total_attempts} attempts with zero successful records.`,
      -100,
      `Skipped because ${record.host} has produced no successful records across recent runs.`,
      -85
    );
  }

  let scoreAdjustment = 0;
  let note: string | null = null;

  if (record.total_attempts >= 8 && record.reliability_score < 0.05) {
    scoreAdjustment -= 45;
    note = `${record.host} is heavily degraded (${Math.round(record.reliability_score * 100)}% reliability across ${record.total_attempts} attempts).`;
  } else if (record.total_attempts >= 6 && record.reliability_score < 0.2) {
    scoreAdjustment -= 20;
    note = `${record.host} is degraded (${Math.round(record.reliability_score * 100)}% reliability across ${record.total_attempts} attempts).`;
  }

  if (record.auth_required_count >= 5 && record.auth_required_count >= Math.max(3, Math.floor(record.total_attempts * 0.5))) {
    scoreAdjustment -= 24;
    note = `${record.host} frequently returns auth-gated pages (${record.auth_required_count}/${record.total_attempts} attempts).`;
  }

  if (record.blocked_count >= 4 || record.last_failure_class === "waf_challenge") {
    scoreAdjustment -= 16;
    note = `${record.host} is trending toward technical blocking and should be deprioritized.`;
  }

  return { skipReason: null, scoreAdjustment, note };
}

function applyPersistedHealthSignals(
  planned: PlannedSource[],
  hostHealthIndex: Map<string, HostHealthRecord[]>,
  analysisMode: ResearchQuery["analysisMode"]
): PlannedSource[] {
  const hostAdapterIndex = buildHostAdapterIndex(planned);
  return planned.map((entry) => {
    const healthDecision = evaluateSourceHealthDecision(
      entry.adapter,
      entry.candidates,
      hostHealthIndex,
      hostAdapterIndex,
      entry.accessContext.mode,
      analysisMode
    );

    return {
      ...entry,
      selectionScore: healthDecision.scoreAdjustment,
      healthSkipReason: healthDecision.skipReason,
      healthSelectionNote: healthDecision.note
    };
  });
}

function sortSources(query: ResearchQuery, adapters: SourceAdapter[]): SourceAdapter[] {
  const filtered =
    query.scope === "turkey_only" ? adapters.filter((adapter) => isTurkeySource(adapter)) : [...adapters];

  return filtered.sort((a, b) => {
    if (query.turkeyFirst) {
      const aTurkey = isTurkeySource(a) ? 0 : 1;
      const bTurkey = isTurkeySource(b) ? 0 : 1;
      if (aTurkey !== bTurkey) return aTurkey - bTurkey;
    }
    const aFamily = familyPriority(a);
    const bFamily = familyPriority(b);
    if (aFamily !== bFamily) return aFamily - bFamily;
    return a.tier - b.tier;
  });
}

interface FamilyQuotaProfile {
  selectionBudget: number;
  minimums: Partial<Record<SourceFamilyBucket, number>>;
}

function familyQuotaProfile(analysisMode: ResearchQuery["analysisMode"]): FamilyQuotaProfile {
  if (analysisMode === "fast") {
    return {
      selectionBudget: 4,
      minimums: {
        turkey_first_party: 1,
        turkey_platform: 1,
        global_major: 1,
        global_marketplace: 1
      }
    };
  }
  if (analysisMode === "balanced") {
    return {
      selectionBudget: 8,
      minimums: {
        turkey_first_party: 2,
        turkey_platform: 1,
        global_major: 1,
        global_marketplace: 1,
        db_meta: 1
      }
    };
  }
  return {
    selectionBudget: 14,
    minimums: {
      turkey_first_party: 3,
      turkey_platform: 2,
      global_major: 2,
      global_marketplace: 2,
      global_direct_sale: 1,
      db_meta: 1
    }
  };
}

function familyBucketForPlannedSource(planned: PlannedSource): SourceFamilyBucket {
  const hosts = planned.candidates
    .map((candidate) => hostFromUrl(candidate.url))
    .filter((host): host is string => Boolean(host));
  return inferSourceFamilyBucket({
    sourceFamily: planned.adapter.capabilities.source_family,
    sourceName: planned.adapter.sourceName,
    hosts
  });
}

function accessStatusPriority(status: PlannedSource["accessContext"]["sourceAccessStatus"]): number {
  if (status === "public_access" || status === "licensed_access" || status === "price_hidden") return 0;
  if (status === "auth_required") return 1;
  return 2;
}

function hasRunnableAuthPath(planned: PlannedSource): boolean {
  if (planned.accessContext.sourceAccessStatus !== "auth_required") {
    return true;
  }

  // Auth-gated sources are runnable when we can authenticate via profile, cookies, or manual checkpoint.
  return (
    planned.accessContext.mode !== "anonymous"
    || Boolean(planned.accessContext.profileId)
    || Boolean(planned.accessContext.cookieFile)
    || Boolean(planned.accessContext.manualLoginCheckpoint)
  );
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

function reorderCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((left, right) => {
    const priorityDelta = candidatePriority(left) - candidatePriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return right.score - left.score;
  });
}

function candidateSelectionScore(planned: PlannedSource, query: ResearchQuery): number {
  const nonQueryVariantCandidates = planned.candidates.filter((candidate) => candidate.provenance !== "query_variant");
  const lotCandidates = nonQueryVariantCandidates.filter(
    (candidate) => candidate.sourcePageType === "lot" && !looksLikeSearchUrl(candidate.url)
  );
  const entityCandidates = nonQueryVariantCandidates.filter(
    (candidate) => !looksLikeSearchUrl(candidate.url) && urlReferencesQueryEntity(candidate.url, query)
  );
  const lotEntityCandidates = lotCandidates.filter((candidate) => urlReferencesQueryEntity(candidate.url, query));
  const queryVariantCandidates = planned.candidates.filter((candidate) => candidate.provenance === "query_variant");
  const webDiscoveryCandidates = planned.candidates.filter((candidate) => candidate.provenance === "web_discovery");
  const family = planned.adapter.capabilities.source_family.toLowerCase();

  let score = 0;
  score += lotEntityCandidates.length * 50;
  score += lotCandidates.length * 12;
  score += entityCandidates.length * 8;
  score += Math.min(nonQueryVariantCandidates.length, 12) * 2;
  score += webDiscoveryCandidates.length * 2;
  score -= Math.min(queryVariantCandidates.length, 6) * 2;

  if (query.turkeyFirst && isTurkeySource(planned.adapter)) {
    score += 10;
  }

  if (
    family.includes("muzayedeapp")
    || family.includes("portakal")
    || family.includes("clar")
    || family.includes("sanatfiyat")
  ) {
    score += 14;
  }

  if (query.scope !== "turkey_only" && (family.includes("liveauctioneers") || family.includes("invaluable"))) {
    score += 16;
  }

  if (
    query.scope !== "turkey_only"
    && (family.includes("sothebys") || family.includes("christies") || family.includes("bonhams") || family.includes("phillips"))
  ) {
    score += 8;
  }

  if (
    family.includes("bayrak")
    || family.includes("antikasa")
    || family.includes("turel")
    || family.includes("alifart")
  ) {
    score -= 6;
  }

  if (planned.adapter.tier <= 2) {
    score += 4;
  }

  return score;
}

function reorderPlannedSourcesForSelection(query: ResearchQuery, planned: PlannedSource[]): PlannedSource[] {
  return planned
    .map((entry) => ({
      ...entry,
      selectionScore: candidateSelectionScore(entry, query) + (entry.selectionScore ?? 0)
    }))
    .sort((left, right) => {
    const accessDelta =
      accessStatusPriority(left.accessContext.sourceAccessStatus) - accessStatusPriority(right.accessContext.sourceAccessStatus);
    if (accessDelta !== 0) {
      return accessDelta;
    }

    const scoreDelta = (right.selectionScore ?? 0) - (left.selectionScore ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const familyDelta = familyPriority(left.adapter) - familyPriority(right.adapter);
    if (familyDelta !== 0) {
      return familyDelta;
    }

    return left.adapter.tier - right.adapter.tier;
    });
}

function selectionReasonForState(
  planned: PlannedSource,
  state: SourcePlanSelectionState,
  candidateCount: number,
  skipReason: string | null
): string | null {
  if (planned.healthSelectionNote) {
    return planned.healthSelectionNote;
  }
  if (state === "blocked") {
    return skipReason ?? "This source is blocked by current policy or access mode.";
  }
  if (state === "skipped") {
    return skipReason ?? "No runnable candidates were available for this source.";
  }

  const family = planned.adapter.capabilities.source_family.toLowerCase();
  if (state === "deprioritized") {
    return `Queued behind higher-priority source families for ${planned.adapter.sourceName}.`;
  }
  if (family.includes("muzayedeapp") || family.includes("muzayede")) {
    return "Selected because Müzayede App family coverage is prioritized.";
  }
  if (family.includes("sanatfiyat")) {
    return "Selected because Sanatfiyat remains a first-class Turkish price source.";
  }
  if (family.includes("invaluable") || family.includes("liveauctioneers")) {
    return "Selected because this marketplace family is the preferred international expansion lane.";
  }
  if (planned.adapter.tier <= 2) {
    return "Selected because this source is in the high-trust operating tier.";
  }
  if (candidateCount > 0) {
    return "Selected because this source produced runnable candidates.";
  }
  return null;
}

export function buildSourcePlanItems(
  plannedSources: PlannedSource[],
  candidateCap: number,
  analysisMode: ResearchQuery["analysisMode"] = "balanced"
): SourcePlanItem[] {
  const quotaProfile = familyQuotaProfile(analysisMode);
  const selectionBudget = quotaProfile.selectionBudget;
  let selectedCount = 0;
  const bucketSelections = new Map<SourceFamilyBucket, number>();
  const availableByBucket = plannedSources.reduce<Map<SourceFamilyBucket, number>>((acc, planned) => {
    const isRoutable =
      planned.accessContext.sourceAccessStatus !== "blocked"
      && !planned.healthSkipReason
      && hasRunnableAuthPath(planned)
      && planned.candidates.length > 0;
    if (!isRoutable) {
      return acc;
    }
    const bucket = familyBucketForPlannedSource(planned);
    acc.set(bucket, (acc.get(bucket) ?? 0) + 1);
    return acc;
  }, new Map<SourceFamilyBucket, number>());

  return plannedSources.map((planned, index) => {
    const bucket = familyBucketForPlannedSource(planned);
    const skipReason =
      planned.healthSkipReason
      ?? planned.accessContext.blockerReason
      ?? (planned.accessContext.sourceAccessStatus === "auth_required"
        ? planned.accessContext.accessReason ?? "Authorized session required."
        : planned.candidates.length === 0
          ? "No candidates discovered for this source."
          : null);

    const isRoutable =
      planned.accessContext.sourceAccessStatus !== "blocked"
      && !planned.healthSkipReason
      && hasRunnableAuthPath(planned)
      && planned.candidates.length > 0;
    const authUnavailable =
      planned.accessContext.sourceAccessStatus === "auth_required"
      && !hasRunnableAuthPath(planned);

    let selectionState: SourcePlanSelectionState;
    if (planned.accessContext.sourceAccessStatus === "blocked") {
      selectionState = "blocked";
    } else if (planned.healthSkipReason) {
      selectionState = "skipped";
    } else if (authUnavailable || planned.candidates.length === 0) {
      selectionState = "skipped";
    } else if (!isRoutable || selectedCount >= selectionBudget) {
      selectionState = "deprioritized";
    } else {
      const minRequired = quotaProfile.minimums[bucket] ?? 0;
      const effectiveMinRequired = Math.min(minRequired, availableByBucket.get(bucket) ?? 0);
      const currentBucketSelected = bucketSelections.get(bucket) ?? 0;
      const remainingSlots = selectionBudget - selectedCount;
      const requiredOutstanding = Object.entries(quotaProfile.minimums).reduce((sum, [bucketKey, minimum]) => {
        const castBucket = bucketKey as SourceFamilyBucket;
        const available = availableByBucket.get(castBucket) ?? 0;
        if (available === 0) {
          return sum;
        }
        const selected = bucketSelections.get(castBucket) ?? 0;
        const effectiveMinimum = Math.min(minimum ?? 0, available);
        return sum + Math.max(0, effectiveMinimum - selected);
      }, 0);
      const currentBucketStillRequired = currentBucketSelected < effectiveMinRequired;
      const wouldBreakMinimumCoverage =
        !currentBucketStillRequired && remainingSlots - 1 < requiredOutstanding;

      if (wouldBreakMinimumCoverage) {
        selectionState = "deprioritized";
      } else {
        selectionState = "selected";
        selectedCount += 1;
        bucketSelections.set(bucket, currentBucketSelected + 1);
      }
    }

    return {
      adapter_id: planned.adapter.id,
      source_name: planned.adapter.sourceName,
      venue_name: planned.adapter.venueName,
      source_family: planned.adapter.capabilities.source_family,
      access_mode: planned.accessContext.mode,
      source_access_status: planned.accessContext.sourceAccessStatus,
      candidate_count: planned.candidates.length,
      candidate_cap: candidateCap,
      status:
        selectionState === "blocked" ? "blocked" : selectionState === "skipped" ? "skipped" : "planned",
      selection_state: selectionState,
      selection_reason: selectionReasonForState(planned, selectionState, planned.candidates.length, skipReason),
      priority_rank: index + 1,
      skip_reason: skipReason,
      legal_posture: planned.accessContext.legalPosture,
      capability_version: planned.adapter.capabilities.version,
      capabilities: planned.adapter.capabilities
    };
  });
}

function applyPreferredDiscoveryProviders(query: ResearchQuery, config: ReturnType<typeof buildDiscoveryConfigFromEnv>) {
  if (!query.preferredDiscoveryProviders || query.preferredDiscoveryProviders.length === 0) {
    return config;
  }

  const [primary, secondary] = query.preferredDiscoveryProviders;
  const resolveKey = (provider: typeof primary | undefined) =>
    provider === "brave"
      ? process.env.BRAVE_SEARCH_API_KEY?.trim()
      : provider === "tavily"
        ? process.env.TAVILY_API_KEY?.trim()
        : undefined;
  const webDiscoveryApiKey = resolveKey(primary);

  return {
    ...config,
    webDiscoveryProvider: primary,
    webDiscoverySecondaryProvider: secondary,
    webDiscoveryApiKey,
    webDiscoverySecondaryApiKey: resolveKey(secondary),
    webDiscoveryEnabled: primary !== "none"
  };
}

export async function planSourcesWithDiagnostics(
  query: ResearchQuery,
  adapters: SourceAdapter[],
  authManager: AuthManager,
  hostHealth: HostHealthRecord[] = []
): Promise<SourcePlanningResult> {
  const discoveryConfig = applyPreferredDiscoveryProviders(query, buildDiscoveryConfigFromEnv(query.analysisMode));
  const sorted = sortSources(query, adapters);
  const planned: PlannedSource[] = [];
  const hostHealthIndex = buildHostHealthIndex(hostHealth);
  const finalize = (plannedSources: PlannedSource[]): SourcePlanningResult => ({
    plannedSources,
    discoveryDiagnostics: discoveryConfig.webDiscoveryDiagnostics ?? []
  });

  for (const adapter of sorted) {
    const sourcePolicyDecision = evaluateSourcePolicy(adapter, query);
    const customAuthProfileId = (adapter as SourceAdapter & { customAuthProfileId?: string }).customAuthProfileId;
    const accessContext = authManager.resolveAccess({
      sourceName: adapter.sourceName,
      sourceUrl: adapter.id,
      sourceRequiresAuth: adapter.requiresAuth,
      sourceRequiresLicense: adapter.requiresLicense,
      requestedProfileId: query.authProfileId ?? customAuthProfileId,
      allowLicensed: query.allowLicensed,
      manualLoginCheckpoint: query.manualLoginCheckpoint,
      cookieFile: query.cookieFile,
      licensedIntegrations: query.licensedIntegrations,
      legalPosture: sourcePolicyDecision.legalPosture
    });

    if (!sourcePolicyDecision.allowed) {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source policy blocked this adapter.";
      accessContext.blockerReason = sourcePolicyDecision.reason;
    }

    if (!adapter.supportedAccessModes.includes(accessContext.mode) && accessContext.sourceAccessStatus !== "blocked") {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source does not support selected access mode.";
      accessContext.blockerReason = `Access mode ${accessContext.mode} is unsupported for adapter ${adapter.id}.`;
    }

    const rawCandidates = await adapter.discoverCandidates(query);
    const normalizedSeeds: SourceCandidate[] = rawCandidates.map((candidate) => ({
      ...candidate,
      provenance: candidate.provenance ?? "seed",
      score: candidate.score ?? 0.8,
      discoveredFromUrl: candidate.discoveredFromUrl ?? null
    }));

    const candidates = reorderCandidates(expandCandidatesLight(normalizedSeeds, query, discoveryConfig));
    planned.push({
      adapter,
      accessContext,
      candidates,
      selectionScore: 0,
      healthSkipReason: null,
      healthSelectionNote: null
    });
  }

  const webCandidates = await discoverWebCandidates(query, discoveryConfig);
  if (webCandidates.length === 0) {
    return finalize(
      reorderPlannedSourcesForSelection(query, applyPersistedHealthSignals(planned, hostHealthIndex, query.analysisMode))
    );
  }

  const hostToPlanned = new Map<string, PlannedSource>();
  for (const source of planned) {
    for (const candidate of source.candidates) {
      const host = hostFromUrl(candidate.url);
      if (host && !hostToPlanned.has(host)) {
        hostToPlanned.set(host, source);
      }
    }
  }

  const dynamicByHost = new Map<string, SourceCandidate[]>();
  for (const candidate of webCandidates) {
    const host = hostFromUrl(candidate.url);
    if (!host) continue;

    const existingSource = hostToPlanned.get(host);
    if (existingSource) {
      if (existingSource.candidates.some((existing) => existing.url === candidate.url)) {
        continue;
      }
      if (existingSource.candidates.length >= discoveryConfig.maxCandidatesPerSource) {
        continue;
      }
      existingSource.candidates.push(candidate);
      existingSource.candidates = reorderCandidates(existingSource.candidates);
      continue;
    }

    if (query.scope === "turkey_only" && !isLikelyTurkeyHost(host)) {
      continue;
    }

    const list = dynamicByHost.get(host) ?? [];
    if (list.some((existing) => existing.url === candidate.url)) {
      continue;
    }
    list.push(candidate);
    dynamicByHost.set(host, list);
  }

  for (const [host, candidates] of dynamicByHost) {
    const representative = candidates[0]?.url ?? `https://${host}/`;
    const familyPack = resolveFamilyPackByHost(host);
    const seededFromDiscovery = candidates
      .filter((candidate) => discoveredUrlLooksLikeRoutablePage(candidate.url))
      .map((candidate) => ({
        ...candidate,
        sourcePageType: inferDynamicSourcePageType(candidate.url)
      }));
    const fallbackEntrypoints = buildEntrypointsForHost(
      host,
      representative,
      Boolean(familyPack?.verified_search_paths?.length)
    ).map((url) => ({
      url,
      sourcePageType: inferDynamicSourcePageType(url),
      provenance: "signature_expansion" as const,
      score: 0.56,
      discoveredFromUrl: representative
    }));
    const dynamicCandidates = seededFromDiscovery.length > 0 ? seededFromDiscovery : fallbackEntrypoints;
    const dedupedDynamicCandidates: SourceCandidate[] = [];
    const seenUrls = new Set<string>();
    for (const candidate of dynamicCandidates) {
      if (seenUrls.has(candidate.url)) {
        continue;
      }
      seenUrls.add(candidate.url);
      dedupedDynamicCandidates.push(candidate);
    }
    const adapter = buildHostFingerprintAdapter({
      host,
      discoveredUrl: representative,
      sourceHints: familyPack?.query_lexicon,
      seedCandidates: dedupedDynamicCandidates
    });
    const sourcePolicyDecision = evaluateSourcePolicy(adapter, query);
    const accessContext = authManager.resolveAccess({
      sourceName: adapter.sourceName,
      sourceUrl: `https://${host}`,
      sourceRequiresAuth: adapter.requiresAuth,
      sourceRequiresLicense: adapter.requiresLicense,
      requestedProfileId: query.authProfileId,
      allowLicensed: query.allowLicensed,
      manualLoginCheckpoint: query.manualLoginCheckpoint,
      cookieFile: query.cookieFile,
      licensedIntegrations: query.licensedIntegrations,
      legalPosture: sourcePolicyDecision.legalPosture
    });

    if (!sourcePolicyDecision.allowed) {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source policy blocked this dynamic adapter.";
      accessContext.blockerReason = sourcePolicyDecision.reason;
    }

    planned.push({
      adapter,
      accessContext,
      candidates: reorderCandidates(dedupedDynamicCandidates.slice(0, discoveryConfig.maxUrlsPerDiscoveredDomain)),
      selectionScore: 0,
      healthSkipReason: null,
      healthSelectionNote: null
    });
  }

  const plannedWithHealth = applyPersistedHealthSignals(planned, hostHealthIndex, query.analysisMode);

  const totalCandidates = plannedWithHealth.reduce((sum, source) => sum + source.candidates.length, 0);
  if (totalCandidates > discoveryConfig.maxTotalCandidatesPerRun) {
    for (const source of plannedWithHealth) {
      source.candidates = reorderCandidates(source.candidates);
    }
    const trimmed = plannedWithHealth.map((source) => ({
      ...source,
      candidates: [] as SourceCandidate[]
    }));
    let remainingBudget = discoveryConfig.maxTotalCandidatesPerRun;
    let cursor = 0;
    while (remainingBudget > 0) {
      const source = plannedWithHealth[cursor % plannedWithHealth.length];
      const slot = trimmed[cursor % trimmed.length];
      const nextCandidate = source.candidates.shift();
      if (nextCandidate) {
        slot.candidates.push(nextCandidate);
        remainingBudget -= 1;
      }
      cursor += 1;
      if (plannedWithHealth.every((entry) => entry.candidates.length === 0)) {
        break;
      }
    }
    return finalize(reorderPlannedSourcesForSelection(query, trimmed.filter((source) => source.candidates.length > 0)));
  }

  return finalize(reorderPlannedSourcesForSelection(query, plannedWithHealth));
}

export async function planSources(
  query: ResearchQuery,
  adapters: SourceAdapter[],
  authManager: AuthManager,
  hostHealth: HostHealthRecord[] = []
): Promise<PlannedSource[]> {
  return (await planSourcesWithDiagnostics(query, adapters, authManager, hostHealth)).plannedSources;
}
