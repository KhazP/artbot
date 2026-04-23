import type { PipelineDetails } from "../state.js";

export interface FxCacheModel {
  totalRows: number;
  uniqueDates: number;
  latestDate: string | null;
  sourceLines: string[];
}

export function buildFxCacheModel(details: PipelineDetails | null, fallback?: PipelineDetails["fx_cache_stats"]): FxCacheModel {
  const stats = details?.fx_cache_stats ?? fallback;
  return {
    totalRows: stats?.total_rows ?? 0,
    uniqueDates: stats?.unique_dates ?? 0,
    latestDate: stats?.latest_date ?? null,
    sourceLines: Object.entries(stats?.sources ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `${source}: ${count}`)
      .slice(0, 4)
  };
}
