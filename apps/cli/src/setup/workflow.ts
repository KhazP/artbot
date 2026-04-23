import * as clack from "@clack/prompts";
import { normalizeStagehandMode, resolveOpenAiCompatibleApiKey, resolveOpenAiCompatibleModel, type StagehandMode } from "@artbot/shared-types";
import picocolors from "picocolors";
import { normalizeAppLocale } from "../i18n.js";
import { loadTuiPreferences, saveTuiPreferences } from "../tui/preferences.js";
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
import { checkApiHealth, checkLlmHealth, checkSearxngHealth, normalizeLlmBaseUrl } from "./health.js";
import { runInkSetupOnboarding } from "./onboarding.js";
import { DEFAULT_LM_STUDIO_MODEL, DEFAULT_NVIDIA_MODEL, LM_STUDIO_BASE_URL } from "./onboarding-state.js";
import type { SetupAssessment, SetupIssue, SetupLlmProvider, SetupWizardValues, StartedBackendServices } from "./types.js";
import { normalizeReportSurface } from "../report/browser-report.js";

function createIssue(severity: SetupIssue["severity"], code: string, message: string, detail?: string): SetupIssue {
  return { severity, code, message, detail };
}

function inferSetupLlmProvider(baseUrl: string): SetupLlmProvider {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized.includes("integrate.api.nvidia.com")) {
    return "nvidia";
  }
  if (normalized.includes("127.0.0.1:1234") || normalized.includes("localhost:1234")) {
    return "local_lm_studio";
  }
  return "openai_compatible_custom";
}

function buildRecommendedNextAction(input: {
  issues: SetupIssue[];
  localBackendSupportAvailable: boolean;
  sessionStates: SetupAssessment["sessionStates"];
  llmProvider: SetupLlmProvider;
  stagehandMode: StagehandMode;
}): string {
  if (input.issues.some((issue) => issue.code === "llm_unreachable")) {
    return input.llmProvider === "nvidia"
      ? "Check the OpenAI-compatible cloud endpoint and API key."
      : "Check the OpenAI-compatible model server URL, key, and selected model.";
  }
  if (input.issues.some((issue) => issue.code === "api_unreachable")) {
    return input.localBackendSupportAvailable
      ? "Start the local backend or point API_BASE_URL at a running ArtBot API."
      : "Point API_BASE_URL at a running ArtBot API.";
  }
  if (input.sessionStates.some((session) => session.exists && session.expired)) {
    return "Refresh expired browser sessions for the enabled sources.";
  }
  if (input.stagehandMode === "BROWSERBASE") {
    return "Confirm Browserbase credentials and auth sessions before browser-driven runs.";
  }
  return "Environment is ready. Start with artist research or open the operator cockpit.";
}

function resolveSetupDefaultModel(env: NodeJS.ProcessEnv, llmBaseUrl: string): string {
  const fallback = inferSetupLlmProvider(llmBaseUrl) === "nvidia" ? DEFAULT_NVIDIA_MODEL : DEFAULT_LM_STUDIO_MODEL;
  return resolveOpenAiCompatibleModel(env, fallback);
}

function resolveSetupDefaultApiKey(env: NodeJS.ProcessEnv, llmBaseUrl: string): string {
  const configured = env.LLM_API_KEY?.trim();
  if (configured) {
    return configured;
  }
  return inferSetupLlmProvider(llmBaseUrl) === "local_lm_studio" ? "lm-studio" : "";
}

export async function assessLocalSetup(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<SetupAssessment> {
  if (env === process.env) {
    loadWorkspaceEnv(cwd);
  }

  const workspaceRoot = detectWorkspaceRoot(cwd);
  const resolvedCwd = resolveWorkspaceRoot(cwd);
  const envPath = resolveEnvFilePath(resolvedCwd);
  const localBackendSupport = resolveLocalBackendSupport(cwd);
  const llmBaseUrl = normalizeLlmBaseUrl(env.LLM_BASE_URL?.trim() || LM_STUDIO_BASE_URL);
  const llmProvider = inferSetupLlmProvider(llmBaseUrl);
  const stagehandMode = normalizeStagehandMode(env.STAGEHAND_MODE);
  const apiBaseUrl = env.API_BASE_URL?.trim() || "http://localhost:4000";
  const webDiscoveryEnabled = parseBooleanEnv(env.WEB_DISCOVERY_ENABLED, true);
  const webDiscoveryProvider = (env.WEB_DISCOVERY_PROVIDER?.trim().toLowerCase() || "searxng");
  const searxngBaseUrl = env.SEARXNG_BASE_URL?.trim() || "http://127.0.0.1:8080";
  const firecrawlEnabled = parseBooleanEnv(env.FIRECRAWL_ENABLED, false);
  const llmHealth = await checkLlmHealth(llmBaseUrl, resolveOpenAiCompatibleApiKey(env));
  const apiHealth = await checkApiHealth(apiBaseUrl, env.ARTBOT_API_KEY);
  const searxngHealth =
    webDiscoveryEnabled && webDiscoveryProvider === "searxng"
      ? await checkSearxngHealth(searxngBaseUrl)
      : { ok: true, baseUrl: searxngBaseUrl };
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
        "OpenAI-compatible LLM endpoint is not reachable.",
        `${llmHealth.reason ?? "Unknown error."} Confirm the configured endpoint is running and reachable at ${llmBaseUrl}.`
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
  if (!webDiscoveryEnabled) {
    issues.push(
      createIssue(
        "warning",
        "web_discovery_disabled",
        "Web discovery is disabled.",
        "Enable WEB_DISCOVERY_ENABLED=true for the local-unlimited discovery profile."
      )
    );
  }
  if (webDiscoveryEnabled && webDiscoveryProvider !== "searxng") {
    issues.push(
      createIssue(
        "warning",
        "web_discovery_nonlocal_provider",
        `Web discovery provider is set to ${webDiscoveryProvider}.`,
        "Use WEB_DISCOVERY_PROVIDER=searxng for the default local-unlimited profile."
      )
    );
  }
  if (webDiscoveryEnabled && webDiscoveryProvider === "searxng" && !searxngHealth.ok) {
    issues.push(
      createIssue(
        "warning",
        "searxng_unreachable",
        "SearXNG is not reachable.",
        `${searxngHealth.reason ?? "Unknown error."} ArtBot can still fall back to DuckDuckGo HTML search, but local SearXNG should be started for best throughput.`
      )
    );
  }
  if (firecrawlEnabled) {
    issues.push(
      createIssue(
        "warning",
        "firecrawl_opt_in_enabled",
        "Firecrawl is enabled.",
        "This is optional and can incur paid API costs. Set FIRECRAWL_ENABLED=false for the default free-by-default profile."
      )
    );
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

  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const optionalIssues = issues.filter((issue) => issue.severity !== "error");

  return {
    cwd: resolvedCwd,
    workspaceRoot,
    envPath,
    localBackendAvailable: localBackendSupport.available,
    localBackendMode: localBackendSupport.mode,
    localBackendPath: localBackendSupport.path,
    llmProvider,
    llmBaseUrl,
    stagehandMode,
    apiBaseUrl,
    webDiscoveryEnabled,
    webDiscoveryProvider,
    searxngBaseUrl,
    firecrawlEnabled,
    llmHealth,
    apiHealth,
    searxngHealth,
    profiles,
    authProfilesError: parsedProfiles.error,
    relevantProfiles,
    sessionStates,
    issues,
    blockingIssues,
    optionalIssues,
    recommendedNextAction: buildRecommendedNextAction({
      issues,
      localBackendSupportAvailable: localBackendSupport.available,
      sessionStates,
      llmProvider,
      stagehandMode
    })
  };
}

async function runSetupPromptFallback(cwd = process.cwd()): Promise<{
  assessment: SetupAssessment;
  backendStart: StartedBackendServices | null;
}> {
  const env = process.env;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const localBackendSupport = resolveLocalBackendSupport(cwd);
  const defaults = resolveSetupWizardDefaults(env);
  const llmBaseUrl = await clack.text({
    message: "OpenAI-compatible LLM base URL (for example LM Studio or https://integrate.api.nvidia.com/v1)",
    initialValue: defaults.llmBaseUrl,
    validate(input) {
      return input.trim().length === 0 ? "An OpenAI-compatible LLM URL is required." : undefined;
    }
  });
  if (clack.isCancel(llmBaseUrl)) throw new Error("Setup cancelled.");

  const llmApiKey = await clack.text({
    message: "LLM API key (skip for local LM Studio)",
    initialValue: defaults.llmApiKey,
    placeholder: "lm-studio"
  });
  if (clack.isCancel(llmApiKey)) throw new Error("Setup cancelled.");

  const llmModel = await clack.text({
    message: "OpenAI-compatible LLM model",
    initialValue: defaults.llmModel,
    validate(input) {
      return input.trim().length === 0 ? "A model ID is required." : undefined;
    }
  });
  if (clack.isCancel(llmModel)) throw new Error("Setup cancelled.");

  const stagehandMode = await clack.select({
    message: "Stagehand mode",
    initialValue: defaults.stagehandMode,
    options: [
      {
        value: "DISABLED" as const,
        label: "Disabled",
        hint: "use plain Playwright only"
      },
      {
        value: "LOCAL" as const,
        label: "Local",
        hint: "run Stagehand locally against the configured OpenAI-compatible LLM"
      },
      {
        value: "BROWSERBASE" as const,
        label: "Browserbase",
        hint: "run Stagehand through Browserbase SaaS"
      }
    ]
  });
  if (clack.isCancel(stagehandMode)) throw new Error("Setup cancelled.");

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

  clack.log.message(
    "Expanded discovery sources add Artsy, MutualArt, and askART to widen coverage beyond the lean default path."
  );
  clack.log.message("Recommended if you want broader market coverage.");
  const enableOptionalProbes = await clack.confirm({
    message: "Enable expanded discovery sources?",
    initialValue: parseBooleanEnv(env.ENABLE_OPTIONAL_PROBE_ADAPTERS, false)
  });
  if (clack.isCancel(enableOptionalProbes)) throw new Error("Setup cancelled.");

  clack.log.message(
    "Account or license-backed sources include Sanatfiyat and only help if you already have lawful access, a subscription, or a license."
  );
  clack.log.message("This does not sign you in automatically. You still need to capture sessions or configure credentials later.");
  const enableLicensedIntegrations = await clack.confirm({
    message: "Enable account or license-backed sources?",
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
    llmApiKey: resolveOpenAiCompatibleApiKey(
      {
        LLM_API_KEY: llmApiKey.trim()
      } as NodeJS.ProcessEnv
    ),
    llmModel: llmModel.trim(),
    stagehandMode: normalizeStagehandMode(stagehandMode),
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

function supportsInkSetupOnboarding(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.ARTBOT_NO_TUI);
}

export async function runSetupWizard(cwd = process.cwd()): Promise<{
  assessment: SetupAssessment;
  backendStart: StartedBackendServices | null;
}> {
  if (!supportsInkSetupOnboarding()) {
    return runSetupPromptFallback(cwd);
  }

  const env = process.env;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const localBackendSupport = resolveLocalBackendSupport(cwd);
  const defaults = resolveSetupWizardDefaults(env);
  const preferences = loadTuiPreferences(env);
  const initialAssessment = await assessLocalSetup(env, workspaceRoot);
  const onboarding = await runInkSetupOnboarding({
    assessment: initialAssessment,
    defaults,
    initialLanguage: normalizeAppLocale(preferences.language)
  });

  if (!onboarding) {
    throw new Error("Setup cancelled.");
  }

  const values: SetupWizardValues = {
    ...onboarding.values,
    defaultLicensedIntegrations: onboarding.values.enableLicensedIntegrations ? ["Sanatfiyat"] : [],
    authProfiles: buildDefaultAuthProfiles({
      cwd: workspaceRoot,
      enableOptionalProbes: onboarding.values.enableOptionalProbes,
      enableLicensedIntegrations: onboarding.values.enableLicensedIntegrations
    })
  };

  saveTuiPreferences({
    ...preferences,
    language: onboarding.language
  }, env);

  const envPath = resolveEnvFilePath(workspaceRoot);
  const envUpdates = buildSetupEnvUpdates(values);
  if (onboarding.runtimeMode === "local" && localBackendSupport.mode === "bundled") {
    const runtimePaths = ensureLocalRuntimePaths();
    envUpdates.DATABASE_PATH = runtimePaths.dbPath;
    envUpdates.RUNS_ROOT = runtimePaths.runsRoot;
  }
  upsertEnvFile(envPath, envUpdates);
  applyEnvUpdates(process.env, envUpdates);

  let backendStart: StartedBackendServices | null = null;
  if (onboarding.runtimeMode === "local" && localBackendSupport.available) {
    const apiHealth = await checkApiHealth(values.apiBaseUrl, process.env.ARTBOT_API_KEY);
    if (!apiHealth.ok) {
      backendStart = await startLocalBackendServices(workspaceRoot, values.apiBaseUrl);
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
  const llmBaseUrl = normalizeLlmBaseUrl(env.LLM_BASE_URL?.trim() || LM_STUDIO_BASE_URL);
  return {
    llmBaseUrl,
    llmApiKey: resolveSetupDefaultApiKey(env, llmBaseUrl),
    llmModel: resolveSetupDefaultModel(env, llmBaseUrl),
    stagehandMode: env.STAGEHAND_MODE?.trim() ? normalizeStagehandMode(env.STAGEHAND_MODE) : "LOCAL",
    apiBaseUrl: env.API_BASE_URL?.trim() || "http://localhost:4000",
    enableOptionalProbes,
    enableLicensedIntegrations,
    reportSurface: normalizeReportSurface(env.DEFAULT_REPORT_SURFACE?.trim()),
    defaultLicensedIntegrations: parseCommaSeparatedEnv(env.DEFAULT_LICENSED_INTEGRATIONS),
    authProfiles: parseAuthProfilesJson(env.AUTH_PROFILES_JSON).profiles
  };
}
