import { describe, expect, it } from "vitest";
import { buildOnboardingExplainer, type OnboardingDraft } from "./onboarding-state.js";
import {
  applyFocusedChoice,
  buildOnboardingRows,
  buildRowPrefix,
  getCommittedChoiceRow,
  getDefaultFocusedRowForStep
} from "./onboarding.js";

function buildDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    language: "en",
    providerPreset: "nvidia",
    llmBaseUrl: "https://integrate.api.nvidia.com/v1",
    llmApiKey: "",
    llmModel: "minimaxai/minimax-m2.7",
    stagehandMode: "LOCAL",
    runtimeMode: "local",
    apiBaseUrl: "http://127.0.0.1:4000",
    enableOptionalProbes: true,
    enableLicensedIntegrations: false,
    reportSurface: "ask",
    ...overrides
  };
}

describe("setup onboarding interactions", () => {
  it("keeps the committed language choice separate from the moving focus", () => {
    const draft = buildDraft({ language: "en" });
    const rows = buildOnboardingRows("language", "en", draft, 1);

    expect(getCommittedChoiceRow("language", draft)).toBe(0);
    expect(rows[0]).toMatchObject({
      id: "language-en",
      chosen: true,
      focused: false
    });
    expect(rows[1]).toMatchObject({
      id: "language-tr",
      chosen: false,
      focused: true
    });
  });

  it("auto-advances simple choice steps by applying the focused selection", () => {
    const languageDraft = applyFocusedChoice("language", 1, buildDraft({ language: "en" }));
    const runtimeDraft = applyFocusedChoice("runtime", 1, buildDraft({ runtimeMode: "local" }));

    expect(languageDraft.language).toBe("tr");
    expect(runtimeDraft.runtimeMode).toBe("remote");
  });

  it("returns focus to the committed choice when revisiting simple steps", () => {
    expect(getDefaultFocusedRowForStep("language", buildDraft({ language: "tr" }))).toBe(1);
    expect(getDefaultFocusedRowForStep("runtime", buildDraft({ runtimeMode: "remote" }))).toBe(1);
  });

  it("never renders committed-choice markers for action rows", () => {
    expect(buildRowPrefix("action", false, true)).toBe(" ");
    expect(buildRowPrefix("action", true, true)).toBe(">");
  });

  it("preserves current provider and model values in configuration rows", () => {
    const draft = buildDraft({
      providerPreset: "custom",
      llmBaseUrl: "https://example.com/v1",
      llmApiKey: "secret-token",
      llmModel: "custom/model"
    });
    const rows = buildOnboardingRows("llm", "en", draft, 3);

    expect(rows[0]).toMatchObject({
      id: "provider",
      value: "Custom OpenAI-compatible endpoint"
    });
    expect(rows[1]).toMatchObject({
      id: "llmBaseUrl",
      value: "https://example.com/v1"
    });
    expect(rows[2]).toMatchObject({
      id: "llmApiKey",
      value: "configured (hidden)",
      secret: true
    });
    expect(rows[3]).toMatchObject({
      id: "llmModel",
      value: "custom/model",
      focused: true
    });
  });

  it("builds inline explainers for discovery and licensed-source choices", () => {
    expect(buildOnboardingExplainer("en", "discovery", "optionalProbes")).toMatchObject({
      title: "Expanded discovery sources"
    });
    expect(buildOnboardingExplainer("en", "auth", "licensed")).toMatchObject({
      title: "Account or license-backed sources"
    });
  });
});
