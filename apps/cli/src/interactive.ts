import { pathExists } from "./lib/file-system.js";
import { runInteractiveTui } from "./interactive-app.js";
import { normalizeReportSurface } from "./report/browser-report.js";
import { assessLocalSetup, runSetupWizard } from "./setup/index.js";
import { loadTuiPreferences } from "./tui/index.js";

interface InteractiveContext {
  apiBaseUrl: string;
  apiKey?: string;
}

interface PipelineEnvDefaults {
  analysisMode: "comprehensive" | "balanced" | "fast";
  priceNormalization: "legacy" | "usd_dual" | "usd_nominal" | "usd_2026";
  reportSurface: "ask" | "cli" | "web";
  authProfileId?: string;
  allowLicensed: boolean;
  licensedIntegrations: string[];
  transportMaxAttempts: number;
  transportRequestTimeoutMs: number;
  transportCurlFallback: boolean;
  pipelineConcurrency: {
    healthy: number;
    degraded: number;
    suspected: number;
  };
  pipelineCandidateTimeoutMs: number;
}

interface PipelineDetails {
  run?: { status?: string };
  summary?: unknown;
  records?: unknown[];
  duplicates?: unknown[];
  valuation?: unknown;
  per_painting_stats?: unknown[];
  attempts?: Array<{
    source_url: string;
    source_access_status: string;
    blocker_reason?: string | null;
    extracted_fields?: Record<string, unknown>;
  }>;
}

interface BlockerSummary {
  category: string;
  count: number;
  hosts: string[];
}

type PipelineAttempt = NonNullable<PipelineDetails["attempts"]>[number];

function resolveContext(): InteractiveContext {
  return {
    apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
    apiKey: process.env.ARTBOT_API_KEY
  };
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

export function resolvePipelineDefaultsFromEnv(): PipelineEnvDefaults {
  const rawLicensed = process.env.DEFAULT_LICENSED_INTEGRATIONS ?? "";
  const licensedIntegrations = rawLicensed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    analysisMode:
      (process.env.DEFAULT_ANALYSIS_MODE as PipelineEnvDefaults["analysisMode"] | undefined) ?? "comprehensive",
    priceNormalization:
      (process.env.DEFAULT_PRICE_NORMALIZATION as PipelineEnvDefaults["priceNormalization"] | undefined) ?? "usd_dual",
    reportSurface: normalizeReportSurface(process.env.DEFAULT_REPORT_SURFACE),
    authProfileId: process.env.DEFAULT_AUTH_PROFILE?.trim() || undefined,
    allowLicensed: parseBoolean(process.env.ENABLE_LICENSED_INTEGRATIONS, false),
    licensedIntegrations,
    transportMaxAttempts: toPositiveInt(process.env.TRANSPORT_MAX_ATTEMPTS, 3),
    transportRequestTimeoutMs: toPositiveInt(process.env.TRANSPORT_REQUEST_TIMEOUT_MS, 15_000),
    transportCurlFallback: parseBoolean(process.env.TRANSPORT_CURL_FALLBACK, true),
    pipelineConcurrency: {
      healthy: toPositiveInt(process.env.PIPELINE_MAX_CONCURRENCY, 6),
      degraded: toPositiveInt(process.env.PIPELINE_DEGRADED_CONCURRENCY, 3),
      suspected: toPositiveInt(process.env.PIPELINE_SUSPECTED_CONCURRENCY, 1)
    },
    pipelineCandidateTimeoutMs: toPositiveInt(process.env.PIPELINE_CANDIDATE_TIMEOUT_MS, 45_000)
  };
}

function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function classifyBlocker(attempt: PipelineAttempt): string {
  const blocker = (attempt.blocker_reason ?? "").toLowerCase();
  const transport = attempt.extracted_fields?.transport as { kind?: string; provider?: string } | undefined;
  const transportKind = transport?.kind?.toUpperCase();

  if (
    blocker.includes("target_unreachable") ||
    blocker.includes("transport:dns_failed") ||
    blocker.includes("transport:tcp_timeout") ||
    blocker.includes("transport:tcp_refused") ||
    blocker.includes("transport:tls_failed") ||
    blocker.includes("transport:unknown_network")
  ) {
    return "transport_outage";
  }

  if (transportKind === "RATE_LIMITED") return "rate_limited";
  if (transportKind === "AUTH_INVALID" || attempt.source_access_status === "auth_required") return "auth_required";
  if (transportKind === "LEGAL_BLOCK") return "legal_block";
  if (transportKind === "WAF_BLOCK") return "waf_block";
  if (attempt.source_access_status === "price_hidden") return "price_hidden";
  if (attempt.source_access_status === "blocked") return "blocked";
  return "other";
}

export function summarizeAttemptBlockers(attempts: PipelineDetails["attempts"]): BlockerSummary | null {
  if (!attempts || attempts.length === 0) return null;

  const counters = new Map<string, { count: number; hosts: Map<string, number> }>();
  for (const attempt of attempts) {
    const category = classifyBlocker(attempt);
    const host = hostFromUrl(attempt.source_url) ?? "unknown-host";
    const current = counters.get(category) ?? { count: 0, hosts: new Map<string, number>() };
    current.count += 1;
    current.hosts.set(host, (current.hosts.get(host) ?? 0) + 1);
    counters.set(category, current);
  }

  const top = [...counters.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!top) return null;

  const topHosts = [...top[1].hosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([host]) => host);

  return {
    category: top[0],
    count: top[1].count,
    hosts: topHosts
  };
}

function shouldRunSetupWizard(assessment: Awaited<ReturnType<typeof assessLocalSetup>>): boolean {
  return !pathExists(assessment.envPath) || Boolean(assessment.authProfilesError);
}

export async function startInteractive(): Promise<number> {
  let initialAssessment = await assessLocalSetup();

  if (shouldRunSetupWizard(initialAssessment)) {
    try {
      const setup = await runSetupWizard();
      initialAssessment = setup.assessment;
    } catch {
      return 0;
    }
  }

  const ctx = resolveContext();
  const pipelineDefaults = resolvePipelineDefaultsFromEnv();
  const initialPreferences = loadTuiPreferences();

  return runInteractiveTui({
    context: {
      apiBaseUrl: ctx.apiBaseUrl,
      apiKey: ctx.apiKey,
      defaults: {
        analysisMode: pipelineDefaults.analysisMode,
        priceNormalization: pipelineDefaults.priceNormalization,
        reportSurface: pipelineDefaults.reportSurface,
        authProfileId: pipelineDefaults.authProfileId,
        allowLicensed: pipelineDefaults.allowLicensed,
        licensedIntegrations: pipelineDefaults.licensedIntegrations
      }
    },
    initialAssessment,
    initialPreferences
  });
}
