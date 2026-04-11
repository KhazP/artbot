import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAuthProfilesJson, resolveStorageStatePath } from "./auth.js";

const artbotHomeSnapshot = process.env.ARTBOT_HOME;

afterEach(() => {
  process.env.ARTBOT_HOME = artbotHomeSnapshot;
});

describe("auth profile parsing", () => {
  it("parses canonical auth profile JSON", () => {
    const result = parseAuthProfilesJson(
      '[{"id":"artsy-auth","mode":"authorized","sourcePatterns":["artsy"],"storageStatePath":"/tmp/artsy-auth.json"}]'
    );

    expect(result.error).toBeNull();
    expect(result.profiles).toEqual([
      {
        id: "artsy-auth",
        mode: "authorized",
        sourcePatterns: ["artsy"],
        storageStatePath: "/tmp/artsy-auth.json"
      }
    ]);
  });

  it("recovers from older dotenv-escaped auth profile values", () => {
    const result = parseAuthProfilesJson(
      '[{\\"id\\":\\"artsy-auth\\",\\"mode\\":\\"authorized\\",\\"sourcePatterns\\":[\\"artsy\\"],\\"storageStatePath\\":\\"/tmp/artsy-auth.json\\"}]'
    );

    expect(result.error).toBeNull();
    expect(result.profiles.map((profile) => profile.id)).toEqual(["artsy-auth"]);
  });

  it("defaults external auth state paths to ARTBOT_HOME", () => {
    const artbotHome = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-auth-home-"));
    process.env.ARTBOT_HOME = artbotHome;

    const storagePath = resolveStorageStatePath(
      {
        id: "artsy-auth",
        mode: "authorized",
        sourcePatterns: ["artsy"]
      },
      path.join(os.tmpdir(), "outside-workspace")
    );

    expect(storagePath).toBe(path.join(artbotHome, "playwright", ".auth", "artsy-auth.json"));
  });
});
