import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { researchQuerySchema } from "@artbot/shared-types";
import type { RunDetailsResponse } from "./index.js";
import { runCli } from "./index.js";

const cliPackageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version: string;
};

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
    expect(stderr).toBe("");
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

    const code = await runCli(
      ["node", "artbot", "--json", "research", "artist", "--artist", "Burhan Dogancay"],
      {
        fetchImpl,
        stdout: io.appendStdout,
        stderr: io.appendStderr,
        spinnerFactory: createSpinnerStub()
      }
    );

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
});
