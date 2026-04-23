import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { AuthManager } from "@artbot/auth-manager";
import { buildEvaluationMetrics } from "@artbot/orchestrator";
import { buildDiscoveryConfigFromEnv, buildSourcePlanItems, planSources, SourceRegistry } from "@artbot/source-registry";
import {
  acceptanceReasonList,
  artistMarketInventoryResultsPayloadSchema,
  artistMarketInventoryRequestSchema,
  deepResearchResultSchema,
  failureClassList,
  researchArtistRequestSchema,
  researchWorkRequestSchema,
  runDetailsResponseSchema,
  type ArtistMarketInventoryResultsPayload,
  type RunSummary,
  sourceStatusList
} from "@artbot/shared-types";
import {
  ARTIFACT_MANIFEST_FILE,
  ArtbotStorage,
  artistKeyFromName,
  ensureWorkspaceRuntimeStoragePaths,
  readArtifactManifest,
  resolveWorkspaceRelativePath
} from "@artbot/storage";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveWorkspaceDefault(relativePath: string): string {
  const workspaceRoot = process.env.INIT_CWD ?? path.resolve(moduleDir, "../../..");
  return path.resolve(workspaceRoot, relativePath);
}

dotenv.config({ path: resolveWorkspaceDefault(".env"), override: false });

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST?.trim() || "0.0.0.0";
const apiKey = process.env.ARTBOT_API_KEY;
const workspaceRoot = resolveWorkspaceDefault(".");
const dbPath = resolveWorkspaceRelativePath(process.env.DATABASE_PATH, workspaceRoot, "var/data/artbot.db");
const runsRoot = resolveWorkspaceRelativePath(process.env.RUNS_ROOT, workspaceRoot, "var/runs");
const runtimePathGuard = ensureWorkspaceRuntimeStoragePaths("api", workspaceRoot, dbPath, runsRoot);

const storage = new ArtbotStorage(dbPath, runsRoot);
const sourceRegistry = new SourceRegistry();
const authManager = new AuthManager();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
app.log.info(
  {
    workspaceRoot,
    dbPath,
    runsRoot,
    manifestPath: runtimePathGuard.manifestPath,
    manifestCreated: runtimePathGuard.created
  },
  "Resolved runtime storage paths"
);

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

const adjudicateReviewItemSchema = z.object({
  decision: z.enum(["merge", "keep_separate"])
});

const normalizationEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional()
});

const storageUsageBreakdownSchema = z.object({
  runs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative()
});

const storageCleanupObservationSchema = z.object({
  reclaimed_bytes: z.number().int().nonnegative(),
  timestamp: z.string(),
  dry_run: z.boolean()
});

const storageUsageSummarySchema = z.object({
  total_runs: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  pinned: storageUsageBreakdownSchema,
  expirable: storageUsageBreakdownSchema,
  last_cleanup: storageCleanupObservationSchema.nullable(),
  observed_cleanup: storageCleanupObservationSchema.optional()
});

const storageUsageResponseSchema = z.object({
  total_var_bytes: z.number().int().nonnegative(),
  pinned_runs: z.number().int().nonnegative(),
  expirable_runs: z.number().int().nonnegative(),
  last_cleanup_reclaimed_bytes: z.number().int().nonnegative().nullable(),
  last_cleanup_completed_at: z.string().nullable(),
  usage: storageUsageSummarySchema
});

function getDirectorySizeBytes(targetPath: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      total += fs.statSync(entryPath).size;
    } catch {
      // Ignore files that disappear while summarizing usage.
    }
  }

  return total;
}

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
  const plannedSources = await planSources(query, adapters, authManager);
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
  let localAiDecisions: unknown[] = [];
  let deepResearch: unknown = undefined;
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
      localAiDecisions = Array.isArray(payload.local_ai_decisions) ? payload.local_ai_decisions : [];
    } catch {
      valuationReason = "Failed to parse valuation output.";
    }
  }
  const artifactManifest = details.run.resultsPath
    ? readArtifactManifest(path.join(path.dirname(details.run.resultsPath), ARTIFACT_MANIFEST_FILE))
    : null;
  if (details.run.resultsPath) {
    const deepResearchPath = path.join(path.dirname(details.run.resultsPath), "deep-research.json");
    if (fs.existsSync(deepResearchPath)) {
      try {
        deepResearch = deepResearchResultSchema.parse(JSON.parse(fs.readFileSync(deepResearchPath, "utf-8")));
      } catch {
        deepResearch = undefined;
      }
    }
  }

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

  const inventoryPayloadLocalAiDecisions = persistedInventoryPayload?.local_ai_decisions ?? [];
  const liveReviewQueue =
    typeof details.run.query.artist === "string"
      ? storage.listReviewItemsByArtist(artistKeyFromName(details.run.query.artist))
      : [];

  const response = {
    run: details.run,
    summary,
    records: details.records,
    attempts: details.attempts,
    deepResearch,
    source_plan: sourcePlan,
    recommended_actions: recommendedActions,
    artifact_manifest: artifactManifest ?? undefined,
    persisted_source_health: persistedSourceHealth.length > 0 ? persistedSourceHealth : summary.persisted_source_health,
    local_ai_decisions: localAiDecisions.length > 0 ? localAiDecisions : inventoryPayloadLocalAiDecisions,
    normalization_events: storage.listNormalizationEvents(id, 100),
    fx_cache_stats: storage.getFxCacheStats(),
    valuation,
    duplicates,
    per_painting_stats: perPaintingStats,
    inventory_summary: persistedInventoryPayload?.inventory_summary,
    inventory: persistedInventoryPayload?.inventory,
    clusters: persistedInventoryPayload?.clusters,
    cluster_memberships: persistedInventoryPayload?.cluster_memberships,
    review_queue: liveReviewQueue.length > 0 ? liveReviewQueue : persistedInventoryPayload?.review_queue,
    source_hosts: persistedInventoryPayload?.source_hosts,
    checkpoints: persistedInventoryPayload?.checkpoints,
    artifacts: persistedInventoryPayload?.artifacts
  };

  return runDetailsResponseSchema.parse(response);
});

app.get("/runs/:id/normalization-events", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const parsed = normalizationEventsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const run = storage.getRun(id);
  if (!run) {
    return reply.status(404).send({ error: "Run not found" });
  }

  return {
    run_id: id,
    events: storage.listNormalizationEvents(id, parsed.data.limit ?? 100)
  };
});

app.get("/fx/cache", async () => {
  return {
    stats: storage.getFxCacheStats()
  };
});

app.post("/runs/:id/pin", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const run = storage.pinRun(id);
  if (!run) {
    return reply.status(404).send({ error: "Run not found" });
  }
  return run;
});

app.post("/runs/:id/unpin", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const run = storage.unpinRun(id);
  if (!run) {
    return reply.status(404).send({ error: "Run not found" });
  }
  return run;
});

app.get("/storage/usage", async () => {
  const usage = storageUsageSummarySchema.parse(
    (
      storage as ArtbotStorage & {
        getStorageUsageSummary: () => unknown;
      }
    ).getStorageUsageSummary()
  );
  const varRoot = path.resolve(runsRoot, "..");
  return storageUsageResponseSchema.parse({
    total_var_bytes: getDirectorySizeBytes(varRoot),
    pinned_runs: usage.pinned.runs,
    expirable_runs: usage.expirable.runs,
    last_cleanup_reclaimed_bytes: usage.last_cleanup?.reclaimed_bytes ?? null,
    last_cleanup_completed_at: usage.last_cleanup?.timestamp ?? null,
    usage
  });
});

app.post("/runs/:id/review-queue/:reviewId/adjudicate", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const reviewId = (request.params as { reviewId: string }).reviewId;
  const parsed = adjudicateReviewItemSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten() });
  }

  const details = storage.getRunDetails(id);
  if (!details) {
    return reply.status(404).send({ error: "Run not found" });
  }
  if (typeof details.run.query.artist !== "string") {
    return reply.status(400).send({ error: "Run query missing artist identity." });
  }

  const artistKey = artistKeyFromName(details.run.query.artist);
  const updated = storage.adjudicateReviewItem(artistKey, reviewId, parsed.data.decision);
  if (!updated) {
    return reply.status(404).send({ error: "Review item not found" });
  }

  return {
    run_id: id,
    review_item: updated
  };
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
