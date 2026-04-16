import { describe, expect, it } from "vitest";
import {
  COMPLETED_REPORT_SURFACE_OPTIONS,
  DEFAULT_SURFACE_STATE,
  buildComposerState,
  closeOverlay,
  filterRecentRuns,
  getCompletedReportSurfaceByIndex,
  openOverlay,
  resolveDisplayedRun,
  resolveDisplayedSidePane,
  resolvePrimaryView,
  stepSelection,
  toggleSecondaryPane,
  type PipelineDetails
} from "./state.js";

function makeQuery(artist: string, title?: string) {
  const sourceClasses: Array<"auction_house" | "gallery" | "dealer" | "marketplace" | "database"> = [
    "auction_house",
    "gallery",
    "dealer",
    "marketplace",
    "database"
  ];

  return {
    artist,
    title,
    scope: "turkey_plus_international" as const,
    turkeyFirst: true,
    analysisMode: "balanced" as const,
    priceNormalization: "usd_dual" as const,
    manualLoginCheckpoint: false,
    allowLicensed: false,
    licensedIntegrations: [],
    preferredDiscoveryProviders: [],
    crawlMode: "backfill" as const,
    sourceClasses
  };
}

describe("tui state", () => {
  it("switches the composer into run search mode when the run browser is open", () => {
    const next = openOverlay(DEFAULT_SURFACE_STATE, "recent-runs");
    const composer = buildComposerState({
      overlay: next.overlay,
      focusTarget: next.focusTarget
    });

    expect(next.overlay).toBe("recent-runs");
    expect(next.focusTarget).toBe("overlay");
    expect(composer.mode).toBe("run-search");
  });

  it("closes overlays back to the command composer", () => {
    const next = closeOverlay(
      openOverlay(
        {
          ...DEFAULT_SURFACE_STATE,
          recentRunsQuery: "beykam"
        },
        "theme-picker"
      )
    );

    expect(next.overlay).toBe("none");
    expect(next.focusTarget).toBe("composer");
    expect(next.recentRunsQuery).toBe("");
  });

  it("toggles the secondary pane preference", () => {
    const next = toggleSecondaryPane({
      theme: "artbot",
      density: "comfortable",
      showSecondaryPane: true,
      diffLayout: "auto"
    });

    expect(next.showSecondaryPane).toBe(false);
  });

  it("keeps the active polling run primary while busy, then allows browsing history afterward", () => {
    const sessionRun: PipelineDetails = { run: { id: "active-run", status: "running", query: { artist: "Bedri Baykam" } } };
    const browsedRun: PipelineDetails = { run: { id: "historic-run", status: "completed", query: { artist: "Fikret Mualla" } } };

    expect(resolveDisplayedRun({ busy: true, sessionRun, browsedRun })?.run?.id).toBe("active-run");
    expect(resolveDisplayedRun({ busy: false, sessionRun, browsedRun })?.run?.id).toBe("historic-run");
  });

  it("derives the four primary UI states from run status", () => {
    expect(resolvePrimaryView(null)).toBe("idle");
    expect(resolvePrimaryView({ run: { status: "pending" } })).toBe("running");
    expect(resolvePrimaryView({ run: { status: "running" } })).toBe("running");
    expect(resolvePrimaryView({ run: { status: "completed" } })).toBe("completed");
    expect(resolvePrimaryView({ run: { status: "failed" } })).toBe("failed");
  });

  it("keeps explicit setup and auth panes visible even when the contextual pane is disabled", () => {
    expect(
      resolveDisplayedSidePane({
        primaryView: "completed",
        requestedSidePane: "setup",
        sidePaneDismissed: false,
        preferences: {
          theme: "artbot",
          density: "comfortable",
          showSecondaryPane: false,
          diffLayout: "auto"
        },
        hasSetupIssues: false
      })
    ).toBe("setup");

    expect(
      resolveDisplayedSidePane({
        primaryView: "completed",
        requestedSidePane: "none",
        sidePaneDismissed: false,
        preferences: {
          theme: "artbot",
          density: "comfortable",
          showSecondaryPane: false,
          diffLayout: "auto"
        },
        hasSetupIssues: false
      })
    ).toBe("none");
  });

  it("keeps contextual panes closed after explicit dismissal", () => {
    expect(
      resolveDisplayedSidePane({
        primaryView: "completed",
        requestedSidePane: "none",
        sidePaneDismissed: true,
        preferences: {
          theme: "artbot",
          density: "comfortable",
          showSecondaryPane: true,
          diffLayout: "auto"
        },
        hasSetupIssues: true
      })
    ).toBe("none");
  });

  it("switches the composer into report chooser mode when a completed run asks how to render", () => {
    const next = openOverlay(DEFAULT_SURFACE_STATE, "report-surface");
    const composer = buildComposerState({
      overlay: next.overlay,
      focusTarget: next.focusTarget
    });

    expect(composer.mode).toBe("report-surface");
    expect(getCompletedReportSurfaceByIndex(COMPLETED_REPORT_SURFACE_OPTIONS.length + 5)).toBe("web");
  });

  it("filters recent runs by artist and status text", () => {
    const filteredByArtist = filterRecentRuns(
      [
        {
          id: "run-1",
          runType: "artist",
          query: makeQuery("Bedri Baykam"),
          status: "completed",
          pinned: false,
          createdAt: "2026-04-12T12:00:00.000Z",
          updatedAt: "2026-04-12T12:05:00.000Z"
        },
        {
          id: "run-2",
          runType: "work",
          query: makeQuery("Fikret Mualla", "Untitled"),
          status: "failed",
          pinned: false,
          createdAt: "2026-04-12T13:00:00.000Z",
          updatedAt: "2026-04-12T13:05:00.000Z"
        }
      ],
      "failed"
    );

    expect(filteredByArtist).toHaveLength(1);
    expect(filteredByArtist[0]?.id).toBe("run-2");
  });

  it("filters recent runs by pinned retention label", () => {
    const filtered = filterRecentRuns(
      [
        {
          id: "run-1",
          runType: "artist",
          query: makeQuery("Bedri Baykam"),
          status: "completed",
          pinned: true,
          pinnedAt: "2026-04-12T12:06:00.000Z",
          createdAt: "2026-04-12T12:00:00.000Z",
          updatedAt: "2026-04-12T12:05:00.000Z"
        },
        {
          id: "run-2",
          runType: "work",
          query: makeQuery("Fikret Mualla", "Untitled"),
          status: "failed",
          pinned: false,
          createdAt: "2026-04-12T13:00:00.000Z",
          updatedAt: "2026-04-12T13:05:00.000Z"
        }
      ],
      "pinned"
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("run-1");
  });

  it("clamps list navigation to valid bounds", () => {
    expect(stepSelection(0, -1, 5)).toBe(0);
    expect(stepSelection(0, 1, 5)).toBe(1);
    expect(stepSelection(4, 1, 5)).toBe(4);
  });
});
