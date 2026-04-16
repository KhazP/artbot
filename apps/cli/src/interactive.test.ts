import { afterEach, describe, expect, it } from "vitest";
import { resolvePipelineDefaultsFromEnv, summarizeAttemptBlockers } from "./interactive.js";
import { buildComposerInputKey } from "./interactive-app.js";

const envSnapshot = {
  DEFAULT_ANALYSIS_MODE: process.env.DEFAULT_ANALYSIS_MODE,
  DEFAULT_PRICE_NORMALIZATION: process.env.DEFAULT_PRICE_NORMALIZATION,
  DEFAULT_REPORT_SURFACE: process.env.DEFAULT_REPORT_SURFACE,
  DEFAULT_AUTH_PROFILE: process.env.DEFAULT_AUTH_PROFILE,
  ENABLE_LICENSED_INTEGRATIONS: process.env.ENABLE_LICENSED_INTEGRATIONS,
  DEFAULT_LICENSED_INTEGRATIONS: process.env.DEFAULT_LICENSED_INTEGRATIONS,
  TRANSPORT_MAX_ATTEMPTS: process.env.TRANSPORT_MAX_ATTEMPTS,
  TRANSPORT_REQUEST_TIMEOUT_MS: process.env.TRANSPORT_REQUEST_TIMEOUT_MS,
  TRANSPORT_CURL_FALLBACK: process.env.TRANSPORT_CURL_FALLBACK,
  PIPELINE_MAX_CONCURRENCY: process.env.PIPELINE_MAX_CONCURRENCY,
  PIPELINE_DEGRADED_CONCURRENCY: process.env.PIPELINE_DEGRADED_CONCURRENCY,
  PIPELINE_SUSPECTED_CONCURRENCY: process.env.PIPELINE_SUSPECTED_CONCURRENCY,
  PIPELINE_CANDIDATE_TIMEOUT_MS: process.env.PIPELINE_CANDIDATE_TIMEOUT_MS
};

afterEach(() => {
  process.env.DEFAULT_ANALYSIS_MODE = envSnapshot.DEFAULT_ANALYSIS_MODE;
  process.env.DEFAULT_PRICE_NORMALIZATION = envSnapshot.DEFAULT_PRICE_NORMALIZATION;
  process.env.DEFAULT_REPORT_SURFACE = envSnapshot.DEFAULT_REPORT_SURFACE;
  process.env.DEFAULT_AUTH_PROFILE = envSnapshot.DEFAULT_AUTH_PROFILE;
  process.env.ENABLE_LICENSED_INTEGRATIONS = envSnapshot.ENABLE_LICENSED_INTEGRATIONS;
  process.env.DEFAULT_LICENSED_INTEGRATIONS = envSnapshot.DEFAULT_LICENSED_INTEGRATIONS;
  process.env.TRANSPORT_MAX_ATTEMPTS = envSnapshot.TRANSPORT_MAX_ATTEMPTS;
  process.env.TRANSPORT_REQUEST_TIMEOUT_MS = envSnapshot.TRANSPORT_REQUEST_TIMEOUT_MS;
  process.env.TRANSPORT_CURL_FALLBACK = envSnapshot.TRANSPORT_CURL_FALLBACK;
  process.env.PIPELINE_MAX_CONCURRENCY = envSnapshot.PIPELINE_MAX_CONCURRENCY;
  process.env.PIPELINE_DEGRADED_CONCURRENCY = envSnapshot.PIPELINE_DEGRADED_CONCURRENCY;
  process.env.PIPELINE_SUSPECTED_CONCURRENCY = envSnapshot.PIPELINE_SUSPECTED_CONCURRENCY;
  process.env.PIPELINE_CANDIDATE_TIMEOUT_MS = envSnapshot.PIPELINE_CANDIDATE_TIMEOUT_MS;
});

describe("interactive env defaults", () => {
  it("resolves full research defaults from environment", () => {
    process.env.DEFAULT_ANALYSIS_MODE = "comprehensive";
    process.env.DEFAULT_PRICE_NORMALIZATION = "usd_dual";
    process.env.DEFAULT_REPORT_SURFACE = "web";
    process.env.DEFAULT_AUTH_PROFILE = "ops-default";
    process.env.ENABLE_LICENSED_INTEGRATIONS = "true";
    process.env.DEFAULT_LICENSED_INTEGRATIONS = "Sanatfiyat,askART";
    process.env.TRANSPORT_MAX_ATTEMPTS = "5";
    process.env.TRANSPORT_REQUEST_TIMEOUT_MS = "12000";
    process.env.TRANSPORT_CURL_FALLBACK = "false";
    process.env.PIPELINE_MAX_CONCURRENCY = "8";
    process.env.PIPELINE_DEGRADED_CONCURRENCY = "4";
    process.env.PIPELINE_SUSPECTED_CONCURRENCY = "2";
    process.env.PIPELINE_CANDIDATE_TIMEOUT_MS = "120000";

    const defaults = resolvePipelineDefaultsFromEnv();
    expect(defaults.analysisMode).toBe("comprehensive");
    expect(defaults.priceNormalization).toBe("usd_dual");
    expect(defaults.reportSurface).toBe("web");
    expect(defaults.authProfileId).toBe("ops-default");
    expect(defaults.allowLicensed).toBe(true);
    expect(defaults.licensedIntegrations).toEqual(["Sanatfiyat", "askART"]);
    expect(defaults.transportMaxAttempts).toBe(5);
    expect(defaults.transportRequestTimeoutMs).toBe(12000);
    expect(defaults.transportCurlFallback).toBe(false);
    expect(defaults.pipelineConcurrency).toEqual({ healthy: 8, degraded: 4, suspected: 2 });
    expect(defaults.pipelineCandidateTimeoutMs).toBe(120000);
  });

  it("normalizes invalid report surface values back to ask", () => {
    process.env.DEFAULT_REPORT_SURFACE = "wep";

    const defaults = resolvePipelineDefaultsFromEnv();

    expect(defaults.reportSurface).toBe("ask");
  });
});

describe("blocker triage", () => {
  it("picks transport outage as top blocker with host ranking", () => {
    const summary = summarizeAttemptBlockers([
      {
        source_url: "https://www.rportakal.com/search?q=abc",
        source_access_status: "blocked",
        blocker_reason: "transport:DNS_FAILED:node_fetch:www.rportakal.com",
        extracted_fields: {
          transport: { kind: "DNS_FAILED", host: "www.rportakal.com" }
        }
      },
      {
        source_url: "https://www.rportakal.com/search?q=def",
        source_access_status: "blocked",
        blocker_reason: "target_unreachable:host_circuit_open",
        extracted_fields: {
          transport: { kind: "UNKNOWN_NETWORK", host: "www.rportakal.com" }
        }
      },
      {
        source_url: "https://example.com/other",
        source_access_status: "auth_required",
        blocker_reason: "no authorized profile"
      }
    ]);

    expect(summary?.category).toBe("transport_outage");
    expect(summary?.count).toBe(2);
    expect(summary?.hosts[0]).toBe("www.rportakal.com");
  });

  it("returns null for empty attempt list", () => {
    expect(summarizeAttemptBlockers([])).toBeNull();
  });
});

describe("composer input key", () => {
  it("changes when submit nonce increments", () => {
    const keyA = buildComposerInputKey({
      overlay: "none",
      focusTarget: "composer",
      promptSymbol: "artbot",
      submitNonce: 0
    });
    const keyB = buildComposerInputKey({
      overlay: "none",
      focusTarget: "composer",
      promptSymbol: "artbot",
      submitNonce: 1
    });

    expect(keyA).not.toBe(keyB);
  });

  it("changes when overlay context changes", () => {
    const commandKey = buildComposerInputKey({
      overlay: "none",
      focusTarget: "composer",
      promptSymbol: "artbot",
      submitNonce: 1
    });
    const runsOverlayKey = buildComposerInputKey({
      overlay: "recent-runs",
      focusTarget: "overlay",
      promptSymbol: "runs",
      submitNonce: 1
    });

    expect(commandKey).not.toBe(runsOverlayKey);
  });
});
