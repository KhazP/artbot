import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defineCatalog } from "@json-render/core";
import { JSONUIProvider, defineRegistry, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { AlertTriangle, BarChart3, CheckCircle2, CircleDollarSign, ExternalLink, GlobeLock, ShieldAlert, Sparkles } from "lucide-react";
import { z } from "zod";
import { normalizeResearchRunReport } from "./normalize.js";
import type {
  ResearchRunReportData,
  ReportAction,
  ReportComparable,
  ReportDistributionItem,
  ReportMetric,
  ReportRange,
  ReportReasonItem,
  ReportSourcePlanItem,
  ResearchRunReportItem,
  ReportTone
} from "./types.js";

function toneClasses(tone: ReportTone | undefined): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "danger":
      return "border-rose-500/30 bg-rose-500/10 text-rose-100";
    case "accent":
      return "border-sky-500/30 bg-sky-500/10 text-sky-100";
    case "muted":
      return "border-zinc-800 bg-zinc-900/80 text-zinc-300";
    default:
      return "border-zinc-800 bg-zinc-900/80 text-zinc-100";
  }
}

function metricValueTone(value: string): string {
  return value === "n/a" ? "text-zinc-500" : "text-white";
}

function sectionTitleIcon(title: string) {
  if (title.includes("Valuation")) return CircleDollarSign;
  if (title.includes("Diagnostics")) return ShieldAlert;
  if (title.includes("Record") || title.includes("Inventory")) return GlobeLock;
  return BarChart3;
}

function formatPercentValue(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.string().optional(),
  hint: z.string().optional()
});

const distributionSchema = z.object({
  label: z.string(),
  value: z.number(),
  tone: z.string().optional()
});

const reasonSchema = z.object({
  label: z.string(),
  count: z.number(),
  tone: z.string().optional()
});

const comparableSchema = z.object({
  sourceName: z.string(),
  workTitle: z.string(),
  lane: z.string(),
  score: z.number().nullable().optional(),
  valueLabel: z.string()
});

const rangeSchema = z.object({
  label: z.string(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  currency: z.string()
});

const recordSchema = z.object({
  id: z.string(),
  title: z.string(),
  venueName: z.string(),
  sourceUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  year: z.string().nullable(),
  date: z.string().nullable(),
  priceType: z.string(),
  priceLabel: z.string(),
  nativePriceLabel: z.string().nullable(),
  normalizedPriceUsd: z.number().nullable(),
  valuationConfidence: z.number().nullable(),
  acceptedForValuation: z.boolean(),
  acceptanceReason: z.string().nullable(),
  sourceAccessStatus: z.string().nullable(),
  detail: z.string().nullable()
});

const layoutPropsSchema = z.object({
  artist: z.string(),
  runId: z.string(),
  status: z.string(),
  runType: z.string(),
  analysisMode: z.string().nullable(),
  createdAt: z.string().nullable()
});

const sectionPropsSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional()
});

const metricGridPropsSchema = z.object({
  items: z.array(metricSchema)
});

const sourceHealthPropsSchema = z.object({
  items: z.array(distributionSchema),
  coverage: z.array(metricSchema)
});

const valuationPropsSchema = z.object({
  generated: z.boolean(),
  reason: z.string(),
  valuationCandidateCount: z.number().nullable(),
  ranges: z.array(rangeSchema),
  topComparables: z.array(comparableSchema)
});

const diagnosticsPropsSchema = z.object({
  reasons: z.array(reasonSchema),
  failures: z.array(reasonSchema),
  gaps: z.array(z.string()),
  notes: z.array(z.string())
});

const actionSchema = z.object({
  title: z.string(),
  reason: z.string(),
  severity: z.enum(["info", "warning", "critical"])
});

const sourcePlanSchema = z.object({
  sourceName: z.string(),
  venueName: z.string(),
  sourceFamily: z.string(),
  accessMode: z.string(),
  accessStatus: z.string(),
  candidateCount: z.number(),
  status: z.string(),
  selectionState: z.string(),
  selectionReason: z.string().nullable(),
  priorityRank: z.number(),
  skipReason: z.string().nullable()
});

const nextActionsPropsSchema = z.object({
  actions: z.array(actionSchema),
  sourcePlan: z.array(sourcePlanSchema)
});

const recordsTablePropsSchema = z.object({
  runType: z.string(),
  items: z.array(recordSchema)
});

const catalog = (defineCatalog as (...args: any[]) => any)(schema, {
  components: {
    Layout: {
      props: layoutPropsSchema,
      description: "Top-level research report layout"
    },
    Section: {
      props: sectionPropsSchema,
      description: "Report section wrapper"
    },
    MetricGrid: {
      props: metricGridPropsSchema,
      description: "Dense metric grid"
    },
    SourceHealthPanel: {
      props: sourceHealthPropsSchema,
      description: "Source health and coverage panel"
    },
    ValuationPanel: {
      props: valuationPropsSchema,
      description: "Valuation outcome with ranges and comparables"
    },
    DiagnosticsPanel: {
      props: diagnosticsPropsSchema,
      description: "Diagnostics, blockers, and gap breakdown"
    },
    NextActionsPanel: {
      props: nextActionsPropsSchema,
      description: "Operator actions and source-plan visibility"
    },
    RecordsTable: {
      props: recordsTablePropsSchema,
      description: "Accepted comparables or inventory records table"
    }
  },
  actions: {}
});

const { registry } = defineRegistry(catalog, {
  components: {
    Layout: ({ props, children }: { props: z.infer<typeof layoutPropsSchema>; children?: React.ReactNode }) => {
      const statusTone = toneClasses(props.status.includes("completed") ? "success" : props.status.includes("failed") ? "danger" : "warning");
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:px-10">
            <div className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6 shadow-2xl shadow-black/30">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 text-sky-200">
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Research Run Report</p>
                      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white lg:text-4xl">{props.artist}</h1>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 ${statusTone}`}>{props.status.replace(/_/g, " ")}</span>
                    <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1">{props.runType.replace(/_/g, " ")}</span>
                    {props.analysisMode ? (
                      <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1">{props.analysisMode} mode</span>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2 text-sm text-zinc-400">
                  <div>
                    <span className="mr-2 text-zinc-500">Run ID</span>
                    <span className="font-mono text-xs text-zinc-300">{props.runId}</span>
                  </div>
                  {props.createdAt ? (
                    <div>
                      <span className="mr-2 text-zinc-500">Created</span>
                      <span>{props.createdAt}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid gap-6">{children}</div>
          </div>
        </div>
      );
    },
    Section: ({ props, children }: { props: z.infer<typeof sectionPropsSchema>; children?: React.ReactNode }) => {
      const Icon = sectionTitleIcon(props.title);
      return (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/85 p-6 shadow-lg shadow-black/20">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-zinc-200">
                <Icon className="h-5 w-5 text-sky-300" />
                <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
              </div>
              {props.subtitle ? <p className="max-w-3xl text-sm text-zinc-400">{props.subtitle}</p> : null}
            </div>
          </div>
          {children}
        </section>
      );
    },
    MetricGrid: ({ props }: { props: { items: ReportMetric[] } }) => (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {props.items.map((item) => (
          <div key={item.label} className={`rounded-2xl border p-4 ${toneClasses(item.tone)}`}>
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">{item.label}</div>
            <div className={`mt-3 text-2xl font-semibold tracking-tight ${metricValueTone(item.value)}`}>{item.value}</div>
            {item.hint ? <div className="mt-2 text-sm text-zinc-400">{item.hint}</div> : null}
          </div>
        ))}
      </div>
    ),
    SourceHealthPanel: ({ props }: { props: { items: ReportDistributionItem[]; coverage: ReportMetric[] } }) => {
      const total = props.items.reduce((sum, item) => sum + item.value, 0);
      return (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-3">
            {props.items.length > 0 ? props.items.map((item) => (
              <div key={item.label} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{item.label}</span>
                  <span className="font-medium text-white">{item.value} <span className="text-zinc-500">{formatPercentValue(item.value, total)}</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${
                      item.tone === "success"
                        ? "bg-emerald-400"
                        : item.tone === "danger"
                          ? "bg-rose-400"
                          : item.tone === "warning"
                            ? "bg-amber-300"
                            : "bg-sky-400"
                    }`}
                    style={{ width: total > 0 ? `${Math.max((item.value / total) * 100, 4)}%` : "0%" }}
                  />
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-500">
                No source health data was recorded for this run.
              </div>
            )}
          </div>
          <div className="grid gap-3">
            {props.coverage.map((item) => (
              <div key={item.label} className={`rounded-2xl border p-4 ${toneClasses(item.tone)}`}>
                <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">{item.label}</div>
                <div className={`mt-2 text-xl font-semibold ${metricValueTone(item.value)}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      );
    },
    ValuationPanel: ({ props }: { props: { generated: boolean; reason: string; valuationCandidateCount: number | null; ranges: ReportRange[]; topComparables: ReportComparable[] } }) => (
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${toneClasses(props.generated ? "success" : "warning")}`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {props.generated ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <span>{props.generated ? "Valuation generated" : "Valuation not generated"}</span>
            </div>
            <p className="mt-3 text-sm text-zinc-300">{props.reason}</p>
            {props.valuationCandidateCount != null ? (
              <div className="mt-3 text-xs uppercase tracking-[0.22em] text-zinc-500">
                Eligible comparables: {props.valuationCandidateCount}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {props.ranges.length > 0 ? props.ranges.map((item) => (
              <div key={item.label} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">{item.label}</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {item.low != null || item.high != null ? `${item.low != null ? Intl.NumberFormat("en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.low) : "n/a"} – ${item.high != null ? Intl.NumberFormat("en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.high) : "n/a"}` : "n/a"}
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-500">
                No valuation ranges were produced.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-200">
            <Sparkles className="h-4 w-4 text-sky-300" />
            <span>Top Comparables</span>
          </div>
          <div className="space-y-3">
            {props.topComparables.length > 0 ? props.topComparables.map((item) => (
              <div key={`${item.sourceName}-${item.workTitle}`} className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">{item.workTitle}</div>
                    <div className="mt-1 text-sm text-zinc-400">{item.sourceName} · {item.lane}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-white">{item.valueLabel}</div>
                    {item.score != null ? <div className="mt-1 text-xs text-zinc-500">score {item.score.toFixed(2)}</div> : null}
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-500">
                No comparable list was included in the valuation payload.
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    DiagnosticsPanel: ({ props }: { props: { reasons: ReportReasonItem[]; failures: ReportReasonItem[]; gaps: string[]; notes: string[] } }) => (
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">Acceptance reasons</h3>
            <div className="flex flex-wrap gap-2">
              {props.reasons.length > 0 ? props.reasons.map((item) => (
                <div key={item.label} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${toneClasses(item.tone)}`}>
                  <span>{item.label}</span>
                  <span className="font-medium text-white">{item.count}</span>
                </div>
              )) : <div className="text-sm text-zinc-500">No acceptance reason breakdown was recorded.</div>}
            </div>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">Failure classes</h3>
            <div className="flex flex-wrap gap-2">
              {props.failures.length > 0 ? props.failures.map((item) => (
                <div key={item.label} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${toneClasses(item.tone)}`}>
                  <span>{item.label}</span>
                  <span className="font-medium text-white">{item.count}</span>
                </div>
              )) : <div className="text-sm text-zinc-500">No failure class breakdown was recorded.</div>}
            </div>
          </div>
        </div>
        <div className="grid gap-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">Coverage gaps</h3>
            <ul className="space-y-2 text-sm text-zinc-300">
              {props.gaps.length > 0 ? props.gaps.map((gap) => <li key={gap}>• {gap}</li>) : <li className="text-zinc-500">No explicit crawl gaps were recorded.</li>}
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">Notes</h3>
            <ul className="space-y-2 text-sm text-zinc-300">
              {props.notes.length > 0 ? props.notes.map((note) => <li key={note}>• {note}</li>) : <li className="text-zinc-500">No extra notes were recorded for this run.</li>}
            </ul>
          </div>
        </div>
      </div>
    ),
    NextActionsPanel: ({ props }: { props: { actions: ReportAction[]; sourcePlan: ReportSourcePlanItem[] } }) => (
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          {props.actions.length > 0 ? props.actions.map((action) => (
            <div key={action.title} className={`rounded-2xl border p-4 ${toneClasses(action.severity === "critical" ? "danger" : action.severity === "warning" ? "warning" : "accent")}`}>
              <div className="text-sm font-medium text-white">{action.title}</div>
              <p className="mt-2 text-sm text-zinc-300">{action.reason}</p>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-500">
              No operator follow-up actions were generated for this run.
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">Source plan</h3>
          <div className="space-y-3">
            {props.sourcePlan.length > 0 ? props.sourcePlan.slice(0, 8).map((item) => (
              <div key={`${item.sourceName}-${item.venueName}`} className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">#{item.priorityRank} · {item.sourceName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{item.venueName} · {item.sourceFamily} · {item.accessMode.replace(/_/g, " ")}</div>
                  </div>
                  <div className={`rounded-full border px-2 py-1 text-xs ${toneClasses(item.selectionState === "blocked" ? "danger" : item.selectionState === "deprioritized" ? "warning" : "success")}`}>
                    {item.selectionState}
                  </div>
                </div>
                <div className="mt-2 text-sm text-zinc-300">
                  {item.candidateCount} candidates · {item.accessStatus.replace(/_/g, " ")}
                </div>
                {item.selectionReason ? <div className="mt-2 text-xs text-sky-200">{item.selectionReason}</div> : item.skipReason ? <div className="mt-2 text-xs text-amber-200">{item.skipReason}</div> : null}
              </div>
            )) : (
              <div className="text-sm text-zinc-500">No source plan data was included in the payload.</div>
            )}
          </div>
        </div>
      </div>
    ),
    RecordsTable: ({ props }: { props: { runType: string; items: ResearchRunReportItem[] } }) => (
      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
            <thead className="bg-zinc-950/80 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Work</th>
                <th className="px-4 py-3 font-medium">Venue</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-900/70">
              {props.items.length > 0 ? props.items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="px-4 py-4">
                    <div className="flex gap-3">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.title} className="h-14 w-14 rounded-xl border border-zinc-800 object-cover" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/80 text-zinc-600">
                          <BarChart3 className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{[item.year, item.date, item.detail].filter(Boolean).join(" · ") || "No extra metadata"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-zinc-200">{item.venueName}</div>
                    {item.sourceUrl ? (
                      <a className="mt-1 inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200" href={item.sourceUrl}>
                        Open source <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <div className="mt-1 text-xs text-zinc-500">No source URL</div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-white">{item.priceLabel}</div>
                    {item.nativePriceLabel && item.nativePriceLabel !== item.priceLabel ? (
                      <div className="mt-1 text-xs text-zinc-500">{item.nativePriceLabel}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-zinc-300">{item.priceType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-4">
                    {item.valuationConfidence != null ? (
                      <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-100">
                        {(item.valuationConfidence * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-zinc-500">n/a</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className={`inline-flex rounded-full border px-2 py-1 text-xs ${toneClasses(item.acceptedForValuation ? "success" : item.sourceAccessStatus?.includes("blocked") ? "danger" : item.sourceAccessStatus?.includes("auth") ? "warning" : "muted")}`}>
                      {item.acceptedForValuation ? "Accepted" : item.acceptanceReason ? item.acceptanceReason.replace(/_/g, " ") : item.sourceAccessStatus?.replace(/_/g, " ") ?? "Review"}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    {props.runType === "artist_market_inventory" ? "No inventory records were produced." : "No accepted records were produced."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
});

function createElementBuilder() {
  const elements: Record<string, unknown> = {};
  let count = 0;

  function add(type: string, props: Record<string, unknown>, children: string[] = []): string {
    const id = `${type.toLowerCase()}-${++count}`;
    elements[id] = {
      type,
      props,
      children
    };
    return id;
  }

  return { elements, add };
}

export function buildResearchRunSpec(input: ResearchRunReportData): Record<string, unknown> {
  const { elements, add } = createElementBuilder();
  const metrics = add("MetricGrid", { items: input.overviewMetrics });
  const sourceHealth = add("SourceHealthPanel", {
    items: input.sourceHealthItems,
    coverage: [...input.coverageMetrics, ...input.evaluationMetrics]
  });
  const overview = add("Section", {
    title: "Overview",
    subtitle: "Core run metrics, priced coverage, and source health."
  }, [metrics, sourceHealth]);

  const valuation = add("ValuationPanel", {
    generated: input.valuation.generated,
    reason: input.valuation.reason,
    valuationCandidateCount: input.valuation.valuationCandidateCount,
    ranges: input.valuation.ranges,
    topComparables: input.valuation.topComparables
  });
  const valuationSection = add("Section", {
    title: "Valuation",
    subtitle: "Valuation outcome, range outputs, and highest-ranked comparable records."
  }, [valuation]);

  const nextActions = add("NextActionsPanel", {
    actions: input.recommendedActions,
    sourcePlan: input.sourcePlan
  });
  const nextActionsSection = add("Section", {
    title: "Next Actions",
    subtitle: "Operator follow-up tasks and the source plan used for this run."
  }, [nextActions]);

  const records = add("RecordsTable", {
    runType: input.runType,
    items: input.records
  });
  const recordsSection = add("Section", {
    title: input.runType === "artist_market_inventory" ? "Inventory Records" : "Accepted Comparables",
    subtitle: input.runType === "artist_market_inventory" ? "Full inventory view with status cues and source links." : "Accepted valuation candidates captured for this run."
  }, [records]);

  const diagnostics = add("DiagnosticsPanel", {
    reasons: input.reasonBreakdown,
    failures: input.failureBreakdown,
    gaps: input.gaps,
    notes: input.diagnosticsNotes
  });
  const diagnosticsSection = add("Section", {
    title: "Diagnostics",
    subtitle: "Acceptance reasons, failure classes, crawl gaps, and run notes."
  }, [diagnostics]);

  const root = add("Layout", {
    artist: input.artist,
    runId: input.runId,
    status: input.status,
    runType: input.runType,
    analysisMode: input.analysisMode,
    createdAt: input.createdAt
  }, [overview, valuationSection, nextActionsSection, recordsSection, diagnosticsSection]);

  return {
    root,
    elements
  };
}

function ReportRenderer({ data }: { data: ResearchRunReportData }) {
  const spec = buildResearchRunSpec(data);
  return (
    <JSONUIProvider registry={registry as never}>
      <Renderer spec={spec as never} registry={registry as never} />
    </JSONUIProvider>
  );
}

export function ResearchRunReport({ reportData }: { reportData: ResearchRunReportData | unknown }) {
  const normalized = isNormalizedReportData(reportData) ? reportData : normalizeResearchRunReport(reportData);
  return <ReportRenderer data={normalized} />;
}

function isNormalizedReportData(value: unknown): value is ResearchRunReportData {
  return (
    typeof value === "object" &&
    value !== null &&
    "artist" in value &&
    "overviewMetrics" in value &&
    "records" in value
  );
}

export function renderResearchRunHtml(reportData: ResearchRunReportData | unknown): string {
  const normalized = isNormalizedReportData(reportData) ? reportData : normalizeResearchRunReport(reportData);
  const body = renderToStaticMarkup(<ReportRenderer data={normalized} />);
  return [
    "<!doctype html>",
    '<html lang="en" class="dark">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>ArtBot Research Run Report</title>",
    "  <script>tailwind = { config: { darkMode: 'class' } };</script>",
    '  <script src="https://cdn.tailwindcss.com"></script>',
    "  <style>",
    "    html, body { background: #09090b; }",
    "    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
    "    a { text-decoration: none; }",
    "    img { display: block; }",
    "  </style>",
    "</head>",
    `<body>${body}</body>`,
    "</html>"
  ].join("");
}
