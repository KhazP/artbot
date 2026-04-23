import fs from "node:fs";
import path from "node:path";

const RUNTIME_STORAGE_MANIFEST_VERSION = 1;

interface RuntimeStorageManifest {
  version: number;
  workspace_root: string;
  db_path: string;
  runs_root: string;
  updated_at: string;
  writer_role: string;
  writer_pid: number;
}

export interface RuntimeStoragePathGuardResult {
  enabled: boolean;
  manifestPath: string | null;
  created: boolean;
}

export function resolveWorkspaceRelativePath(
  configuredValue: string | undefined,
  workspaceRoot: string,
  fallbackRelativePath: string
): string {
  const trimmed = configuredValue?.trim();
  if (!trimmed) {
    return path.resolve(workspaceRoot, fallbackRelativePath);
  }

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }

  return path.resolve(workspaceRoot, trimmed);
}

function readManifest(manifestPath: string): RuntimeStorageManifest | null {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Runtime storage guard manifest is unreadable at ${manifestPath}. Reason: ${reason}. ` +
      "Delete the manifest file and restart API/worker/CLI.",
      {
        cause: error
      }
    );
  }

  if (
    typeof parsed !== "object"
    || parsed == null
    || typeof (parsed as { db_path?: unknown }).db_path !== "string"
    || typeof (parsed as { runs_root?: unknown }).runs_root !== "string"
    || typeof (parsed as { workspace_root?: unknown }).workspace_root !== "string"
  ) {
    throw new Error(
      `Runtime storage guard manifest at ${manifestPath} has an invalid shape. ` +
      "Delete the manifest file and restart API/worker/CLI."
    );
  }

  return parsed as RuntimeStorageManifest;
}

function writeManifest(manifestPath: string, role: string, workspaceRoot: string, dbPath: string, runsRoot: string): void {
  const payload: RuntimeStorageManifest = {
    version: RUNTIME_STORAGE_MANIFEST_VERSION,
    workspace_root: workspaceRoot,
    db_path: dbPath,
    runs_root: runsRoot,
    updated_at: new Date().toISOString(),
    writer_role: role,
    writer_pid: process.pid
  };

  const manifestDir = path.dirname(manifestPath);
  const tmpPath = path.join(
    manifestDir,
    `runtime-storage-paths.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tmpPath, manifestPath);
}

export function ensureWorkspaceRuntimeStoragePaths(
  role: "api" | "worker" | "cli",
  workspaceRoot: string,
  dbPath: string,
  runsRoot: string
): RuntimeStoragePathGuardResult {
  if (process.env.NODE_ENV === "test") {
    return {
      enabled: false,
      manifestPath: null,
      created: false
    };
  }

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedRunsRoot = path.resolve(runsRoot);
  const manifestPath = path.resolve(resolvedWorkspaceRoot, "var/state/runtime-storage-paths.json");

  const manifest = readManifest(manifestPath);
  if (manifest) {
    const manifestDbPath = path.resolve(manifest.db_path);
    const manifestRunsRoot = path.resolve(manifest.runs_root);
    if (manifestDbPath !== resolvedDbPath || manifestRunsRoot !== resolvedRunsRoot) {
      throw new Error(
        [
          "Runtime storage path mismatch detected across processes.",
          `Role: ${role}`,
          `Workspace: ${resolvedWorkspaceRoot}`,
          `Current DATABASE_PATH: ${resolvedDbPath}`,
          `Current RUNS_ROOT: ${resolvedRunsRoot}`,
          `Manifest DATABASE_PATH: ${manifestDbPath}`,
          `Manifest RUNS_ROOT: ${manifestRunsRoot}`,
          `Manifest writer: ${manifest.writer_role} (${manifest.updated_at})`,
          "Fix .env or process env so API, worker, and CLI use the same runtime paths."
        ].join("\n")
      );
    }
  }

  writeManifest(manifestPath, role, resolvedWorkspaceRoot, resolvedDbPath, resolvedRunsRoot);

  return {
    enabled: true,
    manifestPath,
    created: manifest == null
  };
}
