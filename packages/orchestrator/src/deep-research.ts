import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deepResearchPlanSchema,
  deepResearchResultSchema,
  deepResearchSettingsSchema,
  type DeepResearchCitation,
  type DeepResearchPlan,
  type DeepResearchResult,
  type DeepResearchSettings
} from "@artbot/shared-types";
import { logger } from "@artbot/observability";

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

function resolveArtbotHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ARTBOT_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(os.homedir(), ".artbot");
}

function resolveDeepResearchDefaults(env: NodeJS.ProcessEnv = process.env): DeepResearchSettings {
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

function loadDeepResearchSettings(env: NodeJS.ProcessEnv = process.env): DeepResearchSettings {
  const defaults = resolveDeepResearchDefaults(env);
  const preferencesPath = path.join(resolveArtbotHome(env), "tui.json");

  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath, "utf-8")) as {
      experimental?: Partial<DeepResearchSettings>;
    };
    return deepResearchSettingsSchema.parse({
      ...defaults,
      ...(raw.experimental ?? {})
    });
  } catch {
    return defaults;
  }
}

function resolveDeepResearchArtifactPath(resultsPath: string): string {
  return path.join(path.dirname(resultsPath), DEEP_RESEARCH_ARTIFACT_FILE);
}

function readDeepResearchArtifact(resultsPath: string): DeepResearchResult | null {
  const artifactPath = resolveDeepResearchArtifactPath(resultsPath);
  try {
    return deepResearchResultSchema.parse(JSON.parse(fs.readFileSync(artifactPath, "utf-8")));
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

function buildPlannerPrompt(payload: Record<string, any>): string {
  const compactContext = {
    run: {
      id: payload.run?.id,
      type: payload.run?.runType,
      artist: payload.run?.query?.artist,
      title: payload.run?.query?.title,
      status: payload.run?.status
    },
    summary: {
      accepted_records: payload.summary?.accepted_records,
      rejected_candidates: payload.summary?.rejected_candidates,
      discovered_candidates: payload.summary?.discovered_candidates,
      accepted_from_discovery: payload.summary?.accepted_from_discovery,
      priced_source_coverage_ratio: payload.summary?.priced_source_coverage_ratio ?? null,
      priced_crawled_source_coverage_ratio: payload.summary?.priced_crawled_source_coverage_ratio ?? null,
      valuation_eligible_records: payload.summary?.valuation_eligible_records ?? null,
      valuation_reason: payload.summary?.valuation_reason
    },
    records: Array.isArray(payload.records)
      ? payload.records.slice(0, 10).map((record: Record<string, unknown>) => ({
          work_title: record.work_title,
          source_name: record.source_name,
          price_type: record.price_type,
          price_amount: record.price_amount,
          currency: record.currency,
          accepted_for_valuation: record.accepted_for_valuation,
          acceptance_reason: record.acceptance_reason
        }))
      : [],
    recommended_actions: Array.isArray(payload.recommended_actions) ? payload.recommended_actions.slice(0, 6) : [],
    source_plan: Array.isArray(payload.source_plan)
      ? payload.source_plan.slice(0, 10).map((item: Record<string, unknown>) => ({
          source_name: item.source_name,
          access_status: item.source_access_status,
          legal_posture: item.legal_posture,
          candidate_count: item.candidate_count,
          selection_state: item.selection_state,
          selection_reason: item.selection_reason,
          skip_reason: item.skip_reason
        }))
      : [],
    gaps: Array.isArray(payload.gaps) ? payload.gaps : []
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

function buildDeepResearchPrompt(payload: Record<string, any>, plan: DeepResearchPlan): string {
  const artist = payload.run?.query?.artist ?? "Unknown artist";
  const title = payload.run?.query?.title ? ` for ${payload.run.query.title}` : "";
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

async function parseResponseJson(response: Response) {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const reason =
      (payload && typeof payload === "object" && "error" in payload ? JSON.stringify((payload as Record<string, unknown>).error) : text)
      || `HTTP ${response.status}`;
    throw new Error(reason);
  }

  return payload;
}

async function runPlanner(apiKey: string, plannerModel: string, payload: Record<string, any>) {
  const startedAt = Date.now();
  const endpoint = `${GEMINI_API_BASE_URL}/models/${plannerModel}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildPlannerPrompt(payload) }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });
  const responsePayload = await parseResponseJson(response);
  const rawText = extractJsonText(responsePayload);
  if (!rawText) {
    throw new Error("Planner returned no JSON payload.");
  }
  return {
    plan: deepResearchPlanSchema.parse(JSON.parse(rawText)),
    durationMs: Date.now() - startedAt
  };
}

async function startDeepResearchInteraction(
  apiKey: string,
  agentId: string,
  payload: Record<string, any>,
  plan: DeepResearchPlan
) {
  const response = await fetch(`${GEMINI_API_BASE_URL}/interactions?key=${apiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agent_config: {
        agent_id: agentId
      },
      input: {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${buildDeepResearchPrompt(payload, plan)}\n\nNormal ArtBot run payload:\n${JSON.stringify(payload, null, 2)}`
              }
            ]
          }
        ]
      }
    })
  });
  const responsePayload = await parseResponseJson(response);
  const interactionId = (responsePayload as { name?: string }).name;
  if (!interactionId) {
    throw new Error("Deep research interaction did not return a name.");
  }
  return interactionId;
}

async function pollInteraction(apiKey: string, interactionId: string, env: NodeJS.ProcessEnv) {
  const pollIntervalMs = toPositiveInt(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_POLL_MS, DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = toPositiveInt(env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const response = await fetch(`${GEMINI_API_BASE_URL}/${interactionId}?key=${apiKey}`, {
      method: "GET"
    });
    const responsePayload = await parseResponseJson(response);
    const state = (responsePayload as { state?: string }).state?.toUpperCase();

    if (state === "SUCCEEDED" || state === "COMPLETED") {
      const text = extractInteractionOutputText(responsePayload);
      return {
        reportMarkdown: text || "Deep research completed without textual output.",
        durationMs: Date.now() - startedAt
      };
    }

    if (state === "FAILED" || state === "CANCELLED") {
      const reason = (responsePayload as { error?: { message?: string } }).error?.message ?? `Interaction ${state.toLowerCase()}`;
      throw new Error(reason);
    }
  }

  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for deep research.`);
}

export async function maybeRunDeepResearchAfterCompletion(input: {
  runId: string;
  resultsPath: string;
  payload: Record<string, any>;
  env?: NodeJS.ProcessEnv;
}): Promise<DeepResearchResult | null> {
  const env = input.env ?? process.env;
  const settings = loadDeepResearchSettings(env);
  if (!settings.enabled) {
    return null;
  }

  const existing = readDeepResearchArtifact(input.resultsPath);
  if (existing?.status === "completed") {
    return existing;
  }

  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    return writeDeepResearchArtifact(input.resultsPath, {
      enabled: true,
      status: "skipped",
      summary: "Experimental AI research skipped because GEMINI_API_KEY is missing.",
      citations: [],
      warnings: ["Configure a Google AI Studio spend cap before enabling this feature."]
    });
  }

  const warnings = settings.warnOnRun
    ? [`Experimental AI research is enabled and may be expensive. Set a spend cap in Google AI Studio around $${settings.spendCapReminderUsd}+ before heavy use.`]
    : [];

  try {
    logger.info("Experimental AI research started", { runId: input.runId, plannerModel: settings.plannerModel });
    const planning = await runPlanner(apiKey, settings.plannerModel, input.payload);
    const agentId = env.ARTBOT_EXPERIMENTAL_DEEP_RESEARCH_AGENT?.trim() || DEEP_RESEARCH_AGENT_ID;
    const interactionId = await startDeepResearchInteraction(apiKey, agentId, input.payload, planning.plan);
    const research = await pollInteraction(apiKey, interactionId, env);
    const result = writeDeepResearchArtifact(input.resultsPath, {
      enabled: true,
      status: "completed",
      summary: summarizeFinalReport(
        research.reportMarkdown,
        "Experimental AI research completed and expanded the run with additional synthesis."
      ),
      promptPlan: planning.plan,
      reportMarkdown: research.reportMarkdown,
      citations: extractCitationCandidates(research.reportMarkdown),
      warnings,
      providerMetadata: {
        plannerModel: settings.plannerModel,
        researchMode: settings.researchMode,
        agentId,
        planningDurationMs: planning.durationMs,
        researchDurationMs: research.durationMs,
        completedAt: new Date().toISOString()
      }
    });
    logger.info("Experimental AI research completed", { runId: input.runId, interactionId });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn("Experimental AI research failed", { runId: input.runId, reason });
    return writeDeepResearchArtifact(input.resultsPath, {
      enabled: true,
      status: "failed",
      summary: `Experimental AI research failed: ${reason}`,
      citations: [],
      warnings
    });
  }
}
