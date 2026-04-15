import { z } from "zod";

export const artifactKindSchema = z.enum([
  "report",
  "results",
  "screenshot",
  "pre_auth_screenshot",
  "post_auth_screenshot",
  "raw_snapshot",
  "trace",
  "har",
  "inventory_export",
  "other"
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactRetentionClassSchema = z.enum([
  "manifest",
  "accepted_evidence",
  "disputed_evidence",
  "heavy_debug",
  "ephemeral"
]);
export type ArtifactRetentionClass = z.infer<typeof artifactRetentionClassSchema>;

export const artifactPromotionStateSchema = z.enum(["standard", "promoted", "archived", "expired"]);
export type ArtifactPromotionState = z.infer<typeof artifactPromotionStateSchema>;

export const sourceLegalPostureSchema = z.enum([
  "public_permitted",
  "public_contract_sensitive",
  "auth_required",
  "licensed_only",
  "operator_assisted_only"
]);
type SourceLegalPosture = z.infer<typeof sourceLegalPostureSchema>;

export const artifactHandlingSchema = z.enum(["standard", "scrubbed_sensitive", "internal_only"]);
type ArtifactHandling = z.infer<typeof artifactHandlingSchema>;

export const gcPolicySchema = z.object({
  high_watermark_bytes: z.number().int().positive(),
  target_bytes_after_gc: z.number().int().positive(),
  manifest_retention_days: z.number().int().positive(),
  accepted_evidence_retention_days: z.number().int().positive(),
  disputed_evidence_retention_days: z.number().int().positive(),
  heavy_debug_retention_days: z.number().int().positive(),
  ephemeral_retention_days: z.number().int().positive()
});
export type GcPolicy = z.infer<typeof gcPolicySchema>;

export const artifactManifestItemSchema = z.object({
  run_id: z.string(),
  path: z.string(),
  relative_path: z.string(),
  kind: artifactKindSchema,
  retention_class: artifactRetentionClassSchema,
  promotion_state: artifactPromotionStateSchema.default("standard"),
  content_hash: z.string(),
  duplicate_of_content_hash: z.string().nullable().optional(),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string(),
  source_name: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  source_legal_posture: sourceLegalPostureSchema.optional(),
  artifact_handling: artifactHandlingSchema.optional(),
  export_restricted: z.boolean().optional(),
  accepted_for_evidence: z.boolean().optional(),
  disputed: z.boolean().optional(),
  deleted_at: z.string().nullable().optional()
});
export type ArtifactManifestItem = z.infer<typeof artifactManifestItemSchema>;

export const artifactManifestSchema = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  policy: gcPolicySchema,
  total_size_bytes: z.number().int().nonnegative(),
  items: z.array(artifactManifestItemSchema)
});
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

export const artifactGcReasonSchema = z.enum(["duplicate", "expired", "watermark"]);
export type ArtifactGcReason = z.infer<typeof artifactGcReasonSchema>;

export const artifactGcReasonBreakdownSchema = z.object({
  duplicate: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  watermark: z.number().int().nonnegative()
});
export type ArtifactGcReasonBreakdown = z.infer<typeof artifactGcReasonBreakdownSchema>;

export const artifactGcRetentionBreakdownSchema = z.object({
  manifest: z.number().int().nonnegative(),
  accepted_evidence: z.number().int().nonnegative(),
  disputed_evidence: z.number().int().nonnegative(),
  heavy_debug: z.number().int().nonnegative(),
  ephemeral: z.number().int().nonnegative()
});
export type ArtifactGcRetentionBreakdown = z.infer<typeof artifactGcRetentionBreakdownSchema>;

export const sourceSurfaceSchema = z.enum([
  "auction_result",
  "auction_catalog",
  "artist_page",
  "marketplace_listing",
  "private_sale",
  "shop",
  "gallery_inventory",
  "price_db",
  "aggregator"
]);
export type SourceSurface = z.infer<typeof sourceSurfaceSchema>;

export const crawlLaneSchema = z.enum(["deterministic", "cheap_fetch", "crawlee", "browser"]);
export type CrawlLane = z.infer<typeof crawlLaneSchema>;

export const saleChannelSchema = z.enum([
  "realized",
  "hammer",
  "bp_inclusive",
  "estimate",
  "asking",
  "buy_now",
  "private_sale_visible",
  "private_sale_poa",
  "sold_no_price",
  "unknown"
]);
export type SaleChannel = z.infer<typeof saleChannelSchema>;

export const priceVisibilitySchema = z.enum(["visible", "hidden", "sold_no_price", "unknown"]);
export type PriceVisibility = z.infer<typeof priceVisibilitySchema>;

export const discoveryProviderSchema = z.enum(["none", "brave", "tavily", "searxng"]);
export type DiscoveryProviderName = z.infer<typeof discoveryProviderSchema>;

export const discoveryProviderBudgetSchema = z.object({
  max_results_per_query: z.number().int().positive(),
  max_requests_per_run: z.number().int().positive(),
  enabled: z.boolean()
});
export type DiscoveryProviderBudget = z.infer<typeof discoveryProviderBudgetSchema>;

export const discoveryProviderDiagnosticsSchema = z.object({
  provider: discoveryProviderSchema,
  enabled: z.boolean(),
  reason: z.string().nullable(),
  requests_used: z.number().int().nonnegative(),
  results_returned: z.number().int().nonnegative(),
  candidates_considered: z.number().int().nonnegative().default(0),
  candidates_kept: z.number().int().nonnegative().default(0),
  failover_invoked: z.boolean().default(false),
  trimmed_by_caps: z.boolean().default(false),
  budget_exhausted: z.boolean().default(false)
});
export type DiscoveryProviderDiagnostics = z.infer<typeof discoveryProviderDiagnosticsSchema>;

export const localAiDecisionActionSchema = z.enum(["accept_candidate", "queue_review", "reject_candidate"]);
export type LocalAiDecisionAction = z.infer<typeof localAiDecisionActionSchema>;

export const localAiDecisionStageSchema = z.enum([
  "discovery_triage",
  "cluster_borderline",
  "parse_normalization"
]);
export type LocalAiDecisionStage = z.infer<typeof localAiDecisionStageSchema>;

export const localAiConfidenceBandSchema = z.enum(["low", "medium", "high"]);
export type LocalAiConfidenceBand = z.infer<typeof localAiConfidenceBandSchema>;

export const localAiDecisionTraceSchema = z.object({
  stage: localAiDecisionStageSchema,
  fingerprint: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  action: localAiDecisionActionSchema,
  outcome: localAiDecisionActionSchema,
  confidence: z.number().min(0).max(1),
  confidence_band: localAiConfidenceBandSchema,
  reasons: z.array(z.string()),
  latency_ms: z.number().int().nonnegative(),
  deterministic_veto: z.boolean().default(false),
  deterministic_veto_reason: z.string().nullable().optional()
});
export type LocalAiDecisionTrace = z.infer<typeof localAiDecisionTraceSchema>;

export const localAiAnalysisSummarySchema = z.object({
  decisions: z.object({
    accepted: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative()
  }),
  deterministic_veto_count: z.number().int().nonnegative(),
  confidence_band_counts: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative()
  }),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  avg_latency_ms: z.number().nonnegative().nullable().optional()
});
export type LocalAiAnalysisSummary = z.infer<typeof localAiAnalysisSummarySchema>;

export const sourceCapabilitySchema = z.object({
  version: z.literal("1"),
  source_family: z.string(),
  access_modes: z.array(z.enum(["anonymous", "authorized", "licensed"])).default(["anonymous"]),
  browser_support: z.enum(["never", "optional", "required"]).default("optional"),
  sale_modes: z.array(z.enum(["realized", "estimate", "asking", "inquiry", "unknown"])).default(["unknown"]),
  evidence_requirements: z
    .array(z.enum(["raw_snapshot", "screenshot", "trace_on_failure", "manual_auth_possible"]))
    .default(["raw_snapshot"]),
  structured_data_likelihood: z.enum(["low", "medium", "high"]).default("low"),
  preferred_discovery: z.enum(["seed_only", "search", "listing_expansion", "web_discovery"]).default("search")
});
export type SourceCapability = z.infer<typeof sourceCapabilitySchema>;

export const sourcePlanSelectionStateSchema = z.enum(["selected", "deprioritized", "skipped", "blocked"]);
export type SourcePlanSelectionState = z.infer<typeof sourcePlanSelectionStateSchema>;

export const sourcePlanItemSchema = z.object({
  adapter_id: z.string(),
  source_name: z.string(),
  venue_name: z.string(),
  source_family: z.string(),
  access_mode: z.enum(["anonymous", "authorized", "licensed"]),
  source_access_status: z.enum([
    "public_access",
    "auth_required",
    "licensed_access",
    "blocked",
    "price_hidden"
  ]),
  candidate_count: z.number().int().nonnegative(),
  candidate_cap: z.number().int().positive(),
  status: z.enum(["planned", "blocked", "skipped"]),
  selection_state: sourcePlanSelectionStateSchema,
  selection_reason: z.string().nullable(),
  priority_rank: z.number().int().positive(),
  skip_reason: z.string().nullable(),
  legal_posture: sourceLegalPostureSchema.optional(),
  capability_version: z.literal("1"),
  capabilities: sourceCapabilitySchema
});
export type SourcePlanItem = z.infer<typeof sourcePlanItemSchema>;

export const recommendedActionSchema = z.object({
  title: z.string(),
  reason: z.string(),
  severity: z.enum(["info", "warning", "critical"])
});
export type RecommendedAction = z.infer<typeof recommendedActionSchema>;

export const evaluationMetricsSchema = z.object({
  accepted_record_precision: z.number().min(0).max(1),
  priced_source_recall: z.number().min(0).max(1),
  source_completeness_ratio: z.number().min(0).max(1),
  valuation_readiness_ratio: z.number().min(0).max(1),
  priced_record_count: z.number().int().nonnegative().default(0),
  core_price_evidence_count: z.number().int().nonnegative().default(0),
  family_coverage_ratio: z.number().min(0).max(1).default(0),
  unique_artwork_count: z.number().int().nonnegative().default(0),
  blocked_access_share: z.number().min(0).max(1).default(0),
  manual_override_rate: z.number().min(0).max(1),
  coverage_target: z.number().min(0).max(1),
  coverage_target_met: z.boolean()
});
export type EvaluationMetrics = z.infer<typeof evaluationMetricsSchema>;

export const hostHealthRecordSchema = z.object({
  host: z.string(),
  total_attempts: z.number().int().nonnegative(),
  success_count: z.number().int().nonnegative(),
  blocked_count: z.number().int().nonnegative(),
  auth_required_count: z.number().int().nonnegative(),
  failure_count: z.number().int().nonnegative(),
  consecutive_failures: z.number().int().nonnegative(),
  reliability_score: z.number().min(0).max(1),
  last_status: z.enum([
    "public_access",
    "auth_required",
    "licensed_access",
    "blocked",
    "price_hidden"
  ]),
  last_failure_class: z
    .enum([
      "access_blocked",
      "waf_challenge",
      "not_found",
      "transport_timeout",
      "transport_dns",
      "transport_other",
      "host_circuit"
    ])
    .nullable(),
  last_attempt_at: z.string(),
  updated_at: z.string(),
  dimensions: z
    .record(
      z.string(),
      z.object({
        source_family: z.string(),
        crawl_lane: crawlLaneSchema,
        access_mode: z.enum(["anonymous", "authorized", "licensed"]),
        total_attempts: z.number().int().nonnegative(),
        success_count: z.number().int().nonnegative(),
        blocked_count: z.number().int().nonnegative(),
        auth_required_count: z.number().int().nonnegative(),
        failure_count: z.number().int().nonnegative(),
        reliability_score: z.number().min(0).max(1),
        last_status: z.enum([
          "public_access",
          "auth_required",
          "licensed_access",
          "blocked",
          "price_hidden"
        ]),
        last_failure_class: z
          .enum([
            "access_blocked",
            "waf_challenge",
            "not_found",
            "transport_timeout",
            "transport_dns",
            "transport_other",
            "host_circuit"
          ])
          .nullable(),
        last_attempt_at: z.string(),
        updated_at: z.string()
      })
    )
    .default({})
});
export type HostHealthRecord = z.infer<typeof hostHealthRecordSchema>;

export const sourceHealthRecordSchema = z.object({
  source_name: z.string(),
  source_family: z.string(),
  venue_name: z.string(),
  legal_posture: sourceLegalPostureSchema,
  total_attempts: z.number().int().nonnegative(),
  reachable_count: z.number().int().nonnegative(),
  parse_success_count: z.number().int().nonnegative(),
  price_signal_count: z.number().int().nonnegative(),
  accepted_for_evidence_count: z.number().int().nonnegative(),
  valuation_ready_count: z.number().int().nonnegative(),
  blocked_count: z.number().int().nonnegative(),
  auth_required_count: z.number().int().nonnegative(),
  failure_count: z.number().int().nonnegative(),
  reliability_score: z.number().min(0).max(1),
  last_status: z.enum([
    "public_access",
    "auth_required",
    "licensed_access",
    "blocked",
    "price_hidden"
  ]),
  last_failure_class: z
    .enum([
      "access_blocked",
      "waf_challenge",
      "not_found",
      "transport_timeout",
      "transport_dns",
      "transport_other",
      "host_circuit"
    ])
    .nullable(),
  last_run_id: z.string(),
  last_attempt_at: z.string(),
  updated_at: z.string()
});
export type SourceHealthRecord = z.infer<typeof sourceHealthRecordSchema>;

export const canaryResultSchema = z.object({
  id: z.string(),
  family: z.string(),
  source_name: z.string(),
  fixture: z.string(),
  source_page_type: z.enum(["lot", "artist_page", "price_db", "listing", "article", "other"]),
  legal_posture: sourceLegalPostureSchema,
  expected_price_type: z.string().nullable(),
  observed_price_type: z.string(),
  acceptance_reason: z.string(),
  accepted_for_evidence: z.boolean(),
  accepted_for_valuation: z.boolean(),
  status: z.enum(["pass", "fail"]),
  details: z.string(),
  recorded_at: z.string()
});
export type CanaryResult = z.infer<typeof canaryResultSchema>;

export const replayAttemptSchema = z.object({
  run_id: z.string(),
  source_name: z.string(),
  source_url: z.string(),
  raw_snapshot_path: z.string().nullable(),
  har_path: z.string().nullable(),
  parser_used: z.string(),
  cached_url_hash: z.string().nullable().optional(),
  artifact_kind: z.enum(["raw_snapshot", "har"]).nullable().optional(),
  artifact_path: z.string().nullable().optional(),
  acceptance_reason: z.string().nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional()
});
export type ReplayAttempt = z.infer<typeof replayAttemptSchema>;

export const artifactGcResultSchema = z.object({
  dry_run: z.boolean().default(false),
  scanned_items: z.number().int().nonnegative(),
  deleted_items: z.number().int().nonnegative(),
  reclaimed_bytes: z.number().int().nonnegative(),
  remaining_bytes: z.number().int().nonnegative(),
  deleted_by_reason: artifactGcReasonBreakdownSchema,
  deleted_by_retention_class: artifactGcRetentionBreakdownSchema
});
export type ArtifactGcResult = z.infer<typeof artifactGcResultSchema>;

export const scrapeRecoveryDiagnosticsSchema = z.object({
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  by_trigger: z.record(z.string(), z.number().int().nonnegative()),
  by_transport_kind: z.record(z.string(), z.number().int().nonnegative()).default({}),
  by_acceptance_reason: z.record(z.string(), z.number().int().nonnegative()).default({})
});
export type ScrapeRecoveryDiagnostics = z.infer<typeof scrapeRecoveryDiagnosticsSchema>;

export const sourceFamilyCoverageEntrySchema = z.object({
  planned: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative()
});
export type SourceFamilyCoverageEntry = z.infer<typeof sourceFamilyCoverageEntrySchema>;

export const sourceFamilyCoverageSchema = z.record(z.string(), sourceFamilyCoverageEntrySchema);
export type SourceFamilyCoverage = z.infer<typeof sourceFamilyCoverageSchema>;

export const promotionCandidateSchema = z.object({
  host: z.string(),
  source_family: z.string(),
  accepted_attempts: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  confidence_avg: z.number().min(0).max(1),
  reason: z.string()
});
export type PromotionCandidate = z.infer<typeof promotionCandidateSchema>;
