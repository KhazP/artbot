import { describe, expect, it } from "vitest";
import { TransportErrorKind } from "@artbot/extraction";
import {
  HostCircuitRegistry,
  NetworkHealthTracker,
  classifyFailureClass,
  isOutageRelevantTransportKind,
  resolveConcurrencyForState,
  shouldExitProcessingLoop,
  sourceAccessStatusForFailure
} from "./pipeline.js";

describe("HostCircuitRegistry", () => {
  it("trips only the failing host", () => {
    const registry = new HostCircuitRegistry(3);

    expect(registry.isTripped("a.example")).toBe(false);
    expect(registry.registerFailure("a.example")).toBe(false);
    expect(registry.registerFailure("a.example")).toBe(false);
    expect(registry.registerFailure("a.example")).toBe(true);
    expect(registry.isTripped("a.example")).toBe(true);
    expect(registry.isTripped("b.example")).toBe(false);
  });
});

describe("NetworkHealthTracker", () => {
  it("moves from HEALTHY to DEGRADED to OUTAGE_SUSPECTED", () => {
    const tracker = new NetworkHealthTracker(4, 6, 10);

    expect(tracker.current()).toBe("HEALTHY");
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    tracker.registerHealthySignal();
    tracker.registerOutageFailure();
    expect(tracker.current()).toBe("DEGRADED");

    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    expect(tracker.current()).toBe("OUTAGE_SUSPECTED");
  });

  it("confirms outage after consecutive failures threshold", () => {
    const tracker = new NetworkHealthTracker(4, 6, 3);
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    tracker.registerOutageFailure();
    expect(tracker.current()).toBe("OUTAGE_CONFIRMED");
  });
});

describe("pipeline helpers", () => {
  it("maps concurrency by network state", () => {
    const config = { healthy: 6, degraded: 3, suspected: 1 };
    expect(resolveConcurrencyForState("HEALTHY", config)).toBe(6);
    expect(resolveConcurrencyForState("DEGRADED", config)).toBe(3);
    expect(resolveConcurrencyForState("OUTAGE_SUSPECTED", config)).toBe(1);
    expect(resolveConcurrencyForState("OUTAGE_CONFIRMED", config)).toBe(6);
  });

  it("exits the processing loop once scheduling is stopped and no tasks remain", () => {
    expect(
      shouldExitProcessingLoop({
        hasPendingCandidates: true,
        activeTaskCount: 0,
        stopScheduling: true
      })
    ).toBe(true);
    expect(
      shouldExitProcessingLoop({
        hasPendingCandidates: true,
        activeTaskCount: 1,
        stopScheduling: true
      })
    ).toBe(false);
    expect(
      shouldExitProcessingLoop({
        hasPendingCandidates: false,
        activeTaskCount: 0,
        stopScheduling: false
      })
    ).toBe(true);
  });

  it("treats only transport-unreachable kinds as outage-relevant", () => {
    expect(isOutageRelevantTransportKind(TransportErrorKind.DNS_FAILED)).toBe(true);
    expect(isOutageRelevantTransportKind(TransportErrorKind.TCP_TIMEOUT)).toBe(true);
    expect(isOutageRelevantTransportKind(TransportErrorKind.RATE_LIMITED)).toBe(false);
    expect(isOutageRelevantTransportKind(TransportErrorKind.AUTH_INVALID)).toBe(false);
  });

  it("maps failure classes for dns/timeout/404/waf/host circuit", () => {
    const dns = classifyFailureClass({
      kind: TransportErrorKind.DNS_FAILED,
      provider: "curl",
      host: "example.com",
      statusCode: undefined,
      retryable: true
    } as any);
    expect(dns).toBe("transport_dns");

    const timeout = classifyFailureClass({
      kind: TransportErrorKind.TCP_TIMEOUT,
      provider: "node_fetch",
      host: "example.com",
      statusCode: undefined,
      retryable: true
    } as any);
    expect(timeout).toBe("transport_timeout");

    const notFound = classifyFailureClass({
      kind: TransportErrorKind.HTTP_ERROR,
      provider: "node_fetch",
      host: "example.com",
      statusCode: 404,
      retryable: false
    } as any);
    expect(notFound).toBe("not_found");

    const waf = classifyFailureClass({
      kind: TransportErrorKind.WAF_BLOCK,
      provider: "node_fetch",
      host: "example.com",
      statusCode: 403,
      retryable: false
    } as any);
    expect(waf).toBe("waf_challenge");

    const hostCircuit = classifyFailureClass(null, "target_unreachable:host_circuit_open");
    expect(hostCircuit).toBe("host_circuit");
  });

  it("does not map transport/not_found failures to blocked source status", () => {
    expect(sourceAccessStatusForFailure("not_found", "public_access")).toBe("public_access");
    expect(sourceAccessStatusForFailure("transport_timeout", "licensed_access")).toBe("licensed_access");
    expect(sourceAccessStatusForFailure("transport_dns", "blocked")).toBe("public_access");
    expect(sourceAccessStatusForFailure("waf_challenge", "public_access")).toBe("blocked");
  });
});
