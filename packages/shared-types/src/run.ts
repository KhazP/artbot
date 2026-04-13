import { z } from "zod";
import type { AcceptanceReason, FailureClass, RunStatus, RunType, SourceAccessStatus } from "./enums.js";
import { sourceAttemptSchema } from "./evidence.js";
import {
  artistMarketInventorySummarySchema,
  artworkClusterSchema,
  artworkImageSchema,
  clusterMembershipSchema,
  crawlCheckpointSchema,
  inventoryRecordSchema,
  reviewItemSchema,
  sourceHostSchema
} from "./inventory.js";
import {
  artifactManifestSchema,
  evaluationMetricsSchema,
  hostHealthRecordSchema,
  recommendedActionSchema,
  sourcePlanItemSchema
} from "./operations.js";
import { researchQuerySchema } from "./query.js";
import { priceRecordSchema } from "./record.js";

export const runEntitySchema = z.object({
  id: z.string(),
  runType: z.enum(["artist", "work", "artist_market_inventory"]),
  query: researchQuerySchema,
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
  reportPath: z.string().optional(),
  resultsPath: z.string().optional()
});

export type RunEntity = z.infer<typeof runEntitySchema>;

export const runSummarySchema = z.object({
  run_id: z.string(),
  total_records: z.number().int().nonnegative(),
  total_attempts: z.number().int().nonnegative().optional(),
  evidence_records: z.number().int().nonnegative().optional(),
  valuation_eligible_records: z.number().int().nonnegative().optional(),
  accepted_records: z.number().int().nonnegative(),
  rejected_candidates: z.number().int().nonnegative(),
  discovered_candidates: z.number().int().nonnegative(),
  accepted_from_discovery: z.number().int().nonnegative(),
  priced_source_coverage_ratio: z.number().min(0).max(1).optional(),
  priced_crawled_source_coverage_ratio: z.number().min(0).max(1).optional(),
  price_type_breakdown: z
    .record(z.enum(["realized", "estimate", "asking", "inquiry", "unknown"]), z.number().int().nonnegative())
    .optional(),
  cluster_count: z.number().int().nonnegative().optional(),
  auto_clustered_records: z.number().int().nonnegative().optional(),
  review_item_count: z.number().int().nonnegative().optional(),
  source_candidate_breakdown: z.record(z.string(), z.number().int().nonnegative()),
  source_status_breakdown: z.record(
    z.enum(["public_access", "auth_required", "licensed_access", "blocked", "price_hidden"]),
    z.number().int().nonnegative()
  ),
  auth_mode_breakdown: z.record(z.enum(["anonymous", "authorized", "licensed"]), z.number().int().nonnegative()),
  failure_class_breakdown: z
    .record(
      z.enum([
        "access_blocked",
        "waf_challenge",
        "not_found",
        "transport_timeout",
        "transport_dns",
        "transport_other",
        "host_circuit"
      ]),
      z.number().int().nonnegative()
    )
    .optional(),
  acceptance_reason_breakdown: z
    .record(
      z.enum([
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
      z.number().int().nonnegative()
    )
    .optional(),
  evaluation_metrics: evaluationMetricsSchema.optional(),
  persisted_source_health: z.array(hostHealthRecordSchema).optional(),
  valuation_generated: z.boolean(),
  valuation_reason: z.string()
});

export type RunSummary = z.infer<typeof runSummarySchema>;

export const artistMarketInventoryArtifactsSchema = z.object({
  report_path: z.string(),
  inventory_path: z.string(),
  clusters_path: z.string(),
  review_queue_path: z.string(),
  inventory_csv_path: z.string(),
  clusters_csv_path: z.string(),
  review_queue_csv_path: z.string()
});
export type ArtistMarketInventoryArtifacts = z.infer<typeof artistMarketInventoryArtifactsSchema>;

export const artistMarketInventoryResultsPayloadSchema = z.object({
  run: runEntitySchema,
  summary: runSummarySchema,
  inventory_summary: artistMarketInventorySummarySchema,
  inventory: z.array(inventoryRecordSchema),
  clusters: z.array(artworkClusterSchema),
  cluster_memberships: z.array(clusterMembershipSchema),
  review_queue: z.array(reviewItemSchema),
  source_hosts: z.array(sourceHostSchema),
  checkpoints: z.array(crawlCheckpointSchema),
  artifacts: artistMarketInventoryArtifactsSchema
});
export type ArtistMarketInventoryResultsPayload = z.infer<typeof artistMarketInventoryResultsPayloadSchema>;

export const runDetailsResponseSchema = z.object({
  run: runEntitySchema,
  summary: runSummarySchema,
  records: z.array(priceRecordSchema),
  attempts: z.array(sourceAttemptSchema),
  source_plan: z.array(sourcePlanItemSchema).optional(),
  recommended_actions: z.array(recommendedActionSchema).optional(),
  artifact_manifest: artifactManifestSchema.optional(),
  persisted_source_health: z.array(hostHealthRecordSchema).optional(),
  valuation: z.unknown().optional(),
  duplicates: z.array(priceRecordSchema).optional(),
  per_painting_stats: z.array(z.unknown()).optional(),
  inventory_summary: artistMarketInventorySummarySchema.optional(),
  inventory: z.array(inventoryRecordSchema).optional(),
  artwork_images: z.array(artworkImageSchema).optional(),
  clusters: z.array(artworkClusterSchema).optional(),
  cluster_memberships: z.array(clusterMembershipSchema).optional(),
  review_queue: z.array(reviewItemSchema).optional(),
  source_hosts: z.array(sourceHostSchema).optional(),
  checkpoints: z.array(crawlCheckpointSchema).optional(),
  artifacts: artistMarketInventoryArtifactsSchema.optional()
});
export type RunDetailsResponsePayload = z.infer<typeof runDetailsResponseSchema>;

export const sourceStatusList: SourceAccessStatus[] = [
  "public_access",
  "auth_required",
  "licensed_access",
  "blocked",
  "price_hidden"
];

export const acceptanceReasonList: AcceptanceReason[] = [
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
];

export const failureClassList: FailureClass[] = [
  "access_blocked",
  "waf_challenge",
  "not_found",
  "transport_timeout",
  "transport_dns",
  "transport_other",
  "host_circuit"
];
