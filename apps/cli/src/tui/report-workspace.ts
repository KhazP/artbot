import { spacer, stack, table, text } from "./helpers.js";
import type { TuiComponent, TuiNode, TuiReportWorkspaceModel, TuiTone } from "./types.js";

function recordTone(priceType: string): TuiTone {
  switch (priceType) {
    case "hammer_price":
    case "realized_price":
    case "realized_with_buyers_premium":
      return "success";
    case "asking_price":
      return "accent";
    case "estimate":
      return "warning";
    default:
      return "muted";
  }
}

export interface ReportWorkspaceProps {
  report: TuiReportWorkspaceModel;
}

export const ReportWorkspace: TuiComponent<ReportWorkspaceProps> = ({ report }) => {
  const lines: TuiNode[] = [];

  // ── Inline metrics ──
  const coverageText = report.sourceCoverage.map((e) => `${e.label}: ${e.value}`).join("  ·  ");
  lines.push(text(`  Sources   ${coverageText}`, "muted"));

  const valuationText = report.valuation.map((e) => `${e.label}: ${e.value}`).join("  ·  ");
  lines.push(text(`  Values    ${valuationText}`, "muted"));

  // ── Comparables table (gh-style) ──
  if (report.acceptedRecords.length > 0) {
    lines.push(spacer(1));

    const columns = [
      { key: "price", label: "Price", width: 14, tone: "neutral" as TuiTone },
      { key: "title", label: "Title", width: 34, tone: "neutral" as TuiTone },
      { key: "source", label: "Source", width: 22, tone: "muted" as TuiTone },
      { key: "detail", label: "Date / Info", width: 20, tone: "muted" as TuiTone }
    ];

    const rows = report.acceptedRecords.map((record) => ({
      price: { text: record.price, tone: recordTone(record.priceType) },
      title: { text: record.workTitle, tone: "neutral" as TuiTone },
      source: { text: record.sourceName, tone: "muted" as TuiTone },
      detail: { text: record.detail ?? "", tone: "muted" as TuiTone }
    }));

    lines.push(table(columns, rows));
  }

  if (lines.length === 0) {
    return text("  No results yet.", "muted", "dim");
  }

  return stack("column", lines, 0);
};

ReportWorkspace.displayName = "ReportWorkspace";
