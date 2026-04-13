import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Jimp } from "jimp";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "@artbot/browser-core";
import { logger } from "@artbot/observability";
import { applyConfidenceModel, FxRateProvider, normalizeRecordCurrencies } from "@artbot/normalization";
import {
  renderArtistMarketInventoryReport,
  renderClustersCsv,
  renderInventoryCsv,
  renderReviewQueueCsv,
  writeJsonFile
} from "@artbot/report-generation";
import {
  acceptanceReasonList,
  artistMarketInventorySummarySchema,
  crawlModeSchema,
  failureClassList,
  type ArtistMarketInventorySummary,
  type ArtworkCluster,
  type ArtworkImage,
  type ClusterMembership,
  type CrawlCheckpoint,
  type FrontierItem,
  type InventoryRecord,
  type PriceRecord,
  type PriceType,
  type ReviewItem,
  type RunEntity,
  type RunSummary,
  type SourceAccessStatus,
  type SourceAttempt,
  type SourceHost
} from "@artbot/shared-types";
import { type SourceCandidate, type SourceAdapter } from "@artbot/source-adapters";
import { buildDiscoveryConfigFromEnv, buildSourcePlanItems, planSources, SourceRegistry, type PlannedSource } from "@artbot/source-registry";
import { ArtbotStorage, artistKeyFromName, buildDefaultGcPolicyFromEnv, buildRunArtifactManifest, writeArtifactManifest } from "@artbot/storage";
import { buildEvaluationMetrics, buildRecommendedActions } from "./run-insights.js";

interface TargetImageFeatures {
  sha256: string;
  perceptualHash: string | null;
  embeddingVector: number[] | null;
}

interface PairDecision {
  action: "auto" | "review" | "none";
  confidence: number;
  reasons: string[];
}

interface ClusterBuildResult {
  clusters: ArtworkCluster[];
  memberships: ClusterMembership[];
  reviewItems: ReviewItem[];
  inventory: InventoryRecord[];
}

interface SourceRuntimeStats {
  sourceName: string;
  host: string;
  seedUrl: string | null;
  discoveredCount: number;
  newRecords: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function inferSourcePageType(url: string): FrontierItem["source_page_type"] {
  const lower = url.toLowerCase();
  if (/(\/lot\/|\/lots\/|\/auction\/lot|\/auction-lot\/|\/item\/\d+|\/lot-)/.test(lower)) return "lot";
  if (/(\/artist\/|\/artists\/)/.test(lower)) return "artist_page";
  if (/(\/catalog|\/arsiv|\/archive|\/search|\/arama|page=)/.test(lower)) return "listing";
  return "other";
}

function semanticLaneForPriceType(priceType: PriceType): InventoryRecord["semantic_lane"] {
  if (priceType === "asking_price") return "asking";
  if (priceType === "estimate") return "estimate";
  if (priceType === "hammer_price" || priceType === "realized_price" || priceType === "realized_with_buyers_premium") {
    return "realized";
  }
  if (priceType === "inquiry_only") return "inquiry";
  return "unknown";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numericStats(values: number[]): { count: number; min: number | null; avg: number | null; max: number | null } {
  if (values.length === 0) {
    return { count: 0, min: null, avg: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    avg: average(sorted),
    max: sorted[sorted.length - 1] ?? null
  };
}

function isDiscoveryBackedRecord(record: Pick<PriceRecord, "notes">): boolean {
  return record.notes.some((note) => note.startsWith("discovery:") && note !== "discovery:seed");
}

function buildRecordKey(record: PriceRecord, canonicalUrl: string): string {
  return createHash("sha1")
    .update(
      [
        normalizeText(record.artist_name),
        normalizeText(record.work_title),
        record.source_name,
        canonicalUrl,
        record.lot_number ?? "",
        record.sale_or_listing_date ?? "",
        record.price_type,
        record.price_amount ?? "",
        record.currency ?? ""
      ].join("|")
    )
    .digest("hex");
}

function titleSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0.45;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function mediumCompatible(left: PriceRecord, right: PriceRecord): boolean {
  const a = normalizeText(left.medium);
  const b = normalizeText(right.medium);
  return !a || !b || a === b;
}

function yearCompatible(left: PriceRecord, right: PriceRecord): boolean {
  if (!left.year || !right.year) return true;
  return left.year === right.year;
}

function dimensionsCompatible(left: PriceRecord, right: PriceRecord): boolean {
  const dimensions = (record: PriceRecord): [number | null, number | null] => {
    if (record.height_cm && record.width_cm) {
      return [record.height_cm, record.width_cm];
    }
    const match = record.dimensions_text?.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (!match) return [null, null];
    return [Number(match[1].replace(",", ".")), Number(match[2].replace(",", "."))];
  };

  const [leftH, leftW] = dimensions(left);
  const [rightH, rightW] = dimensions(right);
  if (!leftH || !leftW || !rightH || !rightW) return true;
  const tolerance = 0.08;
  return (
    Math.abs(leftH - rightH) / Math.max(leftH, rightH) <= tolerance &&
    Math.abs(leftW - rightW) / Math.max(leftW, rightW) <= tolerance
  );
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftMagnitude += l * l;
    rightMagnitude += r * r;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function priceValueForStats(record: InventoryRecord): number | null {
  const value = record.payload.normalized_price_try ?? record.payload.price_amount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickExtension(contentType: string | null, imageUrl: string): string {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("bmp")) return ".bmp";
  const pathname = (() => {
    try {
      return new URL(imageUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const known = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];
  return known.find((extension) => pathname.endsWith(extension)) ?? ".jpg";
}

async function computeImageFeatures(buffer: Buffer): Promise<{
  perceptualHash: string | null;
  embeddingVector: number[] | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const image = await Jimp.read(buffer);
    const normalized = image.clone().resize({ w: 8, h: 8 }).greyscale();
    const vector: number[] = [];
    for (let index = 0; index < normalized.bitmap.data.length; index += 4) {
      const red = normalized.bitmap.data[index] ?? 0;
      vector.push(Number((red / 255).toFixed(6)));
    }

    return {
      perceptualHash: image.hash(),
      embeddingVector: vector,
      width: image.bitmap.width,
      height: image.bitmap.height
    };
  } catch {
    return {
      perceptualHash: null,
      embeddingVector: null,
      width: null,
      height: null
    };
  }
}

export class ArtistMarketInventoryOrchestrator {
  constructor(
    private readonly storage: ArtbotStorage,
    private readonly registry: SourceRegistry,
    private readonly authManager: AuthManager,
    private readonly browserClient: BrowserClient,
    private readonly fxRates: FxRateProvider
  ) {}

  public async processRun(run: RunEntity): Promise<void> {
    const traceId = `market_${run.id.slice(0, 8)}`;
    const runRoot = this.storage.getRunRoot(run.id);
    const evidenceDir = path.join(runRoot, "evidence");
    const exportsDir = path.join(runRoot, "exports");
    const artistKey = artistKeyFromName(run.query.artist);
    const crawlMode = crawlModeSchema.parse(run.query.crawlMode ?? "backfill");

    logger.info("Starting artist market inventory run", {
      traceId,
      runId: run.id,
      artist: run.query.artist,
      crawlMode
    });

    const targetFeatures = await this.loadTargetImageFeatures(run.query.imagePath);
    const plannedSources = await this.planInventorySources(run);
    const sourcePlan = buildSourcePlanItems(
      plannedSources,
      buildDiscoveryConfigFromEnv(run.query.analysisMode).maxCandidatesPerSource,
      run.query.analysisMode
    );
    const selectedSourceIds = new Set(
      sourcePlan.filter((item) => item.selection_state === "selected").map((item) => item.adapter_id)
    );
    const sourceRuntime = new Map<string, SourceRuntimeStats>();
    const sourceContexts = new Map<string, { planned: PlannedSource; host: string }>();
    const gaps: string[] = [];
    let discoveredHosts = 0;

    for (const planned of plannedSources.filter((entry) => selectedSourceIds.has(entry.adapter.id))) {
      const seedHost = hostFromUrl(planned.candidates[0]?.url ?? "");
      if (!seedHost) {
        continue;
      }

      const checkpoint = this.storage.getCrawlCheckpoint(artistKey, seedHost, "default");
      if (
        crawlMode === "refresh" &&
        checkpoint &&
        checkpoint.consecutive_unchanged_windows >= 2 &&
        this.wasRecentlyCrawled(checkpoint.last_seen_at)
      ) {
        gaps.push(`${planned.adapter.sourceName}: skipped refresh seed due to stable checkpoint.`);
        continue;
      }

      this.storage.upsertSourceHost(this.toSourceHost(planned, seedHost));
      if (!sourceRuntime.has(seedHost)) {
        discoveredHosts += 1;
        sourceRuntime.set(seedHost, {
          sourceName: planned.adapter.sourceName,
          host: seedHost,
          seedUrl: planned.candidates[0]?.url ?? null,
          discoveredCount: 0,
          newRecords: 0
        });
      }
      sourceContexts.set(planned.adapter.id, { planned, host: seedHost });

      for (const candidate of planned.candidates) {
        this.enqueueCandidate(run, artistKey, planned, seedHost, candidate);
      }
    }

    const attempts: SourceAttempt[] = [];
    const currentRunRecords: PriceRecord[] = [];

    while (true) {
      const [frontier] = this.storage.listPendingFrontier(run.id, 1);
      if (!frontier) {
        break;
      }

      this.storage.markFrontierProcessing(frontier.id);
      const sourceContext = sourceContexts.get(frontier.adapter_id);
      if (!sourceContext) {
        this.storage.markFrontierSkipped(frontier.id, `Missing adapter context for ${frontier.adapter_id}`);
        gaps.push(`Skipped ${frontier.url} because adapter context was unavailable.`);
        continue;
      }

      const candidate: SourceCandidate = {
        url: frontier.url,
        sourcePageType: frontier.source_page_type,
        provenance: frontier.provenance,
        score: frontier.score,
        discoveredFromUrl: frontier.discovered_from_url
      };

      try {
        const result = await sourceContext.planned.adapter.extract(candidate, {
          runId: run.id,
          traceId,
          query: run.query,
          accessContext: sourceContext.planned.accessContext,
          evidenceDir
        });

        let renderedArtifacts = null;
        if (
          sourceContext.planned.adapter.crawlStrategies.includes("rendered_dom") ||
          frontier.source_page_type !== "lot" ||
          result.needsBrowserVerification
        ) {
          renderedArtifacts = await this.browserClient.discoverRenderedArtifacts({
            traceId,
            sourceName: sourceContext.planned.adapter.sourceName,
            url: frontier.url,
            runId: run.id,
            evidenceDir,
            accessContext: sourceContext.planned.accessContext,
            maxPages: frontier.source_page_type === "listing" ? 4 : 2
          });
        }

        const attempt = {
          ...result.attempt,
          screenshot_path: result.attempt.screenshot_path ?? renderedArtifacts?.screenshotPaths[0] ?? null,
          raw_snapshot_path: result.attempt.raw_snapshot_path ?? renderedArtifacts?.rawSnapshotPaths[0] ?? null
        } satisfies SourceAttempt;
        attempts.push(attempt);
        this.storage.saveAttempt(run.id, attempt);

        if (result.record) {
          let normalized = applyConfidenceModel(await normalizeRecordCurrencies(result.record, this.fxRates));
          if (!normalized.image_url && renderedArtifacts?.discoveredImageUrls[0]) {
            normalized = {
              ...normalized,
              image_url: renderedArtifacts.discoveredImageUrls[0]
            };
          }

          const canonicalUrl = attempt.canonical_url ?? frontier.url;
          const recordKey = buildRecordKey(normalized, canonicalUrl);
          const image = normalized.image_url
            ? await this.captureArtworkImage({
                run,
                runRoot,
                artistKey,
                recordKey,
                sourceUrl: canonicalUrl,
                imageUrl: normalized.image_url
              })
            : null;

          if (image?.image.embedding_vector && targetFeatures?.embeddingVector) {
            normalized = {
              ...normalized,
              visual_match_score: Number(
                cosineSimilarity(image.image.embedding_vector, targetFeatures.embeddingVector).toFixed(4)
              )
            };
          }

          this.storage.saveRecord(run.id, normalized);
          currentRunRecords.push(normalized);
          const saved = this.storage.upsertInventoryRecord({
            run_id: run.id,
            artist_key: artistKey,
            record_key: recordKey,
            source_host: frontier.source_host,
            semantic_lane: semanticLaneForPriceType(normalized.price_type),
            cluster_id: null,
            payload: normalized
          });

          if (image) {
            this.storage.upsertArtworkImage({
              run_id: run.id,
              artist_key: artistKey,
              record_key: recordKey,
              source_url: canonicalUrl,
              image_url: image.image.image_url,
              stored_path: image.image.stored_path,
              sha256: image.image.sha256,
              perceptual_hash: image.image.perceptual_hash,
              embedding_vector: image.image.embedding_vector,
              width: image.image.width,
              height: image.image.height,
              mime_type: image.image.mime_type,
              bytes: image.image.bytes
            });
          }

          if (saved.inserted) {
            sourceRuntime.get(frontier.source_host)!.newRecords += 1;
          }
        }

        const renderedCandidates = (renderedArtifacts?.discoveredUrls ?? []).map((url) =>
          this.toDiscoveredCandidate(url, frontier.url)
        );

        for (const discoveredCandidate of [...(result.discoveredCandidates ?? []), ...renderedCandidates]) {
          const host = hostFromUrl(discoveredCandidate.url);
          if (!host) continue;
          const hostRecord = this.storage.getSourceHost(host) ?? this.storage.upsertSourceHost(this.toSourceHost(sourceContext.planned, host, "discovered"));
          if (!sourceContexts.has(sourceContext.planned.adapter.id) || sourceContext.host === frontier.source_host) {
            sourceContexts.set(sourceContext.planned.adapter.id, sourceContext);
          }
          if (!sourceRuntime.has(host)) {
            discoveredHosts += 1;
            sourceRuntime.set(host, {
              sourceName: hostRecord.source_name,
              host,
              seedUrl: discoveredCandidate.discoveredFromUrl ?? discoveredCandidate.url,
              discoveredCount: 0,
              newRecords: 0
            });
          }
          sourceRuntime.get(host)!.discoveredCount += 1;
          this.enqueueCandidate(run, artistKey, sourceContext.planned, host, discoveredCandidate);
        }

        this.storage.markFrontierCompleted(frontier.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(this.buildFailureAttempt(run, frontier, sourceContext.planned.accessContext.sourceAccessStatus, message));
        this.storage.saveAttempt(run.id, attempts[attempts.length - 1]!);
        this.storage.markFrontierFailed(frontier.id, message);
        gaps.push(`${sourceContext.planned.adapter.sourceName}: ${message}`);
      }
    }

    this.persistCheckpoints(run, artistKey, sourceRuntime, crawlMode);

    const clustered = await this.buildClusters(run, targetFeatures);
    const inventorySummary = this.buildInventorySummary(
      run,
      artistKey,
      clustered.inventory,
      this.storage.listArtworkImagesByArtist(artistKey),
      discoveredHosts,
      clustered.clusters,
      clustered.reviewItems,
      gaps,
      sourceRuntime
    );
    const persistedHostHealth = this.storage.listHostHealth(12);
    const summary = this.buildRunSummary(run, attempts, currentRunRecords, clustered, inventorySummary, sourcePlan, persistedHostHealth);
    const evaluationMetrics = summary.evaluation_metrics;
    const recommendedActions = buildRecommendedActions({
      sourcePlan,
      attempts,
      acceptedRecords: summary.accepted_records,
      discoveredCandidates: summary.discovered_candidates,
      hostHealth: persistedHostHealth,
      evaluationMetrics
    });

    this.storage.replaceClustersForArtist(artistKey, clustered.clusters, clustered.memberships, clustered.reviewItems);
    for (const record of clustered.inventory) {
      this.storage.upsertInventoryRecord(record);
    }

    const inventoryPath = path.join(runRoot, "inventory.json");
    const clustersPath = path.join(runRoot, "clusters.json");
    const reviewQueuePath = path.join(runRoot, "review-queue.json");
    const resultsPath = path.join(runRoot, "results.json");
    const reportPath = path.join(runRoot, "report.md");
    const inventoryCsvPath = path.join(exportsDir, "inventory.csv");
    const clustersCsvPath = path.join(exportsDir, "clusters.csv");
    const reviewCsvPath = path.join(exportsDir, "review-queue.csv");
    const sourceHosts = this.storage
      .listSourceHosts()
      .filter((sourceHost) => sourceRuntime.has(sourceHost.host));
    const checkpoints = this.storage.listCrawlCheckpointsForArtist(artistKey);

    writeJsonFile(inventoryPath, clustered.inventory);
    writeJsonFile(clustersPath, {
      clusters: clustered.clusters,
      memberships: clustered.memberships
    });
    writeJsonFile(reviewQueuePath, clustered.reviewItems);
    fs.writeFileSync(
      reportPath,
      renderArtistMarketInventoryReport({
        artist: run.query.artist,
        summary: inventorySummary,
        inventory: clustered.inventory,
        clusters: clustered.clusters,
        memberships: clustered.memberships,
        reviewItems: clustered.reviewItems
      }),
      "utf-8"
    );
    fs.writeFileSync(inventoryCsvPath, renderInventoryCsv(clustered.inventory), "utf-8");
    fs.writeFileSync(clustersCsvPath, renderClustersCsv(clustered.clusters), "utf-8");
    fs.writeFileSync(reviewCsvPath, renderReviewQueueCsv(clustered.reviewItems), "utf-8");

    writeJsonFile(resultsPath, {
      run,
      summary,
      source_plan: sourcePlan,
      recommended_actions: recommendedActions,
      persisted_source_health: persistedHostHealth,
      inventory_summary: inventorySummary,
      inventory: clustered.inventory,
      clusters: clustered.clusters,
      cluster_memberships: clustered.memberships,
      review_queue: clustered.reviewItems,
      source_hosts: sourceHosts,
      checkpoints,
      artifacts: {
        report_path: reportPath,
        inventory_path: inventoryPath,
        clusters_path: clustersPath,
        review_queue_path: reviewQueuePath,
        inventory_csv_path: inventoryCsvPath,
        clusters_csv_path: clustersCsvPath,
        review_queue_csv_path: reviewCsvPath
      }
    });

    const artifactManifest = buildRunArtifactManifest({
      runId: run.id,
      runRoot,
      reportPath,
      resultsPath,
      attempts,
      extraPaths: [inventoryPath, clustersPath, reviewQueuePath, inventoryCsvPath, clustersCsvPath, reviewCsvPath],
      policy: buildDefaultGcPolicyFromEnv()
    });
    writeArtifactManifest(runRoot, artifactManifest);

    this.storage.completeRun(run.id, reportPath, resultsPath);
  }

  private async planInventorySources(run: RunEntity): Promise<PlannedSource[]> {
    const allowedClasses = new Set(run.query.sourceClasses ?? ["auction_house", "gallery", "dealer", "marketplace", "database"]);
    const adapters = this.registry.list().filter((adapter) => allowedClasses.has(adapter.venueType));
    return planSources(run.query, adapters, this.authManager, this.storage.listHostHealth(50));
  }

  private toSourceHost(planned: PlannedSource, host: string, mode: SourceHost["host_status"] = "seeded"): Omit<SourceHost, "id" | "created_at" | "updated_at"> {
    const accessMode: SourceHost["auth_mode"] =
      planned.adapter.requiresLicense ? "licensed" : planned.adapter.requiresAuth ? "authorized" : "public";
    const now = new Date().toISOString();
    return {
      host,
      source_name: planned.adapter.sourceName,
      venue_name: planned.adapter.venueName,
      source_class: planned.adapter.venueType,
      host_status: mode,
      trust_tier: planned.adapter.tier <= 2 ? "formal" : "validated",
      auth_mode: accessMode,
      crawl_strategies: planned.adapter.crawlStrategies,
      base_url: `https://${host}`,
      country: planned.adapter.country,
      last_crawled_at: null,
      last_success_at: null
    };
  }

  private enqueueCandidate(
    run: RunEntity,
    artistKey: string,
    planned: PlannedSource,
    sourceHost: string,
    candidate: SourceCandidate
  ): void {
    this.storage.enqueueFrontierItem({
      run_id: run.id,
      artist_key: artistKey,
      source_host: sourceHost,
      adapter_id: planned.adapter.id,
      source_name: planned.adapter.sourceName,
      url: candidate.url,
      source_page_type: candidate.sourcePageType,
      provenance: candidate.provenance,
      score: candidate.score,
      discovered_from_url: candidate.discoveredFromUrl ?? null
    });
  }

  private toDiscoveredCandidate(url: string, discoveredFromUrl: string): SourceCandidate {
    return {
      url,
      sourcePageType: inferSourcePageType(url),
      provenance: "listing_expansion",
      score: 0.72,
      discoveredFromUrl
    };
  }

  private buildFailureAttempt(
    run: RunEntity,
    frontier: FrontierItem,
    sourceAccessStatus: SourceAccessStatus,
    error: string
  ): SourceAttempt {
    return {
      run_id: run.id,
      source_name: frontier.source_name,
      source_url: frontier.url,
      canonical_url: frontier.url,
      access_mode: "anonymous",
      source_access_status: sourceAccessStatus,
      failure_class: "transport_other",
      access_reason: error,
      blocker_reason: error,
      transport_kind: null,
      transport_provider: null,
      transport_host: frontier.source_host,
      transport_status_code: null,
      transport_retryable: false,
      extracted_fields: {},
      discovery_provenance: frontier.provenance,
      discovery_score: frontier.score,
      discovered_from_url: frontier.discovered_from_url,
      screenshot_path: null,
      pre_auth_screenshot_path: null,
      post_auth_screenshot_path: null,
      raw_snapshot_path: null,
      trace_path: null,
      har_path: null,
      fetched_at: new Date().toISOString(),
      parser_used: "none",
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
      rejection_reason: error,
      valuation_eligibility_reason: error
    };
  }

  private async captureArtworkImage(args: {
    run: RunEntity;
    runRoot: string;
    artistKey: string;
    recordKey: string;
    sourceUrl: string;
    imageUrl: string;
  }): Promise<{ image: Omit<ArtworkImage, "id" | "created_at" | "updated_at"> } | null> {
    try {
      const response = await fetch(args.imageUrl);
      if (!response.ok) {
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const contentType = response.headers.get("content-type");
      const extension = pickExtension(contentType, args.imageUrl);
      const storedPath = path.join(args.runRoot, "images", `${args.recordKey}${extension}`);
      fs.writeFileSync(storedPath, buffer);
      const features = await computeImageFeatures(buffer);

      return {
        image: {
          run_id: args.run.id,
          artist_key: args.artistKey,
          record_key: args.recordKey,
          source_url: args.sourceUrl,
          image_url: args.imageUrl,
          stored_path: storedPath,
          sha256,
          perceptual_hash: features.perceptualHash,
          embedding_vector: features.embeddingVector,
          width: features.width,
          height: features.height,
          mime_type: contentType,
          bytes: buffer.length
        }
      };
    } catch {
      return null;
    }
  }

  private async loadTargetImageFeatures(imagePath?: string): Promise<TargetImageFeatures | null> {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return null;
    }
    const buffer = fs.readFileSync(imagePath);
    const features = await computeImageFeatures(buffer);
    return {
      sha256: createHash("sha256").update(buffer).digest("hex"),
      perceptualHash: features.perceptualHash,
      embeddingVector: features.embeddingVector
    };
  }

  private wasRecentlyCrawled(lastSeenAt: string): boolean {
    const deltaMs = Date.now() - new Date(lastSeenAt).getTime();
    return deltaMs < 14 * 24 * 60 * 60 * 1000;
  }

  private persistCheckpoints(
    run: RunEntity,
    artistKey: string,
    sourceRuntime: Map<string, SourceRuntimeStats>,
    crawlMode: "backfill" | "refresh"
  ): void {
    const now = new Date().toISOString();
    for (const runtime of sourceRuntime.values()) {
      const existing = this.storage.getCrawlCheckpoint(artistKey, runtime.host, "default");
      const unchanged = runtime.newRecords === 0 ? (existing?.consecutive_unchanged_windows ?? 0) + 1 : 0;
      const payload: Omit<CrawlCheckpoint, "id" | "updated_at"> = {
        artist_key: artistKey,
        source_host: runtime.host,
        section_key: "default",
        url: runtime.seedUrl ?? `https://${runtime.host}`,
        source_page_type: "listing",
        crawl_mode: crawlMode,
        consecutive_unchanged_windows: unchanged,
        last_discovered_count: runtime.discoveredCount,
        last_record_count: runtime.newRecords,
        last_seen_at: now,
        last_changed_at: runtime.newRecords > 0 ? now : existing?.last_changed_at ?? null
      };
      this.storage.upsertCrawlCheckpoint(payload);
    }
  }

  private async buildClusters(run: RunEntity, targetFeatures: TargetImageFeatures | null): Promise<ClusterBuildResult> {
    const artistKey = artistKeyFromName(run.query.artist);
    const inventory = this.storage.listInventoryRecordsByArtist(artistKey);
    const images = this.storage.listArtworkImagesByArtist(artistKey);
    const imageByRecord = new Map(images.map((image) => [image.record_key, image]));
    const parent = new Map<string, string>();

    for (const record of inventory) {
      parent.set(record.record_key, record.record_key);
    }

    const find = (key: string): string => {
      const current = parent.get(key);
      if (!current || current === key) return key;
      const resolved = find(current);
      parent.set(key, resolved);
      return resolved;
    };
    const union = (left: string, right: string): void => {
      const a = find(left);
      const b = find(right);
      if (a !== b) {
        parent.set(b, a);
      }
    };

    const reviewItems: ReviewItem[] = [];
    const seenReviewPairs = new Set<string>();

    for (let leftIndex = 0; leftIndex < inventory.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < inventory.length; rightIndex += 1) {
        const left = inventory[leftIndex]!;
        const right = inventory[rightIndex]!;
        const decision = await this.compareInventoryPair(left, right, imageByRecord.get(left.record_key) ?? null, imageByRecord.get(right.record_key) ?? null);
        if (decision.action === "auto") {
          union(left.record_key, right.record_key);
          continue;
        }

        if (decision.action === "review") {
          const pairKey = [left.record_key, right.record_key].sort().join("::");
          if (!seenReviewPairs.has(pairKey)) {
            seenReviewPairs.add(pairKey);
            reviewItems.push({
              id: uuid(),
              run_id: run.id,
              artist_key: artistKey,
              review_type: "cluster_match",
              status: "pending",
              left_record_key: left.record_key,
              right_record_key: right.record_key,
              recommended_action: "keep_separate",
              confidence: decision.confidence,
              reasons: decision.reasons,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }
      }
    }

    const grouped = new Map<string, InventoryRecord[]>();
    for (const record of inventory) {
      const root = find(record.record_key);
      const list = grouped.get(root) ?? [];
      list.push(record);
      grouped.set(root, list);
    }

    const clusters: ArtworkCluster[] = [];
    const memberships: ClusterMembership[] = [];
    const updatedInventory: InventoryRecord[] = [];

    for (const members of grouped.values()) {
      const clusterId = uuid();
      const recordCount = members.length;
      const primary = members
        .slice()
        .sort((left, right) => (right.payload.visual_match_score ?? 0) - (left.payload.visual_match_score ?? 0))[0]!;
      const autoMatchCount = Math.max(0, recordCount - 1);
      const clusterStatus = autoMatchCount > 0 ? "auto_confirmed" : "confirmed";
      const confidence = Number(
        (average(
          members.map((record) => {
            const image = imageByRecord.get(record.record_key);
            const targetScore =
              targetFeatures && image?.embedding_vector
                ? cosineSimilarity(image.embedding_vector, targetFeatures.embeddingVector)
                : record.payload.visual_match_score ?? record.payload.overall_confidence;
            return targetScore ?? record.payload.overall_confidence;
          })
        ) ?? 0.72).toFixed(4)
      );

      clusters.push({
        id: clusterId,
        run_id: run.id,
        artist_key: artistKey,
        title: primary.payload.work_title ?? "Untitled",
        year: primary.payload.year,
        medium: primary.payload.medium,
        cluster_status: clusterStatus,
        confidence,
        record_count: recordCount,
        auto_match_count: autoMatchCount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      for (const member of members) {
        memberships.push({
          id: uuid(),
          run_id: run.id,
          artist_key: artistKey,
          cluster_id: clusterId,
          record_key: member.record_key,
          status: clusterStatus,
          confidence,
          reasons: autoMatchCount > 0 ? ["strict_exact_work_match"] : ["single_record_cluster"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        updatedInventory.push({
          ...member,
          cluster_id: clusterId,
          updated_at: new Date().toISOString()
        });
      }
    }

    return {
      clusters,
      memberships,
      reviewItems,
      inventory: updatedInventory
    };
  }

  private async compareInventoryPair(
    left: InventoryRecord,
    right: InventoryRecord,
    leftImage: ArtworkImage | null,
    rightImage: ArtworkImage | null
  ): Promise<PairDecision> {
    const reasons: string[] = [];
    const titleScore = titleSimilarity(left.payload.work_title, right.payload.work_title);
    const mediumOk = mediumCompatible(left.payload, right.payload);
    const yearOk = yearCompatible(left.payload, right.payload);
    const dimensionsOk = dimensionsCompatible(left.payload, right.payload);

    if (!mediumOk) {
      return { action: "none", confidence: 0.02, reasons: ["medium_conflict"] };
    }
    if (!yearOk) {
      return { action: "none", confidence: 0.02, reasons: ["year_conflict"] };
    }
    if (!dimensionsOk) {
      return { action: "none", confidence: 0.02, reasons: ["dimension_conflict"] };
    }

    if (leftImage?.sha256 && rightImage?.sha256 && leftImage.sha256 === rightImage.sha256) {
      reasons.push("identical_image_sha256");
      return {
        action: titleScore >= 0.45 ? "auto" : "review",
        confidence: titleScore >= 0.45 ? 0.99 : 0.78,
        reasons
      };
    }

    const perceptualMatch =
      leftImage?.perceptual_hash && rightImage?.perceptual_hash && leftImage.perceptual_hash === rightImage.perceptual_hash;
    const vectorSimilarity = cosineSimilarity(leftImage?.embedding_vector ?? null, rightImage?.embedding_vector ?? null);
    if (perceptualMatch) {
      reasons.push("identical_perceptual_hash");
    }
    if (vectorSimilarity > 0.98) {
      reasons.push(`image_similarity:${vectorSimilarity.toFixed(3)}`);
    }
    if (titleScore > 0.8) {
      reasons.push(`title_similarity:${titleScore.toFixed(2)}`);
    }

    const strongImageSignal = perceptualMatch || vectorSimilarity > 0.995;
    if (strongImageSignal && titleScore >= 0.72) {
      return {
        action: "auto",
        confidence: Number(Math.max(0.9, vectorSimilarity).toFixed(4)),
        reasons
      };
    }

    if ((perceptualMatch || vectorSimilarity > 0.98) && titleScore >= 0.45) {
      const adjudication = await this.adjudicateBorderlinePair(left, right, reasons);
      return {
        action: "review",
        confidence: adjudication?.confidence ?? Number(Math.max(vectorSimilarity, 0.74).toFixed(4)),
        reasons: adjudication?.reasons ?? reasons
      };
    }

    return {
      action: "none",
      confidence: Number(Math.max(titleScore, vectorSimilarity).toFixed(4)),
      reasons: reasons.length > 0 ? reasons : ["insufficient_exact_work_signal"]
    };
  }

  private async adjudicateBorderlinePair(
    left: InventoryRecord,
    right: InventoryRecord,
    reasons: string[]
  ): Promise<{ confidence: number; reasons: string[] } | null> {
    const baseUrl = process.env.LLM_BASE_URL?.trim();
    if (!baseUrl) {
      return null;
    }

    try {
      const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      const headers: Record<string, string> = {
        "content-type": "application/json"
      };
      if (process.env.LLM_API_KEY) {
        headers.authorization = `Bearer ${process.env.LLM_API_KEY}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: process.env.MODEL_CHEAP_DEFAULT ?? "google/gemma-4-26b-a4b",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Return JSON only. Summarize whether two art market records may depict the same exact artwork. Never authorize an auto-merge."
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  left: left.payload,
                  right: right.payload,
                  current_reasons: reasons
                },
                null,
                2
              )
            }
          ]
        })
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)) as {
        confidence?: number;
        reasons?: string[];
      };
      return {
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.74,
        reasons: Array.isArray(parsed.reasons) && parsed.reasons.length > 0 ? parsed.reasons : reasons
      };
    } catch {
      return null;
    }
  }

  private buildInventorySummary(
    run: RunEntity,
    artistKey: string,
    inventory: InventoryRecord[],
    images: ArtworkImage[],
    discoveredHosts: number,
    clusters: ArtworkCluster[],
    reviewItems: ReviewItem[],
    gaps: string[],
    sourceRuntime: Map<string, SourceRuntimeStats>
  ): ArtistMarketInventorySummary {
    const priceTypeBreakdown: ArtistMarketInventorySummary["price_type_breakdown"] = {
      asking_price: 0,
      estimate: 0,
      hammer_price: 0,
      realized_price: 0,
      realized_with_buyers_premium: 0,
      inquiry_only: 0,
      unknown: 0
    };
    const perSourceRecordCounts: Record<string, number> = {};
    const realizedValues: number[] = [];
    const askingValues: number[] = [];
    const estimateValues: number[] = [];

    for (const record of inventory) {
      priceTypeBreakdown[record.payload.price_type] = (priceTypeBreakdown[record.payload.price_type] ?? 0) + 1;
      perSourceRecordCounts[record.payload.source_name] = (perSourceRecordCounts[record.payload.source_name] ?? 0) + 1;
      const value = priceValueForStats(record);
      if (value === null) continue;
      if (record.semantic_lane === "realized") realizedValues.push(value);
      if (record.semantic_lane === "asking") askingValues.push(value);
      if (record.semantic_lane === "estimate") estimateValues.push(value);
    }

    return artistMarketInventorySummarySchema.parse({
      run_id: run.id,
      artist_key: artistKey,
      crawl_mode: run.query.crawlMode ?? "backfill",
      total_inventory_records: inventory.length,
      new_records_added: [...sourceRuntime.values()].reduce((sum, source) => sum + source.newRecords, 0),
      total_images: images.length,
      discovered_hosts: discoveredHosts,
      total_clusters: clusters.length,
      auto_confirmed_clusters: clusters.filter((cluster) => cluster.cluster_status === "auto_confirmed").length,
      review_queue_count: reviewItems.length,
      crawl_gap_count: gaps.length,
      per_source_record_counts: perSourceRecordCounts,
      price_type_breakdown: priceTypeBreakdown,
      price_stats: {
        realized: numericStats(realizedValues),
        asking: numericStats(askingValues),
        estimate: numericStats(estimateValues)
      },
      crawl_gaps: gaps
    });
  }

  private buildRunSummary(
    run: RunEntity,
    attempts: SourceAttempt[],
    _currentRunRecords: PriceRecord[],
    clustered: ClusterBuildResult,
    inventorySummary: ArtistMarketInventorySummary,
    sourcePlan: import("@artbot/shared-types").SourcePlanItem[],
    persistedSourceHealth: import("@artbot/shared-types").HostHealthRecord[]
  ): RunSummary {
    const inventoryPriceBreakdown = inventorySummary.price_type_breakdown;
    const currentRunInventory = clustered.inventory.filter((record) => record.run_id === run.id);
    const sourceStatusBreakdown: Record<SourceAccessStatus, number> = {
      public_access: 0,
      auth_required: 0,
      licensed_access: 0,
      blocked: 0,
      price_hidden: 0
    };
    const authModeBreakdown: Record<"anonymous" | "authorized" | "licensed", number> = {
      anonymous: 0,
      authorized: 0,
      licensed: 0
    };
    const failureClassBreakdown = Object.fromEntries(failureClassList.map((item) => [item, 0])) as Record<
      (typeof failureClassList)[number],
      number
    >;
    const acceptanceReasonBreakdown = Object.fromEntries(acceptanceReasonList.map((item) => [item, 0])) as Record<
      (typeof acceptanceReasonList)[number],
      number
    >;
    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
      if (attempt.failure_class) {
        failureClassBreakdown[attempt.failure_class] += 1;
      }
      acceptanceReasonBreakdown[attempt.acceptance_reason] += 1;
    }

    const attemptedSources = new Set(attempts.map((attempt) => attempt.source_name));
    const crawledSources = new Set(
      attempts.filter((attempt) => attempt.source_access_status !== "blocked" && attempt.source_access_status !== "auth_required").map((attempt) => attempt.source_name)
    );
    const pricedSources = new Set(
      attempts
        .filter(
          (attempt) =>
            attempt.acceptance_reason === "valuation_ready"
            || attempt.acceptance_reason === "estimate_range_ready"
            || attempt.acceptance_reason === "asking_price_ready"
        )
        .map((attempt) => attempt.source_name)
    );
    const currentRunValuationEligible = currentRunInventory.filter((record) => record.payload.accepted_for_valuation).length;
    const pricedSourceCoverageRatio =
      attemptedSources.size === 0 ? 0 : Number((pricedSources.size / attemptedSources.size).toFixed(4));
    const pricedCrawledSourceCoverageRatio =
      crawledSources.size === 0 ? 0 : Number((pricedSources.size / crawledSources.size).toFixed(4));

    return {
      run_id: run.id,
      total_records: currentRunInventory.length,
      total_attempts: attempts.length,
      evidence_records: currentRunInventory.length,
      valuation_eligible_records: currentRunValuationEligible,
      accepted_records: currentRunInventory.length,
      rejected_candidates: attempts.filter((attempt) => !(attempt.accepted_for_evidence ?? attempt.accepted)).length,
      discovered_candidates: attempts.filter((attempt) => (attempt.discovery_provenance ?? "seed") !== "seed").length,
      accepted_from_discovery: currentRunInventory.filter((record) => isDiscoveryBackedRecord(record.payload)).length,
      priced_source_coverage_ratio: pricedSourceCoverageRatio,
      priced_crawled_source_coverage_ratio: pricedCrawledSourceCoverageRatio,
      price_type_breakdown: {
        realized:
          (inventoryPriceBreakdown.realized_price ?? 0) +
          (inventoryPriceBreakdown.realized_with_buyers_premium ?? 0) +
          (inventoryPriceBreakdown.hammer_price ?? 0),
        estimate: inventoryPriceBreakdown.estimate ?? 0,
        asking: inventoryPriceBreakdown.asking_price ?? 0,
        inquiry: inventoryPriceBreakdown.inquiry_only ?? 0,
        unknown: inventoryPriceBreakdown.unknown ?? 0
      },
      cluster_count: clustered.clusters.length,
      auto_clustered_records: clustered.memberships.filter((membership) => membership.status === "auto_confirmed").length,
      review_item_count: clustered.reviewItems.length,
      source_candidate_breakdown: attempts.reduce<Record<string, number>>((acc, attempt) => {
        acc[attempt.source_name] = (acc[attempt.source_name] ?? 0) + 1;
        return acc;
      }, {}),
      source_status_breakdown: sourceStatusBreakdown,
      auth_mode_breakdown: authModeBreakdown,
      failure_class_breakdown: failureClassBreakdown,
      acceptance_reason_breakdown: acceptanceReasonBreakdown,
      evaluation_metrics: buildEvaluationMetrics({
        attempts,
        sourcePlan,
        acceptedRecords: currentRunInventory.length,
        valuationEligibleRecords: currentRunValuationEligible,
        manualOverrideCount: clustered.reviewItems.filter((item) => item.status !== "pending").length
      }),
      persisted_source_health: persistedSourceHealth,
      valuation_generated: false,
      valuation_reason: "Deep inventory run reports separated price stats instead of a blended valuation range."
    };
  }
}

function uuid(): string {
  return createHash("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex");
}

export async function processArtistMarketInventoryRun(
  run: RunEntity,
  deps: {
    storage: ArtbotStorage;
    authManager: AuthManager;
    browserClient: BrowserClient;
    adapters: SourceAdapter[];
    normalizeRecord?: (record: PriceRecord) => Promise<PriceRecord>;
  }
): Promise<void> {
  const orchestrator = new ArtistMarketInventoryOrchestrator(
    deps.storage,
    new SourceRegistry(deps.adapters),
    deps.authManager,
    deps.browserClient,
    new FxRateProvider()
  );
  await orchestrator.processRun(run);
}
