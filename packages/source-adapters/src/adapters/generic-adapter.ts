import fs from "node:fs";
import path from "node:path";
import { fetchCheapestFirst, parseGenericLotFields } from "@artbot/extraction";
import type { PriceRecord, SourceAttempt } from "@artbot/shared-types";
import type {
  AdapterExtractionContext,
  AdapterExtractionResult,
  AdapterStatusDecision,
  SourceAdapter,
  SourceCandidate
} from "../types.js";

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

function decisionFromAccess(context: AdapterExtractionContext, adapter: GenericSourceAdapter): AdapterStatusDecision {
  const sourceAccessStatus = context.accessContext.sourceAccessStatus;

  if (sourceAccessStatus === "blocked") {
    return {
      sourceAccessStatus,
      accessReason: context.accessContext.accessReason ?? "Source blocked by policy.",
      blockerReason: context.accessContext.blockerReason ?? "Blocked access.",
      canProceed: false
    };
  }

  if (adapter.requiresLicense && context.accessContext.mode !== "licensed") {
    return {
      sourceAccessStatus: "blocked",
      accessReason: "Licensed integration required.",
      blockerReason: "Operator did not provide a licensed integration.",
      canProceed: false
    };
  }

  if (adapter.requiresAuth && context.accessContext.mode === "anonymous") {
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

function writeRawSnapshot(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
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
        sourcePageType: this.sourcePageType
      }
    ];
  }

  public async extract(candidate: SourceCandidate, context: AdapterExtractionContext): Promise<AdapterExtractionResult> {
    const decision = decisionFromAccess(context, this);
    const fetchedAt = new Date().toISOString();

    if (!decision.canProceed) {
      const rawSnapshotPath = path.join(context.evidenceDir, "raw", `${this.id}-${Date.now()}-blocked.json`);
      writeRawSnapshot(
        rawSnapshotPath,
        JSON.stringify(
          {
            source_name: this.sourceName,
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
        source_name: this.sourceName,
        source_url: candidate.url,
        canonical_url: candidate.url,
        access_mode: context.accessContext.mode,
        source_access_status: decision.sourceAccessStatus,
        access_reason: decision.accessReason,
        blocker_reason: decision.blockerReason,
        extracted_fields: {},
        screenshot_path: null,
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: rawSnapshotPath,
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

    const extracted = await fetchCheapestFirst(candidate.url);
    const parsed = parseGenericLotFields(`${extracted.markdown} ${extracted.html}`);
    const rawSnapshotPath = path.join(context.evidenceDir, "raw", `${this.id}-${Date.now()}-cheap.html`);
    writeRawSnapshot(rawSnapshotPath, extracted.html || extracted.markdown);

    let sourceStatus = decision.sourceAccessStatus;
    if (parsed.priceHidden) {
      sourceStatus = "price_hidden";
    }

    const confidenceBase = parsed.priceType === "unknown" ? 0.25 : 0.65;
    const confidence = Math.min(0.95, confidenceBase + (parsed.priceHidden ? 0.1 : 0));

    const record: PriceRecord = {
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
      venue_name: this.venueName,
      venue_type: this.venueType,
      city: this.city,
      country: this.country,
      source_name: this.sourceName,
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
      buyers_premium_included: null,
      image_url: null,
      screenshot_path: null,
      raw_snapshot_path: rawSnapshotPath,
      visual_match_score: null,
      metadata_match_score: null,
      overall_confidence: confidence,
      price_hidden: parsed.priceHidden,
      source_access_status: sourceStatus,
      notes: []
    };

    const accepted = parsed.priceType !== "unknown" || parsed.priceHidden;
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
        currency: parsed.currency
      },
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: rawSnapshotPath,
      fetched_at: fetchedAt,
      parser_used: extracted.parserUsed,
      model_used: null,
      confidence_score: confidence,
      accepted,
      acceptance_reason: accepted ? "Structured pricing fields found." : "No reliable price fields found."
    };

    return {
      attempt,
      record: accepted ? record : null,
      needsBrowserVerification: !accepted || context.accessContext.mode !== "anonymous"
    };
  }
}
