import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { detectWorkspaceRoot, resolveArtbotHome } from "./setup/env.js";
import type { FocusTarget, SidePane } from "./tui/state.js";

export type CliSessionKind = "tui" | "runs-watch";

export interface TuiSessionSnapshot {
  sidePane: SidePane;
  focusTarget: FocusTarget;
  history: string[];
  lastRunId?: string;
  reportSurfaceIndex: number;
}

export interface RunsWatchSessionSnapshot {
  runId: string;
  intervalSeconds: number;
}

export interface CliSessionRecord {
  id: string;
  kind: CliSessionKind;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  tui?: TuiSessionSnapshot;
  runsWatch?: RunsWatchSessionSnapshot;
}

const tuiSessionSchema = z.object({
  sidePane: z.enum(["none", "setup", "auth", "run-details", "normalization", "sources", "review", "fx", "errors"]),
  focusTarget: z.enum(["composer", "main", "side", "overlay"]),
  history: z.array(z.string()),
  lastRunId: z.string().optional(),
  reportSurfaceIndex: z.number().int().nonnegative()
});

const runsWatchSessionSchema = z.object({
  runId: z.string().min(1),
  intervalSeconds: z.number().int().positive()
});

const sessionStoreSchema = z.object({
  version: z.literal(1),
  sessions: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["tui", "runs-watch"]),
      workspacePath: z.string().min(1),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
      summary: z.string().min(1),
      tui: tuiSessionSchema.optional(),
      runsWatch: runsWatchSessionSchema.optional()
    })
  )
});

type SessionStore = z.infer<typeof sessionStoreSchema>;

function resolveSessionStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveArtbotHome(env), "state", "cli-sessions.json");
}

function resolveWorkspacePath(cwd = process.cwd()): string {
  return path.resolve(detectWorkspaceRoot(cwd) ?? cwd);
}

function loadSessionStore(env: NodeJS.ProcessEnv = process.env): SessionStore {
  const storePath = resolveSessionStorePath(env);
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    return sessionStoreSchema.parse(JSON.parse(raw));
  } catch {
    return {
      version: 1,
      sessions: []
    };
  }
}

function saveSessionStore(store: SessionStore, env: NodeJS.ProcessEnv = process.env): string {
  const storePath = resolveSessionStorePath(env);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  return storePath;
}

function sortSessions(sessions: CliSessionRecord[]): CliSessionRecord[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function upsertSession(
  nextRecord: CliSessionRecord,
  env: NodeJS.ProcessEnv = process.env
): { record: CliSessionRecord; storePath: string } {
  const store = loadSessionStore(env);
  const nextSessions = store.sessions.filter((entry) => entry.id !== nextRecord.id);
  nextSessions.push(nextRecord);
  const storePath = saveSessionStore(
    {
      version: 1,
      sessions: sortSessions(nextSessions).slice(0, 100)
    },
    env
  );
  return {
    record: nextRecord,
    storePath
  };
}

export function listCliSessions(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): { sessions: CliSessionRecord[]; storePath: string } {
  const workspacePath = resolveWorkspacePath(cwd);
  const store = loadSessionStore(env);
  return {
    sessions: sortSessions(
      store.sessions
        .filter((entry) => entry.workspacePath === workspacePath)
        .map((entry) => ({ ...entry }))
    ),
    storePath: resolveSessionStorePath(env)
  };
}

export function getCliSession(
  sessionId: string | undefined,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): { session: CliSessionRecord | null; storePath: string } {
  const { sessions, storePath } = listCliSessions(cwd, env);
  if (!sessionId) {
    return {
      session: sessions[0] ?? null,
      storePath
    };
  }
  return {
    session: sessions.find((entry) => entry.id === sessionId) ?? null,
    storePath
  };
}

export function saveTuiSession(
  input: {
    sessionId?: string;
    snapshot: TuiSessionSnapshot;
    summary: string;
  },
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): { record: CliSessionRecord; storePath: string } {
  const now = new Date().toISOString();
  const workspacePath = resolveWorkspacePath(cwd);
  const existing = input.sessionId ? getCliSession(input.sessionId, cwd, env).session : null;
  return upsertSession(
    {
      id: existing?.id ?? input.sessionId ?? randomUUID(),
      kind: "tui",
      workspacePath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      summary: input.summary,
      tui: input.snapshot
    },
    env
  );
}

export function saveRunsWatchSession(
  input: {
    sessionId?: string;
    snapshot: RunsWatchSessionSnapshot;
    summary: string;
  },
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): { record: CliSessionRecord; storePath: string } {
  const now = new Date().toISOString();
  const workspacePath = resolveWorkspacePath(cwd);
  const existing = input.sessionId ? getCliSession(input.sessionId, cwd, env).session : null;
  return upsertSession(
    {
      id: existing?.id ?? input.sessionId ?? randomUUID(),
      kind: "runs-watch",
      workspacePath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      summary: input.summary,
      runsWatch: input.snapshot
    },
    env
  );
}

export function pruneCliSessions(
  keep: number,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): { removed: CliSessionRecord[]; kept: CliSessionRecord[]; storePath: string } {
  const workspacePath = resolveWorkspacePath(cwd);
  const store = loadSessionStore(env);
  const currentWorkspace = sortSessions(store.sessions.filter((entry) => entry.workspacePath === workspacePath));
  const kept = currentWorkspace.slice(0, keep);
  const removed = currentWorkspace.slice(keep);
  const keepIds = new Set(kept.map((entry) => entry.id));
  const nextStore = {
    version: 1 as const,
    sessions: store.sessions.filter((entry) => entry.workspacePath !== workspacePath || keepIds.has(entry.id))
  };
  const storePath = saveSessionStore(nextStore, env);
  return {
    removed,
    kept,
    storePath
  };
}
