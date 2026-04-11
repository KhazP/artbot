import { divider, panel, spacer, text } from "./helpers.js";
import { CommandBar } from "./command-bar.js";
import { ReportWorkspace } from "./report-workspace.js";
import { RunProgressView } from "./run-progress-view.js";
import { StatusRail } from "./status-rail.js";
import type { TuiAppModel, TuiComponent, TuiNode } from "./types.js";

export interface ArtbotTuiShellProps {
  model: TuiAppModel;
}

export const ArtbotTuiShell: TuiComponent<ArtbotTuiShellProps> = ({ model }) => {
  const children: TuiNode[] = [];

  // ── Status bar (always visible) ──
  children.push(StatusRail(model.status));

  // ── Pipeline (always visible) ──
  children.push(divider("Pipeline"));
  children.push(RunProgressView({ progress: model.progress }));

  // ── Results (only when a run exists) ──
  const hasRun = model.progress.status !== "idle";
  if (hasRun) {
    children.push(divider("Results"));
    children.push(ReportWorkspace({ report: model.report }));
  }

  // ── Evidence URLs (only when there are any) ──
  if (model.detail.evidence.length > 0) {
    children.push(divider("Evidence"));
    for (const url of model.detail.evidence) {
      children.push(text(`  ${url}`, "muted", "dim"));
    }
  }

  // ── Contextual notes (setup issues, run notes, etc.) ──
  // Rendered once here to avoid duplication across sub-components
  for (const section of model.report.diagnostics) {
    const skip = new Set(["No detail available.", "No additional diagnostics.", "Slash command ready."]);
    const meaningful = section.lines.filter((l) => !skip.has(l));
    if (meaningful.length > 0) {
      children.push(divider(section.title));
      for (const line of meaningful) {
        const tone = section.tone === "warning" ? ("warning" as const) : ("muted" as const);
        children.push(text(`  ${line}`, tone));
      }
    }
  }

  // ── Command hint ──
  children.push(spacer(1));
  children.push(CommandBar({ command: model.command }));

  return panel(model.title, children, { accent: "accent", subtitle: model.subtitle });
};

ArtbotTuiShell.displayName = "ArtbotTuiShell";
