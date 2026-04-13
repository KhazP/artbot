import picocolors from "picocolors";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReportRecord {
  artist_name: string;
  work_title?: string;
  source_name: string;
  price_type: string;
  price_amount?: number | null;
  currency?: string;
  estimate_low?: number | null;
  estimate_high?: number | null;
  normalized_price_try?: number | null;
  normalized_price_usd?: number | null;
  normalized_price_usd_nominal?: number | null;
  normalized_price_usd_2026?: number | null;
  fx_source?: string | null;
  fx_date_used?: string | null;
  inflation_source?: string | null;
  inflation_base_year?: number | null;
  venue_name?: string;
  venue_type?: string;
  country?: string;
  city?: string;
  sale_or_listing_date?: string | null;
  price_hidden?: boolean;
  source_access_status?: string;
  medium?: string | null;
  dimensions_text?: string | null;
  year?: string | null;
  overall_confidence?: number;
  valuation_lane?: string;
  acceptance_reason?: string;
}

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

export interface ReportValuation {
  generated: boolean;
  reason?: string;
  turkeyRange?: { low: number; high: number } | null;
  internationalRange?: { low: number; high: number } | null;
  blendedRange?: { low: number; high: number } | null;
  laneRanges?: {
    realized?: { low: number; high: number } | null;
    estimate?: { low: number; high: number } | null;
    asking?: { low: number; high: number } | null;
  };
  topComparables?: Array<{
    sourceName: string;
    workTitle: string;
    nativePrice?: number | null;
    normalizedPriceTry?: number | null;
    currency: string;
    valuationLane: string;
    score?: number;
  }>;
  valuationCandidateCount?: number;
}

export interface ReportSummary {
  accepted_records: number;
  valuation_generated: boolean;
  total_records?: number;
  total_attempts?: number;
  evidence_records?: number;
  valuation_eligible_records?: number;
  rejected_candidates?: number;
  discovered_candidates?: number;
  accepted_from_discovery?: number;
  priced_source_coverage_ratio?: number;
  priced_crawled_source_coverage_ratio?: number;
  source_candidate_breakdown?: Record<string, number>;
  source_status_breakdown?: Record<string, number>;
  acceptance_reason_breakdown?: Record<string, number>;
  valuation_reason?: string;
  evaluation_metrics?: {
    accepted_record_precision: number;
    priced_source_recall: number;
    source_completeness_ratio: number;
    valuation_readiness_ratio: number;
    manual_override_rate: number;
    coverage_target: number;
    coverage_target_met: boolean;
  };
}

export interface ReportData {
  artistName: string;
  runId: string;
  summary?: ReportSummary;
  records?: ReportRecord[];
  duplicates?: ReportRecord[];
  valuation?: ReportValuation;
  perPaintingStats?: PerPaintingStat[];
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

function fmtUsd(amount: number): string {
  return fmtCurrency(amount, "USD");
}

function priceTypeIcon(priceType: string): string {
  switch (priceType) {
    case "hammer_price": return "🔨";
    case "asking_price": return "💰";
    case "estimate": return "📊";
    case "inquiry_only": return "🔒";
    default: return "●";
  }
}

function priceTypeLabel(priceType: string): string {
  switch (priceType) {
    case "hammer_price": return "Hammer (Sold)";
    case "asking_price": return "Asking";
    case "estimate": return "Estimate";
    case "inquiry_only": return "Inquiry Only";
    default: return priceType.replace(/_/g, " ");
  }
}

const B = "─";
const DIM = picocolors.dim;
const BOLD = picocolors.bold;
const CYAN = picocolors.cyan;
const YELLOW = picocolors.yellow;
const GREEN = picocolors.green;
const MAG = picocolors.magenta;
const RED = picocolors.red;

function isRenderableAmount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pad(str: string, len: number): string {
  // Strip ANSI to compute visible length
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = len - visible.length;
  return diff > 0 ? str + " ".repeat(diff) : str;
}

function rpad(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = len - visible.length;
  return diff > 0 ? " ".repeat(diff) + str : str;
}

function hr(width = 72): string {
  return DIM(B.repeat(width));
}

function sectionHeader(title: string, icon: string): string {
  return `\n  ${icon}  ${BOLD(title)}\n  ${hr(68)}\n`;
}

/**
 * Gets a numeric price value from a record, returning the best available.
 * Priority: price_amount > estimate midpoint > normalized_price_try
 */
function getNumericPrice(r: ReportRecord): { amount: number; currency: string; source: string } | null {
  if (isRenderableAmount(r.normalized_price_usd_nominal)) {
    return { amount: r.normalized_price_usd_nominal, currency: "USD", source: "usd_nominal" };
  }
  if (isRenderableAmount(r.normalized_price_usd)) {
    return { amount: r.normalized_price_usd, currency: "USD", source: "usd_legacy" };
  }
  if (isRenderableAmount(r.price_amount)) {
    return { amount: r.price_amount, currency: r.currency ?? "TRY", source: "native" };
  }
  if (isRenderableAmount(r.estimate_low) && isRenderableAmount(r.estimate_high)) {
    const mid = (r.estimate_low + r.estimate_high) / 2;
    return { amount: mid, currency: r.currency ?? "TRY", source: "estimate_mid" };
  }
  if (isRenderableAmount(r.normalized_price_try)) {
    return { amount: r.normalized_price_try, currency: "TRY", source: "normalized" };
  }
  return null;
}

// ── Report sections ──────────────────────────────────────────────────────────

function renderReportHeader(data: ReportData): string {
  const title = `MARKET RESEARCH REPORT — ${data.artistName}`;
  const border = "═".repeat(title.length + 4);
  return [
    "",
    `  ${DIM("╔" + border + "╗")}`,
    `  ${DIM("║")}  ${BOLD(CYAN(title))}  ${DIM("║")}`,
    `  ${DIM("╚" + border + "╝")}`,
    "",
  ].join("\n");
}

function renderMarketOverview(data: ReportData): string {
  const s = data.summary;
  if (!s) return "";

  const allRecords = data.records ?? [];
  const uniqueSources = new Set(allRecords.map(r => r.source_name));

  const sourceBreakdown = s.source_candidate_breakdown ?? {};
  const platformCount = Object.keys(sourceBreakdown).length;
  const statusBreakdown = s.source_status_breakdown ?? {};

  const lines: string[] = [sectionHeader("MARKET OVERVIEW", "📊")];

  // Key stats in a grid
  const stats: Array<[string, string]> = [
    ["Platforms Searched", CYAN(String(platformCount))],
    ["URLs Crawled", CYAN(String(s.total_attempts ?? s.total_records ?? 0))],
    ["Records Accepted", BOLD(GREEN(String(s.accepted_records)))],
    ["Total Records", String(s.total_records ?? 0)],
    ["Evidence Records", String(s.evidence_records ?? 0)],
    ["Valuation Eligible", String(s.valuation_eligible_records ?? 0)],
    [
      "Priced Evidence Coverage",
      (() => {
        const ratio = s.evaluation_metrics?.valuation_readiness_ratio
          ?? s.priced_crawled_source_coverage_ratio
          ?? s.priced_source_coverage_ratio;
        if (ratio == null) return "n/a";
        const pct = Math.round(ratio * 100);
        const formatted = `${pct}%`;
        return pct >= 70 ? GREEN(formatted) : YELLOW(formatted);
      })()
    ],
  ];

  if (s.priced_crawled_source_coverage_ratio != null) {
    stats.push(["Priced Source Coverage (Crawled)", `${Math.round(s.priced_crawled_source_coverage_ratio * 100)}%`]);
  }

  if (s.priced_crawled_source_coverage_ratio != null && s.priced_source_coverage_ratio != null) {
    stats.push(["Priced Source Coverage (Attempted)", `${Math.round(s.priced_source_coverage_ratio * 100)}%`]);
  }

  if (s.discovered_candidates) {
    stats.push(["Discovered via Crawl", CYAN(String(s.discovered_candidates))]);
    if (s.accepted_from_discovery) {
      stats.push(["Accepted from Discovery", GREEN(String(s.accepted_from_discovery))]);
    }
  }

  for (const [label, value] of stats) {
    lines.push(`  ${pad(DIM(label + ":"), 28)} ${value}`);
  }

  // Access status summary
  if (Object.keys(statusBreakdown).length > 0) {
    lines.push("");
    lines.push(`  ${DIM("Access Status:")}`);
    const statusIcons: Record<string, string> = {
      public_access: "🟢",
      auth_required: "🔑",
      licensed_access: "📄",
      blocked: "🔴",
      price_hidden: "🔒",
    };
    for (const [status, count] of Object.entries(statusBreakdown)) {
      if (count === 0) continue;
      const icon = statusIcons[status] ?? "●";
      const label = status.replace(/_/g, " ");
      const bar = "█".repeat(Math.min(Math.ceil((count / (s.total_attempts ?? s.total_records ?? 1)) * 30), 30));
      lines.push(`    ${icon} ${pad(label, 18)} ${rpad(String(count), 4)}  ${DIM(bar)}`);
    }
  }

  return lines.join("\n");
}

function renderSourceCoverage(data: ReportData): string {
  const s = data.summary;
  if (!s?.source_candidate_breakdown) return "";

  const lines: string[] = [sectionHeader("SOURCE COVERAGE", "🌐")];

  const allRecords = data.records ?? [];
  const breakdown = s.source_candidate_breakdown;

  // Group by source — compute stats per source
  const sourceMap = new Map<string, { attempted: number; accepted: number; withPrice: number; priceTypes: Set<string> }>();

  for (const [sourceName, count] of Object.entries(breakdown)) {
    const existing = sourceMap.get(sourceName) ?? { attempted: 0, accepted: 0, withPrice: 0, priceTypes: new Set() };
    existing.attempted = count;
    sourceMap.set(sourceName, existing);
  }

  for (const r of allRecords) {
    const entry = sourceMap.get(r.source_name) ?? { attempted: 0, accepted: 0, withPrice: 0, priceTypes: new Set() };
    entry.accepted += 1;
    if (getNumericPrice(r)) entry.withPrice += 1;
    entry.priceTypes.add(r.price_type);
    sourceMap.set(r.source_name, entry);
  }

  // Sort by attempted count descending
  const sorted = [...sourceMap.entries()].sort((a, b) => b[1].attempted - a[1].attempted);

  lines.push(`  ${pad(DIM("Source"), 30)} ${rpad(DIM("URLs"), 5)} ${rpad(DIM("Found"), 6)} ${rpad(DIM("Priced"), 7)} ${DIM("Types")}`);
  lines.push(`  ${DIM("─".repeat(30))} ${DIM("─".repeat(5))} ${DIM("─".repeat(6))} ${DIM("─".repeat(7))} ${DIM("─".repeat(18))}`);

  for (const [name, info] of sorted) {
    const statusIcon = info.accepted > 0
      ? (info.withPrice > 0 ? GREEN("✔") : YELLOW("◐"))
      : RED("✘");
    const types = [...info.priceTypes].map(t => priceTypeIcon(t)).join(" ");
    lines.push(
      `  ${statusIcon} ${pad(name, 28)} ${rpad(String(info.attempted), 5)} ${rpad(info.accepted > 0 ? GREEN(String(info.accepted)) : DIM("0"), 6)} ${rpad(info.withPrice > 0 ? YELLOW(String(info.withPrice)) : DIM("0"), 7)} ${types || DIM("—")}`,
    );
  }

  return lines.join("\n");
}

function renderPriceStatistics(data: ReportData): string {
  const allRecords = data.records ?? [];
  if (allRecords.length === 0) return "";

  const lines: string[] = [sectionHeader("PRICE ANALYSIS", "💰")];

  const nominalUsdValues: number[] = [];
  const adjustedUsdValues: number[] = [];

  // Collect numeric prices, preferring USD normalization
  const pricedRecords: Array<{ r: ReportRecord; price: number; currency: string }> = [];
  for (const r of allRecords) {
    const p = getNumericPrice(r);
    if (p) pricedRecords.push({ r, price: p.amount, currency: p.currency });
    const nominal = r.normalized_price_usd_nominal ?? r.normalized_price_usd;
    if (isRenderableAmount(nominal)) nominalUsdValues.push(nominal);
    if (isRenderableAmount(r.normalized_price_usd_2026)) {
      adjustedUsdValues.push(r.normalized_price_usd_2026);
    }
  }

  // Group by price type
  const byType = new Map<string, Array<{ r: ReportRecord; price: number }>>();
  for (const r of allRecords) {
    const list = byType.get(r.price_type) ?? [];
    list.push({ r, price: getNumericPrice(r)?.amount ?? 0 });
    byType.set(r.price_type, list);
  }

  // Price type breakdown
  lines.push(`  ${DIM("By Price Type:")}`);
  for (const [type, entries] of byType) {
    const priced = entries.filter((entry) => getNumericPrice(entry.r) !== null);
    const icon = priceTypeIcon(type);
    const label = priceTypeLabel(type);
    let rangeStr = "";
    if (priced.length > 0) {
      const amounts = priced.map(e => e.price).sort((a, b) => a - b);
      const ccy = "USD";
      const min = fmtCurrency(amounts[0], ccy);
      const max = fmtCurrency(amounts[amounts.length - 1], ccy);
      rangeStr = amounts.length === 1
        ? `  ${YELLOW(min)}`
        : `  ${YELLOW(min)} – ${YELLOW(max)}`;
    }
    lines.push(`    ${icon} ${pad(label, 20)} ${pad(CYAN(String(entries.length)), 4)} records${priced.length > 0 ? ` (${priced.length} priced)` : ""}${rangeStr}`);
  }

  // Overall statistics (only if we have priced records)
  if (pricedRecords.length > 0) {
    lines.push("");
    const amounts = nominalUsdValues.length > 0
      ? [...nominalUsdValues].sort((a, b) => a - b)
      : pricedRecords.map(p => p.price).sort((a, b) => a - b);
    const min = amounts[0];
    const max = amounts[amounts.length - 1];
    const avg = amounts.reduce((sum, v) => sum + v, 0) / amounts.length;
    const median = amounts.length % 2 === 0
      ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
      : amounts[Math.floor(amounts.length / 2)];

    const mainCcy = "USD";

    lines.push(`  ${DIM("Price Statistics")} ${DIM(`(${pricedRecords.length} priced records, USD default)`)}`);
    lines.push(`  ${DIM("  Nominal USD at sale/listing date (FX historical).")}`);
    if (adjustedUsdValues.length > 0) {
      lines.push(`  ${DIM("  2026-adjusted USD available below (US CPI adjusted).")}`);
    }
    lines.push("");
    lines.push(`  ┌${"─".repeat(17)}┬${"─".repeat(17)}┬${"─".repeat(17)}┬${"─".repeat(17)}┐`);
    lines.push(`  │ ${pad(DIM("Minimum"), 16)}│ ${pad(DIM("Average"), 16)}│ ${pad(DIM("Median"), 16)}│ ${pad(DIM("Maximum"), 16)}│`);
    lines.push(`  ├${"─".repeat(17)}┼${"─".repeat(17)}┼${"─".repeat(17)}┼${"─".repeat(17)}┤`);
    lines.push(`  │ ${pad(BOLD(GREEN(fmtCurrency(min, mainCcy))), 16)}│ ${pad(BOLD(YELLOW(fmtCurrency(avg, mainCcy))), 16)}│ ${pad(BOLD(CYAN(fmtCurrency(median, mainCcy))), 16)}│ ${pad(BOLD(RED(fmtCurrency(max, mainCcy))), 16)}│`);
    lines.push(`  └${"─".repeat(17)}┴${"─".repeat(17)}┴${"─".repeat(17)}┴${"─".repeat(17)}┘`);

    if (adjustedUsdValues.length > 0) {
      const adjustedSorted = [...adjustedUsdValues].sort((a, b) => a - b);
      const adjMin = adjustedSorted[0];
      const adjMax = adjustedSorted[adjustedSorted.length - 1];
      const adjAvg = adjustedSorted.reduce((sum, v) => sum + v, 0) / adjustedSorted.length;
      const adjMedian = adjustedSorted.length % 2 === 0
        ? (adjustedSorted[adjustedSorted.length / 2 - 1] + adjustedSorted[adjustedSorted.length / 2]) / 2
        : adjustedSorted[Math.floor(adjustedSorted.length / 2)];
      lines.push("");
      lines.push(`  ${DIM("2026-Adjusted USD Statistics")} ${DIM(`(${adjustedUsdValues.length} records)`)}`);
      lines.push(`  ┌${"─".repeat(17)}┬${"─".repeat(17)}┬${"─".repeat(17)}┬${"─".repeat(17)}┐`);
      lines.push(`  │ ${pad(DIM("Minimum"), 16)}│ ${pad(DIM("Average"), 16)}│ ${pad(DIM("Median"), 16)}│ ${pad(DIM("Maximum"), 16)}│`);
      lines.push(`  ├${"─".repeat(17)}┼${"─".repeat(17)}┼${"─".repeat(17)}┼${"─".repeat(17)}┤`);
      lines.push(`  │ ${pad(BOLD(GREEN(fmtUsd(adjMin))), 16)}│ ${pad(BOLD(YELLOW(fmtUsd(adjAvg))), 16)}│ ${pad(BOLD(CYAN(fmtUsd(adjMedian))), 16)}│ ${pad(BOLD(RED(fmtUsd(adjMax))), 16)}│`);
      lines.push(`  └${"─".repeat(17)}┴${"─".repeat(17)}┴${"─".repeat(17)}┴${"─".repeat(17)}┘`);
    }
  } else {
    lines.push("");
    lines.push(`  ${DIM("⚠ No numeric prices extracted from any source.")}`);
    lines.push(`  ${DIM("  Records were found but prices could not be parsed from the pages.")}`);
    lines.push(`  ${DIM("  This may improve with authenticated or licensed access.")}`);
  }

  return lines.join("\n");
}

function renderRecordTable(data: ReportData): string {
  const uniqueRecords = data.records ?? [];
  const duplicates = data.duplicates ?? [];
  const allRecords = [...uniqueRecords, ...duplicates];
  if (allRecords.length === 0) return "";

  // Sort: priced first (descending), then unpriced
  const sorted = [...uniqueRecords].sort((a, b) => {
    const pa = getNumericPrice(a)?.amount ?? Number.NEGATIVE_INFINITY;
    const pb = getNumericPrice(b)?.amount ?? Number.NEGATIVE_INFINITY;
    if (pa !== pb) return pb - pa;
    return (b.overall_confidence ?? 0) - (a.overall_confidence ?? 0);
  });

  const lines: string[] = [sectionHeader("ALL RECORDS", "🎨")];
  lines.push(`  ${DIM(`${uniqueRecords.length} unique records (${allRecords.length} total incl. duplicates)`)}`);
  lines.push("");

  lines.push(`  ${DIM("#")}   ${pad(DIM("Price"), 22)} ${pad(DIM("Type"), 8)} ${pad(DIM("Work / Source"), 48)}`);
  lines.push(`  ${DIM("─".repeat(3))} ${DIM("─".repeat(22))} ${DIM("─".repeat(8))} ${DIM("─".repeat(48))}`);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const num = DIM(String(i + 1).padStart(3));
    const icon = priceTypeIcon(r.price_type);

    // Format price
    let priceStr: string;
    const price = getNumericPrice(r);
    if (price) {
      priceStr = BOLD(YELLOW(fmtCurrency(price.amount, price.currency)));
    } else if (isRenderableAmount(r.estimate_low) && isRenderableAmount(r.estimate_high)) {
      const ccy = r.currency ?? "TRY";
      priceStr = YELLOW(`${fmtCurrency(r.estimate_low, ccy)}–${fmtCurrency(r.estimate_high, ccy)}`);
    } else if (r.price_type === "inquiry_only" || r.price_hidden) {
      priceStr = MAG("inquiry only");
    } else {
      priceStr = DIM("—");
    }

    // Short type label
    const typeShort = r.price_type === "hammer_price" ? DIM("sold")
      : r.price_type === "asking_price" ? DIM("ask")
      : r.price_type === "estimate" ? DIM("est.")
      : r.price_type === "inquiry_only" ? DIM("inq.")
      : DIM(r.price_type.slice(0, 6));

    // Work title - truncate if needed
    const rawTitle = r.work_title ?? "untitled";
    const title = rawTitle.length > 40 ? rawTitle.slice(0, 37) + "..." : rawTitle;

    // Build detail line
    const detailParts: string[] = [];
    if (r.venue_name) detailParts.push(r.venue_name);
    if (r.city) detailParts.push(r.city);
    if (r.country) detailParts.push(r.country);
    if (r.sale_or_listing_date) detailParts.push(r.sale_or_listing_date);
    if (r.medium) detailParts.push(r.medium);
    if (r.dimensions_text) detailParts.push(r.dimensions_text);
    if (r.year) detailParts.push(r.year);

    const detail = detailParts.length > 0 ? DIM(detailParts.join(" · ")) : "";

    lines.push(`  ${num}  ${icon} ${pad(priceStr, 20)} ${pad(typeShort, 8)} ${title}`);
    if (detail) {
      lines.push(`       ${DIM(r.source_name)} ${DIM("·")} ${detail}`);
    } else {
      lines.push(`       ${DIM(r.source_name)}`);
    }
  }

  return lines.join("\n");
}

function renderValuation(data: ReportData): string {
  const v = data.valuation;
  if (!v) return "";

  const lines: string[] = [sectionHeader("VALUATION", "📈")];

  if (v.generated) {
    lines.push(`  ${GREEN("✔")} ${BOLD(GREEN("Valuation generated successfully"))}`);
    lines.push("");

    const renderRange = (range: { low: number; high: number } | null | undefined, label: string) => {
      if (!range) return;
      lines.push(`  ${GREEN("▸")} ${pad(label + ":", 20)} ${BOLD(GREEN(fmtCurrency(range.low, "TRY")))} – ${BOLD(GREEN(fmtCurrency(range.high, "TRY")))}`);
    };

    renderRange(v.blendedRange, "Blended Range");
    renderRange(v.turkeyRange, "Turkey Range");
    renderRange(v.internationalRange, "International");

    if (v.laneRanges) {
      lines.push("");
      lines.push(`  ${DIM("By Lane:")}`);
      renderRange(v.laneRanges.realized, "  🔨 Realized");
      renderRange(v.laneRanges.estimate, "  📊 Estimate");
      renderRange(v.laneRanges.asking, "  💰 Asking");
    }

    if (v.topComparables && v.topComparables.length > 0) {
      lines.push("");
      lines.push(`  ${DIM("Top Comparables:")}`);
      for (const comp of v.topComparables) {
        const price = isRenderableAmount(comp.nativePrice)
          ? YELLOW(fmtCurrency(comp.nativePrice, comp.currency))
          : isRenderableAmount(comp.normalizedPriceTry)
            ? YELLOW(fmtCurrency(comp.normalizedPriceTry, "TRY"))
            : DIM("no price");
        const score = comp.score != null ? DIM(` (${(comp.score * 100).toFixed(0)}%)`) : "";
        const lane = priceTypeIcon(comp.valuationLane === "realized" ? "hammer_price" : comp.valuationLane === "asking" ? "asking_price" : comp.valuationLane);
        lines.push(`    ${lane} ${price}  ${comp.workTitle.slice(0, 40)}${score}`);
        lines.push(`       ${DIM(comp.sourceName)}`);
      }
    }
  } else {
    lines.push(`  ${RED("✘")} ${DIM("Valuation not generated")}`);
    if (v.reason) {
      lines.push(`  ${DIM("  Reason: " + v.reason)}`);
    }
    if (v.valuationCandidateCount != null) {
      lines.push(`  ${DIM(`  Candidates found: ${v.valuationCandidateCount} (minimum 5 required)`)}`);
    }

    // Still show top comparables as evidence
    if (v.topComparables && v.topComparables.length > 0) {
      lines.push("");
      lines.push(`  ${DIM("Best available comparables (not enough for valuation):")}`);
      for (const comp of v.topComparables) {
        const price = isRenderableAmount(comp.nativePrice)
          ? YELLOW(fmtCurrency(comp.nativePrice, comp.currency))
          : isRenderableAmount(comp.normalizedPriceTry)
            ? YELLOW(fmtCurrency(comp.normalizedPriceTry, "TRY"))
            : DIM("no price");
        const score = comp.score != null ? DIM(` score: ${(comp.score * 100).toFixed(0)}%`) : "";
        lines.push(`    ${priceTypeIcon(comp.valuationLane === "realized" ? "hammer_price" : comp.valuationLane === "asking" ? "asking_price" : comp.valuationLane)} ${price}  ${comp.workTitle.slice(0, 40)}${score}`);
        lines.push(`       ${DIM(comp.sourceName)}`);
      }
    }
  }

  return lines.join("\n");
}

function renderPerPaintingStats(data: ReportData): string {
  const stats = data.perPaintingStats ?? [];
  if (stats.length === 0) return "";

  const lines: string[] = [sectionHeader("PER-PAINTING USD STATISTICS", "🧮")];
  lines.push(`  ${DIM("Clustered by normalized title + year + dimensions bucket.")}`);
  lines.push(`  ${DIM("Values show nominal USD and 2026-adjusted USD.")}`);
  lines.push("");
  lines.push(
    `  ${pad(DIM("Painting"), 34)} ${rpad(DIM("Rec"), 4)} ${rpad(DIM("Src"), 4)} ${pad(DIM("Nominal Min/Avg/Max USD"), 34)} ${pad(DIM("2026 Min/Avg/Max USD"), 34)}`
  );
  lines.push(`  ${DIM("─".repeat(34))} ${DIM("─".repeat(4))} ${DIM("─".repeat(4))} ${DIM("─".repeat(34))} ${DIM("─".repeat(34))}`);

  for (const stat of stats.slice(0, 20)) {
    const title = stat.title.length > 32 ? `${stat.title.slice(0, 29)}...` : stat.title;
    const nominal = stat.minUsdNominal != null && stat.avgUsdNominal != null && stat.maxUsdNominal != null
      ? `${fmtUsd(stat.minUsdNominal)} / ${fmtUsd(stat.avgUsdNominal)} / ${fmtUsd(stat.maxUsdNominal)}`
      : DIM("n/a");
    const adjusted = stat.minUsd2026 != null && stat.avgUsd2026 != null && stat.maxUsd2026 != null
      ? `${fmtUsd(stat.minUsd2026)} / ${fmtUsd(stat.avgUsd2026)} / ${fmtUsd(stat.maxUsd2026)}`
      : DIM("n/a");
    lines.push(
      `  ${pad(title, 34)} ${rpad(String(stat.recordsCount), 4)} ${rpad(String(stat.uniqueSources), 4)} ${pad(nominal, 34)} ${pad(adjusted, 34)}`
    );
    const yearSpan = stat.firstYear && stat.lastYear ? `${stat.firstYear}–${stat.lastYear}` : "year n/a";
    const dim = stat.dimensionsBucket ?? "size n/a";
    lines.push(`  ${DIM(`    ${yearSpan} · ${dim}`)}`);
  }

  if (stats.length > 20) {
    lines.push(`  ${DIM(`... ${stats.length - 20} more clusters in JSON output`)}`);
  }

  return lines.join("\n");
}

function renderBlockerSummary(data: ReportData): string {
  const s = data.summary;
  if (!s?.acceptance_reason_breakdown) return "";

  const breakdown = s.acceptance_reason_breakdown;
  const hasIssues = Object.entries(breakdown).some(([key, count]) =>
    count > 0 && key !== "valuation_ready" && key !== "estimate_range_ready" && key !== "asking_price_ready" && key !== "inquiry_only_evidence",
  );

  if (!hasIssues) return "";

  const lines: string[] = [sectionHeader("DATA QUALITY", "⚠️")];

  const issueLabels: Record<string, string> = {
    missing_numeric_price: "Price not parseable from page",
    missing_currency: "Currency not detected",
    missing_estimate_range: "Estimate range incomplete",
    unknown_price_type: "Unknown price type",
    blocked_access: "Source blocked / unreachable",
    entity_mismatch: "Entity mismatch rejected",
    generic_shell_page: "Generic shell/search page rejected",
    price_hidden_evidence: "Price hidden (logged in required)",
  };

  for (const [reason, count] of Object.entries(breakdown)) {
    if (count === 0) continue;
    if (["valuation_ready", "estimate_range_ready", "asking_price_ready", "inquiry_only_evidence"].includes(reason)) continue;
    const label = issueLabels[reason] ?? reason.replace(/_/g, " ");
    const bar = "░".repeat(Math.min(Math.ceil((count / (s.total_records ?? 1)) * 40), 40));
    lines.push(`  ${YELLOW("▸")} ${pad(label, 38)} ${rpad(String(count), 4)}  ${DIM(bar)}`);
  }

  if (s.rejected_candidates) {
    lines.push("");
    lines.push(`  ${DIM(`${s.rejected_candidates} total rejected candidates`)}`);
  }

  return lines.join("\n");
}

function renderFooter(data: ReportData): string {
  return [
    "",
    `  ${hr(68)}`,
    `  ${DIM("Run ID:")} ${data.runId}`,
    `  ${DIM("Full JSON:")} pnpm --filter artbot dev runs show --run-id ${data.runId} --json`,
    "",
  ].join("\n");
}

// ── Main export ──────────────────────────────────────────────────────────────

export function renderMarketReport(data: ReportData): string {
  const sections = [
    renderReportHeader(data),
    renderValuation(data),
    renderMarketOverview(data),
    renderPriceStatistics(data),
    renderSourceCoverage(data),
    renderPerPaintingStats(data),
    renderRecordTable(data),
    renderBlockerSummary(data),
    renderFooter(data),
  ];

  return sections.filter(Boolean).join("\n");
}
