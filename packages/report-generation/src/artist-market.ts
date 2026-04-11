import type {
  ArtistMarketInventorySummary,
  ArtworkCluster,
  ClusterMembership,
  InventoryRecord,
  ReviewItem
} from "@artbot/shared-types";

function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function inventoryLine(record: InventoryRecord): string {
  const item = record.payload;
  return `| ${item.work_title ?? "-"} | ${item.source_name} | ${item.price_type} | ${fmtNumber(item.price_amount)} ${item.currency ?? ""} | ${fmtNumber(item.estimate_low)} | ${fmtNumber(item.estimate_high)} | ${item.sale_or_listing_date ?? "-"} | ${item.image_url ?? "-"} | ${item.source_url} |`;
}

function priceStat(summary: ArtistMarketInventorySummary, lane: "realized" | "asking" | "estimate") {
  return summary.price_stats[lane] ?? { count: 0, min: null, avg: null, max: null };
}

export function renderArtistMarketInventoryReport(args: {
  artist: string;
  summary: ArtistMarketInventorySummary;
  inventory: InventoryRecord[];
  clusters: ArtworkCluster[];
  memberships: ClusterMembership[];
  reviewItems: ReviewItem[];
}): string {
  const { artist, summary, inventory, clusters, memberships, reviewItems } = args;
  const topClusters = [...clusters].sort((a, b) => b.record_count - a.record_count).slice(0, 12);
  const realized = priceStat(summary, "realized");
  const asking = priceStat(summary, "asking");
  const estimate = priceStat(summary, "estimate");

  return [
    `# ${artist} Market Inventory`,
    "",
    "## Summary",
    `- Crawl mode: ${summary.crawl_mode}`,
    `- Inventory records: ${summary.total_inventory_records}`,
    `- New records added: ${summary.new_records_added}`,
    `- Stored images: ${summary.total_images}`,
    `- Discovered hosts: ${summary.discovered_hosts}`,
    `- Clusters: ${summary.total_clusters}`,
    `- Auto-confirmed clusters: ${summary.auto_confirmed_clusters}`,
    `- Review queue items: ${summary.review_queue_count}`,
    "",
    "## Price Stats",
    `- Realized: count=${realized.count}, min=${fmtNumber(realized.min)}, avg=${fmtNumber(realized.avg)}, max=${fmtNumber(realized.max)}`,
    `- Asking: count=${asking.count}, min=${fmtNumber(asking.min)}, avg=${fmtNumber(asking.avg)}, max=${fmtNumber(asking.max)}`,
    `- Estimate: count=${estimate.count}, min=${fmtNumber(estimate.min)}, avg=${fmtNumber(estimate.avg)}, max=${fmtNumber(estimate.max)}`,
    "",
    "## Top Clusters",
    ...(topClusters.length > 0
      ? topClusters.map(
          (cluster) =>
            `- ${cluster.title} | status=${cluster.cluster_status} | confidence=${cluster.confidence.toFixed(2)} | records=${cluster.record_count} | auto_matches=${cluster.auto_match_count}`
        )
      : ["- No clusters generated."]),
    "",
    "## Review Queue",
    ...(reviewItems.length > 0
      ? reviewItems.map(
          (item) =>
            `- ${item.left_record_key} <> ${item.right_record_key} | recommendation=${item.recommended_action} | confidence=${item.confidence.toFixed(2)} | reasons=${item.reasons.join("; ")}`
        )
      : ["- No pending review items."]),
    "",
    "## Inventory Records",
    "| Work | Source | Price Type | Price | Estimate Low | Estimate High | Date | Image | URL |",
    "|---|---|---|---|---|---|---|---|---|",
    ...inventory.map(inventoryLine),
    "",
    "## Cluster Memberships",
    ...(memberships.length > 0
      ? memberships.map(
          (membership) =>
            `- cluster=${membership.cluster_id} | record=${membership.record_key} | status=${membership.status} | confidence=${membership.confidence.toFixed(2)} | reasons=${membership.reasons.join("; ")}`
        )
      : ["- No cluster memberships recorded."]),
    "",
    "## Crawl Gaps",
    ...(summary.crawl_gaps.length > 0 ? summary.crawl_gaps.map((gap) => `- ${gap}`) : ["- None reported."])
  ].join("\n");
}

export function renderInventoryCsv(inventory: InventoryRecord[]): string {
  const header = [
    "record_key",
    "cluster_id",
    "artist_name",
    "work_title",
    "source_name",
    "price_type",
    "price_amount",
    "currency",
    "estimate_low",
    "estimate_high",
    "sale_or_listing_date",
    "image_url",
    "source_url"
  ];

  const rows = inventory.map((record) => [
    record.record_key,
    record.cluster_id,
    record.payload.artist_name,
    record.payload.work_title,
    record.payload.source_name,
    record.payload.price_type,
    record.payload.price_amount,
    record.payload.currency,
    record.payload.estimate_low,
    record.payload.estimate_high,
    record.payload.sale_or_listing_date,
    record.payload.image_url,
    record.payload.source_url
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function renderClustersCsv(clusters: ArtworkCluster[]): string {
  const header = ["cluster_id", "title", "year", "medium", "status", "confidence", "record_count", "auto_match_count"];
  const rows = clusters.map((cluster) => [
    cluster.id,
    cluster.title,
    cluster.year,
    cluster.medium,
    cluster.cluster_status,
    cluster.confidence,
    cluster.record_count,
    cluster.auto_match_count
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function renderReviewQueueCsv(reviewItems: ReviewItem[]): string {
  const header = [
    "review_id",
    "left_record_key",
    "right_record_key",
    "recommended_action",
    "confidence",
    "status",
    "reasons"
  ];
  const rows = reviewItems.map((item) => [
    item.id,
    item.left_record_key,
    item.right_record_key,
    item.recommended_action,
    item.confidence,
    item.status,
    item.reasons.join(" | ")
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
