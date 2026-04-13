import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ResearchOrchestrator } from "@artbot/orchestrator";
import { ArtbotStorage } from "@artbot/storage";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveWorkspaceRoot(): string {
  const candidates = [
    process.env.INIT_CWD,
    process.cwd(),
    path.resolve(moduleDir, "../../..")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const root = findWorkspaceRoot(candidate);
    if (root) {
      return root;
    }
  }

  return path.resolve(moduleDir, "../../..");
}

function resolveWorkspaceDefault(relativePath: string): string {
  return path.resolve(resolveWorkspaceRoot(), relativePath);
}

dotenv.config({ path: resolveWorkspaceDefault(".env"), override: false });

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3_000);
const leaseMs = Number(process.env.WORKER_LEASE_MS ?? 120_000);
const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 5_000);
const staleRecoveryMs = Number(process.env.WORKER_STALE_RECOVERY_MS ?? Math.max(leaseMs * 2, 180_000));
const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const dbPath = process.env.DATABASE_PATH ?? resolveWorkspaceDefault("var/data/artbot.db");
const runsRoot = process.env.RUNS_ROOT ?? resolveWorkspaceDefault("var/runs");

const storage = new ArtbotStorage(dbPath, runsRoot);
const orchestrator = new ResearchOrchestrator(storage);

let isShuttingDown = false;
let loopRunning = false;

async function tick(): Promise<void> {
  if (loopRunning || isShuttingDown) {
    return;
  }

  loopRunning = true;
  try {
    const recovered = storage.recoverStaleRunningRuns(staleRecoveryMs, `Recovered stale run by worker ${workerId}.`);
    if (recovered.length > 0) {
      console.warn(`[worker] recovered stale runs: ${recovered.join(", ")}`);
    }
    const pending = storage.getRunnableRuns(2);

    for (const run of pending) {
      const reserved = storage.reserveRun(run.id, workerId, leaseMs);
      if (!reserved) {
        continue;
      }

      const heartbeat = setInterval(() => {
        try {
          const renewed = storage.heartbeatRun(run.id, workerId, leaseMs);
          if (!renewed) {
            console.warn(`[worker] failed to renew lease for run ${run.id}`);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[worker] heartbeat error for run ${run.id}: ${reason}`);
        }
      }, Math.max(1_000, heartbeatMs));

      try {
        try {
          storage.heartbeatRun(run.id, workerId, leaseMs);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[worker] initial heartbeat error for run ${run.id}: ${reason}`);
        }
        await orchestrator.processRun({ ...run, status: "running" });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        storage.failRun(run.id, reason);
      } finally {
        clearInterval(heartbeat);
      }
    }
  } finally {
    loopRunning = false;
  }
}

const interval = setInterval(() => {
  void tick();
}, pollMs);

void tick();

function shutdown(): void {
  isShuttingDown = true;
  clearInterval(interval);
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
