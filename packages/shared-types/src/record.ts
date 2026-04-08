import { z } from "zod";
import type { PriceType, SourceAccessStatus, SourcePageType, VenueType } from "./enums.js";

export const priceRecordSchema = z.object({
  artist_name: z.string(),
  work_title: z.string().nullable(),
  alternate_title: z.string().nullable(),
  year: z.string().nullable(),
  medium: z.string().nullable(),
  support: z.string().nullable(),
  dimensions_text: z.string().nullable(),
  height_cm: z.number().nullable(),
  width_cm: z.number().nullable(),
  depth_cm: z.number().nullable(),
  signed: z.boolean().nullable(),
  dated: z.boolean().nullable(),
  edition_info: z.string().nullable(),
  is_unique_work: z.boolean().nullable(),
  venue_name: z.string(),
  venue_type: z.enum(["auction_house", "gallery", "dealer", "marketplace", "database", "other"]),
  city: z.string().nullable(),
  country: z.string().nullable(),
  source_name: z.string(),
  source_url: z.string().url(),
  source_page_type: z.enum(["lot", "artist_page", "price_db", "listing", "article", "other"]),
  sale_or_listing_date: z.string().nullable(),
  lot_number: z.string().nullable(),
  price_type: z.enum([
    "asking_price",
    "estimate",
    "hammer_price",
    "realized_price",
    "realized_with_buyers_premium",
    "inquiry_only",
    "unknown"
  ]),
  estimate_low: z.number().nullable(),
  estimate_high: z.number().nullable(),
  price_amount: z.number().nullable(),
  currency: z.string().nullable(),
  normalized_price_try: z.number().nullable(),
  normalized_price_usd: z.number().nullable(),
  buyers_premium_included: z.boolean().nullable(),
  image_url: z.string().url().nullable(),
  screenshot_path: z.string().nullable(),
  raw_snapshot_path: z.string().nullable(),
  visual_match_score: z.number().nullable(),
  metadata_match_score: z.number().nullable(),
  overall_confidence: z.number().min(0).max(1),
  price_hidden: z.boolean(),
  source_access_status: z
    .enum(["public_access", "auth_required", "licensed_access", "blocked", "price_hidden"])
    .default("public_access"),
  notes: z.array(z.string())
});

export type PriceRecord = z.infer<typeof priceRecordSchema>;

export interface PriceRecordInput extends Omit<PriceRecord, "venue_type" | "source_page_type" | "price_type" | "source_access_status"> {
  venue_type: VenueType;
  source_page_type: SourcePageType;
  price_type: PriceType;
  source_access_status: SourceAccessStatus;
}
