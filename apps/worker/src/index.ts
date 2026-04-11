import "dotenv/config";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchOrchestrator } from "@artbot/orchestrator";
import { ArtbotStorage } from "@artbot/storage";

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3_000);
const leaseMs = Number(process.env.WORKER_LEASE_MS ?? 120_000);
const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 5_000);
const staleRecoveryMs = Number(process.env.WORKER_STALE_RECOVERY_MS ?? Math.max(leaseMs * 2, 180_000));
const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveWorkspaceDefault(relativePath: string): string {
  const workspaceRoot = process.env.INIT_CWD ?? path.resolve(moduleDir, "../../..");
  return path.resolve(workspaceRoot, relativePath);
}

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
        const renewed = storage.heartbeatRun(run.id, workerId, leaseMs);
        if (!renewed) {
          console.warn(`[worker] failed to renew lease for run ${run.id}`);
        }
      }, Math.max(1_000, heartbeatMs));

      try {
        storage.heartbeatRun(run.id, workerId, leaseMs);
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
