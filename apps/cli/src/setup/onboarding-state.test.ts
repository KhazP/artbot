import { describe, expect, it } from "vitest";
import {
  applyProviderPreset,
  buildOnboardingDraft,
  buildOnboardingReviewItems,
  inferProviderPreset,
  maskSecretValue,
  validateOnboardingDraft
} from "./onboarding-state.js";

describe("setup onboarding state", () => {
  it("infers NVIDIA presets from the configured base URL", () => {
    expect(inferProviderPreset("https://integrate.api.nvidia.com/v1")).toBe("nvidia");
    expect(inferProviderPreset("http://127.0.0.1:1234/v1")).toBe("lm_studio");
    expect(inferProviderPreset("https://example.com/v1")).toBe("custom");
  });

  it("builds a draft from setup defaults and persisted preferences", () => {
    const draft = buildOnboardingDraft({
      assessment: {
        localBackendAvailable: true
      } as never,
      defaults: {
        llmBaseUrl: "https://integrate.api.nvidia.com/v1",
        llmApiKey: "nvidia-key",
        llmModel: "minimaxai/minimax-m2.7",
        stagehandMode: "LOCAL",
        apiBaseUrl: "http://localhost:4000",
        enableOptionalProbes: true,
        enableLicensedIntegrations: false,
        reportSurface: "cli",
        defaultLicensedIntegrations: [],
        authProfiles: []
      },
      preferences: {
        language: "tr",
        theme: "artbot",
        density: "compact",
        showSecondaryPane: true,
        diffLayout: "auto",
        experimental: {
          enabled: false,
          plannerModel: "gemini-pro-latest",
          researchMode: "deep_research_max",
          warnOnRun: true,
          spendCapReminderUsd: 20,
          openFullReportAfterRun: true
        }
      }
    });

    expect(draft.language).toBe("tr");
    expect(draft.providerPreset).toBe("nvidia");
    expect(draft.runtimeMode).toBe("local");
  });

  it("rewrites related NVIDIA settings when the preset changes", () => {
    const next = applyProviderPreset("nvidia", {
      llmBaseUrl: "http://127.0.0.1:1234/v1",
      llmApiKey: "lm-studio",
      llmModel: "old-model",
      stagehandMode: "DISABLED"
    });

    expect(next.llmBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(next.llmApiKey).toBe("");
    expect(next.llmModel).toBe("minimaxai/minimax-m2.7");
    expect(next.stagehandMode).toBe("LOCAL");
  });

  it("validates the required onboarding fields", () => {
    expect(
      validateOnboardingDraft({
        language: "en",
        providerPreset: "custom",
        llmBaseUrl: "",
        llmApiKey: "",
        llmModel: "foo",
        stagehandMode: "DISABLED",
        runtimeMode: "remote",
        apiBaseUrl: "http://localhost:4000",
        enableOptionalProbes: false,
        enableLicensedIntegrations: false,
        reportSurface: "ask"
      })
    ).toBe("base_url_required");
  });

  it("masks API keys in onboarding display and review state", () => {
    expect(maskSecretValue("")).toBe("-");
    expect(maskSecretValue("lm-studio")).toBe("not required for local LM Studio");
    expect(maskSecretValue("secret-token")).toBe("configured (hidden)");

    const items = buildOnboardingReviewItems({
      language: "en",
      providerPreset: "custom",
      llmBaseUrl: "https://example.com/v1",
      llmApiKey: "secret-token",
      llmModel: "foo",
      stagehandMode: "LOCAL",
      runtimeMode: "remote",
      apiBaseUrl: "http://localhost:4000",
      enableOptionalProbes: false,
      enableLicensedIntegrations: false,
      reportSurface: "ask"
    });

    expect(items).toContainEqual({ label: "API key", value: "configured (hidden)" });
    expect(items).not.toContainEqual({ label: "API key", value: "secret-token" });
  });
});
