import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { RunEntity } from "@artbot/shared-types";
import { ArtbotTuiShell, buildDefaultCommandHints, type TuiAppModel, type TuiRuntimeStatus } from "./tui/index.js";
import { RenderTuiNode } from "./tui/ink-renderer.js";
import { assessLocalSetup } from "./setup/workflow.js";
import type { SetupAssessment } from "./setup/index.js";
import type { PerPaintingStat, ReportRecord, ReportSummary, ReportValuation } from "./ui/report.js";

export interface InteractiveStartContext {
  apiBaseUrl: string;
  apiKey?: string;
  defaults: {
    analysisMode: "comprehensive" | "balanced" | "fast";
    priceNormalization: "legacy" | "usd_dual" | "usd_nominal" | "usd_2026";
    authProfileId?: string;
    allowLicensed: boolean;
    licensedIntegrations: string[];
  };
}

interface PipelineDetails {
  run?: { id?: string; status?: string };
  summary?: ReportSummary;
  records?: ReportRecord[];
  duplicates?: ReportRecord[];
  valuation?: ReportValuation;
  per_painting_stats?: PerPaintingStat[];
  attempts?: Array<{
    source_url: string;
    source_access_status: string;
    blocker_reason?: string | null;
    extracted_fields?: Record<string, unknown>;
  }>;
}

interface InteractiveAppProps {
  context: InteractiveStartContext;
  initialAssessment: SetupAssessment | null;
  onExit: (code: number) => void;
}

type RunInteractiveTuiProps = Omit<InteractiveAppProps, "onExit">;

type DetailMode = "help" | "status" | "setup" | "auth" | "runs" | "report";

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

function asRuntimeStatus(
  label: string,
  ok: boolean,
  detail?: string,
  tone?: TuiRuntimeStatus["tone"]
): TuiRuntimeStatus {
  return {
    label,
    state: ok ? "healthy" : "offline",
    detail,
    tone: tone ?? (ok ? "success" : "danger")
  };
}

function blockerSummary(details: PipelineDetails | null): string | undefined {
  if (!details?.summary?.acceptance_reason_breakdown) return undefined;
  const entries = Object.entries(details.summary.acceptance_reason_breakdown)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return undefined;
  return `Top issue: ${entries[0][0]} (${entries[0][1]})`;
}

function priceLabel(record: ReportRecord): string {
  if (typeof record.normalized_price_usd_nominal === "number") return fmtCurrency(record.normalized_price_usd_nominal, "USD");
  if (typeof record.normalized_price_usd === "number") return fmtCurrency(record.normalized_price_usd, "USD");
  if (typeof record.price_amount === "number") return fmtCurrency(record.price_amount, record.currency ?? "TRY");
  if (typeof record.estimate_low === "number" && typeof record.estimate_high === "number") {
    return `${fmtCurrency(record.estimate_low, record.currency ?? "TRY")}–${fmtCurrency(record.estimate_high, record.currency ?? "TRY")}`;
  }
  if (record.price_type === "inquiry_only" || record.price_hidden) return "Inquiry only";
  return "n/a";
}

function rangeLabel(range?: { low: number; high: number } | null): string {
  if (!range) return "n/a";
  return `${fmtCurrency(range.low, "TRY")} – ${fmtCurrency(range.high, "TRY")}`;
}

function buildModel(params: {
  assessment: SetupAssessment | null;
  details: PipelineDetails | null;
  recentRuns: RunEntity[];
  activeArtist: string;
  input: string;
  history: string[];
  detailMode: DetailMode;
  busy: boolean;
  message: string;
  context: InteractiveStartContext;
  tick: number;
  runStartedAt: number | null;
}): TuiAppModel {
  const { assessment, details, recentRuns, activeArtist, input, history, detailMode, busy, message, context, tick, runStartedAt } = params;
  const summary = details?.summary;
  const records = details?.records ?? [];
  const runId = details?.run?.id ?? "n/a";
  const valuation = details?.valuation;

  const issueLines = assessment?.issues.map((issue) => `${issue.severity}: ${issue.message}${issue.detail ? ` (${issue.detail})` : ""}`) ?? [];
  const recentRunLines = recentRuns.slice(0, 5).map((run) => `${run.id} · ${run.status} · ${run.query.artist}`);
  const authLines =
    assessment?.sessionStates.map((session) => `${session.profileId}: ${session.exists ? (session.expired ? "expired" : "ready") : "missing"}`) ?? [];

  const diagnosticsLines =
    detailMode === "runs"
      ? recentRunLines
      : detailMode === "auth"
        ? authLines
        : detailMode === "setup"
          ? issueLines
          : [message || "No additional diagnostics."];

  return {
    title: "ArtBot",
    subtitle: "Market operations console",
    command: {
      mode: busy ? "running" : detailMode === "setup" ? "setup" : "idle",
      input,
      placeholder: "Type /research <artist> or plain artist text. /help for commands.",
      hints: buildDefaultCommandHints(),
      history
    },
    status: {
      llm: assessment
        ? asRuntimeStatus("LM Studio", assessment.llmHealth.ok, assessment.llmHealth.modelId ?? assessment.llmHealth.reason)
        : asRuntimeStatus("LM Studio", false, "checking"),
      api: assessment ? asRuntimeStatus("ArtBot API", assessment.apiHealth.ok, assessment.apiHealth.reason ?? assessment.apiBaseUrl) : asRuntimeStatus("ArtBot API", false, "checking"),
      worker:
        assessment && assessment.apiHealth.ok
          ? { label: "Worker", state: "healthy", detail: "assumed with local backend", tone: "success" }
          : { label: "Worker", state: "unknown", detail: "verify with /doctor", tone: "muted" },
      auth:
        assessment
          ? {
              label: "Auth",
              state: assessment.authProfilesError ? "offline" : assessment.sessionStates.some((session) => session.exists && !session.expired) ? "healthy" : "degraded",
              detail: assessment.authProfilesError?.message ?? `${assessment.profiles.length} profiles`,
              tone: assessment.authProfilesError ? "danger" : assessment.sessionStates.some((session) => session.exists && !session.expired) ? "success" : "warning"
            }
          : { label: "Auth", state: "unknown", detail: "checking", tone: "muted" },
      licensed: {
        label: "Licensed",
        state: context.defaults.allowLicensed ? "healthy" : "degraded",
        detail:
          context.defaults.licensedIntegrations.length > 0
            ? context.defaults.licensedIntegrations.join(", ")
            : "none",
        tone: context.defaults.allowLicensed ? "success" : "warning"
      },
      model: assessment?.llmHealth.modelId,
      apiBaseUrl: context.apiBaseUrl,
      llmBaseUrl: assessment?.llmBaseUrl
    },
    progress: {
      runId,
      artistName: activeArtist || "n/a",
      status:
        details?.run?.status === "completed"
          ? "completed"
          : details?.run?.status === "failed"
            ? "failed"
            : details?.run?.status === "running"
              ? "running"
              : details?.run?.status === "pending"
                ? "queued"
                : "idle",
      stages: [
        {
          id: "queue",
          label: "Queue",
          state: details?.run?.status ? (details.run.status === "pending" ? "running" : "done") : "pending"
        },
        {
          id: "scan",
          label: "Scan sources",
          state: details?.run?.status === "running" ? "running" : summary ? "done" : "pending"
        },
        {
          id: "analyze",
          label: "Analyze",
          state: summary ? (details?.run?.status === "completed" ? "done" : "running") : "pending"
        },
        {
          id: "report",
          label: "Report",
          state: details?.run?.status === "completed" ? "done" : details?.run?.status === "failed" ? "failed" : "pending"
        }
      ],
      summaryLines: [
        summary ? `Accepted: ${summary.accepted_records}` : "Accepted: n/a",
        summary ? `Valuation eligible: ${summary.valuation_eligible_records ?? 0}` : "Valuation eligible: n/a",
        summary ? `Priced coverage: ${Math.round((summary.priced_crawled_source_coverage_ratio ?? summary.priced_source_coverage_ratio ?? 0) * 100)}%` : "Priced coverage: n/a"
      ],
      blockerSummary: blockerSummary(details),
      tick,
      elapsed: runStartedAt ? Math.floor((Date.now() - runStartedAt) / 1000) : undefined
    },
    report: {
      artistName: activeArtist || "No active research",
      runId,
      overview: [
        { label: "Accepted", value: String(summary?.accepted_records ?? 0), tone: "success" },
        { label: "URLs Crawled", value: String(summary?.total_attempts ?? 0), tone: "muted" },
        {
          label: "Coverage",
          value: `${Math.round((summary?.priced_crawled_source_coverage_ratio ?? summary?.priced_source_coverage_ratio ?? 0) * 100)}%`,
          tone: (summary?.priced_crawled_source_coverage_ratio ?? 0) >= 0.7 ? "success" : "warning"
        }
      ],
      sourceCoverage: [
        { label: "Platforms", value: String(Object.keys(summary?.source_candidate_breakdown ?? {}).length), tone: "accent" },
        { label: "Public", value: String(summary?.source_status_breakdown?.public_access ?? 0), tone: "success" },
        { label: "Blocked", value: String(summary?.source_status_breakdown?.blocked ?? 0), tone: "danger" }
      ],
      valuation: [
        { label: "Blended", value: rangeLabel(valuation?.blendedRange), tone: valuation?.generated ? "success" : "warning" },
        { label: "Turkey", value: rangeLabel(valuation?.turkeyRange), tone: "accent" },
        { label: "Intl", value: rangeLabel(valuation?.internationalRange), tone: "muted" }
      ],
      acceptedRecords: records.slice(0, 8).map((record) => ({
        price: priceLabel(record),
        priceType: record.price_type,
        workTitle: record.work_title ?? "Untitled",
        sourceName: record.source_name,
        detail: [record.sale_or_listing_date, record.dimensions_text, record.year].filter(Boolean).join(" · ")
      })),
      diagnostics: [
        {
          title: detailMode === "help" ? "Commands" : detailMode === "setup" ? "Setup Issues" : detailMode === "auth" ? "Auth State" : detailMode === "runs" ? "Recent Runs" : "Run Notes",
          tone: detailMode === "setup" ? "warning" : "muted",
          lines:
            detailMode === "help"
              ? [
                  "/research <artist>",
                  "/work <artist> --title <title>",
                  "/setup",
                  "/auth",
                  "/doctor",
                  "/status",
                  "/runs",
                  "/help",
                  "/exit"
                ]
              : diagnosticsLines.length > 0
                ? diagnosticsLines
                : ["No detail available."]
        }
      ]
    },
    detail: {
      title:
        detailMode === "auth"
          ? "Auth"
          : detailMode === "runs"
            ? "Runs"
            : detailMode === "setup"
              ? "Setup"
              : detailMode === "help"
                ? "Help"
                : "Context",
      subtitle: detailMode === "setup" ? "Run `artbot setup` for the guided wizard and `artbot auth capture <profile>` for login capture." : message,
      status: [
        assessment
          ? asRuntimeStatus("LM Studio", assessment.llmHealth.ok, assessment.llmHealth.modelId ?? assessment.llmHealth.reason)
          : asRuntimeStatus("LM Studio", false, "checking"),
        assessment
          ? asRuntimeStatus("ArtBot API", assessment.apiHealth.ok, assessment.apiHealth.reason ?? assessment.apiBaseUrl)
          : asRuntimeStatus("ArtBot API", false, "checking")
      ],
      details:
        detailMode === "auth"
          ? (assessment?.sessionStates.map((session) => ({
              label: session.profileId,
              value: session.exists ? (session.expired ? "expired" : "ready") : "missing",
              tone: session.exists ? (session.expired ? "warning" : "success") : "danger",
              detail: session.storageStatePath
            })) ?? [])
          : detailMode === "runs"
            ? recentRuns.slice(0, 6).map((run) => ({
                label: run.id,
                value: run.status,
                tone: run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "accent",
                detail: run.query.artist
              }))
            : [
                {
                  label: "Mode",
                  value: detailMode,
                  tone: detailMode === "setup" ? "warning" : "accent"
                },
                {
                  label: "Artist",
                  value: activeArtist || "n/a",
                  tone: "neutral"
                }
              ],
      blockers: detailMode === "setup" ? issueLines : [blockerSummary(details) ?? "No blockers recorded."],
      evidence: details?.attempts?.slice(0, 4).map((attempt) => attempt.source_url) ?? []
    }
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

function InteractiveApp({ context, initialAssessment, onExit }: InteractiveAppProps) {
  const { exit } = useApp();
  const [assessment, setAssessment] = useState<SetupAssessment | null>(initialAssessment);
  const [details, setDetails] = useState<PipelineDetails | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunEntity[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [detailMode, setDetailMode] = useState<DetailMode>(initialAssessment?.issues.length ? "setup" : "help");
  const [busy, setBusy] = useState(false);
  const [activeArtist, setActiveArtist] = useState("");
  const [message, setMessage] = useState("Slash command ready.");
  const [tick, setTick] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const cancelPollingRef = useRef(false);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
      onExit(0);
    }
  });

  // Spinner animation tick — only runs while pipeline is active
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => setTick((t) => t + 1), 150);
    return () => clearInterval(interval);
  }, [busy]);

  const refreshAssessment = useCallback(async () => {
    const next = await assessLocalSetup();
    setAssessment(next);
    return next;
  }, []);

  const fetchRecentRuns = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (context.apiKey) headers["x-api-key"] = context.apiKey;
    const response = await fetch(`${context.apiBaseUrl}/runs?limit=8`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load runs (${response.status})`);
    }
    const payload = (await response.json()) as { runs: RunEntity[] };
    setRecentRuns(payload.runs);
  }, [context.apiBaseUrl, context.apiKey]);

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

  const startResearch = useCallback(
    async (kind: "artist" | "work" | "artist_market_inventory", artist: string, title?: string) => {
      setBusy(true);
      setDetailMode("report");
      setActiveArtist(artist);
      setMessage(
        kind === "artist_market_inventory"
          ? `Launching deep market inventory crawl for ${artist}...`
          : `Launching ${kind} research for ${artist}...`
      );
      setRunStartedAt(Date.now());
      cancelPollingRef.current = false;

      try {
        const nextAssessment = await refreshAssessment();
        if (!nextAssessment.apiHealth.ok) {
          setDetailMode("setup");
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
        setDetails({
          run: {
            id: created.runId,
            status: created.status
          }
        });
        setMessage(`Run created: ${created.runId}`);

        while (!cancelPollingRef.current) {
          const detailResponse = await fetch(`${context.apiBaseUrl}/runs/${created.runId}`, {
            headers: context.apiKey ? { "x-api-key": context.apiKey } : undefined
          });
          if (!detailResponse.ok) {
            throw new Error(`Failed to poll run ${created.runId} (${detailResponse.status})`);
          }

          const nextDetails = (await detailResponse.json()) as PipelineDetails;
          setDetails(nextDetails);

          const status = nextDetails.run?.status;
          if (status === "completed" || status === "failed") {
            if (status === "completed") {
              const s = nextDetails.summary;
              const accepted = s?.accepted_records ?? 0;
              const coverage = Math.round((s?.priced_crawled_source_coverage_ratio ?? s?.priced_source_coverage_ratio ?? 0) * 100);
              setMessage(`✓ Run completed — ${accepted} accepted, ${coverage}% coverage`);
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
    [context.apiBaseUrl, context.apiKey, context.defaults, fetchRecentRuns, refreshAssessment]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      setHistory((current) => [trimmed, ...current].slice(0, 8));
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
          setDetailMode("help");
          setMessage("Command reference loaded.");
          return;
        }

        if (trimmed === "/status" || trimmed === "/doctor") {
          setDetailMode(trimmed === "/status" ? "status" : "setup");
          await refreshAssessment();
          setMessage("Environment status refreshed.");
          return;
        }

        if (trimmed === "/setup") {
          setDetailMode("setup");
          await refreshAssessment();
          setMessage("Setup diagnostics loaded. Run `artbot setup` for the guided wizard.");
          return;
        }

        if (trimmed === "/auth") {
          setDetailMode("auth");
          await refreshAssessment();
          setMessage("Auth profile status loaded.");
          return;
        }

        if (trimmed === "/runs") {
          setDetailMode("runs");
          await fetchRecentRuns();
          setMessage("Recent runs loaded.");
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
    [exit, fetchRecentRuns, onExit, refreshAssessment, startResearch]
  );

  const model = useMemo(
    () =>
      buildModel({
        assessment,
        details,
        recentRuns,
        activeArtist,
        input,
        history,
        detailMode,
        busy,
        message,
        context,
        tick,
        runStartedAt
      }),
    [activeArtist, assessment, busy, context, detailMode, details, history, input, message, recentRuns, tick, runStartedAt]
  );

  const messageColor = message.startsWith("✗") || message.startsWith("Failed") || message.includes("error")
    ? "red"
    : message.startsWith("✓")
      ? "green"
      : "gray";

  return (
    <Box flexDirection="column">
      <RenderTuiNode node={ArtbotTuiShell({ model })} />

      {/* ── Command input (Vercel-style) ── */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>
          ❯
        </Text>
        <Box marginLeft={1} flexGrow={1}>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="/research <artist>" />
        </Box>
      </Box>

      {/* ── Status message + keyboard shortcuts (k9s / lazygit style) ── */}
      <Box justifyContent="space-between">
        {message && message !== "Slash command ready." ? (
          <Text color={messageColor} dimColor>
            {message}
          </Text>
        ) : (
          <Text>{" "}</Text>
        )}
        <Box gap={2}>
          <Text>
            <Text color="cyan" bold>[/r]</Text>
            <Text color="gray"> research</Text>
          </Text>
          <Text>
            <Text color="cyan" bold>[/s]</Text>
            <Text color="gray"> setup</Text>
          </Text>
          <Text>
            <Text color="cyan" bold>[/h]</Text>
            <Text color="gray"> help</Text>
          </Text>
          <Text>
            <Text color="cyan" bold>[^c]</Text>
            <Text color="gray"> quit</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
