import { z } from "zod";
import { priceRecordSchema } from "./record.js";

export const crawlModeSchema = z.enum(["backfill", "refresh"]);
export type CrawlMode = z.infer<typeof crawlModeSchema>;

export const sourceClassSchema = z.enum([
  "auction_house",
  "gallery",
  "dealer",
  "marketplace",
  "database",
  "other"
]);
export type SourceClass = z.infer<typeof sourceClassSchema>;

export const crawlStrategySchema = z.enum([
  "search",
  "archive_index",
  "pagination",
  "catalog_auction",
  "listing_to_lot",
  "sitemap",
  "rendered_dom"
]);
export type CrawlStrategy = z.infer<typeof crawlStrategySchema>;

export const sourceHostStatusSchema = z.enum(["seeded", "discovered", "validated", "blocked"]);
export type SourceHostStatus = z.infer<typeof sourceHostStatusSchema>;

export const sourceTrustTierSchema = z.enum(["formal", "validated", "lead"]);
export type SourceTrustTier = z.infer<typeof sourceTrustTierSchema>;

export const sourceFamilyBucketSchema = z.enum([
  "turkey_first_party",
  "turkey_platform",
  "turkey_gallery_shop_private_sale",
  "global_major",
  "global_marketplace",
  "global_direct_sale",
  "db_meta",
  "open_web"
]);
export type SourceFamilyBucket = z.infer<typeof sourceFamilyBucketSchema>;

export const frontierStatusSchema = z.enum(["pending", "processing", "completed", "failed", "skipped"]);
export type FrontierStatus = z.infer<typeof frontierStatusSchema>;

export const clusterStatusSchema = z.enum(["auto_confirmed", "needs_review", "confirmed", "rejected"]);
export type ClusterStatus = z.infer<typeof clusterStatusSchema>;

export const reviewItemStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type ReviewItemStatus = z.infer<typeof reviewItemStatusSchema>;

export const reviewActionSchema = z.enum(["merge", "keep_separate"]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const sourceHostSchema = z.object({
  id: z.string(),
  host: z.string(),
  source_name: z.string(),
  venue_name: z.string().nullable(),
  source_class: sourceClassSchema,
  host_status: sourceHostStatusSchema,
  trust_tier: sourceTrustTierSchema,
  auth_mode: z.enum(["public", "authorized", "licensed"]),
  crawl_strategies: z.array(crawlStrategySchema),
  base_url: z.string().url().nullable(),
  country: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_crawled_at: z.string().nullable(),
  last_success_at: z.string().nullable()
});
export type SourceHost = z.infer<typeof sourceHostSchema>;

export const frontierItemSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  source_host: z.string(),
  adapter_id: z.string(),
  source_name: z.string(),
  source_family: z.string().default("unknown"),
  source_family_bucket: sourceFamilyBucketSchema.default("open_web"),
  url: z.string().url(),
  source_page_type: z.enum(["lot", "artist_page", "price_db", "listing", "article", "other"]),
  provenance: z.enum(["seed", "query_variant", "listing_expansion", "signature_expansion", "direct_lot", "web_discovery"]),
  score: z.number().min(0).max(1),
  discovered_from_url: z.string().url().nullable(),
  status: frontierStatusSchema,
  retry_count: z.number().int().nonnegative(),
  revisit_after: z.string().nullable(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type FrontierItem = z.infer<typeof frontierItemSchema>;

export const crawlCheckpointSchema = z.object({
  id: z.string(),
  artist_key: z.string(),
  source_host: z.string(),
  section_key: z.string(),
  url: z.string().url(),
  source_page_type: z.enum(["lot", "artist_page", "price_db", "listing", "article", "other"]),
  crawl_mode: crawlModeSchema,
  consecutive_unchanged_windows: z.number().int().nonnegative(),
  last_discovered_count: z.number().int().nonnegative(),
  last_record_count: z.number().int().nonnegative(),
  last_seen_at: z.string(),
  last_changed_at: z.string().nullable(),
  updated_at: z.string()
});
export type CrawlCheckpoint = z.infer<typeof crawlCheckpointSchema>;

export const inventoryRecordSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  record_key: z.string(),
  source_host: z.string(),
  semantic_lane: z.enum(["realized", "estimate", "asking", "inquiry", "unknown"]),
  cluster_id: z.string().nullable(),
  payload: priceRecordSchema,
  created_at: z.string(),
  updated_at: z.string()
});
export type InventoryRecord = z.infer<typeof inventoryRecordSchema>;

export const artworkImageSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  record_key: z.string(),
  source_url: z.string().url(),
  image_url: z.string().url(),
  stored_path: z.string(),
  sha256: z.string(),
  perceptual_hash: z.string().nullable(),
  embedding_vector: z.array(z.number()).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mime_type: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type ArtworkImage = z.infer<typeof artworkImageSchema>;

export const artworkClusterSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  title: z.string(),
  year: z.string().nullable(),
  medium: z.string().nullable(),
  cluster_status: clusterStatusSchema,
  confidence: z.number().min(0).max(1),
  record_count: z.number().int().nonnegative(),
  auto_match_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string()
});
export type ArtworkCluster = z.infer<typeof artworkClusterSchema>;

export const clusterMembershipSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  cluster_id: z.string(),
  record_key: z.string(),
  status: clusterStatusSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string()
});
export type ClusterMembership = z.infer<typeof clusterMembershipSchema>;

export const reviewItemSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  artist_key: z.string(),
  review_type: z.literal("cluster_match"),
  status: reviewItemStatusSchema,
  left_record_key: z.string(),
  right_record_key: z.string(),
  recommended_action: reviewActionSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string()
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const priceStatSchema = z.object({
  count: z.number().int().nonnegative(),
  min: z.number().nullable(),
  avg: z.number().nullable(),
  max: z.number().nullable()
});
export type PriceStat = z.infer<typeof priceStatSchema>;

export const artistMarketInventorySummarySchema = z.object({
  run_id: z.string(),
  artist_key: z.string(),
  crawl_mode: crawlModeSchema,
  total_inventory_records: z.number().int().nonnegative(),
  new_records_added: z.number().int().nonnegative(),
  total_images: z.number().int().nonnegative(),
  discovered_hosts: z.number().int().nonnegative(),
  total_clusters: z.number().int().nonnegative(),
  auto_confirmed_clusters: z.number().int().nonnegative(),
  review_queue_count: z.number().int().nonnegative(),
  crawl_gap_count: z.number().int().nonnegative(),
  per_source_record_counts: z.record(z.string(), z.number().int().nonnegative()),
  price_type_breakdown: z.record(
    z.enum([
      "asking_price",
      "estimate",
      "hammer_price",
      "realized_price",
      "realized_with_buyers_premium",
      "inquiry_only",
      "unknown"
    ]),
    z.number().int().nonnegative()
  ),
  price_stats: z.record(z.enum(["realized", "asking", "estimate"]), priceStatSchema),
  crawl_gaps: z.array(z.string())
});
export type ArtistMarketInventorySummary = z.infer<typeof artistMarketInventorySummarySchema>;
