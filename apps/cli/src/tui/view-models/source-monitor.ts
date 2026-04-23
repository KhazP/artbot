import type { PipelineDetails } from "../state.js";

export interface SourceMonitorEntry {
  sourceName: string;
  attempts: number;
  priced: number;
  blocked: number;
  authRequired: number;
}

export function buildSourceMonitorModel(details: PipelineDetails | null): SourceMonitorEntry[] {
  const attempts = details?.attempts ?? [];
  const buckets = new Map<string, SourceMonitorEntry>();

  for (const attempt of attempts) {
    const current = buckets.get(attempt.source_name ?? "unknown") ?? {
      sourceName: attempt.source_name ?? "unknown",
      attempts: 0,
      priced: 0,
      blocked: 0,
      authRequired: 0
    };
    current.attempts += 1;
    if (
      typeof attempt.acceptance_reason === "string" &&
      ["valuation_ready", "estimate_range_ready", "asking_price_ready"].includes(attempt.acceptance_reason)
    ) {
      current.priced += 1;
    }
    if (attempt.source_access_status === "blocked") {
      current.blocked += 1;
    }
    if (attempt.source_access_status === "auth_required") {
      current.authRequired += 1;
    }
    buckets.set(current.sourceName, current);
  }

  return [...buckets.values()].sort((a, b) => b.attempts - a.attempts).slice(0, 8);
}
