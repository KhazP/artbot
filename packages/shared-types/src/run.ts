import { z } from "zod";
import type { RunStatus, SourceAccessStatus } from "./enums.js";
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
