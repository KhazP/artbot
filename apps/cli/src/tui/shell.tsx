import React from "react";
import { Box, Text } from "ink";
import type { RunEntity } from "@artbot/shared-types";
import { translate, type AppLocale } from "../i18n.js";
import type { SetupAssessment } from "../setup/index.js";
import type { TuiPreferences } from "./preferences.js";
import { RUNNING_SPINNER_FRAMES } from "./run-progress-view.js";
import { COMPLETED_REPORT_SURFACE_OPTIONS, type FocusTarget, type Overlay, type PipelineDetails, type PrimaryView, type SidePane } from "./state.js";
import { getTuiThemeOptions, type TuiTheme } from "./theme.js";
import { buildErrorLogModel } from "./view-models/error-log.js";
import { buildFxCacheModel } from "./view-models/fx-cache.js";
import { buildNormalizationInspectorModel } from "./view-models/normalization-inspector.js";
import { buildReviewQueueModel } from "./view-models/review-queue.js";
import { buildSourceMonitorModel } from "./view-models/source-monitor.js";

interface ArtbotInteractiveShellProps {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  displayedRun: PipelineDetails | null;
  activeArtist: string;
  locale: AppLocale;
  primaryView: PrimaryView;
  sidePane: SidePane;
  overlay: Overlay;
  focusTarget: FocusTarget;
  preferences: TuiPreferences;
  recentRuns: RunEntity[];
  recentRunsQuery: string;
  selectedRecentRunIndex: number;
  selectedSettingsIndex: number;
  selectedReportSurfaceIndex: number;
  runStartedAt: number | null;
  thinkingTick: number;
  browserReportPath: string | null;
  fxCacheStats?: PipelineDetails["fx_cache_stats"];
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
        locale={props.locale}
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
            locale={props.locale}
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
              locale={props.locale}
              browserReportPath={props.browserReportPath}
              fxCacheStats={props.fxCacheStats}
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
            locale={props.locale}
            recentRuns={props.recentRuns}
            recentRunsQuery={props.recentRunsQuery}
            selectedRecentRunIndex={props.selectedRecentRunIndex}
            selectedSettingsIndex={props.selectedSettingsIndex}
            preferences={props.preferences}
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
  locale: AppLocale;
}

export function TuiKeyHintRail({ theme, overlay, locale }: TuiKeyHintRailProps) {
  const items =
    overlay === "recent-runs"
      ? [
          { key: "↑/↓", label: "navigate" },
          { key: "Enter", label: "open" },
          { key: "Esc", label: "close" }
        ]
      : overlay === "settings"
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
                { key: "Ctrl+T", label: translate(locale, "tui.overlay.settings.title").toLowerCase() },
                { key: "Ctrl+U", label: "pane" }
              ];

  return (
    <Box flexDirection="row" marginTop={1}>
      {items.map((item, index) => (
        <Box key={`${item.key}-${item.label}`} marginLeft={index === 0 ? 0 : 2}>
          <Text color={theme.colors.keycap} bold>
            {item.key}
          </Text>
          <Text color={theme.colors.muted}> {item.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

function TopStatusStrip(props: {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  primaryView: PrimaryView;
  overlay: Overlay;
  focusTarget: FocusTarget;
  locale: AppLocale;
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
  const activeSessions = props.assessment?.sessionStates.filter((session) => session.exists && !session.expired).length ?? 0;
  const totalSessions = props.assessment?.sessionStates.length ?? 0;
  const issueCount = resolveIssueList(props.assessment).length;
  const modeTone =
    props.primaryView === "failed"
      ? "warning"
      : props.primaryView === "running"
        ? "thinking"
        : props.primaryView === "completed"
          ? "local"
          : "accent";

  return (
    <Box justifyContent="space-between" flexWrap="wrap">
      <Box>
        <Text color={props.theme.colors.accent} bold>ArtBot</Text>
        <Text color={props.theme.colors.muted}> · </Text>
        <InlineChip theme={props.theme} tone={modeTone} label={modeLabel.toUpperCase()} />
      </Box>
      <Box>
        <StatusDot
          theme={props.theme}
          label="LLM"
          ok={Boolean(props.assessment?.llmHealth.ok)}
          detail={truncate(modelId ?? props.assessment?.llmHealth.reason ?? "checking", 28)}
        />
        <StatusDot
          theme={props.theme}
          label="API"
          ok={Boolean(props.assessment?.apiHealth.ok)}
          detail={props.assessment?.apiHealth.ok ? "ready" : truncate(props.assessment?.apiHealth.reason ?? "checking", 24)}
        />
        <StatusDot
          theme={props.theme}
          label="Auth"
          ok={activeSessions > 0}
          detail={props.assessment ? `${activeSessions}/${totalSessions}` : "checking"}
        />
        {issueCount ? (
          <Box marginLeft={2}>
            <InlineChip theme={props.theme} tone="warning" label={`${issueCount} setup`} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function PrimaryPane(props: {
  theme: TuiTheme;
  assessment: SetupAssessment | null;
  displayedRun: PipelineDetails | null;
  activeArtist: string;
  locale: AppLocale;
  primaryView: PrimaryView;
  runStartedAt: number | null;
  thinkingTick: number;
  focusTarget: FocusTarget;
}) {
  if (props.primaryView === "idle") {
    const issueCount = resolveIssueList(props.assessment).length;
    return (
      <Panel
        theme={props.theme}
        title="Start"
        accentColor={props.focusTarget === "main" ? props.theme.colors.selection : undefined}
      >
        <Text color={props.theme.colors.text} bold>
          Type an artist name, or use a command.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <CommandActionRows
            theme={props.theme}
            rows={[
              { command: "/research <artist>", detail: "artist market research" },
              { command: "/work <artist> --title <title>", detail: "specific artwork" },
              { command: "/runs", detail: "recent runs" },
              { command: "/setup", detail: issueCount ? `${issueCount} setup items` : "setup is healthy" },
              { command: "/help", detail: "all commands" }
            ]}
          />
        </Box>
        {props.assessment?.recommendedNextAction ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={issueCount ? props.theme.colors.warning : props.theme.colors.muted}>
              Setup: {props.assessment.recommendedNextAction}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexWrap="wrap">
          <ReadinessItem theme={props.theme} label="API" value={props.assessment?.apiHealth.ok ? "ready" : "offline"} tone={props.assessment?.apiHealth.ok ? "success" : "danger"} />
          <ReadinessItem theme={props.theme} label="Profiles" value={String(props.assessment?.profiles.length ?? 0)} tone="accent" />
          <ReadinessItem theme={props.theme} label="Setup" value={issueCount ? `${issueCount} items` : "healthy"} tone={issueCount ? "warning" : "success"} />
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
        {buildStageRows(run, props.theme).map((stage) => (
          <Text key={stage.label} color={stage.color}>
            {stage.symbol} {stage.label}
            <Text color={props.theme.colors.muted}> {stage.detail}</Text>
          </Text>
        ))}
      </Box>
      {records.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>Accepted Records</Text>
          {records.slice(0, 6).map((record, index) => {
            const price = priceLabel(record);
            return (
              <Text key={`${record.source_name}-${record.work_title ?? index}`} color={props.theme.colors.text}>
                {truncate(price, 14).padEnd(14)} {truncate(record.source_name, 18).padEnd(18)} {truncate(record.work_title ?? "Untitled", 44)}
              </Text>
            );
          })}
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
  locale: AppLocale;
  browserReportPath: string | null;
  fxCacheStats?: PipelineDetails["fx_cache_stats"];
  focusTarget: FocusTarget;
}) {
  if (props.sidePane === "setup") {
    const issues = resolveIssueList(props.assessment);
    const blockingIssues = props.assessment?.blockingIssues ?? [];
    const optionalIssues = props.assessment?.optionalIssues ?? [];
    return (
      <Panel
        theme={props.theme}
        title={translate(props.locale, "tui.shell.setupTitle")}
        subtitle={translate(props.locale, "tui.shell.setupSubtitle")}
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {issues.length ? (
          issues.map((issue) => (
            <Text key={`${issue.code}-${issue.message}`} color={issue.severity === "error" ? props.theme.colors.danger : props.theme.colors.warning}>
              {issue.severity === "error" ? "✗" : "!"} {issue.message}
              {issue.detail ? <Text color={props.theme.colors.muted}> · {truncate(issue.detail, 64)}</Text> : null}
            </Text>
          ))
        ) : (
          <Text color={props.theme.colors.success}>✓ {translate(props.locale, "setup.issues.none")}</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>{translate(props.locale, "tui.shell.setupNext")}</Text>
          {props.assessment?.recommendedNextAction ? <Text color={props.theme.colors.text}>{props.assessment.recommendedNextAction}</Text> : null}
          {blockingIssues.length ? <Text color={props.theme.colors.danger}>Blocking: {blockingIssues.length}</Text> : null}
          {optionalIssues.length ? <Text color={props.theme.colors.warning}>Optional: {optionalIssues.length}</Text> : null}
          <Text color={props.theme.colors.text}>{translate(props.locale, "tui.shell.setupRefresh")}</Text>
          <Text color={props.theme.colors.text}>{translate(props.locale, "tui.shell.setupGuided")}</Text>
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

  if (props.sidePane === "normalization") {
    const model = buildNormalizationInspectorModel(props.displayedRun);
    return (
      <Panel
        theme={props.theme}
        title="Normalization"
        subtitle="Raw token, currency era interpretation, and historical/current FX outputs"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {model.entries.length === 0 ? (
          <Text color={props.theme.colors.muted}>No normalized records are available for inspection yet.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={props.theme.colors.muted}>Showing {model.entries.length} of {model.totalRecords} accepted records</Text>
            {model.entries.map((entry) => (
              <Box key={`${entry.sourceName}-${entry.title}`} flexDirection="column" marginTop={1}>
                <Text color={props.theme.colors.text}>{truncate(entry.title, 36)} <Text color={props.theme.colors.muted}>· {truncate(entry.sourceName, 18)}</Text></Text>
                <Text color={props.theme.colors.text}>{truncate(entry.originalLine, 68)}</Text>
                <Text color={props.theme.colors.text}>{truncate(entry.interpretedLine, 68)}</Text>
                <Text color={props.theme.colors.text}>{truncate(entry.historicalLine, 68)}</Text>
                <Text color={props.theme.colors.text}>{truncate(entry.inflationLine, 68)}</Text>
                <Text color={props.theme.colors.text}>{truncate(entry.currentLine, 68)}</Text>
                <Text color={props.theme.colors.muted}>{truncate(entry.confidenceLine, 68)}</Text>
                {entry.warnings.slice(0, 2).map((warning) => (
                  <Text key={warning} color={props.theme.colors.warning}>! {truncate(warning, 66)}</Text>
                ))}
              </Box>
            ))}
          </Box>
        )}
      </Panel>
    );
  }

  if (props.sidePane === "sources") {
    const entries = buildSourceMonitorModel(props.displayedRun);
    return (
      <Panel
        theme={props.theme}
        title="Sources"
        subtitle="Attempts, priced outcomes, and auth/block status by source"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {entries.length === 0 ? (
          <Text color={props.theme.colors.muted}>No source activity is available for the current run.</Text>
        ) : (
          entries.map((entry) => (
            <Text key={entry.sourceName} color={props.theme.colors.text}>
              {truncate(entry.sourceName, 18).padEnd(18)} a={String(entry.attempts).padStart(2)} p={String(entry.priced).padStart(2)} b={String(entry.blocked).padStart(2)} auth={String(entry.authRequired).padStart(2)}
            </Text>
          ))
        )}
      </Panel>
    );
  }

  if (props.sidePane === "review") {
    const items = buildReviewQueueModel(props.displayedRun);
    return (
      <Panel
        theme={props.theme}
        title="Review Queue"
        subtitle="Use /review merge <id> or /review keep <id> on the active run"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {items.length === 0 ? (
          <Text color={props.theme.colors.muted}>No review items are queued for the current run.</Text>
        ) : (
          items.map((item) => (
            <Box key={item.id} flexDirection="column" marginBottom={1}>
              <Text color={props.theme.colors.text}>{truncate(item.label, 42)}</Text>
              <Text color={props.theme.colors.muted}>{item.id}</Text>
              <Text color={props.theme.colors.text}>{truncate(item.detail, 56)}</Text>
            </Box>
          ))
        )}
      </Panel>
    );
  }

  if (props.sidePane === "fx") {
    const model = buildFxCacheModel(props.displayedRun, props.fxCacheStats);
    return (
      <Panel
        theme={props.theme}
        title="FX Cache"
        subtitle="SQLite-backed historical/current rate cache state"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        <Text color={props.theme.colors.text}>Rows: {model.totalRows}</Text>
        <Text color={props.theme.colors.text}>Dates: {model.uniqueDates}</Text>
        <Text color={props.theme.colors.text}>Latest: {model.latestDate ?? "n/a"}</Text>
        <Box marginTop={1} flexDirection="column">
          {model.sourceLines.length === 0 ? (
            <Text color={props.theme.colors.muted}>No FX cache rows are available yet.</Text>
          ) : (
            model.sourceLines.map((line) => (
              <Text key={line} color={props.theme.colors.text}>{line}</Text>
            ))
          )}
        </Box>
      </Panel>
    );
  }

  if (props.sidePane === "errors") {
    const entries = buildErrorLogModel(props.displayedRun);
    return (
      <Panel
        theme={props.theme}
        title="Errors"
        subtitle="Recent transport, blocker, and parse failures"
        accentColor={props.focusTarget === "side" ? props.theme.colors.selection : undefined}
      >
        {entries.length === 0 ? (
          <Text color={props.theme.colors.muted}>No recent failures are available for the current run.</Text>
        ) : (
          entries.map((entry) => (
            <Box key={entry.sourceUrl} flexDirection="column" marginBottom={1}>
              <Text color={props.theme.colors.text}>{truncate(entry.sourceUrl, 52)}</Text>
              <Text color={props.theme.colors.warning}>{truncate(entry.detail, 56)}</Text>
            </Box>
          ))
        )}
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
  locale: AppLocale;
  recentRuns: RunEntity[];
  recentRunsQuery: string;
  selectedRecentRunIndex: number;
  selectedSettingsIndex: number;
  preferences: TuiPreferences;
  selectedReportSurfaceIndex: number;
}) {
  if (props.overlay === "help") {
    return (
      <Panel
        theme={props.theme}
        title={translate(props.locale, "tui.shell.helpTitle")}
        subtitle={translate(props.locale, "tui.shell.helpSubtitle")}
        accentColor={props.theme.colors.overlayBorder}
      >
        <Text color={props.theme.colors.muted}>{translate(props.locale, "tui.shell.helpCommands")}</Text>
        <CommandActionRows
          theme={props.theme}
          rows={[
            { command: "/research <artist>", detail: translate(props.locale, "tui.commandHint.research") },
            { command: "/work <artist> --title <title>", detail: translate(props.locale, "tui.commandHint.work") },
            { command: "/runs", detail: translate(props.locale, "tui.commandHint.runs") },
            { command: "/sources", detail: "inspect source attempts and priced outcomes" },
            { command: "/normalize", detail: "inspect normalized prices and FX reasoning" },
            { command: "/review", detail: "open the duplicate review queue" },
            { command: "/fx", detail: "inspect cached exchange rates" },
            { command: "/errors", detail: "inspect recent transport and parse failures" },
            { command: "/setup", detail: translate(props.locale, "tui.commandHint.setup") },
            { command: "/auth", detail: translate(props.locale, "tui.commandHint.auth") },
            { command: "/settings", detail: "change language, theme, density, and report defaults" },
            { command: "/report cli | /report web", detail: "choose the completed-run report surface" }
          ]}
        />
        <Box marginTop={1} flexDirection="column">
          <Text color={props.theme.colors.muted}>{translate(props.locale, "tui.shell.helpShortcuts")}</Text>
          <Text color={props.theme.colors.text}>Ctrl+K help · Ctrl+R runs · Ctrl+S setup · Ctrl+T settings · Ctrl+U pane</Text>
        </Box>
      </Panel>
    );
  }

  if (props.overlay === "settings") {
    const options = getTuiThemeOptions();
    const generalRows = [
      `${translate(props.locale, "tui.settings.language")}: ${translate(props.locale, "tui.language.english")}`,
      `${translate(props.locale, "tui.settings.language")}: ${translate(props.locale, "tui.language.turkish")}`,
      `${translate(props.locale, "tui.settings.theme")}: ${options[0]?.label ?? "ArtBot"}`,
      `${translate(props.locale, "tui.settings.theme")}: ${options[1]?.label ?? "System"}`,
      `${translate(props.locale, "tui.settings.theme")}: ${options[2]?.label ?? "Matrix"}`,
      `${translate(props.locale, "tui.settings.density")}: comfortable`,
      `${translate(props.locale, "tui.settings.density")}: compact`,
      `${translate(props.locale, "tui.settings.secondaryPane")}: ${
        props.preferences.showSecondaryPane
          ? translate(props.locale, "tui.settings.value.enabled")
          : translate(props.locale, "tui.settings.value.disabled")
      }`
    ];
    const experimentalRows = [
      `${translate(props.locale, "tui.settings.experimental.enabled")}: ${
        props.preferences.experimental.enabled
          ? translate(props.locale, "tui.settings.value.enabled")
          : translate(props.locale, "tui.settings.value.disabled")
      }`,
      `${translate(props.locale, "tui.settings.experimental.plannerModel")}: ${props.preferences.experimental.plannerModel}`,
      `${translate(props.locale, "tui.settings.experimental.researchMode")}: ${props.preferences.experimental.researchMode}`,
      `${translate(props.locale, "tui.settings.experimental.warnOnRun")}: ${
        props.preferences.experimental.warnOnRun
          ? translate(props.locale, "tui.settings.value.enabled")
          : translate(props.locale, "tui.settings.value.disabled")
      }`,
      `${translate(props.locale, "tui.settings.experimental.spendCapReminder")}: $${props.preferences.experimental.spendCapReminderUsd}`,
      `${translate(props.locale, "tui.settings.experimental.openFullReportAfterRun")}: ${
        props.preferences.experimental.openFullReportAfterRun
          ? translate(props.locale, "tui.settings.value.enabled")
          : translate(props.locale, "tui.settings.value.disabled")
      }`
    ];
    const settingRows = [...generalRows, ...experimentalRows];

    return (
      <Panel
        theme={props.theme}
        title={translate(props.locale, "tui.overlay.settings.title")}
        subtitle={translate(props.locale, "tui.overlay.settings.subtitle")}
        accentColor={props.theme.colors.overlayBorder}
      >
        <Text color={props.theme.colors.muted}>{translate(props.locale, "tui.settings.section.general")}</Text>
        {settingRows.map((row, index) => {
          const selected = index === props.selectedSettingsIndex;
          if (index === generalRows.length) {
            return (
              <Box key="experimental-settings" flexDirection="column">
                <Text color={props.theme.colors.muted}>{translate(props.locale, "tui.settings.section.experimental")}</Text>
                <Text color={props.theme.colors.muted}>
                  {translate(props.locale, "tui.settings.experimental.summary")}
                </Text>
                <Text color={props.theme.colors.warning}>
                  {translate(props.locale, "tui.settings.experimental.detail")}
                </Text>
                <Text color={selected ? props.theme.colors.selection : props.theme.colors.text}>
                  {selected ? ">" : " "} {row}
                </Text>
              </Box>
            );
          }
          return (
            <Text key={row} color={selected ? props.theme.colors.selection : props.theme.colors.text}>
              {selected ? ">" : " "} {row}
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
                {selected ? ">" : " "} {option.label}
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
                {selected ? ">" : " "} {run.query.artist} · {run.status}
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

function CommandActionRows(props: { theme: TuiTheme; rows: Array<{ command: string; detail: string }> }) {
  return (
    <Box flexDirection="column">
      {props.rows.map((row) => (
        <Text key={row.command} color={props.theme.colors.text}>
          <Text color={props.theme.colors.accent} bold>
            {row.command.padEnd(32)}
          </Text>
          <Text color={props.theme.colors.muted}>{row.detail}</Text>
        </Text>
      ))}
    </Box>
  );
}

type ShellTone = "accent" | "success" | "warning" | "danger" | "muted";

function toneToColor(theme: TuiTheme, tone: ShellTone): string {
  if (tone === "success") return theme.colors.success;
  if (tone === "warning") return theme.colors.warning;
  if (tone === "danger") return theme.colors.danger;
  if (tone === "muted") return theme.colors.muted;
  return theme.colors.accent;
}

function ReadinessItem(props: { theme: TuiTheme; label: string; value: string; tone: ShellTone }) {
  return (
    <Box marginRight={2}>
      <Text color={props.theme.colors.muted}>{props.label} </Text>
      <Text color={toneToColor(props.theme, props.tone)} bold>
        {props.value}
      </Text>
    </Box>
  );
}

function StatusDot(props: { theme: TuiTheme; label: string; ok: boolean; detail: string }) {
  return (
    <Box marginLeft={2}>
      <Text color={props.ok ? props.theme.colors.success : props.theme.colors.warning}>● {props.label}</Text>
      <Text color={props.theme.colors.muted}> {props.detail}</Text>
    </Box>
  );
}

function Metric(props: { theme: TuiTheme; label: string; value: string; tone: "accent" | "success" | "warning" | "danger" | "muted" }) {
  const color = toneToColor(props.theme, props.tone);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={props.theme.colors.muted}>{props.label}</Text>
      <Text color={color} bold>
        {props.value}
      </Text>
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

function resolveIssueList(assessment: SetupAssessment | null): SetupAssessment["issues"] {
  if (!assessment) return [];
  if (assessment.issues.length) return assessment.issues;
  return [...assessment.blockingIssues, ...assessment.optionalIssues];
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

export function buildStageRows(
  details: PipelineDetails | null,
  theme: TuiTheme
): Array<{ symbol: string; label: string; detail: string; color: string }> {
  const summary = details?.summary;
  const status = details?.run?.status;
  const queueRunning = status === "pending";
  const scanRunning = status === "running" && !summary;
  const analyzeRunning = status === "running" && Boolean(summary);

  return [
    {
      symbol: queueRunning ? "…" : status ? "✓" : "○",
      label: "Queue",
      detail: queueRunning ? "waiting" : status ? "passed" : "pending",
      color: queueRunning ? theme.colors.thinking : status ? theme.colors.success : theme.colors.muted
    },
    {
      symbol: summary ? "✓" : scanRunning ? "…" : "○",
      label: "Scan",
      detail: summary ? `${summary.total_attempts ?? 0} attempts` : scanRunning ? "running" : "queued",
      color: summary ? theme.colors.success : scanRunning ? theme.colors.thinking : theme.colors.muted
    },
    {
      symbol: status === "failed" ? "✗" : summary ? (analyzeRunning ? "…" : "✓") : "○",
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
    return `${fmtCurrency(record.estimate_low, record.currency ?? "TRY")}-${fmtCurrency(record.estimate_high, record.currency ?? "TRY")}`;
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
