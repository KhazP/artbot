import { spawn } from "node:child_process";
import React, { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { StagehandMode } from "@artbot/shared-types";
import { translate, type AppLocale } from "../i18n.js";
import {
  NVIDIA_MODEL_CATALOG_URL,
  ONBOARDING_PROVIDER_PRESETS,
  applyProviderPreset,
  buildOnboardingDraft,
  buildOnboardingExplainer,
  buildOnboardingReviewItems,
  validateOnboardingDraft,
  type OnboardingRuntimeMode,
  type OnboardingDraft,
  type OnboardingProviderPreset,
  type OnboardingExplainer
} from "./onboarding-state.js";
import type { SetupAssessment, SetupWizardValues } from "./types.js";

export interface InkOnboardingResult {
  language: AppLocale;
  runtimeMode: OnboardingRuntimeMode;
  values: Omit<SetupWizardValues, "defaultLicensedIntegrations" | "authProfiles">;
}

interface RunInkOnboardingOptions {
  assessment: SetupAssessment | null;
  defaults: SetupWizardValues;
  initialLanguage: AppLocale;
}

type StepId = "language" | "runtime" | "llm" | "backend" | "discovery" | "auth" | "review";
type KeyboardInput = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
};

export const STEP_ORDER: StepId[] = ["language", "runtime", "llm", "backend", "discovery", "auth", "review"];
const STAGEHAND_OPTIONS: StagehandMode[] = ["DISABLED", "LOCAL", "BROWSERBASE"];
const REPORT_OPTIONS: Array<SetupWizardValues["reportSurface"]> = ["ask", "cli", "web"];
type OnboardingRowKind = "choice" | "action" | "field";
type EditableField = "llmBaseUrl" | "llmApiKey" | "llmModel" | "apiBaseUrl";

export interface OnboardingRowDescriptor {
  id: string;
  kind: OnboardingRowKind;
  label: string;
  value?: string;
  focused: boolean;
  chosen: boolean;
  field?: EditableField;
}

function buildExternalOpenCommand(target: string, platform = process.platform): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [target] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", target] };
  }

  return { command: "xdg-open", args: [target] };
}

async function openExternalUrl(target: string): Promise<void> {
  const { command, args } = buildExternalOpenCommand(target);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Open command exited with code ${code ?? "unknown"}`));
    });
  });
}

function cycle<T>(items: readonly T[], current: T, delta = 1): T {
  const index = items.indexOf(current);
  const nextIndex = (index + delta + items.length) % items.length;
  return items[nextIndex] ?? items[0];
}

function languageLabel(locale: AppLocale, value: AppLocale): string {
  return translate(locale, value === "tr" ? "tui.language.turkish" : "tui.language.english");
}

function providerLabel(locale: AppLocale, value: OnboardingProviderPreset): string {
  if (value === "nvidia") return translate(locale, "onboarding.provider.nvidia");
  if (value === "custom") return translate(locale, "onboarding.provider.custom");
  return translate(locale, "onboarding.provider.lmStudio");
}

function stepLabel(locale: AppLocale, step: StepId): string {
  return translate(locale, `onboarding.step.${step}` as const);
}

function stagehandLabel(value: StagehandMode): string {
  return value;
}

function reportSurfaceLabel(value: SetupWizardValues["reportSurface"]): string {
  if (value === "web") {
    return "Web";
  }
  if (value === "cli") {
    return "CLI";
  }
  return "Ask";
}

export function isAutoAdvanceChoiceStep(step: StepId): step is "language" | "runtime" {
  return step === "language" || step === "runtime";
}

export function getCommittedChoiceRow(step: StepId, draft: Pick<OnboardingDraft, "language" | "runtimeMode">): number | null {
  if (step === "language") {
    return draft.language === "tr" ? 1 : 0;
  }

  if (step === "runtime") {
    return draft.runtimeMode === "remote" ? 1 : 0;
  }

  return null;
}

export function getDefaultFocusedRowForStep(step: StepId, draft: Pick<OnboardingDraft, "language" | "runtimeMode">): number {
  return getCommittedChoiceRow(step, draft) ?? 0;
}

export function applyFocusedChoice(step: "language" | "runtime", focusedRow: number, draft: OnboardingDraft): OnboardingDraft {
  if (step === "language") {
    return {
      ...draft,
      language: focusedRow === 1 ? "tr" : "en"
    };
  }

  return {
    ...draft,
    runtimeMode: focusedRow === 1 ? "remote" : "local"
  };
}

export function buildRowPrefix(kind: OnboardingRowKind, focused: boolean, chosen: boolean): string {
  if (kind === "choice") {
    return `${focused ? ">" : " "} ${chosen ? "●" : "○"}`;
  }

  return focused ? ">" : " ";
}

export function buildOnboardingRows(
  step: StepId,
  locale: AppLocale,
  draft: OnboardingDraft,
  focusedRow: number
): OnboardingRowDescriptor[] {
  const choiceRow = getCommittedChoiceRow(step, draft);
  const isFocused = (rowIndex: number) => focusedRow === rowIndex;

  if (step === "language") {
    return [
      {
        id: "language-en",
        kind: "choice",
        label: languageLabel(locale, "en"),
        focused: isFocused(0),
        chosen: choiceRow === 0
      },
      {
        id: "language-tr",
        kind: "choice",
        label: languageLabel(locale, "tr"),
        focused: isFocused(1),
        chosen: choiceRow === 1
      }
    ];
  }

  if (step === "runtime") {
    return [
      {
        id: "runtime-local",
        kind: "choice",
        label: translate(locale, "onboarding.runtime.local"),
        focused: isFocused(0),
        chosen: choiceRow === 0
      },
      {
        id: "runtime-remote",
        kind: "choice",
        label: translate(locale, "onboarding.runtime.remote"),
        focused: isFocused(1),
        chosen: choiceRow === 1
      }
    ];
  }

  if (step === "llm") {
    return [
      {
        id: "provider",
        kind: "field",
        label: translate(locale, "onboarding.field.provider"),
        value: providerLabel(locale, draft.providerPreset),
        focused: isFocused(0),
        chosen: false
      },
      {
        id: "llmBaseUrl",
        kind: "field",
        label: translate(locale, "onboarding.field.baseUrl"),
        value: draft.llmBaseUrl || "-",
        focused: isFocused(1),
        chosen: false,
        field: "llmBaseUrl"
      },
      {
        id: "llmApiKey",
        kind: "field",
        label: translate(locale, "onboarding.field.apiKey"),
        value: draft.llmApiKey || "-",
        focused: isFocused(2),
        chosen: false,
        field: "llmApiKey"
      },
      {
        id: "llmModel",
        kind: "field",
        label: translate(locale, "onboarding.field.model"),
        value: draft.llmModel || "-",
        focused: isFocused(3),
        chosen: false,
        field: "llmModel"
      },
      {
        id: "browseModels",
        kind: "action",
        label: `${translate(locale, "onboarding.field.browseModels")}: ${NVIDIA_MODEL_CATALOG_URL}`,
        focused: isFocused(4),
        chosen: false
      },
      {
        id: "stagehand",
        kind: "field",
        label: translate(locale, "onboarding.field.stagehand"),
        value: stagehandLabel(draft.stagehandMode),
        focused: isFocused(5),
        chosen: false
      },
      {
        id: "continue",
        kind: "action",
        label: translate(locale, "onboarding.action.continue"),
        focused: isFocused(6),
        chosen: false
      }
    ];
  }

  if (step === "backend") {
    return [
      {
        id: "apiMode",
        kind: "field",
        label: translate(locale, "onboarding.field.apiMode"),
        value: draft.runtimeMode,
        focused: isFocused(0),
        chosen: false
      },
      {
        id: "apiBaseUrl",
        kind: "field",
        label: translate(locale, "onboarding.field.apiBaseUrl"),
        value: draft.apiBaseUrl || "-",
        focused: isFocused(1),
        chosen: false,
        field: "apiBaseUrl"
      },
      {
        id: "continue",
        kind: "action",
        label: translate(locale, "onboarding.action.continue"),
        focused: isFocused(2),
        chosen: false
      }
    ];
  }

  if (step === "discovery") {
    return [
      {
        id: "optionalProbes",
        kind: "field",
        label: translate(locale, "onboarding.field.optionalProbes"),
        value: draft.enableOptionalProbes ? "on" : "off",
        focused: isFocused(0),
        chosen: false
      },
      {
        id: "reportSurface",
        kind: "field",
        label: translate(locale, "onboarding.field.reportSurface"),
        value: reportSurfaceLabel(draft.reportSurface),
        focused: isFocused(1),
        chosen: false
      },
      {
        id: "continue",
        kind: "action",
        label: translate(locale, "onboarding.action.continue"),
        focused: isFocused(2),
        chosen: false
      }
    ];
  }

  if (step === "auth") {
    return [
      {
        id: "licensed",
        kind: "field",
        label: translate(locale, "onboarding.field.licensed"),
        value: draft.enableLicensedIntegrations ? "on" : "off",
        focused: isFocused(0),
        chosen: false
      },
      {
        id: "continue",
        kind: "action",
        label: translate(locale, "onboarding.action.continue"),
        focused: isFocused(1),
        chosen: false
      }
    ];
  }

  return [
    {
      id: "apply",
      kind: "action",
      label: translate(locale, "onboarding.action.apply"),
      focused: isFocused(0),
      chosen: false
    }
  ];
}

function buildResult(draft: OnboardingDraft): InkOnboardingResult {
  return {
    language: draft.language,
    runtimeMode: draft.runtimeMode,
    values: {
      llmBaseUrl: draft.llmBaseUrl,
      llmApiKey: draft.llmApiKey,
      llmModel: draft.llmModel,
      stagehandMode: draft.stagehandMode,
      apiBaseUrl: draft.apiBaseUrl,
      enableOptionalProbes: draft.enableOptionalProbes,
      enableLicensedIntegrations: draft.enableLicensedIntegrations,
      reportSurface: draft.reportSurface
    }
  };
}

function InkSetupOnboarding(props: {
  assessment: SetupAssessment | null;
  defaults: SetupWizardValues;
  initialLanguage: AppLocale;
  onSubmit: (result: InkOnboardingResult) => void;
  onCancel: () => void;
}) {
  const { exit } = useApp();
  const [draft, setDraft] = useState(() =>
    buildOnboardingDraft({
      assessment: props.assessment,
      defaults: {
        ...props.defaults,
        llmApiKey: props.defaults.llmApiKey,
        llmModel: props.defaults.llmModel,
        stagehandMode: props.defaults.stagehandMode
      },
      preferences: {
        language: props.initialLanguage,
        theme: "artbot",
        density: "comfortable",
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
    })
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [focusedRow, setFocusedRow] = useState(0);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState("");
  const [showExplainerDetails, setShowExplainerDetails] = useState(false);

  const locale = draft.language;
  const step = STEP_ORDER[stepIndex] ?? "language";
  const reviewItems = useMemo(() => buildOnboardingReviewItems(draft), [draft]);
  const rows = useMemo(() => buildOnboardingRows(step, locale, draft, focusedRow), [step, locale, draft, focusedRow]);
  const activeRow = rows[focusedRow];
  const activeExplainer = useMemo<OnboardingExplainer | null>(() => {
    if (step !== "discovery" && step !== "auth") {
      return null;
    }
    return buildOnboardingExplainer(locale, step, activeRow?.id);
  }, [activeRow?.id, locale, step]);

  const beginEdit = (field: EditableField) => {
    setEditingField(field);
    setEditValue(draft[field]);
  };

  const commitEdit = () => {
    if (!editingField) return;
    setDraft((current) => ({
      ...current,
      [editingField]: editValue
    }));
    setEditingField(null);
    setEditValue("");
  };

  const moveStep = (delta: number, nextDraft: OnboardingDraft = draft) => {
    const nextIndex = Math.max(0, Math.min(STEP_ORDER.length - 1, stepIndex + delta));
    const nextStep = STEP_ORDER[nextIndex] ?? "language";
    setStepIndex(nextIndex);
    setFocusedRow(getDefaultFocusedRowForStep(nextStep, nextDraft));
    setEditingField(null);
    setEditValue("");
    setShowExplainerDetails(false);
    setMessage("");
  };

  const submit = () => {
    const validation = validateOnboardingDraft(draft);
    if (validation) {
      const validationKey =
        validation === "model_required"
          ? "onboarding.validation.modelRequired"
          : validation === "api_base_url_required"
            ? "onboarding.validation.apiBaseUrlRequired"
            : "onboarding.validation.baseUrlRequired";
      setMessage(
        translate(locale, validationKey)
      );
      return;
    }
    props.onSubmit(buildResult(draft));
    exit();
  };

  useInput((value: string, key: KeyboardInput) => {
    if (key.ctrl && value === "c") {
      props.onCancel();
      exit();
      return;
    }

    if (editingField) {
      if (key.escape) {
        setEditingField(null);
        setEditValue("");
      }
      return;
    }

    if (key.leftArrow) {
      moveStep(-1);
      return;
    }

    if (key.rightArrow) {
      moveStep(1);
      return;
    }

    if (key.upArrow || key.downArrow) {
      setFocusedRow((current) => Math.max(0, Math.min(current + (key.upArrow ? -1 : 1), rows.length - 1)));
      setShowExplainerDetails(false);
      return;
    }

    if (value.toLowerCase() === "i" && activeExplainer) {
      setShowExplainerDetails((current) => !current);
      return;
    }

    if (!key.return) {
      return;
    }

    if (isAutoAdvanceChoiceStep(step)) {
      const nextDraft = applyFocusedChoice(step, focusedRow, draft);
      setDraft(nextDraft);
      moveStep(1, nextDraft);
      return;
    }

    const activeRowId = activeRow?.id;

    if (step === "llm") {
      if (activeRowId === "provider") {
        setDraft((current) => ({
          ...current,
          ...applyProviderPreset(cycle(ONBOARDING_PROVIDER_PRESETS, current.providerPreset), current)
        }));
      } else if (activeRowId === "llmBaseUrl") {
        beginEdit("llmBaseUrl");
      } else if (activeRowId === "llmApiKey") {
        beginEdit("llmApiKey");
      } else if (activeRowId === "llmModel") {
        beginEdit("llmModel");
      } else if (activeRowId === "browseModels") {
        void openExternalUrl(NVIDIA_MODEL_CATALOG_URL)
          .then(() => setMessage(translate(locale, "onboarding.message.modelsOpened")))
          .catch(() =>
            setMessage(translate(locale, "onboarding.message.modelsOpenFailed", { url: NVIDIA_MODEL_CATALOG_URL }))
          );
      } else if (activeRowId === "stagehand") {
        setDraft((current) => ({ ...current, stagehandMode: cycle(STAGEHAND_OPTIONS, current.stagehandMode) }));
      } else {
        moveStep(1);
      }
      return;
    }

    if (step === "backend") {
      if (activeRowId === "apiMode") {
        setDraft((current) => ({ ...current, runtimeMode: cycle(["local", "remote"], current.runtimeMode) }));
      } else if (activeRowId === "apiBaseUrl") {
        beginEdit("apiBaseUrl");
      } else {
        moveStep(1);
      }
      return;
    }

    if (step === "discovery") {
      if (activeRowId === "optionalProbes") {
        setDraft((current) => ({ ...current, enableOptionalProbes: !current.enableOptionalProbes }));
      } else if (activeRowId === "reportSurface") {
        setDraft((current) => ({ ...current, reportSurface: cycle(REPORT_OPTIONS, current.reportSurface) }));
      } else {
        moveStep(1);
      }
      return;
    }

    if (step === "auth") {
      if (activeRowId === "licensed") {
        setDraft((current) => ({ ...current, enableLicensedIntegrations: !current.enableLicensedIntegrations }));
      } else {
        moveStep(1);
      }
      return;
    }

    submit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text bold>{translate(locale, "cli.onboarding.title")}</Text>
        <Text dimColor>{translate(locale, "cli.onboarding.subtitle")}</Text>
        <Box marginTop={1} flexWrap="wrap">
          {STEP_ORDER.map((entry, index) => (
            <Box key={entry} marginRight={1}>
              <Text color={index === stepIndex ? "cyan" : "gray"}>
                {index + 1}. {stepLabel(locale, entry)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" paddingX={1} flexDirection="column">
        <Text bold>{stepLabel(locale, step)}</Text>
        {step === "review" ? (
          <>
            <Text>{translate(locale, "onboarding.review.applySummary")}</Text>
            <Box marginTop={1} flexDirection="column">
              {reviewItems.map((item) => (
                <Text key={item.label}>
                  {item.label}: <Text color="cyan">{item.value}</Text>
                </Text>
              ))}
            </Box>
          </>
        ) : null}
        <Box marginTop={step === "review" ? 1 : 0} flexDirection="column">
          {rows.map((row) =>
            row.field ? (
              <EditableRow
                key={row.id}
                focused={row.focused}
                editing={editingField === row.field}
                label={row.label}
                value={row.value ?? "-"}
                editValue={editValue}
                onChange={setEditValue}
                onSubmit={commitEdit}
              />
            ) : (
              <SelectableRow
                key={row.id}
                focused={row.focused}
                chosen={row.chosen}
                kind={row.kind}
                label={row.value ? `${row.label}: ${row.value}` : row.label}
              />
            )
          )}
        </Box>
        {activeExplainer ? (
          <ExplainerPanel
            locale={locale}
            title={activeExplainer.title}
            summary={activeExplainer.summary}
            recommendation={activeExplainer.recommendation}
            details={showExplainerDetails ? activeExplainer.details : undefined}
          />
        ) : null}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{translate(locale, "onboarding.hint.controls")}</Text>
        <Text dimColor>{translate(locale, "onboarding.hint.selected")}</Text>
        {activeExplainer ? <Text dimColor>{translate(locale, "onboarding.hint.details")}</Text> : null}
        {message ? <Text color="yellow">{message}</Text> : null}
      </Box>
    </Box>
  );
}

function SelectableRow(props: { focused: boolean; chosen: boolean; kind: OnboardingRowKind; label: string }) {
  const prefix = buildRowPrefix(props.kind, props.focused, props.chosen);
  const isChosenChoice = props.kind === "choice" && props.chosen;
  return (
    <Text color={props.focused ? "cyan" : isChosenChoice ? "green" : undefined} bold={props.focused || isChosenChoice}>
      {prefix} {props.label}
    </Text>
  );
}

function EditableRow(props: {
  focused: boolean;
  editing: boolean;
  label: string;
  value: string;
  editValue: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (props.editing) {
    return (
      <Box>
        <Text color="cyan">{buildRowPrefix("field", true, false)} {props.label}: </Text>
        <TextInput value={props.editValue} onChange={props.onChange} onSubmit={props.onSubmit} />
      </Box>
    );
  }

  return <SelectableRow focused={props.focused} chosen={false} kind="field" label={`${props.label}: ${props.value || "-"}`} />;
}

function ExplainerPanel(props: {
  locale: AppLocale;
  title: string;
  summary: string;
  recommendation?: string;
  details?: string;
}) {
  return (
    <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold>{props.title}</Text>
      <Text>{props.summary}</Text>
      {props.recommendation ? <Text color="green">{translate(props.locale, "onboarding.label.recommended")}: {props.recommendation}</Text> : null}
      {props.details ? <Text color="gray">{props.details}</Text> : null}
    </Box>
  );
}

export function runInkSetupOnboarding(options: RunInkOnboardingOptions): Promise<InkOnboardingResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const instance = render(
      <InkSetupOnboarding
        assessment={options.assessment}
        defaults={options.defaults}
        initialLanguage={options.initialLanguage}
        onSubmit={(result) => {
          if (settled) return;
          settled = true;
          instance.unmount();
          resolve(result);
        }}
        onCancel={() => {
          if (settled) return;
          settled = true;
          instance.unmount();
          resolve(null);
        }}
      />
    );
  });
}
