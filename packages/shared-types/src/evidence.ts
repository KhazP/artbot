import { z } from "zod";
import type {
  AccessMode,
  AcceptanceReason,
  ArtifactHandling,
  SourceAccessStatus,
  SourceLegalPosture,
  ValuationLane
} from "./enums.js";
import {
  artifactHandlingSchema,
  crawlLaneSchema,
  hostHealthRecordSchema,
  priceVisibilitySchema,
  saleChannelSchema,
  sourceSurfaceSchema,
  sourceLegalPostureSchema
} from "./operations.js";

export const sourceAttemptSchema = z.object({
  run_id: z.string(),
  source_name: z.string(),
  source_family: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  source_url: z.string().url(),
  canonical_url: z.string().url().nullable(),
  access_mode: z.enum(["anonymous", "authorized", "licensed"]),
  source_legal_posture: sourceLegalPostureSchema.optional(),
  access_provenance_label: z.string().nullable().optional(),
  session_identity: z.string().nullable().optional(),
  browser_identity: z.string().nullable().optional(),
  proxy_identity: z.string().nullable().optional(),
  artifact_handling: artifactHandlingSchema.optional(),
  source_access_status: z.enum([
    "public_access",
    "auth_required",
    "licensed_access",
    "blocked",
    "price_hidden"
  ]),
  source_surface: sourceSurfaceSchema.optional(),
  crawl_lane: crawlLaneSchema.optional(),
  sale_channel: saleChannelSchema.optional(),
  price_visibility: priceVisibilitySchema.optional(),
  failure_class: z
    .enum([
      "access_blocked",
      "waf_challenge",
      "not_found",
      "transport_timeout",
      "transport_dns",
      "transport_other",
      "host_circuit"
    ])
    .optional(),
  access_reason: z.string().nullable(),
  blocker_reason: z.string().nullable(),
  transport_kind: z.string().nullable().optional(),
  transport_provider: z.string().nullable().optional(),
  transport_host: z.string().nullable().optional(),
  transport_status_code: z.number().int().nullable().optional(),
  transport_retryable: z.boolean().nullable().optional(),
  extracted_fields: z.record(z.unknown()).default({}),
  discovery_provenance: z
    .enum(["seed", "query_variant", "listing_expansion", "signature_expansion", "direct_lot", "web_discovery"])
    .optional(),
  discovery_score: z.number().min(0).max(1).nullable().optional(),
  discovered_from_url: z.string().url().nullable().optional(),
  screenshot_path: z.string().nullable(),
  pre_auth_screenshot_path: z.string().nullable().optional(),
  post_auth_screenshot_path: z.string().nullable().optional(),
  raw_snapshot_path: z.string().nullable(),
  trace_path: z.string().nullable().optional(),
  har_path: z.string().nullable().optional(),
  fetched_at: z.string(),
  parser_used: z.string(),
  model_used: z.string().nullable(),
  extraction_confidence: z.number().min(0).max(1).nullable().optional(),
  entity_match_confidence: z.number().min(0).max(1).nullable().optional(),
  source_reliability_confidence: z.number().min(0).max(1).nullable().optional(),
  confidence_score: z.number().min(0).max(1),
  accepted: z.boolean(),
  accepted_for_evidence: z.boolean().optional(),
  accepted_for_valuation: z.boolean().optional(),
  valuation_lane: z.enum(["realized", "estimate", "asking", "none"]).optional(),
  acceptance_reason: z.enum([
    "valuation_ready",
    "estimate_range_ready",
    "asking_price_ready",
    "inquiry_only_evidence",
    "price_hidden_evidence",
    "entity_mismatch",
    "generic_shell_page",
    "missing_numeric_price",
    "missing_currency",
    "missing_estimate_range",
    "unknown_price_type",
    "blocked_access"
  ]),
  rejection_reason: z.string().nullable().optional(),
  valuation_eligibility_reason: z.string().nullable().optional(),
  acceptance_explanation: z.string().nullable().optional(),
  next_step_hint: z.string().nullable().optional()
});

export type SourceAttempt = z.infer<typeof sourceAttemptSchema>;

export interface AccessContext {
  mode: AccessMode;
  profileId?: string;
  cookieFile?: string;
  sourceScope?: string[];
  sessionExpiresAt?: string;
  sensitivity?: "standard" | "sensitive" | "licensed";
  encryptedAtRest?: boolean;
  legalPosture?: SourceLegalPosture;
  sessionIdentity?: string;
  browserIdentity?: string;
  proxyIdentity?: string;
  artifactHandling?: ArtifactHandling;
  accessProvenanceLabel?: string;
  manualLoginCheckpoint?: boolean;
  allowLicensed?: boolean;
  licensedIntegrations: string[];
  sourceAccessStatus: SourceAccessStatus;
  accessReason?: string;
  blockerReason?: string;
}

export interface AttemptAcceptanceDetails {
  acceptedForEvidence: boolean;
  acceptedForValuation: boolean;
  valuationLane: ValuationLane;
  acceptanceReason: AcceptanceReason;
  rejectionReason: string | null;
  valuationEligibilityReason: string | null;
}

export const persistedHostHealthSchema = z.array(hostHealthRecordSchema);
export type PersistedHostHealth = z.infer<typeof persistedHostHealthSchema>;
