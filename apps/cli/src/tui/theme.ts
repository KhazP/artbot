import type { TuiTone } from "./types.js";

export interface TuiTheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  accent: string;
  accentSoft: string;
  text: string;
  mutedText: string;
  success: string;
  warning: string;
  danger: string;
  inverse: string;
}

export const artbotTheme: TuiTheme = {
  background: "#0b0f14",
  surface: "#111822",
  surfaceAlt: "#17212d",
  border: "#2a3645",
  accent: "#47d7ff",
  accentSoft: "#193746",
  text: "#eef4fb",
  mutedText: "#94a3b8",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  inverse: "#081018"
};

export function toneToThemeKey(tone: TuiTone): keyof TuiTheme {
  switch (tone) {
    case "accent":
      return "accent";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "danger";
    case "inverse":
      return "inverse";
    case "muted":
      return "mutedText";
    default:
      return "text";
  }
}

export const tuiSpacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4
} as const;
