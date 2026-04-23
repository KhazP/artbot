import { z } from "zod";

export const canonicalCurrencySchema = z.enum(["TRY_NEW", "TRL_OLD", "USD", "EUR", "GBP", "UNKNOWN"]);
export type CanonicalCurrency = z.infer<typeof canonicalCurrencySchema>;

export const normalizationDateConfidenceSchema = z.enum(["exact", "month", "year", "unknown"]);
export type NormalizationDateConfidence = z.infer<typeof normalizationDateConfidenceSchema>;

export const normalizationOptionalFieldsSchema = z.object({
  original_amount_raw: z.string().nullable().optional(),
  original_currency_raw: z.string().nullable().optional(),
  original_currency_canonical: canonicalCurrencySchema.nullable().optional(),
  original_event_date: z.string().nullable().optional(),
  date_confidence: normalizationDateConfidenceSchema.optional(),
  currency_interpretation_confidence: z.number().min(0).max(1).nullable().optional(),
  redenomination_applied: z.boolean().optional(),
  redenomination_factor: z.number().nullable().optional(),
  historical_price_try: z.number().nullable().optional(),
  historical_price_usd: z.number().nullable().optional(),
  historical_price_eur: z.number().nullable().optional(),
  current_price_try: z.number().nullable().optional(),
  current_price_usd: z.number().nullable().optional(),
  current_price_eur: z.number().nullable().optional(),
  current_price_as_of_date: z.string().nullable().optional(),
  normalization_notes: z.array(z.string()).optional(),
  normalization_warnings: z.array(z.string()).optional(),
  normalization_confidence_score: z.number().min(0).max(1).nullable().optional(),
  normalization_confidence_reasons: z.array(z.string()).optional(),
  normalization_requires_manual_review: z.boolean().optional()
});

export type NormalizationOptionalFields = z.infer<typeof normalizationOptionalFieldsSchema>;

export const fxRateDailySchema = z.object({
  id: z.string(),
  base_currency: z.literal("EUR"),
  quote_currency: z.enum(["USD", "TRY", "GBP", "EUR"]),
  date: z.string(),
  rate: z.number().positive(),
  source: z.enum(["ecb_api", "tcmb_fallback", "static_fallback"]),
  fetched_at: z.string(),
  quality_flag: z.enum(["historical_exact", "historical_fallback", "current_cache"]).default("historical_exact")
});
export type FxRateDaily = z.infer<typeof fxRateDailySchema>;

export const normalizationEventSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  record_ref: z.string(),
  source_name: z.string(),
  source_url: z.string().url(),
  work_title: z.string().nullable().optional(),
  payload_json: z.record(z.unknown()),
  created_at: z.string()
});
export type NormalizationEvent = z.infer<typeof normalizationEventSchema>;

export const fxCacheStatsSchema = z.object({
  total_rows: z.number().int().nonnegative(),
  unique_dates: z.number().int().nonnegative(),
  latest_date: z.string().nullable(),
  sources: z.record(z.string(), z.number().int().nonnegative()),
  quote_currencies: z.record(z.string(), z.number().int().nonnegative())
});
export type FxCacheStats = z.infer<typeof fxCacheStatsSchema>;
