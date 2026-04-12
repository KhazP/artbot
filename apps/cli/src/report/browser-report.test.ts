import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBrowserOpenCommand,
  buildCompletedReportMessage,
  generateBrowserReportFromPayload,
  generateBrowserReportFromResultsFile,
  normalizeReportSurface,
  resolveBrowserReportOutputPath,
  resolveBrowserReportPath,
  shouldAutoOpenBrowserReport,
  shouldPromptForReportSurface
} from "./browser-report.js";

describe("browser report preferences", () => {
  it("normalizes invalid report surfaces to ask", () => {
    expect(normalizeReportSurface(undefined)).toBe("ask");
    expect(normalizeReportSurface("cli")).toBe("cli");
    expect(normalizeReportSurface("web")).toBe("web");
    expect(normalizeReportSurface("invalid")).toBe("ask");
  });

  it("exposes prompt and auto-open rules", () => {
    expect(shouldPromptForReportSurface("ask")).toBe(true);
    expect(shouldPromptForReportSurface("cli")).toBe(false);
    expect(shouldAutoOpenBrowserReport("web")).toBe(true);
    expect(shouldAutoOpenBrowserReport("ask")).toBe(false);
  });

  it("builds completion messages per surface", () => {
    expect(buildCompletedReportMessage({ accepted: 2, coverage: 10, surface: "ask" })).toContain("/report web");
    expect(buildCompletedReportMessage({ accepted: 2, coverage: 10, surface: "cli" })).toContain("/report web");
    expect(
      buildCompletedReportMessage({
        accepted: 2,
        coverage: 10,
        surface: "web",
        browserPath: "/tmp/report.browser.html"
      })
    ).toContain("Opened browser report");
  });
});

describe("browser report file generation", () => {
  it("writes report.browser.html next to results.json", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-browser-report-"));
    const resultsPath = path.join(runDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({
        run: {
          id: "run-123",
          runType: "artist",
          status: "completed",
          query: { artist: "Bedri Baykam", analysisMode: "fast" }
        },
        summary: {
          accepted_records: 1,
          rejected_candidates: 1,
          discovered_candidates: 0,
          accepted_from_discovery: 0,
          total_attempts: 2,
          total_records: 1,
          valuation_eligible_records: 1,
          priced_source_coverage_ratio: 0.5,
          priced_crawled_source_coverage_ratio: 0.5,
          source_status_breakdown: { public_access: 1 },
          acceptance_reason_breakdown: { asking_price_ready: 1 },
          valuation_generated: false,
          valuation_reason: "Insufficient comps."
        },
        records: [
          {
            work_title: "Untitled",
            source_name: "Clar",
            source_url: "https://example.com/work",
            price_type: "asking_price",
            price_amount: 20000,
            currency: "TRY",
            normalized_price_usd: 500,
            accepted_for_valuation: true,
            acceptance_reason: "asking_price_ready"
          }
        ]
      }),
      "utf-8"
    );

    const { htmlPath } = await generateBrowserReportFromResultsFile(resultsPath);
    const written = fs.readFileSync(htmlPath, "utf-8");

    expect(htmlPath).toBe(resolveBrowserReportPath(resultsPath));
    expect(written).toContain("Bedri Baykam");
    expect(written).toContain("<!doctype html>");
  });

  it("builds platform-specific open commands", () => {
    expect(buildBrowserOpenCommand("/tmp/report.browser.html", "darwin").command).toBe("open");
    expect(buildBrowserOpenCommand("/tmp/report.browser.html", "linux").command).toBe("xdg-open");
    expect(buildBrowserOpenCommand("/tmp/report.browser.html", "win32").command).toBe("cmd");
  });

  it("writes browser report from payload without requiring a local results file", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-browser-report-payload-"));
    const expectedPath = resolveBrowserReportOutputPath({ runId: "run-remote", outputDir: runDir });

    const { htmlPath } = await generateBrowserReportFromPayload(
      {
        run: {
          id: "run-remote",
          runType: "artist_market_inventory",
          status: "completed",
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
          valuation_reason: "Inventory mode did not produce blended valuation."
        },
        inventory: [
          {
            work_title: "Untitled",
            venue_name: "Clar",
            source_url: "https://example.com/work",
            price_type: "asking_price",
            price_amount: 20000,
            currency: "TRY",
            normalized_price_usd: 500,
            accepted_for_valuation: true,
            acceptance_reason: "asking_price_ready",
            source_access_status: "public_access"
          }
        ]
      },
      { runId: "run-remote", outputDir: runDir }
    );

    expect(htmlPath).toBe(expectedPath);
    expect(fs.readFileSync(htmlPath, "utf-8")).toContain("Bedri Baykam");
    expect(fs.readFileSync(htmlPath, "utf-8")).toContain("completed");
  });
});
