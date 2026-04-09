import { z } from "zod";
import type { AcceptanceReason, RunStatus, SourceAccessStatus } from "./enums.js";
import type { ResearchQuery } from "./query.js";

export interface RunEntity {
  id: string;
  runType: "artist" | "work";
  query: ResearchQuery;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  reportPath?: string;
  resultsPath?: string;
}

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
  source_candidate_breakdown: z.record(z.string(), z.number().int().nonnegative()),
  source_status_breakdown: z.record(
    z.enum(["public_access", "auth_required", "licensed_access", "blocked", "price_hidden"]),
    z.number().int().nonnegative()
  ),
  auth_mode_breakdown: z.record(z.enum(["anonymous", "authorized", "licensed"]), z.number().int().nonnegative()),
  acceptance_reason_breakdown: z
    .record(
      z.enum([
        "valuation_ready",
        "estimate_range_ready",
        "asking_price_ready",
        "inquiry_only_evidence",
        "price_hidden_evidence",
        "missing_numeric_price",
        "missing_currency",
        "missing_estimate_range",
        "unknown_price_type",
        "blocked_access"
      ]),
      z.number().int().nonnegative()
    )
    .optional(),
  valuation_generated: z.boolean(),
  valuation_reason: z.string()
});

export type RunSummary = z.infer<typeof runSummarySchema>;

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
  "missing_numeric_price",
  "missing_currency",
  "missing_estimate_range",
  "unknown_price_type",
  "blocked_access"
];
