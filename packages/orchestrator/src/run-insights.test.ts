import { describe, expect, it } from "vitest";
import { buildEvaluationMetrics } from "./run-insights.js";

describe("buildEvaluationMetrics", () => {
  it("uses selected runnable plan rows as the priced recall denominator", () => {
    const metrics = buildEvaluationMetrics({
      attempts: [
        {
          source_name: "Selected A",
          source_access_status: "public_access",
          acceptance_reason: "asking_price_ready"
        } as any,
        {
          source_name: "Selected B",
          source_access_status: "public_access",
          acceptance_reason: "missing_numeric_price"
        } as any
      ],
      sourcePlan: [
        {
          source_name: "Selected A",
          selection_state: "selected",
          candidate_count: 2,
          source_access_status: "public_access"
        } as any,
        {
          source_name: "Selected B",
          selection_state: "selected",
          candidate_count: 2,
          source_access_status: "public_access"
        } as any,
        {
          source_name: "Deferred C",
          selection_state: "deprioritized",
          candidate_count: 3,
          source_access_status: "public_access"
        } as any
      ],
      acceptedRecords: 1,
      valuationEligibleRecords: 1
    });

    expect(metrics.priced_source_recall).toBe(0.5);
    expect(metrics.coverage_target_met).toBe(false);
  });

  it("keeps source recall separate when priced evidence coverage is healthy", () => {
    const metrics = buildEvaluationMetrics({
      attempts: [
        {
          source_name: "Selected A",
          source_access_status: "public_access",
          acceptance_reason: "asking_price_ready"
        } as any,
        {
          source_name: "Selected B",
          source_access_status: "public_access",
          acceptance_reason: "missing_numeric_price"
        } as any
      ],
      sourcePlan: [
        {
          source_name: "Selected A",
          selection_state: "selected",
          candidate_count: 2,
          source_access_status: "public_access"
        } as any,
        {
          source_name: "Selected B",
          selection_state: "selected",
          candidate_count: 2,
          source_access_status: "public_access"
        } as any
      ],
      acceptedRecords: 4,
      valuationEligibleRecords: 3
    });

    expect(metrics.priced_source_recall).toBe(0.5);
    expect(metrics.valuation_readiness_ratio).toBe(0.75);
    expect(metrics.coverage_target_met).toBe(false);
    expect(metrics.priced_record_count).toBe(3);
    expect(metrics.family_coverage_ratio).toBe(0);
  });
});
