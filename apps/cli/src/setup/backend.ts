import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkApiHealth } from "./health.js";
import type {
  LocalBackendMode,
  LocalBackendProcessCommand,
  LocalBackendStatus,
  StartedBackendServices
} from "./types.js";
import { ensureLocalRuntimePaths, hasLocalBackendWorkspace, resolveLocalRuntimePaths, resolveWorkspaceRoot } from "./env.js";

export interface BackendStartMetadata {
  mode: Exclude<LocalBackendMode, "none">;
  api: LocalBackendProcessCommand;
  worker: LocalBackendProcessCommand;
  apiHealthPath: string;
  recommendedEntryCommand: string;
  runtimeRoot: string;
}

interface PersistedBackendState {
  mode: Exclude<LocalBackendMode, "none">;
  runtimeRoot: string;
  apiPid: number | null;
  workerPid: number | null;
  apiLogPath: string;
  workerLogPath: string;
  apiBaseUrl: string;
  updatedAt: string;
}

function resolveCliDistRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(modulePath);
  return path.basename(moduleDir) === "chunks" ? path.resolve(moduleDir, "..") : moduleDir;
}

function resolveBundledRuntimeEntry(service: "api" | "worker"): string | null {
  const entry = path.join(resolveCliDistRoot(), "runtime", service === "api" ? "api.js" : "worker.js");
  return fs.existsSync(entry) ? entry : null;
}

function resolveBundledBackendRoot(): string {
  return ensureLocalRuntimePaths().homeDir;
}

function resolvePnpmExecutable(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function ensureWorkspaceRuntimeBuilt(workspaceRoot: string): void {
  const apiEntry = path.join(workspaceRoot, "apps", "api", "dist", "server.js");
  const workerEntry = path.join(workspaceRoot, "apps", "worker", "dist", "index.js");
  if (fs.existsSync(apiEntry) && fs.existsSync(workerEntry)) {
    return;
  }

  const result = spawnSync(resolvePnpmExecutable(), ["build"], {
    cwd: workspaceRoot,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Failed to build the ArtBot workspace before starting the local backend (exit ${result.status ?? 1}).`);
  }
}

function resolveStatePath(mode: Exclude<LocalBackendMode, "none">, root: string): string {
  if (mode === "workspace") {
    return path.join(root, "var", "state", "backend-state.json");
  }

  return resolveLocalRuntimePaths().backendStatePath;
}

function readBackendState(mode: Exclude<LocalBackendMode, "none">, root: string): PersistedBackendState | null {
  const statePath = resolveStatePath(mode, root);
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")) as PersistedBackendState;
  } catch {
    return null;
  }
}

function writeBackendState(state: PersistedBackendState): void {
  const statePath = resolveStatePath(state.mode, state.runtimeRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function removeBackendState(mode: Exclude<LocalBackendMode, "none">, root: string): void {
  fs.rmSync(resolveStatePath(mode, root), { force: true });
}

function isPidRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnDetachedProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
}): number | null {
  const logFd = fs.openSync(options.logPath, "a");
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);
  return child.pid ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePortFromApiBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    if (url.port) {
      return url.port;
    }
  } catch {
    // Fall back to the default ArtBot local API port.
  }

  return "4000";
}

function resolveBundledEnv(apiBaseUrl: string): NodeJS.ProcessEnv {
  const runtimePaths = ensureLocalRuntimePaths();
  return {
    ...process.env,
    ARTBOT_HOME: runtimePaths.homeDir,
    DATABASE_PATH: runtimePaths.dbPath,
    RUNS_ROOT: runtimePaths.runsRoot,
    PORT: resolvePortFromApiBaseUrl(apiBaseUrl),
    HOST: "127.0.0.1",
    API_BASE_URL: apiBaseUrl,
    INIT_CWD: runtimePaths.homeDir
  };
}

export function resolveWorkspaceBackendEnv(
  apiBaseUrl: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): NodeJS.ProcessEnv {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  return {
    ...baseEnv,
    DATABASE_PATH: path.join(workspaceRoot, "var", "data", "artbot.db"),
    RUNS_ROOT: path.join(workspaceRoot, "var", "runs"),
    PORT: resolvePortFromApiBaseUrl(apiBaseUrl),
    HOST: "127.0.0.1",
    API_BASE_URL: apiBaseUrl,
    INIT_CWD: workspaceRoot
  };
}

async function waitForHealthyApi(apiBaseUrl: string, timeoutMs = 30_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await checkApiHealth(apiBaseUrl, process.env.ARTBOT_API_KEY, 1_500);
    if (health.ok) {
      return true;
    }
    await wait(500);
  }

  return false;
}

function stopPid(pid: number | null): boolean {
  if (!isPidRunning(pid)) {
    return false;
  }

  try {
    process.kill(pid as number, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function resolveLocalBackendSupport(cwd = process.cwd()): {
  available: boolean;
  mode: LocalBackendMode;
  path: string | null;
} {
  if (hasLocalBackendWorkspace(cwd)) {
    return {
      available: true,
      mode: "workspace",
      path: resolveWorkspaceRoot(cwd)
    };
  }

  const apiEntry = resolveBundledRuntimeEntry("api");
  const workerEntry = resolveBundledRuntimeEntry("worker");
  if (apiEntry && workerEntry) {
    return {
      available: true,
      mode: "bundled",
      path: resolveBundledBackendRoot()
    };
  }

  return {
    available: false,
    mode: "none",
    path: null
  };
}

export function resolveBackendStartMetadata(cwd = process.cwd(), apiBaseUrl = "http://localhost:4000"): BackendStartMetadata {
  const support = resolveLocalBackendSupport(cwd);
  if (!support.available || support.mode === "none" || !support.path) {
    throw new Error("Local backend auto-start is unavailable in this environment.");
  }

  if (support.mode === "workspace") {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    return {
      mode: "workspace",
      api: {
        service: "api",
        command: `${resolvePnpmExecutable()} --filter @artbot/api start`,
        cwd: workspaceRoot,
        displayName: "ArtBot API"
      },
      worker: {
        service: "worker",
        command: `${resolvePnpmExecutable()} --filter @artbot/worker start`,
        cwd: workspaceRoot,
        displayName: "ArtBot worker"
      },
      apiHealthPath: `${apiBaseUrl.replace(/\/$/, "")}/health`,
      recommendedEntryCommand: "pnpm run start:artbot",
      runtimeRoot: workspaceRoot
    };
  }

  return {
    mode: "bundled",
    api: {
      service: "api",
      command: `${process.execPath} dist/runtime/api.js`,
      cwd: support.path,
      displayName: "Bundled ArtBot API"
    },
    worker: {
      service: "worker",
      command: `${process.execPath} dist/runtime/worker.js`,
      cwd: support.path,
      displayName: "Bundled ArtBot worker"
    },
    apiHealthPath: `${apiBaseUrl.replace(/\/$/, "")}/health`,
    recommendedEntryCommand: "artbot backend start",
    runtimeRoot: support.path
  };
}

export function formatBackendStartMetadata(metadata: BackendStartMetadata): string {
  return [
    `${metadata.api.displayName}: ${metadata.api.command}`,
    `${metadata.worker.displayName}: ${metadata.worker.command}`,
    `Health check: ${metadata.apiHealthPath}`,
    `Entry point: ${metadata.recommendedEntryCommand}`
  ].join("\n");
}

export function resolveAuthCaptureWorkspacePath(profileId: string, cwd = process.cwd()): string {
  const support = resolveLocalBackendSupport(cwd);
  const root = support.mode === "workspace" && support.path ? support.path : ensureLocalRuntimePaths().homeDir;
  return path.resolve(root, "playwright", ".auth", `${profileId}.json`);
}

export async function inspectLocalBackendStatus(
  cwd = process.cwd(),
  apiBaseUrl?: string
): Promise<LocalBackendStatus> {
  const support = resolveLocalBackendSupport(cwd);
  if (!support.available || support.mode === "none" || !support.path) {
    const resolvedApiBaseUrl = apiBaseUrl ?? process.env.API_BASE_URL?.trim() ?? "http://localhost:4000";
    return {
      mode: "none",
      available: false,
      runtimeRoot: null,
      apiBaseUrl: resolvedApiBaseUrl,
      apiHealth: await checkApiHealth(resolvedApiBaseUrl, process.env.ARTBOT_API_KEY, 1_500),
      api: { pid: null, running: false, logPath: null },
      worker: { pid: null, running: false, logPath: null },
      recommendedEntryCommand: "artbot setup"
    };
  }

  const state = readBackendState(support.mode, support.path);
  const resolvedApiBaseUrl = apiBaseUrl ?? state?.apiBaseUrl ?? process.env.API_BASE_URL?.trim() ?? "http://localhost:4000";
  return {
    mode: support.mode,
    available: true,
    runtimeRoot: support.path,
    apiBaseUrl: resolvedApiBaseUrl,
    apiHealth: await checkApiHealth(resolvedApiBaseUrl, process.env.ARTBOT_API_KEY, 1_500),
    api: {
      pid: state?.apiPid ?? null,
      running: isPidRunning(state?.apiPid),
      logPath: state?.apiLogPath ?? null
    },
    worker: {
      pid: state?.workerPid ?? null,
      running: isPidRunning(state?.workerPid),
      logPath: state?.workerLogPath ?? null
    },
    recommendedEntryCommand: support.mode === "workspace" ? "pnpm run start:artbot" : "artbot backend start"
  };
}

export async function startLocalBackendServices(
  cwd = process.cwd(),
  apiBaseUrl = process.env.API_BASE_URL?.trim() || "http://localhost:4000"
): Promise<StartedBackendServices> {
  const status = await inspectLocalBackendStatus(cwd, apiBaseUrl);
  if (!status.available || status.mode === "none" || !status.runtimeRoot) {
    throw new Error("Local backend auto-start is unavailable in this environment.");
  }

  if (status.apiHealth.ok && status.api.running && status.worker.running) {
    return {
      mode: status.mode,
      runtimeRoot: status.runtimeRoot,
      logDir:
        status.mode === "workspace" ? path.join(status.runtimeRoot, "var", "logs") : ensureLocalRuntimePaths().logDir,
      apiLogPath: status.api.logPath ?? "",
      workerLogPath: status.worker.logPath ?? "",
      apiPid: status.api.pid,
      workerPid: status.worker.pid,
      reusedExisting: true
    };
  }

  if (status.apiHealth.ok) {
    throw new Error(
      `An ArtBot API is already responding at ${apiBaseUrl}, but it is not managed by this CLI. Stop the existing service or change API_BASE_URL before starting another backend.`
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runtimeRoot = status.mode === "workspace" ? status.runtimeRoot : ensureLocalRuntimePaths().homeDir;
  const logDir = status.mode === "workspace" ? path.join(runtimeRoot, "var", "logs") : ensureLocalRuntimePaths().logDir;
  fs.mkdirSync(logDir, { recursive: true });

  const apiLogPath = path.join(logDir, `api-${stamp}.log`);
  const workerLogPath = path.join(logDir, `worker-${stamp}.log`);

  let apiPid: number | null = null;
  let workerPid: number | null = null;

  if (status.mode === "workspace") {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const workspaceEnv = resolveWorkspaceBackendEnv(apiBaseUrl, process.env, workspaceRoot);
    ensureWorkspaceRuntimeBuilt(workspaceRoot);
    apiPid = spawnDetachedProcess({
      command: resolvePnpmExecutable(),
      args: ["--filter", "@artbot/api", "start"],
      cwd: workspaceRoot,
      env: workspaceEnv,
      logPath: apiLogPath
    });
    workerPid = spawnDetachedProcess({
      command: resolvePnpmExecutable(),
      args: ["--filter", "@artbot/worker", "start"],
      cwd: workspaceRoot,
      env: workspaceEnv,
      logPath: workerLogPath
    });
  } else {
    const apiEntry = resolveBundledRuntimeEntry("api");
    const workerEntry = resolveBundledRuntimeEntry("worker");
    if (!apiEntry || !workerEntry) {
      throw new Error("Bundled backend runtime is missing from the installed artbot package.");
    }

    const bundledEnv = resolveBundledEnv(apiBaseUrl);
    apiPid = spawnDetachedProcess({
      command: process.execPath,
      args: [apiEntry],
      cwd: runtimeRoot,
      env: bundledEnv,
      logPath: apiLogPath
    });
    workerPid = spawnDetachedProcess({
      command: process.execPath,
      args: [workerEntry],
      cwd: runtimeRoot,
      env: bundledEnv,
      logPath: workerLogPath
    });
  }

  const healthy = await waitForHealthyApi(apiBaseUrl);
  if (!healthy) {
    stopPid(apiPid);
    stopPid(workerPid);
    throw new Error(`ArtBot API did not become healthy. API log: ${apiLogPath}. Worker log: ${workerLogPath}.`);
  }

  writeBackendState({
    mode: status.mode,
    runtimeRoot,
    apiPid,
    workerPid,
    apiLogPath,
    workerLogPath,
    apiBaseUrl,
    updatedAt: new Date().toISOString()
  });

  return {
    mode: status.mode,
    runtimeRoot,
    logDir,
    apiLogPath,
    workerLogPath,
    apiPid,
    workerPid,
    reusedExisting: false
  };
}

export async function stopLocalBackendServices(cwd = process.cwd()): Promise<LocalBackendStatus> {
  const status = await inspectLocalBackendStatus(cwd);
  if (!status.available || status.mode === "none" || !status.runtimeRoot) {
    return status;
  }

  stopPid(status.api.pid);
  stopPid(status.worker.pid);
  removeBackendState(status.mode, status.runtimeRoot);

  await wait(250);
  return inspectLocalBackendStatus(cwd, status.apiBaseUrl);
}
