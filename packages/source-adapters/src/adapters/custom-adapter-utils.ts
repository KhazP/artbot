import fs from "node:fs";
import path from "node:path";
import type { PriceRecord, SourceAttempt } from "@artbot/shared-types";
import type { GenericParsedFields } from "@artbot/extraction";
import type {
  AdapterExtractionContext,
  AdapterExtractionResult,
  AdapterStatusDecision,
  DiscoveryProvenance,
  SourceAdapter,
  SourceCandidate
} from "../types.js";

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

export function writeRawSnapshot(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

export function buildBlockedResult(
  adapter: Pick<SourceAdapter, "sourceName">,
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
        access_reason: decision.accessReason,
        blocker_reason: decision.blockerReason,
        fetched_at: fetchedAt
      },
      null,
      2
    )
  );

  const attempt: SourceAttempt = {
    run_id: context.runId,
    source_name: adapter.sourceName,
    source_url: candidate.url,
    canonical_url: candidate.url,
    access_mode: context.accessContext.mode,
    source_access_status: decision.sourceAccessStatus,
    access_reason: decision.accessReason,
    blocker_reason: decision.blockerReason,
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
    confidence_score: 0,
    accepted: false,
    acceptance_reason: decision.blockerReason ?? decision.accessReason
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
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const out: SourceCandidate[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:")) {
      continue;
    }

    let absolute: string;
    try {
      absolute = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }

    if (seen.has(absolute)) {
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
  adapter: Pick<SourceAdapter, "venueName" | "venueType" | "sourceName" | "city" | "country">,
  candidate: SourceCandidate,
  context: AdapterExtractionContext,
  parsed: GenericParsedFields,
  rawSnapshotPath: string,
  confidence: number
): PriceRecord {
  return {
    artist_name: context.query.artist,
    work_title: context.query.title ?? parsed.title,
    alternate_title: null,
    year: context.query.year ?? null,
    medium: context.query.medium ?? null,
    support: null,
    dimensions_text: context.query.dimensions?.dimensionsText ?? null,
    height_cm: context.query.dimensions?.heightCm ?? null,
    width_cm: context.query.dimensions?.widthCm ?? null,
    depth_cm: context.query.dimensions?.depthCm ?? null,
    signed: null,
    dated: null,
    edition_info: null,
    is_unique_work: null,
    venue_name: adapter.venueName,
    venue_type: adapter.venueType,
    city: adapter.city,
    country: adapter.country,
    source_name: adapter.sourceName,
    source_url: candidate.url,
    source_page_type: candidate.sourcePageType,
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
    image_url: null,
    screenshot_path: null,
    raw_snapshot_path: rawSnapshotPath,
    visual_match_score: null,
    metadata_match_score: null,
    overall_confidence: confidence,
    price_hidden: parsed.priceHidden,
    source_access_status: parsed.priceHidden ? "price_hidden" : context.accessContext.sourceAccessStatus,
    notes: [`discovery:${candidate.provenance}`]
  };
}

