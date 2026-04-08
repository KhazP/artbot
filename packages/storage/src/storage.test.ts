import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  return {
    artist,
    scope: "turkey_plus_international" as const,
    turkeyFirst: true,
    manualLoginCheckpoint: false,
    allowLicensed: false,
    licensedIntegrations: []
  };
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

