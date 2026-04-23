import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { deepResearchSettingsSchema, type DeepResearchSettings } from "@artbot/shared-types";
import { resolveArtbotHome } from "../setup/env.js";
import { APP_LOCALES, normalizeAppLocale, type AppLocale } from "../i18n.js";
import { TUI_THEME_NAMES, type TuiThemeName } from "./theme.js";

export const TUI_DENSITIES = ["comfortable", "compact"] as const;
export type TuiDensity = (typeof TUI_DENSITIES)[number];

export const TUI_DIFF_LAYOUTS = ["auto", "stacked", "side-by-side"] as const;
export type TuiDiffLayout = (typeof TUI_DIFF_LAYOUTS)[number];

export interface TuiPreferences {
  language: AppLocale;
  theme: TuiThemeName;
  density: TuiDensity;
  showSecondaryPane: boolean;
  diffLayout: TuiDiffLayout;
  experimental: DeepResearchSettings;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function buildDefaultExperimentalSettings(env: NodeJS.ProcessEnv = process.env): DeepResearchSettings {
  return deepResearchSettingsSchema.parse({
    enabled: parseBooleanEnv(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED, false),
    plannerModel: env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL?.trim() || "gemini-pro-latest",
    researchMode: "deep_research_max",
    warnOnRun: parseBooleanEnv(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_WARN_ON_RUN, true),
    spendCapReminderUsd: parsePositiveIntEnv(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_SPEND_CAP_REMINDER_USD, 20),
    openFullReportAfterRun: parseBooleanEnv(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_OPEN_FULL_REPORT, true)
  });
}

export function buildDefaultTuiPreferences(env: NodeJS.ProcessEnv = process.env): TuiPreferences {
  return {
    language: "en",
    theme: "artbot",
    density: "comfortable",
    showSecondaryPane: true,
    diffLayout: "auto",
    experimental: buildDefaultExperimentalSettings(env)
  };
}

export const DEFAULT_TUI_PREFERENCES: TuiPreferences = buildDefaultTuiPreferences();

const partialPreferencesSchema = z.object({
  language: z.enum(APP_LOCALES).optional(),
  theme: z.enum(TUI_THEME_NAMES).optional(),
  density: z.enum(TUI_DENSITIES).optional(),
  showSecondaryPane: z.boolean().optional(),
  diffLayout: z.enum(TUI_DIFF_LAYOUTS).optional(),
  experimental: deepResearchSettingsSchema.partial().optional()
});

export function resolveTuiPreferencesPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveArtbotHome(env), "tui.json");
}

export function normalizeTuiPreferences(input: unknown, env: NodeJS.ProcessEnv = process.env): TuiPreferences {
  const defaults = buildDefaultTuiPreferences(env);
  const parsed = partialPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ...defaults };
  }

  return {
    ...defaults,
    ...parsed.data,
    language: normalizeAppLocale(parsed.data.language),
    experimental: deepResearchSettingsSchema.parse({
      ...defaults.experimental,
      ...(parsed.data.experimental ?? {})
    })
  };
}

export function loadTuiPreferences(env: NodeJS.ProcessEnv = process.env): TuiPreferences {
  const filePath = resolveTuiPreferencesPath(env);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return normalizeTuiPreferences(JSON.parse(raw), env);
  } catch {
    return { ...buildDefaultTuiPreferences(env) };
  }
}

export function saveTuiPreferences(preferences: TuiPreferences, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = normalizeTuiPreferences(preferences, env);
  const filePath = resolveTuiPreferencesPath(env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return filePath;
}
