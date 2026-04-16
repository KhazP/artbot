export const TUI_THEME_NAMES = ["artbot", "system", "matrix"] as const;
export type TuiThemeName = (typeof TUI_THEME_NAMES)[number];

export interface TuiTheme {
  name: TuiThemeName;
  label: string;
  colors: {
    text: string;
    muted: string;
    accent: string;
    border: string;
    panelBorder: string;
    overlayBorder: string;
    promptBorder: string;
    promptAccent: string;
    success: string;
    warning: string;
    danger: string;
    localActive: string;
    thinking: string;
    sandbox: string;
    keycap: string;
    selection: string;
    subtle: string;
  };
}

const THEMES: Record<TuiThemeName, TuiTheme> = {
  artbot: {
    name: "artbot",
    label: "ArtBot",
    colors: {
      text: "#eef4fb",
      muted: "#94a3b8",
      accent: "#47d7ff",
      border: "#2a3645",
      panelBorder: "#47d7ff",
      overlayBorder: "#22d3ee",
      promptBorder: "#22d3ee",
      promptAccent: "#47d7ff",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#fb7185",
      localActive: "#10b981",
      thinking: "#f472b6",
      sandbox: "#60a5fa",
      keycap: "#22d3ee",
      selection: "#38bdf8",
      subtle: "#64748b"
    }
  },
  system: {
    name: "system",
    label: "System",
    colors: {
      text: "white",
      muted: "gray",
      accent: "blue",
      border: "gray",
      panelBorder: "blue",
      overlayBorder: "cyan",
      promptBorder: "blue",
      promptAccent: "cyan",
      success: "green",
      warning: "yellow",
      danger: "red",
      localActive: "green",
      thinking: "magenta",
      sandbox: "blue",
      keycap: "cyan",
      selection: "blue",
      subtle: "gray"
    }
  },
  matrix: {
    name: "matrix",
    label: "Matrix",
    colors: {
      text: "#d1fae5",
      muted: "#4ade80",
      accent: "#22c55e",
      border: "#14532d",
      panelBorder: "#22c55e",
      overlayBorder: "#16a34a",
      promptBorder: "#22c55e",
      promptAccent: "#4ade80",
      success: "#4ade80",
      warning: "#bef264",
      danger: "#86efac",
      localActive: "#4ade80",
      thinking: "#ec4899",
      sandbox: "#60a5fa",
      keycap: "#4ade80",
      selection: "#22c55e",
      subtle: "#166534"
    }
  }
};

export function getTuiTheme(name: TuiThemeName): TuiTheme {
  return THEMES[name];
}

export function getTuiThemeOptions(): TuiTheme[] {
  return TUI_THEME_NAMES.map((name) => THEMES[name]);
}
