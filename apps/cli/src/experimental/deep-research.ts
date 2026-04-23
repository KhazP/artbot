import fs from "node:fs";
import path from "node:path";
import {
  deepResearchPlanSchema,
  deepResearchResultSchema,
  deepResearchSettingsSchema,
  type DeepResearchCitation,
  type DeepResearchPlan,
  type DeepResearchResult,
  type DeepResearchSettings,
  type RunDetailsResponsePayload
} from "@artbot/shared-types";
import type { TuiPreferences } from "../tui/preferences.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEEP_RESEARCH_AGENT_ID = "deep-research-pro-preview-12-2025";
const DEEP_RESEARCH_ARTIFACT_FILE = "deep-research.json";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function resolveDeepResearchDefaults(env: NodeJS.ProcessEnv = process.env): DeepResearchSettings {
  return deepResearchSettingsSchema.parse({
    enabled: isTruthy(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_ENABLED),
    plannerModel: env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_PLANNER_MODEL?.trim() || "gemini-pro-latest",
    researchMode: "deep_research_max",
    warnOnRun:
      env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_WARN_ON_RUN === undefined
        ? true
        : isTruthy(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_WARN_ON_RUN),
    spendCapReminderUsd: toPositiveInt(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_SPEND_CAP_REMINDER_USD, 20),
    openFullReportAfterRun:
      env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_OPEN_FULL_REPORT === undefined
        ? true
        : isTruthy(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_OPEN_FULL_REPORT)
  });
}

export function resolveEffectiveDeepResearchSettings(
  preferences: Pick<TuiPreferences, "experimental"> | undefined,
  env: NodeJS.ProcessEnv = process.env
): DeepResearchSettings {
  const defaults = resolveDeepResearchDefaults(env);
  return deepResearchSettingsSchema.parse({
    ...defaults,
    ...(preferences?.experimental ?? {})
  });
}

export function resolveDeepResearchArtifactPath(resultsPath: string): string {
  return path.join(path.dirname(resultsPath), DEEP_RESEARCH_ARTIFACT_FILE);
}

export function readDeepResearchArtifact(resultsPath: string): DeepResearchResult | null {
  const artifactPath = resolveDeepResearchArtifactPath(resultsPath);
  try {
    const raw = fs.readFileSync(artifactPath, "utf-8");
    return deepResearchResultSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeDeepResearchArtifact(resultsPath: string, result: DeepResearchResult): DeepResearchResult {
  const artifactPath = resolveDeepResearchArtifactPath(resultsPath);
  const next = deepResearchResultSchema.parse({
    ...result,
    artifactPath
  });
  fs.writeFileSync(artifactPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return next;
}

function extractCitationCandidates(text: string): DeepResearchCitation[] {
  const markdownLinks = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((match) => ({
    title: match[1]!.trim(),
    url: match[2]!.trim()
  }));
  if (markdownLinks.length > 0) {
    return markdownLinks.slice(0, 12);
  }

  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match, index) => ({
    title: `Source ${index + 1}`,
    url: match[0]!.trim()
  }));
  return urls.slice(0, 12);
}

function summarizeFinalReport(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 320 ? `${cleaned.slice(0, 317)}...` : cleaned;
}

function buildPlannerPrompt(details: RunDetailsResponsePayload): string {
  const compactContext = {
    run: {
      id: details.run.id,
      type: details.run.runType,
      artist: details.run.query.artist,
      title: details.run.query.title,
      status: details.run.status
    },
    summary: {
      accepted_records: details.summary.accepted_records,
      rejected_candidates: details.summary.rejected_candidates,
      discovered_candidates: details.summary.discovered_candidates,
      accepted_from_discovery: details.summary.accepted_from_discovery,
      priced_source_coverage_ratio: details.summary.priced_source_coverage_ratio ?? null,
      priced_crawled_source_coverage_ratio: details.summary.priced_crawled_source_coverage_ratio ?? null,
      valuation_eligible_records: details.summary.valuation_eligible_records ?? null,
      valuation_reason: details.summary.valuation_reason
    },
    records: details.records.slice(0, 10).map((record) => ({
      work_title: record.work_title,
      source_name: record.source_name,
      price_type: record.price_type,
      price_amount: record.price_amount,
      currency: record.currency,
      accepted_for_valuation: record.accepted_for_valuation,
      acceptance_reason: record.acceptance_reason
    })),
    recommended_actions: (details.recommended_actions ?? []).slice(0, 6),
    source_plan: (details.source_plan ?? []).slice(0, 10).map((item) => ({
      source_name: item.source_name,
      access_status: item.source_access_status,
      legal_posture: item.legal_posture,
      candidate_count: item.candidate_count,
      selection_state: item.selection_state,
      selection_reason: item.selection_reason,
      skip_reason: item.skip_reason
    })),
    gaps: (details as Record<string, unknown>).gaps ?? []
  };

  return [
    "You are planning an expensive follow-up research pass for ArtBot.",
    "Return strict JSON only.",
    "Summarize what the normal ArtBot browser run found and what it did not find.",
    "Create a focused deep-research brief for a long-horizon research agent.",
    "Do not restate the full payload. Be concise and specific.",
    "",
    "Required JSON fields:",
    "- normalRunSummary",
    "- missingEvidenceSummary",
    "- researchObjectives",
    "- followUpQuestions",
    "- prioritySearchTargets",
    "- finalReportInstructions",
    "",
    "Run context:",
    JSON.stringify(compactContext, null, 2)
  ].join("\n");
}

function buildDeepResearchPrompt(details: RunDetailsResponsePayload, plan: DeepResearchPlan): string {
  const artist = details.run.query.artist ?? "Unknown artist";
  const title = details.run.query.title ? ` for ${details.run.query.title}` : "";
  return [
    `Perform an exhaustive art-market deep research report for ${artist}${title}.`,
    "This follows a completed ArtBot browser research run and should expand on the existing evidence, not replace it.",
    "",
    "What ArtBot already found:",
    plan.normalRunSummary,
    "",
    "What is still weak or missing:",
    plan.missingEvidenceSummary,
    "",
    "Research objectives:",
    ...plan.researchObjectives.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Follow-up questions:",
    ...plan.followUpQuestions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Priority search targets:",
    ...plan.prioritySearchTargets.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Final report requirements:",
    plan.finalReportInstructions,
    "",
    "Output requirements:",
    "- Produce a detailed, cited report.",
    "- Distinguish between ArtBot-confirmed evidence and newly synthesized analysis.",
    "- Call out missing provenance, weak coverage, blocked/auth-required sources, and remaining uncertainty.",
    "- Include concrete next steps for additional manual or browser-based follow-up."
  ].join("\n");
}

function extractJsonText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidateText =
    (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof candidateText === "string" ? candidateText : null;
}

function extractInteractionOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const outputs = (payload as { outputs?: unknown[] }).outputs;
  if (!Array.isArray(outputs)) return null;

  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const output = outputs[index];
    if (!output || typeof output !== "object") continue;
    if (typeof (output as { text?: unknown }).text === "string") {
      return ((output as { text: string }).text ?? "").trim();
    }
    const parts = (output as { content?: { parts?: Array<{ text?: string }> } }).content?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
        .trim();
      if (text) return text;
    }
  }

  return null;
}

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown, headers: Record<string, string>) {
  return fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function getJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>) {
  return fetchImpl(url, {
    method: "GET",
    headers
  });
}

async function runPlanner(
  fetchImpl: typeof fetch,
  apiKey: string,
  plannerModel: string,
  details: RunDetailsResponsePayload
): Promise<{ plan: DeepResearchPlan; durationMs: number }> {
  const startedAt = Date.now();
  const endpoint = `${GEMINI_API_BASE_URL}/models/${plannerModel}:generateContent?key=${apiKey}`;
  const response = await postJson(
    fetchImpl,
    endpoint,
    {
      contents: [{ parts: [{ text: buildPlannerPrompt(details) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          required: [
            "normalRunSummary",
            "missingEvidenceSummary",
            "researchObjectives",
            "followUpQuestions",
            "prioritySearchTargets",
            "finalReportInstructions"
          ],
          properties: {
            normalRunSummary: { type: "STRING" },
            missingEvidenceSummary: { type: "STRING" },
            researchObjectives: { type: "ARRAY", items: { type: "STRING" } },
            followUpQuestions: { type: "ARRAY", items: { type: "STRING" } },
            prioritySearchTargets: { type: "ARRAY", items: { type: "STRING" } },
            finalReportInstructions: { type: "STRING" }
          }
        }
      }
    },
    {}
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Planner request failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const text = extractJsonText(payload);
  if (!text) {
    throw new Error("Planner response did not include JSON text.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Planner response was not valid JSON.");
  }

  return {
    plan: deepResearchPlanSchema.parse(parsed),
    durationMs: Date.now() - startedAt
  };
}

async function runDeepResearchAgent(
  fetchImpl: typeof fetch,
  apiKey: string,
  details: RunDetailsResponsePayload,
  plan: DeepResearchPlan,
  env: NodeJS.ProcessEnv
): Promise<{ interactionId: string; reportMarkdown: string; durationMs: number }> {
  const startedAt = Date.now();
  const agentId = env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_AGENT?.trim() || DEEP_RESEARCH_AGENT_ID;
  const createResponse = await postJson(
    fetchImpl,
    `${GEMINI_API_BASE_URL}/interactions`,
    {
      input: buildDeepResearchPrompt(details, plan),
      agent: agentId,
      background: true,
      store: true
    },
    {
      "x-goog-api-key": apiKey
    }
  );

  if (!createResponse.ok) {
    const text = await createResponse.text();
    throw new Error(`Deep Research start failed (${createResponse.status}): ${text.slice(0, 240)}`);
  }

  const created = (await createResponse.json()) as { id?: string; status?: string };
  const interactionId = created.id?.trim();
  if (!interactionId) {
    throw new Error("Deep Research start did not return an interaction id.");
  }

  const pollIntervalMs = toPositiveInt(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_POLL_MS, DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = toPositiveInt(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Deep Research timed out before completion.");
    }

    const statusResponse = await getJson(
      fetchImpl,
      `${GEMINI_API_BASE_URL}/interactions/${interactionId}`,
      { "x-goog-api-key": apiKey }
    );
    if (!statusResponse.ok) {
      const text = await statusResponse.text();
      throw new Error(`Deep Research polling failed (${statusResponse.status}): ${text.slice(0, 240)}`);
    }

    const interaction = await statusResponse.json();
    const status = typeof (interaction as { status?: unknown }).status === "string"
      ? (interaction as { status: string }).status
      : "unknown";

    if (status === "completed") {
      const reportMarkdown = extractInteractionOutputText(interaction);
      if (!reportMarkdown) {
        throw new Error("Deep Research completed without a final report.");
      }

      return {
        interactionId,
        reportMarkdown,
        durationMs: Date.now() - startedAt
      };
    }

    if (status === "failed" || status === "cancelled") {
      const error =
        typeof (interaction as { error?: { message?: unknown } }).error?.message === "string"
          ? (interaction as { error: { message: string } }).error.message
          : `status=${status}`;
      throw new Error(`Deep Research ended without success: ${error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export function attachDeepResearchResult(
  details: RunDetailsResponsePayload,
  result: DeepResearchResult | null
): RunDetailsResponsePayload {
  if (!result) return details;
  return {
    ...details,
    deepResearch: result
  };
}

export async function ensureDeepResearchForRun(input: {
  details: RunDetailsResponsePayload;
  settings: DeepResearchSettings;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  onStatus?: (message: string) => void;
}): Promise<RunDetailsResponsePayload> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const details = input.details;
  const resultsPath = details.run.resultsPath?.trim();
  if (resultsPath) {
    const existing = readDeepResearchArtifact(resultsPath);
    if (existing) {
      return attachDeepResearchResult(details, existing);
    }
  }

  if (!input.settings.enabled) {
    return details;
  }

  if (details.run.status !== "completed" || !resultsPath) {
    return attachDeepResearchResult(details, {
      enabled: true,
      status: "skipped",
      summary: "Experimental AI research only runs on completed runs with local artifacts.",
      citations: [],
      warnings: []
    });
  }

  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    return attachDeepResearchResult(details, {
      enabled: true,
      status: "skipped",
      summary: "Experimental AI research skipped because GEMINI_API_KEY is missing.",
      citations: [],
      warnings: ["Configure a Google AI Studio spend cap before enabling this feature."]
    });
  }

  const warnings = input.settings.warnOnRun
    ? [
        `Experimental AI research is enabled and may be expensive. Set a spend cap in Google AI Studio around $${input.settings.spendCapReminderUsd}+ before heavy use.`
      ]
    : [];

  try {
    input.onStatus?.("Experimental AI research planner running...");
    const planner = await runPlanner(fetchImpl, apiKey, input.settings.plannerModel, details);
    input.onStatus?.("Experimental AI research agent running. This may take several minutes...");
    const research = await runDeepResearchAgent(fetchImpl, apiKey, details, planner.plan, env);
    const result = writeDeepResearchArtifact(resultsPath, {
      enabled: true,
      status: "completed",
      summary: summarizeFinalReport(
        research.reportMarkdown,
        "Experimental AI research completed and expanded the run with additional synthesis."
      ),
      promptPlan: planner.plan,
      reportMarkdown: research.reportMarkdown,
      citations: extractCitationCandidates(research.reportMarkdown),
      warnings,
      providerMetadata: {
        plannerModel: input.settings.plannerModel,
        researchMode: input.settings.researchMode,
        agentId: env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_AGENT?.trim() || DEEP_RESEARCH_AGENT_ID,
        planningDurationMs: planner.durationMs,
        researchDurationMs: research.durationMs,
        completedAt: new Date().toISOString()
      }
    });
    return attachDeepResearchResult(details, result);
  } catch (error) {
    return attachDeepResearchResult(
      details,
      writeDeepResearchArtifact(resultsPath, {
        enabled: true,
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        promptPlan: null,
        reportMarkdown: null,
        citations: [],
        warnings
      })
    );
  }
}
