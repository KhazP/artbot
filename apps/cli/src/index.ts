import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Table from "cli-table3";
import { Command, CommanderError } from "commander";
import ora from "ora";
import picocolors from "picocolors";
import { ZodError } from "zod";
import type {
  AcceptanceReason,
  CanaryResult,
  DiscoveryProviderDiagnostics,
  PriceRecord,
  RunEntity,
  RunDetailsResponsePayload,
  RunStatus,
  RunSummary,
  SourceHealthRecord,
  SourceLegalPosture,
  SourcePageType,
  SourceAttempt
} from "@artbot/shared-types";
import { researchQuerySchema } from "@artbot/shared-types";
import { AuthManager } from "@artbot/auth-manager";
import { parseGenericLotFields } from "@artbot/extraction";
import { evaluateAcceptance, evaluateFixtureContract } from "@artbot/source-adapters";
import {
  ArtbotStorage,
  buildDefaultGcPolicyFromEnv,
  ensureWorkspaceRuntimeStoragePaths,
  resolveWorkspaceRelativePath,
  runArtifactGc
} from "@artbot/storage";
import {
  assessLocalSetup,
  buildAuthCaptureCommand,
  defaultSourceUrlForProfile,
  detectWorkspaceRoot,
  inspectLocalBackendStatus,
  loadWorkspaceEnv,
  resolveAuthProfilesFromEnv,
  resolveLocalRuntimePaths,
  startLocalBackendServices,
  stopLocalBackendServices,
  type LocalBackendStatus,
  type SetupAssessment
} from "./setup/index.js";
import { runSetupWizard } from "./setup/workflow.js";

declare const __ARTBOT_VERSION__: string;

function resolveCliVersion(): string {
  if (typeof __ARTBOT_VERSION__ === "string" && __ARTBOT_VERSION__.length > 0) {
    return __ARTBOT_VERSION__;
  }

  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

const CLI_VERSION = resolveCliVersion();

const EXIT_CODES = {
  OK: 0,
  INPUT: 2,
  API: 3,
  TERMINAL: 4
} as const;

const require = createRequire(import.meta.url);

interface CommonOptions {
  artist: string;
  turkeyFirst?: boolean;
  scope?: "turkey_only" | "turkey_plus_international";
  analysisMode?: "comprehensive" | "balanced" | "fast";
  priceNormalization?: "legacy" | "usd_dual" | "usd_nominal" | "usd_2026";
  year?: string;
  medium?: string;
  title?: string;
  dateFrom?: string;
  dateTo?: string;
  imagePath?: string;
  authProfile?: string;
  cookieFile?: string;
  manualLogin?: boolean;
  allowLicensed?: boolean;
  licensedIntegrations?: string;
  discoveryProviders?: string;
  heightCm?: string;
  widthCm?: string;
  depthCm?: string;
  wait?: boolean;
  waitInterval?: string;
  refresh?: boolean;
  previewOnly?: boolean;
}

interface RunsListOptions {
  status?: string;
  limit?: string;
}

interface RunsShowOptions {
  runId: string;
}

interface RunsWatchOptions extends RunsShowOptions {
  interval?: string;
}

interface AuthCaptureOptions {
  profileId: string;
}

interface ReplayAttemptOptions {
  runId: string;
  source?: string;
  index?: string;
  artifact?: string;
}

interface ReviewQueueOptions {
  runId: string;
  status?: string;
  source?: string;
}

interface ReviewDecideOptions {
  runId: string;
  itemId: string;
  decision: string;
}

interface GraphExplainOptions {
  runId: string;
  clusterId: string;
}

interface ArtifactGcOptions {
  runsRoot?: string;
  dryRun?: boolean;
  maxSizeGb?: string;
  keepLast?: string;
}

interface StorageUsageResponse {
  [key: string]: unknown;
}

interface CanaryRunOptions {
  fixturesRoot?: string;
}

interface CanaryHistoryOptions {
  family?: string;
  limit?: string;
}

interface GlobalOptions {
  json: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  verbose: boolean;
  quiet: boolean;
  noTui: boolean;
}

export type RunDetailsResponse = RunDetailsResponsePayload;

interface SourcePlanPreviewResponse {
  source_plan: Array<{
    source_name: string;
    venue_name: string;
    source_family: string;
    source_access_status: string;
    legal_posture?: string | null;
    candidate_count: number;
    selection_state: string;
    selection_reason: string | null;
    skip_reason: string | null;
    priority_rank: number;
  }>;
  candidate_cap: number;
  totals: Record<string, number>;
  discovery_provider_diagnostics?: DiscoveryProviderDiagnostics[];
}

interface RunsListResponse {
  runs: RunEntity[];
}

interface CanaryFixtureDefinition {
  family: string;
  sourceName: string;
  fixture: string;
  sourcePageType: SourcePageType;
  legalPosture: SourceLegalPosture;
  passMode?: "priced_signal" | "listing_expansion";
  expectedPriceType: string | null;
}

const PRIORITY_CANARY_FIXTURES: CanaryFixtureDefinition[] = [
  {
    family: "muzayede",
    sourceName: "Muzayede App",
    fixture: "muzayedeapp/lot.html",
    sourcePageType: "lot",
    legalPosture: "public_permitted",
    expectedPriceType: "realized_price"
  },
  {
    family: "muzayede",
    sourceName: "Muzayede App",
    fixture: "muzayedeapp/listing.html",
    sourcePageType: "listing",
    legalPosture: "public_permitted",
    passMode: "listing_expansion",
    expectedPriceType: null
  },
  {
    family: "bayrak",
    sourceName: "Bayrak",
    fixture: "bayrak/listing.html",
    sourcePageType: "listing",
    legalPosture: "public_permitted",
    expectedPriceType: "estimate"
  },
  {
    family: "turel",
    sourceName: "Türel",
    fixture: "turel/listing.html",
    sourcePageType: "listing",
    legalPosture: "public_permitted",
    expectedPriceType: "inquiry_only"
  },
  {
    family: "clar",
    sourceName: "Clar",
    fixture: "clar/archive.html",
    sourcePageType: "listing",
    legalPosture: "public_permitted",
    expectedPriceType: "realized_price"
  },
  {
    family: "portakal",
    sourceName: "Portakal",
    fixture: "portakal/listing.html",
    sourcePageType: "listing",
    legalPosture: "public_permitted",
    expectedPriceType: "asking_price"
  },
  {
    family: "antikasa",
    sourceName: "Antik A.S.",
    fixture: "antikasa/lot.html",
    sourcePageType: "lot",
    legalPosture: "public_permitted",
    expectedPriceType: "realized_price"
  },
  {
    family: "sanatfiyat",
    sourceName: "Sanatfiyat",
    fixture: "sanatfiyat/licensed.html",
    sourcePageType: "listing",
    legalPosture: "licensed_only",
    expectedPriceType: "realized_with_buyers_premium"
  },
  {
    family: "invaluable",
    sourceName: "Invaluable",
    fixture: "invaluable/lot.html",
    sourcePageType: "lot",
    legalPosture: "public_contract_sensitive",
    expectedPriceType: "realized_price"
  },
  {
    family: "liveauctioneers",
    sourceName: "LiveAuctioneers",
    fixture: "liveauctioneers/lot.html",
    sourcePageType: "lot",
    legalPosture: "public_contract_sensitive",
    expectedPriceType: "realized_price"
  }
];

interface SpinnerLike {
  text: string;
  start: () => SpinnerLike;
  stop: () => SpinnerLike;
  succeed: (text?: string) => SpinnerLike;
  fail: (text?: string) => SpinnerLike;
}

interface CliDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  spinnerFactory?: (text: string) => SpinnerLike;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  startInteractive?: () => Promise<number>;
}

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(`HTTP ${status}`);
  }
}

class InputValidationError extends Error {}
class TerminalStateError extends Error {
  constructor(readonly details: RunDetailsResponse) {
    super(`Run ${details.run.id} ended in a failed or blocked terminal state.`);
  }
}

interface CliContext {
  deps: Required<CliDeps>;
  exitCode: number;
  noTui: boolean;
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new InputValidationError(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function toNonNegativeInt(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new InputValidationError(`Expected ${label} to be a non-negative integer, received "${value}".`);
  }
  return parsed;
}

function toPositiveNumber(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InputValidationError(`Expected ${label} to be a positive number, received "${value}".`);
  }
  return parsed;
}

function parseRunStatus(value?: string): RunStatus | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const allowed: RunStatus[] = ["pending", "running", "completed", "failed"];
  if (!allowed.includes(normalized as RunStatus)) {
    throw new InputValidationError(`Invalid status "${value}". Allowed values: ${allowed.join(", ")}.`);
  }
  return normalized as RunStatus;
}

function isRunBlocked(details: RunDetailsResponse): boolean {
  const summary = details.summary;
  if (summary.accepted_records > 0) {
    return false;
  }
  return summary.total_records > 0 && (summary.source_status_breakdown.blocked ?? 0) > 0;
}

function isFailedOrBlocked(details: RunDetailsResponse): boolean {
  if (details.run.status === "failed") {
    return true;
  }
  return details.run.status === "completed" && isRunBlocked(details);
}

function writeLine(writer: (text: string) => void, text: string): void {
  writer(`${text}\n`);
}

function safeJsonParse(text: string): unknown {
  if (!text) return {};
  return JSON.parse(text);
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isNoTuiEnabled(userArgs: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return userArgs.includes("--no-tui") || isTruthyEnvFlag(env.ARTBOT_NO_TUI);
}

function getNestedValue(payload: unknown, pathSegments: string[]): unknown {
  let current = payload;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readNestedNumber(payload: unknown, paths: string[][]): number | undefined {
  for (const pathSegments of paths) {
    const value = getNestedValue(payload, pathSegments);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

function readNestedString(payload: unknown, paths: string[][]): string | undefined {
  for (const pathSegments of paths) {
    const value = getNestedValue(payload, pathSegments);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function formatBytesCompact(value: number | undefined): string {
  if (value == null) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let normalized = value;
  let unitIndex = 0;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }
  const decimals = normalized >= 10 || unitIndex === 0 ? 0 : 1;
  return `${normalized.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatBytesWithRaw(value: number | undefined): string {
  if (value == null) {
    return "n/a";
  }
  return `${formatBytesCompact(value)} (${Math.round(value).toLocaleString("en-US")} bytes)`;
}

function resolveGlobals(command: Command): GlobalOptions {
  const raw = command.optsWithGlobals() as {
    json?: boolean;
    apiBaseUrl?: string;
    apiKey?: string;
    verbose?: boolean;
    quiet?: boolean;
    noTui?: boolean;
  };

  const globals: GlobalOptions = {
    json: Boolean(raw.json),
    apiBaseUrl: raw.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://localhost:4000",
    apiKey: raw.apiKey ?? process.env.ARTBOT_API_KEY,
    verbose: Boolean(raw.verbose),
    quiet: Boolean(raw.quiet),
    noTui: Boolean(raw.noTui) || isTruthyEnvFlag(process.env.ARTBOT_NO_TUI)
  };

  if (globals.verbose && globals.quiet) {
    throw new InputValidationError("Choose either --verbose or --quiet, not both.");
  }

  return globals;
}

function logInfo(globals: GlobalOptions, ctx: CliContext, text: string): void {
  if (globals.json || globals.quiet) return;
  writeLine(ctx.deps.stdout, text);
}

function logVerbose(globals: GlobalOptions, ctx: CliContext, text: string): void {
  if (globals.json || globals.quiet || !globals.verbose) return;
  writeLine(ctx.deps.stderr, picocolors.dim(text));
}

function logError(globals: GlobalOptions, ctx: CliContext, text: string): void {
  if (globals.json) {
    writeLine(ctx.deps.stderr, text);
    return;
  }
  writeLine(ctx.deps.stderr, picocolors.red(text));
}

function printJson(globals: GlobalOptions, ctx: CliContext, payload: unknown): void {
  if (!globals.json) return;
  writeLine(ctx.deps.stdout, JSON.stringify(payload, null, 2));
}

function buildQuery(options: CommonOptions, requireTitle: boolean) {
  if (requireTitle && !options.title) {
    throw new InputValidationError("Missing required --title for work research.");
  }

  const query = {
    artist: options.artist,
    title: options.title,
    year: options.year,
    medium: options.medium,
    dimensions:
      options.heightCm || options.widthCm || options.depthCm
        ? {
            heightCm: toNumber(options.heightCm),
            widthCm: toNumber(options.widthCm),
            depthCm: toNumber(options.depthCm)
          }
        : undefined,
    imagePath: options.imagePath,
    dateRange:
      options.dateFrom || options.dateTo
        ? {
            from: options.dateFrom,
            to: options.dateTo
          }
        : undefined,
    scope: options.scope ?? "turkey_plus_international",
    turkeyFirst: options.turkeyFirst ?? true,
    analysisMode: options.analysisMode ?? "comprehensive",
    priceNormalization: options.priceNormalization ?? "usd_dual",
    authProfileId: options.authProfile,
    cookieFile: options.cookieFile,
    manualLoginCheckpoint: options.manualLogin ?? false,
    allowLicensed: options.allowLicensed ?? false,
    licensedIntegrations: options.licensedIntegrations
      ? options.licensedIntegrations
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
    preferredDiscoveryProviders: options.discoveryProviders
      ? options.discoveryProviders
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
    crawlMode: options.refresh ? "refresh" : "backfill"
  };

  return researchQuerySchema.parse(query);
}

async function requestJson<T>(
  ctx: CliContext,
  globals: GlobalOptions,
  method: "GET" | "POST",
  path: string,
  payload?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    ...(globals.apiKey ? { "x-api-key": globals.apiKey } : {})
  };
  const requestBody = payload === undefined ? undefined : JSON.stringify(payload);
  if (requestBody !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await ctx.deps.fetchImpl(`${globals.apiBaseUrl}${path}`, {
    method,
    headers,
    body: requestBody
  });

  const text = await response.text();
  const body = safeJsonParse(text);

  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }

  return body as T;
}

export function renderRunsTable(runs: RunEntity[]): string {
  const table = new Table({
    head: ["Run ID", "Type", "Status", "Retention", "Artist", "Created"],
    wordWrap: true
  });

  for (const run of runs) {
    table.push([
      run.id,
      run.runType,
      run.status,
      run.pinned ? "pinned" : "default",
      run.query.artist,
      new Date(run.createdAt).toLocaleString("en-US")
    ]);
  }

  return table.toString();
}

export function renderRecordsTable(records: PriceRecord[], limit = 8): string {
  const table = new Table({
    head: ["Artist", "Work", "Source", "Price Type", "Amount", "Currency"],
    wordWrap: true
  });

  for (const record of records.slice(0, limit)) {
    table.push([
      record.artist_name,
      record.work_title ?? "-",
      record.source_name,
      record.price_type,
      record.price_amount ?? "-",
      record.currency ?? "-"
    ]);
  }

  return table.toString();
}

export function renderSummaryTable(summary: RunSummary): string {
  const table = new Table({
    head: ["Metric", "Value"]
  });

  const pricedEvidenceCoverage = summary.evaluation_metrics?.valuation_readiness_ratio;
  const crawledCoverage = summary.priced_crawled_source_coverage_ratio ?? summary.priced_source_coverage_ratio;

  table.push(
    ["Accepted", summary.accepted_records],
    ["Rejected", summary.rejected_candidates],
    ["Discovered Candidates", summary.discovered_candidates],
    ["Accepted from Discovery", summary.accepted_from_discovery],
    [
      "Priced Evidence Coverage",
      pricedEvidenceCoverage != null ? `${Math.round(pricedEvidenceCoverage * 100)}%` : "n/a"
    ],
    ["Valuation Generated", summary.valuation_generated ? "yes" : "no"],
    ["Valuation Reason", summary.valuation_reason]
  );

  if (summary.evaluation_metrics) {
    table.push(
      ["Accepted Precision", `${Math.round(summary.evaluation_metrics.accepted_record_precision * 100)}%`],
      ["Priced Source Recall", `${Math.round(summary.evaluation_metrics.priced_source_recall * 100)}%`],
      ["Source Completeness", `${Math.round(summary.evaluation_metrics.source_completeness_ratio * 100)}%`],
      ["Manual Override Rate", `${Math.round(summary.evaluation_metrics.manual_override_rate * 100)}%`],
      ["Coverage Target Met", summary.evaluation_metrics.coverage_target_met ? "yes" : "no"]
    );
  }

  if (crawledCoverage != null) {
    table.push(["Priced Source Coverage (Crawled)", `${Math.round(crawledCoverage * 100)}%`]);
  }

  if (summary.priced_crawled_source_coverage_ratio != null && summary.priced_source_coverage_ratio != null) {
    table.push(["Priced Source Coverage (Attempted)", `${Math.round(summary.priced_source_coverage_ratio * 100)}%`]);
  }

  if (summary.cluster_count != null) {
    table.push(["Cluster Count", summary.cluster_count]);
  }
  if (summary.review_item_count != null) {
    table.push(["Review Queue Count", summary.review_item_count]);
  }
  if (summary.local_ai_analysis) {
    table.push(
      ["Local AI Accepted", summary.local_ai_analysis.decisions.accepted],
      ["Local AI Queued", summary.local_ai_analysis.decisions.queued],
      ["Local AI Rejected", summary.local_ai_analysis.decisions.rejected],
      ["Local AI Deterministic Vetos", summary.local_ai_analysis.deterministic_veto_count],
      ["Local AI Model", summary.local_ai_analysis.model ?? "n/a"]
    );
  }

  return table.toString();
}

export function renderBreakdownTable(title: string, values: Record<string, number>): string {
  const table = new Table({
    head: [title, "Count"]
  });

  for (const [key, value] of Object.entries(values)) {
    table.push([key, value]);
  }

  return table.toString();
}

export function renderSourcePlanTable(preview: SourcePlanPreviewResponse, limit = 12): string {
  const table = new Table({
    head: ["#", "Source", "Family", "State", "Access", "Legal", "Candidates", "Reason"],
    wordWrap: true
  });

  for (const item of preview.source_plan.slice(0, limit)) {
    table.push([
      item.priority_rank,
      item.source_name,
      item.source_family,
      item.selection_state,
      item.source_access_status,
      item.legal_posture ?? "-",
      `${item.candidate_count}/${preview.candidate_cap}`,
      item.selection_reason ?? item.skip_reason ?? "-"
    ]);
  }

  return table.toString();
}

export function renderSourceMetricsTable(metrics: SourceHealthRecord[], limit = 8): string {
  const table = new Table({
    head: ["Source", "Family", "Reliable", "Evidence", "Valuation", "Blocked", "Auth", "Last"]
  });

  for (const item of metrics.slice(0, limit)) {
    table.push([
      item.source_name,
      item.source_family,
      `${Math.round(item.reliability_score * 100)}%`,
      `${item.accepted_for_evidence_count}/${item.total_attempts}`,
      `${item.valuation_ready_count}/${item.total_attempts}`,
      item.blocked_count,
      item.auth_required_count,
      item.last_status
    ]);
  }

  return table.toString();
}

export function renderCanaryTable(canaries: CanaryResult[], limit = 8): string {
  const table = new Table({
    head: ["Family", "Source", "Status", "Observed", "Expected", "Acceptance", "Fixture"]
  });

  for (const item of canaries.slice(0, limit)) {
    table.push([
      item.family,
      item.source_name,
      item.status,
      item.observed_price_type,
      item.expected_price_type ?? "-",
      item.acceptance_reason,
      item.fixture
    ]);
  }

  return table.toString();
}

export function renderStorageUsageTable(summary: StorageUsageResponse): string {
  const totalVarBytes = readNestedNumber(summary, [
    ["total_var_bytes"],
    ["total_var_usage_bytes"],
    ["total_bytes"],
    ["totals", "var_bytes"],
    ["totals", "total_var_bytes"],
    ["usage", "total_bytes"],
    ["usage", "total_var_bytes"],
    ["usage", "var_bytes"]
  ]);
  const pinnedRuns = readNestedNumber(summary, [
    ["pinned_runs"],
    ["pinned", "runs"],
    ["run_counts", "pinned"],
    ["runs", "pinned"],
    ["usage", "pinned", "runs"]
  ]);
  const expirableRuns = readNestedNumber(summary, [
    ["expirable_runs"],
    ["expirable", "runs"],
    ["run_counts", "expirable"],
    ["runs", "expirable"],
    ["usage", "expirable", "runs"]
  ]);
  const lastCleanupReclaimedBytes = readNestedNumber(summary, [
    ["last_cleanup_reclaimed_bytes"],
    ["cleanup", "reclaimed_bytes"],
    ["cleanup", "last_reclaimed_bytes"],
    ["last_cleanup", "reclaimed_bytes"],
    ["usage", "last_cleanup", "reclaimed_bytes"]
  ]);
  const lastCleanupAt = readNestedString(summary, [
    ["last_cleanup_at"],
    ["last_cleanup_completed_at"],
    ["cleanup", "completed_at"],
    ["cleanup", "last_completed_at"],
    ["last_cleanup", "completed_at"],
    ["last_cleanup", "timestamp"],
    ["usage", "last_cleanup", "timestamp"]
  ]);

  const table = new Table({
    head: ["Metric", "Value"]
  });

  table.push(
    ["Total var usage", formatBytesWithRaw(totalVarBytes)],
    ["Pinned runs", pinnedRuns != null ? Math.round(pinnedRuns).toLocaleString("en-US") : "n/a"],
    ["Expirable runs", expirableRuns != null ? Math.round(expirableRuns).toLocaleString("en-US") : "n/a"],
    ["Last cleanup reclaimed", formatBytesWithRaw(lastCleanupReclaimedBytes)],
    ["Last cleanup at", lastCleanupAt ? new Date(lastCleanupAt).toLocaleString("en-US") : "n/a"]
  );

  return table.toString();
}

type ReviewQueueFilterStatus = "open" | "resolved" | undefined;
type ReviewDecision = "merge" | "keep_separate";

function parseReviewQueueStatus(value: string | undefined): ReviewQueueFilterStatus {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "open") return "open";
  if (normalized === "resolved") return "resolved";
  throw new InputValidationError(`Invalid review status "${value}". Use open or resolved.`);
}

function parseReviewDecision(value: string): ReviewDecision {
  const normalized = value.trim().toLowerCase();
  if (normalized === "merge") return "merge";
  if (normalized === "keep_separate") return "keep_separate";
  throw new InputValidationError(`Invalid review decision "${value}". Use merge or keep_separate.`);
}

function renderReviewQueueTable(
  items: Array<{
    left_record_key: string;
    right_record_key: string;
    status: string;
    recommended_action: string;
    confidence: number;
    reasons: string[];
    source_pair: string;
  }>
): string {
  const table = new Table({
    head: ["Left", "Right", "Status", "Action", "Confidence", "Sources", "Reasons"],
    wordWrap: true
  });

  for (const item of items) {
    table.push([
      item.left_record_key,
      item.right_record_key,
      item.status,
      item.recommended_action,
      item.confidence.toFixed(2),
      item.source_pair,
      item.reasons.join("; ")
    ]);
  }

  return table.toString();
}

function renderGraphMembershipTable(
  rows: Array<{
    record_key: string;
    source_name: string;
    status: string;
    confidence: number;
    reasons: string[];
  }>
): string {
  const table = new Table({
    head: ["Record", "Source", "Status", "Confidence", "Reasons"],
    wordWrap: true
  });
  for (const row of rows) {
    table.push([row.record_key, row.source_name, row.status, row.confidence.toFixed(2), row.reasons.join("; ")]);
  }
  return table.toString();
}

interface LocalStorageResolution {
  dbPath: string;
  runsRoot: string;
  workspaceRoot: string | null;
  manifestPath: string | null;
}

function resolveLocalStoragePaths(): LocalStorageResolution {
  loadWorkspaceEnv();
  const workspaceRoot = detectWorkspaceRoot(process.cwd());
  const configuredDbPath = process.env.DATABASE_PATH?.trim();
  const configuredRunsRoot = process.env.RUNS_ROOT?.trim();

  if (workspaceRoot && !process.env.ARTBOT_HOME?.trim()) {
    const dbPath = resolveWorkspaceRelativePath(configuredDbPath, workspaceRoot, "var/data/artbot.db");
    const runsRoot = resolveWorkspaceRelativePath(configuredRunsRoot, workspaceRoot, "var/runs");
    const guard = ensureWorkspaceRuntimeStoragePaths("cli", workspaceRoot, dbPath, runsRoot);
    return {
      dbPath,
      runsRoot,
      workspaceRoot,
      manifestPath: guard.manifestPath
    };
  }

  const runtimePaths = resolveLocalRuntimePaths(process.env);
  const runtimeRoot = runtimePaths.homeDir;
  return {
    dbPath:
      configuredDbPath && configuredDbPath.length > 0
        ? path.isAbsolute(configuredDbPath)
          ? path.resolve(configuredDbPath)
          : path.resolve(runtimeRoot, configuredDbPath)
        : path.resolve(runtimePaths.dbPath),
    runsRoot:
      configuredRunsRoot && configuredRunsRoot.length > 0
        ? path.isAbsolute(configuredRunsRoot)
          ? path.resolve(configuredRunsRoot)
          : path.resolve(runtimeRoot, configuredRunsRoot)
        : path.resolve(runtimePaths.runsRoot),
    workspaceRoot: null,
    manifestPath: null
  };
}

function renderSetupAssessment(assessment: SetupAssessment): string {
  const table = new Table({
    head: ["Check", "Status", "Detail"]
  });

  const localBackendStatus =
    assessment.localBackendMode === "workspace"
      ? picocolors.green("repo")
      : assessment.localBackendMode === "bundled"
        ? picocolors.green("bundled")
        : picocolors.yellow("unavailable");
  const localBackendDetail =
    assessment.localBackendMode === "workspace"
      ? (assessment.workspaceRoot ?? "Workspace root unavailable")
      : assessment.localBackendMode === "bundled"
        ? (assessment.localBackendPath ?? "Bundled runtime home unavailable")
        : "No local backend runtime detected";
  const localUnlimitedProfileActive =
    assessment.webDiscoveryEnabled && assessment.webDiscoveryProvider === "searxng" && !assessment.firecrawlEnabled;
  const discoveryStatus = localUnlimitedProfileActive
    ? picocolors.green("local-unlimited")
    : picocolors.yellow("custom");
  const discoveryDetail = assessment.webDiscoveryEnabled
    ? `${assessment.webDiscoveryProvider} -> duckduckgo_html fallback`
    : "disabled";

  table.push(
    [
      "LM Studio",
      assessment.llmHealth.ok ? picocolors.green("healthy") : picocolors.red("offline"),
      assessment.llmHealth.modelId ?? assessment.llmHealth.reason ?? assessment.llmBaseUrl
    ],
    [
      "ArtBot API",
      assessment.apiHealth.ok ? picocolors.green("healthy") : picocolors.yellow("offline"),
      assessment.apiHealth.reason ?? assessment.apiBaseUrl
    ],
    ["Local Backend", localBackendStatus, localBackendDetail],
    ["Config", picocolors.green("env"), assessment.envPath],
    ["Discovery Profile", discoveryStatus, discoveryDetail],
    [
      "SearXNG",
      assessment.searxngHealth.ok ? picocolors.green("healthy") : picocolors.yellow("offline"),
      assessment.searxngHealth.reason ?? assessment.searxngBaseUrl
    ],
    [
      "Firecrawl",
      assessment.firecrawlEnabled ? picocolors.yellow("enabled") : picocolors.green("disabled"),
      assessment.firecrawlEnabled ? "Optional paid extractor is active." : "Optional paid extractor is disabled."
    ],
    [
      "Auth Profiles",
      assessment.authProfilesError ? picocolors.red("invalid") : picocolors.green(String(assessment.profiles.length)),
      assessment.authProfilesError?.message ?? `${assessment.profiles.length} configured`
    ],
    [
      "Sessions",
      assessment.sessionStates.length === 0
        ? picocolors.yellow("none")
        : picocolors.green(String(assessment.sessionStates.length)),
      assessment.sessionStates
        .map(
          (session) => `${session.profileId}:${session.exists ? (session.expired ? "expired" : "ready") : "missing"}`
        )
        .join(", ") || "No relevant sessions"
    ]
  );

  return table.toString();
}

function renderBackendStatus(status: LocalBackendStatus): string {
  const table = new Table({
    head: ["Check", "Status", "Detail"]
  });

  table.push(
    [
      "Mode",
      status.available ? picocolors.green(status.mode) : picocolors.yellow("unavailable"),
      status.runtimeRoot ?? "No local backend runtime detected"
    ],
    [
      "API Process",
      status.api.running ? picocolors.green("running") : picocolors.yellow("stopped"),
      status.api.pid
        ? `pid ${status.api.pid}${status.api.logPath ? ` · ${status.api.logPath}` : ""}`
        : (status.api.logPath ?? "No managed API process")
    ],
    [
      "Worker Process",
      status.worker.running ? picocolors.green("running") : picocolors.yellow("stopped"),
      status.worker.pid
        ? `pid ${status.worker.pid}${status.worker.logPath ? ` · ${status.worker.logPath}` : ""}`
        : (status.worker.logPath ?? "No managed worker process")
    ],
    [
      "API Health",
      status.apiHealth.ok ? picocolors.green("healthy") : picocolors.yellow("offline"),
      status.apiHealth.reason ?? status.apiBaseUrl
    ],
    ["Entry Command", picocolors.green("ready"), status.recommendedEntryCommand]
  );

  return table.toString();
}

function renderSetupIssues(assessment: SetupAssessment): string {
  if (assessment.issues.length === 0) {
    return picocolors.green("No setup issues detected.");
  }

  return assessment.issues
    .map((issue) => {
      const prefix = issue.severity === "error" ? picocolors.red("error") : picocolors.yellow("warning");
      return `${prefix} ${issue.message}${issue.detail ? ` (${issue.detail})` : ""}`;
    })
    .join("\n");
}

function formatRunRetention(run: Pick<RunEntity, "pinned" | "pinnedAt">): string {
  if (!run.pinned) {
    return "default";
  }

  if (!run.pinnedAt) {
    return "pinned";
  }

  return `pinned since ${new Date(run.pinnedAt).toLocaleString("en-US")}`;
}

function renderAuthProfilesTable(assessment: SetupAssessment): string {
  const table = new Table({
    head: ["Profile", "Mode", "Matched Sources", "Storage State", "Risk"]
  });

  const relevantById = new Map(assessment.relevantProfiles.map((entry) => [entry.profile.id, entry.matchedSources]));
  const sessionsById = new Map(assessment.sessionStates.map((session) => [session.profileId, session]));

  for (const profile of assessment.profiles) {
    const session = sessionsById.get(profile.id);
    table.push([
      profile.id,
      profile.mode,
      (relevantById.get(profile.id) ?? []).join(", ") || "—",
      session
        ? `${session.exists ? (session.expired ? "expired" : "ready") : "missing"} · ${session.encryptedAtRest ? "encrypted" : "plaintext"} · ${session.storageStatePath}`
        : "—",
      session?.riskyReason ?? "—"
    ]);
  }

  return table.toString();
}

function printRunDetailsHuman(globals: GlobalOptions, ctx: CliContext, details: RunDetailsResponse): void {
  logInfo(globals, ctx, `Run ${details.run.id} (${details.run.runType})`);
  logInfo(globals, ctx, `Status: ${details.run.status}`);
  logInfo(globals, ctx, `Retention: ${formatRunRetention(details.run)}`);
  logInfo(globals, ctx, "");
  logInfo(globals, ctx, renderSummaryTable(details.summary));
  logInfo(globals, ctx, "");
  logInfo(globals, ctx, renderBreakdownTable("Source Status", details.summary.source_status_breakdown));
  logInfo(globals, ctx, "");
  logInfo(globals, ctx, renderBreakdownTable("Auth Mode", details.summary.auth_mode_breakdown));
  if (details.records.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Top comparable records:");
    logInfo(globals, ctx, renderRecordsTable(details.records));
  }
  if (details.recommended_actions && details.recommended_actions.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Recommended actions:");
    for (const action of details.recommended_actions.slice(0, 5)) {
      logInfo(globals, ctx, `- [${action.severity}] ${action.title}: ${action.reason}`);
    }
  }
  if (details.source_plan && details.source_plan.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Source plan:");
    for (const item of details.source_plan.slice(0, 8)) {
      logInfo(
        globals,
        ctx,
        `- ${item.source_name}: ${item.selection_state} · ${item.source_access_status} · ${item.candidate_count} candidates${item.legal_posture ? ` · ${item.legal_posture}` : ""}${item.selection_reason ? ` · ${item.selection_reason}` : item.skip_reason ? ` · ${item.skip_reason}` : ""}`
      );
    }
  }
  if (details.summary.discovery_provider_diagnostics && details.summary.discovery_provider_diagnostics.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Discovery providers:");
    for (const item of details.summary.discovery_provider_diagnostics) {
      logInfo(
        globals,
        ctx,
        `- ${item.provider}: ${item.enabled ? "enabled" : "disabled"} · requests ${item.requests_used} · results ${item.results_returned} · kept ${item.candidates_kept} · failover ${item.failover_invoked ? "yes" : "no"} · caps ${item.trimmed_by_caps ? "trimmed" : "ok"}${item.reason ? ` · ${item.reason}` : ""}`
      );
    }
  }
  if (details.summary.local_ai_analysis) {
    logInfo(globals, ctx, "");
    logInfo(
      globals,
      ctx,
      `Local AI: accepted ${details.summary.local_ai_analysis.decisions.accepted} · queued ${details.summary.local_ai_analysis.decisions.queued} · rejected ${details.summary.local_ai_analysis.decisions.rejected} · vetoes ${details.summary.local_ai_analysis.deterministic_veto_count}${details.summary.local_ai_analysis.model ? ` · model ${details.summary.local_ai_analysis.model}` : ""}`
    );
  }
  if (details.persisted_source_metrics && details.persisted_source_metrics.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Source metrics:");
    logInfo(globals, ctx, renderSourceMetricsTable(details.persisted_source_metrics));
  }
  if (details.recent_canaries && details.recent_canaries.length > 0) {
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, "Recent canaries:");
    logInfo(globals, ctx, renderCanaryTable(details.recent_canaries));
  }
  if (details.run.runType === "artist_market_inventory") {
    logInfo(globals, ctx, "");
    logInfo(
      globals,
      ctx,
      `Inventory rows: ${details.inventory?.length ?? 0} · clusters: ${details.clusters?.length ?? 0} · review items: ${details.review_queue?.length ?? 0}`
    );
    if (details.inventory_summary) {
      const realizedStats = details.inventory_summary.price_stats.realized ?? { count: 0 };
      const askingStats = details.inventory_summary.price_stats.asking ?? { count: 0 };
      const estimateStats = details.inventory_summary.price_stats.estimate ?? { count: 0 };
      logInfo(
        globals,
        ctx,
        `Price stats: realized ${realizedStats.count}, asking ${askingStats.count}, estimate ${estimateStats.count}`
      );
    }
  }
}

function resolveRunsRootLocal(): string {
  return resolveLocalStoragePaths().runsRoot;
}

function summarizeReplayAcceptance(reason: AcceptanceReason): string {
  return reason.replace(/_/g, " ");
}

type ReplayArtifactMode = "auto" | "raw" | "har";

function parseReplayArtifactMode(value: string | undefined): ReplayArtifactMode {
  const normalized = (value ?? "auto").trim().toLowerCase();
  if (normalized === "auto" || normalized === "raw" || normalized === "har") {
    return normalized;
  }
  throw new InputValidationError(`Unsupported replay artifact mode "${value}". Use auto, raw, or har.`);
}

function hasReplayArtifact(attempt: SourceAttempt, mode: ReplayArtifactMode): boolean {
  if (mode === "raw") return Boolean(attempt.raw_snapshot_path);
  if (mode === "har") return Boolean(attempt.har_path);
  return Boolean(attempt.raw_snapshot_path || attempt.har_path);
}

function decodeReplayHarContent(input: string, encoding: string | null | undefined): string {
  if (encoding?.toLowerCase() === "base64") {
    return Buffer.from(input, "base64").toString("utf-8");
  }
  return input;
}

function extractReplayHtmlFromHar(harPath: string, preferredUrl: string): { html: string; matchedUrl: string | null } {
  const parsed = JSON.parse(readFileSync(harPath, "utf-8")) as {
    log?: {
      entries?: Array<{
        request?: { url?: string };
        response?: {
          content?: { mimeType?: string; text?: string; encoding?: string };
          headers?: Array<{ name?: string; value?: string }>;
        };
      }>;
    };
  };
  const entries = parsed.log?.entries ?? [];
  const htmlEntries = entries
    .map((entry) => {
      const mimeType =
        entry.response?.content?.mimeType ??
        entry.response?.headers?.find((header) => header.name?.toLowerCase() === "content-type")?.value ??
        "";
      const text = entry.response?.content?.text;
      if (!text || !/text\/html|application\/xhtml\+xml/i.test(mimeType)) {
        return null;
      }
      return {
        url: entry.request?.url ?? null,
        html: decodeReplayHarContent(text, entry.response?.content?.encoding)
      };
    })
    .filter((entry): entry is { url: string | null; html: string } => Boolean(entry));

  const matched = htmlEntries.find((entry) => entry.url === preferredUrl) ?? htmlEntries[0];
  if (!matched) {
    throw new InputValidationError(`HAR file ${harPath} does not contain embedded replayable HTML.`);
  }
  return {
    html: matched.html,
    matchedUrl: matched.url
  };
}

function resolveReplayArtifact(
  attempt: SourceAttempt,
  mode: ReplayArtifactMode
): { kind: "raw_snapshot" | "har"; path: string; html: string; matchedUrl: string | null } {
  if ((mode === "auto" || mode === "raw") && attempt.raw_snapshot_path) {
    return {
      kind: "raw_snapshot",
      path: attempt.raw_snapshot_path,
      html: readFileSync(attempt.raw_snapshot_path, "utf-8"),
      matchedUrl: attempt.source_url
    };
  }
  if ((mode === "auto" || mode === "har") && attempt.har_path) {
    const replay = extractReplayHtmlFromHar(attempt.har_path, attempt.canonical_url ?? attempt.source_url);
    return {
      kind: "har",
      path: attempt.har_path,
      html: replay.html,
      matchedUrl: replay.matchedUrl
    };
  }

  if (mode === "raw") {
    throw new InputValidationError(`No replayable raw snapshot found for run ${attempt.run_id}.`);
  }
  if (mode === "har") {
    throw new InputValidationError(`No replayable HAR file found for run ${attempt.run_id}.`);
  }
  throw new InputValidationError(`No replayable raw snapshot or HAR file found for run ${attempt.run_id}.`);
}

async function handleReplayAttempt(ctx: CliContext, options: ReplayAttemptOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const artifactMode = parseReplayArtifactMode(options.artifact);
  const details = await requestJson<RunDetailsResponse>(ctx, globals, "GET", `/runs/${options.runId}`);
  const candidates = details.attempts.filter((attempt) => hasReplayArtifact(attempt, artifactMode));
  const selected =
    (options.source
      ? candidates.find((attempt) => attempt.source_name.toLowerCase().includes(options.source!.toLowerCase()))
      : undefined) ??
    candidates[toPositiveInt(options.index, 1) - 1] ??
    candidates[0];

  if (!selected) {
    throw new InputValidationError(`No replayable attempt found for run ${options.runId}.`);
  }

  const replayArtifact = resolveReplayArtifact(selected, artifactMode);
  const parsed = parseGenericLotFields(replayArtifact.html, replayArtifact.matchedUrl ?? selected.source_url);
  const acceptance = evaluateAcceptance(parsed, parsed.priceHidden ? "price_hidden" : selected.source_access_status, {
    sourceName: selected.source_name,
    sourcePageType: "lot"
  });
  const payload = {
    run_id: options.runId,
    source_name: selected.source_name,
    source_url: selected.source_url,
    original_attempt: {
      parser_used: selected.parser_used,
      source_access_status: selected.source_access_status,
      acceptance_reason: selected.acceptance_reason,
      confidence_score: selected.confidence_score,
      fetched_at: selected.fetched_at,
      raw_snapshot_path: selected.raw_snapshot_path ?? null,
      har_path: selected.har_path ?? null
    },
    replay: {
      artifact_kind: replayArtifact.kind,
      artifact_path: replayArtifact.path,
      matched_url: replayArtifact.matchedUrl,
      parsed,
      acceptance
    }
  };
  printJson(globals, ctx, payload);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, `Replay source: ${selected.source_name}`);
  logInfo(globals, ctx, `Artifact: ${replayArtifact.kind} (${replayArtifact.path})`);
  logInfo(globals, ctx, `Original parser: ${selected.parser_used}`);
  logInfo(globals, ctx, `Original acceptance: ${summarizeReplayAcceptance(selected.acceptance_reason)}`);
  logInfo(globals, ctx, `Replayed price type: ${parsed.priceType}`);
  logInfo(globals, ctx, `Replayed acceptance: ${summarizeReplayAcceptance(acceptance.acceptanceReason)}`);
}

async function handleArtifactGc(ctx: CliContext, options: ArtifactGcOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const runsRoot = options.runsRoot ? path.resolve(options.runsRoot) : resolveRunsRootLocal();
  const keepLast = toNonNegativeInt(options.keepLast, "--keep-last") ?? 0;
  const maxSizeGb = toPositiveNumber(options.maxSizeGb, "--max-size-gb");
  const policy = buildDefaultGcPolicyFromEnv();

  if (maxSizeGb != null) {
    const byteBudget = Math.max(1, Math.floor(maxSizeGb * 1024 * 1024 * 1024));
    policy.high_watermark_bytes = byteBudget;
    policy.target_bytes_after_gc = byteBudget;
  }

  const result = runArtifactGc(runsRoot, policy, {
    dryRun: Boolean(options.dryRun),
    keepLast
  });
  printJson(globals, ctx, {
    runsRoot,
    keep_last: keepLast,
    max_size_gb: maxSizeGb ?? null,
    policy,
    ...result
  });
  if (globals.json) {
    return;
  }
  logInfo(globals, ctx, `Runs root: ${runsRoot}`);
  logInfo(globals, ctx, `Mode: ${result.dry_run ? "dry-run" : "apply"}`);
  logInfo(globals, ctx, `Keep latest runs intact: ${keepLast}`);
  if (maxSizeGb != null) {
    logInfo(globals, ctx, `Max size budget: ${maxSizeGb} GB`);
  }
  logInfo(globals, ctx, `Scanned items: ${result.scanned_items}`);
  logInfo(globals, ctx, `${result.dry_run ? "Planned deletions" : "Deleted items"}: ${result.deleted_items}`);
  logInfo(
    globals,
    ctx,
    `By reason: duplicate ${result.deleted_by_reason.duplicate}, expired ${result.deleted_by_reason.expired}, watermark ${result.deleted_by_reason.watermark}`
  );
  logInfo(
    globals,
    ctx,
    `By class: accepted ${result.deleted_by_retention_class.accepted_evidence}, disputed ${result.deleted_by_retention_class.disputed_evidence}, heavy ${result.deleted_by_retention_class.heavy_debug}, ephemeral ${result.deleted_by_retention_class.ephemeral}`
  );
  logInfo(globals, ctx, `Reclaimed bytes: ${result.reclaimed_bytes}`);
  logInfo(globals, ctx, `Remaining bytes: ${result.remaining_bytes}`);
}

async function handleStorageUsage(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const summary = await requestJson<StorageUsageResponse>(ctx, globals, "GET", "/storage/usage");
  printJson(globals, ctx, summary);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, renderStorageUsageTable(summary));
}

async function handleReviewQueue(ctx: CliContext, options: ReviewQueueOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const details = await requestJson<RunDetailsResponse>(ctx, globals, "GET", `/runs/${options.runId}`);
  const statusFilter = parseReviewQueueStatus(options.status);
  const sourceNeedle = options.source?.trim().toLowerCase();
  const inventoryRows = details.inventory ?? [];
  const sourceByRecord = new Map(
    inventoryRows.map((row) => [row.record_key, row.payload?.source_name ?? row.source_host ?? "unknown"])
  );

  const rows = (details.review_queue ?? [])
    .filter((item) =>
      statusFilter === "open"
        ? item.status === "pending"
        : statusFilter === "resolved"
          ? item.status !== "pending"
          : true
    )
    .map((item) => {
      const leftSource = sourceByRecord.get(item.left_record_key) ?? "unknown";
      const rightSource = sourceByRecord.get(item.right_record_key) ?? "unknown";
      return {
        id: item.id,
        left_record_key: item.left_record_key,
        right_record_key: item.right_record_key,
        status: item.status,
        recommended_action: item.recommended_action,
        confidence: item.confidence,
        reasons: item.reasons,
        source_pair: `${leftSource} <> ${rightSource}`
      };
    })
    .filter((item) => !sourceNeedle || item.source_pair.toLowerCase().includes(sourceNeedle));

  const payload = {
    run_id: options.runId,
    status: statusFilter ?? "all",
    source: options.source ?? null,
    count: rows.length,
    items: rows
  };

  printJson(globals, ctx, payload);
  if (globals.json) return;

  if (rows.length === 0) {
    logInfo(globals, ctx, "No review queue items matched the selected filters.");
    return;
  }

  logInfo(globals, ctx, `Review queue items (${rows.length})`);
  logInfo(globals, ctx, renderReviewQueueTable(rows));
}

async function handleReviewDecide(ctx: CliContext, options: ReviewDecideOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const decision = parseReviewDecision(options.decision);
  const payload = await requestJson<{ run_id: string; review_item: unknown }>(
    ctx,
    globals,
    "POST",
    `/runs/${options.runId}/review-queue/${options.itemId}/adjudicate`,
    { decision }
  );
  printJson(globals, ctx, payload);
  if (globals.json) {
    return;
  }
  logInfo(globals, ctx, `Review item ${options.itemId} resolved as ${decision}.`);
}

async function handleGraphExplain(ctx: CliContext, options: GraphExplainOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const details = await requestJson<RunDetailsResponse>(ctx, globals, "GET", `/runs/${options.runId}`);
  const cluster = (details.clusters ?? []).find((item) => item.id === options.clusterId);
  if (!cluster) {
    throw new InputValidationError(`Cluster ${options.clusterId} was not found in run ${options.runId}.`);
  }

  const memberships = (details.cluster_memberships ?? []).filter((item) => item.cluster_id === options.clusterId);
  const inventoryByRecord = new Map((details.inventory ?? []).map((row) => [row.record_key, row]));
  const rows = memberships.map((membership) => {
    const inventoryRow = inventoryByRecord.get(membership.record_key);
    return {
      record_key: membership.record_key,
      source_name: inventoryRow?.payload?.source_name ?? inventoryRow?.source_host ?? "unknown",
      status: membership.status,
      confidence: membership.confidence,
      reasons: membership.reasons,
      work_title: inventoryRow?.payload?.work_title ?? null,
      source_url: inventoryRow?.payload?.source_url ?? null
    };
  });

  const payload = {
    run_id: options.runId,
    cluster,
    membership_count: memberships.length,
    memberships: rows
  };
  printJson(globals, ctx, payload);
  if (globals.json) return;

  logInfo(
    globals,
    ctx,
    `Cluster ${cluster.id}: ${cluster.title} · status=${cluster.cluster_status} · confidence=${cluster.confidence.toFixed(2)}`
  );
  if (rows.length === 0) {
    logInfo(globals, ctx, "No cluster memberships found.");
    return;
  }
  logInfo(globals, ctx, renderGraphMembershipTable(rows));
}

function openLocalStorage(): { storage: ArtbotStorage; resolved: LocalStorageResolution } {
  const resolved = resolveLocalStoragePaths();
  return {
    storage: new ArtbotStorage(resolved.dbPath, resolved.runsRoot),
    resolved
  };
}

function sourceStatusForCanary(definition: CanaryFixtureDefinition): SourceAttempt["source_access_status"] {
  return definition.legalPosture === "licensed_only" ? "licensed_access" : "public_access";
}

function buildCanaryResult(fixturesRoot: string, definition: CanaryFixtureDefinition): CanaryResult {
  const filePath = path.join(fixturesRoot, definition.fixture);
  const html = readFileSync(filePath, "utf-8");
  const evaluated = evaluateFixtureContract(
    {
      sourceName: definition.sourceName,
      sourcePageType: definition.sourcePageType,
      html,
      url: `https://fixture.local/${definition.fixture}`
    },
    sourceStatusForCanary(definition)
  );
  const observedPriceType = evaluated.parsed.priceType;
  const listingExpansionReady = /\/(?:lot|eser|urun)\//i.test(html);
  const expectsListingExpansion = definition.passMode === "listing_expansion";
  const status = expectsListingExpansion
    ? listingExpansionReady
      ? "pass"
      : "fail"
    : (definition.expectedPriceType == null || observedPriceType === definition.expectedPriceType) &&
        evaluated.acceptance.acceptedForEvidence
      ? "pass"
      : "fail";

  return {
    id: randomUUID(),
    family: definition.family,
    source_name: definition.sourceName,
    fixture: definition.fixture,
    source_page_type: definition.sourcePageType,
    legal_posture: definition.legalPosture,
    expected_price_type: definition.expectedPriceType,
    observed_price_type: observedPriceType,
    acceptance_reason: evaluated.acceptance.acceptanceReason,
    accepted_for_evidence: evaluated.acceptance.acceptedForEvidence,
    accepted_for_valuation: evaluated.acceptance.acceptedForValuation,
    status,
    details:
      status === "pass"
        ? expectsListingExpansion
          ? "Listing expansion links were present."
          : `Parsed ${observedPriceType} with ${evaluated.acceptance.acceptanceReason}.`
        : expectsListingExpansion
          ? "Listing expansion links were not detected."
          : `Observed ${observedPriceType} with ${evaluated.acceptance.acceptanceReason}; expected ${definition.expectedPriceType ?? "any priced signal"}.`,
    recorded_at: new Date().toISOString()
  };
}

async function handleCanariesRun(ctx: CliContext, options: CanaryRunOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const fixturesRoot = options.fixturesRoot
    ? path.resolve(options.fixturesRoot)
    : path.resolve(process.cwd(), "data/fixtures/adapters");
  const { storage, resolved } = openLocalStorage();
  const results = PRIORITY_CANARY_FIXTURES.map((definition) =>
    storage.saveCanaryResult(buildCanaryResult(fixturesRoot, definition))
  );
  const summary = {
    pass: results.filter((item) => item.status === "pass").length,
    fail: results.filter((item) => item.status === "fail").length
  };

  printJson(globals, ctx, {
    fixturesRoot,
    storage: {
      dbPath: resolved.dbPath,
      runsRoot: resolved.runsRoot,
      workspaceRoot: resolved.workspaceRoot,
      manifestPath: resolved.manifestPath
    },
    summary,
    results
  });
  if (globals.json) {
    return;
  }
  logInfo(globals, ctx, `Runtime storage: db=${resolved.dbPath} · runs=${resolved.runsRoot}`);
  if (resolved.manifestPath) {
    logInfo(globals, ctx, `Runtime path guard manifest: ${resolved.manifestPath}`);
  }
  logInfo(globals, ctx, `Canary pack: ${summary.pass} pass · ${summary.fail} fail`);
  logInfo(globals, ctx, renderCanaryTable(results, results.length));
}

async function handleCanariesHistory(ctx: CliContext, options: CanaryHistoryOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const { storage, resolved } = openLocalStorage();
  const limit = toPositiveInt(options.limit, 20);
  const canaries = storage.listCanaryResults(limit, options.family);

  printJson(globals, ctx, {
    storage: {
      dbPath: resolved.dbPath,
      runsRoot: resolved.runsRoot,
      workspaceRoot: resolved.workspaceRoot,
      manifestPath: resolved.manifestPath
    },
    canaries
  });
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, `Runtime storage: db=${resolved.dbPath} · runs=${resolved.runsRoot}`);
  if (resolved.manifestPath) {
    logInfo(globals, ctx, `Runtime path guard manifest: ${resolved.manifestPath}`);
  }

  if (canaries.length === 0) {
    logInfo(globals, ctx, "No canary history found.");
    return;
  }

  logInfo(globals, ctx, renderCanaryTable(canaries, limit));
}

async function waitForRunTerminal(
  ctx: CliContext,
  globals: GlobalOptions,
  runId: string,
  intervalSeconds: number
): Promise<RunDetailsResponse> {
  const spinner = globals.json || globals.quiet ? null : ctx.deps.spinnerFactory(`Waiting for run ${runId}...`).start();
  let previousStatus: RunStatus | null = null;

  while (true) {
    const details = await requestJson<RunDetailsResponse>(ctx, globals, "GET", `/runs/${runId}`);
    const status = details.run.status;
    if (spinner) {
      spinner.text = `Run ${runId} status: ${status}`;
    }

    if (previousStatus !== status) {
      logVerbose(globals, ctx, `Run ${runId}: ${previousStatus ?? "unknown"} -> ${status}`);
      previousStatus = status;
    }

    if (status === "completed" || status === "failed") {
      if (spinner) {
        if (isFailedOrBlocked(details)) {
          spinner.fail(`Run ${runId} ended in failed/blocked state`);
        } else {
          spinner.succeed(`Run ${runId} completed`);
        }
      }
      return details;
    }

    await ctx.deps.sleep(intervalSeconds * 1000);
  }
}

async function handleResearch(
  ctx: CliContext,
  options: CommonOptions,
  command: Command,
  runType: "artist" | "work" | "artist_market_inventory"
): Promise<void> {
  const globals = resolveGlobals(command);
  const query = buildQuery(options, runType === "work");
  const path =
    runType === "artist" ? "/research/artist" : runType === "work" ? "/research/work" : "/crawl/artist-market";
  const planPath =
    runType === "artist"
      ? "/research/artist/plan"
      : runType === "work"
        ? "/research/work/plan"
        : "/crawl/artist-market/plan";

  const shouldPreviewPlan = !globals.json || Boolean(options.previewOnly);
  const planSpinner =
    shouldPreviewPlan && !globals.json && !globals.quiet
      ? ctx.deps.spinnerFactory(`Preparing source plan for ${query.artist}...`).start()
      : null;
  let preview: SourcePlanPreviewResponse | null = null;
  try {
    preview = shouldPreviewPlan
      ? await requestJson<SourcePlanPreviewResponse>(ctx, globals, "POST", planPath, { query })
      : null;
    if (planSpinner) {
      planSpinner.succeed("Source plan ready.");
    }
  } catch (error) {
    if (planSpinner) {
      planSpinner.fail("Source plan request failed.");
    }
    throw error;
  }

  if (preview) {
    if (globals.json && options.previewOnly) {
      printJson(globals, ctx, preview);
      return;
    }

    if (!globals.json) {
      logInfo(globals, ctx, "Execution plan");
      logInfo(globals, ctx, renderSourcePlanTable(preview));
      logInfo(
        globals,
        ctx,
        `Selected: ${preview.totals.selected ?? 0} · Deprioritized: ${preview.totals.deprioritized ?? 0} · Skipped: ${preview.totals.skipped ?? 0} · Blocked: ${preview.totals.blocked ?? 0}`
      );
      if (preview.discovery_provider_diagnostics && preview.discovery_provider_diagnostics.length > 0) {
        logInfo(
          globals,
          ctx,
          `Discovery: ${preview.discovery_provider_diagnostics
            .map(
              (item) =>
                `${item.provider}=${item.enabled ? "on" : "off"} requests=${item.requests_used} results=${item.results_returned}${item.reason ? ` (${item.reason})` : ""}`
            )
            .join(" · ")}`
        );
      }
      logInfo(globals, ctx, "");
    }
  }

  if (options.previewOnly) {
    return;
  }

  const created = await requestJson<{ runId: string; status: RunStatus }>(ctx, globals, "POST", path, { query });

  if (!options.wait) {
    printJson(globals, ctx, created);
    if (!globals.json) {
      logInfo(globals, ctx, `Run created: ${created.runId} (${created.status})`);
      logInfo(globals, ctx, `Use "artbot runs show --run-id ${created.runId}" to inspect details.`);
    }
    return;
  }

  const waitIntervalSeconds = toPositiveInt(options.waitInterval, 2);
  const details = await waitForRunTerminal(ctx, globals, created.runId, waitIntervalSeconds);
  printJson(globals, ctx, details);
  if (!globals.json) {
    printRunDetailsHuman(globals, ctx, details);
  }

  if (isFailedOrBlocked(details)) {
    throw new TerminalStateError(details);
  }
}

async function handleRunsList(ctx: CliContext, options: RunsListOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const status = parseRunStatus(options.status);
  const limit = toPositiveInt(options.limit, 20);
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  query.set("limit", String(limit));

  const payload = await requestJson<RunsListResponse>(ctx, globals, "GET", `/runs?${query.toString()}`);
  printJson(globals, ctx, payload);
  if (globals.json) {
    return;
  }

  if (payload.runs.length === 0) {
    logInfo(globals, ctx, "No runs found for the selected filters.");
    return;
  }

  logInfo(globals, ctx, renderRunsTable(payload.runs));
}

async function handleRunsShow(ctx: CliContext, options: RunsShowOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const details = await requestJson<RunDetailsResponse>(ctx, globals, "GET", `/runs/${options.runId}`);
  printJson(globals, ctx, details);
  if (globals.json) {
    return;
  }
  printRunDetailsHuman(globals, ctx, details);
}

async function handleRunsWatch(ctx: CliContext, options: RunsWatchOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const intervalSeconds = toPositiveInt(options.interval, 2);
  const details = await waitForRunTerminal(ctx, globals, options.runId, intervalSeconds);
  printJson(globals, ctx, details);
  if (!globals.json) {
    printRunDetailsHuman(globals, ctx, details);
  }

  if (isFailedOrBlocked(details)) {
    throw new TerminalStateError(details);
  }
}

async function handleRunsPinMutation(
  ctx: CliContext,
  options: RunsShowOptions,
  command: Command,
  pinned: boolean
): Promise<void> {
  const globals = resolveGlobals(command);
  const run = await requestJson<RunEntity>(ctx, globals, "POST", `/runs/${options.runId}/${pinned ? "pin" : "unpin"}`, {});
  printJson(globals, ctx, run);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, `${pinned ? "Pinned" : "Unpinned"} run ${run.id}.`);
  logInfo(globals, ctx, `Retention: ${formatRunRetention(run)}`);
}

async function handleSetup(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  if (ctx.noTui || globals.noTui) {
    const message =
      "Setup is interactive and disabled by --no-tui or ARTBOT_NO_TUI. Use \"artbot backend start\" to bootstrap locally, then run \"artbot doctor\".";
    if (globals.json) {
      printJson(globals, ctx, {
        ok: false,
        code: "setup_interactive_disabled",
        message,
        recommended_commands: ["artbot backend start", "artbot doctor"]
      });
      return;
    }
    logInfo(globals, ctx, message);
    return;
  }

  const result = await runSetupWizard();
  printJson(globals, ctx, result);
  if (!globals.json) {
    logInfo(globals, ctx, renderSetupAssessment(result.assessment));
    logInfo(globals, ctx, "");
    logInfo(globals, ctx, renderSetupIssues(result.assessment));
    if (result.backendStart) {
      logInfo(globals, ctx, "");
      logInfo(
        globals,
        ctx,
        result.backendStart.reusedExisting ? "Local backend was already running." : "Started local backend."
      );
      logInfo(globals, ctx, `API log: ${result.backendStart.apiLogPath}`);
      logInfo(globals, ctx, `Worker log: ${result.backendStart.workerLogPath}`);
    }
  }
}

async function handleDoctor(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const assessment = await assessLocalSetup();
  printJson(globals, ctx, assessment);
  if (globals.json) {
    return;
  }
  logInfo(globals, ctx, renderSetupAssessment(assessment));
  logInfo(globals, ctx, "");
  logInfo(globals, ctx, renderSetupIssues(assessment));
}

async function handleTui(ctx: CliContext, command: Command): Promise<void> {
  if (ctx.noTui) {
    throw new InputValidationError(
      "TUI launch is disabled by --no-tui or ARTBOT_NO_TUI. Remove it to open the interactive UI."
    );
  }

  ctx.exitCode = await ctx.deps.startInteractive();
}

async function handleBackendStart(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const started = await startLocalBackendServices(process.cwd(), globals.apiBaseUrl);
  printJson(globals, ctx, started);
  if (globals.json) {
    return;
  }

  if (started.reusedExisting) {
    logInfo(globals, ctx, "Local backend is already running.");
  } else {
    logInfo(globals, ctx, "Started local backend.");
  }
  logInfo(globals, ctx, `API log: ${started.apiLogPath}`);
  logInfo(globals, ctx, `Worker log: ${started.workerLogPath}`);
}

async function handleBackendStop(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const status = await stopLocalBackendServices();
  printJson(globals, ctx, status);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, renderBackendStatus(status));
}

async function handleBackendStatus(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const status = await inspectLocalBackendStatus(process.cwd(), globals.apiBaseUrl);
  printJson(globals, ctx, status);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, renderBackendStatus(status));
}

async function handleLocalStart(ctx: CliContext, command: Command): Promise<void> {
  await handleBackendStart(ctx, command);
}

async function handleLocalStop(ctx: CliContext, command: Command): Promise<void> {
  await handleBackendStop(ctx, command);
}

async function handleLocalStatus(ctx: CliContext, command: Command): Promise<void> {
  await handleBackendStatus(ctx, command);
}

async function handleAuthList(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const assessment = await assessLocalSetup();
  printJson(globals, ctx, {
    profiles: assessment.profiles,
    relevant_profiles: assessment.relevantProfiles,
    session_states: assessment.sessionStates,
    auth_profiles_error: assessment.authProfilesError
  });
  if (globals.json) {
    return;
  }
  if (assessment.authProfilesError) {
    logError(globals, ctx, assessment.authProfilesError.message);
    return;
  }
  logInfo(globals, ctx, renderAuthProfilesTable(assessment));
}

async function handleAuthStatus(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const assessment = await assessLocalSetup();
  printJson(globals, ctx, assessment.sessionStates);
  if (globals.json) {
    return;
  }
  logInfo(globals, ctx, renderSetupAssessment(assessment));
  logInfo(globals, ctx, "");
  logInfo(globals, ctx, renderAuthProfilesTable(assessment));
}

async function handleAuthCapture(ctx: CliContext, options: AuthCaptureOptions, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
  const parsed = resolveAuthProfilesFromEnv();
  if (parsed.error) {
    throw new InputValidationError(parsed.error.message);
  }

  const profile = parsed.profiles.find((entry) => entry.id === options.profileId);
  if (!profile) {
    throw new InputValidationError(`Unknown auth profile "${options.profileId}".`);
  }

  const capture = buildAuthCaptureCommand(profile, defaultSourceUrlForProfile(profile.id));
  printJson(globals, ctx, capture);
  if (globals.json) {
    return;
  }

  logInfo(globals, ctx, `Launching Playwright auth capture for ${profile.id}...`);
  const playwrightCli = path.join(path.dirname(require.resolve("playwright")), "cli.js");
  const result = spawnSync(
    process.execPath,
    [playwrightCli, "codegen", capture.sourceUrl, `--save-storage=${capture.storageStatePath}`],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false
    }
  );

  if (result.status !== 0) {
    throw new Error(`Auth capture exited with status ${result.status ?? 1}.`);
  }

  const authManager = new AuthManager([profile]);
  authManager.persistSessionState(profile.id, capture.storageStatePath);
  if (capture.storageStatePath !== capture.finalStorageStatePath && fs.existsSync(capture.storageStatePath)) {
    fs.rmSync(capture.storageStatePath, { force: true });
  }
}

function addCommonResearchFlags(command: Command, withOptionalTitle: boolean): Command {
  const target = command
    .requiredOption("--artist <name>", "Artist name")
    .option("--year <year>", "Year")
    .option("--medium <medium>", "Medium")
    .option("--height-cm <number>", "Height in cm")
    .option("--width-cm <number>", "Width in cm")
    .option("--depth-cm <number>", "Depth in cm")
    .option("--scope <scope>", "turkey_only or turkey_plus_international")
    .option("--analysis-mode <mode>", "comprehensive | balanced | fast")
    .option("--price-normalization <mode>", "legacy | usd_dual | usd_nominal | usd_2026")
    .option("--no-turkey-first", "Disable Turkey-first source routing")
    .option("--date-from <date>", "YYYY-MM-DD")
    .option("--date-to <date>", "YYYY-MM-DD")
    .option("--image-path <path>", "Path to local image")
    .option("--auth-profile <id>", "Auth profile id")
    .option("--cookie-file <path>", "Cookie JSON file")
    .option("--manual-login", "Enable manual login checkpoint")
    .option("--allow-licensed", "Allow licensed integrations")
    .option("--licensed-integrations <list>", "Comma-separated source names")
    .option("--discovery-providers <list>", "Comma-separated discovery providers (searxng,brave,tavily)")
    .option("--refresh", "Run an incremental refresh instead of a full backfill")
    .option("--preview-only", "Show the source plan without creating the run")
    .option("--wait", "Wait until run reaches terminal state")
    .option("--wait-interval <seconds>", "Polling interval when --wait is enabled");

  if (withOptionalTitle) {
    target.option("--title <title>", "Work title");
  }

  return target;
}

function registerResearchCommands(program: Command, ctx: CliContext): void {
  const researchGroup = program.command("research").description("Research commands");

  addCommonResearchFlags(researchGroup.command("artist").description("Research artist prices"), true).action(
    async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "artist");
    }
  );

  addCommonResearchFlags(researchGroup.command("work").description("Research specific work prices"), false)
    .requiredOption("--title <title>", "Work title")
    .action(async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "work");
    });

  addCommonResearchFlags(
    program.command("research-artist").description("Research artist prices (legacy)"),
    true
  ).action(async (options: CommonOptions, command: Command) => {
    await handleResearch(ctx, options, command, "artist");
  });

  addCommonResearchFlags(program.command("research-work").description("Research specific work prices (legacy)"), false)
    .requiredOption("--title <title>", "Work title")
    .action(async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "work");
    });
}

function registerCrawlCommands(program: Command, ctx: CliContext): void {
  const crawlGroup = program.command("crawl").description("Long-running crawl commands");

  addCommonResearchFlags(
    crawlGroup.command("artist-market").description("Deep crawl artist market inventory"),
    true
  ).action(async (options: CommonOptions, command: Command) => {
    await handleResearch(ctx, options, command, "artist_market_inventory");
  });
}

function registerRunsCommands(program: Command, ctx: CliContext): void {
  const runsGroup = program.command("runs").description("Run inspection commands");

  runsGroup
    .command("list")
    .description("List recent runs")
    .option("--status <status>", "pending|running|completed|failed")
    .option("--limit <number>", "Maximum number of runs")
    .action(async (options: RunsListOptions, command: Command) => {
      await handleRunsList(ctx, options, command);
    });

  runsGroup
    .command("show")
    .description("Show a run details summary")
    .requiredOption("--run-id <id>", "Run identifier")
    .action(async (options: RunsShowOptions, command: Command) => {
      await handleRunsShow(ctx, options, command);
    });

  runsGroup
    .command("watch")
    .description("Watch a run until terminal state")
    .requiredOption("--run-id <id>", "Run identifier")
    .option("--interval <seconds>", "Polling interval in seconds", "2")
    .action(async (options: RunsWatchOptions, command: Command) => {
      await handleRunsWatch(ctx, options, command);
    });

  runsGroup
    .command("pin")
    .description("Preserve a run and its retained artifacts during cleanup")
    .requiredOption("--run-id <id>", "Run identifier")
    .action(async (options: RunsShowOptions, command: Command) => {
      await handleRunsPinMutation(ctx, options, command, true);
    });

  runsGroup
    .command("unpin")
    .description("Return a run to the default retention policy")
    .requiredOption("--run-id <id>", "Run identifier")
    .action(async (options: RunsShowOptions, command: Command) => {
      await handleRunsPinMutation(ctx, options, command, false);
    });

  program
    .command("run-status")
    .description("Show run details summary (legacy alias)")
    .requiredOption("--run-id <id>", "Run identifier")
    .action(async (options: RunsShowOptions, command: Command) => {
      await handleRunsShow(ctx, options, command);
    });
}

function registerSetupCommands(program: Command, ctx: CliContext): void {
  program
    .command("tui")
    .description("Launch the interactive terminal UI")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleTui(ctx, command);
    });

  program
    .command("setup")
    .description("Guided local onboarding for LM Studio, backend services, and auth profiles")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleSetup(ctx, command);
    });

  program
    .command("doctor")
    .description("Inspect local setup and health status")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleDoctor(ctx, command);
    });

  const backendGroup = program.command("backend").description("Local backend lifecycle commands");
  const localGroup = program.command("local").description("Preferred alias for local backend lifecycle commands");

  backendGroup
    .command("start")
    .description("Start the local ArtBot API and worker")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleBackendStart(ctx, command);
    });

  backendGroup
    .command("stop")
    .description("Stop the local ArtBot API and worker")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleBackendStop(ctx, command);
    });

  backendGroup
    .command("status")
    .description("Inspect local backend process and health status")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleBackendStatus(ctx, command);
    });

  localGroup
    .command("start")
    .description("Start the local ArtBot API and worker")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleLocalStart(ctx, command);
    });

  localGroup
    .command("stop")
    .description("Stop the local ArtBot API and worker")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleLocalStop(ctx, command);
    });

  localGroup
    .command("status")
    .description("Inspect local backend process and health status")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleLocalStatus(ctx, command);
    });

  const authGroup = program.command("auth").description("Auth profile and session-state commands");

  authGroup
    .command("list")
    .description("List configured auth profiles and matched sources")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleAuthList(ctx, command);
    });

  authGroup
    .command("status")
    .description("Inspect saved browser session state for auth profiles")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleAuthStatus(ctx, command);
    });

  authGroup
    .command("capture")
    .description("Capture browser auth state for a profile via Playwright")
    .argument("<profileId>", "Profile identifier")
    .action(async (profileId: string, _options: Record<string, never>, command: Command) => {
      await handleAuthCapture(ctx, { profileId }, command);
    });

  const replayGroup = program.command("replay").description("Offline replay and parser-debug commands");
  replayGroup
    .command("attempt")
    .description("Replay a stored raw snapshot from a completed run")
    .requiredOption("--run-id <id>", "Run identifier")
    .option("--source <name>", "Source name substring")
    .option("--index <number>", "1-based replay attempt index", "1")
    .option("--artifact <mode>", "Replay artifact mode: auto, raw, or har", "auto")
    .action(async (options: ReplayAttemptOptions, command: Command) => {
      await handleReplayAttempt(ctx, options, command);
    });

  const reviewGroup = program.command("review").description("Review queue inspection commands");
  reviewGroup
    .command("queue")
    .description("List review queue items for a run")
    .requiredOption("--run-id <id>", "Run identifier")
    .option("--status <status>", "open or resolved")
    .option("--source <name>", "Filter by source name in the record pair")
    .action(async (options: ReviewQueueOptions, command: Command) => {
      await handleReviewQueue(ctx, options, command);
    });

  reviewGroup
    .command("decide")
    .description("Adjudicate one review queue item")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--item-id <id>", "Review item identifier")
    .requiredOption("--decision <value>", "merge or keep_separate")
    .action(async (options: ReviewDecideOptions, command: Command) => {
      await handleReviewDecide(ctx, options, command);
    });

  const graphGroup = program.command("graph").description("Canonical entity graph inspection commands");
  graphGroup
    .command("explain")
    .description("Explain one cluster and its membership evidence")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--cluster-id <id>", "Cluster identifier")
    .action(async (options: GraphExplainOptions, command: Command) => {
      await handleGraphExplain(ctx, options, command);
    });

  program
    .command("storage")
    .description("Show storage usage visibility")
    .action(async (_options: Record<string, never>, command: Command) => {
      await handleStorageUsage(ctx, command);
    });

  const opsGroup = program.command("ops").description("Operational maintenance commands");
  const cleanupCommand = program
    .command("cleanup")
    .description("Clean up retained run artifacts and enforce a local storage budget");

  cleanupCommand
    .option("--runs-root <path>", "Runs root to scan")
    .option("--dry-run", "Report what cleanup would delete without mutating artifacts")
    .option("--max-size-gb <number>", "Trim retained artifacts until the runs root is at or below this size budget")
    .option(
      "--keep-last <number>",
      "Preserve the newest completed runs in full unless the size budget still requires purging"
    )
    .action(async (options: ArtifactGcOptions, command: Command) => {
      await handleArtifactGc(ctx, options, command);
    });

  opsGroup
    .command("gc")
    .description("Run artifact retention and garbage collection over run artifacts (legacy alias)")
    .option("--runs-root <path>", "Runs root to scan")
    .option("--dry-run", "Report what GC would delete without mutating artifacts")
    .option("--max-size-gb <number>", "Trim retained artifacts until the runs root is at or below this size budget")
    .option(
      "--keep-last <number>",
      "Preserve the newest completed runs in full unless the size budget still requires purging"
    )
    .action(async (options: ArtifactGcOptions, command: Command) => {
      await handleArtifactGc(ctx, options, command);
    });

  const canaryGroup = program.command("canaries").description("Fixture-backed canary checks");
  canaryGroup
    .command("run")
    .description("Run fixture-backed canaries for priority source families and persist results")
    .option("--fixtures-root <path>", "Fixture root override")
    .action(async (options: CanaryRunOptions, command: Command) => {
      await handleCanariesRun(ctx, options, command);
    });

  canaryGroup
    .command("history")
    .description("Show recent persisted canary history")
    .option("--family <name>", "Filter by source family")
    .option("--limit <number>", "Maximum number of canary rows", "20")
    .action(async (options: CanaryHistoryOptions, command: Command) => {
      await handleCanariesHistory(ctx, options, command);
    });
}

function defaultDeps(partial: CliDeps = {}): Required<CliDeps> {
  return {
    fetchImpl: partial.fetchImpl ?? fetch,
    sleep: partial.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    spinnerFactory: partial.spinnerFactory ?? ((text: string) => ora(text)),
    stdout: partial.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: partial.stderr ?? ((text: string) => process.stderr.write(text)),
    startInteractive:
      partial.startInteractive ??
      (async () => {
        const { startInteractive } = await import("./interactive.js");
        return startInteractive();
      })
  };
}

function mapErrorToExitCode(error: unknown): number {
  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  ) {
    return EXIT_CODES.OK;
  }
  if (error instanceof CommanderError) {
    return EXIT_CODES.INPUT;
  }
  if (error instanceof InputValidationError || error instanceof ZodError) {
    return EXIT_CODES.INPUT;
  }
  if (error instanceof TerminalStateError) {
    return EXIT_CODES.TERMINAL;
  }
  if (error instanceof ApiRequestError) {
    return EXIT_CODES.API;
  }
  return EXIT_CODES.API;
}

function formatError(error: unknown): string {
  const serializeBody = (value: unknown): string => {
    try {
      const text = JSON.stringify(value);
      return text.length > 320 ? `${text.slice(0, 317)}...` : text;
    } catch {
      return String(value);
    }
  };

  if (error instanceof ApiRequestError) {
    const body = serializeBody(error.body);
    if (error.status === 401) {
      return `API authentication failed (401). Next: pass --api-key or set ARTBOT_API_KEY.`;
    }
    if (error.status === 404) {
      return `Requested resource was not found (404). Next: verify identifiers (for example --run-id) and retry.`;
    }
    if (error.status >= 500) {
      return `API server error (${error.status}). Next: inspect API logs and retry.`;
    }
    return `API request failed (${error.status}). Next: rerun with --verbose and confirm request payload. Body: ${body}`;
  }
  if (error instanceof InputValidationError) {
    return `${error.message} Next: run command with --help to verify valid options.`;
  }
  if (error instanceof ZodError) {
    return `Invalid input: ${error.issues.map((issue) => issue.message).join("; ")} Next: run command with --help to verify required flags.`;
  }
  if (error instanceof TerminalStateError) {
    return `Run ${error.details.run.id} reached a failed or blocked terminal state. Next: run "artbot runs show --run-id ${error.details.run.id}" for diagnostics.`;
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return `Cannot reach API endpoint. Next: start the API service or set --api-base-url to the correct host.`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createProgram(ctx: CliContext): Command {
  const program = new Command();
  program.name("artbot").description("ArtBot market research CLI").version(CLI_VERSION);

  program
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.deps.stdout(text),
      writeErr: (text) => ctx.deps.stderr(text)
    });

  program
    .option("--json", "Machine-readable JSON output")
    .option("--api-base-url <url>", "API base URL")
    .option("--api-key <key>", "API key override")
    .option("--verbose", "Verbose diagnostics")
    .option("--quiet", "Suppress non-error human output")
    .option("--no-tui", "Disable interactive UI launch and stay in command-only mode");

  registerResearchCommands(program, ctx);
  registerCrawlCommands(program, ctx);
  registerRunsCommands(program, ctx);
  registerSetupCommands(program, ctx);

  return program;
}

export async function runCli(argv = process.argv, deps: CliDeps = {}): Promise<number> {
  loadWorkspaceEnv();
  const userArgs = argv.slice(2);
  const normalizedUserArgs = userArgs[0] === "--" ? userArgs.slice(1) : userArgs;
  const normalizedArgv = [argv[0] ?? "node", argv[1] ?? "artbot", ...normalizedUserArgs];

  const ctx: CliContext = {
    deps: defaultDeps(deps),
    exitCode: EXIT_CODES.OK,
    noTui: isNoTuiEnabled(normalizedUserArgs)
  };

  const program = createProgram(ctx);
  const wantsHelp = normalizedUserArgs.includes("-h") || normalizedUserArgs.includes("--help");
  const wantsVersion = normalizedUserArgs.includes("-V") || normalizedUserArgs.includes("--version");
  if (!wantsHelp && !wantsVersion) {
    const { operands, unknown } = program.parseOptions(normalizedUserArgs);
    const onlyGlobalOptions = operands.length === 0 && unknown.length === 0;
    if (onlyGlobalOptions) {
      program.outputHelp();
      return EXIT_CODES.OK;
    }
  }

  try {
    await program.parseAsync(normalizedArgv);
    return ctx.exitCode;
  } catch (error) {
    const exitCode = mapErrorToExitCode(error);
    if (
      !(
        error instanceof CommanderError &&
        (error.code === "commander.helpDisplayed" || error.code === "commander.version")
      )
    ) {
      const globals = (() => {
        try {
          return resolveGlobals(program);
        } catch {
          return {
            json: false,
            apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
            apiKey: process.env.ARTBOT_API_KEY,
            verbose: false,
            quiet: false,
            noTui: isTruthyEnvFlag(process.env.ARTBOT_NO_TUI)
          } satisfies GlobalOptions;
        }
      })();
      logError(globals, ctx, formatError(error));
    }
    return exitCode;
  }
}

function isMainModule(currentImportUrl: string): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  return pathToFileURL(scriptPath).href === currentImportUrl;
}

if (isMainModule(import.meta.url)) {
  runCli(process.argv)
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const fallbackMessage = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${fallbackMessage}\n`);
      process.exit(EXIT_CODES.API);
    });
}
