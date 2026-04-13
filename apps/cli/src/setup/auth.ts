import path from "node:path";
import { pathExists, statFile } from "../lib/file-system.js";
import { loadWorkspaceEnv, resolveAuthStorageDir, resolveEnvRoot } from "./env.js";
import type {
  AuthCaptureCommand,
  AuthProfile,
  AuthProfileSessionState,
  AuthProfilesError,
  AuthRelevantProfile,
  ParseAuthProfilesResult
} from "./types.js";

function normalizeSourcePattern(value: string): string {
  return value.trim().toLowerCase();
}

function isEncryptedProfile(profile: AuthProfile): boolean {
  return profile.encryptionMode === "aes-256-gcm";
}

function buildAuthProfilesParseCandidates(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  const candidates = [trimmed];
  const pushCandidate = (candidate: string) => {
    if (candidate.length > 0 && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    pushCandidate(trimmed.slice(1, -1));
  }

  for (const candidate of [...candidates]) {
    const repaired = candidate.replace(/\\"/g, '"');
    if (repaired !== candidate) {
      pushCandidate(repaired);
    }
  }

  return candidates;
}

export function parseAuthProfilesJson(rawValue: string | undefined): ParseAuthProfilesResult {
  if (!rawValue || rawValue.trim().length === 0) {
    return { profiles: [], error: null };
  }

  try {
    let parsed: unknown;
    let parsedSuccessfully = false;
    let lastError: unknown;

    for (const candidate of buildAuthProfilesParseCandidates(rawValue)) {
      try {
        parsed = candidate;
        for (let depth = 0; depth < 3 && typeof parsed === "string"; depth += 1) {
          parsed = JSON.parse(parsed) as unknown;
        }
        parsedSuccessfully = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!parsedSuccessfully) {
      throw (lastError ?? new Error("AUTH_PROFILES_JSON is not valid JSON."));
    }

    if (!Array.isArray(parsed)) {
      return {
        profiles: [],
        error: {
          message: "AUTH_PROFILES_JSON must be a JSON array.",
          rawValue
        }
      };
    }

    const profiles: AuthProfile[] = [];
    for (const [index, entry] of parsed.entries()) {
      if (!entry || typeof entry !== "object") {
        return {
          profiles: [],
          error: {
            message: `AUTH_PROFILES_JSON entry ${index} is not an object.`,
            rawValue
          }
        };
      }

      const candidate = entry as Partial<AuthProfile>;
      if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
        return {
          profiles: [],
          error: {
            message: `AUTH_PROFILES_JSON entry ${index} is missing a valid id.`,
            rawValue
          }
        };
      }

      if (candidate.mode !== "authorized" && candidate.mode !== "licensed") {
        return {
          profiles: [],
          error: {
            message: `AUTH_PROFILES_JSON entry ${index} has invalid mode "${String(candidate.mode)}".`,
            rawValue
          }
        };
      }

      if (!Array.isArray(candidate.sourcePatterns) || candidate.sourcePatterns.some((pattern: unknown) => typeof pattern !== "string")) {
        return {
          profiles: [],
          error: {
            message: `AUTH_PROFILES_JSON entry ${index} must define sourcePatterns as an array of strings.`,
            rawValue
          }
        };
      }

      profiles.push({
        id: candidate.id.trim(),
        mode: candidate.mode,
        sourcePatterns: candidate.sourcePatterns.map((pattern: string) => pattern.trim()).filter(Boolean),
        sourceScope: Array.isArray(candidate.sourceScope)
          ? candidate.sourceScope.map((pattern: string) => pattern.trim()).filter(Boolean)
          : undefined,
        cookieFile: candidate.cookieFile,
        usernameEnv: candidate.usernameEnv,
        passwordEnv: candidate.passwordEnv,
        apiKeyEnv: candidate.apiKeyEnv,
        storageStatePath: candidate.storageStatePath,
        sessionTtlMinutes: candidate.sessionTtlMinutes,
        expiresAt: candidate.expiresAt,
        sensitivity: candidate.sensitivity,
        encryptionMode: candidate.encryptionMode,
        encryptionKeyEnv: candidate.encryptionKeyEnv
      });
    }

    return { profiles, error: null };
  } catch (error) {
    return {
      profiles: [],
      error: {
        message: "AUTH_PROFILES_JSON is not valid JSON.",
        details: error instanceof Error ? error.message : String(error),
        rawValue
      }
    };
  }
}

export function resolveAuthProfilesFromEnv(env: NodeJS.ProcessEnv = process.env): ParseAuthProfilesResult {
  if (env === process.env) {
    loadWorkspaceEnv();
  }
  return parseAuthProfilesJson(env.AUTH_PROFILES_JSON);
}

export function resolveStorageStatePath(profile: AuthProfile, cwd = process.cwd()): string {
  if (profile.storageStatePath) {
    return path.resolve(resolveEnvRoot(cwd), profile.storageStatePath);
  }

  return path.resolve(resolveAuthStorageDir(cwd), `${profile.id}.json`);
}

export function inspectSessionState(profile: AuthProfile, cwd = process.cwd(), now = new Date()): AuthProfileSessionState {
  const storageStatePath = resolveStorageStatePath(profile, cwd);
  const exists = pathExists(storageStatePath);
  const stat = exists ? statFile(storageStatePath) : null;
  const lastModifiedAtIso = stat?.mtime.toISOString() ?? null;
  const ttlMinutes = profile.sessionTtlMinutes ?? 6 * 60;

  let expired = true;
  if (exists && stat) {
    expired = now.getTime() - stat.mtime.getTime() > ttlMinutes * 60 * 1000;
  }

  let riskyReason: string | null = null;
  if ((profile.sensitivity === "sensitive" || profile.sensitivity === "licensed") && !isEncryptedProfile(profile)) {
    riskyReason = "Sensitive profile is not encrypted at rest.";
  } else if (isEncryptedProfile(profile)) {
    const envName = profile.encryptionKeyEnv ?? "AUTH_STATE_ENCRYPTION_KEY";
    if (!process.env[envName]) {
      riskyReason = `Missing encryption key env ${envName}.`;
    }
  }
  if (!riskyReason && profile.expiresAt) {
    const expiresAt = new Date(profile.expiresAt);
    if (!Number.isNaN(expiresAt.valueOf()) && expiresAt.getTime() <= now.getTime()) {
      riskyReason = "Profile expiry date has passed.";
    }
  }

  return {
    profileId: profile.id,
    storageStatePath,
    exists,
    lastModifiedAtIso,
    expired,
    encryptedAtRest: isEncryptedProfile(profile),
    riskyReason
  };
}

export function inspectSessionStates(profiles: AuthProfile[], cwd = process.cwd(), now = new Date()): AuthProfileSessionState[] {
  return profiles.map((profile) => inspectSessionState(profile, cwd, now));
}

export function findAuthRelevantProfiles(profiles: AuthProfile[], sourceNames: string[]): AuthRelevantProfile[] {
  const loweredSources = sourceNames.map(normalizeSourcePattern);

  return profiles
    .map((profile) => {
      const matchedSources = loweredSources.filter((source) =>
        profile.sourcePatterns.some((pattern: string) => {
          try {
            return new RegExp(pattern, "i").test(source);
          } catch {
            return source.includes(normalizeSourcePattern(pattern));
          }
        })
      );
      return { profile, matchedSources };
    })
    .filter((entry) => entry.matchedSources.length > 0);
}

export function buildAuthCaptureCommand(profile: AuthProfile, sourceUrl: string, storageStatePath = resolveStorageStatePath(profile)): AuthCaptureCommand {
  const captureStorageStatePath =
    profile.encryptionMode === "aes-256-gcm" ? `${storageStatePath}.plaintext` : storageStatePath;
  const command = `artbot auth capture ${profile.id}`;
  return {
    profileId: profile.id,
    sourceUrl,
    storageStatePath: captureStorageStatePath,
    finalStorageStatePath: storageStatePath,
    command
  };
}

export function buildAuthCaptureCommands(profiles: AuthProfile[], sourceUrlByProfileId: Record<string, string> = {}): AuthCaptureCommand[] {
  return profiles.map((profile) => buildAuthCaptureCommand(profile, sourceUrlByProfileId[profile.id] ?? "https://example.com", resolveStorageStatePath(profile)));
}

export function formatAuthProfilesError(error: AuthProfilesError | null): string | null {
  if (!error) return null;
  return error.details ? `${error.message} ${error.details}` : error.message;
}
