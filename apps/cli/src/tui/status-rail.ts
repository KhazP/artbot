import { stack, text } from "./helpers.js";
import type { TuiComponent, TuiNode, TuiStatusRailModel, TuiTone } from "./types.js";

function statusDot(state: "healthy" | "degraded" | "offline" | "unknown"): { symbol: string; tone: TuiTone } {
  switch (state) {
    case "healthy":
      return { symbol: "●", tone: "success" };
    case "degraded":
      return { symbol: "●", tone: "warning" };
    case "offline":
      return { symbol: "●", tone: "danger" };
    default:
      return { symbol: "○", tone: "muted" };
  }
}

function statusEntry(name: string, status: TuiStatusRailModel["llm"]): TuiNode {
  const dot = statusDot(status.state);
  const detail = status.detail ? `: ${status.detail}` : "";
  return text(`${dot.symbol} ${name}${detail}`, dot.tone);
}

export const StatusRail: TuiComponent<TuiStatusRailModel> = (props) =>
  stack("column", [
    stack("row", [statusEntry("LM Studio", props.llm), statusEntry("API", props.api), statusEntry("Worker", props.worker)], 3),
    stack("row", [statusEntry("Auth", props.auth), statusEntry("Licensed", props.licensed)], 3)
  ]);

StatusRail.displayName = "StatusRail";
