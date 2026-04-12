import * as clack from "@clack/prompts";
import picocolors from "picocolors";
import { buildAuthCaptureCommand, findAuthRelevantProfiles, inspectSessionStates, parseAuthProfilesJson } from "./auth.js";
import { resolveLocalBackendSupport, startLocalBackendServices } from "./backend.js";
import {
  applyEnvUpdates,
  buildDefaultAuthProfiles,
  buildSetupEnvUpdates,
  detectWorkspaceRoot,
  defaultSourceUrlForProfile,
  ensureLocalRuntimePaths,
  loadWorkspaceEnv,
  parseBooleanEnv,
  parseCommaSeparatedEnv,
  resolveEnvFilePath,
  resolveLocalRuntimePaths,
  resolveWorkspaceRoot,
  upsertEnvFile
} from "./env.js";
import { checkApiHealth, checkLlmHealth, normalizeLlmBaseUrl } from "./health.js";
import type { SetupAssessment, SetupIssue, SetupWizardValues, StartedBackendServices } from "./types.js";
import { normalizeReportSurface } from "../report/browser-report.js";

function createIssue(severity: SetupIssue["severity"], code: string, message: string, detail?: string): SetupIssue {
  return { severity, code, message, detail };
}

export async function assessLocalSetup(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<SetupAssessment> {
  if (env === process.env) {
    loadWorkspaceEnv(cwd);
  }

  const workspaceRoot = detectWorkspaceRoot(cwd);
  const resolvedCwd = resolveWorkspaceRoot(cwd);
  const envPath = resolveEnvFilePath(resolvedCwd);
  const localBackendSupport = resolveLocalBackendSupport(cwd);
  const llmBaseUrl = normalizeLlmBaseUrl(env.LLM_BASE_URL?.trim() || "http://127.0.0.1:1234/v1");
  const apiBaseUrl = env.API_BASE_URL?.trim() || "http://localhost:4000";
  const llmHealth = await checkLlmHealth(llmBaseUrl, env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? "lm-studio");
  const apiHealth = await checkApiHealth(apiBaseUrl, env.ARTBOT_API_KEY);
  const parsedProfiles = parseAuthProfilesJson(env.AUTH_PROFILES_JSON);
  const profiles = parsedProfiles.profiles;
  const enableOptionalProbes = parseBooleanEnv(env.ENABLE_OPTIONAL_PROBE_ADAPTERS, false);
  const enableLicensedIntegrations = parseBooleanEnv(env.ENABLE_LICENSED_INTEGRATIONS, false);
  const enabledSourceNames = [
    ...(enableOptionalProbes ? ["Artsy", "MutualArt", "askART"] : []),
    ...(enableLicensedIntegrations ? ["Sanatfiyat"] : [])
  ];
  const relevantProfiles = findAuthRelevantProfiles(profiles, enabledSourceNames);
  const sessionStates = inspectSessionStates(relevantProfiles.map((entry) => entry.profile), resolvedCwd);

  const issues: SetupIssue[] = [];
  if (!llmHealth.ok) {
    issues.push(
      createIssue(
        "error",
        "llm_unreachable",
        "LM Studio is not reachable.",
        `${llmHealth.reason ?? "Unknown error."} Start LM Studio's local server and confirm ${llmBaseUrl} is enabled.`
      )
    );
  }
  if (!apiHealth.ok) {
    issues.push(createIssue("warning", "api_unreachable", "ArtBot API is not reachable.", apiHealth.reason));
    if (!localBackendSupport.available) {
      issues.push(
        createIssue(
          "warning",
          "local_backend_unavailable",
          "Local backend auto-start is unavailable in this installation.",
          "Reinstall artbot or set API_BASE_URL to a running ArtBot API."
        )
      );
    }
  }
  if (parsedProfiles.error) {
    issues.push(createIssue("error", "auth_profiles_invalid", parsedProfiles.error.message, parsedProfiles.error.details));
  }
  if (enabledSourceNames.length > 0 && profiles.length === 0) {
    issues.push(createIssue("warning", "auth_profiles_missing", "Auth-capable sources are enabled but no auth profiles are configured."));
  }

  for (const session of sessionStates) {
    if (!session.exists) {
      issues.push(createIssue("warning", "auth_session_missing", `Missing browser session for ${session.profileId}.`, session.storageStatePath));
      continue;
    }
    if (session.expired) {
      issues.push(createIssue("warning", "auth_session_expired", `Saved browser session expired for ${session.profileId}.`, session.storageStatePath));
    }
  }

  return {
    cwd: resolvedCwd,
    workspaceRoot,
    envPath,
    localBackendAvailable: localBackendSupport.available,
    localBackendMode: localBackendSupport.mode,
    localBackendPath: localBackendSupport.path,
    llmBaseUrl,
    apiBaseUrl,
    llmHealth,
    apiHealth,
    profiles,
    authProfilesError: parsedProfiles.error,
    relevantProfiles,
    sessionStates,
    issues
  };
}

export async function runSetupWizard(cwd = process.cwd()): Promise<{
  assessment: SetupAssessment;
  backendStart: StartedBackendServices | null;
}> {
  const env = process.env;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const localBackendSupport = resolveLocalBackendSupport(cwd);
  const llmBaseUrl = await clack.text({
    message: "LM Studio base URL",
    initialValue: normalizeLlmBaseUrl(env.LLM_BASE_URL?.trim() || "http://127.0.0.1:1234/v1"),
    validate(input) {
      return input.trim().length === 0 ? "LM Studio URL is required." : undefined;
    }
  });
  if (clack.isCancel(llmBaseUrl)) throw new Error("Setup cancelled.");

  const useLocalBackend = localBackendSupport.available
    ? await clack.confirm({
        message:
          localBackendSupport.mode === "workspace"
            ? "Use the local ArtBot backend from this repo?"
            : "Use the packaged local ArtBot backend on this machine?",
        initialValue: true
      })
    : false;
  if (clack.isCancel(useLocalBackend)) throw new Error("Setup cancelled.");

  const apiBaseUrl = useLocalBackend
    ? env.API_BASE_URL?.trim() || "http://localhost:4000"
    : await clack.text({
        message: "ArtBot API base URL",
        initialValue: env.API_BASE_URL?.trim() || "http://localhost:4000",
        validate(input) {
          return input.trim().length === 0 ? "API URL is required." : undefined;
        }
      });
  if (clack.isCancel(apiBaseUrl)) throw new Error("Setup cancelled.");

  const enableOptionalProbes = await clack.confirm({
    message: "Enable optional probe sources (Artsy, MutualArt, askART)?",
    initialValue: parseBooleanEnv(env.ENABLE_OPTIONAL_PROBE_ADAPTERS, false)
  });
  if (clack.isCancel(enableOptionalProbes)) throw new Error("Setup cancelled.");

  const enableLicensedIntegrations = await clack.confirm({
    message: "Enable licensed integrations?",
    initialValue: parseBooleanEnv(env.ENABLE_LICENSED_INTEGRATIONS, false)
  });
  if (clack.isCancel(enableLicensedIntegrations)) throw new Error("Setup cancelled.");

  const reportSurface = await clack.select({
    message: "How should completed reports be shown by default?",
    initialValue: normalizeReportSurface(env.DEFAULT_REPORT_SURFACE?.trim()),
    options: [
      {
        value: "ask" as const,
        label: "Ask after each completed run",
        hint: "choose CLI or browser report per run"
      },
      {
        value: "cli" as const,
        label: "Always show CLI report",
        hint: "stay in the terminal by default"
      },
      {
        value: "web" as const,
        label: "Always open browser report",
        hint: "generate and open the browser report automatically"
      }
    ]
  });
  if (clack.isCancel(reportSurface)) throw new Error("Setup cancelled.");

  const defaultLicensedIntegrations = enableLicensedIntegrations ? ["Sanatfiyat"] : [];
  const authProfiles = buildDefaultAuthProfiles({
    cwd: workspaceRoot,
    enableOptionalProbes,
    enableLicensedIntegrations
  });

  const values: SetupWizardValues = {
    llmBaseUrl: normalizeLlmBaseUrl(llmBaseUrl.trim()),
    apiBaseUrl: apiBaseUrl.trim(),
    enableOptionalProbes,
    enableLicensedIntegrations,
    reportSurface,
    defaultLicensedIntegrations,
    authProfiles
  };

  const envPath = resolveEnvFilePath(workspaceRoot);
  const envUpdates = buildSetupEnvUpdates(values);
  if (useLocalBackend && localBackendSupport.mode === "bundled") {
    const runtimePaths = ensureLocalRuntimePaths();
    envUpdates.DATABASE_PATH = runtimePaths.dbPath;
    envUpdates.RUNS_ROOT = runtimePaths.runsRoot;
  }
  upsertEnvFile(envPath, envUpdates);
  applyEnvUpdates(process.env, envUpdates);
  clack.log.success(`Updated ${picocolors.bold(envPath)}`);

  let backendStart: StartedBackendServices | null = null;
  const apiHealth = await checkApiHealth(values.apiBaseUrl, process.env.ARTBOT_API_KEY);
  if (!apiHealth.ok && useLocalBackend && localBackendSupport.available) {
    const shouldStartBackend = await clack.confirm({
      message: "ArtBot API is offline. Start local API and worker now?",
      initialValue: true
    });
    if (clack.isCancel(shouldStartBackend)) throw new Error("Setup cancelled.");
    if (shouldStartBackend) {
      backendStart = await startLocalBackendServices(workspaceRoot, values.apiBaseUrl);
      clack.log.info(`Started local backend. API log: ${backendStart.apiLogPath}`);
      clack.log.info(`Worker log: ${backendStart.workerLogPath}`);
    }
  } else if (!apiHealth.ok) {
    clack.log.info("Set API_BASE_URL to a running ArtBot API or rerun setup to enable the local backend.");
  }

  const captureNow = authProfiles.length > 0
    ? await clack.confirm({
        message: "Capture browser login sessions now?",
        initialValue: false
      })
    : false;

  if (clack.isCancel(captureNow)) throw new Error("Setup cancelled.");
  if (captureNow) {
    for (const profile of authProfiles) {
      const shouldCaptureProfile = await clack.confirm({
        message: `Capture session for ${profile.id}?`,
        initialValue: !profile.id.startsWith("artsy") && !profile.id.startsWith("askart")
      });
      if (clack.isCancel(shouldCaptureProfile)) throw new Error("Setup cancelled.");
      if (!shouldCaptureProfile) continue;
      const command = buildAuthCaptureCommand(profile, defaultSourceUrlForProfile(profile.id));
      clack.log.message(`${picocolors.cyan("Auth capture")}: ${command.command}`);
    }
  }

  const assessment = await assessLocalSetup(process.env, workspaceRoot);
  return { assessment, backendStart };
}

export function resolveSetupWizardDefaults(env: NodeJS.ProcessEnv = process.env): SetupWizardValues {
  if (env === process.env) {
    loadWorkspaceEnv();
  }

  const enableOptionalProbes = parseBooleanEnv(env.ENABLE_OPTIONAL_PROBE_ADAPTERS, false);
  const enableLicensedIntegrations = parseBooleanEnv(env.ENABLE_LICENSED_INTEGRATIONS, false);
  return {
    llmBaseUrl: normalizeLlmBaseUrl(env.LLM_BASE_URL?.trim() || "http://127.0.0.1:1234/v1"),
    apiBaseUrl: env.API_BASE_URL?.trim() || "http://localhost:4000",
    enableOptionalProbes,
    enableLicensedIntegrations,
    reportSurface: normalizeReportSurface(env.DEFAULT_REPORT_SURFACE?.trim()),
    defaultLicensedIntegrations: parseCommaSeparatedEnv(env.DEFAULT_LICENSED_INTEGRATIONS),
    authProfiles: parseAuthProfilesJson(env.AUTH_PROFILES_JSON).profiles
  };
}
