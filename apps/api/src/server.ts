import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { AuthManager } from "@artbot/auth-manager";
import { buildEvaluationMetrics } from "@artbot/orchestrator";
import { buildDiscoveryConfigFromEnv, buildSourcePlanItems, planSources, SourceRegistry } from "@artbot/source-registry";
import {
  acceptanceReasonList,
  artistMarketInventoryResultsPayloadSchema,
  artistMarketInventoryRequestSchema,
  failureClassList,
  researchArtistRequestSchema,
  researchWorkRequestSchema,
  runDetailsResponseSchema,
  type ArtistMarketInventoryResultsPayload,
  type RunSummary,
  sourceStatusList
} from "@artbot/shared-types";
import { ARTIFACT_MANIFEST_FILE, ArtbotStorage, readArtifactManifest } from "@artbot/storage";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveWorkspaceRoot(): string {
  const candidates = [
    process.env.INIT_CWD,
    process.cwd(),
    path.resolve(moduleDir, "../../..")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const root = findWorkspaceRoot(candidate);
    if (root) {
      return root;
    }
  }

  return path.resolve(moduleDir, "../../..");
}

function resolveWorkspaceDefault(relativePath: string): string {
  return path.resolve(resolveWorkspaceRoot(), relativePath);
}

dotenv.config({ path: resolveWorkspaceDefault(".env"), override: false });

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST?.trim() || "0.0.0.0";
const apiKey = process.env.ARTBOT_API_KEY;

const dbPath = process.env.DATABASE_PATH ?? resolveWorkspaceDefault("var/data/artbot.db");
const runsRoot = process.env.RUNS_ROOT ?? resolveWorkspaceDefault("var/runs");

const storage = new ArtbotStorage(dbPath, runsRoot);
const sourceRegistry = new SourceRegistry();
const authManager = new AuthManager();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

function isPricedAcceptanceReason(reason: (typeof acceptanceReasonList)[number]): boolean {
  return reason === "valuation_ready" || reason === "estimate_range_ready" || reason === "asking_price_ready";
}

function isCrawledSourceStatus(status: (typeof sourceStatusList)[number]): boolean {
  return status !== "blocked" && status !== "auth_required";
}

const runsQuerySchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const recoverStaleRunsSchema = z.object({
  maxStaleMinutes: z.coerce.number().int().positive().max(24 * 60).optional(),
  reason: z.string().trim().min(3).max(240).optional()
});

app.addHook("preHandler", async (request, reply) => {
  if (!apiKey) return;

  if (request.url.startsWith("/health")) {
    return;
  }

  const incoming = request.headers["x-api-key"];
  if (incoming !== apiKey) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

app.get("/health", async () => ({ ok: true }));

async function buildPlanPreview(
  query: z.infer<typeof researchArtistRequestSchema>["query"],
  runType: "artist" | "work" | "artist_market_inventory"
) {
  const adapters =
    runType === "artist_market_inventory"
      ? sourceRegistry.list().filter((adapter: ReturnType<typeof sourceRegistry.list>[number]) => (query.sourceClasses ?? []).includes(adapter.venueType))
      : sourceRegistry.list();
  const plannedSources = await planSources(query, adapters, authManager, storage.listHostHealth(50));
  const candidateCap = buildDiscoveryConfigFromEnv(query.analysisMode).maxCandidatesPerSource;
  const sourcePlan = buildSourcePlanItems(plannedSources, candidateCap, query.analysisMode);
  const totals = sourcePlan.reduce<Record<string, number>>((acc: Record<string, number>, item) => {
    acc[item.selection_state] = (acc[item.selection_state] ?? 0) + 1;
    return acc;
  }, {});

  return {
    source_plan: sourcePlan,
    candidate_cap: candidateCap,
    totals
  };
}

app.post("/research/artist/plan", async (request, reply) => {
  const parsed = researchArtistRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  return buildPlanPreview(parsed.data.query, "artist");
});

app.post("/research/work/plan", async (request, reply) => {
  const parsed = researchWorkRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  return buildPlanPreview(parsed.data.query, "work");
});

app.post("/crawl/artist-market/plan", async (request, reply) => {
  const parsed = artistMarketInventoryRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  return buildPlanPreview(parsed.data.query, "artist_market_inventory");
});

app.post("/research/artist", async (request, reply) => {
  const parsed = researchArtistRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const run = storage.createRun("artist", parsed.data.query);
  return reply.status(202).send({ runId: run.id, status: run.status });
});

app.post("/research/work", async (request, reply) => {
  const parsed = researchWorkRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const run = storage.createRun("work", parsed.data.query);
  return reply.status(202).send({ runId: run.id, status: run.status });
});

app.post("/crawl/artist-market", async (request, reply) => {
  const parsed = artistMarketInventoryRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const run = storage.createRun("artist_market_inventory", parsed.data.query);
  return reply.status(202).send({ runId: run.id, status: run.status });
});

app.get("/runs", async (request, reply) => {
  const parsed = runsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const runs = storage.listRuns(parsed.data.limit ?? 20, parsed.data.status);
  return {
    runs
  };
});

app.get("/runs/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const details = storage.getRunDetails(id);

  if (!details) {
    return reply.status(404).send({ error: "Run not found" });
  }

  let valuationGenerated = false;
  let valuationReason = details.run.status === "completed" ? "Valuation output unavailable." : "Run still in progress.";
  let valuation: unknown = null;
  let duplicates: unknown[] = [];
  let perPaintingStats: unknown[] = [];
  let sourcePlan: unknown[] = [];
  let recommendedActions: unknown[] = [];
  let persistedSourceHealth: unknown[] = [];
  let persistedPayload: Record<string, unknown> | null = null;
  let persistedInventoryPayload: ArtistMarketInventoryResultsPayload | null = null;
  let persistedSummary: RunSummary | null = null;
  if (details.run.resultsPath && fs.existsSync(details.run.resultsPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(details.run.resultsPath, "utf-8")) as Record<string, unknown> & {
        summary?: RunSummary;
        valuation?: { generated?: boolean; reason?: string };
        duplicates?: unknown[];
        per_painting_stats?: unknown[];
      };
      persistedPayload = payload;
      const inventoryParsed = artistMarketInventoryResultsPayloadSchema.safeParse(payload);
      if (inventoryParsed.success) {
        persistedInventoryPayload = inventoryParsed.data;
      }
      persistedSummary = payload.summary ?? null;
      if (payload.valuation) {
        valuationGenerated = Boolean(payload.valuation.generated);
        valuationReason = payload.valuation.reason ?? valuationReason;
        valuation = payload.valuation;
      }
      duplicates = Array.isArray(payload.duplicates) ? payload.duplicates : [];
      perPaintingStats = Array.isArray(payload.per_painting_stats) ? payload.per_painting_stats : [];
      sourcePlan = Array.isArray(payload.source_plan) ? payload.source_plan : [];
      recommendedActions = Array.isArray(payload.recommended_actions) ? payload.recommended_actions : [];
      persistedSourceHealth = Array.isArray(payload.persisted_source_health) ? payload.persisted_source_health : [];
    } catch {
      valuationReason = "Failed to parse valuation output.";
    }
  }
  const artifactManifest = details.run.resultsPath
    ? readArtifactManifest(path.join(path.dirname(details.run.resultsPath), ARTIFACT_MANIFEST_FILE))
    : null;

  const acceptedForEvidenceCount = details.records.length > 0
    ? details.records.length
    : details.attempts.filter(
    (attempt) => attempt.accepted_for_evidence ?? attempt.accepted
  ).length;
  const totalAttempts = details.attempts.length;
  const valuationEligibleCount = details.records.filter((record) => record.accepted_for_valuation).length;
  const acceptanceReasonBreakdown = Object.fromEntries(acceptanceReasonList.map((reason) => [reason, 0])) as Record<
    (typeof acceptanceReasonList)[number],
    number
  >;
  const failureClassBreakdown = Object.fromEntries(failureClassList.map((failureClass) => [failureClass, 0])) as Record<
    (typeof failureClassList)[number],
    number
  >;
  for (const attempt of details.attempts) {
    if (attempt.acceptance_reason in acceptanceReasonBreakdown) {
      acceptanceReasonBreakdown[attempt.acceptance_reason] += 1;
    }
    if (attempt.failure_class && attempt.failure_class in failureClassBreakdown) {
      failureClassBreakdown[attempt.failure_class] += 1;
    }
  }

  const attemptedSources = new Set(details.attempts.map((attempt) => attempt.source_name));
  const crawledSources = new Set(
    details.attempts.filter((attempt) => isCrawledSourceStatus(attempt.source_access_status)).map((attempt) => attempt.source_name)
  );
  const pricedSources = new Set(
    details.attempts
      .filter((attempt) => isPricedAcceptanceReason(attempt.acceptance_reason))
      .map((attempt) => attempt.source_name)
  );
  const pricedSourceCoverageRatio =
    attemptedSources.size === 0 ? 0 : Number((pricedSources.size / attemptedSources.size).toFixed(4));
  const pricedCrawledSourceCoverageRatio =
    crawledSources.size === 0 ? 0 : Number((pricedSources.size / crawledSources.size).toFixed(4));
  const liveHostHealth = storage.listHostHealth(12);

  const computedSummary: RunSummary = {
    run_id: details.run.id,
    total_records: totalAttempts,
    total_attempts: totalAttempts,
    evidence_records: acceptedForEvidenceCount,
    valuation_eligible_records: valuationEligibleCount,
    accepted_records: acceptedForEvidenceCount,
    rejected_candidates: details.attempts.filter((attempt) => !(attempt.accepted_for_evidence ?? attempt.accepted)).length,
    discovered_candidates: details.attempts.filter((attempt) => attempt.discovery_provenance && attempt.discovery_provenance !== "seed").length,
    accepted_from_discovery: details.attempts.filter(
      (attempt) => (attempt.accepted_for_evidence ?? attempt.accepted) && attempt.discovery_provenance && attempt.discovery_provenance !== "seed"
    ).length,
    priced_source_coverage_ratio: pricedSourceCoverageRatio,
    priced_crawled_source_coverage_ratio: pricedCrawledSourceCoverageRatio,
    source_candidate_breakdown: details.attempts.reduce<Record<string, number>>((acc, attempt) => {
      acc[attempt.source_name] = (acc[attempt.source_name] ?? 0) + 1;
      return acc;
    }, {}),
    source_status_breakdown: Object.fromEntries(
      sourceStatusList.map((status) => [status, details.sourceStatusBreakdown[status]])
    ) as RunSummary["source_status_breakdown"],
    auth_mode_breakdown: details.authModeBreakdown,
    failure_class_breakdown: failureClassBreakdown,
    acceptance_reason_breakdown: acceptanceReasonBreakdown,
    evaluation_metrics: buildEvaluationMetrics({
      attempts: details.attempts,
      sourcePlan: (sourcePlan as any[]) ?? [],
      acceptedRecords: acceptedForEvidenceCount,
      valuationEligibleRecords: valuationEligibleCount
    }),
    persisted_source_health: liveHostHealth,
    valuation_generated: valuationGenerated,
    valuation_reason: valuationReason
  };

  const summary: RunSummary = persistedSummary
    ? {
        ...persistedSummary,
        evaluation_metrics:
          persistedSummary.evaluation_metrics
          ?? buildEvaluationMetrics({
            attempts: details.attempts,
            sourcePlan: (sourcePlan as any[]) ?? [],
            acceptedRecords: acceptedForEvidenceCount,
            valuationEligibleRecords: valuationEligibleCount
          }),
        valuation_generated: valuationGenerated,
        valuation_reason: valuationReason
      }
    : computedSummary;

  const response = {
    run: details.run,
    summary,
    records: details.records,
    attempts: details.attempts,
    source_plan: sourcePlan,
    recommended_actions: recommendedActions,
    artifact_manifest: artifactManifest ?? undefined,
    persisted_source_health: persistedSourceHealth.length > 0 ? persistedSourceHealth : summary.persisted_source_health,
    valuation,
    duplicates,
    per_painting_stats: perPaintingStats,
    inventory_summary: persistedInventoryPayload?.inventory_summary,
    inventory: persistedInventoryPayload?.inventory,
    clusters: persistedInventoryPayload?.clusters,
    cluster_memberships: persistedInventoryPayload?.cluster_memberships,
    review_queue: persistedInventoryPayload?.review_queue,
    source_hosts: persistedInventoryPayload?.source_hosts,
    checkpoints: persistedInventoryPayload?.checkpoints,
    artifacts: persistedInventoryPayload?.artifacts
  };

  return runDetailsResponseSchema.parse(response);
});

app.post("/runs/recover-stale", async (request, reply) => {
  const parsed = recoverStaleRunsSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const maxStaleMinutes = parsed.data.maxStaleMinutes ?? 15;
  const reason = parsed.data.reason ?? `Recovered stale runs via API at ${new Date().toISOString()}.`;
  const recoveredRunIds = storage.recoverStaleRunningRuns(maxStaleMinutes * 60_000, reason);

  return {
    recovered_count: recoveredRunIds.length,
    recovered_run_ids: recoveredRunIds,
    max_stale_minutes: maxStaleMinutes
  };
});

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
