export type ReportTone = "neutral" | "muted" | "success" | "warning" | "danger" | "accent";

export interface ReportMetric {
  label: string;
  value: string;
  tone?: ReportTone;
  hint?: string;
}

export interface ReportDistributionItem {
  label: string;
  value: number;
  tone?: ReportTone;
}

export interface ReportReasonItem {
  label: string;
  count: number;
  tone?: ReportTone;
}

export interface ReportRange {
  label: string;
  low: number | null;
  high: number | null;
  currency: string;
}

export interface ReportComparable {
  sourceName: string;
  workTitle: string;
  lane: string;
  score?: number | null;
  valueLabel: string;
}

export interface ResearchRunReportItem {
  id: string;
  title: string;
  venueName: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  year: string | null;
  date: string | null;
  priceType: string;
  priceLabel: string;
  nativePriceLabel: string | null;
  normalizedPriceUsd: number | null;
  valuationConfidence: number | null;
  acceptedForValuation: boolean;
  acceptanceReason: string | null;
  sourceAccessStatus: string | null;
  detail: string | null;
}

export interface ResearchRunValuation {
  generated: boolean;
  reason: string;
  valuationCandidateCount: number | null;
  ranges: ReportRange[];
  topComparables: ReportComparable[];
}

export interface ResearchRunReportData {
  runId: string;
  artist: string;
  status: string;
  runType: string;
  analysisMode: string | null;
  createdAt: string | null;
  metrics: {
    accepted: number;
    rejected: number;
    discoveredCandidates: number;
    acceptedFromDiscovery: number;
    pricedCoverageCrawled: number | null;
    pricedCoverageAttempted: number | null;
    totalAttempts: number;
    totalRecords: number;
    valuationEligible: number | null;
  };
  sourceHealth: Record<string, number>;
  sourceHealthItems: ReportDistributionItem[];
  overviewMetrics: ReportMetric[];
  coverageMetrics: ReportMetric[];
  valuation: ResearchRunValuation;
  records: ResearchRunReportItem[];
  reasonBreakdown: ReportReasonItem[];
  failureBreakdown: ReportReasonItem[];
  gaps: string[];
  diagnosticsNotes: string[];
}
