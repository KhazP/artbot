import type { StagehandMode } from "@artbot/shared-types";

export type SetupLlmProvider = "local_lm_studio" | "nvidia" | "openai_compatible_custom";

export interface AuthProfile {
  id: string;
  mode: "authorized" | "licensed";
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
}

export interface ParseAuthProfilesResult {
  profiles: AuthProfile[];
  error: AuthProfilesError | null;
}

export interface AuthProfilesError {
  message: string;
  details?: string;
  rawValue?: string;
}

export interface AuthProfileSessionState {
  profileId: string;
  storageStatePath: string;
  exists: boolean;
  lastModifiedAtIso: string | null;
  expired: boolean;
  encryptedAtRest: boolean;
  riskyReason?: string | null;
}

export interface LlmHealthResult {
  ok: boolean;
  baseUrl: string;
  modelId?: string;
  statusCode?: number;
  reason?: string;
}

export interface ApiHealthResult {
  ok: boolean;
  apiBaseUrl: string;
  statusCode?: number;
  reason?: string;
}

export interface SearxngHealthResult {
  ok: boolean;
  baseUrl: string;
  statusCode?: number;
  reason?: string;
}

export interface AuthCaptureCommand {
  profileId: string;
  sourceUrl: string;
  storageStatePath: string;
  finalStorageStatePath: string;
  command: string;
}

export interface LocalBackendProcessCommand {
  service: "api" | "worker";
  command: string;
  cwd: string;
  displayName: string;
}

export type LocalBackendMode = "workspace" | "bundled" | "none";

export interface AuthRelevantProfile {
  profile: AuthProfile;
  matchedSources: string[];
}

export interface SetupIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  detail?: string;
}

export interface SetupAssessment {
  cwd: string;
  workspaceRoot: string | null;
  envPath: string;
  localBackendAvailable: boolean;
  localBackendMode: LocalBackendMode;
  localBackendPath: string | null;
  llmProvider: SetupLlmProvider;
  llmBaseUrl: string;
  stagehandMode: StagehandMode;
  apiBaseUrl: string;
  webDiscoveryEnabled: boolean;
  webDiscoveryProvider: string;
  searxngBaseUrl: string;
  firecrawlEnabled: boolean;
  llmHealth: LlmHealthResult;
  apiHealth: ApiHealthResult;
  searxngHealth: SearxngHealthResult;
  profiles: AuthProfile[];
  authProfilesError: AuthProfilesError | null;
  relevantProfiles: AuthRelevantProfile[];
  sessionStates: AuthProfileSessionState[];
  issues: SetupIssue[];
  blockingIssues: SetupIssue[];
  optionalIssues: SetupIssue[];
  recommendedNextAction: string;
}

export interface SetupWizardValues {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  stagehandMode: StagehandMode;
  apiBaseUrl: string;
  enableOptionalProbes: boolean;
  enableLicensedIntegrations: boolean;
  reportSurface: "ask" | "cli" | "web";
  defaultLicensedIntegrations: string[];
  authProfiles: AuthProfile[];
}

export interface StartedBackendServices {
  mode: Exclude<LocalBackendMode, "none">;
  runtimeRoot: string;
  logDir: string;
  apiLogPath: string;
  workerLogPath: string;
  apiPid: number | null;
  workerPid: number | null;
  reusedExisting: boolean;
}

export interface LocalRuntimePaths {
  homeDir: string;
  envPath: string;
  dataDir: string;
  dbPath: string;
  runsRoot: string;
  logDir: string;
  authDir: string;
  stateDir: string;
  backendStatePath: string;
}

export interface BackendProcessStatus {
  pid: number | null;
  running: boolean;
  logPath: string | null;
}

export interface LocalBackendStatus {
  mode: LocalBackendMode;
  available: boolean;
  runtimeRoot: string | null;
  apiBaseUrl: string;
  apiHealth: ApiHealthResult;
  api: BackendProcessStatus;
  worker: BackendProcessStatus;
  recommendedEntryCommand: string;
}
