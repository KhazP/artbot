import React from "react";
import { Box, Text } from "ink";
import type { RunEntity } from "@artbot/shared-types";
import type { SetupAssessment } from "../setup/index.js";
import type { TuiPreferences } from "./preferences.js";
import { RUNNING_SPINNER_FRAMES } from "./run-progress-view.js";
import { COMPLETED_REPORT_SURFACE_OPTIONS, type FocusTarget, type Overlay, type PipelineDetails, type PrimaryView, type SidePane } from "./state.js";
import { getTuiThemeOptions, type TuiTheme } from "./theme.js";

interface ArtbotInteractiveShellProps {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  displayedRun: PipelineDetails | null;
  activeArtist: string;
  primaryView: PrimaryView;
  sidePane: SidePane;
  overlay: Overlay;
  focusTarget: FocusTarget;
  preferences: TuiPreferences;
  recentRuns: RunEntity[];
  recentRunsQuery: string;
  selectedRecentRunIndex: number;
  selectedThemeIndex: number;
  selectedReportSurfaceIndex: number;
  runStartedAt: number | null;
  thinkingTick: number;
  browserReportPath: string | null;
  terminalWidth: number;
}

export function ArtbotInteractiveShell(props: ArtbotInteractiveShellProps) {
  const stackMain =
    props.preferences.diffLayout === "stacked" ||
    (props.preferences.diffLayout === "auto" && props.terminalWidth < 124);

  const showSidePane = props.sidePane !== "none";

  return (
    <Box flexDirection="column">
      <TopStatusStrip
        theme={props.theme}
        assessment={props.assessment}
        primaryView={props.primaryView}
        overlay={props.overlay}
        focusTarget={props.focusTarget}
        preferences={props.preferences}
        thinkingTick={props.thinkingTick}
      />
      <Box flexDirection={stackMain ? "column" : "row"} marginTop={1}>
        <Box flexGrow={3} marginRight={!stackMain && showSidePane ? 1 : 0} marginBottom={stackMain && showSidePane ? 1 : 0}>
          <PrimaryPane
            theme={props.theme}
            assessment={props.assessment}
            displayedRun={props.displayedRun}
            activeArtist={props.activeArtist}
            primaryView={props.primaryView}
            runStartedAt={props.runStartedAt}
            thinkingTick={props.thinkingTick}
            focusTarget={props.focusTarget}
          />
        </Box>
        {showSidePane ? (
          <Box flexGrow={stackMain ? 0 : 2}>
            <SidePanePanel
              theme={props.theme}
              assessment={props.assessment}
              displayedRun={props.displayedRun}
              sidePane={props.sidePane}
              browserReportPath={props.browserReportPath}
              focusTarget={props.focusTarget}
            />
          </Box>
        ) : null}
      </Box>
      {props.overlay !== "none" ? (
        <Box marginTop={1}>
          <OverlayPanel
            theme={props.theme}
            overlay={props.overlay}
            recentRuns={props.recentRuns}
            recentRunsQuery={props.recentRunsQuery}
            selectedRecentRunIndex={props.selectedRecentRunIndex}
            selectedThemeIndex={props.selectedThemeIndex}
            selectedReportSurfaceIndex={props.selectedReportSurfaceIndex}
          />
        </Box>
      ) : null}
    </Box>
  );
}

interface TuiKeyHintRailProps {
  theme: TuiTheme;
  overlay: Overlay;
}

export function TuiKeyHintRail({ theme, overlay }: TuiKeyHintRailProps) {
  const items =
    overlay === "recent-runs"
      ? [
          { key: "↑/↓", label: "navigate" },
          { key: "Enter", label: "open" },
          { key: "Esc", label: "close" }
        ]
      : overlay === "theme-picker"
        ? [
            { key: "↑/↓", label: "preview" },
            { key: "Enter", label: "save" },
            { key: "Esc", label: "cancel" }
          ]
        : overlay === "report-surface"
          ? [
              { key: "↑/↓", label: "choose" },
              { key: "Enter", label: "confirm" },
              { key: "Esc", label: "close" }
            ]
        : overlay === "help"
          ? [{ key: "Esc", label: "close" }]
          : [
              { key: "Ctrl+K", label: "help" },
              { key: "Ctrl+R", label: "runs" },
              { key: "Ctrl+S", label: "setup" },
              { key: "Ctrl+T", label: "theme" },
              { key: "Ctrl+U", label: "pane" }
            ];

  return (
    <Box flexDirection="row" marginTop={1} justifyContent="space-between">
      <Text color={theme.colors.muted}>Keyboard</Text>
      <Box>
        {items.map((item, index) => (
          <Box key={`${item.key}-${item.label}`} marginLeft={index === 0 ? 0 : 2}>
            <Text color={theme.colors.keycap} bold>
              [{item.key}]
            </Text>
            <Text color={theme.colors.muted}> {item.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function TopStatusStrip(props: {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  primaryView: PrimaryView;
  overlay: Overlay;
  focusTarget: FocusTarget;
  preferences: TuiPreferences;
  thinkingTick: number;
}) {
  const modeLabel =
    props.overlay !== "none"
      ? props.overlay.replace("-", " ")
      : props.primaryView === "idle"
        ? "ready"
        : props.primaryView;
  const modelId = props.assessment?.llmHealth.modelId;
  const quantization = extractQuantization(modelId);
  const activeSessions = props.assessment?.sessionStates.filter((session) => session.exists && !session.expired).length ?? 0;
  const totalSessions = props.assessment?.sessionStates.length ?? 0;
  const sandboxLabel = resolveSandboxMode();
  const thinkingActive = props.primaryView === "running";
  const thinkingPulse = thinkingActive ? buildKnightRiderPulse(props.thinkingTick, 14) : "idle";

  return (
    <Panel
      theme={props.theme}
      title="ArtBot"
      subtitle={`Local-first inference shell · privacy-first mode · ${props.preferences.theme} theme · ${props.preferences.diffLayout} layout`}
    >
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Box>
            <InlineChip theme={props.theme} tone="accent" label={`MODE ${modeLabel.toUpperCase()}`} />
            <InlineChip theme={props.theme} tone="muted" label={`FOCUS ${props.focusTarget.toUpperCase()}`} />
            <InlineChip theme={props.theme} tone="local" label="CLOUD OFFLINE (LOCAL-ONLY)" />
            <InlineChip theme={props.theme} tone="local" label="PRIVACY LOCKED" />
            <InlineChip theme={props.theme} tone="sandbox" label={sandboxLabel} />
          </Box>
          <Box>
            <StatusChip
              theme={props.theme}
              label="LM"
              state={props.assessment?.llmHealth.ok ? "healthy" : "offline"}
              detail={modelId ?? props.assessment?.llmHealth.reason ?? "checking"}
            />
            <StatusChip
              theme={props.theme}
              label="API"
              state={props.assessment?.apiHealth.ok ? "healthy" : "offline"}
              detail={props.assessment?.apiHealth.reason ?? props.assessment?.apiBaseUrl ?? "checking"}
            />
            <StatusChip
              theme={props.theme}
              label="Auth"
              state={props.assessment ? (activeSessions > 0 ? "healthy" : "degraded") : "unknown"}
              detail={props.assessment ? `${activeSessions}/${totalSessions}` : "checking"}
            />
          </Box>
        </Box>
        <Box marginTop={1} justifyContent="space-between" flexWrap="wrap">
          <Box>
            <InlineChip
              theme={props.theme}
              tone={thinkingActive ? "thinking" : "muted"}
              label={thinkingActive ? `THINKING ${thinkingPulse}` : "THINKING IDLE"}
            />
          </Box>
          <Box>
            <InlineChip theme={props.theme} tone="muted" label={`MODEL ${truncate(modelId ?? "not loaded", 32)}`} />
            <InlineChip
              theme={props.theme}
              tone={quantization === "unknown" ? "warning" : "local"}
              label={`QUANT ${quantization.toUpperCase()}`}
            />
          </Box>
        </Box>
      </Box>
    </Panel>
  );
}

function PrimaryPane(props: {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  displayedRun: PipelineDetails | null;
  activeArtist: string;
  primaryView: PrimaryView;
  runStartedAt: number | null;
  thinkingTick: number;
  focusTarget: FocusTarget;
}) {
  if (props.primaryView === "idle") {
    return (
      <Panel
        theme={props.theme}
        title="Ready"
        subtitle="Prompt-first local shell with privacy badges, overlays, and low-latency command flow."
        accentColor={props.focusTarget === "main" ? props.theme.colors.selection : undefined}
      >
        <Text color={props.theme.colors.text} bold>
          Start with a plain artist name or use a command.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.accent}>/research &lt;artist&gt;</Text>
          <Text color={props.theme.colors.accent}>/work &lt;artist&gt; --title &lt;title&gt;</Text>
          <Text color={props.theme.colors.accent}>/runs</Text>
          <Text color={props.theme.colors.accent}>/setup</Text>
          <Text color={props.theme.colors.accent}>/theme</Text>
        </Box>
        <Box marginTop={1}>
          <Metric tone="success" theme={props.theme} label="API" value={props.assessment?.apiHealth.ok ? "ready" : "offline"} />
          <Metric tone="accent" theme={props.theme} label="Profiles" value={String(props.assessment?.profiles.length ?? 0)} />
          <Metric
            tone={props.assessment?.issues.length ? "warning" : "success"}
            theme={props.theme}
            label="Setup"
            value={props.assessment?.issues.length ? `${props.assessment.issues.length} issues` : "healthy"}
          />
        </Box>
      </Panel>
    );
  }

  const run = props.displayedRun;
  const summary = run?.summary;
  const records = run?.records ?? [];
  const attempts = run?.attempts ?? [];
  const elapsed = props.runStartedAt ? formatElapsed(Math.floor((Date.now() - props.runStartedAt) / 1000)) : undefined;
  const coverage = Math.round(
    (summary?.evaluation_metrics?.valuation_readiness_ratio
      ?? summary?.priced_crawled_source_coverage_ratio
      ?? summary?.priced_source_coverage_ratio
      ?? 0) * 100
  );
  const tone = props.primaryView === "completed" ? "success" : props.primaryView === "failed" ? "danger" : "accent";

  return (
    <Panel
      theme={props.theme}
      title={props.activeArtist || "Active Run"}
      subtitle={`${run?.run?.status ?? "unknown"} · ${run?.run?.id ?? "n/a"}${run?.run?.pinned ? " · pinned" : ""}${elapsed ? ` · ${elapsed}` : ""}`}
      accentColor={props.focusTarget === "main" ? props.theme.colors.selection : undefined}
    >
      <Box>
        <Metric tone={tone} theme={props.theme} label="Accepted" value={String(summary?.accepted_records ?? 0)} />
        <Metric tone="accent" theme={props.theme} label="Coverage" value={`${coverage}%`} />
        <Metric tone="muted" theme={props.theme} label="Attempts" value={String(summary?.total_attempts ?? attempts.length)} />
        <Metric
          tone={summary?.valuation_generated ? "success" : "warning"}
          theme={props.theme}
          label="Valuation"
          value={summary?.valuation_generated ? "ready" : "pending"}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {buildStageRows(run, props.theme, props.thinkingTick).map((stage) => (
          <Text key={stage.label} color={stage.color}>
            {stage.symbol} {stage.label}
            <Text color={props.theme.colors.muted}> {stage.detail}</Text>
          </Text>
        ))}
      </Box>
      {records.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>Accepted Records</Text>
          {records.slice(0, 6).map((record, index) => (
            <RecordRow key={`${record.source_name}-${record.work_title ?? index}`} record={record} theme={props.theme} />
          ))}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>Evidence Snapshot</Text>
          {attempts.slice(0, 6).map((attempt) => {
            const tone = accessTone(props.theme, attempt.source_access_status);
            return (
            <Text key={attempt.source_url} color={tone.color}>
              {tone.symbol} {truncate(attempt.source_url, 88)}
              <Text color={props.theme.colors.muted}> · {attempt.source_access_status}</Text>
            </Text>
            );
          })}
        </Box>
      )}
    </Panel>
  );
}

function SidePanePanel(props: {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  displayedRun: PipelineDetails | null;
  sidePane: SidePane;
  browserReportPath: string | null;
  focusTarget: FocusTarget;
}) {
  if (props.sidePane === "setup") {
    return (
      <Panel
        theme={props.theme}
        title="Setup"
        subtitle="Health issues and next actions"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {props.assessment?.issues.length ? (
          props.assessment.issues.map((issue) => (
            <Text key={`${issue.code}-${issue.message}`} color={issue.severity === "error" ? props.theme.colors.danger : props.theme.colors.warning}>
              {issue.severity === "error" ? "✗" : "!"} {issue.message}
              {issue.detail ? <Text color={props.theme.colors.muted}> · {truncate(issue.detail, 64)}</Text> : null}
            </Text>
          ))
        ) : (
          <Text color={props.theme.colors.success}>✓ No setup issues detected.</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>Next</Text>
          <Text color={props.theme.colors.text}>Run <Text color={props.theme.colors.accent}>/setup</Text> to refresh diagnostics.</Text>
          <Text color={props.theme.colors.text}>Run <Text color={props.theme.colors.accent}>artbot setup</Text> for the guided wizard.</Text>
        </Box>
      </Panel>
    );
  }

  if (props.sidePane === "auth") {
    return (
      <Panel
        theme={props.theme}
        title="Auth"
        subtitle="Saved browser sessions"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {(props.assessment?.sessionStates ?? []).map((session) => {
          const tone = session.riskyReason
            ? props.theme.colors.warning
            : session.exists
              ? (session.expired ? props.theme.colors.warning : props.theme.colors.success)
              : props.theme.colors.danger;
          return (
            <Box key={session.profileId} flexDirection="column" marginBottom={1}>
              <Text color={tone}>
                {session.profileId}: {session.exists ? (session.expired ? "expired" : "ready") : "missing"} · {session.encryptedAtRest ? "encrypted" : "plaintext"}
              </Text>
              <Text color={props.theme.colors.muted}>{session.storageStatePath}</Text>
              {session.riskyReason ? <Text color={props.theme.colors.warning}>{session.riskyReason}</Text> : null}
            </Box>
          );
        })}
      </Panel>
    );
  }

  return (
    <Panel
      theme={props.theme}
      title="Run Details"
      subtitle="Context, artifacts, and blockers"
      accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
    >
      <Text color={props.theme.colors.text}>Run id: {props.displayedRun?.run?.id ?? "n/a"}</Text>
      <Text color={props.theme.colors.text}>Status: {props.displayedRun?.run?.status ?? "n/a"}</Text>
      <Text color={props.theme.colors.text}>Retention: {props.displayedRun?.run?.pinned ? "pinned" : "default"}</Text>
      <Text color={props.theme.colors.text}>Results: {truncate(props.displayedRun?.run?.resultsPath ?? "n/a", 54)}</Text>
      <Text color={props.theme.colors.text}>Report: {truncate(props.displayedRun?.run?.reportPath ?? props.browserReportPath ?? "n/a", 54)}</Text>
      {topBlocker(props.displayedRun) ? (
        <Text color={props.theme.colors.warning}>Top blocker: {topBlocker(props.displayedRun)}</Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={props.theme.colors.muted}>Evidence</Text>
        {(props.displayedRun?.attempts ?? []).slice(0, 5).map((attempt) => (
          <Text key={attempt.source_url} color={props.theme.colors.text}>
            {truncate(attempt.source_url, 52)}
          </Text>
        ))}
      </Box>
    </Panel>
  );
}

function OverlayPanel(props: {
  theme: TuiTheme;
  overlay: Overlay;
  recentRuns: RunEntity[];
  recentRunsQuery: string;
  selectedRecentRunIndex: number;
  selectedThemeIndex: number;
  selectedReportSurfaceIndex: number;
}) {
  if (props.overlay === "help") {
    return (
      <Panel theme={props.theme} title="Help" subtitle="Commands and keyboard shortcuts" accentColor={props.theme.colors.overlayBorder}>
        <Text color={props.theme.colors.muted}>Commands</Text>
        <Text color={props.theme.colors.accent}>/research &lt;artist&gt;</Text>
        <Text color={props.theme.colors.accent}>/work &lt;artist&gt; --title &lt;title&gt;</Text>
        <Text color={props.theme.colors.accent}>/runs</Text>
        <Text color={props.theme.colors.accent}>/setup</Text>
        <Text color={props.theme.colors.accent}>/auth</Text>
        <Text color={props.theme.colors.accent}>/theme</Text>
        <Text color={props.theme.colors.accent}>/report cli | /report web</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>Shortcuts</Text>
          <Text color={props.theme.colors.text}>Ctrl+K help · Ctrl+R runs · Ctrl+S setup · Ctrl+T theme · Ctrl+U pane</Text>
        </Box>
      </Panel>
    );
  }

  if (props.overlay === "theme-picker") {
    const options = getTuiThemeOptions();
    return (
      <Panel theme={props.theme} title="Theme Picker" subtitle="Preview with arrows, save with Enter" accentColor={props.theme.colors.overlayBorder}>
        {options.map((option, index) => {
          const selected = index === props.selectedThemeIndex;
          return (
            <Text key={option.name} color={selected ? props.theme.colors.selection : props.theme.colors.text}>
              {selected ? "›" : " "} {option.label}
              <Text color={props.theme.colors.muted}> ({option.name})</Text>
            </Text>
          );
        })}
      </Panel>
    );
  }

  if (props.overlay === "report-surface") {
    return (
      <Panel
        theme={props.theme}
        title="Completed Run"
        subtitle="Choose how to view the finished report"
        accentColor={props.theme.colors.overlayBorder}
      >
        {COMPLETED_REPORT_SURFACE_OPTIONS.map((option, index) => {
          const selected = index === props.selectedReportSurfaceIndex;
          return (
            <Box key={option.value} flexDirection="column" marginBottom={1}>
              <Text color={selected ? props.theme.colors.selection : props.theme.colors.text}>
                {selected ? "›" : " "} {option.label}
              </Text>
              <Text color={props.theme.colors.muted}>{option.hint}</Text>
            </Box>
          );
        })}
      </Panel>
    );
  }

  const filtered = props.recentRuns;
  return (
    <Panel
      theme={props.theme}
      title="Recent Runs"
      subtitle={props.recentRunsQuery ? `Filter: ${props.recentRunsQuery}` : "Search by artist, run id, status, or type"}
      accentColor={props.theme.colors.overlayBorder}
    >
      {filtered.length === 0 ? (
        <Text color={props.theme.colors.muted}>No runs matched the current filter.</Text>
      ) : (
        filtered.map((run, index) => {
          const selected = index === props.selectedRecentRunIndex;
          return (
            <Box key={run.id} flexDirection="column" marginBottom={1}>
              <Text color={selected ? props.theme.colors.selection : props.theme.colors.text}>
                {selected ? "›" : " "} {run.query.artist} · {run.status}
                <Text color={props.theme.colors.muted}> · {run.runType}{run.pinned ? " · pinned" : ""}</Text>
              </Text>
              <Text color={props.theme.colors.muted}>{run.id} · {formatTimestamp(run.updatedAt)}</Text>
            </Box>
          );
        })
      )}
    </Panel>
  );
}

function Panel(props: {
  theme: TuiTheme;
  title: string;
  subtitle?: string;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.accentColor ?? props.theme.colors.panelBorder}
      paddingX={1}
      paddingY={0}
    >
      <Text color={props.accentColor ?? props.theme.colors.accent} bold>
        {props.title}
      </Text>
      {props.subtitle ? (
        <Text color={props.theme.colors.muted} dimColor>
          {props.subtitle}
        </Text>
      ) : null}
      {props.children}
    </Box>
  );
}

function Metric(props: { theme: TuiTheme; label: string; value: string; tone: "accent" | "success" | "warning" | "danger" | "muted" }) {
  const color =
    props.tone === "success"
      ? props.theme.colors.success
      : props.tone === "warning"
        ? props.theme.colors.warning
        : props.tone === "danger"
          ? props.theme.colors.danger
          : props.tone === "muted"
            ? props.theme.colors.muted
            : props.theme.colors.accent;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={props.theme.colors.muted}>{props.label}</Text>
      <Text color={color} bold>
        {props.value}
      </Text>
    </Box>
  );
}

function StatusChip(props: {
  theme: TuiTheme;
  label: string;
  state: "healthy" | "degraded" | "offline" | "unknown";
  detail: string;
}) {
  const color =
    props.state === "healthy"
      ? props.theme.colors.success
      : props.state === "degraded"
        ? props.theme.colors.warning
        : props.state === "offline"
          ? props.theme.colors.danger
          : props.theme.colors.muted;

  return (
    <Box marginLeft={2}>
      <Text color={color}>● {props.label}</Text>
      <Text color={props.theme.colors.muted}>: {truncate(props.detail, 22)}</Text>
    </Box>
  );
}

function InlineChip(props: {
  theme: TuiTheme;
  tone: "accent" | "muted" | "local" | "thinking" | "warning" | "sandbox";
  label: string;
}) {
  const color =
    props.tone === "accent"
      ? props.theme.colors.accent
      : props.tone === "local"
        ? props.theme.colors.localActive
        : props.tone === "thinking"
          ? props.theme.colors.thinking
          : props.tone === "warning"
            ? props.theme.colors.warning
            : props.tone === "sandbox"
              ? props.theme.colors.sandbox
              : props.theme.colors.muted;

  return (
    <Box marginRight={2}>
      <Text color={color} bold={props.tone !== "muted"}>
        {props.label}
      </Text>
    </Box>
  );
}

function resolveSandboxMode(): string {
  const airGapped = (process.env.ARTBOT_AIR_GAPPED ?? "").trim().toLowerCase();
  if (airGapped === "1" || airGapped === "true" || airGapped === "yes") {
    return "ISOLATED: NO-NETWORK";
  }

  const mode = (process.env.ARTBOT_SANDBOX_MODE ?? "").trim();
  if (mode) {
    return `ISOLATED: ${mode.toUpperCase()}`;
  }

  return "ISOLATED: LOCAL-RUNTIME";
}

export function extractQuantization(modelId: string | undefined): string {
  if (!modelId) return "unknown";

  const patterns = [
    /\b(q\d(?:[_-][a-z0-9]+)+)\b/i,
    /\b(q\d+[a-z0-9_-]*)\b/i,
    /\b(fp16|fp8|bf16|int8|int4)\b/i
  ];

  for (const pattern of patterns) {
    const match = modelId.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/-/g, "_");
    }
  }

  return "unknown";
}

export function buildKnightRiderPulse(tick: number, width = 14): string {
  const trackWidth = Math.max(6, Math.floor(width));
  const cycle = trackWidth * 2 - 2;
  const offset = ((tick % cycle) + cycle) % cycle;
  const head = offset < trackWidth ? offset : cycle - offset;

  let frame = "";
  for (let index = 0; index < trackWidth; index += 1) {
    const distance = Math.abs(index - head);
    frame += distance === 0 ? "█" : distance === 1 ? "▓" : distance === 2 ? "▒" : "░";
  }

  return frame;
}

export function getRunningSpinnerFrame(tick: number): string {
  const offset = Math.abs(Math.floor(tick));
  return RUNNING_SPINNER_FRAMES[offset % RUNNING_SPINNER_FRAMES.length] ?? RUNNING_SPINNER_FRAMES[0]!;
}

function RecordRow(props: {
  theme: TuiTheme;
  record: {
    normalized_price_usd_nominal?: number | null;
    normalized_price_usd?: number | null;
    price_amount?: number | null;
    currency?: string;
    estimate_low?: number | null;
    estimate_high?: number | null;
    price_type?: string;
    price_hidden?: boolean;
    work_title?: string | null;
    source_name: string;
  };
}) {
  const price = priceLabel(props.record);
  return (
    <Text color={props.theme.colors.text}>
      {truncate(price, 14).padEnd(14)} {truncate(props.record.source_name, 18).padEnd(18)} {truncate(props.record.work_title ?? "Untitled", 44)}
    </Text>
  );
}

export function buildStageRows(
  details: PipelineDetails | null,
  theme: TuiTheme,
  tick: number
): Array<{ symbol: string; label: string; detail: string; color: string }> {
  const summary = details?.summary;
  const status = details?.run?.status;
  const spinner = getRunningSpinnerFrame(tick);
  const queueRunning = status === "pending";
  const scanRunning = status === "running" && !summary;
  const analyzeRunning = status === "running" && Boolean(summary);

  return [
    {
      symbol: queueRunning ? spinner : status ? "✓" : "○",
      label: "Queue",
      detail: queueRunning ? "waiting" : status ? "passed" : "pending",
      color: queueRunning ? theme.colors.thinking : status ? theme.colors.success : theme.colors.muted
    },
    {
      symbol: summary ? "✓" : scanRunning ? spinner : "○",
      label: "Scan",
      detail: summary ? `${summary.total_attempts ?? 0} attempts` : scanRunning ? "running" : "queued",
      color: summary ? theme.colors.success : scanRunning ? theme.colors.thinking : theme.colors.muted
    },
    {
      symbol: status === "failed" ? "✗" : summary ? (analyzeRunning ? spinner : "✓") : "○",
      label: "Analyze",
      detail: summary ? `${summary.accepted_records ?? 0} accepted` : status === "failed" ? "failed" : "pending",
      color:
        status === "failed"
          ? theme.colors.danger
          : summary
            ? analyzeRunning
              ? theme.colors.thinking
              : theme.colors.success
            : theme.colors.muted
    },
    {
      symbol: status === "completed" ? "✓" : status === "failed" ? "✗" : "○",
      label: "Report",
      detail: status === "completed" ? "ready" : status === "failed" ? "failed" : "pending",
      color: status === "completed" ? theme.colors.success : status === "failed" ? theme.colors.danger : theme.colors.muted
    }
  ];
}

function accessTone(theme: TuiTheme, accessStatus: string): { color: string; symbol: string } {
  switch (accessStatus) {
    case "public_access":
      return { color: theme.colors.success, symbol: "✓" };
    case "licensed_access":
      return { color: theme.colors.accent, symbol: "◆" };
    case "auth_required":
      return { color: theme.colors.warning, symbol: "!" };
    case "blocked":
      return { color: theme.colors.danger, symbol: "✗" };
    default:
      return { color: theme.colors.muted, symbol: "•" };
  }
}

function topBlocker(details: PipelineDetails | null): string | null {
  const breakdown = details?.summary?.acceptance_reason_breakdown;
  if (!breakdown) return null;

  const entries = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;
  return `${entries[0][0]} (${entries[0][1]})`;
}

function priceLabel(record: {
  normalized_price_usd_nominal?: number | null;
  normalized_price_usd?: number | null;
  price_amount?: number | null;
  currency?: string;
  estimate_low?: number | null;
  estimate_high?: number | null;
  price_type?: string;
  price_hidden?: boolean;
}): string {
  if (typeof record.normalized_price_usd_nominal === "number") return fmtCurrency(record.normalized_price_usd_nominal, "USD");
  if (typeof record.normalized_price_usd === "number") return fmtCurrency(record.normalized_price_usd, "USD");
  if (typeof record.price_amount === "number") return fmtCurrency(record.price_amount, record.currency ?? "TRY");
  if (typeof record.estimate_low === "number" && typeof record.estimate_high === "number") {
    return `${fmtCurrency(record.estimate_low, record.currency ?? "TRY")}–${fmtCurrency(record.estimate_high, record.currency ?? "TRY")}`;
  }
  if (record.price_type === "inquiry_only" || record.price_hidden) return "Inquiry only";
  return "n/a";
}

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatTimestamp(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
