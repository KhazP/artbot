import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AccessContext } from "@artbot/shared-types";
import { logger } from "@artbot/observability";
import type {
  AuthProfile,
  CredentialRefs,
  MaterializedSessionState,
  ResolveAccessInput,
  SessionRefreshDecision,
  SessionRefreshInput
} from "./types.js";

function buildAuthProfilesParseCandidates(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  const candidates = [trimmed];
  const pushCandidate = (candidate: string) => {
    if (candidate.length > 0 && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    pushCandidate(trimmed.slice(1, -1));
  }

  for (const candidate of [...candidates]) {
    const repaired = candidate.replace(/\\"/g, "\"");
    if (repaired !== candidate) {
      pushCandidate(repaired);
    }
  }

  return candidates;
}

function parseProfilesFromEnv(): AuthProfile[] {
  const json = process.env.AUTH_PROFILES_JSON;
  if (!json) {
    return [];
  }

  for (const candidate of buildAuthProfilesParseCandidates(json)) {
    try {
      let parsed: unknown = candidate;
      for (let depth = 0; depth < 3 && typeof parsed === "string"; depth += 1) {
        parsed = JSON.parse(parsed) as unknown;
      }

      if (Array.isArray(parsed)) {
        return parsed as AuthProfile[];
      }
    } catch {
      continue;
    }
  }

  return [];
}

function profileMatchesSource(profile: AuthProfile, sourceName: string, sourceUrl: string): boolean {
  const patterns = profile.sourceScope?.length ? profile.sourceScope : profile.sourcePatterns;
  return patterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(sourceName) || regex.test(sourceUrl);
    } catch {
      return false;
    }
  });
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function isEncryptedProfile(profile: AuthProfile | undefined): boolean {
  return profile?.encryptionMode === "aes-256-gcm";
}

function encryptPayload(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  });
}

function decryptPayload(secret: string, payload: string): string {
  const parsed = JSON.parse(payload) as {
    algorithm?: string;
    iv?: string;
    tag?: string;
    data?: string;
  };

  if (parsed.algorithm !== "aes-256-gcm" || !parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error("Encrypted auth payload is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(secret), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]);
  return decrypted.toString("utf-8");
}

export class AuthManager {
  private readonly profiles: AuthProfile[];

  constructor(profiles: AuthProfile[] = parseProfilesFromEnv()) {
    this.profiles = profiles;
  }

  public listProfiles(): AuthProfile[] {
    return [...this.profiles];
  }

  public resolveAccess(input: ResolveAccessInput): AccessContext {
    const licensedIntegrations = input.licensedIntegrations ?? [];

    if (input.sourceRequiresLicense) {
      const hasLicensedPath = Boolean(input.allowLicensed) && licensedIntegrations.includes(input.sourceName);
      if (hasLicensedPath) {
        const licensedProfile = this.selectProfile(input.requestedProfileId, input.sourceName, input.sourceUrl);
        return {
          mode: "licensed",
          profileId: licensedProfile?.id,
          sourceScope: licensedProfile?.sourceScope,
          sessionExpiresAt: licensedProfile?.expiresAt,
          sensitivity: licensedProfile?.sensitivity ?? "licensed",
          encryptedAtRest: isEncryptedProfile(licensedProfile),
          licensedIntegrations,
          sourceAccessStatus: "licensed_access",
          allowLicensed: true,
          accessReason: "Using operator-provided licensed integration."
        };
      }

      return {
        mode: "anonymous",
        licensedIntegrations,
        sourceAccessStatus: "blocked",
        allowLicensed: false,
        accessReason: "Licensed access required.",
        blockerReason: "No lawful licensed access configured for source."
      };
    }

    const selectedProfile = this.selectProfile(input.requestedProfileId, input.sourceName, input.sourceUrl);

    if (input.sourceRequiresAuth) {
      if (!selectedProfile) {
        return {
          mode: "anonymous",
          licensedIntegrations,
          sourceAccessStatus: "auth_required",
          allowLicensed: Boolean(input.allowLicensed),
          manualLoginCheckpoint: input.manualLoginCheckpoint,
          cookieFile: input.cookieFile,
          accessReason: "Source requires authentication.",
          blockerReason: "No matching auth profile supplied."
        };
      }

      return {
        mode: selectedProfile.mode,
        profileId: selectedProfile.id,
        cookieFile: input.cookieFile ?? selectedProfile.cookieFile,
        sourceScope: selectedProfile.sourceScope,
        sessionExpiresAt: selectedProfile.expiresAt,
        sensitivity: selectedProfile.sensitivity ?? (selectedProfile.mode === "licensed" ? "licensed" : "sensitive"),
        encryptedAtRest: isEncryptedProfile(selectedProfile),
        manualLoginCheckpoint: input.manualLoginCheckpoint,
        allowLicensed: Boolean(input.allowLicensed),
        licensedIntegrations,
        sourceAccessStatus: "auth_required",
        accessReason: `Source requires authentication; using profile ${selectedProfile.id}.`
      };
    }

    if (selectedProfile?.mode === "licensed") {
      return {
        mode: "licensed",
        profileId: selectedProfile.id,
        sourceScope: selectedProfile.sourceScope,
        sessionExpiresAt: selectedProfile.expiresAt,
        sensitivity: selectedProfile.sensitivity ?? "licensed",
        encryptedAtRest: isEncryptedProfile(selectedProfile),
        allowLicensed: Boolean(input.allowLicensed),
        licensedIntegrations,
        sourceAccessStatus: "licensed_access",
        accessReason: `Using licensed profile ${selectedProfile.id}.`
      };
    }

    if (selectedProfile) {
      return {
        mode: "authorized",
        profileId: selectedProfile.id,
        cookieFile: input.cookieFile ?? selectedProfile.cookieFile,
        sourceScope: selectedProfile.sourceScope,
        sessionExpiresAt: selectedProfile.expiresAt,
        sensitivity: selectedProfile.sensitivity ?? "sensitive",
        encryptedAtRest: isEncryptedProfile(selectedProfile),
        manualLoginCheckpoint: input.manualLoginCheckpoint,
        allowLicensed: Boolean(input.allowLicensed),
        licensedIntegrations,
        sourceAccessStatus: "public_access",
        accessReason: `Using optional authorized profile ${selectedProfile.id} on public source.`
      };
    }

    return {
      mode: "anonymous",
      allowLicensed: Boolean(input.allowLicensed),
      licensedIntegrations,
      sourceAccessStatus: "public_access",
      accessReason: "Public source access path."
    };
  }

  public getCredentialRefs(profileId?: string): CredentialRefs {
    const profile = this.getProfileById(profileId);
    if (!profile) {
      return {};
    }

    return {
      usernameRef: profile.usernameEnv,
      passwordRef: profile.passwordEnv,
      apiKeyRef: profile.apiKeyEnv,
      cookieFile: profile.cookieFile
    };
  }

  public getStorageStatePath(profileId?: string): string | undefined {
    const profile = this.getProfileById(profileId);
    if (!profile) {
      return undefined;
    }

    if (profile.storageStatePath) {
      return profile.storageStatePath;
    }

    return path.resolve("playwright", ".auth", `${profile.id}.json`);
  }

  public loadCookies(profileId?: string, cookieFile?: string): string | null {
    const profile = this.getProfileById(profileId);
    const directCookiePath = profileId && (profileId.includes(path.sep) || path.isAbsolute(profileId)) ? profileId : undefined;
    const resolvedCookieFile = cookieFile ?? profile?.cookieFile ?? directCookiePath;
    const resolvedProfileId = profileId;
    if (!resolvedCookieFile) {
      return null;
    }

    try {
      const content = fs.readFileSync(resolvedCookieFile, "utf-8");
      if (!isEncryptedProfile(profile)) {
        return content;
      }

      const secret = this.resolveEncryptionSecret(profile);
      if (!secret) {
        logger.warn("Encrypted auth profile missing encryption secret.", {
          profileId: resolvedProfileId,
          encryptionKeyEnv: profile?.encryptionKeyEnv
        });
        return null;
      }
      return decryptPayload(secret, content);
    } catch (error) {
      logger.warn("Failed to read cookie file.", {
        cookieFile: resolvedCookieFile,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  public ensureSessionDir(profileId?: string): string | undefined {
    const target = this.getStorageStatePath(profileId);
    if (!target) {
      return undefined;
    }

    const folder = path.dirname(target);
    fs.mkdirSync(folder, { recursive: true });
    return target;
  }

  public materializeSessionState(profileId?: string): MaterializedSessionState {
    const targetPath = this.ensureSessionDir(profileId);
    const profile = this.getProfileById(profileId);
    if (!targetPath || !profile || !isEncryptedProfile(profile)) {
      return {
        browserPath: targetPath,
        targetPath,
        encryptedAtRest: false,
        cleanup: () => {}
      };
    }

    const browserPath = path.join(os.tmpdir(), `artbot-session-${profile.id}-${Date.now()}.json`);
    if (fs.existsSync(targetPath)) {
      const secret = this.resolveEncryptionSecret(profile);
      if (secret) {
        const encryptedPayload = fs.readFileSync(targetPath, "utf-8");
        fs.writeFileSync(browserPath, decryptPayload(secret, encryptedPayload), "utf-8");
      }
    }

    return {
      browserPath,
      targetPath,
      encryptedAtRest: true,
      cleanup: () => {
        if (fs.existsSync(browserPath)) {
          fs.rmSync(browserPath, { force: true });
        }
      }
    };
  }

  public persistSessionState(profileId: string | undefined, sessionPath: string | undefined): void {
    if (!profileId || !sessionPath || !fs.existsSync(sessionPath)) {
      return;
    }

    const profile = this.getProfileById(profileId);
    const targetPath = this.ensureSessionDir(profileId);
    if (!profile || !targetPath) {
      return;
    }

    if (!isEncryptedProfile(profile)) {
      if (sessionPath !== targetPath) {
        fs.copyFileSync(sessionPath, targetPath);
      }
      return;
    }

    const secret = this.resolveEncryptionSecret(profile);
    if (!secret) {
      logger.warn("Skipping encrypted session persist because encryption secret is missing.", {
        profileId,
        encryptionKeyEnv: profile.encryptionKeyEnv
      });
      return;
    }

    const plaintext = fs.readFileSync(sessionPath, "utf-8");
    fs.writeFileSync(targetPath, encryptPayload(secret, plaintext), "utf-8");
  }

  public isProfileRisky(profileId?: string): string | null {
    const profile = this.getProfileById(profileId);
    if (!profile) {
      return null;
    }
    if ((profile.sensitivity === "sensitive" || profile.sensitivity === "licensed") && !isEncryptedProfile(profile)) {
      return "Sensitive profile is not encrypted at rest.";
    }
    if (isEncryptedProfile(profile) && !this.resolveEncryptionSecret(profile)) {
      return "Encrypted profile is missing its encryption key.";
    }
    if (profile.expiresAt) {
      const expiresAt = new Date(profile.expiresAt);
      if (!Number.isNaN(expiresAt.valueOf()) && expiresAt.getTime() <= Date.now()) {
        return "Profile expiry date has passed.";
      }
    }
    return null;
  }

  public isSessionExpired(profileId: string | undefined, lastRefreshedAtIso: string | undefined, now = new Date()): boolean {
    const profile = this.getProfileById(profileId);
    const ttlMinutes = profile?.sessionTtlMinutes ?? 6 * 60;

    if (!lastRefreshedAtIso) {
      return true;
    }

    const last = new Date(lastRefreshedAtIso);
    if (Number.isNaN(last.valueOf())) {
      return true;
    }

    const ageMs = now.getTime() - last.getTime();
    return ageMs > ttlMinutes * 60 * 1000;
  }

  public shouldRefreshSession(input: SessionRefreshInput): SessionRefreshDecision {
    if (!input.profileId) {
      return {
        refresh: false,
        reason: "Anonymous mode without persisted session."
      };
    }

    if (input.authFailureDetected) {
      return {
        refresh: true,
        reason: "Authentication gate detected; force session refresh."
      };
    }

    if (!input.sessionPath || !fs.existsSync(input.sessionPath)) {
      return {
        refresh: true,
        reason: "No persisted session state found."
      };
    }

    const stat = fs.statSync(input.sessionPath);
    const lastRefreshedAtIso = input.lastRefreshedAtIso ?? stat.mtime.toISOString();

    if (this.isSessionExpired(input.profileId, lastRefreshedAtIso)) {
      return {
        refresh: true,
        reason: "Persisted session state expired."
      };
    }

    return {
      refresh: false,
      reason: "Persisted session state is reusable."
    };
  }

  private selectProfile(requestedProfileId: string | undefined, sourceName: string, sourceUrl: string): AuthProfile | undefined {
    if (requestedProfileId) {
      const explicit = this.getProfileById(requestedProfileId);
      if (!explicit) {
        logger.warn("Requested auth profile not found.", { requestedProfileId, sourceName, sourceUrl });
      }
      return explicit;
    }

    return this.profiles.find((profile) => profileMatchesSource(profile, sourceName, sourceUrl));
  }

  private getProfileById(profileId?: string): AuthProfile | undefined {
    if (!profileId) {
      return undefined;
    }
    return this.profiles.find((entry) => entry.id === profileId);
  }

  private resolveEncryptionSecret(profile: AuthProfile | undefined): string | null {
    if (!profile || !isEncryptedProfile(profile)) {
      return null;
    }

    const envName = profile.encryptionKeyEnv ?? "AUTH_STATE_ENCRYPTION_KEY";
    const value = process.env[envName];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
