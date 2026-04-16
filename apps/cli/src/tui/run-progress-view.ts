import { formatElapsed, progressBar, spacer, stack, text } from "./helpers.js";
import type { TuiComponent, TuiNode, TuiRunProgressModel, TuiTone } from "./types.js";

export const RUNNING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function stageIcon(state: string, tick: number): { symbol: string; tone: TuiTone } {
  switch (state) {
    case "done":
      return { symbol: "✓", tone: "success" };
    case "running":
      return { symbol: RUNNING_SPINNER_FRAMES[tick % RUNNING_SPINNER_FRAMES.length], tone: "accent" };
    case "blocked":
      return { symbol: "!", tone: "warning" };
    case "failed":
      return { symbol: "✗", tone: "danger" };
    default:
      return { symbol: "○", tone: "muted" };
  }
}

export interface RunProgressViewProps {
  progress: TuiRunProgressModel;
}

export const RunProgressView: TuiComponent<RunProgressViewProps> = ({ progress }) => {
  const tick = progress.tick ?? 0;

  if (progress.status === "idle") {
    return text("  No active research. Type /research <artist> to begin.", "muted", "dim");
  }

  const isActive = progress.status === "running" || progress.status === "queued";

  const stateTone: TuiTone =
    progress.status === "running"
      ? "accent"
      : progress.status === "completed"
        ? "success"
        : progress.status === "failed"
          ? "danger"
          : "muted";

  const statusIcon =
    progress.status === "completed"
      ? "✓"
      : progress.status === "failed"
        ? "✗"
        : isActive
          ? RUNNING_SPINNER_FRAMES[tick % RUNNING_SPINNER_FRAMES.length]
          : "▶";

  // ── Header line: icon + artist + status + elapsed ──
  const headerParts: TuiNode[] = [
    text(`${statusIcon} ${progress.artistName ?? "n/a"}`, stateTone, "strong"),
    text(progress.status.toUpperCase(), stateTone, "strong")
  ];
  if (progress.elapsed != null) {
    headerParts.push(text(formatElapsed(progress.elapsed), "muted", "dim"));
  }

  const lines: TuiNode[] = [
    stack("row", headerParts, 2),
    text(`  ${progress.runId ?? "n/a"}`, "muted", "dim")
  ];

  // ── Progress bar (Turborepo-style) ──
  const doneCount = progress.stages.filter((s) => s.state === "done").length;
  const total = progress.stages.length;
  const ratio = total > 0 ? doneCount / total : 0;
  const barLabel = isActive && progress.elapsed != null ? formatElapsed(progress.elapsed) + " elapsed" : undefined;

  lines.push(spacer(1));
  lines.push(
    progressBar(
      progress.status === "completed" ? 1 : progress.status === "failed" ? ratio : ratio,
      progress.status === "completed" ? "success" : progress.status === "failed" ? "danger" : "accent",
      barLabel
    )
  );

  // ── Stages ──
  lines.push(spacer(1));
  if (isActive) {
    // Vertical when running — shows which step is active
    for (const stage of progress.stages) {
      const icon = stageIcon(stage.state, tick);
      const stateLabel = stage.state === "running" ? "running..." : stage.state;
      lines.push(stack("row", [text(`  ${icon.symbol} ${stage.label}`, icon.tone), text(stateLabel, icon.tone, "dim")], 1));
    }
  } else {
    // Compact horizontal when completed/failed
    const stages: TuiNode[] = [];
    for (let i = 0; i < progress.stages.length; i++) {
      const stage = progress.stages[i];
      const icon = stageIcon(stage.state, tick);
      stages.push(text(`${icon.symbol} ${stage.label}`, icon.tone));
      if (i < progress.stages.length - 1) {
        stages.push(text("→", "muted", "dim"));
      }
    }
    lines.push(stack("row", stages, 1));
  }

  // ── Summary stats ──
  if (progress.summaryLines.length > 0) {
    lines.push(spacer(1));
    lines.push(text(`  ${progress.summaryLines.join("  ·  ")}`, "muted"));
  }

  if (progress.blockerSummary) {
    lines.push(text(`  ⚠ ${progress.blockerSummary}`, "warning"));
  }

  return stack("column", lines, 0);
};

RunProgressView.displayName = "RunProgressView";
