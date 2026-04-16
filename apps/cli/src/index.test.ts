import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { researchQuerySchema } from "@artbot/shared-types";
import { buildRunArtifactManifest, writeArtifactManifest } from "@artbot/storage";
import type { RunDetailsResponse } from "./index.js";
import { runCli } from "./index.js";

const cliPackageVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version: string;
};
const cleanupPaths: string[] = [];
const envSnapshot = {
  ARTBOT_NO_TUI: process.env.ARTBOT_NO_TUI
};

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  process.env.ARTBOT_NO_TUI = envSnapshot.ARTBOT_NO_TUI;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function buildRunDetails(status: "pending" | "running" | "completed" | "failed"): RunDetailsResponse {
  return {
    run: {
      id: "run-123",
      runType: "artist",
      query: researchQuerySchema.parse({
        artist: "Burhan Dogancay",
        scope: "turkey_plus_international",
        turkeyFirst: true,
        analysisMode: "comprehensive",
        priceNormalization: "usd_dual",
        manualLoginCheckpoint: false,
        allowLicensed: false,
        licensedIntegrations: [],
        crawlMode: "backfill",
        sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
      }),
      status,
      pinned: false,
      createdAt: "2026-04-08T12:00:00.000Z",
      updatedAt: "2026-04-08T12:01:00.000Z"
    },
    summary: {
      run_id: "run-123",
      total_records: 5,
      accepted_records: status === "completed" ? 2 : 0,
      rejected_candidates: 3,
      discovered_candidates: 4,
      accepted_from_discovery: 1,
      source_candidate_breakdown: {
        "Muzayede App Platform": 3,
        "Clar Buy Now": 2
      },
      source_status_breakdown: {
        public_access: status === "completed" ? 2 : 0,
        auth_required: 0,
        licensed_access: 0,
        blocked: status === "failed" ? 5 : 1,
        price_hidden: 0
      },
      auth_mode_breakdown: {
        anonymous: 5,
        authorized: 0,
        licensed: 0
      },
      valuation_generated: false,
      valuation_reason: "Comparable threshold not met."
    },
    records:
      status === "completed"
        ? [
            {
              artist_name: "Burhan Dogancay",
              work_title: "Mavi Kompozisyon",
              alternate_title: null,
              year: null,
              medium: null,
              support: null,
              dimensions_text: null,
              height_cm: null,
              width_cm: null,
              depth_cm: null,
              signed: null,
              dated: null,
              edition_info: null,
              is_unique_work: null,
              venue_name: "Clar",
              venue_type: "auction_house",
              city: "Istanbul",
              country: "Turkey",
              source_name: "Clar Auction Archive",
              source_url: "https://clar.test/lot/1",
              source_page_type: "lot",
              sale_or_listing_date: "2025-03-22",
              lot_number: "87",
              price_type: "realized_price",
              estimate_low: null,
              estimate_high: null,
              price_amount: 390000,
              currency: "TRY",
              normalized_price_try: 390000,
              normalized_price_usd: 12000,
              buyers_premium_included: null,
              image_url: null,
              screenshot_path: "/tmp/s.png",
              raw_snapshot_path: "/tmp/r.html",
              visual_match_score: null,
              metadata_match_score: null,
              extraction_confidence: 0.84,
              entity_match_confidence: 0.76,
              source_reliability_confidence: 0.8,
              valuation_confidence: 0.82,
              overall_confidence: 0.82,
              accepted_for_evidence: true,
              accepted_for_valuation: true,
              valuation_lane: "realized",
              acceptance_reason: "valuation_ready",
              rejection_reason: null,
              valuation_eligibility_reason: null,
              price_hidden: false,
              source_access_status: "public_access",
              notes: []
            }
          ]
        : [],
    attempts: []
  };
}

function buildStorageUsageSummary() {
  return {
    total_var_bytes: 3_221_225_472,
    pinned_runs: 7,
    expirable_runs: 18,
    last_cleanup_reclaimed_bytes: 536_870_912,
    last_cleanup_completed_at: "2026-04-15T09:30:00.000Z"
  };
}

function createMockIo() {
  let stdout = "";
  let stderr = "";
  return {
    appendStdout(text: string) {
      stdout += text;
    },
    appendStderr(text: string) {
      stderr += text;
    },
    read() {
      return { stdout, stderr };
    }
  };
}

function createSpinnerStub() {
  return (text: string) => {
    let currentText = text;
    return {
      get text() {
        return currentText;
      },
      set text(value: string) {
        currentText = value;
      },
      start() {
        return this;
      },
      stop() {
        return this;
      },
      succeed() {
        return this;
      },
      fail() {
        return this;
      }
    };
  };
}

function mkTempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupPaths.push(root);
  return root;
}

describe("artbot cli v2", () => {
  it("boots and renders help without commander option conflicts", async () => {
    const io = createMockIo();
    const code = await runCli(["node", "artbot", "--help"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stdout).toContain("local");
    expect(stdout).toContain("research-work");
    expect(stdout).toContain("runs");
    expect(stdout).toContain("--no-tui");
    expect(stdout).toContain("tui");
    expect(stderr).toBe("");
  });

  it("prints root help on bare invocation", async () => {
    const io = createMockIo();
    const startInteractive = vi.fn(async () => 99);

    const code = await runCli(["node", "artbot"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub(),
      startInteractive
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(startInteractive).not.toHaveBeenCalled();
    expect(stdout).toContain("Usage: artbot [options] [command]");
    expect(stdout).toContain("tui");
    expect(stderr).toBe("");
  });

  it("launches the explicit tui command", async () => {
    const io = createMockIo();
    const startInteractive = vi.fn(async () => 7);

    const code = await runCli(["node", "artbot", "tui"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub(),
      startInteractive
    });

    expect(code).toBe(7);
    expect(startInteractive).toHaveBeenCalledTimes(1);
  });

  it("blocks the tui command when --no-tui is passed", async () => {
    const io = createMockIo();
    const startInteractive = vi.fn(async () => 7);

    const code = await runCli(["node", "artbot", "--no-tui", "tui"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub(),
      startInteractive
    });

    const { stderr } = io.read();
    expect(code).toBe(2);
    expect(startInteractive).not.toHaveBeenCalled();
    expect(stderr).toContain("TUI launch is disabled by --no-tui or ARTBOT_NO_TUI");
  });

  it("blocks the tui command when ARTBOT_NO_TUI is set", async () => {
    process.env.ARTBOT_NO_TUI = "yes";
    const io = createMockIo();
    const startInteractive = vi.fn(async () => 7);

    const code = await runCli(["node", "artbot", "tui"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub(),
      startInteractive
    });

    const { stderr } = io.read();
    expect(code).toBe(2);
    expect(startInteractive).not.toHaveBeenCalled();
    expect(stderr).toContain("TUI launch is disabled by --no-tui or ARTBOT_NO_TUI");
  });

  it("prints the package version from package.json", async () => {
    const io = createMockIo();
    const code = await runCli(["node", "artbot", "--version"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(cliPackageVersion.version);
    expect(stderr).toBe("");
  });

  it("returns input error code when required flags are missing", async () => {
    const io = createMockIo();
    const code = await runCli(["node", "artbot", "research", "artist"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stderr } = io.read();
    expect(code).toBe(2);
    expect(stderr).toContain("required option '--artist <name>' not specified");
  });

  it("prints strict JSON for non-wait research mode", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () => jsonResponse({ runId: "run-1", status: "pending" }));

    const code = await runCli(["node", "artbot", "--json", "research", "artist", "--artist", "Burhan Dogancay"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ runId: "run-1", status: "pending" });
    expect(stderr).toBe("");
  });

  it("supports --wait and returns terminal JSON payload", async () => {
    const io = createMockIo();
    const pending = buildRunDetails("pending");
    const completed = buildRunDetails("completed");
    let runChecks = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (init?.method === "POST" && value.endsWith("/research/artist")) {
        return jsonResponse({ runId: "run-123", status: "pending" });
      }
      if (value.endsWith("/runs/run-123")) {
        runChecks += 1;
        return jsonResponse(runChecks === 1 ? pending : completed);
      }
      return jsonResponse({}, 404);
    });

    const sleep = vi.fn(async () => undefined);

    const code = await runCli(
      [
        "node",
        "artbot",
        "--json",
        "research",
        "artist",
        "--artist",
        "Burhan Dogancay",
        "--wait",
        "--wait-interval",
        "5"
      ],
      {
        fetchImpl,
        sleep,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const { stdout } = io.read();
    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as RunDetailsResponse;
    expect(payload.run.status).toBe("completed");
    expect(payload.summary.accepted_records).toBeGreaterThan(0);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("returns exit code 4 for failed watch terminal states", async () => {
    const io = createMockIo();
    const running = buildRunDetails("running");
    const failed = buildRunDetails("failed");
    let checks = 0;

    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.endsWith("/runs/run-123")) {
        checks += 1;
        return jsonResponse(checks === 1 ? running : failed);
      }
      return jsonResponse({}, 404);
    });

    const code = await runCli(["node", "artbot", "--json", "runs", "watch", "--run-id", "run-123"], {
      fetchImpl,
      sleep: async () => undefined,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout } = io.read();
    expect(code).toBe(4);
    const payload = JSON.parse(stdout) as RunDetailsResponse;
    expect(payload.run.status).toBe("failed");
  });

  it("renders human table output for runs list", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        runs: [
          {
            id: "run-1",
            runType: "artist",
            query: researchQuerySchema.parse({
              artist: "Burhan Dogancay",
              scope: "turkey_plus_international",
              turkeyFirst: true,
              analysisMode: "comprehensive",
              priceNormalization: "usd_dual",
              manualLoginCheckpoint: false,
              allowLicensed: false,
              licensedIntegrations: [],
              crawlMode: "backfill",
              sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
            }),
            status: "completed",
            pinned: true,
            pinnedAt: "2026-04-08T10:06:00.000Z",
            createdAt: "2026-04-08T10:00:00.000Z",
            updatedAt: "2026-04-08T10:05:00.000Z"
          }
        ]
      })
    );

    const code = await runCli(["node", "artbot", "runs", "list"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Run ID");
    expect(stdout).toContain("Burhan Dogancay");
    expect(stdout).toContain("pinned");
  });

  it("prints storage usage summary as strict JSON", async () => {
    const io = createMockIo();
    const summary = buildStorageUsageSummary();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/storage/usage");
      expect(init?.method).toBe("GET");
      return jsonResponse(summary);
    });

    const code = await runCli(["node", "artbot", "--json", "storage"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(summary);
  });

  it("renders storage usage as a human-readable table", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () => jsonResponse(buildStorageUsageSummary()));

    const code = await runCli(["node", "artbot", "storage"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Total var usage");
    expect(stdout).toContain("Pinned runs");
    expect(stdout).toContain("Expirable runs");
    expect(stdout).toContain("Last cleanup reclaimed");
    expect(stdout).toContain("bytes");
  });

  it("renders nested storage summary payloads from the API", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        usage: {
          total_bytes: 3_221_225_472,
          pinned: { runs: 7, bytes: 2_100_000_000 },
          expirable: { runs: 18, bytes: 1_121_225_472 },
          last_cleanup: {
            reclaimed_bytes: 536_870_912,
            timestamp: "2026-04-15T09:30:00.000Z",
            dry_run: false
          }
        }
      })
    );

    const code = await runCli(["node", "artbot", "storage"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Total var usage");
    expect(stdout).toContain("Pinned runs");
    expect(stdout).toContain("Expirable runs");
    expect(stdout).toContain("Last cleanup reclaimed");
    expect(stdout).toContain("3.0 GB");
    expect(stdout).toContain("512 MB");
    expect(stdout).not.toContain("n/a");
  });

  it("pins a run via the API", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/runs/run-123/pin");
      expect(init?.method).toBe("POST");
      return jsonResponse({
        ...buildRunDetails("completed").run,
        pinned: true,
        pinnedAt: "2026-04-16T10:00:00.000Z"
      });
    });

    const code = await runCli(["node", "artbot", "--json", "runs", "pin", "--run-id", "run-123"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      id: "run-123",
      pinned: true
    });
  });

  it("unpins a run via the API", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/runs/run-123/unpin");
      expect(init?.method).toBe("POST");
      return jsonResponse({
        ...buildRunDetails("completed").run,
        pinned: false
      });
    });

    const code = await runCli(["node", "artbot", "--json", "runs", "unpin", "--run-id", "run-123"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      id: "run-123",
      pinned: false
    });
  });

  it("keeps --json responses stdout-only for runs show", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () => jsonResponse(buildRunDetails("completed")));

    const code = await runCli(["node", "artbot", "--json", "runs", "show", "--run-id", "run-123"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toBe("");
  });

  it("prints actionable next-step hints for connectivity errors", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const code = await runCli(["node", "artbot", "runs", "list"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stderr } = io.read();
    expect(code).toBe(3);
    expect(stderr).toContain("Cannot reach API endpoint.");
    expect(stderr).toContain("--api-base-url");
  });

  it("replays from a raw snapshot and returns original plus replay metadata", async () => {
    const io = createMockIo();
    const tempRoot = mkTempDir("artbot-cli-replay-raw-");
    const rawSnapshotPath = path.join(tempRoot, "raw.html");
    fs.writeFileSync(rawSnapshotPath, "<html><body><span>TRY 120,000</span></body></html>", "utf-8");

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...buildRunDetails("completed"),
        attempts: [
          {
            run_id: "run-123",
            source_name: "Clar",
            source_url: "https://example.com/lot/1",
            canonical_url: "https://example.com/lot/1",
            access_mode: "anonymous",
            source_access_status: "public_access",
            access_reason: "fixture",
            blocker_reason: null,
            extracted_fields: {},
            screenshot_path: null,
            raw_snapshot_path: rawSnapshotPath,
            trace_path: null,
            har_path: null,
            fetched_at: "2026-04-14T10:00:00.000Z",
            parser_used: "fixture",
            model_used: null,
            confidence_score: 0.8,
            accepted: true,
            acceptance_reason: "valuation_ready"
          }
        ]
      })
    );

    const code = await runCli(["node", "artbot", "--json", "replay", "attempt", "--run-id", "run-123"], {
      fetchImpl,
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const payload = JSON.parse(io.read().stdout) as any;
    expect(code).toBe(0);
    expect(payload.original_attempt.parser_used).toBe("fixture");
    expect(payload.replay.artifact_kind).toBe("raw_snapshot");
    expect(payload.replay.artifact_path).toBe(rawSnapshotPath);
  });

  it("falls back to HAR replay when no raw snapshot is available", async () => {
    const io = createMockIo();
    const tempRoot = mkTempDir("artbot-cli-replay-har-");
    const harPath = path.join(tempRoot, "capture.har");
    fs.writeFileSync(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              request: { url: "https://example.com/lot/2" },
              response: {
                content: {
                  mimeType: "text/html",
                  text: "<html><body><span>Estimate 90,000 - 120,000 TRY</span></body></html>"
                }
              }
            }
          ]
        }
      }),
      "utf-8"
    );

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...buildRunDetails("completed"),
        attempts: [
          {
            run_id: "run-123",
            source_name: "Clar",
            source_url: "https://example.com/lot/2",
            canonical_url: "https://example.com/lot/2",
            access_mode: "anonymous",
            source_access_status: "public_access",
            access_reason: "fixture",
            blocker_reason: null,
            extracted_fields: {},
            screenshot_path: null,
            raw_snapshot_path: null,
            trace_path: null,
            har_path: harPath,
            fetched_at: "2026-04-14T10:00:00.000Z",
            parser_used: "browser",
            model_used: null,
            confidence_score: 0.8,
            accepted: true,
            acceptance_reason: "estimate_range_ready"
          }
        ]
      })
    );

    const code = await runCli(
      ["node", "artbot", "--json", "replay", "attempt", "--run-id", "run-123", "--artifact", "auto"],
      {
        fetchImpl,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const payload = JSON.parse(io.read().stdout) as any;
    expect(code).toBe(0);
    expect(payload.replay.artifact_kind).toBe("har");
    expect(payload.replay.artifact_path).toBe(harPath);
  });

  it("reports gc dry-run results without deleting artifacts", async () => {
    const io = createMockIo();
    const runsRoot = mkTempDir("artbot-cli-gc-");
    const runRoot = path.join(runsRoot, "run-1");
    fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });
    const reportPath = path.join(runRoot, "report.md");
    const resultsPath = path.join(runRoot, "results.json");
    const tracePath = path.join(runRoot, "evidence", "traces", "old.zip");
    fs.writeFileSync(reportPath, "report", "utf-8");
    fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
    fs.writeFileSync(tracePath, "trace", "utf-8");
    fs.utimesSync(tracePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

    writeArtifactManifest(
      runRoot,
      buildRunArtifactManifest({
        runId: "run-1",
        runRoot,
        reportPath,
        resultsPath,
        attempts: [
          {
            run_id: "run-1",
            source_name: "Clar",
            source_url: "https://example.com/lot/1",
            canonical_url: "https://example.com/lot/1",
            access_mode: "anonymous",
            source_access_status: "public_access",
            access_reason: "fixture",
            blocker_reason: null,
            extracted_fields: {},
            screenshot_path: null,
            raw_snapshot_path: null,
            trace_path: tracePath,
            har_path: null,
            fetched_at: "2026-04-14T10:00:00.000Z",
            parser_used: "fixture",
            model_used: null,
            confidence_score: 0.8,
            accepted: true,
            acceptance_reason: "valuation_ready"
          }
        ]
      })
    );

    const code = await runCli(["node", "artbot", "--json", "ops", "gc", "--runs-root", runsRoot, "--dry-run"], {
      fetchImpl: vi.fn(),
      stdout: io.appendStdout,
      stderr: io.appendStderr,
      spinnerFactory: createSpinnerStub()
    });

    const { stdout, stderr } = io.read();
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.dry_run).toBe(true);
    expect(payload.deleted_by_reason.expired).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(tracePath)).toBe(true);
  });

  it("supports the cleanup command with keep-last and max-size options", async () => {
    const io = createMockIo();
    const runsRoot = mkTempDir("artbot-cli-cleanup-");

    const writeRun = (runId: string, generatedAt: string, traceName: string) => {
      const runRoot = path.join(runsRoot, runId);
      fs.mkdirSync(path.join(runRoot, "evidence", "traces"), { recursive: true });
      const reportPath = path.join(runRoot, "report.md");
      const resultsPath = path.join(runRoot, "results.json");
      const tracePath = path.join(runRoot, "evidence", "traces", traceName);
      fs.writeFileSync(reportPath, "report", "utf-8");
      fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
      fs.writeFileSync(tracePath, "trace", "utf-8");
      fs.utimesSync(tracePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

      const manifest = buildRunArtifactManifest({
        runId,
        runRoot,
        reportPath,
        resultsPath,
        attempts: [
          {
            run_id: runId,
            source_name: "Clar",
            source_url: `https://example.com/${runId}`,
            canonical_url: `https://example.com/${runId}`,
            access_mode: "anonymous",
            source_access_status: "public_access",
            access_reason: "fixture",
            blocker_reason: null,
            extracted_fields: {},
            screenshot_path: null,
            raw_snapshot_path: null,
            trace_path: tracePath,
            har_path: null,
            fetched_at: "2026-04-14T10:00:00.000Z",
            parser_used: "fixture",
            model_used: null,
            confidence_score: 0.8,
            accepted: true,
            acceptance_reason: "valuation_ready"
          }
        ]
      });
      manifest.generated_at = generatedAt;
      writeArtifactManifest(runRoot, manifest);
    };

    writeRun("run-older", "2026-04-10T00:00:00.000Z", "older.zip");
    writeRun("run-newest", "2026-04-15T00:00:00.000Z", "newest.zip");

    const code = await runCli(
      [
        "node",
        "artbot",
        "--json",
        "cleanup",
        "--runs-root",
        runsRoot,
        "--dry-run",
        "--keep-last",
        "1",
        "--max-size-gb",
        "1"
      ],
      {
        fetchImpl: vi.fn(),
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const { stdout, stderr } = io.read();
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.keep_last).toBe(1);
    expect(payload.max_size_gb).toBe(1);
    expect(payload.deleted_items).toBeGreaterThan(0);
    expect(payload.dry_run).toBe(true);
  });

  it("lists filtered review queue items", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...buildRunDetails("completed"),
        run: {
          ...buildRunDetails("completed").run,
          runType: "artist_market_inventory"
        },
        inventory: [
          {
            id: "inv-1",
            run_id: "run-123",
            artist_key: "artist",
            record_key: "record-left",
            source_host: "example.com",
            semantic_lane: "asking",
            cluster_id: "cluster-1",
            payload: {
              source_name: "Clar"
            }
          },
          {
            id: "inv-2",
            run_id: "run-123",
            artist_key: "artist",
            record_key: "record-right",
            source_host: "example.com",
            semantic_lane: "asking",
            cluster_id: "cluster-1",
            payload: {
              source_name: "Portakal"
            }
          }
        ],
        review_queue: [
          {
            id: "review-1",
            run_id: "run-123",
            artist_key: "artist",
            review_type: "cluster_match",
            status: "pending",
            left_record_key: "record-left",
            right_record_key: "record-right",
            recommended_action: "keep_separate",
            confidence: 0.78,
            reasons: ["title_similarity:0.62"],
            created_at: "2026-04-14T10:00:00.000Z",
            updated_at: "2026-04-14T10:00:00.000Z"
          },
          {
            id: "review-2",
            run_id: "run-123",
            artist_key: "artist",
            review_type: "cluster_match",
            status: "accepted",
            left_record_key: "record-left",
            right_record_key: "record-right",
            recommended_action: "merge",
            confidence: 0.92,
            reasons: ["identical_image_sha256"],
            created_at: "2026-04-14T10:00:00.000Z",
            updated_at: "2026-04-14T10:00:00.000Z"
          }
        ]
      })
    );

    const code = await runCli(
      ["node", "artbot", "--json", "review", "queue", "--run-id", "run-123", "--status", "open", "--source", "clar"],
      {
        fetchImpl,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const payload = JSON.parse(io.read().stdout) as any;
    expect(code).toBe(0);
    expect(payload.count).toBe(1);
    expect(payload.items[0]?.status).toBe("pending");
  });

  it("adjudicates review queue items via API", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ decision: "merge" }));
      return jsonResponse({
        run_id: "run-123",
        review_item: {
          id: "review-1",
          status: "accepted",
          recommended_action: "merge"
        }
      });
    });

    const code = await runCli(
      [
        "node",
        "artbot",
        "--json",
        "review",
        "decide",
        "--run-id",
        "run-123",
        "--item-id",
        "review-1",
        "--decision",
        "merge"
      ],
      {
        fetchImpl,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const payload = JSON.parse(io.read().stdout) as any;
    expect(code).toBe(0);
    expect(payload.review_item.status).toBe("accepted");
    expect(payload.review_item.recommended_action).toBe("merge");
  });

  it("explains cluster membership for graph command", async () => {
    const io = createMockIo();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...buildRunDetails("completed"),
        run: {
          ...buildRunDetails("completed").run,
          runType: "artist_market_inventory"
        },
        clusters: [
          {
            id: "cluster-1",
            run_id: "run-123",
            artist_key: "artist",
            title: "Untitled",
            year: null,
            medium: null,
            cluster_status: "auto_confirmed",
            confidence: 0.88,
            record_count: 2,
            auto_match_count: 1,
            created_at: "2026-04-14T10:00:00.000Z",
            updated_at: "2026-04-14T10:00:00.000Z"
          }
        ],
        cluster_memberships: [
          {
            id: "membership-1",
            run_id: "run-123",
            artist_key: "artist",
            cluster_id: "cluster-1",
            record_key: "record-left",
            status: "auto_confirmed",
            confidence: 0.88,
            reasons: ["strict_exact_work_match"],
            created_at: "2026-04-14T10:00:00.000Z",
            updated_at: "2026-04-14T10:00:00.000Z"
          }
        ],
        inventory: [
          {
            id: "inv-1",
            run_id: "run-123",
            artist_key: "artist",
            record_key: "record-left",
            source_host: "example.com",
            semantic_lane: "asking",
            cluster_id: "cluster-1",
            payload: {
              source_name: "Clar",
              work_title: "Untitled",
              source_url: "https://example.com/lot/1"
            }
          }
        ]
      })
    );

    const code = await runCli(
      ["node", "artbot", "--json", "graph", "explain", "--run-id", "run-123", "--cluster-id", "cluster-1"],
      {
        fetchImpl,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

    const payload = JSON.parse(io.read().stdout) as any;
    expect(code).toBe(0);
    expect(payload.cluster.id).toBe("cluster-1");
    expect(payload.membership_count).toBe(1);
    expect(payload.memberships[0]?.source_name).toBe("Clar");
  });
});
