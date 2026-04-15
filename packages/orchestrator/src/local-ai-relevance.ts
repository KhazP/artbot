import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  LocalAiAnalysisSummary,
  LocalAiConfidenceBand,
  LocalAiDecisionAction,
  LocalAiDecisionTrace,
  ResearchQuery
} from "@artbot/shared-types";
import type { SourceCandidate } from "@artbot/source-adapters";

interface LocalAiDecisionPayload {
  action: LocalAiDecisionAction;
  confidence: number;
  reasons: string[];
}

interface LocalAiRequestResult {
  payload: LocalAiDecisionPayload;
  model: string | null;
  latencyMs: number;
}

export interface LocalAiRelevanceConfig {
  enabled: boolean;
  provider: "openai_compatible";
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  mode: "aggressive" | "balanced" | "conservative";
  minConfidenceAuto: number;
  maxLatencyMs: number;
  maxTokens: number;
}

const decisionSchema = z.object({
  action: z.enum(["accept_candidate", "queue_review", "reject_candidate"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([])
});

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function asInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() !== "false";
}

function asMode(value: string | undefined): LocalAiRelevanceConfig["mode"] {
  const normalized = (value ?? "aggressive").trim().toLowerCase();
  if (normalized === "balanced") return "balanced";
  if (normalized === "conservative") return "conservative";
  return "aggressive";
}

function defaultMinConfidenceForMode(mode: LocalAiRelevanceConfig["mode"]): number {
  if (mode === "conservative") return 0.82;
  if (mode === "balanced") return 0.74;
  return 0.66;
}

export function buildLocalAiRelevanceConfigFromEnv(): LocalAiRelevanceConfig {
  const mode = asMode(process.env.LOCAL_AI_RELEVANCE_MODE);
  const configuredMin = Number(process.env.LOCAL_AI_MIN_CONFIDENCE_AUTO ?? defaultMinConfidenceForMode(mode));
  const minConfidenceAuto = Number.isFinite(configuredMin)
    ? clamp(configuredMin, 0.01, 0.99)
    : defaultMinConfidenceForMode(mode);
  const baseUrl = process.env.LLM_BASE_URL?.trim() ?? null;

  return {
    enabled: asBoolean(process.env.LOCAL_AI_RELEVANCE_ENABLED, true) && Boolean(baseUrl),
    provider: "openai_compatible",
    baseUrl,
    apiKey: process.env.LLM_API_KEY?.trim() ?? null,
    model: process.env.MODEL_CHEAP_DEFAULT ?? "google/gemma-4-26b-a4b",
    mode,
    minConfidenceAuto,
    maxLatencyMs: asInteger(process.env.LOCAL_AI_MAX_LATENCY_MS, 3_500),
    maxTokens: asInteger(process.env.LOCAL_AI_MAX_TOKENS, 320)
  };
}

export function confidenceBandForScore(confidence: number): LocalAiConfidenceBand {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

export function buildDecisionFingerprint(input: unknown): string {
  return createHash("sha1").update(JSON.stringify(input)).digest("hex");
}

function parseModelResponse(raw: string): LocalAiDecisionPayload | null {
  const trimmed = raw.trim();
  const attempts: string[] = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    attempts.push(fenced[1].trim());
  }

  for (const candidate of attempts) {
    try {
      return decisionSchema.parse(JSON.parse(candidate) as unknown);
    } catch {
      // Continue.
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return decisionSchema.parse(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown);
    } catch {
      return null;
    }
  }
  return null;
}

async function callLocalAiDecision(
  config: LocalAiRelevanceConfig,
  stage: LocalAiDecisionTrace["stage"],
  promptPayload: unknown
): Promise<LocalAiRequestResult | null> {
  if (!config.enabled || !config.baseUrl) {
    return null;
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.maxLatencyMs);
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (config.apiKey) {
      headers.authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON only. Decide candidate relevance for art-market evidence. Use action: accept_candidate, queue_review, or reject_candidate."
          },
          {
            role: "user",
            content: JSON.stringify({
              stage,
              mode: config.mode,
              payload: promptPayload
            })
          }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
              .join("\n")
          : null;
    if (!text) {
      return null;
    }

    const parsed = parseModelResponse(text);
    if (!parsed) {
      return null;
    }

    return {
      payload: parsed,
      model: payload.model ?? config.model,
      latencyMs: Date.now() - startedAt
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function evaluateDiscoveryCandidateWithLocalAi(
  config: LocalAiRelevanceConfig,
  args: {
    candidate: SourceCandidate;
    query: ResearchQuery;
    sourceName: string;
    deterministicAllowed: boolean;
    deterministicReason?: string | null;
  }
): Promise<LocalAiDecisionTrace> {
  const fingerprint = buildDecisionFingerprint({
    stage: "discovery_triage",
    sourceName: args.sourceName,
    candidate: args.candidate,
    query: {
      artist: args.query.artist,
      title: args.query.title ?? null,
      medium: args.query.medium ?? null,
      year: args.query.year ?? null
    }
  });

  if (!args.deterministicAllowed) {
    return {
      stage: "discovery_triage",
      fingerprint,
      provider: config.provider,
      model: config.model,
      action: "reject_candidate",
      outcome: "reject_candidate",
      confidence: 1,
      confidence_band: "high",
      reasons: [args.deterministicReason ?? "deterministic_guardrail_rejected_candidate"],
      latency_ms: 0,
      deterministic_veto: true,
      deterministic_veto_reason: args.deterministicReason ?? "deterministic_guardrail_rejected_candidate"
    };
  }

  const decision = await callLocalAiDecision(config, "discovery_triage", {
    source_name: args.sourceName,
    candidate: args.candidate,
    query: {
      artist: args.query.artist,
      title: args.query.title ?? null,
      medium: args.query.medium ?? null,
      year: args.query.year ?? null
    },
    instructions: {
      accept_candidate: "High relevance and likely pricing evidence.",
      queue_review: "Possibly relevant but uncertain or incomplete.",
      reject_candidate: "Irrelevant, noisy, or wrong-entity URL."
    }
  });

  if (!decision) {
    return {
      stage: "discovery_triage",
      fingerprint,
      provider: config.provider,
      model: config.model,
      action: "queue_review",
      outcome: "queue_review",
      confidence: 0.5,
      confidence_band: "medium",
      reasons: ["local_ai_unavailable_fallback"],
      latency_ms: 0,
      deterministic_veto: false,
      deterministic_veto_reason: null
    };
  }

  const outcome =
    decision.payload.confidence >= config.minConfidenceAuto
      ? decision.payload.action
      : "queue_review";

  return {
    stage: "discovery_triage",
    fingerprint,
    provider: config.provider,
    model: decision.model,
    action: decision.payload.action,
    outcome,
    confidence: decision.payload.confidence,
    confidence_band: confidenceBandForScore(decision.payload.confidence),
    reasons: decision.payload.reasons.length > 0 ? decision.payload.reasons : ["no_reasons_provided"],
    latency_ms: decision.latencyMs,
    deterministic_veto: false,
    deterministic_veto_reason: null
  };
}

export async function evaluateBorderlinePairWithLocalAi(
  config: LocalAiRelevanceConfig,
  args: {
    left: Record<string, unknown>;
    right: Record<string, unknown>;
    reasons: string[];
  }
): Promise<LocalAiDecisionTrace | null> {
  const decision = await callLocalAiDecision(config, "cluster_borderline", {
    left: args.left,
    right: args.right,
    current_reasons: args.reasons,
    instructions: {
      accept_candidate: "Likely the same exact artwork.",
      queue_review: "Unclear; operator review required.",
      reject_candidate: "Likely different works."
    }
  });

  if (!decision) {
    return null;
  }

  const fingerprint = buildDecisionFingerprint({
    stage: "cluster_borderline",
    left: args.left,
    right: args.right
  });

  return {
    stage: "cluster_borderline",
    fingerprint,
    provider: config.provider,
    model: decision.model,
    action: decision.payload.action,
    outcome: "queue_review",
    confidence: decision.payload.confidence,
    confidence_band: confidenceBandForScore(decision.payload.confidence),
    reasons: decision.payload.reasons.length > 0 ? decision.payload.reasons : args.reasons,
    latency_ms: decision.latencyMs,
    deterministic_veto: decision.payload.action === "accept_candidate",
    deterministic_veto_reason:
      decision.payload.action === "accept_candidate" ? "borderline_matches_require_review" : null
  };
}

export function buildLocalAiAnalysisSummary(decisions: LocalAiDecisionTrace[]): LocalAiAnalysisSummary | undefined {
  if (decisions.length === 0) {
    return undefined;
  }

  const accepted = decisions.filter((decision) => decision.outcome === "accept_candidate").length;
  const queued = decisions.filter((decision) => decision.outcome === "queue_review").length;
  const rejected = decisions.filter((decision) => decision.outcome === "reject_candidate").length;
  const low = decisions.filter((decision) => decision.confidence_band === "low").length;
  const medium = decisions.filter((decision) => decision.confidence_band === "medium").length;
  const high = decisions.filter((decision) => decision.confidence_band === "high").length;
  const latencyValues = decisions.filter((decision) => decision.latency_ms > 0).map((decision) => decision.latency_ms);
  const avgLatencyMs =
    latencyValues.length > 0
      ? Number((latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length).toFixed(2))
      : null;
  const latestModel = [...decisions].reverse().find((decision) => decision.model)?.model ?? null;
  const latestProvider = [...decisions].reverse().find((decision) => decision.provider)?.provider ?? null;

  return {
    decisions: {
      accepted,
      queued,
      rejected
    },
    deterministic_veto_count: decisions.filter((decision) => decision.deterministic_veto).length,
    confidence_band_counts: {
      low,
      medium,
      high
    },
    provider: latestProvider,
    model: latestModel,
    avg_latency_ms: avgLatencyMs
  };
}
