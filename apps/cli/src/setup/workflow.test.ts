import { describe, expect, it } from "vitest";
import { resolveSetupWizardDefaults } from "./workflow.js";

describe("setup wizard defaults", () => {
  it("prefers canonical LLM settings when present", () => {
    const defaults = resolveSetupWizardDefaults({
      LLM_BASE_URL: "https://integrate.api.nvidia.com/v1",
      LLM_API_KEY: "nvidia-key",
      LLM_MODEL: "minimaxai/minimax-m2.7",
      MODEL_CHEAP_DEFAULT: "legacy-model",
      STAGEHAND_MODE: "LOCAL",
      AUTH_PROFILES_JSON: "[]"
    });

    expect(defaults.llmBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(defaults.llmApiKey).toBe("nvidia-key");
    expect(defaults.llmModel).toBe("minimaxai/minimax-m2.7");
    expect(defaults.stagehandMode).toBe("LOCAL");
  });

  it("falls back to legacy model settings and disabled stagehand", () => {
    const defaults = resolveSetupWizardDefaults({
      MODEL_CHEAP_DEFAULT: "google/gemma-4-26b-a4b",
      AUTH_PROFILES_JSON: "[]"
    });

    expect(defaults.llmApiKey).toBe("lm-studio");
    expect(defaults.llmModel).toBe("google/gemma-4-26b-a4b");
    expect(defaults.stagehandMode).toBe("LOCAL");
  });

  it("uses the NVIDIA default model when the NVIDIA endpoint is configured without a model", () => {
    const defaults = resolveSetupWizardDefaults({
      LLM_BASE_URL: "https://integrate.api.nvidia.com/v1",
      AUTH_PROFILES_JSON: "[]"
    });

    expect(defaults.llmApiKey).toBe("");
    expect(defaults.llmModel).toBe("minimaxai/minimax-m2.7");
    expect(defaults.stagehandMode).toBe("LOCAL");
  });
});
