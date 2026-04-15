import fs from "node:fs";
import path from "node:path";
import type {
  AcceptanceReason,
  AttemptAcceptanceDetails,
  PriceRecord,
  SourceAccessStatus,
  SourceAttempt,
  ValuationLane
} from "@artbot/shared-types";
import type { GenericParsedFields } from "@artbot/extraction";
import type {
  AdapterExtractionContext,
  AdapterExtractionResult,
  AdapterStatusDecision,
  DiscoveryProvenance,
  SourceAdapter,
  SourceCandidate
} from "../types.js";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValuationNumericSignal(parsed: GenericParsedFields): boolean {
  if (parsed.priceType === "estimate") {
    return isFiniteNumber(parsed.estimateLow) || isFiniteNumber(parsed.estimateHigh);
  }
  if (
    parsed.priceType === "asking_price"
    || parsed.priceType === "hammer_price"
    || parsed.priceType === "realized_price"
    || parsed.priceType === "realized_with_buyers_premium"
  ) {
    return isFiniteNumber(parsed.priceAmount);
  }
  return false;
}

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_SHELL_TITLE_PATTERNS = [
  /\banasayfa\b/i,
  /\binstagram\b/i,
  /\bkategoriler\b/i,
  /\bm[üu]zayede kurallar[ıi]\b/i,
  /\bonline muzayede app uygulamasi\b/i,
  /\bbonhams search\b/i,
  /\bsearch art and objects\b/i,
  /\bsearch results\b/i,
  /\bresults found\b/i,
  /\bhome(page)?\b/i,
  /\bcategories?\b/i,
  /^hemen al\b/i,
  /^m[üu]zayede ar[şs]ivi\b/i,
  /^auction archive\b/i,
  /\bportakal sanat ve kultur evi\b/i
];

const LOW_VALUE_DISCOVERY_URL_PATTERNS = [
  /^https?:\/\/(?:www\.)?(?:instagram|facebook|linkedin|youtube|x|twitter)\.com/i,
  /^https?:\/\/(?:api\.)?whatsapp\.com/i,
  /\/(?:cart|sepet)(?:[/?#.]|$)/i,
  /\/(?:account|hesabim|uyelik|uyelik-sozlesmesi|login|register|signup|sign-in|sign-up)(?:[/?#.]|$)/i,
  /\/giris[^/]*(?:[/?#.]|$)/i,
  /\/(?:contact|iletisim|about|hakkimizda|privacy|gizlilik|terms|kosullar|sartlar-ve-kosullar)(?:[/?#.]|$)/i,
  /\/(?:download-app|siparislerim|desteklerim|sifremi(?:unuttum)?|odeme_bilgilendirme|kargo_bilgileri)(?:[/?#.]|$)/i,
  /\/(?:collections\/shop|collections\/private-sales|pages\/|shop|dukkan\.html|tumurunler\.html|muzayedeler\.html)(?:[/?#]|$)/i,
  /\/(?:rss|feed)(?:[/?#.]|$)/i
];

function isGenericShellTitle(
  title: string | null | undefined,
  sourceName: string | undefined,
  sourcePageType: SourceCandidate["sourcePageType"] | undefined
): boolean {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return false;
  }

  if (GENERIC_SHELL_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return true;
  }

  if (sourcePageType === "lot" || sourcePageType === "price_db") {
    return false;
  }

  const normalizedSourceName = normalizeTitle(sourceName);
  if (normalizedSourceName && normalizedTitle === normalizedSourceName) {
    return true;
  }

  return false;
}

function urlHasLowValueDiscoveryPattern(url: string): boolean {
  return LOW_VALUE_DISCOVERY_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function urlContainsRequestedEntity(
  candidateUrl: string | null | undefined,
  queryArtist?: string,
  queryTitle?: string
): boolean {
  if (!candidateUrl) {
    return false;
  }

  const normalizedCandidate = normalizeTitle(candidateUrl);
  if (!normalizedCandidate) {
    return false;
  }

  const normalizedArtist = normalizeTitle(queryArtist);
  const normalizedQueryTitle = normalizeTitle(queryTitle);

  if (normalizedQueryTitle && normalizedCandidate.includes(normalizedQueryTitle)) {
    return true;
  }

  if (!normalizedArtist) {
    return false;
  }

  return normalizedArtist
    .split(" ")
    .filter((token) => token.length >= 3)
    .every((token) => normalizedCandidate.includes(token));
}

function parsedFieldsContainRequestedEntity(
  parsed: GenericParsedFields,
  queryArtist?: string,
  queryTitle?: string
): boolean {
  const parsedTitle = normalizeTitle(parsed.title);
  const parsedArtist = normalizeTitle(parsed.artistName);
  const normalizedArtist = normalizeTitle(queryArtist);
  const normalizedQueryTitle = normalizeTitle(queryTitle);

  if (
    normalizedQueryTitle &&
    parsedTitle &&
    (parsedTitle.includes(normalizedQueryTitle) || normalizedQueryTitle.includes(parsedTitle))
  ) {
    return true;
  }

  if (!normalizedArtist) {
    return false;
  }

  if (parsedArtist && (parsedArtist.includes(normalizedArtist) || normalizedArtist.includes(parsedArtist))) {
    return true;
  }

  return parsedTitle.includes(normalizedArtist);
}

function hasRecordLevelEntitySignal(
  parsed: GenericParsedFields,
  candidateUrl: string | null | undefined,
  queryArtist?: string,
  queryTitle?: string
): boolean {
  return (
    parsedFieldsContainRequestedEntity(parsed, queryArtist, queryTitle) ||
    urlContainsRequestedEntity(candidateUrl, queryArtist, queryTitle)
  );
}

function inferValuationLane(priceType: GenericParsedFields["priceType"]): ValuationLane {
  if (priceType === "asking_price") return "asking";
  if (priceType === "estimate") return "estimate";
  if (priceType === "hammer_price" || priceType === "realized_price" || priceType === "realized_with_buyers_premium") {
    return "realized";
  }
  return "none";
}

function defaultAcceptanceReason(priceType: GenericParsedFields["priceType"]): AcceptanceReason {
  if (priceType === "asking_price") return "asking_price_ready";
  if (priceType === "estimate") return "estimate_range_ready";
  return "valuation_ready";
}

function sourceReliabilityBase(status: SourceAccessStatus): number {
  if (status === "licensed_access") return 0.82;
  if (status === "public_access") return 0.72;
  if (status === "price_hidden") return 0.6;
  if (status === "auth_required") return 0.32;
  return 0.06;
}

function tierAdjustment(tier: 1 | 2 | 3 | 4): number {
  if (tier === 1) return 0.12;
  if (tier === 2) return 0.04;
  if (tier === 3) return -0.04;
  return -0.08;
}

function sanitizeSensitiveArtifactText(content: string): string {
  return content
    .replace(/(authorization["'\s:=]+bearer\s+)[^"'\\\s<]+/gi, "$1[REDACTED]")
    .replace(/(x-api-key["'\s:=]+)[^"'\\\s<]+/gi, "$1[REDACTED]")
    .replace(/(set-cookie["'\s:=]+)[^\n<]+/gi, "$1[REDACTED]")
    .replace(/((?:access_token|auth_token|session_token|csrf_token|_csrf|token)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2")
    .replace(/((?:sessionid|sid|remember_token)=)[^;"'\s<]+/gi, "$1[REDACTED]");
}

function describeAcceptanceReason(reason: AcceptanceReason): string {
  switch (reason) {
    case "valuation_ready":
      return "Matched record with a numeric realized price ready for valuation.";
    case "estimate_range_ready":
      return "Matched record with a usable estimate range ready for valuation.";
    case "asking_price_ready":
      return "Matched record with a usable asking price ready for valuation.";
    case "inquiry_only_evidence":
      return "Relevant record was captured, but the venue only exposed inquiry-only pricing.";
    case "price_hidden_evidence":
      return "Relevant record was captured, but the numeric price remained hidden.";
    case "entity_mismatch":
      return "The extracted page did not match the requested artist or work closely enough.";
    case "generic_shell_page":
      return "The fetched page looked like a shell, listing, or navigation page rather than an artwork record.";
    case "missing_numeric_price":
      return "The record matched the query, but no reliable numeric price was parsed.";
    case "missing_currency":
      return "A price-like value was found, but the currency signal was missing.";
    case "missing_estimate_range":
      return "The record looked like an estimate page, but a complete low/high range was not parsed.";
    case "unknown_price_type":
      return "The page carried some market signal, but the price type could not be classified confidently.";
    case "blocked_access":
      return "The source could not be accessed lawfully or reliably for this attempt.";
  }
}

export function buildAcceptanceExplanation(
  sourceName: string,
  acceptance: AttemptAcceptanceDetails,
  sourceStatus: SourceAccessStatus
): string {
  const statusSuffix =
    sourceStatus === "licensed_access"
      ? " Licensed access was used."
      : sourceStatus === "auth_required"
        ? " An authorized session is still required."
        : sourceStatus === "price_hidden"
          ? " The venue kept price details hidden."
          : sourceStatus === "blocked"
            ? " The source access path was blocked."
            : "";
  return `${sourceName}: ${describeAcceptanceReason(acceptance.acceptanceReason)}${statusSuffix}`;
}

export function buildNextStepHint(
  sourceName: string,
  acceptance: AttemptAcceptanceDetails,
  sourceStatus: SourceAccessStatus
): string | null {
  if (sourceStatus === "auth_required") {
    return `Refresh or capture an authorized session for ${sourceName} before rerunning.`;
  }
  if (sourceStatus === "blocked") {
    return `Review the access path for ${sourceName} before rerunning live traffic.`;
  }
  if (acceptance.acceptedForValuation) {
    return "Keep this record in the priced comparable set unless a human reviewer overrides it.";
  }
  switch (acceptance.acceptanceReason) {
    case "inquiry_only_evidence":
    case "price_hidden_evidence":
      return `Keep ${sourceName} as evidence-only and add another priced source family for valuation coverage.`;
    case "missing_numeric_price":
    case "missing_currency":
    case "missing_estimate_range":
    case "unknown_price_type":
      return `Replay the stored snapshot for ${sourceName} and repair the source-specific parsing logic.`;
    case "entity_mismatch":
      return "Exclude this candidate and refine discovery terms or source-family routing.";
    case "generic_shell_page":
      return `Promote a lot-detail URL for ${sourceName} instead of keeping the shell page.`;
    case "blocked_access":
      return `Resolve ${sourceName} access gating before retrying this source.`;
    default:
      return null;
  }
}

export function estimateEntityMatchConfidence(parsedTitle: string | null, queryTitle?: string): number {
  const parsed = normalizeTitle(parsedTitle);
  const query = normalizeTitle(queryTitle);

  if (parsed && !query) {
    return 0.72;
  }

  if (!parsed && !query) {
    return 0.45;
  }

  if (!parsed && query) {
    return 0.38;
  }

  if (parsed === query) {
    return 0.88;
  }

  if (parsed.includes(query) || query.includes(parsed)) {
    return 0.72;
  }

  return 0.46;
}

export function evaluateAcceptance(
  parsed: GenericParsedFields,
  sourceStatus: SourceAccessStatus,
  context?: {
    sourceName?: string;
    sourcePageType?: SourceCandidate["sourcePageType"];
    candidateUrl?: string;
    queryArtist?: string;
    queryTitle?: string;
  }
): AttemptAcceptanceDetails {
  if (sourceStatus === "blocked") {
    return {
      acceptedForEvidence: false,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "blocked_access",
      rejectionReason: "Source access blocked.",
      valuationEligibilityReason: "Source access blocked."
    };
  }

  const hasLotAnchor = Boolean(parsed.lotNumber);
  const isDetailPage = context?.sourcePageType === "lot" || context?.sourcePageType === "price_db";
  if (!isDetailPage && !hasLotAnchor && isGenericShellTitle(parsed.title, context?.sourceName, context?.sourcePageType)) {
    return {
      acceptedForEvidence: false,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "generic_shell_page",
      rejectionReason: "Generic navigation/search page detected; not retained as an artwork record.",
      valuationEligibilityReason: "Shell pages are excluded from evidence and valuation."
    };
  }

  if (
    !isDetailPage &&
    (context?.queryArtist || context?.queryTitle) &&
    !hasRecordLevelEntitySignal(parsed, context?.candidateUrl, context?.queryArtist, context?.queryTitle)
  ) {
    return {
      acceptedForEvidence: false,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "entity_mismatch",
      rejectionReason: "Listing/search page lacked record-level evidence for the requested artist or work.",
      valuationEligibilityReason: "Record-level entity confirmation is required before retaining listing pages."
    };
  }

  if (parsed.priceType === "unknown") {
    return {
      acceptedForEvidence: false,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "unknown_price_type",
      rejectionReason: "No reliable price semantics found.",
      valuationEligibilityReason: "Price semantics unknown."
    };
  }

  if (parsed.priceType === "inquiry_only") {
    return {
      acceptedForEvidence: true,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "inquiry_only_evidence",
      rejectionReason: "Price hidden or inquiry-only record retained only as evidence.",
      valuationEligibilityReason: "Price hidden / inquiry-only records are excluded from valuation."
    };
  }

  if (parsed.priceHidden && !hasValuationNumericSignal(parsed)) {
    return {
      acceptedForEvidence: true,
      acceptedForValuation: false,
      valuationLane: "none",
      acceptanceReason: "price_hidden_evidence",
      rejectionReason: "Price hidden or inquiry-only record retained only as evidence.",
      valuationEligibilityReason: "Price hidden / inquiry-only records are excluded from valuation."
    };
  }

  if (!parsed.currency) {
    return {
      acceptedForEvidence: true,
      acceptedForValuation: false,
      valuationLane: inferValuationLane(parsed.priceType),
      acceptanceReason: "missing_currency",
      rejectionReason: "Currency missing for priced record.",
      valuationEligibilityReason: "Currency is required for valuation eligibility."
    };
  }

  if (parsed.priceType === "estimate") {
    const hasEstimateRange = isFiniteNumber(parsed.estimateLow) || isFiniteNumber(parsed.estimateHigh);
    return {
      acceptedForEvidence: true,
      acceptedForValuation: hasEstimateRange,
      valuationLane: "estimate",
      acceptanceReason: hasEstimateRange ? "estimate_range_ready" : "missing_estimate_range",
      rejectionReason: hasEstimateRange ? null : "Estimate record has no numeric estimate values.",
      valuationEligibilityReason: hasEstimateRange
        ? null
        : "Estimate valuation requires numeric estimate low/high and currency."
    };
  }

  if (!isFiniteNumber(parsed.priceAmount)) {
    return {
      acceptedForEvidence: true,
      acceptedForValuation: false,
      valuationLane: inferValuationLane(parsed.priceType),
      acceptanceReason: "missing_numeric_price",
      rejectionReason: "Numeric price amount missing for priced record.",
      valuationEligibilityReason: "Priced valuation lanes require numeric price amount + currency."
    };
  }

  return {
    acceptedForEvidence: true,
    acceptedForValuation: true,
    valuationLane: inferValuationLane(parsed.priceType),
    acceptanceReason: defaultAcceptanceReason(parsed.priceType),
    rejectionReason: null,
    valuationEligibilityReason: null
  };
}

export function buildConfidenceComponents(params: {
  parsed: GenericParsedFields;
  queryTitle?: string;
  sourceStatus: SourceAccessStatus;
  tier: 1 | 2 | 3 | 4;
  acceptance: AttemptAcceptanceDetails;
}): {
  extractionConfidence: number;
  entityMatchConfidence: number;
  sourceReliabilityConfidence: number;
  overallConfidence: number;
} {
  const { parsed, sourceStatus, queryTitle, tier, acceptance } = params;

  let extraction = 0.35;
  if (parsed.priceType === "realized_with_buyers_premium") extraction = 0.78;
  else if (parsed.priceType === "realized_price" || parsed.priceType === "hammer_price") extraction = 0.74;
  else if (parsed.priceType === "estimate") extraction = 0.68;
  else if (parsed.priceType === "asking_price") extraction = 0.62;
  else if (parsed.priceType === "inquiry_only") extraction = 0.56;

  if (parsed.lotNumber) extraction += 0.05;
  if (parsed.saleDate) extraction += 0.04;
  if (parsed.currency) extraction += 0.03;
  if (isFiniteNumber(parsed.priceAmount) || isFiniteNumber(parsed.estimateLow) || isFiniteNumber(parsed.estimateHigh)) {
    extraction += 0.05;
  }

  const sourceReliability = clamp(sourceReliabilityBase(sourceStatus) + tierAdjustment(tier));
  const entityMatch = estimateEntityMatchConfidence(parsed.title, queryTitle);
  const valuationPenalty = acceptance.acceptedForValuation ? 0 : -0.12;

  const overall = clamp(extraction * 0.46 + entityMatch * 0.22 + sourceReliability * 0.32 + valuationPenalty);

  return {
    extractionConfidence: clamp(extraction),
    entityMatchConfidence: entityMatch,
    sourceReliabilityConfidence: sourceReliability,
    overallConfidence: acceptance.acceptedForValuation ? overall : Math.min(overall, 0.59)
  };
}

export function evaluateAccessDecision(
  context: AdapterExtractionContext,
  requiresAuth: boolean,
  requiresLicense: boolean
): AdapterStatusDecision {
  const sourceAccessStatus = context.accessContext.sourceAccessStatus;

  if (sourceAccessStatus === "blocked") {
    return {
      sourceAccessStatus,
      accessReason: context.accessContext.accessReason ?? "Source blocked by policy.",
      blockerReason: context.accessContext.blockerReason ?? "Blocked access.",
      canProceed: false
    };
  }

  if (requiresLicense && context.accessContext.mode !== "licensed") {
    return {
      sourceAccessStatus: "blocked",
      accessReason: "Licensed integration required.",
      blockerReason: "Operator did not provide a licensed integration.",
      canProceed: false
    };
  }

  if (requiresAuth && context.accessContext.mode === "anonymous") {
    return {
      sourceAccessStatus: "auth_required",
      accessReason: "Source requires authenticated session.",
      blockerReason: "No authorized profile available.",
      canProceed: false
    };
  }

  return {
    sourceAccessStatus,
    accessReason: context.accessContext.accessReason ?? "Proceeding with source extraction.",
    blockerReason: null,
    canProceed: true
  };
}

export function ensureRawPath(evidenceDir: string, fileName: string): string {
  const rawPath = path.join(evidenceDir, "raw", fileName);
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  return rawPath;
}

export function writeRawSnapshot(
  filePath: string,
  content: string,
  accessContext?: { artifactHandling?: "standard" | "scrubbed_sensitive" | "internal_only" }
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = accessContext?.artifactHandling === "standard" ? content : sanitizeSensitiveArtifactText(content);
  fs.writeFileSync(filePath, payload, "utf-8");
}

export function buildBlockedResult(
  adapter: Pick<SourceAdapter, "sourceName" | "venueName" | "capabilities">,
  candidate: SourceCandidate,
  context: AdapterExtractionContext,
  decision: AdapterStatusDecision
): AdapterExtractionResult {
  const fetchedAt = new Date().toISOString();
  const rawSnapshotPath = ensureRawPath(
    context.evidenceDir,
    `${adapter.sourceName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-blocked.json`
  );

  writeRawSnapshot(
    rawSnapshotPath,
    JSON.stringify(
      {
        source_name: adapter.sourceName,
        source_url: candidate.url,
        source_access_status: decision.sourceAccessStatus,
        failure_class: "access_blocked",
        access_reason: decision.accessReason,
        blocker_reason: decision.blockerReason,
        fetched_at: fetchedAt
      },
      null,
      2
    ),
    context.accessContext
  );

  const blockedAcceptance: AttemptAcceptanceDetails = {
    acceptedForEvidence: false,
    acceptedForValuation: false,
    valuationLane: "none",
    acceptanceReason: "blocked_access",
    rejectionReason: decision.blockerReason ?? decision.accessReason,
    valuationEligibilityReason: "Source blocked."
  };

  const attempt: SourceAttempt = {
    run_id: context.runId,
    source_name: adapter.sourceName,
    source_family: adapter.capabilities.source_family,
    venue_name: adapter.venueName,
    source_url: candidate.url,
    canonical_url: candidate.url,
    access_mode: context.accessContext.mode,
    source_legal_posture: context.accessContext.legalPosture,
    access_provenance_label: context.accessContext.accessProvenanceLabel ?? null,
    session_identity: context.accessContext.sessionIdentity ?? null,
    browser_identity: context.accessContext.browserIdentity ?? null,
    proxy_identity: context.accessContext.proxyIdentity ?? null,
    artifact_handling: context.accessContext.artifactHandling,
    source_access_status: decision.sourceAccessStatus,
    failure_class: "access_blocked",
    access_reason: decision.accessReason,
    blocker_reason: decision.blockerReason,
    transport_kind: null,
    transport_provider: null,
    transport_host: null,
    transport_status_code: null,
    transport_retryable: null,
    extracted_fields: {},
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
    rejection_reason: decision.blockerReason ?? decision.accessReason,
    valuation_eligibility_reason: "Source blocked.",
    acceptance_explanation: buildAcceptanceExplanation(adapter.sourceName, blockedAcceptance, decision.sourceAccessStatus),
    next_step_hint: buildNextStepHint(adapter.sourceName, blockedAcceptance, decision.sourceAccessStatus)
  };

  return {
    attempt,
    record: null,
    needsBrowserVerification: false
  };
}

export function toCandidate(
  url: string,
  sourcePageType: SourceCandidate["sourcePageType"],
  provenance: DiscoveryProvenance,
  score: number,
  discoveredFromUrl?: string | null
): SourceCandidate {
  return {
    url,
    sourcePageType,
    provenance,
    score: Math.min(1, Math.max(0, score)),
    discoveredFromUrl: discoveredFromUrl ?? null
  };
}

export function extractHrefCandidates(
  html: string,
  pageUrl: string,
  sourcePageType: SourceCandidate["sourcePageType"],
  provenance: DiscoveryProvenance,
  score: number,
  matchers: RegExp[]
): SourceCandidate[] {
  const canonicalPageUrl = (() => {
    try {
      const url = new URL(pageUrl);
      url.hash = "";
      return url.toString();
    } catch {
      return pageUrl;
    }
  })();

  const normalizeCandidateUrl = (rawUrl: string): string | null => {
    let url: URL;
    try {
      url = new URL(rawUrl, pageUrl);
    } catch {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_") ||
        lower === "gclid" ||
        lower === "fbclid" ||
        lower === "mc_cid" ||
        lower === "mc_eid" ||
        lower === "_pos" ||
        lower === "_sid" ||
        lower === "_ss"
      ) {
        url.searchParams.delete(key);
      }
    }

    const lowerPath = url.pathname.toLowerCase();
    if (lowerPath.endsWith(".oembed")) {
      return null;
    }
    if (lowerPath.endsWith("/feed") || lowerPath.endsWith("/feed/")) {
      return null;
    }
    if (/\.(?:xml|rss|jpg|jpeg|png|gif|webp|svg|css|js|pdf|zip|mp3|mp4|ico)$/i.test(lowerPath)) {
      return null;
    }

    return url.toString();
  };

  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const out: SourceCandidate[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) {
      continue;
    }

    const absolute = normalizeCandidateUrl(raw);
    if (!absolute) {
      continue;
    }
    if (absolute === canonicalPageUrl) {
      continue;
    }

    if (seen.has(absolute)) {
      continue;
    }
    if (urlHasLowValueDiscoveryPattern(absolute)) {
      continue;
    }
    if (!matchers.some((matcher) => matcher.test(absolute))) {
      continue;
    }

    seen.add(absolute);
    out.push(toCandidate(absolute, sourcePageType, provenance, score, pageUrl));
  }

  return out;
}

export function buildRecordFromParsed(
  adapter: Pick<SourceAdapter, "venueName" | "venueType" | "sourceName" | "city" | "country" | "tier" | "capabilities">,
  candidate: SourceCandidate,
  context: AdapterExtractionContext,
  parsed: GenericParsedFields,
  rawSnapshotPath: string,
  acceptance: AttemptAcceptanceDetails
): PriceRecord {
  const confidence = buildConfidenceComponents({
    parsed,
    queryTitle: context.query.title,
    sourceStatus: parsed.priceHidden ? "price_hidden" : context.accessContext.sourceAccessStatus,
    tier: adapter.tier,
    acceptance
  });

  return {
    artist_name: parsed.artistName ?? context.query.artist,
    work_title: parsed.title,
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
    venue_name: adapter.venueName,
    venue_type: adapter.venueType,
    city: adapter.city,
    country: adapter.country,
    source_name: adapter.sourceName,
    source_family: adapter.capabilities.source_family,
    source_url: candidate.url,
    source_page_type: candidate.sourcePageType,
    access_mode: context.accessContext.mode,
    source_legal_posture: context.accessContext.legalPosture,
    access_provenance_label: context.accessContext.accessProvenanceLabel ?? null,
    session_identity: context.accessContext.sessionIdentity ?? null,
    browser_identity: context.accessContext.browserIdentity ?? null,
    proxy_identity: context.accessContext.proxyIdentity ?? null,
    artifact_handling: context.accessContext.artifactHandling,
    sale_or_listing_date: parsed.saleDate,
    lot_number: parsed.lotNumber,
    price_type: parsed.priceType,
    estimate_low: parsed.estimateLow,
    estimate_high: parsed.estimateHigh,
    price_amount: parsed.priceAmount,
    currency: parsed.currency,
    normalized_price_try: null,
    normalized_price_usd: null,
    buyers_premium_included: parsed.buyersPremiumIncluded,
    image_url: parsed.imageUrl,
    screenshot_path: null,
    raw_snapshot_path: rawSnapshotPath,
    visual_match_score: null,
    metadata_match_score: null,
    extraction_confidence: confidence.extractionConfidence,
    entity_match_confidence: confidence.entityMatchConfidence,
    source_reliability_confidence: confidence.sourceReliabilityConfidence,
    valuation_confidence: acceptance.acceptedForValuation ? confidence.overallConfidence : 0,
    overall_confidence: confidence.overallConfidence,
    accepted_for_evidence: acceptance.acceptedForEvidence,
    accepted_for_valuation: acceptance.acceptedForValuation,
    valuation_lane: acceptance.valuationLane,
    acceptance_reason: acceptance.acceptanceReason,
    rejection_reason: acceptance.rejectionReason,
    valuation_eligibility_reason: acceptance.valuationEligibilityReason,
    price_hidden: parsed.priceHidden,
    source_access_status: parsed.priceHidden ? "price_hidden" : context.accessContext.sourceAccessStatus,
    acceptance_explanation: buildAcceptanceExplanation(
      adapter.sourceName,
      acceptance,
      parsed.priceHidden ? "price_hidden" : context.accessContext.sourceAccessStatus
    ),
    next_step_hint: buildNextStepHint(
      adapter.sourceName,
      acceptance,
      parsed.priceHidden ? "price_hidden" : context.accessContext.sourceAccessStatus
    ),
    notes: [
      `discovery:${candidate.provenance}`,
      context.query.title ? `query_title_hint:${context.query.title}` : "query_title_hint:none"
    ]
  };
}
