import "dotenv/config";
import { ResearchOrchestrator } from "@artbot/orchestrator";
import { ArtbotStorage } from "@artbot/storage";

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3_000);
const dbPath = process.env.DATABASE_PATH ?? "./data/artbot.db";
const runsRoot = process.env.RUNS_ROOT ?? "./runs";

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
    const pending = storage.getPendingRuns(2);

    for (const run of pending) {
      const reserved = storage.reserveRun(run.id);
      if (!reserved) {
        continue;
      }

      try {
        await orchestrator.processRun({ ...run, status: "running" });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        storage.failRun(run.id, reason);
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
