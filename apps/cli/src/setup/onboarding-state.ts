import { normalizeStagehandMode, type StagehandMode } from "@artbot/shared-types";
import { normalizeAppLocale, translate, type AppLocale } from "../i18n.js";
import type { TuiPreferences } from "../tui/preferences.js";
import type { SetupAssessment, SetupWizardValues } from "./types.js";

export const ONBOARDING_PROVIDER_PRESETS = ["lm_studio", "nvidia", "custom"] as const;
export type OnboardingProviderPreset = (typeof ONBOARDING_PROVIDER_PRESETS)[number];
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_LM_STUDIO_MODEL = "google/gemma-4-26b-a4b";
export const DEFAULT_NVIDIA_MODEL = "minimaxai/minimax-m2.7";
export const DEFAULT_STAGEHAND_MODE: StagehandMode = "LOCAL";
export const NVIDIA_MODEL_CATALOG_URL = "https://build.nvidia.com/models?filters=nimType%3Anim_type_preview";

export const ONBOARDING_RUNTIME_MODES = ["local", "remote"] as const;
export type OnboardingRuntimeMode = (typeof ONBOARDING_RUNTIME_MODES)[number];

export interface OnboardingDraft {
  language: AppLocale;
  providerPreset: OnboardingProviderPreset;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  stagehandMode: StagehandMode;
  runtimeMode: OnboardingRuntimeMode;
  apiBaseUrl: string;
  enableOptionalProbes: boolean;
  enableLicensedIntegrations: boolean;
  reportSurface: SetupWizardValues["reportSurface"];
}

export interface OnboardingReviewItem {
  label: string;
  value: string;
}

export interface OnboardingExplainer {
  title: string;
  summary: string;
  recommendation?: string;
  details?: string;
}

export function inferProviderPreset(baseUrl: string): OnboardingProviderPreset {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) {
    return "lm_studio";
  }
  if (normalized.includes("integrate.api.nvidia.com")) {
    return "nvidia";
  }
  if (normalized.includes("127.0.0.1:1234") || normalized.includes("localhost:1234")) {
    return "lm_studio";
  }
  return "custom";
}

export function applyProviderPreset(
  preset: OnboardingProviderPreset,
  current: Pick<OnboardingDraft, "llmBaseUrl" | "llmApiKey" | "llmModel" | "stagehandMode">
): Pick<OnboardingDraft, "providerPreset" | "llmBaseUrl" | "llmApiKey" | "llmModel" | "stagehandMode"> {
  switch (preset) {
    case "nvidia":
      return {
        providerPreset: preset,
        llmBaseUrl: NVIDIA_BASE_URL,
        llmApiKey: current.llmApiKey === "lm-studio" ? "" : current.llmApiKey,
        llmModel: DEFAULT_NVIDIA_MODEL,
        stagehandMode: "LOCAL"
      };
    case "custom":
      return {
        providerPreset: preset,
        llmBaseUrl: inferProviderPreset(current.llmBaseUrl) === "custom" ? current.llmBaseUrl : "",
        llmApiKey: current.llmApiKey === "lm-studio" ? "" : current.llmApiKey,
        llmModel: current.llmModel,
        stagehandMode: current.stagehandMode === "BROWSERBASE" ? "BROWSERBASE" : "LOCAL"
      };
    default:
      return {
        providerPreset: preset,
        llmBaseUrl: LM_STUDIO_BASE_URL,
        llmApiKey: "lm-studio",
        llmModel: DEFAULT_LM_STUDIO_MODEL,
        stagehandMode: "LOCAL"
      };
  }
}

export function buildOnboardingDraft(options: {
  assessment?: SetupAssessment | null;
  defaults: SetupWizardValues;
  preferences: TuiPreferences;
}): OnboardingDraft {
  const providerPreset = inferProviderPreset(options.defaults.llmBaseUrl);
  const presetDefaults = applyProviderPreset(providerPreset, {
    llmBaseUrl: options.defaults.llmBaseUrl,
    llmApiKey: options.defaults.llmApiKey,
    llmModel: options.defaults.llmModel,
    stagehandMode: options.defaults.stagehandMode
  });
  return {
    language: normalizeAppLocale(options.preferences.language),
    providerPreset,
    llmBaseUrl: options.defaults.llmBaseUrl || presetDefaults.llmBaseUrl,
    llmApiKey:
      providerPreset === "nvidia" && options.defaults.llmApiKey === "lm-studio"
        ? presetDefaults.llmApiKey
        : (options.defaults.llmApiKey || presetDefaults.llmApiKey),
    llmModel: options.defaults.llmModel || presetDefaults.llmModel,
    stagehandMode:
      options.defaults.stagehandMode === "DISABLED"
        ? presetDefaults.stagehandMode
        : normalizeStagehandMode(options.defaults.stagehandMode),
    runtimeMode: options.assessment?.localBackendAvailable ? "local" : "remote",
    apiBaseUrl: options.defaults.apiBaseUrl,
    enableOptionalProbes: options.defaults.enableOptionalProbes,
    enableLicensedIntegrations: options.defaults.enableLicensedIntegrations,
    reportSurface: options.defaults.reportSurface
  };
}

export function validateOnboardingDraft(draft: OnboardingDraft): string | null {
  if (!draft.llmBaseUrl.trim()) {
    return "base_url_required";
  }
  if (!draft.llmModel.trim()) {
    return "model_required";
  }
  if (!draft.apiBaseUrl.trim()) {
    return "api_base_url_required";
  }
  return null;
}

export function maskSecretValue(value: string): string {
  if (!value.trim()) {
    return "-";
  }

  if (value === "lm-studio") {
    return "not required for local LM Studio";
  }

  return "configured (hidden)";
}

export function buildOnboardingReviewItems(draft: OnboardingDraft): OnboardingReviewItem[] {
  return [
    { label: "Language", value: draft.language },
    { label: "LLM preset", value: draft.providerPreset },
    { label: "Base URL", value: draft.llmBaseUrl },
    { label: "API key", value: maskSecretValue(draft.llmApiKey) },
    { label: "Model", value: draft.llmModel },
    { label: "Stagehand", value: draft.stagehandMode },
    { label: "Backend mode", value: draft.runtimeMode },
    { label: "API base URL", value: draft.apiBaseUrl },
    { label: "Optional probes", value: draft.enableOptionalProbes ? "enabled" : "disabled" },
    { label: "Licensed integrations", value: draft.enableLicensedIntegrations ? "enabled" : "disabled" },
    { label: "Report surface", value: draft.reportSurface }
  ];
}

export function buildOnboardingExplainer(
  locale: AppLocale,
  step: "discovery" | "auth",
  rowId: string | undefined
): OnboardingExplainer | null {
  if (step === "discovery" && rowId === "optionalProbes") {
    return {
      title: translate(locale, "onboarding.explainer.discovery.title"),
      summary: translate(locale, "onboarding.explainer.discovery.summary"),
      recommendation: translate(locale, "onboarding.explainer.discovery.recommendation"),
      details: translate(locale, "onboarding.explainer.discovery.details")
    };
  }

  if (step === "discovery" && rowId === "reportSurface") {
    return {
      title: translate(locale, "onboarding.explainer.reportSurface.title"),
      summary: translate(locale, "onboarding.explainer.reportSurface.summary"),
      recommendation: translate(locale, "onboarding.explainer.reportSurface.recommendation"),
      details: translate(locale, "onboarding.explainer.reportSurface.details")
    };
  }

  if (step === "auth" && rowId === "licensed") {
    return {
      title: translate(locale, "onboarding.explainer.licensed.title"),
      summary: translate(locale, "onboarding.explainer.licensed.summary"),
      recommendation: translate(locale, "onboarding.explainer.licensed.recommendation"),
      details: translate(locale, "onboarding.explainer.licensed.details")
    };
  }

  return null;
}
