import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { renderResearchRunHtml } from "@artbot/browser-report";
import { pathExists, readTextFile } from "../lib/file-system.js";

export type ReportSurfacePreference = "ask" | "cli" | "web";

export interface GeneratedBrowserReport {
  htmlPath: string;
  opened: boolean;
  error?: string;
}

export interface BrowserReportTarget {
  runId?: string;
  resultsPath?: string;
  outputDir?: string;
}

export function normalizeReportSurface(value: string | undefined): ReportSurfacePreference {
  if (value === "cli" || value === "web") return value;
  return "ask";
}

export function shouldPromptForReportSurface(surface: ReportSurfacePreference): boolean {
  return surface === "ask";
}

export function shouldAutoOpenBrowserReport(surface: ReportSurfacePreference): boolean {
  return surface === "web";
}

export function resolveBrowserReportPath(resultsPath: string): string {
  return path.resolve(path.dirname(resultsPath), "report.browser.html");
}

function sanitizeRunId(runId: string | undefined): string {
  const trimmed = runId?.trim();
  if (!trimmed) return "latest";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function resolveBrowserReportOutputPath(target: BrowserReportTarget = {}): string {
  if (target.resultsPath && pathExists(target.resultsPath)) {
    return resolveBrowserReportPath(target.resultsPath);
  }

  const directory = target.outputDir ? path.resolve(target.outputDir) : os.tmpdir();
  return path.join(directory, `artbot-${sanitizeRunId(target.runId)}.browser-report.html`);
}

export function buildCompletedReportMessage(params: {
  accepted: number;
  coverage: number;
  surface: ReportSurfacePreference;
  browserPath?: string;
  error?: string;
}): string {
  const prefix = `✓ Run completed — ${params.accepted} accepted, ${params.coverage}% coverage`;
  if (params.error) {
    return `${prefix}. Browser report saved at ${params.browserPath ?? "unknown path"} but could not be opened: ${params.error}`;
  }
  if (params.browserPath && params.surface === "web") {
    return `${prefix}. Opened browser report: ${params.browserPath}`;
  }
  if (params.surface === "ask") {
    return `${prefix}. View report: /report cli or /report web`;
  }
  if (params.surface === "web") {
    return `${prefix}. Opening browser report...`;
  }
  return `${prefix}. Use /report web to open the browser report.`;
}

export function buildBrowserOpenCommand(targetPath: string, platform = process.platform): { command: string; args: string[] } {
  const absolutePath = path.resolve(targetPath);

  if (platform === "darwin") {
    return { command: "open", args: [absolutePath] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", pathToFileURL(absolutePath).href] };
  }

  return { command: "xdg-open", args: [absolutePath] };
}

export async function generateBrowserReportFromResultsFile(resultsPath: string): Promise<{ htmlPath: string }> {
  const payloadText = readTextFile(resultsPath);
  if (!payloadText) {
    throw new Error(`Results file not found: ${resultsPath}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error(`Results file is not valid JSON: ${resultsPath}`);
  }

  return generateBrowserReportFromPayload(payload, { resultsPath });
}

export async function generateBrowserReportFromPayload(
  payload: unknown,
  target: BrowserReportTarget = {}
): Promise<{ htmlPath: string }> {
  const htmlPath = resolveBrowserReportOutputPath(target);
  const html = renderResearchRunHtml(payload);
  fs.writeFileSync(htmlPath, html, "utf-8");
  return { htmlPath };
}

export async function openBrowserReportFile(targetPath: string): Promise<void> {
  const { command, args } = buildBrowserOpenCommand(targetPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Open command exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function generateAndOpenBrowserReport(resultsPath: string): Promise<GeneratedBrowserReport> {
  const { htmlPath } = await generateBrowserReportFromResultsFile(resultsPath);

  try {
    await openBrowserReportFile(htmlPath);
    return {
      htmlPath,
      opened: true
    };
  } catch (error) {
    return {
      htmlPath,
      opened: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function generateAndOpenBrowserReportFromPayload(
  payload: unknown,
  target: BrowserReportTarget = {}
): Promise<GeneratedBrowserReport> {
  const { htmlPath } = await generateBrowserReportFromPayload(payload, target);

  try {
    await openBrowserReportFile(htmlPath);
    return {
      htmlPath,
      opened: true
    };
  } catch (error) {
    return {
      htmlPath,
      opened: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
