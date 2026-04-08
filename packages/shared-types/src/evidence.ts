import { z } from "zod";
import type { AccessMode, SourceAccessStatus } from "./enums.js";

export const sourceAttemptSchema = z.object({
  run_id: z.string(),
  source_name: z.string(),
  source_url: z.string().url(),
  canonical_url: z.string().url().nullable(),
  access_mode: z.enum(["anonymous", "authorized", "licensed"]),
  source_access_status: z.enum([
    "public_access",
    "auth_required",
    "licensed_access",
    "blocked",
    "price_hidden"
  ]),
  access_reason: z.string().nullable(),
  blocker_reason: z.string().nullable(),
  extracted_fields: z.record(z.unknown()).default({}),
  screenshot_path: z.string().nullable(),
  pre_auth_screenshot_path: z.string().nullable().optional(),
  post_auth_screenshot_path: z.string().nullable().optional(),
  raw_snapshot_path: z.string().nullable(),
  fetched_at: z.string(),
  parser_used: z.string(),
  model_used: z.string().nullable(),
  confidence_score: z.number().min(0).max(1),
  accepted: z.boolean(),
  acceptance_reason: z.string()
});

export type SourceAttempt = z.infer<typeof sourceAttemptSchema>;

export interface AccessContext {
  mode: AccessMode;
  profileId?: string;
  cookieFile?: string;
  manualLoginCheckpoint?: boolean;
  allowLicensed?: boolean;
  licensedIntegrations: string[];
  sourceAccessStatus: SourceAccessStatus;
  accessReason?: string;
  blockerReason?: string;
}
