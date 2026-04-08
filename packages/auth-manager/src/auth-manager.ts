import fs from "node:fs";
import path from "node:path";
import type { AccessContext } from "@artbot/shared-types";
import { logger } from "@artbot/observability";
import type {
  AuthProfile,
  CredentialRefs,
  ResolveAccessInput,
  SessionRefreshDecision,
  SessionRefreshInput
} from "./types.js";

function parseProfilesFromEnv(): AuthProfile[] {
  const json = process.env.AUTH_PROFILES_JSON;
  if (!json) {
    return [];
  }

  try {
    const parsed = JSON.parse(json) as AuthProfile[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function profileMatchesSource(profile: AuthProfile, sourceName: string, sourceUrl: string): boolean {
  return profile.sourcePatterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(sourceName) || regex.test(sourceUrl);
    } catch {
      return false;
    }
  });
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
        return {
          mode: "licensed",
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

  public loadCookies(cookieFile?: string): string | null {
    if (!cookieFile) {
      return null;
    }

    try {
      const content = fs.readFileSync(cookieFile, "utf-8");
      return content;
    } catch (error) {
      logger.warn("Failed to read cookie file.", {
        cookieFile,
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
}
