import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { detectWorkspaceRoot, resolveArtbotHome } from "./setup/env.js";

export type TrustStatus = "trusted" | "denied" | "unknown";

export interface WorkspaceTrustRecord {
  workspacePath: string;
  status: Exclude<TrustStatus, "unknown">;
  updatedAt: string;
}

export interface WorkspaceTrustSnapshot {
  workspacePath: string;
  workspaceRoot: string | null;
  status: TrustStatus;
  updatedAt: string | null;
  storePath: string;
}

const trustStoreSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(
    z.object({
      workspacePath: z.string().min(1),
      status: z.enum(["trusted", "denied"]),
      updatedAt: z.string().min(1)
    })
  )
});

type TrustStore = z.infer<typeof trustStoreSchema>;

function resolveTrustStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveArtbotHome(env), "state", "trust.json");
}

function normalizeWorkspacePath(cwd = process.cwd()): { workspacePath: string; workspaceRoot: string | null } {
  const workspaceRoot = detectWorkspaceRoot(cwd);
  return {
    workspacePath: path.resolve(workspaceRoot ?? cwd),
    workspaceRoot
  };
}

function loadTrustStore(env: NodeJS.ProcessEnv = process.env): TrustStore {
  const storePath = resolveTrustStorePath(env);
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    return trustStoreSchema.parse(JSON.parse(raw));
  } catch {
    return {
      version: 1,
      workspaces: []
    };
  }
}

function saveTrustStore(store: TrustStore, env: NodeJS.ProcessEnv = process.env): string {
  const storePath = resolveTrustStorePath(env);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  return storePath;
}

export function inspectWorkspaceTrust(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): WorkspaceTrustSnapshot {
  const store = loadTrustStore(env);
  const { workspacePath, workspaceRoot } = normalizeWorkspacePath(cwd);
  const record = store.workspaces.find((entry) => entry.workspacePath === workspacePath);
  return {
    workspacePath,
    workspaceRoot,
    status: record?.status ?? "unknown",
    updatedAt: record?.updatedAt ?? null,
    storePath: resolveTrustStorePath(env)
  };
}

export function setWorkspaceTrust(
  status: Exclude<TrustStatus, "unknown">,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): WorkspaceTrustSnapshot {
  const store = loadTrustStore(env);
  const { workspacePath, workspaceRoot } = normalizeWorkspacePath(cwd);
  const updatedAt = new Date().toISOString();
  const nextRecords = store.workspaces.filter((entry) => entry.workspacePath !== workspacePath);
  nextRecords.push({
    workspacePath,
    status,
    updatedAt
  });
  saveTrustStore(
    {
      version: 1,
      workspaces: nextRecords.sort((left, right) => left.workspacePath.localeCompare(right.workspacePath))
    },
    env
  );
  return {
    workspacePath,
    workspaceRoot,
    status,
    updatedAt,
    storePath: resolveTrustStorePath(env)
  };
}

export function assertTrustedWorkspace(action: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  const snapshot = inspectWorkspaceTrust(cwd, env);
  if (snapshot.status === "trusted") {
    return;
  }

  const hint = `Run "artbot trust allow" to trust ${snapshot.workspacePath} before ${action}.`;
  if (snapshot.status === "denied") {
    throw new Error(`Workspace trust denied for ${snapshot.workspacePath}. ${hint}`);
  }
  throw new Error(`Workspace trust required for ${snapshot.workspacePath}. ${hint}`);
}
