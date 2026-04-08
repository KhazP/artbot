import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuthManager } from "./auth-manager.js";
import type { AuthProfile } from "./types.js";

const profiles: AuthProfile[] = [
  {
    id: "artsy-auth",
    mode: "authorized",
    sourcePatterns: ["artsy"],
    cookieFile: "/tmp/artsy-cookies.json"
  },
  {
    id: "askart-license",
    mode: "licensed",
    sourcePatterns: ["askart"],
    storageStatePath: "/tmp/askart-state.json"
  }
];

describe("AuthManager", () => {
  it("returns public access for anonymous public source", () => {
    const manager = new AuthManager(profiles);

    const resolved = manager.resolveAccess({
      sourceName: "Artam",
      sourceUrl: "https://artam.com",
      sourceRequiresAuth: false,
      sourceRequiresLicense: false
    });

    expect(resolved.mode).toBe("anonymous");
    expect(resolved.sourceAccessStatus).toBe("public_access");
  });

  it("returns auth_required when auth source has no profile", () => {
    const manager = new AuthManager([]);

    const resolved = manager.resolveAccess({
      sourceName: "Artsy",
      sourceUrl: "https://artsy.net",
      sourceRequiresAuth: true,
      sourceRequiresLicense: false
    });

    expect(resolved.sourceAccessStatus).toBe("auth_required");
    expect(resolved.mode).toBe("anonymous");
  });

  it("resolves licensed access when integration is provided", () => {
    const manager = new AuthManager(profiles);

    const resolved = manager.resolveAccess({
      sourceName: "askART",
      sourceUrl: "https://askart.com",
      sourceRequiresAuth: true,
      sourceRequiresLicense: true,
      allowLicensed: true,
      licensedIntegrations: ["askART"]
    });

    expect(resolved.sourceAccessStatus).toBe("licensed_access");
    expect(resolved.mode).toBe("licensed");
  });

  it("supports session directory creation and cookie loading", () => {
    const manager = new AuthManager(profiles);

    const tmpDir = path.resolve("/tmp", "artbot-auth-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const cookiePath = path.join(tmpDir, "cookies.json");
    fs.writeFileSync(cookiePath, JSON.stringify([{ name: "sid", value: "123" }]), "utf-8");

    const cookieContent = manager.loadCookies(cookiePath);
    expect(cookieContent).toContain("sid");

    const sessionPath = manager.ensureSessionDir("askart-license");
    expect(sessionPath).toBe("/tmp/askart-state.json");
  });

  it("detects expired sessions using profile ttl", () => {
    const manager = new AuthManager([
      {
        id: "ttl-profile",
        mode: "authorized",
        sourcePatterns: ["example"],
        sessionTtlMinutes: 1
      }
    ]);

    const now = new Date("2026-04-08T12:00:00.000Z");
    expect(manager.isSessionExpired("ttl-profile", "2026-04-08T11:58:30.000Z", now)).toBe(true);
    expect(manager.isSessionExpired("ttl-profile", "2026-04-08T11:59:30.000Z", now)).toBe(false);
  });

  it("refreshes when persisted session missing or auth failure detected", () => {
    const manager = new AuthManager(profiles);

    const missing = manager.shouldRefreshSession({
      profileId: "artsy-auth",
      sessionPath: "/tmp/definitely-missing-state.json"
    });
    expect(missing.refresh).toBe(true);

    const authFailed = manager.shouldRefreshSession({
      profileId: "artsy-auth",
      sessionPath: "/tmp/does-not-matter.json",
      authFailureDetected: true
    });
    expect(authFailed.refresh).toBe(true);
  });

  it("reuses persisted session when state exists and ttl is valid", () => {
    const tmpDir = path.resolve("/tmp", "artbot-session-state-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const statePath = path.join(tmpDir, "state.json");
    fs.writeFileSync(statePath, JSON.stringify({ cookies: [] }), "utf-8");

    const manager = new AuthManager([
      {
        id: "state-profile",
        mode: "authorized",
        sourcePatterns: ["example"],
        storageStatePath: statePath,
        sessionTtlMinutes: 120
      }
    ]);

    const reusable = manager.shouldRefreshSession({
      profileId: "state-profile",
      sessionPath: statePath,
      lastRefreshedAtIso: new Date().toISOString()
    });

    expect(reusable.refresh).toBe(false);
  });
});
