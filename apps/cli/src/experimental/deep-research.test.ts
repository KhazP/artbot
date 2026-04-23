import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetailsResponsePayload } from "@artbot/shared-types";
import { ensureDeepResearchForRun, readDeepResearchArtifact, resolveDeepResearchDefaults } from "./deep-research.js";

const envSnapshot = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED: process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED,
  ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL: process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL
};

afterEach(() => {
  process.env.GEMINI_API_KEY = envSnapshot.GEMINI_API_KEY;
  process.env.GOOGLE_API_KEY = envSnapshot.GOOGLE_API_KEY;
  process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED = envSnapshot.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED;
  process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL = envSnapshot.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL;
});

function buildDetails(runDir: string): RunDetailsResponsePayload {
  const resultsPath = path.join(runDir, "results.json");
  fs.writeFileSync(resultsPath, JSON.stringify({ ok: true }), "utf-8");
  return {
    run: {
      id: "run-1",
      runType: "artist",
      status: "completed",
      pinned: false,
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:10:00.000Z",
      query: {
        artist: "Abidin Dino",
        scope: "turkey_plus_international",
        turkeyFirst: true,
        analysisMode: "comprehensive",
        priceNormalization: "usd_dual",
        manualLoginCheckpoint: false,
        allowLicensed: false,
        licensedIntegrations: [],
        preferredDiscoveryProviders: [],
        crawlMode: "backfill",
        sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
      },
      resultsPath
    },
    summary: {
      run_id: "run-1",
      total_records: 1,
      accepted_records: 1,
      rejected_candidates: 2,
      discovered_candidates: 1,
      accepted_from_discovery: 0,
      source_candidate_breakdown: { Clar: 1 },
      source_status_breakdown: {
        public_access: 1,
        auth_required: 0,
        licensed_access: 0,
        blocked: 0,
        price_hidden: 0
      },
      auth_mode_breakdown: {
        anonymous: 1,
        authorized: 0,
        licensed: 0
      },
      valuation_generated: false,
      valuation_reason: "Need more comparables."
    },
    records: [],
    attempts: []
  };
}

describe("deep research settings defaults", () => {
  it("resolves env-backed experimental defaults", () => {
    process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED = "true";
    process.env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL = "gemini-pro-latest";

    expect(resolveDeepResearchDefaults()).toMatchObject({
      enabled: true,
      plannerModel: "gemini-pro-latest",
      researchMode: "deep_research_max"
    });
  });
});

describe("ensureDeepResearchForRun", () => {
  it("skips Gemini when experimental deep research is disabled", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-deep-research-off-"));
    const details = buildDetails(runDir);
    const fetchImpl = vi.fn<typeof fetch>();

    const next = await ensureDeepResearchForRun({
      details,
      settings: {
        enabled: false,
        plannerModel: "gemini-pro-latest",
        researchMode: "deep_research_max",
        warnOnRun: true,
        spendCapReminderUsd: 20,
        openFullReportAfterRun: true
      },
      fetchImpl
    });

    expect(next.deepResearch).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("marks the run as skipped when GEMINI_API_KEY is missing", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-deep-research-skip-"));
    const details = buildDetails(runDir);
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const next = await ensureDeepResearchForRun({
      details,
      settings: {
        enabled: true,
        plannerModel: "gemini-pro-latest",
        researchMode: "deep_research_max",
        warnOnRun: true,
        spendCapReminderUsd: 20,
        openFullReportAfterRun: true
      }
    });

    expect(next.deepResearch?.status).toBe("skipped");
    expect(next.deepResearch?.summary).toContain("GEMINI_API_KEY");
  });

  it("runs planner then deep research agent and persists the artifact", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-deep-research-ok-"));
    const details = buildDetails(runDir);
    process.env.GEMINI_API_KEY = "test-key";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        normalRunSummary: "Normal run found one comparable.",
                        missingEvidenceSummary: "International auction coverage remains weak.",
                        researchObjectives: ["Expand coverage", "Validate provenance"],
                        followUpQuestions: ["Which houses sold comparable works recently?"],
                        prioritySearchTargets: ["Major auction archives", "Museum references"],
                        finalReportInstructions: "Write a detailed cited report."
                      })
                    }
                  ]
                }
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "interaction-1", status: "in_progress" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            outputs: [{ text: "Expanded report with citations https://example.com/source" }]
          })
        )
      );

    const next = await ensureDeepResearchForRun({
      details,
      settings: {
        enabled: true,
        plannerModel: "gemini-pro-latest",
        researchMode: "deep_research_max",
        warnOnRun: true,
        spendCapReminderUsd: 20,
        openFullReportAfterRun: true
      },
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(next.deepResearch?.status).toBe("completed");
    expect(next.deepResearch?.promptPlan?.researchObjectives).toContain("Expand coverage");
    expect(next.deepResearch?.citations[0]?.url).toBe("https://example.com/source");
    expect(readDeepResearchArtifact(details.run.resultsPath!)).toMatchObject({
      status: "completed"
    });
  });
});
