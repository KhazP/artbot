import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  researchArtistRequestSchema,
  researchWorkRequestSchema,
  type RunSummary,
  sourceStatusList
} from "@artbot/shared-types";
import { ArtbotStorage } from "@artbot/storage";
import { z } from "zod";

const port = Number(process.env.PORT ?? 4000);
const apiKey = process.env.ARTBOT_API_KEY;
const dbPath = process.env.DATABASE_PATH ?? "./data/artbot.db";
const runsRoot = process.env.RUNS_ROOT ?? "./runs";

const storage = new ArtbotStorage(dbPath, runsRoot);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const runsQuerySchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
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

  const summary: RunSummary = {
    run_id: details.run.id,
    total_records: details.attempts.length,
    accepted_records: details.records.length,
    rejected_candidates: details.attempts.filter((attempt) => !attempt.accepted).length,
    discovered_candidates: details.attempts.filter((attempt) => attempt.discovery_provenance && attempt.discovery_provenance !== "seed").length,
    accepted_from_discovery: details.attempts.filter(
      (attempt) => attempt.accepted && attempt.discovery_provenance && attempt.discovery_provenance !== "seed"
    ).length,
    source_candidate_breakdown: details.attempts.reduce<Record<string, number>>((acc, attempt) => {
      acc[attempt.source_name] = (acc[attempt.source_name] ?? 0) + 1;
      return acc;
    }, {}),
    source_status_breakdown: Object.fromEntries(
      sourceStatusList.map((status) => [status, details.sourceStatusBreakdown[status]])
    ) as RunSummary["source_status_breakdown"],
    auth_mode_breakdown: details.authModeBreakdown,
    valuation_generated: false,
    valuation_reason: details.run.status === "completed" ? "Refer to report output." : "Run still in progress."
  };

  return {
    run: details.run,
    summary,
    records: details.records,
    attempts: details.attempts
  };
});

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
