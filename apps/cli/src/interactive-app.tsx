import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { RunEntity } from "@artbot/shared-types";
import { assessLocalSetup } from "./setup/workflow.js";
import type { SetupAssessment } from "./setup/index.js";
import {
  buildCompletedReportMessage,
  generateAndOpenBrowserReportFromPayload,
  shouldPromptForReportSurface,
  shouldAutoOpenBrowserReport,
  type ReportSurfacePreference
} from "./report/browser-report.js";
import {
  ArtbotInteractiveShell,
  COMPLETED_REPORT_SURFACE_OPTIONS,
  RECENT_RUNS_VISIBLE_LIMIT,
  TuiKeyHintRail,
  buildComposerState,
  closeOverlay,
  filterRecentRuns,
  getCompletedReportSurfaceByIndex,
  getThemeIndex,
  getThemeNameByIndex,
  getTuiTheme,
  openOverlay,
  resolveDisplayedRun,
  resolveDisplayedSidePane,
  resolvePrimaryView,
  saveTuiPreferences,
  stepSelection,
  toggleSecondaryPane,
  type Overlay,
  type PipelineDetails,
  type TuiPreferences,
  type TuiSurfaceState
} from "./tui/index.js";

export interface InteractiveStartContext {
  apiBaseUrl: string;
  apiKey?: string;
  defaults: {
    analysisMode: "comprehensive" | "balanced" | "fast";
    priceNormalization: "legacy" | "usd_dual" | "usd_nominal" | "usd_2026";
    reportSurface: ReportSurfacePreference;
    authProfileId?: string;
    allowLicensed: boolean;
    licensedIntegrations: string[];
  };
}

interface InteractiveAppProps {
  context: InteractiveStartContext;
  initialAssessment: SetupAssessment | null;
  initialPreferences: TuiPreferences;
  onExit: (code: number) => void;
}

type RunInteractiveTuiProps = Omit<InteractiveAppProps, "onExit">;

function summarizeCompletedRun(details: PipelineDetails | null): { accepted: number; coverage: number } | null {
  const summary = details?.summary;
  if (!summary) return null;
  return {
    accepted: summary.accepted_records ?? 0,
    coverage: Math.round((summary.priced_crawled_source_coverage_ratio ?? summary.priced_source_coverage_ratio ?? 0) * 100)
  };
}

function parseWorkCommand(value: string): { artist: string; title: string } | null {
  const match = value.match(/^\/work\s+(.+?)\s+--title\s+(.+)$/i);
  if (!match) return null;
  return {
    artist: match[1].trim(),
    title: match[2].trim()
  };
}

function useTerminalDimensions() {
  const [dimensions, setDimensions] = useState(() => ({
    columns: process.stdout.columns ?? 120,
    rows: process.stdout.rows ?? 40
  }));

  useEffect(() => {
    const update = () =>
      setDimensions({
        columns: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 40
      });

    process.stdout.on("resize", update);
    return () => {
      process.stdout.off("resize", update);
    };
  }, []);

  return dimensions;
}

export function runInteractiveTui(props: RunInteractiveTuiProps): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const instance = render(
      <InteractiveApp
        {...props}
        onExit={(code) => {
          if (settled) return;
          settled = true;
          instance.unmount();
          resolve(code);
        }}
      />
    );
  });
}

function InteractiveApp({ context, initialAssessment, initialPreferences, onExit }: InteractiveAppProps) {
  const { exit } = useApp();
  const dimensions = useTerminalDimensions();

  const [assessment, setAssessment] = useState<SetupAssessment | null>(initialAssessment);
  const [sessionRunDetails, setSessionRunDetails] = useState<PipelineDetails | null>(null);
  const [browsedRunDetails, setBrowsedRunDetails] = useState<PipelineDetails | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunEntity[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [busy, setBusy] = useState(false);
  const [activeArtist, setActiveArtist] = useState("");
  const [message, setMessage] = useState("Slash command ready.");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [browserReportPath, setBrowserReportPath] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<TuiPreferences>(initialPreferences);
  const [uiState, setUiState] = useState<TuiSurfaceState>(() => ({
    sidePane: initialAssessment?.issues.length ? ("setup" as const) : ("none" as const),
    sidePaneDismissed: false,
    overlay: "none" as Overlay,
    focusTarget: "composer" as const,
    recentRunsQuery: "",
    selectedRecentRunIndex: 0,
    selectedThemeIndex: getThemeIndex(initialPreferences.theme),
    selectedReportSurfaceIndex: 0
  }));
  const cancelPollingRef = useRef(false);

  const deferredRecentRunsQuery = useDeferredValue(uiState.recentRunsQuery);
  const filteredRecentRuns = useMemo(
    () => filterRecentRuns(recentRuns, deferredRecentRunsQuery),
    [deferredRecentRunsQuery, recentRuns]
  );
  const visibleRecentRuns = useMemo(
    () => filteredRecentRuns.slice(0, RECENT_RUNS_VISIBLE_LIMIT),
    [filteredRecentRuns]
  );
  const displayedRun = useMemo(
    () => resolveDisplayedRun({ busy, sessionRun: sessionRunDetails, browsedRun: browsedRunDetails }),
    [browsedRunDetails, busy, sessionRunDetails]
  );
  const primaryView = useMemo(() => resolvePrimaryView(displayedRun), [displayedRun]);
  const displayedSidePane = useMemo(
    () =>
      resolveDisplayedSidePane({
        primaryView,
        requestedSidePane: uiState.sidePane,
        sidePaneDismissed: uiState.sidePaneDismissed,
        preferences,
        hasSetupIssues: Boolean(assessment?.issues.length)
      }),
    [assessment?.issues.length, preferences, primaryView, uiState.sidePane, uiState.sidePaneDismissed]
  );
  const effectiveThemeName =
    uiState.overlay === "theme-picker" ? getThemeNameByIndex(uiState.selectedThemeIndex) : preferences.theme;
  const theme = useMemo(() => getTuiTheme(effectiveThemeName), [effectiveThemeName]);
  const composerState = useMemo(
    () =>
      buildComposerState({
        overlay: uiState.overlay,
        focusTarget: uiState.focusTarget
      }),
    [uiState.focusTarget, uiState.overlay]
  );

  const refreshAssessment = useCallback(async () => {
    const next = await assessLocalSetup();
    setAssessment(next);
    return next;
  }, []);

  const fetchRecentRuns = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (context.apiKey) headers["x-api-key"] = context.apiKey;
    const response = await fetch(`${context.apiBaseUrl}/runs?limit=30`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load runs (${response.status})`);
    }
    const payload = (await response.json()) as { runs: RunEntity[] };
    setRecentRuns(payload.runs);
    return payload.runs;
  }, [context.apiBaseUrl, context.apiKey]);

  const fetchRunDetails = useCallback(
    async (runId: string) => {
      const detailResponse = await fetch(`${context.apiBaseUrl}/runs/${runId}`, {
        headers: context.apiKey ? { "x-api-key": context.apiKey } : undefined
      });
      if (!detailResponse.ok) {
        throw new Error(`Failed to load run ${runId} (${detailResponse.status})`);
      }

      return (await detailResponse.json()) as PipelineDetails;
    },
    [context.apiBaseUrl, context.apiKey]
  );

  const persistPreferences = useCallback((nextPreferences: TuiPreferences) => {
    setPreferences(nextPreferences);
    try {
      saveTuiPreferences(nextPreferences);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const openBrowserReportForRun = useCallback(async (nextDetails: PipelineDetails | null) => {
    const runId = nextDetails?.run?.id;
    const snapshot = summarizeCompletedRun(nextDetails);
    if (!runId || !snapshot) {
      setMessage("Browser report unavailable for this run.");
      return false;
    }

    const result = await generateAndOpenBrowserReportFromPayload(nextDetails, {
      runId,
      resultsPath: nextDetails?.run?.resultsPath
    });
    setBrowserReportPath(result.htmlPath);
    setMessage(
      buildCompletedReportMessage({
        accepted: snapshot.accepted,
        coverage: snapshot.coverage,
        surface: "web",
        browserPath: result.htmlPath,
        error: result.opened ? undefined : result.error
      })
    );
    return result.opened;
  }, []);

  const presentCompletedRun = useCallback(
    async (surface: Exclude<ReportSurfacePreference, "ask">, nextDetails: PipelineDetails | null = displayedRun) => {
      if (nextDetails?.run?.status !== "completed") {
        setMessage(
          surface === "web"
            ? "No completed run is available for browser report mode."
            : "No completed run is available for CLI report mode."
        );
        return;
      }

      setUiState((current) => closeOverlay(current));

      if (surface === "web") {
        await openBrowserReportForRun(nextDetails);
        return;
      }

      const snapshot = summarizeCompletedRun(nextDetails);
      if (!snapshot) {
        setMessage("CLI report unavailable for this run.");
        return;
      }

      setMessage(
        buildCompletedReportMessage({
          accepted: snapshot.accepted,
          coverage: snapshot.coverage,
          surface: "cli",
          browserPath: browserReportPath ?? undefined
        })
      );
    },
    [browserReportPath, displayedRun, openBrowserReportForRun]
  );

  const openRecentRunsOverlay = useCallback(() => {
    startTransition(() => {
      setUiState((current) => openOverlay(current, "recent-runs", getThemeIndex(preferences.theme)));
    });

    void (async () => {
      try {
        await fetchRecentRuns();
        setMessage("Recent runs loaded.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [fetchRecentRuns, preferences.theme]);

  const openThemeOverlay = useCallback(() => {
    startTransition(() => {
      setUiState((current) => openOverlay(current, "theme-picker", getThemeIndex(preferences.theme)));
    });
    setMessage("Theme preview open.");
  }, [preferences.theme]);

  const openReportSurfaceOverlay = useCallback(() => {
    startTransition(() => {
      setUiState((current) => openOverlay(current, "report-surface", current.selectedThemeIndex, 0));
    });
    setMessage("Choose how to view the completed report.");
  }, []);

  const openSetupSidePane = useCallback(() => {
    startTransition(() => {
      setUiState((current) => ({
        ...closeOverlay(current),
        sidePane: "setup",
        sidePaneDismissed: false,
        focusTarget: "side"
      }));
    });

    void (async () => {
      try {
        await refreshAssessment();
        setMessage("Setup diagnostics loaded.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [refreshAssessment]);

  const openAuthSidePane = useCallback(() => {
    startTransition(() => {
      setUiState((current) => ({
        ...closeOverlay(current),
        sidePane: "auth",
        sidePaneDismissed: false,
        focusTarget: "side"
      }));
    });

    void (async () => {
      try {
        await refreshAssessment();
        setMessage("Auth profile status loaded.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [refreshAssessment]);

  const commitThemeSelection = useCallback(() => {
    const nextTheme = getThemeNameByIndex(uiState.selectedThemeIndex);
    const nextPreferences = {
      ...preferences,
      theme: nextTheme
    } satisfies TuiPreferences;

    persistPreferences(nextPreferences);
    setUiState((current) => closeOverlay(current));
    setMessage(`Theme saved: ${nextTheme}`);
  }, [persistPreferences, preferences, uiState.selectedThemeIndex]);

  const selectHistoricalRun = useCallback(
    async (runId: string) => {
      const details = await fetchRunDetails(runId);
      setBrowsedRunDetails(details);
      setActiveArtist(details.run?.query?.artist ?? activeArtist);
      setUiState((current) => ({
        ...closeOverlay(current),
        sidePane: "run-details",
        sidePaneDismissed: false,
        focusTarget: "main"
      }));
      setMessage(`Loaded run ${runId}`);
    },
    [activeArtist, fetchRunDetails]
  );

  useEffect(() => {
    void (async () => {
      try {
        await refreshAssessment();
        await fetchRecentRuns();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [fetchRecentRuns, refreshAssessment]);

  useEffect(() => {
    if (uiState.selectedRecentRunIndex >= visibleRecentRuns.length) {
      setUiState((current) => ({
        ...current,
        selectedRecentRunIndex: Math.max(0, visibleRecentRuns.length - 1)
      }));
    }
  }, [uiState.selectedRecentRunIndex, visibleRecentRuns.length]);

  const startResearch = useCallback(
    async (kind: "artist" | "work" | "artist_market_inventory", artist: string, title?: string) => {
      setBusy(true);
      setActiveArtist(artist);
      setMessage(
        kind === "artist_market_inventory"
          ? `Launching deep market inventory crawl for ${artist}...`
          : `Launching ${kind} research for ${artist}...`
      );
      setRunStartedAt(Date.now());
      setBrowserReportPath(null);
      setBrowsedRunDetails(null);
      setUiState((current) => ({
        ...closeOverlay(current),
        sidePane: "run-details",
        sidePaneDismissed: false,
        focusTarget: "main"
      }));
      cancelPollingRef.current = false;

      try {
        const nextAssessment = await refreshAssessment();
        if (!nextAssessment.apiHealth.ok) {
          setUiState((current) => ({
            ...current,
            sidePane: "setup",
            sidePaneDismissed: false,
            focusTarget: "side"
          }));
          setMessage(`ArtBot API offline at ${nextAssessment.apiBaseUrl}. Run /setup or artbot setup.`);
          return;
        }

        const headers: Record<string, string> = {
          "content-type": "application/json"
        };
        if (context.apiKey) headers["x-api-key"] = context.apiKey;

        const endpoint =
          kind === "artist_market_inventory" ? "/crawl/artist-market" : `/research/${kind}`;
        const response = await fetch(`${context.apiBaseUrl}${endpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: {
              artist,
              title,
              scope: "turkey_plus_international",
              turkeyFirst: true,
              analysisMode: context.defaults.analysisMode,
              priceNormalization: context.defaults.priceNormalization,
              authProfileId: context.defaults.authProfileId,
              manualLoginCheckpoint: false,
              allowLicensed: context.defaults.allowLicensed,
              licensedIntegrations: context.defaults.licensedIntegrations
            }
          })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Research request failed (${response.status}): ${text.slice(0, 200)}`);
        }

        const created = (await response.json()) as { runId: string; status: string };
        setSessionRunDetails({
          run: {
            id: created.runId,
            status: created.status,
            runType: kind,
            query: {
              artist,
              title
            }
          }
        });
        setMessage(`Run created: ${created.runId}`);

        while (!cancelPollingRef.current) {
          const nextDetails = await fetchRunDetails(created.runId);
          setSessionRunDetails(nextDetails);

          const status = nextDetails.run?.status;
          if (status === "completed" || status === "failed") {
            if (status === "completed") {
              const snapshot = summarizeCompletedRun(nextDetails);
              if (snapshot) {
                const reportSurface = context.defaults.reportSurface;

                if (shouldAutoOpenBrowserReport(reportSurface)) {
                  await presentCompletedRun("web", nextDetails);
                } else if (shouldPromptForReportSurface(reportSurface)) {
                  openReportSurfaceOverlay();
                } else {
                  await presentCompletedRun("cli", nextDetails);
                }
              }
            } else {
              setMessage(`✗ Run failed: ${created.runId}`);
            }
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        await fetchRecentRuns();
      } finally {
        setBusy(false);
      }
    },
    [context.apiBaseUrl, context.apiKey, context.defaults, fetchRecentRuns, fetchRunDetails, openReportSurfaceOverlay, presentCompletedRun, refreshAssessment]
  );

  const handleComposerChange = useCallback(
    (value: string) => {
      if (uiState.overlay === "recent-runs" && uiState.focusTarget === "overlay") {
        setUiState((current) => ({
          ...current,
          recentRunsQuery: value,
          selectedRecentRunIndex: 0
        }));
        return;
      }

      if (uiState.overlay === "theme-picker" && uiState.focusTarget === "overlay") {
        return;
      }

      if (uiState.overlay === "report-surface" && uiState.focusTarget === "overlay") {
        return;
      }

      setInput(value);
      setHistoryIndex(-1);
    },
    [uiState.focusTarget, uiState.overlay]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      if (uiState.overlay === "recent-runs" && uiState.focusTarget === "overlay") {
        const selectedRun = visibleRecentRuns[uiState.selectedRecentRunIndex];
        if (!selectedRun) {
          setMessage("No run selected.");
          return;
        }
        await selectHistoricalRun(selectedRun.id);
        return;
      }

      if (uiState.overlay === "theme-picker" && uiState.focusTarget === "overlay") {
        commitThemeSelection();
        return;
      }

      if (uiState.overlay === "report-surface" && uiState.focusTarget === "overlay") {
        await presentCompletedRun(getCompletedReportSurfaceByIndex(uiState.selectedReportSurfaceIndex));
        return;
      }

      const trimmed = value.trim();
      if (!trimmed) return;

      setHistory((current) => [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, 12));
      setHistoryIndex(-1);
      setInput("");

      try {
        if (!trimmed.startsWith("/")) {
          await startResearch("artist", trimmed);
          return;
        }

        if (trimmed === "/exit") {
          cancelPollingRef.current = true;
          exit();
          onExit(0);
          return;
        }

        if (trimmed === "/help") {
          setUiState((current) => openOverlay(current, "help", getThemeIndex(preferences.theme)));
          setMessage("Command reference loaded.");
          return;
        }

        if (trimmed === "/runs") {
          openRecentRunsOverlay();
          return;
        }

        if (trimmed === "/theme") {
          openThemeOverlay();
          return;
        }

        if (trimmed.startsWith("/theme ")) {
          const requestedTheme = trimmed.slice("/theme ".length).trim();
          if (requestedTheme === "artbot" || requestedTheme === "system" || requestedTheme === "matrix") {
            persistPreferences({
              ...preferences,
              theme: requestedTheme
            });
            setMessage(`Theme saved: ${requestedTheme}`);
          } else {
            setMessage(`Unknown theme: ${requestedTheme}`);
          }
          return;
        }

        if (trimmed === "/status" || trimmed === "/doctor" || trimmed === "/setup") {
          openSetupSidePane();
          return;
        }

        if (trimmed === "/auth") {
          openAuthSidePane();
          return;
        }

        if (trimmed.startsWith("/research ")) {
          await startResearch("artist", trimmed.slice("/research ".length).trim());
          return;
        }

        if (trimmed.startsWith("/crawl ")) {
          await startResearch("artist_market_inventory", trimmed.slice("/crawl ".length).trim());
          return;
        }

        if (trimmed.startsWith("/inventory ")) {
          await startResearch("artist_market_inventory", trimmed.slice("/inventory ".length).trim());
          return;
        }

        if (trimmed === "/report cli") {
          await presentCompletedRun("cli");
          return;
        }

        if (trimmed === "/report web") {
          await presentCompletedRun("web");
          return;
        }

        const workCommand = parseWorkCommand(trimmed);
        if (workCommand) {
          await startResearch("work", workCommand.artist, workCommand.title);
          return;
        }

        setMessage(`Unknown command: ${trimmed}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [
      commitThemeSelection,
      exit,
      onExit,
      openAuthSidePane,
      openRecentRunsOverlay,
      openSetupSidePane,
      openThemeOverlay,
      presentCompletedRun,
      persistPreferences,
      preferences,
      selectHistoricalRun,
      startResearch,
      uiState.focusTarget,
      uiState.overlay,
      uiState.selectedReportSurfaceIndex,
      uiState.selectedRecentRunIndex,
      visibleRecentRuns
    ]
  );

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      cancelPollingRef.current = true;
      exit();
      onExit(0);
      return;
    }

    if (key.ctrl && value === "k") {
      setUiState((current) => openOverlay(current, "help", getThemeIndex(preferences.theme)));
      return;
    }

    if (key.ctrl && value === "r") {
      openRecentRunsOverlay();
      return;
    }

    if (key.ctrl && value === "s") {
      openSetupSidePane();
      return;
    }

    if (key.ctrl && value === "t") {
      openThemeOverlay();
      return;
    }

    if (key.ctrl && value === "u") {
      const nextPreferences = toggleSecondaryPane(preferences);
      persistPreferences(nextPreferences);
      setUiState((current) => ({
        ...current,
        sidePane: nextPreferences.showSecondaryPane ? current.sidePane : "none",
        sidePaneDismissed: nextPreferences.showSecondaryPane ? false : current.sidePaneDismissed,
        focusTarget: nextPreferences.showSecondaryPane ? current.focusTarget : "composer"
      }));
      setMessage(nextPreferences.showSecondaryPane ? "Secondary pane enabled." : "Secondary pane hidden.");
      return;
    }

    if (key.escape) {
      if (uiState.overlay !== "none") {
        setUiState((current) => closeOverlay(current));
        return;
      }

      if (displayedSidePane !== "none") {
        setUiState((current) => ({
          ...current,
          sidePane: "none",
          sidePaneDismissed: true,
          focusTarget: "composer"
        }));
        return;
      }
    }

    if (key.tab) {
      setUiState((current) => {
        if (current.overlay !== "none") {
          return {
            ...current,
            focusTarget: current.focusTarget === "overlay" ? "composer" : "overlay"
          };
        }

        if (displayedSidePane !== "none") {
          const nextFocus =
            current.focusTarget === "composer" ? "main" : current.focusTarget === "main" ? "side" : "composer";
          return {
            ...current,
            focusTarget: nextFocus
          };
        }

        return {
          ...current,
          focusTarget: current.focusTarget === "composer" ? "main" : "composer"
        };
      });
      return;
    }

    if (uiState.overlay === "recent-runs" && uiState.focusTarget === "overlay") {
      if (key.upArrow || key.downArrow) {
        setUiState((current) => ({
          ...current,
          selectedRecentRunIndex: stepSelection(
            current.selectedRecentRunIndex,
            key.upArrow ? -1 : 1,
            visibleRecentRuns.length
          )
        }));
      }
      return;
    }

    if (uiState.overlay === "report-surface" && uiState.focusTarget === "overlay") {
      if (key.upArrow || key.downArrow) {
        setUiState((current) => ({
          ...current,
          selectedReportSurfaceIndex: stepSelection(
            current.selectedReportSurfaceIndex,
            key.upArrow ? -1 : 1,
            COMPLETED_REPORT_SURFACE_OPTIONS.length
          )
        }));
        return;
      }
    }

    if (uiState.overlay === "theme-picker" && uiState.focusTarget === "overlay") {
      if (key.upArrow || key.downArrow) {
        setUiState((current) => ({
          ...current,
          selectedThemeIndex: stepSelection(current.selectedThemeIndex, key.upArrow ? -1 : 1, 3)
        }));
        return;
      }

      if (key.return) {
        commitThemeSelection();
        return;
      }
    }

    if (uiState.focusTarget === "composer" && (key.upArrow || key.downArrow)) {
      if (history.length === 0) return;

      const nextIndex = key.upArrow
        ? Math.min(history.length - 1, historyIndex < 0 ? 0 : historyIndex + 1)
        : historyIndex <= 0
          ? -1
          : historyIndex - 1;

      setHistoryIndex(nextIndex);
      setInput(nextIndex === -1 ? "" : history[nextIndex] ?? "");
    }
  });

  const composerValue =
    uiState.overlay === "recent-runs" && uiState.focusTarget === "overlay" ? uiState.recentRunsQuery : input;
  const messageColor =
    message.startsWith("✗") || message.startsWith("Failed") || message.includes("error")
      ? theme.colors.danger
      : message.startsWith("✓")
        ? theme.colors.success
        : theme.colors.muted;

  return (
    <Box flexDirection="column">
      <ArtbotInteractiveShell
        theme={theme}
        assessment={assessment}
        displayedRun={displayedRun}
        activeArtist={displayedRun?.run?.query?.artist ?? activeArtist}
        primaryView={primaryView}
        sidePane={displayedSidePane}
        overlay={uiState.overlay}
        focusTarget={uiState.focusTarget}
        preferences={preferences}
        selectedReportSurfaceIndex={uiState.selectedReportSurfaceIndex}
        recentRunsQuery={uiState.recentRunsQuery}
        selectedRecentRunIndex={uiState.selectedRecentRunIndex}
        selectedThemeIndex={uiState.selectedThemeIndex}
        recentRuns={visibleRecentRuns}
        runStartedAt={runStartedAt}
        browserReportPath={browserReportPath}
        terminalWidth={dimensions.columns}
      />

      <Box marginTop={1} flexDirection="column">
        <Box borderStyle="round" borderColor={theme.colors.promptBorder} paddingX={1}>
          <Text color={theme.colors.promptAccent} bold>
            {composerState.promptSymbol === "artbot" ? "❯" : `${composerState.promptSymbol}>`}
          </Text>
          <Box marginLeft={1} flexGrow={1}>
            <TextInput value={composerValue} onChange={handleComposerChange} onSubmit={handleSubmit} placeholder={composerState.placeholder} />
          </Box>
        </Box>

        <Box justifyContent="space-between">
          <Text color={messageColor} dimColor>
            {message}
          </Text>
          <Text color={theme.colors.muted}>{composerState.helperText}</Text>
        </Box>

        <TuiKeyHintRail theme={theme} overlay={uiState.overlay} />
      </Box>
    </Box>
  );
}
