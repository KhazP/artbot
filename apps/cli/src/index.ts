import "dotenv/config";
import { pathToFileURL } from "node:url";
import Table from "cli-table3";
import { Command, CommanderError } from "commander";
import ora from "ora";
import picocolors from "picocolors";
import { ZodError } from "zod";
import type { PriceRecord, RunEntity, RunStatus, RunSummary, SourceAttempt } from "@artbot/shared-types";
import { researchQuerySchema } from "@artbot/shared-types";

const EXIT_CODES = {
  OK: 0,
  INPUT: 2,
  API: 3,
  TERMINAL: 4
} as const;

interface CommonOptions {
  artist: string;
  turkeyFirst?: boolean;
  scope?: "turkey_only" | "turkey_plus_international";
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

interface GlobalOptions {
  json: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  verbose: boolean;
  quiet: boolean;
}

export interface RunDetailsResponse {
  run: RunEntity;
  summary: RunSummary;
  records: PriceRecord[];
  attempts: SourceAttempt[];
}

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
    authProfileId: options.authProfile,
    cookieFile: options.cookieFile,
    manualLoginCheckpoint: options.manualLogin ?? false,
    allowLicensed: options.allowLicensed ?? false,
    licensedIntegrations: options.licensedIntegrations
      ? options.licensedIntegrations
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : []
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

function renderRunsTable(runs: RunEntity[]): string {
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

function renderRecordsTable(records: PriceRecord[], limit = 8): string {
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

function renderSummaryTable(summary: RunSummary): string {
  const table = new Table({
    head: ["Metric", "Value"]
  });

  table.push(
    ["Accepted", summary.accepted_records],
    ["Rejected", summary.rejected_candidates],
    ["Discovered Candidates", summary.discovered_candidates],
    ["Accepted from Discovery", summary.accepted_from_discovery],
    ["Valuation Generated", summary.valuation_generated ? "yes" : "no"],
    ["Valuation Reason", summary.valuation_reason]
  );

  return table.toString();
}

function renderBreakdownTable(title: string, values: Record<string, number>): string {
  const table = new Table({
    head: [title, "Count"]
  });

  for (const [key, value] of Object.entries(values)) {
    table.push([key, value]);
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
  runType: "artist" | "work"
): Promise<void> {
  const globals = resolveGlobals(command);
  const query = buildQuery(options, runType === "work");
  const created = await requestJson<{ runId: string; status: RunStatus }>(
    ctx,
    globals,
    "POST",
    runType === "artist" ? "/research/artist" : "/research/work",
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

function addCommonResearchFlags(command: Command, withOptionalTitle: boolean): Command {
  const target = command
    .requiredOption("--artist <name>", "Artist name")
    .option("--year <year>", "Year")
    .option("--medium <medium>", "Medium")
    .option("--height-cm <number>", "Height in cm")
    .option("--width-cm <number>", "Width in cm")
    .option("--depth-cm <number>", "Depth in cm")
    .option("--scope <scope>", "turkey_only or turkey_plus_international")
    .option("--no-turkey-first", "Disable Turkey-first source routing")
    .option("--date-from <date>", "YYYY-MM-DD")
    .option("--date-to <date>", "YYYY-MM-DD")
    .option("--image-path <path>", "Path to local image")
    .option("--auth-profile <id>", "Auth profile id")
    .option("--cookie-file <path>", "Cookie JSON file")
    .option("--manual-login", "Enable manual login checkpoint")
    .option("--allow-licensed", "Allow licensed integrations")
    .option("--licensed-integrations <list>", "Comma-separated source names")
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
  if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
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
  program.name("artbot").description("Turkish art price research agent CLI").version("0.2.0");

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
  registerRunsCommands(program, ctx);

  return program;
}

export async function runCli(argv = process.argv, deps: CliDeps = {}): Promise<number> {
  const ctx: CliContext = {
    deps: defaultDeps(deps),
    exitCode: EXIT_CODES.OK
  };

  const program = createProgram(ctx);

  try {
    await program.parseAsync(argv);
    return ctx.exitCode;
  } catch (error) {
    const exitCode = mapErrorToExitCode(error);
    if (!(error instanceof CommanderError && error.code === "commander.helpDisplayed")) {
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
