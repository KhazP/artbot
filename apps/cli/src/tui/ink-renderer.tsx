import React, { Fragment } from "react";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type {
  TuiDividerNode,
  TuiKeyHintNode,
  TuiListNode,
  TuiMetricNode,
  TuiNode,
  TuiPanelNode,
  TuiProgressBarNode,
  TuiSpacerNode,
  TuiStackNode,
  TuiTableNode,
  TuiTextNode,
  TuiTone
} from "./types.js";

function toneColor(tone: TuiTone | undefined): string {
  switch (tone) {
    case "accent":
      return "cyan";
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "danger":
      return "red";
    case "muted":
      return "gray";
    case "inverse":
      return "black";
    default:
      return "white";
  }
}

function renderText(node: TuiTextNode, key: string): ReactNode {
  return (
    <Text key={key} color={toneColor(node.tone)} dimColor={node.weight === "dim"} bold={node.weight === "strong"}>
      {node.text}
    </Text>
  );
}

function renderSpacer(node: TuiSpacerNode, key: string): ReactNode {
  return (
    <Text key={key}>
      {"\n".repeat(Math.max(1, node.size))}
    </Text>
  );
}

function renderDivider(node: TuiDividerNode, key: string): ReactNode {
  return (
    <Text key={key} color={toneColor(node.tone)} dimColor>
      {node.label ? `── ${node.label} ${"─".repeat(Math.max(8, 28 - node.label.length))}` : "─".repeat(32)}
    </Text>
  );
}

function renderMetric(node: TuiMetricNode, key: string): ReactNode {
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={toneColor(node.tone)} paddingX={1} marginRight={1}>
      <Text color="gray">{node.label}</Text>
      <Text color={toneColor(node.tone)} bold>
        {node.value}
      </Text>
      {node.hint ? (
        <Text color="gray" dimColor>
          {node.hint}
        </Text>
      ) : null}
    </Box>
  );
}

function renderList(node: TuiListNode, key: string): ReactNode {
  return (
    <Box key={key} flexDirection="column" marginRight={1}>
      {node.title ? (
        <Text color="gray" bold>
          {node.title}
        </Text>
      ) : null}
      {node.items.map((item, index) => (
        <Box key={`${key}-item-${index}`} flexDirection="column" marginBottom={item.detail ? 1 : 0}>
          <Text color={toneColor(item.tone)}>
            {item.label}
            {item.value ? <Text color="white">: {item.value}</Text> : null}
          </Text>
          {item.detail ? (
            <Text color="gray" dimColor>
              {item.detail}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

function renderStack(node: TuiStackNode, key: string): ReactNode {
  return (
    <Box key={key} flexDirection={node.direction}>
      {node.children.map((child, index) => (
        <Box
          key={`${key}-child-${index}`}
          marginRight={node.direction === "row" && index < node.children.length - 1 ? node.gap ?? 1 : 0}
          marginBottom={node.direction === "column" && index < node.children.length - 1 ? node.gap ?? 1 : 0}
        >
          <RenderTuiNode node={child} />
        </Box>
      ))}
    </Box>
  );
}

function renderSplit(node: Extract<TuiNode, { kind: "split" }>, key: string): ReactNode {
  return (
    <Box key={key} flexDirection={node.direction}>
      {node.children.map((child, index) => (
        <Box key={`${key}-split-${index}`} flexGrow={node.ratios?.[index] ?? 1} marginRight={node.direction === "row" && index === 0 ? 1 : 0}>
          <RenderTuiNode node={child} />
        </Box>
      ))}
    </Box>
  );
}

function renderPanel(node: TuiPanelNode, key: string): ReactNode {
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={toneColor(node.accent)} paddingX={1} paddingY={0} width={node.width}>
      {node.title ? (
        <Text color={toneColor(node.accent)} bold>
          {node.title}
        </Text>
      ) : null}
      {node.subtitle ? (
        <Text color="gray" dimColor>
          {node.subtitle}
        </Text>
      ) : null}
      {node.children.map((child, index) => (
        <Fragment key={`${key}-panel-${index}`}>
          <RenderTuiNode node={child} />
        </Fragment>
      ))}
    </Box>
  );
}

/* ── Table ── (gh / npm audit style) ────────────────────────── */
function renderTable(node: TuiTableNode, key: string): ReactNode {
  if (node.rows.length === 0) return null;
  return (
    <Box key={key} flexDirection="column">
      {/* Header row */}
      <Box>
        {node.columns.map((col, i) => (
          <Box key={`${key}-hdr-${i}`} width={col.width} marginRight={1}>
            <Text color="gray" bold>
              {col.label}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Separator */}
      <Box>
        {node.columns.map((col, i) => (
          <Box key={`${key}-sep-${i}`} width={col.width} marginRight={1}>
            <Text color="gray" dimColor>
              {"─".repeat(Math.min(col.width, col.label.length + 2))}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Data rows */}
      {node.rows.map((row, ri) => (
        <Box key={`${key}-row-${ri}`}>
          {node.columns.map((col, ci) => {
            const cell = row[col.key];
            return (
              <Box key={`${key}-cell-${ri}-${ci}`} width={col.width} marginRight={1}>
                <Text color={toneColor(cell?.tone ?? col.tone)} wrap="truncate">
                  {cell?.text ?? ""}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

/* ── Progress Bar ── (Turborepo / Vercel style) ──────────────── */
function renderProgressBar(node: TuiProgressBarNode, key: string): ReactNode {
  const width = node.width ?? 24;
  const filled = Math.round(node.value * width);
  const empty = width - filled;
  const pct = Math.round(node.value * 100);

  return (
    <Box key={key}>
      <Text color={toneColor(node.tone)}>
        {"█".repeat(filled)}
      </Text>
      <Text color="gray" dimColor>
        {"░".repeat(empty)}
      </Text>
      <Text color="gray">
        {" "}
        {pct}%
      </Text>
      {node.label ? (
        <Text color="gray" dimColor>
          {"  "}
          {node.label}
        </Text>
      ) : null}
    </Box>
  );
}

/* ── Key Hint strip ── (k9s / lazygit style) ─────────────────── */
function renderKeyHint(node: TuiKeyHintNode, key: string): ReactNode {
  return (
    <Box key={key} flexDirection="row" gap={2}>
      {node.keys.map((k, i) => (
        <Box key={`${key}-kh-${i}`}>
          <Text color={toneColor(k.tone ?? "accent")} bold>
            [{k.key}]
          </Text>
          <Text color="gray">
            {" "}
            {k.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function RenderTuiNode({ node }: { node: TuiNode }): ReactNode {
  switch (node.kind) {
    case "text":
      return renderText(node, "text");
    case "spacer":
      return renderSpacer(node, "spacer");
    case "divider":
      return renderDivider(node, "divider");
    case "metric":
      return renderMetric(node, "metric");
    case "list":
      return renderList(node, "list");
    case "stack":
      return renderStack(node, "stack");
    case "split":
      return renderSplit(node, "split");
    case "panel":
      return renderPanel(node, "panel");
    case "table":
      return renderTable(node, "table");
    case "progress-bar":
      return renderProgressBar(node, "progress-bar");
    case "key-hint":
      return renderKeyHint(node, "key-hint");
    default:
      return null;
  }
}
