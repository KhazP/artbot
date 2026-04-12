import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveArtbotHome } from "../setup/env.js";
import { TUI_THEME_NAMES, type TuiThemeName } from "./theme.js";

export const TUI_DENSITIES = ["comfortable", "compact"] as const;
export type TuiDensity = (typeof TUI_DENSITIES)[number];

export const TUI_DIFF_LAYOUTS = ["auto", "stacked", "side-by-side"] as const;
export type TuiDiffLayout = (typeof TUI_DIFF_LAYOUTS)[number];

export interface TuiPreferences {
  theme: TuiThemeName;
  density: TuiDensity;
  showSecondaryPane: boolean;
  diffLayout: TuiDiffLayout;
}

export const DEFAULT_TUI_PREFERENCES: TuiPreferences = {
  theme: "artbot",
  density: "comfortable",
  showSecondaryPane: true,
  diffLayout: "auto"
};

const partialPreferencesSchema = z.object({
  theme: z.enum(TUI_THEME_NAMES).optional(),
  density: z.enum(TUI_DENSITIES).optional(),
  showSecondaryPane: z.boolean().optional(),
  diffLayout: z.enum(TUI_DIFF_LAYOUTS).optional()
});

export function resolveTuiPreferencesPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveArtbotHome(env), "tui.json");
}

export function normalizeTuiPreferences(input: unknown): TuiPreferences {
  const parsed = partialPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ...DEFAULT_TUI_PREFERENCES };
  }

  return {
    ...DEFAULT_TUI_PREFERENCES,
    ...parsed.data
  };
}

export function loadTuiPreferences(env: NodeJS.ProcessEnv = process.env): TuiPreferences {
  const filePath = resolveTuiPreferencesPath(env);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return normalizeTuiPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TUI_PREFERENCES };
  }
}

export function saveTuiPreferences(preferences: TuiPreferences, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = normalizeTuiPreferences(preferences);
  const filePath = resolveTuiPreferencesPath(env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return filePath;
}
