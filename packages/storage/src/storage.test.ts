import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { researchQuerySchema } from "@artbot/shared-types";
import { ArtbotStorage } from "./storage.js";

const cleanupPaths: string[] = [];

function mkTempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-storage-test-"));
  cleanupPaths.push(root);
  return {
    dbPath: path.join(root, "artbot.db"),
    runsRoot: path.join(root, "runs")
  };
}

function query(artist: string) {
  return researchQuerySchema.parse({
    artist,
    scope: "turkey_plus_international" as const,
    turkeyFirst: true,
    analysisMode: "balanced" as const,
    priceNormalization: "usd_dual" as const,
    manualLoginCheckpoint: false,
    allowLicensed: false,
    licensedIntegrations: [],
    crawlMode: "backfill" as const,
    sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database"]
  });
}

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("ArtbotStorage listRuns", () => {
  it("lists runs in reverse-chronological order with optional status filter", async () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const first = storage.createRun("artist", query("Artist One"));
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = storage.createRun("work", query("Artist Two"));
    storage.failRun(first.id, "failure");

    const all = storage.listRuns(10);
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);

    const failedOnly = storage.listRuns(10, "failed");
    expect(failedOnly.length).toBe(1);
    expect(failedOnly[0].id).toBe(first.id);
    expect(failedOnly[0].status).toBe("failed");
  });
});

describe("ArtbotStorage lease lifecycle", () => {
  it("supports reserve, heartbeat and stale recovery", async () => {
    const { dbPath, runsRoot } = mkTempPaths();
    const storage = new ArtbotStorage(dbPath, runsRoot);

    const run = storage.createRun("artist", query("Lease Artist"));
    const reserved = storage.reserveRun(run.id, "worker-a", 1);
    expect(reserved).toBe(true);

    const heartbeat = storage.heartbeatRun(run.id, "worker-a", 1);
    expect(heartbeat).toBe(true);

    const wrongWorkerHeartbeat = storage.heartbeatRun(run.id, "worker-b", 1);
    expect(wrongWorkerHeartbeat).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const recovered = storage.recoverStaleRunningRuns(0, "forced stale recovery");
    expect(recovered).toContain(run.id);

    const updated = storage.getRun(run.id);
    expect(updated?.status).toBe("failed");
  });
});
