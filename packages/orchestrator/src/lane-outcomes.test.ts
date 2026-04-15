import { describe, expect, it } from "vitest";
import { captureLaneOutcome, mergeLaneOutcome } from "./lane-outcomes.js";

describe("lane outcome merge", () => {
  it("keeps accepted cheap-fetch evidence when browser lane is blocked", () => {
    const cheapFetch = captureLaneOutcome(
      "cheap_fetch",
      {
        source_access_status: "public_access",
        acceptance_reason: "estimate_range_ready",
        accepted_for_evidence: true,
        accepted_for_valuation: false,
        accepted: true,
        confidence_score: 0.72,
        extracted_fields: {},
        screenshot_path: null,
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: null,
        har_path: null
      } as any,
      {
        accepted_for_evidence: true,
        accepted_for_valuation: false,
        acceptance_reason: "estimate_range_ready",
        source_access_status: "public_access",
        valuation_confidence: 0.6,
        overall_confidence: 0.72,
        notes: []
      } as any
    );
    const browserBlocked = captureLaneOutcome(
      "browser",
      {
        source_access_status: "blocked",
        acceptance_reason: "blocked_access",
        accepted_for_evidence: false,
        accepted_for_valuation: false,
        accepted: false,
        confidence_score: 0.1,
        extracted_fields: {},
        screenshot_path: "/tmp/blocked.png",
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: "/tmp/blocked.html",
        trace_path: null,
        har_path: null
      } as any,
      {
        accepted_for_evidence: false,
        accepted_for_valuation: false,
        acceptance_reason: "blocked_access",
        source_access_status: "blocked",
        valuation_confidence: 0,
        overall_confidence: 0.1,
        notes: []
      } as any
    );

    const merged = mergeLaneOutcome(cheapFetch, browserBlocked);
    expect(merged.overwritePrevented).toBe(true);
    expect(merged.outcome.attempt.accepted_for_evidence).toBe(true);
    expect(merged.outcome.attempt.acceptance_reason).toBe("estimate_range_ready");
    expect((merged.outcome.attempt.extracted_fields as { browser_overwrite_prevented?: boolean }).browser_overwrite_prevented).toBe(
      true
    );
    expect((merged.outcome.attempt as any).notes).toContain("verification_blocked");
    expect((merged.outcome.record as any).notes).toContain("verification_blocked");
  });

  it("promotes a stronger later valuation-ready lane outcome", () => {
    const cheapFetch = captureLaneOutcome(
      "cheap_fetch",
      {
        source_access_status: "public_access",
        acceptance_reason: "inquiry_only_evidence",
        accepted_for_evidence: true,
        accepted_for_valuation: false,
        accepted: true,
        confidence_score: 0.55,
        extracted_fields: {}
      } as any,
      {
        accepted_for_evidence: true,
        accepted_for_valuation: false,
        acceptance_reason: "inquiry_only_evidence",
        source_access_status: "public_access",
        valuation_confidence: 0,
        overall_confidence: 0.55,
        notes: []
      } as any
    );
    const browserValuationReady = captureLaneOutcome(
      "browser",
      {
        source_access_status: "public_access",
        acceptance_reason: "valuation_ready",
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        accepted: true,
        confidence_score: 0.9,
        extracted_fields: {}
      } as any,
      {
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        acceptance_reason: "valuation_ready",
        source_access_status: "public_access",
        valuation_confidence: 0.9,
        overall_confidence: 0.9,
        notes: []
      } as any
    );

    const merged = mergeLaneOutcome(cheapFetch, browserValuationReady);
    expect(merged.overwritePrevented).toBe(false);
    expect(merged.outcome.lane).toBe("browser");
    expect(merged.outcome.attempt.accepted_for_valuation).toBe(true);
    expect(merged.outcome.attempt.acceptance_reason).toBe("valuation_ready");
  });
});
