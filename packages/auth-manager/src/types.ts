import type { AccessMode, SourceLegalPosture } from "@artbot/shared-types";

export interface AuthProfile {
  id: string;
  mode: Exclude<AccessMode, "anonymous">;
  sourcePatterns: string[];
  sourceScope?: string[];
  cookieFile?: string;
  usernameEnv?: string;
  passwordEnv?: string;
  apiKeyEnv?: string;
  storageStatePath?: string;
  sessionTtlMinutes?: number;
  expiresAt?: string;
  sensitivity?: "standard" | "sensitive" | "licensed";
  encryptionMode?: "none" | "aes-256-gcm";
  encryptionKeyEnv?: string;
  browserIdentity?: string;
  proxyIdentity?: string;
}

export interface CredentialRefs {
  usernameRef?: string;
  passwordRef?: string;
  apiKeyRef?: string;
  cookieFile?: string;
}

export interface SessionRefreshInput {
  profileId?: string;
  sessionPath?: string;
  lastRefreshedAtIso?: string;
  authFailureDetected?: boolean;
}

export interface SessionRefreshDecision {
  refresh: boolean;
  reason: string;
}

export interface ResolveAccessInput {
  sourceName: string;
  sourceUrl: string;
  sourceRequiresAuth: boolean;
  sourceRequiresLicense: boolean;
  requestedProfileId?: string;
  allowLicensed?: boolean;
  manualLoginCheckpoint?: boolean;
  cookieFile?: string;
  licensedIntegrations?: string[];
  legalPosture?: SourceLegalPosture;
}

export interface MaterializedSessionState {
  browserPath?: string;
  targetPath?: string;
  encryptedAtRest: boolean;
  cleanup: () => void;
}
