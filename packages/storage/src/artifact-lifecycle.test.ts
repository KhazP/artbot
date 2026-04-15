import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceAttempt } from "@artbot/shared-types";
import { buildRunArtifactManifest, readArtifactManifest, runArtifactGc, writeArtifactManifest } from "./artifact-lifecycle.js";

const cleanupPaths: string[] = [];

function mkRunRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-artifacts-test-"));
  cleanupPaths.push(root);
  return root;
}

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function makeAttempt(overrides: Partial<SourceAttempt> = {}): SourceAttempt {
  return {
    run_id: "run-1",
    source_name: "Fixture Source",
    source_url: "https://example.com/lot/1",
    canonical_url: "https://example.com/lot/1",
    access_mode: "anonymous",
    source_access_status: "public_access",
    access_reason: "fixture",
    blocker_reason: null,
    extracted_fields: {},
    screenshot_path: null,
    raw_snapshot_path: null,
    fetched_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    parser_used: "fixture",
    model_used: null,
    confidence_score: 0.8,
    accepted: true,
    acceptance_reason: "valuation_ready",
    ...overrides
  };
}

describe("artifact lifecycle", () => {
  it("builds manifests and removes duplicate heavy artifacts during gc", () => {
    const runsRoot = mkRunRoot();
    const runRoot = path.join(runsRoot, "run-1");
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });

    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const traceA = path.join(runRoot, "evidence", "traces", "a.zip");
    const traceB = path.join(runRoot, "evidence", "traces", "b.zip");

    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(traceA, "same-payload", "utf-8");
    fs.writeFileSync(traceB, "same-payload", "utf-8");

    const manifest = buildRunArtifactManifest({
      runId: "run-1",
      runRoot,
      reportPath,
      resultsPath,
      attempts: [
        makeAttempt({ trace_path: traceA }),
        makeAttempt({ source_url: "https://example.com/lot/2", trace_path: traceB })
      ]
    });
    writeArtifactManifest(runRoot, manifest);

    const result = runArtifactGc(runsRoot, {
      high_watermark_bytes: 1,
      target_bytes_after_gc: 1,
      manifest_retention_days: 3650,
      accepted_evidence_retention_days: 180,
      disputed_evidence_retention_days: 120,
      heavy_debug_retention_days: 3650,
      ephemeral_retention_days: 7
    });

    expect(result.deleted_items).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(traceA) && fs.existsSync(traceB)).toBe(false);
  });

  it("supports dry-run gc without deleting artifacts and reports deletion breakdowns", () => {
    const runsRoot = mkRunRoot();
    const runRoot = path.join(runsRoot, "run-dry");
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });

    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const tracePath = path.join(runRoot, "evidence", "traces", "old.zip");
    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(tracePath, "debug-payload", "utf-8");
    fs.utimesSync(tracePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

    const manifest = buildRunArtifactManifest({
      runId: "run-dry",
      runRoot,
      reportPath,
      resultsPath,
      attempts: [makeAttempt({ trace_path: tracePath })]
    });
    writeArtifactManifest(runRoot, manifest);

    const result = runArtifactGc(
      runsRoot,
      {
        high_watermark_bytes: 1024 * 1024,
        target_bytes_after_gc: 512 * 1024,
        manifest_retention_days: 3650,
        accepted_evidence_retention_days: 180,
        disputed_evidence_retention_days: 120,
        heavy_debug_retention_days: 14,
        ephemeral_retention_days: 7
      },
      {
        dryRun: true,
        now: new Date("2026-02-01T00:00:00.000Z")
      }
    );

    expect(result.dry_run).toBe(true);
    expect(result.deleted_items).toBe(1);
    expect(result.deleted_by_reason.expired).toBe(1);
    expect(result.deleted_by_retention_class.heavy_debug).toBe(1);
    expect(fs.existsSync(tracePath)).toBe(true);
    expect(readArtifactManifest(path.join(runRoot, "artifact-manifest.json"))?.items[2]?.deleted_at ?? null).toBeNull();
  });

  it("preserves export-restricted artifacts during gc", () => {
    const runsRoot = mkRunRoot();
    const runRoot = path.join(runsRoot, "run-restricted");
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });

    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const tracePath = path.join(runRoot, "evidence", "traces", "licensed.zip");
    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(tracePath, "licensed-debug", "utf-8");
    fs.utimesSync(tracePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

    const manifest = buildRunArtifactManifest({
      runId: "run-restricted",
      runRoot,
      reportPath,
      resultsPath,
      attempts: [
        makeAttempt({
          access_mode: "licensed",
          source_legal_posture: "licensed_only",
          artifact_handling: "internal_only",
          trace_path: tracePath
        })
      ]
    });
    writeArtifactManifest(runRoot, manifest);

    const result = runArtifactGc(
      runsRoot,
      {
        high_watermark_bytes: 1,
        target_bytes_after_gc: 1,
        manifest_retention_days: 3650,
        accepted_evidence_retention_days: 1,
        disputed_evidence_retention_days: 1,
        heavy_debug_retention_days: 1,
        ephemeral_retention_days: 1
      },
      {
        now: new Date("2026-02-01T00:00:00.000Z")
      }
    );

    expect(result.deleted_items).toBe(0);
    expect(fs.existsSync(tracePath)).toBe(true);
  });
});
