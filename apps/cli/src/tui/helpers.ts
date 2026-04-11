import type {
  TuiCommandHint,
  TuiDividerNode,
  TuiKeyHintNode,
  TuiListItemNode,
  TuiListNode,
  TuiMetricNode,
  TuiNode,
  TuiPanelNode,
  TuiProgressBarNode,
  TuiSplitNode,
  TuiSpacerNode,
  TuiStackNode,
  TuiTableColumn,
  TuiTableNode,
  TuiTextNode,
  TuiTone
} from "./types.js";

export function text(text: string, tone: TuiTone = "neutral", weight: TuiTextNode["weight"] = "normal"): TuiTextNode {
  return { kind: "text", text, tone, weight };
}

export function spacer(size = 1): TuiSpacerNode {
  return { kind: "spacer", size };
}

export function divider(label?: string, tone: TuiTone = "muted"): TuiDividerNode {
  return { kind: "divider", label, tone };
}

export function panel(title: string | undefined, children: TuiNode[], options: Partial<Pick<TuiPanelNode, "subtitle" | "accent" | "width">> = {}): TuiPanelNode {
  return {
    kind: "panel",
    title,
    subtitle: options.subtitle,
    accent: options.accent,
    width: options.width,
    children
  };
}

export function split(direction: TuiSplitNode["direction"], children: [TuiNode, TuiNode], ratios?: [number, number]): TuiSplitNode {
  return {
    kind: "split",
    direction,
    ratios,
    children
  };
}

export function stack(direction: TuiStackNode["direction"], children: TuiNode[], gap = 1): TuiStackNode {
  return {
    kind: "stack",
    direction,
    gap,
    children
  };
}

export function metric(label: string, value: string, tone: TuiTone = "neutral", hint?: string): TuiMetricNode {
  return {
    kind: "metric",
    label,
    value,
    tone,
    hint
  };
}

export function list(title: string | undefined, items: TuiListItemNode[]): TuiListNode {
  return {
    kind: "list",
    title,
    items
  };
}

export function listItem(label: string, value?: string, tone: TuiTone = "neutral", detail?: string): TuiListItemNode {
  return {
    kind: "list-item",
    label,
    value,
    tone,
    detail
  };
}

export function commandHint(command: string, description: string, tone: TuiTone = "accent"): TuiCommandHint {
  return { command, description, tone };
}

export function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function percent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(clampRatio(value) * 100)}%`;
}

export function formatMaybeNumber(value?: number | null, suffix = ""): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString("en-US")}${suffix}`;
}

export function table(columns: TuiTableColumn[], rows: TuiTableNode["rows"]): TuiTableNode {
  return { kind: "table", columns, rows };
}

export function progressBar(value: number, tone: TuiTone = "accent", label?: string, width?: number): TuiProgressBarNode {
  return { kind: "progress-bar", value: Math.min(1, Math.max(0, value)), tone, label, width };
}

export function keyHint(keys: TuiKeyHintNode["keys"]): TuiKeyHintNode {
  return { kind: "key-hint", keys };
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
