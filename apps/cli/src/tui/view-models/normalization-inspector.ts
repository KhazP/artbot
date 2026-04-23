import type { ReportRecord } from "../../ui/report.js";
import type { PipelineDetails } from "../state.js";

export interface NormalizationInspectorEntry {
  title: string;
  sourceName: string;
  originalLine: string;
  interpretedLine: string;
  historicalLine: string;
  inflationLine: string;
  currentLine: string;
  confidenceLine: string;
  warnings: string[];
}

export interface NormalizationInspectorModel {
  totalRecords: number;
  entries: NormalizationInspectorEntry[];
}

function fmtCurrency(amount: number | null | undefined, currency: string): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return "n/a";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

function buildEntry(record: ReportRecord): NormalizationInspectorEntry {
  const originalAmount = record.original_amount_raw ?? (typeof record.price_amount === "number" ? String(record.price_amount) : "n/a");
  const originalCurrency = record.original_currency_raw ?? record.currency ?? "n/a";
  const historicalTry = record.historical_price_try ?? record.normalized_price_try ?? null;
  const historicalUsd = record.historical_price_usd ?? record.normalized_price_usd_nominal ?? record.normalized_price_usd ?? null;
  const warnings = [...(record.normalization_warnings ?? [])];
  if (record.normalization_requires_manual_review) {
    warnings.unshift("Manual review recommended.");
  }

  return {
    title: record.work_title ?? "Untitled",
    sourceName: record.source_name,
    originalLine: `${originalAmount} ${originalCurrency} · ${record.original_event_date ?? record.sale_or_listing_date ?? "date n/a"}`,
    interpretedLine: `${record.original_currency_canonical ?? "UNKNOWN"}${record.redenomination_applied ? " · redenominated x0.000001" : ""}`,
    historicalLine: `Hist ${fmtCurrency(historicalTry, "TRY")} · ${fmtCurrency(historicalUsd, "USD")} · ${fmtCurrency(record.historical_price_eur, "EUR")}`,
    inflationLine: `Real ${fmtCurrency(record.normalized_price_usd_2026, "USD")} · ${fmtCurrency(record.normalized_price_eur_2026, "EUR")} · ${record.inflation_base_year ?? "base n/a"}`,
    currentLine: `Current ${fmtCurrency(record.current_price_try, "TRY")} · ${fmtCurrency(record.current_price_usd, "USD")} · ${fmtCurrency(record.current_price_eur, "EUR")} · ${record.current_price_as_of_date ?? "as-of n/a"}`,
    confidenceLine: `Conf ${(record.normalization_confidence_score ?? 0).toFixed(2)} · date ${record.date_confidence ?? "unknown"} · currency ${(record.currency_interpretation_confidence ?? 0).toFixed(2)}`,
    warnings
  };
}

export function buildNormalizationInspectorModel(details: PipelineDetails | null): NormalizationInspectorModel {
  const records = details?.records ?? [];
  return {
    totalRecords: records.length,
    entries: records
      .filter((record) => record.original_currency_canonical || record.normalized_price_try != null || record.current_price_try != null)
      .slice(0, 5)
      .map(buildEntry)
  };
}
