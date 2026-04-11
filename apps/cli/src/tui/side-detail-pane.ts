import { stack, text } from "./helpers.js";
import type { TuiComponent, TuiNode, TuiSideDetailModel } from "./types.js";

export interface SideDetailPaneProps {
  detail: TuiSideDetailModel;
}

export const SideDetailPane: TuiComponent<SideDetailPaneProps> = ({ detail }) => {
  const lines: TuiNode[] = [];

  for (const blocker of detail.blockers) {
    if (blocker && blocker !== "No blockers recorded.") {
      lines.push(text(`⚠ ${blocker}`, "warning"));
    }
  }

  for (const url of detail.evidence) {
    lines.push(text(url, "muted", "dim"));
  }

  if (lines.length === 0) {
    return text("No evidence collected yet.", "muted", "dim");
  }

  return stack("column", lines, 0);
};

SideDetailPane.displayName = "SideDetailPane";
