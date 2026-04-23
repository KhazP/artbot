import type { DeepResearchResult, RunEntity } from "@artbot/shared-types";
import type { PerPaintingStat, ReportRecord, ReportSummary, ReportValuation } from "../ui/report.js";
import type { TuiPreferences } from "./preferences.js";
import { TUI_THEME_NAMES, type TuiThemeName } from "./theme.js";

export interface PipelineDetails {
  run?: {
    id?: string;
    status?: string;
    pinned?: boolean;
    pinnedAt?: string;
    resultsPath?: string;
    reportPath?: string;
    runType?: string;
    query?: {
      artist?: string;
      title?: string;
    };
  };
  summary?: ReportSummary;
  records?: ReportRecord[];
  duplicates?: ReportRecord[];
  valuation?: ReportValuation;
  per_painting_stats?: PerPaintingStat[];
  deepResearch?: DeepResearchResult;
  inventory?: Array<{
    record_key: string;
    payload: {
      work_title?: string | null;
      source_name?: string;
    };
  }>;
  normalization_events?: Array<{
    id: string;
    record_ref: string;
    source_name: string;
    source_url: string;
    work_title?: string | null;
    payload_json: Record<string, unknown>;
    created_at: string;
  }>;
  fx_cache_stats?: {
    total_rows: number;
    unique_dates: number;
    latest_date: string | null;
    sources: Record<string, number>;
    quote_currencies: Record<string, number>;
  };
  review_queue?: Array<{
    id: string;
    status?: string;
    left_record_key?: string;
    right_record_key?: string;
    recommended_action?: string;
    reasons?: string[];
    confidence?: number | null;
  }>;
  attempts?: Array<{
    source_name?: string;
    source_url: string;
    source_access_status: string;
    acceptance_reason?: string;
    failure_class?: string | null;
    blocker_reason?: string | null;
    extracted_fields?: Record<string, unknown>;
  }>;
}

export type PrimaryView = "idle" | "running" | "completed" | "failed";
export type SidePane = "none" | "setup" | "auth" | "run-details" | "normalization" | "sources" | "review" | "fx" | "errors";
export type Overlay = "none" | "help" | "recent-runs" | "settings" | "report-surface";
export type FocusTarget = "composer" | "main" | "side" | "overlay";

export const RECENT_RUNS_VISIBLE_LIMIT = 10;
export const COMPLETED_REPORT_SURFACE_OPTIONS = [
  {
    value: "cli",
    label: "CLI report",
    hint: "stay in the terminal"
  },
  {
    value: "web",
    label: "Browser report",
    hint: "generate and open the HTML report"
  }
] as const;
export type CompletedReportSurfaceOption = (typeof COMPLETED_REPORT_SURFACE_OPTIONS)[number]["value"];

export interface TuiSurfaceState {
  sidePane: SidePane;
  sidePaneDismissed: boolean;
  overlay: Overlay;
  focusTarget: FocusTarget;
  recentRunsQuery: string;
  selectedRecentRunIndex: number;
  selectedSettingsIndex: number;
  selectedReportSurfaceIndex: number;
}

export interface ComposerState {
  mode: "command" | "run-search" | "settings" | "report-surface";
  placeholder: string;
  helperText: string;
  promptSymbol: string;
}

export const DEFAULT_SURFACE_STATE: TuiSurfaceState = {
  sidePane: "none",
  sidePaneDismissed: false,
  overlay: "none",
  focusTarget: "composer",
  recentRunsQuery: "",
  selectedRecentRunIndex: 0,
  selectedSettingsIndex: 0,
  selectedReportSurfaceIndex: 0
};

export function resolveDisplayedRun(input: {
  busy: boolean;
  sessionRun: PipelineDetails | null;
  browsedRun: PipelineDetails | null;
}): PipelineDetails | null {
  if (input.busy) {
    return input.sessionRun;
  }

  return input.browsedRun ?? input.sessionRun;
}

export function resolvePrimaryView(details: PipelineDetails | null): PrimaryView {
  const status = details?.run?.status;
  if (!status) return "idle";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

export function resolveDisplayedSidePane(input: {
  primaryView: PrimaryView;
  requestedSidePane: SidePane;
  sidePaneDismissed: boolean;
  preferences: TuiPreferences;
  hasSetupIssues: boolean;
}): SidePane {
  if (input.requestedSidePane !== "none") {
    return input.requestedSidePane;
  }

  if (input.sidePaneDismissed) {
    return "none";
  }

  if (!input.preferences.showSecondaryPane) {
    return "none";
  }

  if (input.hasSetupIssues) {
    return "setup";
  }

  if (input.primaryView === "idle") {
    return "none";
  }

  return "run-details";
}

export function openOverlay(
  state: TuiSurfaceState,
  overlay: Overlay,
  selectedSettingsIndex = state.selectedSettingsIndex,
  selectedReportSurfaceIndex = state.selectedReportSurfaceIndex
): TuiSurfaceState {
  return {
    ...state,
    overlay,
    focusTarget: overlay === "none" ? "composer" : "overlay",
    recentRunsQuery: overlay === "recent-runs" ? state.recentRunsQuery : "",
    selectedRecentRunIndex: 0,
    selectedSettingsIndex,
    selectedReportSurfaceIndex
  };
}

export function closeOverlay(state: TuiSurfaceState): TuiSurfaceState {
  return {
    ...state,
    overlay: "none",
    focusTarget: "composer",
    recentRunsQuery: "",
    selectedRecentRunIndex: 0
  };
}

export function toggleSecondaryPane(preferences: TuiPreferences): TuiPreferences {
  return {
    ...preferences,
    showSecondaryPane: !preferences.showSecondaryPane
  };
}

export function stepSelection(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}

export function filterRecentRuns(runs: RunEntity[], query: string): RunEntity[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return runs;

  return runs.filter((run) => {
    const artist = run.query.artist?.toLowerCase() ?? "";
    const title = run.query.title?.toLowerCase() ?? "";
    const status = run.status.toLowerCase();
    const runType = run.runType.toLowerCase();
    const pinned = run.pinned ? "pinned" : "";
    return (
      run.id.toLowerCase().includes(trimmed) ||
      artist.includes(trimmed) ||
      title.includes(trimmed) ||
      status.includes(trimmed) ||
      runType.includes(trimmed) ||
      pinned.includes(trimmed)
    );
  });
}

export function getThemeIndex(name: TuiThemeName): number {
  return Math.max(0, TUI_THEME_NAMES.indexOf(name));
}

export function getThemeNameByIndex(index: number): TuiThemeName {
  return TUI_THEME_NAMES[Math.max(0, Math.min(index, TUI_THEME_NAMES.length - 1))];
}

export function getCompletedReportSurfaceByIndex(index: number): CompletedReportSurfaceOption {
  return COMPLETED_REPORT_SURFACE_OPTIONS[
    Math.max(0, Math.min(index, COMPLETED_REPORT_SURFACE_OPTIONS.length - 1))
  ]!.value;
}

export function buildComposerState(input: {
  overlay: Overlay;
  focusTarget: FocusTarget;
}): ComposerState {
  if (input.overlay === "recent-runs" && input.focusTarget === "overlay") {
    return {
      mode: "run-search",
      placeholder: "Filter runs by artist, status, type, or run id",
      helperText: "Enter selects the highlighted run. Esc closes.",
      promptSymbol: "runs"
    };
  }

  if (input.overlay === "settings" && input.focusTarget === "overlay") {
    return {
      mode: "settings",
      placeholder: "Use ↑/↓ to choose a setting, Enter to apply, Esc to close",
      helperText: "Theme and language changes save immediately.",
      promptSymbol: "settings"
    };
  }

  if (input.overlay === "report-surface" && input.focusTarget === "overlay") {
    return {
      mode: "report-surface",
      placeholder: "Use ↑/↓ to choose CLI or browser report, Enter to confirm",
      helperText: "Choose how to view the completed run. Esc closes.",
      promptSymbol: "report"
    };
  }

  return {
    mode: "command",
    placeholder: "Type /research <artist> or plain artist text. /help for commands.",
    helperText: "Slash commands stay available while overlays are open.",
    promptSymbol: "artbot"
  };
}
