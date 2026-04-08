import type {
  AccessContext,
  AccessMode,
  PriceRecord,
  ResearchQuery,
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
  | "direct_lot";

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
  discoverCandidates(query: ResearchQuery): Promise<SourceCandidate[]>;
  extract(candidate: SourceCandidate, context: AdapterExtractionContext): Promise<AdapterExtractionResult>;
}

export interface AdapterStatusDecision {
  sourceAccessStatus: SourceAccessStatus;
  accessReason: string;
  blockerReason: string | null;
  canProceed: boolean;
}
