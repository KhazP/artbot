import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { normalizeLlmBaseUrl } from "./health.js";
import type { AuthProfile, LocalRuntimePaths, SetupWizardValues } from "./types.js";

interface SetupProfileBlueprint {
  id: string;
  mode: AuthProfile["mode"];
  sourceName: string;
  sourcePatterns: string[];
}

const SETUP_PROFILE_BLUEPRINTS: SetupProfileBlueprint[] = [
  {
    id: "artsy-auth",
    mode: "authorized",
    sourceName: "Artsy",
    sourcePatterns: ["artsy"]
  },
  {
    id: "mutualart-auth",
    mode: "authorized",
    sourceName: "MutualArt",
    sourcePatterns: ["mutualart"]
  },
  {
    id: "sanatfiyat-license",
    mode: "licensed",
    sourceName: "Sanatfiyat",
    sourcePatterns: ["sanatfiyat"]
  },
  {
    id: "askart-license",
    mode: "licensed",
    sourceName: "askART",
    sourcePatterns: ["askart"]
  }
];

const CLI_MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
let loadedEnvPath: string | null = null;

interface LoadEnvOptions {
  force?: boolean;
  override?: boolean;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./,:-]+$/.test(value)) {
    return value;
  }

  if (!value.includes("'") && !value.includes("\n") && !value.includes("\r")) {
    return `'${value}'`;
  }

  return JSON.stringify(value);
}

function isWorkspaceRoot(directory: string): boolean {
  return fs.existsSync(path.join(directory, "pnpm-workspace.yaml")) || fs.existsSync(path.join(directory, "turbo.json"));
}

function coerceSearchDirectory(candidate: string): string {
  const resolved = path.resolve(candidate);

  try {
    return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return path.extname(resolved) ? path.dirname(resolved) : resolved;
  }
}

function findWorkspaceRoot(candidate: string): string | null {
  let current = coerceSearchDirectory(candidate);

  while (true) {
    if (isWorkspaceRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function detectWorkspaceRoot(cwd = process.cwd()): string | null {
  const candidates = [
    process.env.INIT_CWD,
    cwd,
    process.env.ARTBOT_ROOT,
    process.env.RUNS_ROOT,
    process.env.DATABASE_PATH,
    CLI_MODULE_DIR
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim().length > 0));

  for (const candidate of candidates) {
    const workspaceRoot = findWorkspaceRoot(candidate);
    if (workspaceRoot) {
      return workspaceRoot;
    }
  }

  return null;
}

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  return detectWorkspaceRoot(cwd) ?? path.resolve(cwd);
}

export function resolveArtbotHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ARTBOT_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(os.homedir(), ".artbot");
}

export function resolveEnvRoot(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARTBOT_HOME?.trim()) {
    return resolveArtbotHome(env);
  }

  return detectWorkspaceRoot(cwd) ?? resolveArtbotHome(env);
}

export function resolveLocalRuntimePaths(env: NodeJS.ProcessEnv = process.env): LocalRuntimePaths {
  const homeDir = resolveArtbotHome(env);
  return {
    homeDir,
    envPath: path.join(homeDir, ".env"),
    dataDir: path.join(homeDir, "data"),
    dbPath: path.join(homeDir, "data", "artbot.db"),
    runsRoot: path.join(homeDir, "runs"),
    logDir: path.join(homeDir, "logs"),
    authDir: path.join(homeDir, "playwright", ".auth"),
    stateDir: path.join(homeDir, "state"),
    backendStatePath: path.join(homeDir, "state", "backend.json")
  };
}

export function ensureLocalRuntimePaths(env: NodeJS.ProcessEnv = process.env): LocalRuntimePaths {
  const runtimePaths = resolveLocalRuntimePaths(env);
  for (const target of [
    runtimePaths.homeDir,
    runtimePaths.dataDir,
    runtimePaths.runsRoot,
    runtimePaths.logDir,
    runtimePaths.authDir,
    runtimePaths.stateDir
  ]) {
    fs.mkdirSync(target, { recursive: true });
  }

  return runtimePaths;
}

export function resolveAuthStorageDir(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARTBOT_HOME?.trim()) {
    return ensureLocalRuntimePaths(env).authDir;
  }

  const workspaceRoot = detectWorkspaceRoot(cwd);
  if (workspaceRoot) {
    return path.resolve(workspaceRoot, "playwright", ".auth");
  }

  return ensureLocalRuntimePaths(env).authDir;
}

export function hasLocalBackendWorkspace(cwd = process.cwd()): boolean {
  if (process.env.ARTBOT_HOME?.trim()) {
    return false;
  }

  const workspaceRoot = detectWorkspaceRoot(cwd);
  if (!workspaceRoot) {
    return false;
  }

  return (
    fs.existsSync(path.join(workspaceRoot, "apps", "api", "package.json")) &&
    fs.existsSync(path.join(workspaceRoot, "apps", "worker", "package.json"))
  );
}

export function resolveEnvFilePath(cwd = process.cwd()): string {
  return path.resolve(resolveEnvRoot(cwd), ".env");
}

export function loadWorkspaceEnv(cwd = process.cwd(), options: LoadEnvOptions = {}): string {
  const envPath = resolveEnvFilePath(cwd);
  if (!options.force && loadedEnvPath === envPath) {
    return envPath;
  }

  loadDotenv({ path: envPath, override: options.override ?? false });
  loadedEnvPath = envPath;
  return envPath;
}

export function applyEnvUpdates(env: NodeJS.ProcessEnv, updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    env[key] = value;
  }
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parseCommaSeparatedEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readEnvFile(envPath: string): string {
  try {
    return fs.readFileSync(envPath, "utf-8");
  } catch {
    return "";
  }
}

export function upsertEnvFile(envPath: string, updates: Record<string, string>): void {
  const existing = readEnvFile(envPath);
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const consumed = new Set<string>();

  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      return line;
    }

    const key = match[1];
    if (!(key in updates)) {
      return line;
    }

    consumed.add(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (consumed.has(key)) continue;
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  fs.writeFileSync(envPath, `${nextLines.filter(Boolean).join("\n")}\n`, "utf-8");
}

export function buildDefaultAuthProfiles(options: {
  cwd?: string;
  enableOptionalProbes?: boolean;
  enableLicensedIntegrations?: boolean;
} = {}): AuthProfile[] {
  const authDir = resolveAuthStorageDir(options.cwd ?? process.cwd());
  const enableOptionalProbes = options.enableOptionalProbes ?? false;
  const enableLicensedIntegrations = options.enableLicensedIntegrations ?? false;

  return SETUP_PROFILE_BLUEPRINTS.filter((profile) => {
    if (profile.id === "artsy-auth" || profile.id === "mutualart-auth") {
      return enableOptionalProbes;
    }
    return enableLicensedIntegrations;
  }).map((profile) => ({
    id: profile.id,
    mode: profile.mode,
    sourcePatterns: profile.sourcePatterns,
    storageStatePath: path.resolve(authDir, `${profile.id}.json`)
  }));
}

export function buildSetupEnvUpdates(values: SetupWizardValues): Record<string, string> {
  return {
    LLM_BASE_URL: normalizeLlmBaseUrl(values.llmBaseUrl),
    LLM_API_KEY: "lm-studio",
    STRUCTURED_LLM_PROVIDER: "openai_compatible",
    API_BASE_URL: values.apiBaseUrl,
    ENABLE_OPTIONAL_PROBE_ADAPTERS: String(values.enableOptionalProbes),
    ENABLE_LICENSED_INTEGRATIONS: String(values.enableLicensedIntegrations),
    DEFAULT_LICENSED_INTEGRATIONS: values.defaultLicensedIntegrations.join(","),
    DEFAULT_AUTH_PROFILE: "",
    AUTH_PROFILES_JSON: JSON.stringify(values.authProfiles)
  };
}

export function defaultSourceUrlForProfile(profileId: string): string {
  switch (profileId) {
    case "artsy-auth":
      return "https://www.artsy.net";
    case "mutualart-auth":
      return "https://www.mutualart.com";
    case "sanatfiyat-license":
      return "https://www.sanatfiyat.com";
    case "askart-license":
      return "https://www.askart.com";
    default:
      return "https://example.com";
  }
}
