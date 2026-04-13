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

export const discoveryProviderSchema = z.enum(["none", "brave", "tavily"]);
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
  results_returned: z.number().int().nonnegative()
});
export type DiscoveryProviderDiagnostics = z.infer<typeof discoveryProviderDiagnosticsSchema>;

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
  updated_at: z.string()
});
export type HostHealthRecord = z.infer<typeof hostHealthRecordSchema>;

export const replayAttemptSchema = z.object({
  run_id: z.string(),
  source_name: z.string(),
  source_url: z.string(),
  raw_snapshot_path: z.string().nullable(),
  har_path: z.string().nullable(),
  parser_used: z.string(),
  cached_url_hash: z.string().nullable().optional()
});
export type ReplayAttempt = z.infer<typeof replayAttemptSchema>;

export const artifactGcResultSchema = z.object({
  scanned_items: z.number().int().nonnegative(),
  deleted_items: z.number().int().nonnegative(),
  reclaimed_bytes: z.number().int().nonnegative(),
  remaining_bytes: z.number().int().nonnegative()
});
export type ArtifactGcResult = z.infer<typeof artifactGcResultSchema>;
