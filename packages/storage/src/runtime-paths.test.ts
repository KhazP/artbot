import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureWorkspaceRuntimeStoragePaths, resolveWorkspaceRelativePath } from "./runtime-paths.js";

const cleanupPaths: string[] = [];
const nodeEnvSnapshot = process.env.NODE_ENV;

function mkTempWorkspace(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-runtime-paths-test-"));
  cleanupPaths.push(workspaceRoot);
  return workspaceRoot;
}

afterEach(() => {
  process.env.NODE_ENV = nodeEnvSnapshot;
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("runtime storage paths", () => {
  it("resolves relative env values from workspace root", () => {
    const workspaceRoot = "/tmp/artbot-workspace";
    const dbPath = resolveWorkspaceRelativePath("./data/artbot.db", workspaceRoot, "var/data/artbot.db");
    const runsRoot = resolveWorkspaceRelativePath("runs", workspaceRoot, "var/runs");

    expect(dbPath).toBe(path.resolve(workspaceRoot, "./data/artbot.db"));
    expect(runsRoot).toBe(path.resolve(workspaceRoot, "runs"));
  });

  it("falls back to workspace defaults when env values are missing", () => {
    const workspaceRoot = "/tmp/artbot-workspace";
    const dbPath = resolveWorkspaceRelativePath(undefined, workspaceRoot, "var/data/artbot.db");
    const runsRoot = resolveWorkspaceRelativePath(undefined, workspaceRoot, "var/runs");

    expect(dbPath).toBe(path.resolve(workspaceRoot, "var/data/artbot.db"));
    expect(runsRoot).toBe(path.resolve(workspaceRoot, "var/runs"));
  });

  it("creates and reuses the guard manifest when paths match", () => {
    process.env.NODE_ENV = "development";
    const workspaceRoot = mkTempWorkspace();
    const dbPath = path.join(workspaceRoot, "var", "data", "artbot.db");
    const runsRoot = path.join(workspaceRoot, "var", "runs");

    const first = ensureWorkspaceRuntimeStoragePaths("api", workspaceRoot, dbPath, runsRoot);
    expect(first.enabled).toBe(true);
    expect(first.created).toBe(true);
    expect(first.manifestPath).toBe(path.join(workspaceRoot, "var", "state", "runtime-storage-paths.json"));
    expect(fs.existsSync(first.manifestPath!)).toBe(true);

    const second = ensureWorkspaceRuntimeStoragePaths("worker", workspaceRoot, dbPath, runsRoot);
    expect(second.enabled).toBe(true);
    expect(second.created).toBe(false);
    expect(second.manifestPath).toBe(first.manifestPath);
  });

  it("throws when a later process resolves a different db or runs path", () => {
    process.env.NODE_ENV = "development";
    const workspaceRoot = mkTempWorkspace();
    const dbPath = path.join(workspaceRoot, "var", "data", "artbot.db");
    const runsRoot = path.join(workspaceRoot, "var", "runs");
    ensureWorkspaceRuntimeStoragePaths("api", workspaceRoot, dbPath, runsRoot);

    expect(() =>
      ensureWorkspaceRuntimeStoragePaths("cli", workspaceRoot, path.join(workspaceRoot, "apps", "cli", "data", "artbot.db"), runsRoot)
    ).toThrow(/Runtime storage path mismatch detected/);
  });
});
