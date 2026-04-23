import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateBrowserReportFromResultsFile } from "./browser-report.js";

describe("browser report deep research merge", () => {
  it("includes the experimental AI section when a deep-research sidecar exists", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-browser-report-deep-"));
    const resultsPath = path.join(runDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({
        run: {
          id: "run-deep-1",
          runType: "artist",
          status: "completed",
          pinned: false,
          query: { artist: "Bedri Baykam", analysisMode: "fast" }
        },
        summary: {
          accepted_records: 1,
          rejected_candidates: 0,
          discovered_candidates: 0,
          accepted_from_discovery: 0,
          total_attempts: 1,
          total_records: 1,
          valuation_eligible_records: 1,
          priced_source_coverage_ratio: 1,
          priced_crawled_source_coverage_ratio: 1,
          source_status_breakdown: { public_access: 1 },
          acceptance_reason_breakdown: { asking_price_ready: 1 },
          valuation_generated: false,
          valuation_reason: "Need more evidence."
        },
        records: []
      }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(runDir, "deep-research.json"),
      JSON.stringify({
        enabled: true,
        status: "completed",
        summary: "Gemini expanded the run with broader market analysis.",
        promptPlan: {
          normalRunSummary: "One comparable found.",
          missingEvidenceSummary: "Coverage is still weak.",
          researchObjectives: ["Expand coverage"],
          followUpQuestions: ["What else sold recently?"],
          prioritySearchTargets: ["Auction archives"],
          finalReportInstructions: "Write a cited report."
        },
        reportMarkdown: "Detailed AI report",
        citations: [{ title: "Source 1", url: "https://example.com" }],
        warnings: ["Experimental and expensive."],
        providerMetadata: {
          plannerModel: "gemini-pro-latest",
          researchMode: "deep_research_max"
        }
      }),
      "utf-8"
    );

    const { htmlPath } = await generateBrowserReportFromResultsFile(resultsPath);
    const html = fs.readFileSync(htmlPath, "utf-8");

    expect(html).toContain("Experimental AI Research");
    expect(html).toContain("Detailed AI report");
    expect(html).toContain("Gemini expanded the run with broader market analysis.");
  });
});
