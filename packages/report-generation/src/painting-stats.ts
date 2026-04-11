import type { PriceRecord } from "@artbot/shared-types";

export interface PerPaintingStat {
  clusterId: string;
  title: string;
  year: string | null;
  dimensionsBucket: string | null;
  recordsCount: number;
  uniqueSources: number;
  firstYear: number | null;
  lastYear: number | null;
  minUsdNominal: number | null;
  avgUsdNominal: number | null;
  maxUsdNominal: number | null;
  minUsd2026: number | null;
  avgUsd2026: number | null;
  maxUsd2026: number | null;
  laneBreakdown: Record<string, number>;
}

interface ClusterAccumulator {
  clusterId: string;
  title: string;
  year: string | null;
  dimensionsBucket: string | null;
  signatures: Set<string>;
  sources: Set<string>;
  years: number[];
  nominalUsd: number[];
  adjustedUsd: number[];
  laneBreakdown: Record<string, number>;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(record: PriceRecord): number | null {
  const fromYear = record.year?.match(/\b(18|19|20)\d{2}\b/)?.[0];
  if (fromYear) return Number(fromYear);
  const fromDate = record.sale_or_listing_date?.match(/\b(18|19|20)\d{2}\b/)?.[0];
  if (fromDate) return Number(fromDate);
  return null;
}

function toNumber(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dimensionsBucket(record: PriceRecord): string | null {
  const h = record.height_cm;
  const w = record.width_cm;
  if (h && w) {
    const hBucket = Math.round(h / 5) * 5;
    const wBucket = Math.round(w / 5) * 5;
    return `${hBucket}x${wBucket}`;
  }

  if (record.dimensions_text) {
    const match = record.dimensions_text.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (match) {
      const p1 = toNumber(match[1]);
      const p2 = toNumber(match[2]);
      if (p1 && p2) {
        const hBucket = Math.round(p1 / 5) * 5;
        const wBucket = Math.round(p2 / 5) * 5;
        return `${hBucket}x${wBucket}`;
      }
    }
  }

  return null;
}

function clusterKey(record: PriceRecord): string {
  const title = normalizeTitle(record.work_title);
  const year = parseYear(record);
  const dims = dimensionsBucket(record);
  return `${title || "untitled"}|${year ?? "unknown"}|${dims ?? "unknown"}`;
}

function signature(record: PriceRecord): string {
  return [
    record.source_name,
    record.source_url,
    record.lot_number ?? "",
    record.sale_or_listing_date ?? "",
    record.price_amount ?? "",
    record.currency ?? ""
  ].join("|");
}

function numericStats(values: number[]): { min: number | null; avg: number | null; max: number | null } {
  if (values.length === 0) {
    return { min: null, avg: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    min: sorted[0],
    avg,
    max: sorted[sorted.length - 1]
  };
}

export function buildPerPaintingStats(records: PriceRecord[]): PerPaintingStat[] {
  const byCluster = new Map<string, ClusterAccumulator>();

  for (const record of records) {
    const key = clusterKey(record);
    const existing = byCluster.get(key) ?? {
      clusterId: key,
      title: record.work_title ?? "Untitled",
      year: record.year ?? null,
      dimensionsBucket: dimensionsBucket(record),
      signatures: new Set<string>(),
      sources: new Set<string>(),
      years: [],
      nominalUsd: [],
      adjustedUsd: [],
      laneBreakdown: {}
    };

    const sig = signature(record);
    if (existing.signatures.has(sig)) {
      continue;
    }
    existing.signatures.add(sig);
    existing.sources.add(record.source_name);

    const recordYear = parseYear(record);
    if (recordYear) {
      existing.years.push(recordYear);
    }

    const nominalUsd = record.normalized_price_usd_nominal ?? record.normalized_price_usd;
    if (typeof nominalUsd === "number" && Number.isFinite(nominalUsd) && nominalUsd >= 0) {
      existing.nominalUsd.push(nominalUsd);
    }

    const adjustedUsd = record.normalized_price_usd_2026;
    if (typeof adjustedUsd === "number" && Number.isFinite(adjustedUsd) && adjustedUsd >= 0) {
      existing.adjustedUsd.push(adjustedUsd);
    }

    existing.laneBreakdown[record.valuation_lane] = (existing.laneBreakdown[record.valuation_lane] ?? 0) + 1;
    byCluster.set(key, existing);
  }

  const stats = [...byCluster.values()].map((cluster) => {
    const nominal = numericStats(cluster.nominalUsd);
    const adjusted = numericStats(cluster.adjustedUsd);
    const yearMin = cluster.years.length > 0 ? Math.min(...cluster.years) : null;
    const yearMax = cluster.years.length > 0 ? Math.max(...cluster.years) : null;
    return {
      clusterId: cluster.clusterId,
      title: cluster.title,
      year: cluster.year,
      dimensionsBucket: cluster.dimensionsBucket,
      recordsCount: cluster.signatures.size,
      uniqueSources: cluster.sources.size,
      firstYear: yearMin,
      lastYear: yearMax,
      minUsdNominal: nominal.min,
      avgUsdNominal: nominal.avg,
      maxUsdNominal: nominal.max,
      minUsd2026: adjusted.min,
      avgUsd2026: adjusted.avg,
      maxUsd2026: adjusted.max,
      laneBreakdown: cluster.laneBreakdown
    } satisfies PerPaintingStat;
  });

  return stats.sort((a, b) => {
    if (b.recordsCount !== a.recordsCount) return b.recordsCount - a.recordsCount;
    return a.title.localeCompare(b.title);
  });
}
