import { fetchCheapestFirst, parseGenericLotFields } from "@artbot/extraction";
import type { SourceAttempt } from "@artbot/shared-types";
import type {
  AdapterExtractionContext,
  AdapterExtractionResult,
  SourceAdapter,
  SourceCandidate
} from "../types.js";
import {
  buildBlockedResult,
  buildRecordFromParsed,
  ensureRawPath,
  evaluateAcceptance,
  evaluateAccessDecision,
  writeRawSnapshot
} from "./custom-adapter-utils.js";

interface GenericAdapterOptions {
  id: string;
  sourceName: string;
  venueName: string;
  venueType: SourceAdapter["venueType"];
  sourcePageType: SourceAdapter["sourcePageType"];
  tier: SourceAdapter["tier"];
  country: string | null;
  city: string | null;
  baseUrl: string;
  searchPath: string;
  requiresAuth?: boolean;
  requiresLicense?: boolean;
  supportedAccessModes?: SourceAdapter["supportedAccessModes"];
}

export class GenericSourceAdapter implements SourceAdapter {
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
  private readonly searchPath: string;

  constructor(options: GenericAdapterOptions) {
    this.id = options.id;
    this.sourceName = options.sourceName;
    this.venueName = options.venueName;
    this.venueType = options.venueType;
    this.sourcePageType = options.sourcePageType;
    this.tier = options.tier;
    this.country = options.country;
    this.city = options.city;
    this.baseUrl = options.baseUrl;
    this.searchPath = options.searchPath;
    this.requiresAuth = Boolean(options.requiresAuth);
    this.requiresLicense = Boolean(options.requiresLicense);
    this.supportedAccessModes = options.supportedAccessModes ?? ["anonymous", "authorized", "licensed"];
  }

  public async discoverCandidates(query: AdapterExtractionContext["query"]): Promise<SourceCandidate[]> {
    const q = encodeURIComponent([query.artist, query.title].filter(Boolean).join(" "));
    const url = `${this.baseUrl}${this.searchPath}${q}`;

    return [
      {
        url,
        sourcePageType: this.sourcePageType,
        provenance: "seed",
        score: 0.9,
        discoveredFromUrl: null
      }
    ];
  }

  public async extract(candidate: SourceCandidate, context: AdapterExtractionContext): Promise<AdapterExtractionResult> {
    const decision = evaluateAccessDecision(context, this.requiresAuth, this.requiresLicense);
    if (!decision.canProceed) {
      return buildBlockedResult(this, candidate, context, decision);
    }

    const fetchedAt = new Date().toISOString();
    const extracted = await fetchCheapestFirst(candidate.url);
    const rawSnapshotPath = ensureRawPath(context.evidenceDir, `${this.id}-${Date.now()}-cheap.html`);
    writeRawSnapshot(rawSnapshotPath, extracted.html || extracted.markdown);

    const parsed = parseGenericLotFields(`${extracted.markdown} ${extracted.html}`);
    const sourceStatus = parsed.priceHidden ? "price_hidden" : decision.sourceAccessStatus;
    const acceptance = evaluateAcceptance(parsed, sourceStatus);

    const record = buildRecordFromParsed(
      {
        venueName: this.venueName,
        venueType: this.venueType,
        sourceName: this.sourceName,
        city: this.city,
        country: this.country,
        tier: this.tier
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
      source_url: candidate.url,
      canonical_url: extracted.url,
      access_mode: context.accessContext.mode,
      source_access_status: sourceStatus,
      access_reason: decision.accessReason,
      blocker_reason: null,
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
      parser_used: extracted.parserUsed,
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
      valuation_eligibility_reason: acceptance.valuationEligibilityReason
    };

    const shouldEscalateForMissingPrice =
      acceptance.acceptedForEvidence &&
      !acceptance.acceptedForValuation &&
      parsed.priceType !== "inquiry_only" &&
      !parsed.priceHidden;

    return {
      attempt,
      record: acceptance.acceptedForEvidence ? record : null,
      needsBrowserVerification:
        shouldEscalateForMissingPrice || !acceptance.acceptedForEvidence || context.accessContext.mode !== "anonymous"
    };
  }
}
