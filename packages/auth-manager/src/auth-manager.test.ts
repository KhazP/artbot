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
    expect(resolved.legalPosture).toBe("public_permitted");
    expect(resolved.artifactHandling).toBe("standard");
    expect(resolved.sessionIdentity).toBe("session:anonymous");
    expect(resolved.browserIdentity).toBe("browser:ephemeral");
    expect(resolved.proxyIdentity).toBe("proxy:direct");
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
    expect(resolved.legalPosture).toBe("licensed_only");
    expect(resolved.artifactHandling).toBe("internal_only");
    expect(resolved.accessProvenanceLabel).toContain("Licensed access");
    expect(resolved.sessionIdentity).toBe("session:askart-license");
    expect(resolved.browserIdentity).toBe("browser:askart-license");
  });

  it("separates session, browser, and proxy identities for authorized access", () => {
    const manager = new AuthManager([
      {
        id: "sanatfiyat-auth",
        mode: "authorized",
        sourcePatterns: ["sanatfiyat"],
        browserIdentity: "browser:licensed-pool-a",
        proxyIdentity: "proxy:residential-tr-1"
      }
    ]);

    const resolved = manager.resolveAccess({
      sourceName: "Sanatfiyat",
      sourceUrl: "https://sanatfiyat.com",
      sourceRequiresAuth: true,
      sourceRequiresLicense: false,
      legalPosture: "public_contract_sensitive"
    });

    expect(resolved.mode).toBe("authorized");
    expect(resolved.artifactHandling).toBe("scrubbed_sensitive");
    expect(resolved.sessionIdentity).toBe("session:sanatfiyat-auth");
    expect(resolved.browserIdentity).toBe("browser:licensed-pool-a");
    expect(resolved.proxyIdentity).toBe("proxy:residential-tr-1");
    expect(resolved.accessProvenanceLabel).toContain("Authorized session");
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

  it("loads cookies from the configured profile cookie file when only profileId is provided", () => {
    const tmpDir = path.resolve("/tmp", "artbot-auth-profile-cookie-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const cookiePath = path.join(tmpDir, "sanatfiyat-cookies.json");
    fs.writeFileSync(cookiePath, JSON.stringify([{ name: "sid", value: "licensed" }]), "utf-8");

    const manager = new AuthManager([
      {
        id: "sanatfiyat-license",
        mode: "licensed",
        sourcePatterns: ["sanatfiyat"],
        cookieFile: cookiePath
      }
    ]);

    const cookieContent = manager.loadCookies("sanatfiyat-license");
    expect(cookieContent).toContain("licensed");
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

  it("materializes and persists encrypted session state", () => {
    const tmpDir = path.resolve("/tmp", "artbot-encrypted-session-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const statePath = path.join(tmpDir, "state.json.enc");
    process.env.AUTH_STATE_ENCRYPTION_KEY = "test-secret";

    const manager = new AuthManager([
      {
        id: "encrypted-profile",
        mode: "authorized",
        sourcePatterns: ["example"],
        storageStatePath: statePath,
        sensitivity: "sensitive",
        encryptionMode: "aes-256-gcm"
      }
    ]);

    const plaintextPath = path.join(tmpDir, "plain.json");
    fs.writeFileSync(plaintextPath, JSON.stringify({ cookies: [{ name: "sid" }] }), "utf-8");
    manager.persistSessionState("encrypted-profile", plaintextPath);

    const encryptedContent = fs.readFileSync(statePath, "utf-8");
    expect(encryptedContent).not.toContain("\"cookies\"");

    const materialized = manager.materializeSessionState("encrypted-profile");
    expect(materialized.encryptedAtRest).toBe(true);
    expect(materialized.browserPath).toBeTruthy();
    expect(fs.readFileSync(materialized.browserPath!, "utf-8")).toContain("\"cookies\"");
    materialized.cleanup();
  });

  it("parses quoted AUTH_PROFILES_JSON from dotenv-style environments", () => {
    process.env.AUTH_PROFILES_JSON =
      '\'[{"id":"quoted-profile","mode":"licensed","sourcePatterns":["sanatfiyat"],"storageStatePath":"/tmp/quoted-state.json"}]\'';

    const manager = new AuthManager();
    const [profile] = manager.listProfiles();

    expect(profile?.id).toBe("quoted-profile");
    expect(profile?.mode).toBe("licensed");

    delete process.env.AUTH_PROFILES_JSON;
  });
});
