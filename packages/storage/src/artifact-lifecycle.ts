import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  ArtifactGcResult,
  ArtifactKind,
  ArtifactManifest,
  ArtifactManifestItem,
  ArtifactGcReason,
  ArtifactRetentionClass,
  GcPolicy,
  SourceAttempt
} from "@artbot/shared-types";

export const ARTIFACT_MANIFEST_FILE = "artifact-manifest.json";

function emptyRetentionBreakdown(): ArtifactGcResult["deleted_by_retention_class"] {
  return {
    manifest: 0,
    accepted_evidence: 0,
    disputed_evidence: 0,
    heavy_debug: 0,
    ephemeral: 0
  };
}

function emptyReasonBreakdown(): ArtifactGcResult["deleted_by_reason"] {
  return {
    duplicate: 0,
    expired: 0,
    watermark: 0
  };
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function buildDefaultGcPolicyFromEnv(): GcPolicy {
  return {
    high_watermark_bytes: toPositiveInt(process.env.ARTIFACT_GC_HIGH_WATERMARK_BYTES, 512 * 1024 * 1024),
    target_bytes_after_gc: toPositiveInt(process.env.ARTIFACT_GC_TARGET_BYTES, 384 * 1024 * 1024),
    manifest_retention_days: toPositiveInt(process.env.ARTIFACT_GC_MANIFEST_RETENTION_DAYS, 3650),
    accepted_evidence_retention_days: toPositiveInt(process.env.ARTIFACT_GC_ACCEPTED_RETENTION_DAYS, 180),
    disputed_evidence_retention_days: toPositiveInt(process.env.ARTIFACT_GC_DISPUTED_RETENTION_DAYS, 120),
    heavy_debug_retention_days: toPositiveInt(process.env.ARTIFACT_GC_HEAVY_DEBUG_RETENTION_DAYS, 14),
    ephemeral_retention_days: toPositiveInt(process.env.ARTIFACT_GC_EPHEMERAL_RETENTION_DAYS, 7)
  };
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function relativePath(root: string, target: string): string {
  const rel = path.relative(root, target);
  return rel.length > 0 ? rel : path.basename(target);
}

function statFile(targetPath: string): fs.Stats | null {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function kindForPath(filePath: string): ArtifactKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("report.md")) return "report";
  if (lower.endsWith("results.json")) return "results";
  if (lower.includes("-pre-auth")) return "pre_auth_screenshot";
  if (lower.includes("-post-auth")) return "post_auth_screenshot";
  if (lower.endsWith(".png")) return "screenshot";
  if (lower.endsWith(".html")) return "raw_snapshot";
  if (lower.endsWith(".zip")) return "trace";
  if (lower.endsWith(".har")) return "har";
  if (lower.endsWith(".csv")) return "inventory_export";
  return "other";
}

function retentionClassForArtifact(kind: ArtifactKind, attempt?: SourceAttempt): ArtifactRetentionClass {
  if (kind === "report" || kind === "results") {
    return "manifest";
  }
  if (kind === "trace" || kind === "har") {
    return "heavy_debug";
  }
  if (attempt && !(attempt.accepted_for_evidence ?? attempt.accepted)) {
    return "disputed_evidence";
  }
  return "accepted_evidence";
}

function buildManifestItem(
  runId: string,
  runRoot: string,
  filePath: string,
  attempt?: SourceAttempt
): ArtifactManifestItem | null {
  const stats = statFile(filePath);
  if (!stats || !stats.isFile()) {
    return null;
  }

  const kind = kindForPath(filePath);
  return {
    run_id: runId,
    path: filePath,
    relative_path: relativePath(runRoot, filePath),
    kind,
    retention_class: retentionClassForArtifact(kind, attempt),
    promotion_state: "standard",
    content_hash: hashFile(filePath),
    duplicate_of_content_hash: null,
    size_bytes: stats.size,
    created_at: stats.mtime.toISOString(),
    source_name: attempt?.source_name ?? null,
    source_url: attempt?.source_url ?? null,
    source_legal_posture: attempt?.source_legal_posture,
    artifact_handling: attempt?.artifact_handling,
    export_restricted:
      attempt != null
        ? attempt.access_mode !== "anonymous" || attempt.source_legal_posture === "licensed_only" || attempt.artifact_handling === "internal_only"
        : false,
    accepted_for_evidence: attempt ? Boolean(attempt.accepted_for_evidence ?? attempt.accepted) : undefined,
    disputed: attempt ? !(attempt.accepted_for_evidence ?? attempt.accepted) : undefined,
    deleted_at: null
  };
}

export function buildRunArtifactManifest(input: {
  runId: string;
  runRoot: string;
  reportPath: string;
  resultsPath: string;
  attempts: SourceAttempt[];
  extraPaths?: string[];
  policy?: GcPolicy;
}): ArtifactManifest {
  const items: ArtifactManifestItem[] = [];
  const seenHashes = new Map<string, string>();
  const push = (entry: ArtifactManifestItem | null) => {
    if (!entry) {
      return;
    }
    const duplicateOf = seenHashes.get(entry.content_hash);
    if (duplicateOf) {
      entry.duplicate_of_content_hash = duplicateOf;
    } else {
      seenHashes.set(entry.content_hash, entry.content_hash);
    }
    items.push(entry);
  };

  push(buildManifestItem(input.runId, input.runRoot, input.reportPath));
  push(buildManifestItem(input.runId, input.runRoot, input.resultsPath));

  for (const attempt of input.attempts) {
    for (const candidatePath of [
      attempt.screenshot_path,
      attempt.pre_auth_screenshot_path,
      attempt.post_auth_screenshot_path,
      attempt.raw_snapshot_path,
      attempt.trace_path,
      attempt.har_path
    ]) {
      if (candidatePath) {
        push(buildManifestItem(input.runId, input.runRoot, candidatePath, attempt));
      }
    }
  }

  for (const extraPath of input.extraPaths ?? []) {
    push(buildManifestItem(input.runId, input.runRoot, extraPath));
  }

  return {
    run_id: input.runId,
    generated_at: new Date().toISOString(),
    policy: input.policy ?? buildDefaultGcPolicyFromEnv(),
    total_size_bytes: items.reduce((sum, item) => sum + item.size_bytes, 0),
    items
  };
}

export function writeArtifactManifest(runRoot: string, manifest: ArtifactManifest): string {
  const manifestPath = path.join(runRoot, ARTIFACT_MANIFEST_FILE);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifestPath;
}

export function readArtifactManifest(manifestPath: string): ArtifactManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ArtifactManifest;
  } catch {
    return null;
  }
}

function retentionDaysForClass(policy: GcPolicy, retentionClass: ArtifactRetentionClass): number {
  switch (retentionClass) {
    case "manifest":
      return policy.manifest_retention_days;
    case "accepted_evidence":
      return policy.accepted_evidence_retention_days;
    case "disputed_evidence":
      return policy.disputed_evidence_retention_days;
    case "heavy_debug":
      return policy.heavy_debug_retention_days;
    case "ephemeral":
      return policy.ephemeral_retention_days;
  }
}

function isExpired(item: ArtifactManifestItem, policy: GcPolicy, now: Date): boolean {
  if (
    item.deleted_at
    || item.promotion_state !== "standard"
    || item.retention_class === "manifest"
    || item.export_restricted
  ) {
    return false;
  }
  const createdAt = new Date(item.created_at);
  if (Number.isNaN(createdAt.valueOf())) {
    return false;
  }
  const ageDays = (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays > retentionDaysForClass(policy, item.retention_class);
}

function deleteArtifact(item: ArtifactManifestItem, nowIso: string): number {
  const stats = statFile(item.path);
  if (stats && fs.existsSync(item.path)) {
    fs.rmSync(item.path, { force: true });
  }
  item.deleted_at = nowIso;
  return stats?.size ?? item.size_bytes;
}

function isGcEligible(item: ArtifactManifestItem): boolean {
  return !item.deleted_at && item.promotion_state === "standard" && item.retention_class !== "manifest" && !item.export_restricted;
}

function recordDeletion(
  item: ArtifactManifestItem,
  reason: ArtifactGcReason,
  nowIso: string,
  dryRun: boolean,
  plannedPaths: Set<string>,
  result: Pick<ArtifactGcResult, "deleted_items" | "reclaimed_bytes" | "deleted_by_reason" | "deleted_by_retention_class">
): number {
  plannedPaths.add(item.path);
  const reclaimedBytes = dryRun ? item.size_bytes : deleteArtifact(item, nowIso);
  result.deleted_items += 1;
  result.reclaimed_bytes += reclaimedBytes;
  result.deleted_by_reason[reason] += 1;
  result.deleted_by_retention_class[item.retention_class] += 1;
  return reclaimedBytes;
}

export function runArtifactGc(
  runsRoot: string,
  policy = buildDefaultGcPolicyFromEnv(),
  options: { dryRun?: boolean; now?: Date } = {}
): ArtifactGcResult {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const manifests = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name, ARTIFACT_MANIFEST_FILE))
    .map((manifestPath) => ({ manifestPath, manifest: readArtifactManifest(manifestPath) }))
    .filter((entry): entry is { manifestPath: string; manifest: ArtifactManifest } => Boolean(entry.manifest));

  const allItems = manifests.flatMap((entry) => entry.manifest.items);
  const activeItems = allItems.filter((item) => !item.deleted_at);
  const nowIso = now.toISOString();
  const result: ArtifactGcResult = {
    dry_run: dryRun,
    scanned_items: allItems.length,
    deleted_items: 0,
    reclaimed_bytes: 0,
    remaining_bytes: activeItems.reduce((sum, item) => sum + item.size_bytes, 0),
    deleted_by_reason: emptyReasonBreakdown(),
    deleted_by_retention_class: emptyRetentionBreakdown()
  };
  const plannedPaths = new Set<string>();

  const firstByHash = new Set<string>();
  for (const item of activeItems) {
    if (!isGcEligible(item) || plannedPaths.has(item.path)) {
      continue;
    }
    if (!firstByHash.has(item.content_hash)) {
      firstByHash.add(item.content_hash);
      continue;
    }
    result.remaining_bytes -= recordDeletion(item, "duplicate", nowIso, dryRun, plannedPaths, result);
  }

  for (const item of allItems) {
    if (!plannedPaths.has(item.path) && isExpired(item, policy, now)) {
      result.remaining_bytes -= recordDeletion(item, "expired", nowIso, dryRun, plannedPaths, result);
    }
  }

  let remainingBytes = result.remaining_bytes;
  if (remainingBytes > policy.high_watermark_bytes) {
    const purgeable = allItems
      .filter((item) => isGcEligible(item))
      .sort((left, right) => {
        const classPriority = (value: ArtifactRetentionClass) =>
          value === "heavy_debug" ? 0 : value === "ephemeral" ? 1 : value === "disputed_evidence" ? 2 : 3;
        return classPriority(left.retention_class) - classPriority(right.retention_class)
          || new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      });
    for (const item of purgeable) {
      if (plannedPaths.has(item.path) || item.deleted_at) {
        continue;
      }
      if (remainingBytes <= policy.target_bytes_after_gc) {
        break;
      }
      const reclaimedBytes = recordDeletion(item, "watermark", nowIso, dryRun, plannedPaths, result);
      remainingBytes -= reclaimedBytes;
    }
  }
  result.remaining_bytes = Math.max(0, remainingBytes);

  if (!dryRun) {
    for (const { manifestPath, manifest } of manifests) {
      manifest.total_size_bytes = manifest.items.filter((item) => !item.deleted_at).reduce((sum, item) => sum + item.size_bytes, 0);
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    }
  }

  return result;
}
