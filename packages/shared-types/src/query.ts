import { z } from "zod";
import { crawlModeSchema, sourceClassSchema } from "./inventory.js";

export const researchQuerySchema = z.object({
  artist: z.string().min(1),
  title: z.string().optional(),
  year: z.string().optional(),
  medium: z.string().optional(),
  dimensions: z
    .object({
      heightCm: z.number().positive().optional(),
      widthCm: z.number().positive().optional(),
      depthCm: z.number().positive().optional(),
      dimensionsText: z.string().optional()
    })
    .optional(),
  imagePath: z.string().optional(),
  dateRange: z
    .object({
      from: z.string().optional(),
      to: z.string().optional()
    })
    .optional(),
  scope: z.enum(["turkey_only", "turkey_plus_international"]).default("turkey_plus_international"),
  turkeyFirst: z.boolean().default(true),
  analysisMode: z.enum(["comprehensive", "balanced", "fast"]).default("balanced"),
  priceNormalization: z.enum(["legacy", "usd_dual", "usd_nominal", "usd_2026"]).default("usd_dual"),
  authProfileId: z.string().optional(),
  cookieFile: z.string().optional(),
  manualLoginCheckpoint: z.boolean().default(false),
  allowLicensed: z.boolean().default(false),
  licensedIntegrations: z.array(z.string()).default([]),
  crawlMode: crawlModeSchema.default("backfill"),
  sourceClasses: z
    .array(sourceClassSchema)
    .default(["auction_house", "gallery", "dealer", "marketplace", "database"])
});

export type ResearchQuery = z.infer<typeof researchQuerySchema>;

export const researchArtistRequestSchema = z.object({
  query: researchQuerySchema
});

export const researchWorkRequestSchema = z.object({
  query: researchQuerySchema.extend({
    title: z.string().min(1)
  })
});

export const artistMarketInventoryRequestSchema = z.object({
  query: researchQuerySchema
});
