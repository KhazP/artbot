export type TuiTone = "neutral" | "muted" | "accent" | "success" | "warning" | "danger" | "inverse";

export type TuiTextWeight = "normal" | "strong" | "dim";

export interface TuiTextNode {
  kind: "text";
  text: string;
  tone?: TuiTone;
  weight?: TuiTextWeight;
}

export interface TuiSpacerNode {
  kind: "spacer";
  size: number;
}

export interface TuiDividerNode {
  kind: "divider";
  label?: string;
  tone?: TuiTone;
}

export interface TuiPanelNode {
  kind: "panel";
  title?: string;
  subtitle?: string;
  accent?: TuiTone;
  width?: number | string;
  children: TuiNode[];
}

export interface TuiSplitNode {
  kind: "split";
  direction: "row" | "column";
  ratios?: [number, number];
  children: [TuiNode, TuiNode];
}

export interface TuiStackNode {
  kind: "stack";
  direction: "row" | "column";
  gap?: number;
  children: TuiNode[];
}

export interface TuiListItemNode {
  kind: "list-item";
  label: string;
  value?: string;
  tone?: TuiTone;
  detail?: string;
}

export interface TuiListNode {
  kind: "list";
  title?: string;
  items: TuiListItemNode[];
}

export interface TuiMetricNode {
  kind: "metric";
  label: string;
  value: string;
  tone?: TuiTone;
  hint?: string;
}

export interface TuiCommandHint {
  command: string;
  description: string;
  tone?: TuiTone;
}

export interface TuiCommandState {
  mode: "idle" | "prompting" | "running" | "reviewing" | "setup";
  input: string;
  placeholder?: string;
  hints: TuiCommandHint[];
  history: string[];
}

export interface TuiRuntimeStatus {
  label: string;
  state: "healthy" | "degraded" | "offline" | "unknown";
  detail?: string;
  tone?: TuiTone;
}

export interface TuiStatusRailModel {
  llm: TuiRuntimeStatus;
  api: TuiRuntimeStatus;
  worker: TuiRuntimeStatus;
  auth: TuiRuntimeStatus;
  licensed: TuiRuntimeStatus;
  model?: string;
  apiBaseUrl?: string;
  llmBaseUrl?: string;
}

export interface TuiRunStage {
  id: string;
  label: string;
  state: "pending" | "running" | "done" | "blocked" | "failed";
  progress?: number;
  detail?: string;
}

export interface TuiRunProgressModel {
  runId?: string;
  artistName?: string;
  status: "idle" | "queued" | "running" | "completed" | "failed";
  stages: TuiRunStage[];
  summaryLines: string[];
  blockerSummary?: string;
  tick?: number;
  elapsed?: number;
}

export interface TuiTableColumn {
  key: string;
  label: string;
  width: number;
  tone?: TuiTone;
}

export interface TuiTableNode {
  kind: "table";
  columns: TuiTableColumn[];
  rows: Record<string, { text: string; tone?: TuiTone }>[];
}

export interface TuiProgressBarNode {
  kind: "progress-bar";
  value: number;
  width?: number;
  tone?: TuiTone;
  label?: string;
}

export interface TuiKeyHintNode {
  kind: "key-hint";
  keys: Array<{ key: string; label: string; tone?: TuiTone }>;
}

export interface TuiReportMetric {
  label: string;
  value: string;
  tone?: TuiTone;
  hint?: string;
}

export interface TuiReportRecord {
  price: string;
  priceType: string;
  workTitle: string;
  sourceName: string;
  detail?: string;
  tone?: TuiTone;
}

export interface TuiReportSection {
  title: string;
  tone?: TuiTone;
  lines: string[];
}

export interface TuiReportWorkspaceModel {
  artistName: string;
  runId: string;
  overview: TuiReportMetric[];
  sourceCoverage: TuiReportMetric[];
  valuation: TuiReportMetric[];
  acceptedRecords: TuiReportRecord[];
  diagnostics: TuiReportSection[];
}

export interface TuiDetailItem {
  label: string;
  value?: string;
  tone?: TuiTone;
  detail?: string;
}

export interface TuiSideDetailModel {
  title: string;
  subtitle?: string;
  status: TuiRuntimeStatus[];
  details: TuiDetailItem[];
  blockers: string[];
  evidence: string[];
}

export interface TuiAppModel {
  title: string;
  subtitle?: string;
  command: TuiCommandState;
  status: TuiStatusRailModel;
  progress: TuiRunProgressModel;
  report: TuiReportWorkspaceModel;
  detail: TuiSideDetailModel;
}

export type TuiNode =
  | TuiTextNode
  | TuiSpacerNode
  | TuiDividerNode
  | TuiPanelNode
  | TuiSplitNode
  | TuiStackNode
  | TuiListNode
  | TuiMetricNode
  | TuiTableNode
  | TuiProgressBarNode
  | TuiKeyHintNode;

export interface TuiComponent<P> {
  (props: P): TuiNode;
  displayName?: string;
}
