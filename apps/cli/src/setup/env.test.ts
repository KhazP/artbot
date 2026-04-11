import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { parseAuthProfilesJson } from "./auth.js";
import { buildSetupEnvUpdates, hasLocalBackendWorkspace, resolveEnvFilePath, resolveWorkspaceRoot, upsertEnvFile } from "./env.js";

const envSnapshot = {
  INIT_CWD: process.env.INIT_CWD,
  ARTBOT_ROOT: process.env.ARTBOT_ROOT,
  ARTBOT_HOME: process.env.ARTBOT_HOME,
  RUNS_ROOT: process.env.RUNS_ROOT,
  DATABASE_PATH: process.env.DATABASE_PATH
};

afterEach(() => {
  process.env.INIT_CWD = envSnapshot.INIT_CWD;
  process.env.ARTBOT_ROOT = envSnapshot.ARTBOT_ROOT;
  process.env.ARTBOT_HOME = envSnapshot.ARTBOT_HOME;
  process.env.RUNS_ROOT = envSnapshot.RUNS_ROOT;
  process.env.DATABASE_PATH = envSnapshot.DATABASE_PATH;
});

describe("setup env persistence", () => {
  it("writes auth profiles in a dotenv-safe format", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-env-test-"));
    const envPath = path.join(tempDir, ".env");

    upsertEnvFile(
      envPath,
      buildSetupEnvUpdates({
        llmBaseUrl: "http://127.0.0.1:1234/v1",
        apiBaseUrl: "http://localhost:4000",
        enableOptionalProbes: true,
        enableLicensedIntegrations: true,
        defaultLicensedIntegrations: ["Sanatfiyat"],
        authProfiles: [
          {
            id: "artsy-auth",
            mode: "authorized",
            sourcePatterns: ["artsy"],
            storageStatePath: "/tmp/artsy-auth.json"
          },
          {
            id: "sanatfiyat-license",
            mode: "licensed",
            sourcePatterns: ["sanatfiyat"],
            storageStatePath: "/tmp/sanatfiyat-license.json"
          }
        ]
      })
    );

    const written = fs.readFileSync(envPath, "utf-8");
    const parsedEnv = parseDotenv(written);
    const parsedProfiles = parseAuthProfilesJson(parsedEnv.AUTH_PROFILES_JSON);

    expect(written).toContain("AUTH_PROFILES_JSON='[");
    expect(parsedEnv.LLM_BASE_URL).toBe("http://127.0.0.1:1234/v1");
    expect(parsedEnv.LLM_API_KEY).toBe("lm-studio");
    expect(parsedProfiles.error).toBeNull();
    expect(parsedProfiles.profiles.map((profile) => profile.id)).toEqual(["artsy-auth", "sanatfiyat-license"]);
  });

  it("falls back to ARTBOT_ROOT when cwd is outside the workspace", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-root-test-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-outside-test-"));

    fs.writeFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n', "utf-8");
    delete process.env.INIT_CWD;
    process.env.ARTBOT_ROOT = workspaceRoot;
    delete process.env.RUNS_ROOT;
    delete process.env.DATABASE_PATH;

    expect(resolveWorkspaceRoot(outsideDir)).toBe(workspaceRoot);
  });

  it("stores external-user config under ARTBOT_HOME when no workspace is present", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-outside-home-test-"));
    const artbotHome = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-home-test-"));

    delete process.env.INIT_CWD;
    delete process.env.ARTBOT_ROOT;
    process.env.ARTBOT_HOME = artbotHome;

    expect(resolveEnvFilePath(outsideDir)).toBe(path.join(artbotHome, ".env"));
  });

  it("disables workspace backend detection when ARTBOT_HOME is explicitly set", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-home-override-root-"));
    fs.mkdirSync(path.join(workspaceRoot, "apps", "api"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "apps", "worker"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n', "utf-8");
    fs.writeFileSync(path.join(workspaceRoot, "apps", "api", "package.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(workspaceRoot, "apps", "worker", "package.json"), "{}", "utf-8");

    process.env.ARTBOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-home-override-"));

    expect(hasLocalBackendWorkspace(workspaceRoot)).toBe(false);
  });
});
