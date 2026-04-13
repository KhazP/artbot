import type { SessionContext } from "@artbot/extraction";
import type {
  AccessContext,
  AccessMode,
  CrawlStrategy,
  PriceRecord,
  PriceSemanticLane,
  ResearchQuery,
  SourceCapability,
  SourceAccessStatus,
  SourceAttempt,
  SourcePageType,
  VenueType
} from "@artbot/shared-types";

export type DiscoveryProvenance =
  | "seed"
  | "query_variant"
  | "listing_expansion"
  | "signature_expansion"
  | "direct_lot"
  | "web_discovery";

export interface SourceCandidate {
  url: string;
  sourcePageType: SourcePageType;
  provenance: DiscoveryProvenance;
  score: number;
  discoveredFromUrl?: string | null;
}

export interface AdapterExtractionContext {
  runId: string;
  traceId: string;
  query: ResearchQuery;
  accessContext: AccessContext;
  evidenceDir: string;
  sessionContext?: SessionContext;
}

export interface AdapterExtractionResult {
  attempt: SourceAttempt;
  record: PriceRecord | null;
  needsBrowserVerification: boolean;
  discoveredCandidates?: SourceCandidate[];
}

export interface SourceAdapter {
  id: string;
  sourceName: string;
  venueName: string;
  venueType: VenueType;
  sourcePageType: SourcePageType;
  tier: 1 | 2 | 3 | 4;
  country: string | null;
  city: string | null;
  requiresAuth: boolean;
  requiresLicense: boolean;
  supportedAccessModes: AccessMode[];
  crawlStrategies: CrawlStrategy[];
  capabilities: SourceCapability;
  discoverCandidates(query: ResearchQuery): Promise<SourceCandidate[]>;
  extract(candidate: SourceCandidate, context: AdapterExtractionContext): Promise<AdapterExtractionResult>;
}

export interface AdapterStatusDecision {
  sourceAccessStatus: SourceAccessStatus;
  accessReason: string;
  blockerReason: string | null;
  canProceed: boolean;
}

export function deriveDefaultSourceCapabilities(input: {
  id: string;
  supportedAccessModes: AccessMode[];
  requiresAuth: boolean;
  sourcePageType: SourcePageType;
  crawlStrategies: CrawlStrategy[];
  saleModes?: PriceSemanticLane[];
}): SourceCapability {
  return {
    version: "1",
    source_family: input.id.replace(/-(listing|lot|adapter|extractor|probe)$/i, ""),
    access_modes: input.supportedAccessModes,
    browser_support: input.requiresAuth || input.sourcePageType === "listing" ? "optional" : "never",
    sale_modes: input.saleModes ?? ["unknown"],
    evidence_requirements: input.requiresAuth
      ? ["raw_snapshot", "screenshot", "manual_auth_possible"]
      : ["raw_snapshot", "screenshot"],
    structured_data_likelihood: input.sourcePageType === "listing" ? "medium" : "low",
    preferred_discovery: input.crawlStrategies.includes("listing_to_lot")
      ? "listing_expansion"
      : input.crawlStrategies.includes("search")
        ? "search"
        : "seed_only"
  };
}
