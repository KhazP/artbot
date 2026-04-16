import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { researchQuerySchema, type SourceAttempt } from "@artbot/shared-types";
import { ArtbotStorage } from "./storage.js";
import { buildRunArtifactManifest, readArtifactManifest, writeArtifactManifest } from "./artifact-lifecycle.js";

const cleanupPaths: string[] = [];

function mkTempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-storage-test-"));
  cleanupPaths.push(root);
  return {
    dbPath: path.join(root, "artbot.db"),
    runsRoot: path.join(root, "runs")
  };
}

function query(artist: string) {
  return researchQuerySchema.parse({
    artist,
    scope: "turkey_plus_international" as const,
    turkeyFirst: true,
    analysisMode: "balanced" as const,
    priceNormalization: "usd_dual" as const,
    manualLoginCheckpoint: false,
    allowLicensed: false,
    licensedIntegrations: [],
    crawlMode: "backfill" as const,
    sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
  });
}

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("ArtbotStorage listRuns", () => {
  it("lists runs in reverse-chronological order with optional status filter", async () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const first = storage.createRun("artist", query("Artist One"));
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = storage.createRun("work", query("Artist Two"));
    storage.failRun(first.id, "failure");

    const all = storage.listRuns(10);
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);

    const failedOnly = storage.listRuns(10, "failed");
    expect(failedOnly.length).toBe(1);
    expect(failedOnly[0].id).toBe(first.id);
    expect(failedOnly[0].status).toBe("failed");
  });

  it("persists pinned run state across reloads", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const run = storage.createRun("artist", query("Pinned Artist"));
    expect(run.pinned).toBe(false);

    const pinned = storage.pinRun(run.id);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.pinnedAt).toBeDefined();

    const reloaded = new ArtbotStorage(dbPath, runsRoot);
    expect(reloaded.getRun(run.id)?.pinned).toBe(true);
    expect(reloaded.listRuns(10)[0]?.pinned).toBe(true);

    const unpinned = reloaded.unpinRun(run.id);
    expect(unpinned?.pinned).toBe(false);
    expect(unpinned?.pinnedAt).toBeUndefined();
  });
});

describe("ArtbotStorage storage usage summary", () => {
  it("reports total bytes with pinned vs expirable run splits", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const pinnedRun = storage.createRun("artist", query("Pinned Summary Artist"));
    const completedRun = storage.createRun("artist", query("Completed Summary Artist"));
    const failedRun = storage.createRun("artist", query("Failed Summary Artist"));
    const runningRun = storage.createRun("artist", query("Running Summary Artist"));

    storage.pinRun(pinnedRun.id);
    storage.failRun(failedRun.id, "fixture failure");
    storage.reserveRun(runningRun.id, "worker-summary", 60_000);

    const pinnedFile = path.join(runsRoot, pinnedRun.id, "pin.txt");
    fs.mkdirSync(path.dirname(pinnedFile), { recursive: true });
    fs.writeFileSync(pinnedFile, "pin", "utf-8");

    const completedRoot = path.join(runsRoot, completedRun.id);
    fs.mkdirSync(completedRoot, { recursive: true });
    const completedReportPath = path.join(completedRoot, "report.md");
    const completedResultsPath = path.join(completedRoot, "results.json");
    fs.writeFileSync(completedReportPath, "report!", "utf-8");
    fs.writeFileSync(completedResultsPath, "{}", "utf-8");
    storage.completeRun(completedRun.id, completedReportPath, completedResultsPath);

    const failedFile = path.join(runsRoot, failedRun.id, "failure.txt");
    fs.mkdirSync(path.dirname(failedFile), { recursive: true });
    fs.writeFileSync(failedFile, "error", "utf-8");

    const runningFile = path.join(runsRoot, runningRun.id, "active.txt");
    fs.mkdirSync(path.dirname(runningFile), { recursive: true });
    fs.writeFileSync(runningFile, "active!", "utf-8");

    const summary = storage.getStorageUsageSummary();
    expect(summary.total_runs).toBe(4);
    expect(summary.total_bytes).toBe(24);
    expect(summary.pinned).toEqual({
      runs: 1,
      bytes: 3
    });
    expect(summary.expirable).toEqual({
      runs: 2,
      bytes: 14
    });
  });

  it("persists last cleanup metadata only for non-dry-run gc", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const initialCleanupAt = new Date("2026-04-15T00:00:00.000Z");
    const first = storage.runArtifactGc({ now: initialCleanupAt });
    expect(first.last_cleanup).toEqual({
      reclaimed_bytes: first.reclaimed_bytes,
      timestamp: initialCleanupAt.toISOString(),
      dry_run: false
    });
    expect(first.observed_cleanup).toBeUndefined();
    expect(storage.getStorageUsageSummary().last_cleanup).toEqual(first.last_cleanup);

    const dryRunAt = new Date("2026-04-16T00:00:00.000Z");
    const dryRun = storage.runArtifactGc({ dryRun: true, now: dryRunAt });
    expect(dryRun.last_cleanup).toEqual(first.last_cleanup);
    expect(dryRun.observed_cleanup).toEqual({
      reclaimed_bytes: dryRun.reclaimed_bytes,
      timestamp: dryRunAt.toISOString(),
      dry_run: true
    });
    expect(storage.getStorageUsageSummary().last_cleanup).toEqual(first.last_cleanup);

    const nextCleanupAt = new Date("2026-04-16T01:00:00.000Z");
    const second = storage.runArtifactGc({ now: nextCleanupAt });
    expect(second.last_cleanup).toEqual({
      reclaimed_bytes: second.reclaimed_bytes,
      timestamp: nextCleanupAt.toISOString(),
      dry_run: false
    });
    expect(storage.getStorageUsageSummary().last_cleanup).toEqual(second.last_cleanup);
  });
});

describe("ArtbotStorage lease lifecycle", () => {
  it("supports reserve, heartbeat and stale recovery", async () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const run = storage.createRun("artist", query("Lease Artist"));
    const reserved = storage.reserveRun(run.id, "worker-a", 1);
    expect(reserved).toBe(true);

    const heartbeat = storage.heartbeatRun(run.id, "worker-a", 1);
    expect(heartbeat).toBe(true);

    const wrongWorkerHeartbeat = storage.heartbeatRun(run.id, "worker-b", 1);
    expect(wrongWorkerHeartbeat).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const recovered = storage.recoverStaleRunningRuns(0, "forced stale recovery");
    expect(recovered).toContain(run.id);

    const updated = storage.getRun(run.id);
    expect(updated?.status).toBe("failed");
  });
});

describe("ArtbotStorage frontier enqueue", () => {
  it("resets stale processing frontier rows to pending and refreshes ordering timestamp for a new run", async () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const firstRun = storage.createRun("artist_market_inventory", query("Abidin Dino"));
    const secondRun = storage.createRun("artist_market_inventory", query("Abidin Dino"));

    const first = storage.enqueueFrontierItem({
      run_id: firstRun.id,
      artist_key: "abidin-dino",
      source_host: "www.example.com",
      adapter_id: "example-adapter",
      source_name: "Example Source",
      url: "https://www.example.com/lot/123",
      source_page_type: "lot",
      provenance: "seed",
      score: 0.9,
      discovered_from_url: null
    });
    storage.markFrontierProcessing(first.id);
    await new Promise((resolve) => setTimeout(resolve, 2));

    storage.enqueueFrontierItem({
      run_id: secondRun.id,
      artist_key: "abidin-dino",
      source_host: "www.example.com",
      adapter_id: "example-adapter",
      source_name: "Example Source",
      url: "https://www.example.com/lot/123",
      source_page_type: "lot",
      provenance: "seed",
      score: 0.9,
      discovered_from_url: null
    });

    const pendingForSecondRun = storage.listPendingFrontier(secondRun.id, 10);
    expect(pendingForSecondRun).toHaveLength(1);
    expect(pendingForSecondRun[0]?.url).toBe("https://www.example.com/lot/123");
    expect(pendingForSecondRun[0]?.status).toBe("pending");
    expect(pendingForSecondRun[0]?.created_at).not.toBe(first.created_at);
  });

  it("keeps per-adapter frontier entries when different families share the same URL", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);
    const run = storage.createRun("artist_market_inventory", query("Abidin Dino"));

    storage.enqueueFrontierItem({
      run_id: run.id,
      artist_key: "abidin-dino",
      source_host: "artam.com",
      adapter_id: "artam-auction-records",
      source_name: "Artam Auction Records",
      url: "https://artam.com/api/v1/auction/online-products/get-detail?id=60455",
      source_page_type: "lot",
      provenance: "seed",
      score: 0.9,
      discovered_from_url: null
    });
    storage.enqueueFrontierItem({
      run_id: run.id,
      artist_key: "abidin-dino",
      source_host: "artam.com",
      adapter_id: "artam-lot",
      source_name: "Artam Lots",
      url: "https://artam.com/api/v1/auction/online-products/get-detail?id=60455",
      source_page_type: "lot",
      provenance: "seed",
      score: 0.9,
      discovered_from_url: null
    });

    const pending = storage.listPendingFrontier(run.id, 10);
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((item) => item.adapter_id))).toEqual(
      new Set(["artam-auction-records", "artam-lot"])
    );
  });
});

describe("ArtbotStorage reliability persistence", () => {
  it("aggregates source attempt metrics", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const firstAttempt: SourceAttempt = {
      run_id: "run-1",
      source_name: "Sanatfiyat",
      source_family: "sanatfiyat",
      venue_name: "Sanatfiyat",
      source_url: "https://example.com/lot/1",
      canonical_url: "https://example.com/lot/1",
      access_mode: "licensed",
      source_legal_posture: "licensed_only",
      source_access_status: "licensed_access",
      access_reason: "licensed fixture",
      blocker_reason: null,
      extracted_fields: { price_amount: 55000, currency: "TRY" },
      screenshot_path: null,
      raw_snapshot_path: null,
      fetched_at: "2026-04-14T10:00:00.000Z",
      parser_used: "fixture",
      model_used: null,
      confidence_score: 0.82,
      accepted: true,
      accepted_for_evidence: true,
      accepted_for_valuation: true,
      valuation_lane: "asking",
      acceptance_reason: "asking_price_ready"
    };
    const secondAttempt: SourceAttempt = {
      ...firstAttempt,
      run_id: "run-2",
      source_url: "https://example.com/lot/2",
      canonical_url: "https://example.com/lot/2",
      source_access_status: "blocked",
      failure_class: "access_blocked",
      blocker_reason: "challenge",
      extracted_fields: {},
      fetched_at: "2026-04-14T11:00:00.000Z",
      accepted: false,
      accepted_for_evidence: false,
      accepted_for_valuation: false,
      valuation_lane: "none",
      acceptance_reason: "blocked_access"
    };

    storage.recordSourceAttempt(firstAttempt);
    const aggregated = storage.recordSourceAttempt(secondAttempt);

    expect(aggregated.source_name).toBe("Sanatfiyat");
    expect(aggregated.total_attempts).toBe(2);
    expect(aggregated.price_signal_count).toBe(1);
    expect(aggregated.accepted_for_evidence_count).toBe(1);
    expect(aggregated.valuation_ready_count).toBe(1);
    expect(aggregated.blocked_count).toBe(1);
    expect(aggregated.failure_count).toBe(1);
    expect(storage.listSourceHealth()[0]?.source_name).toBe("Sanatfiyat");
  });

  it("persists and filters canary results", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    storage.saveCanaryResult({
      id: "canary-1",
      family: "sanatfiyat",
      source_name: "Sanatfiyat",
      fixture: "sanatfiyat/licensed.html",
      source_page_type: "listing",
      legal_posture: "licensed_only",
      expected_price_type: "asking_price",
      observed_price_type: "asking_price",
      acceptance_reason: "asking_price_ready",
      accepted_for_evidence: true,
      accepted_for_valuation: true,
      status: "pass",
      details: "Parsed asking price.",
      recorded_at: "2026-04-14T12:00:00.000Z"
    });
    storage.saveCanaryResult({
      id: "canary-2",
      family: "invaluable",
      source_name: "Invaluable",
      fixture: "invaluable/lot.html",
      source_page_type: "lot",
      legal_posture: "public_contract_sensitive",
      expected_price_type: "realized_price",
      observed_price_type: "realized_price",
      acceptance_reason: "valuation_ready",
      accepted_for_evidence: true,
      accepted_for_valuation: true,
      status: "pass",
      details: "Parsed realized price.",
      recorded_at: "2026-04-14T12:05:00.000Z"
    });

    expect(storage.listCanaryResults(10)).toHaveLength(2);
    expect(storage.listCanaryResults(10, "sanatfiyat")).toHaveLength(1);
    expect(storage.listCanaryResults(10, "sanatfiyat")[0]?.source_name).toBe("Sanatfiyat");
  });
});

describe("ArtbotStorage review adjudication", () => {
  it("drops stale review items when clusters are rebuilt", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);
    const now = "2026-04-14T12:00:00.000Z";
    const artistKey = "burhan-dogancay";

    storage.replaceRunClusters(
      artistKey,
      [
        {
          id: "cluster-1",
          run_id: "run-1",
          artist_key: artistKey,
          title: "Untitled",
          year: null,
          medium: null,
          cluster_status: "needs_review",
          confidence: 0.78,
          record_count: 2,
          auto_match_count: 0,
          created_at: now,
          updated_at: now
        }
      ],
      [
        {
          id: "membership-1",
          run_id: "run-1",
          artist_key: artistKey,
          cluster_id: "cluster-1",
          record_key: "left",
          status: "needs_review",
          confidence: 0.78,
          reasons: ["title_similarity:0.62"],
          created_at: now,
          updated_at: now
        }
      ],
      [
        {
          id: "review-1",
          run_id: "run-1",
          artist_key: artistKey,
          review_type: "cluster_match",
          status: "pending",
          left_record_key: "left",
          right_record_key: "right",
          recommended_action: "keep_separate",
          confidence: 0.78,
          reasons: ["title_similarity:0.62"],
          created_at: now,
          updated_at: now
        }
      ]
    );

    const adjudicated = storage.adjudicateReviewItem(artistKey, "review-1", "merge");
    expect(adjudicated?.status).toBe("accepted");
    expect(adjudicated?.recommended_action).toBe("merge");

    storage.replaceRunClusters(
      artistKey,
      [
        {
          id: "cluster-1",
          run_id: "run-2",
          artist_key: artistKey,
          title: "Untitled",
          year: null,
          medium: null,
          cluster_status: "confirmed",
          confidence: 0.83,
          record_count: 2,
          auto_match_count: 1,
          created_at: now,
          updated_at: "2026-04-14T12:05:00.000Z"
        }
      ],
      [],
      []
    );

    const persisted = storage.listReviewItemsByArtist(artistKey);
    expect(persisted).toHaveLength(0);
  });
});

describe("ArtbotStorage completeRun", () => {
  it("runs automatic artifact gc after completion without deleting manifest surfaces", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);
    const run = storage.createRun("artist", query("GC Artist"));
    const runRoot = path.join(runsRoot, run.id);
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });

    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const traceA = path.join(runRoot, "evidence", "traces", "a.zip");
    const traceB = path.join(runRoot, "evidence", "traces", "b.zip");
    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(traceA, "same-payload", "utf-8");
    fs.writeFileSync(traceB, "same-payload", "utf-8");

    const attempts: SourceAttempt[] = [
      {
        run_id: run.id,
        source_name: "Fixture Source",
        source_family: "fixture",
        venue_name: "Fixture Venue",
        source_url: "https://example.com/lot/1",
        canonical_url: "https://example.com/lot/1",
        access_mode: "anonymous",
        source_legal_posture: "public_permitted",
        artifact_handling: "standard",
        source_access_status: "public_access",
        access_reason: "fixture",
        blocker_reason: null,
        extracted_fields: {},
        screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: traceA,
        har_path: null,
        fetched_at: "2026-04-14T10:00:00.000Z",
        parser_used: "fixture",
        model_used: null,
        confidence_score: 0.8,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "asking",
        acceptance_reason: "asking_price_ready"
      },
      {
        run_id: run.id,
        source_name: "Fixture Source",
        source_family: "fixture",
        venue_name: "Fixture Venue",
        source_url: "https://example.com/lot/2",
        canonical_url: "https://example.com/lot/2",
        access_mode: "anonymous",
        source_legal_posture: "public_permitted",
        artifact_handling: "standard",
        source_access_status: "public_access",
        access_reason: "fixture",
        blocker_reason: null,
        extracted_fields: {},
        screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: traceB,
        har_path: null,
        fetched_at: "2026-04-14T10:01:00.000Z",
        parser_used: "fixture",
        model_used: null,
        confidence_score: 0.8,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "asking",
        acceptance_reason: "asking_price_ready"
      }
    ];
    writeArtifactManifest(
      runRoot,
      buildRunArtifactManifest({
        runId: run.id,
        runRoot,
        reportPath,
        resultsPath,
        attempts
      })
    );

    storage.completeRun(run.id, reportPath, resultsPath);

    expect(storage.getRun(run.id)?.status).toBe("completed");
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.existsSync(resultsPath)).toBe(true);
    expect(fs.existsSync(traceA) || fs.existsSync(traceB)).toBe(true);
    expect(fs.existsSync(traceA) && fs.existsSync(traceB)).toBe(false);
    expect(readArtifactManifest(path.join(runRoot, "artifact-manifest.json"))?.items.some((item) => item.deleted_at)).toBe(true);
  });

  it("preserves pinned run artifacts during automatic gc", () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);
    const run = storage.createRun("artist", query("Pinned GC Artist"));
    const runRoot = path.join(runsRoot, run.id);
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });

    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const traceA = path.join(runRoot, "evidence", "traces", "a.zip");
    const traceB = path.join(runRoot, "evidence", "traces", "b.zip");
    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(traceA, "same-payload", "utf-8");
    fs.writeFileSync(traceB, "same-payload", "utf-8");

    const attempts: SourceAttempt[] = [
      {
        run_id: run.id,
        source_name: "Fixture Source",
        source_family: "fixture",
        venue_name: "Fixture Venue",
        source_url: "https://example.com/lot/1",
        canonical_url: "https://example.com/lot/1",
        access_mode: "anonymous",
        source_legal_posture: "public_permitted",
        artifact_handling: "standard",
        source_access_status: "public_access",
        access_reason: "fixture",
        blocker_reason: null,
        extracted_fields: {},
        screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: traceA,
        har_path: null,
        fetched_at: "2026-04-14T10:00:00.000Z",
        parser_used: "fixture",
        model_used: null,
        confidence_score: 0.8,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "asking",
        acceptance_reason: "asking_price_ready"
      },
      {
        run_id: run.id,
        source_name: "Fixture Source",
        source_family: "fixture",
        venue_name: "Fixture Venue",
        source_url: "https://example.com/lot/2",
        canonical_url: "https://example.com/lot/2",
        access_mode: "anonymous",
        source_legal_posture: "public_permitted",
        artifact_handling: "standard",
        source_access_status: "public_access",
        access_reason: "fixture",
        blocker_reason: null,
        extracted_fields: {},
        screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: traceB,
        har_path: null,
        fetched_at: "2026-04-14T10:01:00.000Z",
        parser_used: "fixture",
        model_used: null,
        confidence_score: 0.8,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "asking",
        acceptance_reason: "asking_price_ready"
      }
    ];
    writeArtifactManifest(
      runRoot,
      buildRunArtifactManifest({
        runId: run.id,
        runRoot,
        reportPath,
        resultsPath,
        attempts
      })
    );

    storage.pinRun(run.id);
    storage.completeRun(run.id, reportPath, resultsPath);

    const manifest = readArtifactManifest(path.join(runRoot, "artifact-manifest.json"));
    expect(storage.getRun(run.id)?.pinned).toBe(true);
    expect(fs.existsSync(traceA)).toBe(true);
    expect(fs.existsSync(traceB)).toBe(true);
    expect(manifest?.items.every((item) => item.promotion_state === "promoted")).toBe(true);
    expect(manifest?.items.some((item) => item.deleted_at)).toBe(false);
  });
});
