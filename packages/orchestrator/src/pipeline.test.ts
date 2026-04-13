import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TransportErrorKind } from "@artbot/extraction";
import { ArtbotStorage } from "@artbot/storage";
import {
  HostCircuitRegistry,
  NetworkHealthTracker,
  ResearchOrchestrator,
  classifyFailureClass,
  insertDiscoveredCandidate,
  isOutageRelevantTransportKind,
  resolveConcurrencyForState,
  shouldQueueDiscoveredCandidate,
  shouldKeepRenderedDiscoveredUrl,
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

  it("filters rendered discovery noise but keeps relevant same-host candidates", () => {
    const query = {
      artist: "Abidin Dino",
      title: undefined
    } as any;

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://www.muzayede.app/abidin-dino17964.html",
        "https://www.muzayede.app/search?q=Abidin%20Dino",
        "muzayedeapp-platform",
        query
      )
    ).toBe(true);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://www.muzayede.app/giris21.html",
        "https://www.muzayede.app/search?q=Abidin%20Dino",
        "muzayedeapp-platform",
        query
      )
    ).toBe(false);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://www.muzayede.app/abidin-dino-firsat-muzayedesi-giris.html",
        "https://www.muzayede.app/search?q=Abidin%20Dino",
        "muzayedeapp-platform",
        query
      )
    ).toBe(false);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://www.instagram.com/muzayede.app",
        "https://www.muzayede.app/search?q=Abidin%20Dino",
        "muzayedeapp-platform",
        query
      )
    ).toBe(false);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://www.clarmuzayede.com/canli-muzayede/29122/modern-ve-cagdas-sanat-eserleri-muzayedesi",
        "https://www.clarmuzayede.com/arsiv?q=Abidin%20Dino",
        "clar-archive",
        query
      )
    ).toBe(true);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://sanatfiyat.com/artist/packages",
        "https://www.sanatfiyat.com/search?q=Abidin%20Dino",
        "sanatfiyat-licensed-extractor",
        query
      )
    ).toBe(false);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino",
        "https://www.sanatfiyat.com/search?q=Abidin%20Dino",
        "sanatfiyat-licensed-extractor",
        query
      )
    ).toBe(true);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://sanatfiyat.com/search/artist-detail/71/",
        "https://www.sanatfiyat.com/search?q=Abidin%20Dino",
        "sanatfiyat-licensed-extractor",
        query
      )
    ).toBe(false);

    expect(
      shouldKeepRenderedDiscoveredUrl(
        "https://sanatfiyat.com/artist/artwork-detail/138211/isimsiz",
        "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino",
        "sanatfiyat-licensed-extractor",
        query
      )
    ).toBe(true);
  });

  it("prioritizes higher-confidence discovered candidates within the same queue bucket", () => {
    const queue = [
      {
        url: "https://sanatfiyat.com/artist/artist-detail/71/",
        sourcePageType: "artist_page" as const,
        provenance: "listing_expansion" as const,
        score: 0.72,
        discoveredFromUrl: "https://www.sanatfiyat.com/search?q=Abidin%20Dino"
      },
      {
        url: "https://sanatfiyat.com/search?q=Abidin%20Dino",
        sourcePageType: "listing" as const,
        provenance: "seed" as const,
        score: 0.9,
        discoveredFromUrl: null
      }
    ];

    insertDiscoveredCandidate(queue, {
      url: "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino",
      sourcePageType: "artist_page",
      provenance: "listing_expansion",
      score: 0.98,
      discoveredFromUrl: "https://www.sanatfiyat.com/artist?q=Abidin%20Dino"
    });

    expect(queue.map((candidate) => candidate.url)).toEqual([
      "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino",
      "https://sanatfiyat.com/artist/artist-detail/71/",
      "https://sanatfiyat.com/search?q=Abidin%20Dino"
    ]);
  });

  it("drops discovered lot URLs whose slugs clearly conflict with the requested entity", () => {
    const query = {
      artist: "Abidin Dino",
      title: undefined
    } as any;

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.bayrakmuzayede.com/sultan-abdulhamid-han-donemi-gumus-5-kurus-para81011.html",
          sourcePageType: "lot",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.bayrakmuzayede.com/search?q=Abidin%20Dino"
        },
        query
      )
    ).toBe(false);

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.clarmuzayede.com/hemen-al/resim/9596",
          sourcePageType: "lot",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.clarmuzayede.com/hemen-al?q=Abidin%20Dino"
        },
        query
      )
    ).toBe(true);

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://sanatfiyat.com/artist/artwork-detail/138211/isimsiz",
          sourcePageType: "lot",
          provenance: "listing_expansion",
          score: 0.94,
          discoveredFromUrl: "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino"
        },
        query
      )
    ).toBe(true);

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.muzayede.app/tek-lotlu-abidin-dino-muzayedesi-icin-giris-yapin.html",
          sourcePageType: "lot",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.muzayede.app/search?q=Abidin%20Dino"
        },
        query
      )
    ).toBe(false);
  });

  it("drops discovered search URLs whose query params do not mention the requested entity", () => {
    const query = {
      artist: "Abidin Dino",
      title: undefined
    } as any;

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.bayrakmuzayede.com/arama.html?search_words=antika",
          sourcePageType: "listing",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.bayrakmuzayede.com/arama.html?search_words=Abidin%20Dino"
        },
        query
      )
    ).toBe(false);

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.bayrakmuzayede.com/arama.html?search_words=Abidin%20Dino",
          sourcePageType: "listing",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.bayrakmuzayede.com/arama.html?search_words=Abidin%20Dino"
        },
        query
      )
    ).toBe(true);
  });

  it("drops low-value discovered other pages unless they explicitly reference the requested entity", () => {
    const query = {
      artist: "Abidin Dino",
      title: undefined
    } as any;

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.rportakal.com/pages/tarihce",
          sourcePageType: "other",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.rportakal.com/search?q=Abidin%20Dino"
        },
        query
      )
    ).toBe(false);

    expect(
      shouldQueueDiscoveredCandidate(
        {
          url: "https://www.rportakal.com/pages/abidin-dino",
          sourcePageType: "other",
          provenance: "listing_expansion",
          score: 0.72,
          discoveredFromUrl: "https://www.rportakal.com/search?q=Abidin%20Dino"
        },
        query
      )
    ).toBe(true);
  });

  it("prioritizes discovered lot candidates ahead of queued query variants", () => {
    const queue = [
      {
        url: "https://example.com/search?q=Abidin%20Dino",
        sourcePageType: "listing" as const,
        provenance: "query_variant" as const,
        score: 0.8,
        discoveredFromUrl: null
      },
      {
        url: "https://example.com/search?q=Abidin%20Dino%20tablo",
        sourcePageType: "listing" as const,
        provenance: "query_variant" as const,
        score: 0.78,
        discoveredFromUrl: null
      }
    ];

    insertDiscoveredCandidate(queue, {
      url: "https://example.com/lot/abidin-dino-composition-1234",
      sourcePageType: "lot",
      provenance: "listing_expansion",
      score: 0.9,
      discoveredFromUrl: "https://example.com/search?q=Abidin%20Dino"
    });

    expect(queue[0]?.sourcePageType).toBe("lot");
    expect(queue[0]?.url).toContain("/lot/");
  });

  it("recovers through browser rendering when the wrapper timeout fires first", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-timeout-recovery-"));
    const storage = new ArtbotStorage(path.join(tempRoot, "artbot.db"), path.join(tempRoot, "runs"));
    const orchestrator = new ResearchOrchestrator(storage) as any;
    orchestrator.candidateTimeoutMs = 1;
    orchestrator.executeCandidateTask = () => new Promise(() => undefined);

    const evidenceDir = path.join(tempRoot, "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const rawSnapshotPath = path.join(evidenceDir, "sanatfiyat-timeout.html");
    const fixturePath = new URL("../../../data/fixtures/adapters/sanatfiyat/licensed.html", import.meta.url);
    fs.copyFileSync(fixturePath, rawSnapshotPath);

    orchestrator.browserClient = {
      discoverRenderedArtifacts: vi.fn(async () => ({
        finalUrl: "https://www.sanatfiyat.com/tr/sanatci/burhan-dogancay",
        screenshotPaths: [],
        rawSnapshotPaths: [rawSnapshotPath],
        discoveredUrls: [],
        discoveredImageUrls: [],
        pageCount: 1,
        requiresAuthDetected: false,
        blockedDetected: false
      }))
    };

    const task = {
      source: {
        planned: {
          adapter: {
            id: "sanatfiyat-licensed",
            sourceName: "Sanatfiyat",
            venueName: "Sanatfiyat",
            venueType: "database",
            sourcePageType: "listing",
            tier: 1,
            country: "Turkey",
            city: "Istanbul",
            requiresAuth: false,
            requiresLicense: true,
            supportedAccessModes: ["licensed"],
            crawlStrategies: ["rendered_dom"],
            capabilities: {
              version: "1",
              source_family: "sanatfiyat-licensed",
              access_modes: ["licensed"],
              browser_support: "required",
              sale_modes: ["realized"],
              evidence_requirements: ["raw_snapshot", "screenshot"],
              structured_data_likelihood: "high",
              preferred_discovery: "search"
            }
          },
          accessContext: {
            mode: "licensed",
            sourceAccessStatus: "licensed_access",
            accessReason: "Licensed session available.",
            blockerReason: null,
            profileId: undefined,
            manualLoginCheckpoint: false,
            cookieFile: undefined
          },
          candidates: []
        },
        sourceName: "Sanatfiyat",
        queue: [],
        seen: new Set<string>()
      },
      candidate: {
        url: "https://www.sanatfiyat.com/tr/sanatci/burhan-dogancay",
        sourcePageType: "listing",
        provenance: "query_variant",
        score: 0.8,
        discoveredFromUrl: null
      },
      host: "www.sanatfiyat.com"
    } as any;

    const run = {
      id: "run-timeout-recovery",
      runType: "artist",
      query: {
        artist: "Burhan Doğançay",
        title: undefined
      }
    } as any;

    const outcome = await orchestrator.executeCandidateTaskWithTimeout(task, run, "trace-timeout", evidenceDir);

    expect(orchestrator.browserClient.discoverRenderedArtifacts).toHaveBeenCalledTimes(1);
    expect(outcome.succeeded).toBe(true);
    expect(outcome.attempt.acceptance_reason).toBe("valuation_ready");
    expect(outcome.acceptedRecord?.price_amount).toBe(2100000);
    expect(outcome.acceptedRecord?.currency).toBe("TRY");
  });

  it("prefers the original task outcome when it settles during timeout recovery", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-timeout-grace-"));
    const storage = new ArtbotStorage(path.join(tempRoot, "artbot.db"), path.join(tempRoot, "runs"));
    const orchestrator = new ResearchOrchestrator(storage) as any;
    orchestrator.candidateTimeoutMs = 5;

    const task = {
      source: {
        planned: {
          adapter: {
            id: "slow-source",
            sourceName: "Slow Source",
            venueName: "Slow Source",
            venueType: "database",
            sourcePageType: "listing",
            tier: 2,
            country: "Turkey",
            city: "Istanbul",
            requiresAuth: false,
            requiresLicense: false,
            supportedAccessModes: ["anonymous"],
            crawlStrategies: ["rendered_dom"],
            capabilities: {
              version: "1",
              source_family: "slow-source",
              access_modes: ["anonymous"],
              browser_support: "required",
              sale_modes: ["realized"],
              evidence_requirements: ["raw_snapshot", "screenshot"],
              structured_data_likelihood: "high",
              preferred_discovery: "search"
            }
          },
          accessContext: {
            mode: "anonymous",
            sourceAccessStatus: "public_access",
            accessReason: "Public source access path.",
            blockerReason: null
          },
          candidates: []
        },
        sourceName: "Slow Source",
        queue: [],
        seen: new Set<string>()
      },
      candidate: {
        url: "https://example.com/lot/abidin-dino",
        sourcePageType: "listing",
        provenance: "seed",
        score: 0.9,
        discoveredFromUrl: null
      },
      host: "example.com"
    } as any;

    const run = {
      id: "run-timeout-grace",
      runType: "artist",
      query: {
        artist: "Abidin Dino",
        title: undefined
      }
    } as any;

    const originalOutcome = {
      task,
      attempt: {
        run_id: run.id,
        source_name: "Slow Source",
        source_url: task.candidate.url,
        canonical_url: task.candidate.url,
        access_mode: "anonymous",
        source_access_status: "public_access",
        failure_class: undefined,
        access_reason: "Public source access path.",
        blocker_reason: null,
        transport_kind: null,
        transport_provider: null,
        transport_host: null,
        transport_status_code: null,
        transport_retryable: null,
        extracted_fields: {},
        discovery_provenance: "seed",
        discovery_score: 0.9,
        discovered_from_url: null,
        screenshot_path: null,
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: null,
        trace_path: null,
        har_path: null,
        fetched_at: new Date().toISOString(),
        parser_used: "http-fetch",
        model_used: null,
        extraction_confidence: 0.8,
        entity_match_confidence: 0.8,
        source_reliability_confidence: 0.8,
        confidence_score: 0.82,
        accepted: true,
        accepted_for_evidence: true,
        accepted_for_valuation: true,
        valuation_lane: "realized",
        acceptance_reason: "valuation_ready",
        rejection_reason: null,
        valuation_eligibility_reason: null
      },
      acceptedRecord: {
        price_amount: 125000,
        currency: "TRY"
      },
      discoveredCandidates: [],
      succeeded: true
    } as any;

    orchestrator.executeCandidateTask = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return originalOutcome;
    });
    orchestrator.browserClient = {
      discoverRenderedArtifacts: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          finalUrl: task.candidate.url,
          screenshotPaths: [],
          rawSnapshotPaths: [],
          discoveredUrls: [],
          discoveredImageUrls: [],
          pageCount: 1,
          requiresAuthDetected: false,
          blockedDetected: false
        };
      })
    };

    const outcome = await orchestrator.executeCandidateTaskWithTimeout(task, run, "trace-timeout-grace", tempRoot);

    expect(outcome).toBe(originalOutcome);
    expect(orchestrator.browserClient.discoverRenderedArtifacts).toHaveBeenCalledTimes(1);
  });

  it("reclassifies accessible browser-recovered search pages away from blocked access", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-search-recovery-"));
    const storage = new ArtbotStorage(path.join(tempRoot, "artbot.db"), path.join(tempRoot, "runs"));
    const orchestrator = new ResearchOrchestrator(storage) as any;

    const rawSnapshotPath = path.join(tempRoot, "sanatfiyat-search.html");
    fs.writeFileSync(
      rawSnapshotPath,
      `
        <html>
          <head><title>sanatfiyat.com | Turk Ressamlari resim tablo fiyatlari</title></head>
          <body>
            <a href="https://sanatfiyat.com/search/login">Giris</a>
            <h3><a href="https://sanatfiyat.com/search/artist-detail/95/">Abidin Dino</a></h3>
            <div>Abidin Dino</div>
          </body>
        </html>
      `,
      "utf-8"
    );

    const task = {
      source: {
        planned: {
          adapter: {
            id: "sanatfiyat-licensed-extractor",
            sourceName: "Sanatfiyat",
            venueName: "Sanatfiyat",
            venueType: "database",
            sourcePageType: "price_db",
            tier: 2,
            country: "Turkey",
            city: "Istanbul",
            requiresAuth: true,
            requiresLicense: true,
            supportedAccessModes: ["licensed"],
            crawlStrategies: ["search", "listing_to_lot", "rendered_dom"],
            capabilities: {
              version: "1",
              source_family: "sanatfiyat",
              access_modes: ["licensed"],
              browser_support: "required",
              sale_modes: ["realized"],
              evidence_requirements: ["raw_snapshot", "screenshot"],
              structured_data_likelihood: "high",
              preferred_discovery: "search"
            }
          },
          accessContext: {
            mode: "licensed",
            profileId: "sanatfiyat-license",
            sourceAccessStatus: "licensed_access",
            accessReason: "Using operator-provided licensed integration.",
            blockerReason: null,
            licensedIntegrations: ["Sanatfiyat"]
          },
          candidates: []
        },
        sourceName: "Sanatfiyat",
        queue: [],
        seen: new Set<string>()
      },
      candidate: {
        url: "https://www.sanatfiyat.com/search?q=Abidin%20Dino",
        sourcePageType: "listing",
        provenance: "seed",
        score: 0.9,
        discoveredFromUrl: null
      },
      host: "www.sanatfiyat.com"
    } as any;

    const run = {
      id: "run-search-recovery",
      runType: "artist",
      query: {
        artist: "Abidin Dino",
        title: undefined
      }
    } as any;

    const result = {
      attempt: {
        run_id: run.id,
        source_name: "Sanatfiyat",
        source_url: task.candidate.url,
        canonical_url: task.candidate.url,
        access_mode: "licensed",
        source_access_status: "blocked",
        failure_class: "waf_challenge",
        access_reason: "Using operator-provided licensed integration.",
        blocker_reason: "Technical blocking detected.",
        transport_kind: null,
        transport_provider: null,
        transport_host: null,
        transport_status_code: null,
        transport_retryable: null,
        extracted_fields: {},
        discovery_provenance: "seed",
        discovery_score: 0.9,
        discovered_from_url: null,
        screenshot_path: null,
        pre_auth_screenshot_path: null,
        post_auth_screenshot_path: null,
        raw_snapshot_path: rawSnapshotPath,
        trace_path: null,
        har_path: null,
        fetched_at: new Date().toISOString(),
        parser_used: "browser",
        model_used: null,
        extraction_confidence: 0,
        entity_match_confidence: 0,
        source_reliability_confidence: 0,
        confidence_score: 0,
        accepted: false,
        accepted_for_evidence: false,
        accepted_for_valuation: false,
        valuation_lane: "none",
        acceptance_reason: "blocked_access",
        rejection_reason: "Access blocked or anti-bot page detected.",
        valuation_eligibility_reason: "Technical blocking detected."
      },
      record: null
    } as any;

    const recovered = orchestrator.tryRecoverPriceFromBrowserSnapshot(task, run, result, rawSnapshotPath);

    expect(recovered).toBeNull();
    expect(result.attempt.source_access_status).toBe("licensed_access");
    expect(result.attempt.failure_class).toBeUndefined();
    expect(result.attempt.acceptance_reason).toBe("generic_shell_page");
    expect(result.attempt.rejection_reason).toContain("Search/listing shell page");
  });

  it("marks licensed browser-recovered pages as blocked when gated content remains locked", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-licensed-gate-"));
    const storage = new ArtbotStorage(path.join(tempRoot, "artbot.db"), path.join(tempRoot, "runs"));
    const orchestrator = new ResearchOrchestrator(storage) as any;
    orchestrator.candidateTimeoutMs = 1;
    orchestrator.executeCandidateTask = () => new Promise(() => undefined);

    orchestrator.browserClient = {
      discoverRenderedArtifacts: vi.fn(async () => ({
        finalUrl: "https://www.sanatfiyat.com/artist/artist-detail/95/abidin-dino",
        screenshotPaths: [],
        rawSnapshotPaths: [],
        discoveredUrls: [],
        discoveredImageUrls: [],
        pageCount: 1,
        requiresAuthDetected: true,
        blockedDetected: false
      }))
    };

    const task = {
      source: {
        planned: {
          adapter: {
            id: "sanatfiyat-licensed-extractor",
            sourceName: "Sanatfiyat",
            venueName: "Sanatfiyat",
            venueType: "database",
            sourcePageType: "price_db",
            tier: 2,
            country: "Turkey",
            city: "Istanbul",
            requiresAuth: true,
            requiresLicense: true,
            supportedAccessModes: ["licensed"],
            crawlStrategies: ["rendered_dom"],
            capabilities: {
              version: "1",
              source_family: "sanatfiyat",
              access_modes: ["licensed"],
              browser_support: "required",
              sale_modes: ["realized"],
              evidence_requirements: ["raw_snapshot", "screenshot"],
              structured_data_likelihood: "high",
              preferred_discovery: "search"
            }
          },
          accessContext: {
            mode: "licensed",
            sourceAccessStatus: "licensed_access",
            accessReason: "Licensed session available.",
            blockerReason: null,
            profileId: "sanatfiyat-license",
            manualLoginCheckpoint: false,
            cookieFile: undefined
          },
          candidates: []
        },
        sourceName: "Sanatfiyat",
        queue: [],
        seen: new Set<string>()
      },
      candidate: {
        url: "https://www.sanatfiyat.com/artist/artist-detail/95/abidin-dino",
        sourcePageType: "price_db",
        provenance: "listing_expansion",
        score: 0.9,
        discoveredFromUrl: null
      },
      host: "www.sanatfiyat.com"
    } as any;

    const run = {
      id: "run-licensed-gated",
      runType: "artist",
      query: {
        artist: "Abidin Dino",
        title: undefined
      }
    } as any;

    const outcome = await orchestrator.executeCandidateTaskWithTimeout(task, run, "trace-gated", tempRoot);

    expect(outcome.succeeded).toBe(true);
    expect(outcome.attempt.source_access_status).toBe("blocked");
    expect(outcome.attempt.acceptance_reason).toBe("blocked_access");
    expect(outcome.attempt.rejection_reason).toContain("did not unlock gated content");
  });
});
