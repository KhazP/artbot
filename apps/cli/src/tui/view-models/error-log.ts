import type { PipelineDetails } from "../state.js";

export interface ErrorLogEntry {
  sourceUrl: string;
  detail: string;
}

export function buildErrorLogModel(details: PipelineDetails | null): ErrorLogEntry[] {
  return (details?.attempts ?? [])
    .filter((attempt) => attempt.failure_class || attempt.blocker_reason)
    .slice(0, 8)
    .map((attempt) => ({
      sourceUrl: attempt.source_url,
      detail: attempt.failure_class ?? attempt.blocker_reason ?? "unknown"
    }));
}
