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

export interface ReportAction {
  title: string;
  reason: string;
  severity: "info" | "warning" | "critical";
}

export interface ReportSourceMetric {
  sourceName: string;
  sourceFamily: string;
  venueName: string;
  legalPosture: string;
  reliabilityScore: number;
  totalAttempts: number;
  reachableCount: number;
  parseSuccessCount: number;
  priceSignalCount: number;
  acceptedForEvidenceCount: number;
  valuationReadyCount: number;
  blockedCount: number;
  authRequiredCount: number;
  lastStatus: string;
}

export interface ReportCanary {
  family: string;
  sourceName: string;
  fixture: string;
  sourcePageType: string;
  legalPosture: string;
  expectedPriceType: string | null;
  observedPriceType: string;
  acceptanceReason: string;
  acceptedForEvidence: boolean;
  acceptedForValuation: boolean;
  status: "pass" | "fail";
  details: string;
  recordedAt: string;
}

export interface ReportDiscoveryDiagnostic {
  provider: string;
  enabled: boolean;
  reason: string | null;
  requestsUsed: number;
  resultsReturned: number;
  candidatesConsidered: number;
  candidatesKept: number;
  failoverInvoked: boolean;
  trimmedByCaps: boolean;
  budgetExhausted: boolean;
}

export interface ReportLocalAiAnalysis {
  accepted: number;
  queued: number;
  rejected: number;
  deterministicVetoCount: number;
  confidenceBands: {
    low: number;
    medium: number;
    high: number;
  };
  provider: string | null;
  model: string | null;
  avgLatencyMs: number | null;
}

export interface ReportDeepResearchCitation {
  title: string;
  url: string;
  snippet?: string;
}

export interface ReportDeepResearchPlan {
  normalRunSummary: string;
  missingEvidenceSummary: string;
  researchObjectives: string[];
  followUpQuestions: string[];
  prioritySearchTargets: string[];
  finalReportInstructions: string;
}

export interface ReportDeepResearch {
  enabled: boolean;
  status: string;
  summary: string | null;
  promptPlan: ReportDeepResearchPlan | null;
  reportMarkdown: string | null;
  citations: ReportDeepResearchCitation[];
  warnings: string[];
  providerMetadata: string[];
}

export interface ReportSourcePlanItem {
  sourceName: string;
  venueName: string;
  sourceFamily: string;
  accessMode: string;
  accessStatus: string;
  legalPosture: string | null;
  candidateCount: number;
  status: string;
  selectionState: string;
  selectionReason: string | null;
  priorityRank: number;
  skipReason: string | null;
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
  accessMode: string | null;
  legalPosture: string | null;
  accessProvenanceLabel: string | null;
  acceptanceExplanation: string | null;
  nextStepHint: string | null;
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
    clusterCount: number | null;
    reviewItemCount: number | null;
  };
  sourceHealth: Record<string, number>;
  sourceHealthItems: ReportDistributionItem[];
  overviewMetrics: ReportMetric[];
  coverageMetrics: ReportMetric[];
  evaluationMetrics: ReportMetric[];
  valuation: ResearchRunValuation;
  records: ResearchRunReportItem[];
  recommendedActions: ReportAction[];
  sourcePlan: ReportSourcePlanItem[];
  sourceMetrics: ReportSourceMetric[];
  canaries: ReportCanary[];
  discoveryDiagnostics: ReportDiscoveryDiagnostic[];
  reasonBreakdown: ReportReasonItem[];
  failureBreakdown: ReportReasonItem[];
  localAi: ReportLocalAiAnalysis | null;
  deepResearch: ReportDeepResearch | null;
  gaps: string[];
  diagnosticsNotes: string[];
}
