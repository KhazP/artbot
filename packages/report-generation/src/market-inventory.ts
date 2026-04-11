import fs from "node:fs";
import path from "node:path";
import type { InventoryRecord, ReviewItem, RunSummary } from "@artbot/shared-types";

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function quoteCsv(value: unknown): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function stats(values: number[]): { min: number | null; avg: number | null; max: number | null } {
  if (values.length === 0) {
    return { min: null, avg: null, max: null };
  }

  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    avg: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted[sorted.length - 1]
  };
}

function recordStats(records: InventoryRecord[], semanticLane: InventoryRecord["semantic_lane"]) {
  const filtered = records.filter((record) => record.semantic_lane === semanticLane);
  const native = filtered.map((record) => record.payload.price_amount).filter((value): value is number => typeof value === "number");
  return {
    count: filtered.length,
    ...stats(native)
  };
}

export function renderArtistMarketInventoryMarkdownReport(
  records: InventoryRecord[],
  clusters: Array<{ id: string; title: string; cluster_status: string; confidence: number; records: InventoryRecord[] }>,
  reviewItems: ReviewItem[],
  summary: RunSummary
): string {
  const realized = recordStats(records, "realized");
  const estimate = recordStats(records, "estimate");
  const asking = recordStats(records, "asking");

  return [
    "# Artist Market Inventory Report",
    "",
    "## Summary",
    `- Run ID: ${summary.run_id}`,
    `- Inventory records: ${records.length}`,
    `- Clusters: ${summary.cluster_count ?? clusters.length}`,
    `- Review items: ${summary.review_item_count ?? reviewItems.length}`,
    `- Sources: ${Object.keys(summary.source_candidate_breakdown).length}`,
    "",
    "## Price-Type Stats",
    `- Realized: count=${realized.count}, min=${fmt(realized.min)}, avg=${fmt(realized.avg)}, max=${fmt(realized.max)}`,
    `- Estimate: count=${estimate.count}, min=${fmt(estimate.min)}, avg=${fmt(estimate.avg)}, max=${fmt(estimate.max)}`,
    `- Asking: count=${asking.count}, min=${fmt(asking.min)}, avg=${fmt(asking.avg)}, max=${fmt(asking.max)}`,
    "",
    "## Source Breakdown",
    ...Object.entries(summary.source_candidate_breakdown)
      .sort((left, right) => right[1] - left[1])
      .map(([sourceName, count]) => `- ${sourceName}: ${count}`),
    "",
    "## Exact-Painting Clusters",
    ...clusters.flatMap((cluster) => [
      `### ${cluster.title}`,
      `- Cluster ID: ${cluster.id}`,
      `- Status: ${cluster.cluster_status}`,
      `- Confidence: ${cluster.confidence.toFixed(2)}`,
      `- Records: ${cluster.records.length}`,
      "",
      "| Source | Price Type | Native Price | Date | URL |",
      "|---|---|---|---|---|",
      ...cluster.records.map(
        (record) =>
          `| ${record.payload.source_name} | ${record.payload.price_type} | ${fmt(record.payload.price_amount)} ${record.payload.currency ?? ""} | ${record.payload.sale_or_listing_date ?? "-"} | ${record.payload.source_url} |`
      ),
      ""
    ]),
    "## Review Queue",
    ...(reviewItems.length > 0
      ? reviewItems.map(
          (item) =>
            `- ${item.left_record_key} <> ${item.right_record_key} | action=${item.recommended_action} | confidence=${item.confidence.toFixed(2)} | reasons=${item.reasons.join(", ")}`
        )
      : ["- No review items."])
  ].join("\n");
}

export function renderArtistMarketInventoryCsv(
  payload: InventoryRecord[] | Array<{ id: string; title: string; cluster_status: string; confidence: number; records: InventoryRecord[] }>,
  mode: "records" | "clusters"
): string {
  if (mode === "records") {
    const rows = payload as InventoryRecord[];
    return [
      [
        "record_key",
        "cluster_id",
        "artist",
        "title",
        "source_name",
        "price_type",
        "semantic_lane",
        "price_amount",
        "currency",
        "date",
        "image_url",
        "source_url"
      ].join(","),
      ...rows.map((record) =>
        [
          record.record_key,
          record.cluster_id ?? "",
          record.payload.artist_name,
          record.payload.work_title ?? "",
          record.payload.source_name,
          record.payload.price_type,
          record.semantic_lane,
          record.payload.price_amount ?? "",
          record.payload.currency ?? "",
          record.payload.sale_or_listing_date ?? "",
          record.payload.image_url ?? "",
          record.payload.source_url
        ]
          .map(quoteCsv)
          .join(",")
      )
    ].join("\n");
  }

  const clusters = payload as Array<{ id: string; title: string; cluster_status: string; confidence: number; records: InventoryRecord[] }>;
  return [
    ["cluster_id", "title", "status", "confidence", "record_count", "realized_count", "estimate_count", "asking_count"].join(","),
    ...clusters.map((cluster) => {
      const realizedCount = cluster.records.filter((record) => record.semantic_lane === "realized").length;
      const estimateCount = cluster.records.filter((record) => record.semantic_lane === "estimate").length;
      const askingCount = cluster.records.filter((record) => record.semantic_lane === "asking").length;
      return [
        cluster.id,
        cluster.title,
        cluster.cluster_status,
        cluster.confidence.toFixed(3),
        cluster.records.length,
        realizedCount,
        estimateCount,
        askingCount
      ]
        .map(quoteCsv)
        .join(",");
    })
  ].join("\n");
}

export function writeCsvFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf-8");
}
