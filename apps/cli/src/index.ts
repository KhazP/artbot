import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import Table from "cli-table3";
import { Command, CommanderError } from "commander";
import ora from "ora";
import picocolors from "picocolors";
import { ZodError } from "zod";
import type {
  PriceRecord,
  RunEntity,
  RunDetailsResponsePayload,
  RunStatus,
  RunSummary,
  SourceAttempt
} from "@artbot/shared-types";
import { researchQuerySchema } from "@artbot/shared-types";
import {
  assessLocalSetup,
  buildAuthCaptureCommand,
  defaultSourceUrlForProfile,
  inspectLocalBackendStatus,
  loadWorkspaceEnv,
  resolveAuthProfilesFromEnv,
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
  heightCm?: string;
  widthCm?: string;
  depthCm?: string;
  wait?: boolean;
  waitInterval?: string;
  refresh?: boolean;
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

interface GlobalOptions {
  json: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  verbose: boolean;
  quiet: boolean;
}

export type RunDetailsResponse = RunDetailsResponsePayload;

interface RunsListResponse {
  runs: RunEntity[];
}

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

function resolveGlobals(command: Command): GlobalOptions {
  const raw = command.optsWithGlobals() as {
    json?: boolean;
    apiBaseUrl?: string;
    apiKey?: string;
    verbose?: boolean;
    quiet?: boolean;
  };

  const globals: GlobalOptions = {
    json: Boolean(raw.json),
    apiBaseUrl: raw.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://localhost:4000",
    apiKey: raw.apiKey ?? process.env.ARTBOT_API_KEY,
    verbose: Boolean(raw.verbose),
    quiet: Boolean(raw.quiet)
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
  const response = await ctx.deps.fetchImpl(`${globals.apiBaseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(globals.apiKey ? { "x-api-key": globals.apiKey } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
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
    head: ["Run ID", "Type", "Status", "Artist", "Created"],
    wordWrap: true
  });

  for (const run of runs) {
    table.push([
      run.id,
      run.runType,
      run.status,
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

  const crawledCoverage =
    summary.priced_crawled_source_coverage_ratio ?? summary.priced_source_coverage_ratio;

  table.push(
    ["Accepted", summary.accepted_records],
    ["Rejected", summary.rejected_candidates],
    ["Discovered Candidates", summary.discovered_candidates],
    ["Accepted from Discovery", summary.accepted_from_discovery],
    [
      "Priced Coverage (Crawled)",
      crawledCoverage != null ? `${Math.round(crawledCoverage * 100)}%` : "n/a"
    ],
    ["Valuation Generated", summary.valuation_generated ? "yes" : "no"],
    ["Valuation Reason", summary.valuation_reason]
  );

  if (summary.priced_crawled_source_coverage_ratio != null && summary.priced_source_coverage_ratio != null) {
    table.push(["Priced Coverage (Attempted)", `${Math.round(summary.priced_source_coverage_ratio * 100)}%`]);
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
      ? assessment.workspaceRoot ?? "Workspace root unavailable"
      : assessment.localBackendMode === "bundled"
        ? assessment.localBackendPath ?? "Bundled runtime home unavailable"
        : "No local backend runtime detected";

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
    [
      "Local Backend",
      localBackendStatus,
      localBackendDetail
    ],
    [
      "Config",
      picocolors.green("env"),
      assessment.envPath
    ],
    [
      "Auth Profiles",
      assessment.authProfilesError ? picocolors.red("invalid") : picocolors.green(String(assessment.profiles.length)),
      assessment.authProfilesError?.message ?? `${assessment.profiles.length} configured`
    ],
    [
      "Sessions",
      assessment.sessionStates.length === 0 ? picocolors.yellow("none") : picocolors.green(String(assessment.sessionStates.length)),
      assessment.sessionStates
        .map((session) => `${session.profileId}:${session.exists ? (session.expired ? "expired" : "ready") : "missing"}`)
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
      status.api.pid ? `pid ${status.api.pid}${status.api.logPath ? ` · ${status.api.logPath}` : ""}` : status.api.logPath ?? "No managed API process"
    ],
    [
      "Worker Process",
      status.worker.running ? picocolors.green("running") : picocolors.yellow("stopped"),
      status.worker.pid
        ? `pid ${status.worker.pid}${status.worker.logPath ? ` · ${status.worker.logPath}` : ""}`
        : status.worker.logPath ?? "No managed worker process"
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

function renderAuthProfilesTable(assessment: SetupAssessment): string {
  const table = new Table({
    head: ["Profile", "Mode", "Matched Sources", "Storage State"]
  });

  const relevantById = new Map(assessment.relevantProfiles.map((entry) => [entry.profile.id, entry.matchedSources]));
  const sessionsById = new Map(assessment.sessionStates.map((session) => [session.profileId, session]));

  for (const profile of assessment.profiles) {
    const session = sessionsById.get(profile.id);
    table.push([
      profile.id,
      profile.mode,
      (relevantById.get(profile.id) ?? []).join(", ") || "—",
      session ? `${session.exists ? (session.expired ? "expired" : "ready") : "missing"} · ${session.storageStatePath}` : "—"
    ]);
  }

  return table.toString();
}

function printRunDetailsHuman(globals: GlobalOptions, ctx: CliContext, details: RunDetailsResponse): void {
  logInfo(globals, ctx, `Run ${details.run.id} (${details.run.runType})`);
  logInfo(globals, ctx, `Status: ${details.run.status}`);
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
    runType === "artist"
      ? "/research/artist"
      : runType === "work"
        ? "/research/work"
        : "/crawl/artist-market";
  const created = await requestJson<{ runId: string; status: RunStatus }>(
    ctx,
    globals,
    "POST",
    path,
    { query }
  );

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

async function handleSetup(ctx: CliContext, command: Command): Promise<void> {
  const globals = resolveGlobals(command);
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
  const playwrightCli = require.resolve("playwright/cli");
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
    .option("--refresh", "Run an incremental refresh instead of a full backfill")
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

  addCommonResearchFlags(program.command("research-artist").description("Research artist prices (legacy)"), true).action(
    async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "artist");
    }
  );

  addCommonResearchFlags(program.command("research-work").description("Research specific work prices (legacy)"), false)
    .requiredOption("--title <title>", "Work title")
    .action(async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "work");
    });
}

function registerCrawlCommands(program: Command, ctx: CliContext): void {
  const crawlGroup = program.command("crawl").description("Long-running crawl commands");

  addCommonResearchFlags(crawlGroup.command("artist-market").description("Deep crawl artist market inventory"), true).action(
    async (options: CommonOptions, command: Command) => {
      await handleResearch(ctx, options, command, "artist_market_inventory");
    }
  );
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
}

function defaultDeps(partial: CliDeps = {}): Required<CliDeps> {
  return {
    fetchImpl: partial.fetchImpl ?? fetch,
    sleep: partial.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    spinnerFactory: partial.spinnerFactory ?? ((text: string) => ora(text)),
    stdout: partial.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: partial.stderr ?? ((text: string) => process.stderr.write(text))
  };
}

function mapErrorToExitCode(error: unknown): number {
  if (error instanceof CommanderError && (error.code === "commander.helpDisplayed" || error.code === "commander.version")) {
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
  program.name("artbot").description("Turkish art price research agent CLI").version(CLI_VERSION);

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
    .option("--quiet", "Suppress non-error human output");

  registerResearchCommands(program, ctx);
  registerCrawlCommands(program, ctx);
  registerRunsCommands(program, ctx);
  registerSetupCommands(program, ctx);

  return program;
}

export async function runCli(argv = process.argv, deps: CliDeps = {}): Promise<number> {
  loadWorkspaceEnv();

  const ctx: CliContext = {
    deps: defaultDeps(deps),
    exitCode: EXIT_CODES.OK
  };

  // Launch interactive mode when no arguments provided and stdout is a TTY
  const userArgs = argv.slice(2);
  if (userArgs.length === 0 && process.stdout.isTTY) {
    const { startInteractive } = await import("./interactive.js");
    return startInteractive();
  }

  const program = createProgram(ctx);

  try {
    await program.parseAsync(argv);
    return ctx.exitCode;
  } catch (error) {
    const exitCode = mapErrorToExitCode(error);
    if (!(error instanceof CommanderError && (error.code === "commander.helpDisplayed" || error.code === "commander.version"))) {
      const globals = (() => {
        try {
          return resolveGlobals(program);
        } catch {
          return {
            json: false,
            apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
            apiKey: process.env.ARTBOT_API_KEY,
            verbose: false,
            quiet: false
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
