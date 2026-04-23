import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type {
  ArtifactGcResult,
  ArtworkCluster,
  ArtworkImage,
  CanaryResult,
  ClusterMembership,
  CrawlCheckpoint,
  FrontierItem,
  FxCacheStats,
  FxRateDaily,
  FrontierStatus,
  InventoryRecord,
  HostHealthRecord,
  NormalizationEvent,
  PriceRecord,
  PriceSemanticLane,
  ResearchQuery,
  ReviewItem,
  RunEntity,
  RunStatus,
  RunType,
  SourceAccessStatus,
  SourceAttempt,
  SourceHealthRecord,
  SourceHost
} from "@artbot/shared-types";
import { ARTIFACT_MANIFEST_FILE, buildDefaultGcPolicyFromEnv, readArtifactManifest, runArtifactGc } from "./artifact-lifecycle.js";

interface RunRow {
  id: string;
  run_type: RunType;
  query_json: string;
  status: RunStatus;
  pinned?: number | null;
  pinned_at?: string | null;
  error: string | null;
  report_path: string | null;
  results_path: string | null;
  created_at: string;
  updated_at: string;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
}

interface RunUsageRow {
  id: string;
  status: RunStatus;
  pinned?: number | null;
}

interface StorageMetadataRow {
  value_json: string;
}

interface FxRateDailyRow {
  id: string;
  base_currency: "EUR";
  quote_currency: "USD" | "TRY" | "GBP" | "EUR";
  date: string;
  rate: number;
  source: "ecb_api" | "tcmb_fallback" | "static_fallback";
  fetched_at: string;
  quality_flag: "historical_exact" | "historical_fallback" | "current_cache";
}

type HostHealthDimension = {
  source_family: string;
  crawl_lane: "deterministic" | "cheap_fetch" | "crawlee" | "browser";
  access_mode: "anonymous" | "authorized" | "licensed";
  total_attempts: number;
  success_count: number;
  blocked_count: number;
  auth_required_count: number;
  failure_count: number;
  reliability_score: number;
  last_status: HostHealthRecord["last_status"];
  last_failure_class: HostHealthRecord["last_failure_class"];
  last_attempt_at: string;
  updated_at: string;
};

type HostHealthRecordWithDimensions = HostHealthRecord & {
  dimensions?: Record<string, HostHealthDimension>;
};

export interface RunDetails {
  run: RunEntity;
  records: PriceRecord[];
  attempts: SourceAttempt[];
  sourceStatusBreakdown: Record<SourceAccessStatus, number>;
  authModeBreakdown: Record<"anonymous" | "authorized" | "licensed", number>;
}

export interface StorageUsageBreakdown {
  runs: number;
  bytes: number;
}

export interface StorageCleanupObservation {
  reclaimed_bytes: number;
  timestamp: string;
  dry_run: boolean;
}

export interface StorageUsageSummary {
  total_runs: number;
  total_bytes: number;
  pinned: StorageUsageBreakdown;
  expirable: StorageUsageBreakdown;
  last_cleanup: StorageCleanupObservation | null;
  observed_cleanup?: StorageCleanupObservation;
}

export type StorageGcResult = ArtifactGcResult & {
  last_cleanup: StorageCleanupObservation | null;
  observed_cleanup?: StorageCleanupObservation;
};

const LAST_CLEANUP_METADATA_KEY = "last_cleanup";

function nowIso(): string {
  return new Date().toISOString();
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const sqliteError = error as Error & { errcode?: number; errstr?: string };
  return sqliteError.errcode === 5 || /database is locked/i.test(sqliteError.message) || /database is locked/i.test(sqliteError.errstr ?? "");
}

function sleepSync(ms: number): void {
  const until = Date.now() + Math.max(0, ms);
  while (Date.now() < until) {
    // Busy wait only on short SQLite contention backoff windows.
  }
}

function stablePairKey(left: string, right: string): string {
  return [left, right].sort().join("::");
}

export function artistKeyFromName(artist: string): string {
  return artist
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePayloadRows<T>(rows: Array<{ payload_json: string }>): T[] {
  return rows.map((row) => JSON.parse(row.payload_json) as T);
}

function frontierCanonicalKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function hasParsedSignal(attempt: SourceAttempt): boolean {
  return Object.keys(attempt.extracted_fields ?? {}).length > 0;
}

function hasPriceSignal(attempt: SourceAttempt): boolean {
  return (
    attempt.acceptance_reason === "valuation_ready"
    || attempt.acceptance_reason === "estimate_range_ready"
    || attempt.acceptance_reason === "asking_price_ready"
    || attempt.acceptance_reason === "inquiry_only_evidence"
    || attempt.acceptance_reason === "price_hidden_evidence"
    || typeof attempt.extracted_fields?.price_amount === "number"
    || typeof attempt.extracted_fields?.estimate_low === "number"
    || typeof attempt.extracted_fields?.estimate_high === "number"
    || attempt.source_access_status === "price_hidden"
  );
}

function isReachableAttempt(attempt: SourceAttempt): boolean {
  return (
    attempt.failure_class !== "transport_dns"
    && attempt.failure_class !== "transport_timeout"
    && attempt.failure_class !== "host_circuit"
    && attempt.source_access_status !== "blocked"
  );
}

export class ArtbotStorage {
  private readonly db: DatabaseSync;
  private readonly runsRoot: string;

  constructor(databasePath: string, runsRoot: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(runsRoot, { recursive: true });

    this.db = new DatabaseSync(databasePath);
    this.runsRoot = runsRoot;
    try {
      this.db.exec("PRAGMA busy_timeout = 5000;");
    } catch {
      // Ignore best-effort busy timeout setup failures during process bootstrap.
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        this.db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
        `);
        break;
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt === 3) {
          break;
        }
        sleepSync(75 * (attempt + 1));
      }
    }
    this.init();
  }

  private withBusyRetry<T>(operation: () => T, retries = 4): T {
    let attempt = 0;
    while (true) {
      try {
        return operation();
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= retries) {
          throw error;
        }
        attempt += 1;
        sleepSync(75 * attempt);
      }
    }
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        run_type TEXT NOT NULL,
        query_json TEXT NOT NULL,
        status TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_at TEXT,
        error TEXT,
        report_path TEXT,
        results_path TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS source_attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS page_cache (
        url_hash TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_hosts (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS host_health (
        host TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_health (
        source_name TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canary_results (
        id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        source_name TEXT NOT NULL,
        fixture TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_frontier (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        artist_key TEXT NOT NULL,
        source_host TEXT NOT NULL,
        url TEXT NOT NULL,
        canonical_key TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (artist_key, canonical_key)
      );

      CREATE TABLE IF NOT EXISTS crawl_checkpoints (
        id TEXT PRIMARY KEY,
        artist_key TEXT NOT NULL,
        source_host TEXT NOT NULL,
        section_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (artist_key, source_host, section_key)
      );

      CREATE TABLE IF NOT EXISTS inventory_records (
        id TEXT PRIMARY KEY,
        artist_key TEXT NOT NULL,
        record_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artwork_images (
        id TEXT PRIMARY KEY,
        artist_key TEXT NOT NULL,
        record_key TEXT NOT NULL,
        image_url TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (record_key, image_url)
      );

      CREATE TABLE IF NOT EXISTS artwork_clusters (
        id TEXT PRIMARY KEY,
        artist_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cluster_memberships (
        id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        record_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (cluster_id, record_key)
      );

      CREATE TABLE IF NOT EXISTS review_items (
        id TEXT PRIMARY KEY,
        artist_key TEXT NOT NULL,
        pair_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fx_rates_daily (
        id TEXT PRIMARY KEY,
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        date TEXT NOT NULL,
        rate REAL NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        quality_flag TEXT NOT NULL,
        UNIQUE (base_currency, quote_currency, date)
      );

      CREATE TABLE IF NOT EXISTS normalization_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        record_ref TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        work_title TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS storage_metadata (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.ensureRunsColumn("lease_owner", "TEXT");
    this.ensureRunsColumn("lease_expires_at", "TEXT");
    this.ensureRunsColumn("heartbeat_at", "TEXT");
    this.ensureRunsColumn("pinned", "INTEGER NOT NULL DEFAULT 0");
    this.ensureRunsColumn("pinned_at", "TEXT");
  }

  private ensureRunsColumn(columnName: string, columnSqlType: string): void {
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE runs ADD COLUMN ${columnName} ${columnSqlType}`);
  }

  public createRun(runType: RunType, query: ResearchQuery): RunEntity {
    const now = new Date().toISOString();
    const id = uuidv4();

    this.withBusyRetry(() =>
      this.db
        .prepare(
          `INSERT INTO runs (id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at)
           VALUES (@id, @run_type, @query_json, @status, NULL, NULL, NULL, @created_at, @updated_at)`
        )
        .run({
          id,
          run_type: runType,
          query_json: JSON.stringify(query),
          status: "pending",
          created_at: now,
          updated_at: now
        })
    );

    return {
      id,
      runType,
      query,
      status: "pending",
      pinned: false,
      createdAt: now,
      updatedAt: now
    };
  }

  public getPendingRuns(limit = 5): RunEntity[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
         FROM runs
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(limit) as unknown as RunRow[];

    return rows.map((row) => this.mapRun(row));
  }

  public getRunnableRuns(limit = 5): RunEntity[] {
    const nowIso = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
         FROM runs
         WHERE status = 'pending'
            OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
         ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at ASC
         LIMIT ?`
      )
      .all(nowIso, limit) as unknown as RunRow[];

    return rows.map((row) => this.mapRun(row));
  }

  public listRuns(limit = 20, status?: RunStatus): RunEntity[] {
    const cappedLimit = Math.max(1, Math.min(limit, 200));

    const rows = status
      ? (this.db
          .prepare(
            `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
             FROM runs
             WHERE status = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(status, cappedLimit) as unknown as RunRow[])
      : (this.db
          .prepare(
            `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
             FROM runs
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(cappedLimit) as unknown as RunRow[]);

    return rows.map((row) => this.mapRun(row));
  }

  public reserveRun(runId: string, workerId = "worker-default", leaseMs = 120_000): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1, leaseMs)).toISOString();
    const result = this.withBusyRetry(() =>
      this.db
        .prepare(
          `UPDATE runs
           SET status = 'running',
               updated_at = ?,
               lease_owner = ?,
               lease_expires_at = ?,
               heartbeat_at = ?,
               error = NULL
           WHERE id = ?
             AND (
               status = 'pending'
               OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
             )`
        )
        .run(nowIso, workerId, leaseExpiresAt, nowIso, runId, nowIso)
    );

    return result.changes > 0;
  }

  public heartbeatRun(runId: string, workerId: string, leaseMs = 120_000): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1, leaseMs)).toISOString();

    const result = this.withBusyRetry(() =>
      this.db
        .prepare(
          `UPDATE runs
           SET updated_at = ?,
               heartbeat_at = ?,
               lease_expires_at = ?
           WHERE id = ?
             AND status = 'running'
             AND lease_owner = ?`
        )
        .run(nowIso, nowIso, leaseExpiresAt, runId, workerId)
    );

    return result.changes > 0;
  }

  public recoverStaleRunningRuns(maxStaleMs = 15 * 60 * 1000, reason = "Recovered stale running run."): string[] {
    const now = new Date();
    const nowIso = now.toISOString();
    const staleCutoff = new Date(now.getTime() - Math.max(0, maxStaleMs)).toISOString();

    const staleRows = this.db
      .prepare(
        `SELECT id FROM runs
         WHERE status = 'running'
           AND (
             (lease_expires_at IS NOT NULL AND lease_expires_at < ?)
             OR (heartbeat_at IS NOT NULL AND heartbeat_at < ?)
             OR (heartbeat_at IS NULL AND updated_at < ?)
           )`
      )
      .all(nowIso, staleCutoff, staleCutoff) as Array<{ id: string }>;

    if (staleRows.length === 0) {
      return [];
    }

    const recoveredIds: string[] = [];
    for (const row of staleRows) {
      const result = this.db
        .prepare(
          `UPDATE runs
           SET status = 'failed',
               error = ?,
               updated_at = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL
           WHERE id = ?
             AND status = 'running'`
        )
        .run(reason, nowIso, row.id);

      if (result.changes > 0) {
        recoveredIds.push(row.id);
      }
    }

    return recoveredIds;
  }

  public completeRun(runId: string, reportPath: string, resultsPath: string): void {
    const now = new Date().toISOString();
    this.withBusyRetry(() =>
      this.db
        .prepare(
          `UPDATE runs
           SET status = 'completed',
               report_path = ?,
               results_path = ?,
               updated_at = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL
           WHERE id = ?`
        )
        .run(reportPath, resultsPath, now, runId)
    );
    const run = this.getRun(runId);
    this.syncRunManifestPromotionState(runId, Boolean(run?.pinned));
    this.runArtifactGc();
  }

  public getStorageUsageSummary(options: { observedCleanup?: StorageCleanupObservation } = {}): StorageUsageSummary {
    const runRows = this.db.prepare(`SELECT id, status, pinned FROM runs`).all() as unknown as RunUsageRow[];
    let totalBytes = 0;
    const pinned = {
      runs: 0,
      bytes: 0
    };
    const expirable = {
      runs: 0,
      bytes: 0
    };

    for (const row of runRows) {
      const runBytes = this.getRunDirectorySizeBytes(row.id);
      totalBytes += runBytes;
      if (row.pinned) {
        pinned.runs += 1;
        pinned.bytes += runBytes;
        continue;
      }

      expirable.runs += 1;
      expirable.bytes += runBytes;
    }

    return {
      total_runs: runRows.length,
      total_bytes: totalBytes,
      pinned,
      expirable,
      last_cleanup: this.getLastCleanupObservation(),
      observed_cleanup: options.observedCleanup
    };
  }

  public runArtifactGc(options: { dryRun?: boolean; now?: Date } = {}): StorageGcResult {
    const gcResult = runArtifactGc(this.runsRoot, buildDefaultGcPolicyFromEnv(), {
      ...options,
      pinnedRunIds: this.listPinnedRunIds()
    });
    const timestamp = (options.now ?? new Date()).toISOString();
    const observedCleanup: StorageCleanupObservation = {
      reclaimed_bytes: gcResult.reclaimed_bytes,
      timestamp,
      dry_run: gcResult.dry_run
    };

    if (!gcResult.dry_run) {
      this.setLastCleanupObservation(observedCleanup);
      return {
        ...gcResult,
        last_cleanup: observedCleanup
      };
    }

    return {
      ...gcResult,
      last_cleanup: this.getLastCleanupObservation(),
      observed_cleanup: observedCleanup
    };
  }

  public pinRun(runId: string): RunEntity | null {
    return this.setRunPinned(runId, true);
  }

  public unpinRun(runId: string): RunEntity | null {
    return this.setRunPinned(runId, false);
  }

  public failRun(runId: string, error: string): void {
    const now = new Date().toISOString();
    this.withBusyRetry(() =>
      this.db
        .prepare(
          `UPDATE runs
           SET status = 'failed',
               error = ?,
               updated_at = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL
           WHERE id = ?`
        )
        .run(error, now, runId)
    );
  }

  public saveRecord(runId: string, record: PriceRecord): void {
    this.withBusyRetry(() =>
      this.db
        .prepare(`INSERT INTO records (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
        .run(uuidv4(), runId, JSON.stringify(record), new Date().toISOString())
    );
  }

  public saveAttempt(runId: string, attempt: SourceAttempt): void {
    this.withBusyRetry(() =>
      this.db
        .prepare(`INSERT INTO source_attempts (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
        .run(uuidv4(), runId, JSON.stringify(attempt), new Date().toISOString())
    );
  }

  public upsertFxRateDaily(input: Omit<FxRateDaily, "id" | "fetched_at"> & { id?: string; fetched_at?: string }): FxRateDaily {
    const existing = this.db
      .prepare(
        `SELECT id, base_currency, quote_currency, date, rate, source, fetched_at, quality_flag
         FROM fx_rates_daily
         WHERE base_currency = ? AND quote_currency = ? AND date = ?`
      )
      .get(input.base_currency, input.quote_currency, input.date) as FxRateDailyRow | undefined;
    const next: FxRateDaily = {
      ...input,
      id: existing?.id ?? input.id ?? uuidv4(),
      fetched_at: input.fetched_at ?? nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO fx_rates_daily (id, base_currency, quote_currency, date, rate, source, fetched_at, quality_flag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(base_currency, quote_currency, date)
         DO UPDATE SET
           rate = excluded.rate,
           source = excluded.source,
           fetched_at = excluded.fetched_at,
           quality_flag = excluded.quality_flag`
      )
      .run(
        next.id,
        next.base_currency,
        next.quote_currency,
        next.date,
        next.rate,
        next.source,
        next.fetched_at,
        next.quality_flag
      );

    return next;
  }

  public getFxRatesForDate(date: string, baseCurrency: FxRateDaily["base_currency"] = "EUR"): FxRateDaily[] {
    const rows = this.db
      .prepare(
        `SELECT id, base_currency, quote_currency, date, rate, source, fetched_at, quality_flag
         FROM fx_rates_daily
         WHERE date = ? AND base_currency = ?
         ORDER BY quote_currency ASC`
      )
      .all(date, baseCurrency) as unknown as FxRateDailyRow[];

    return rows.map((row) => ({ ...row }));
  }

  public getFxCacheStats(): FxCacheStats {
    const rows = this.db
      .prepare(`SELECT base_currency, quote_currency, date, source FROM fx_rates_daily`)
      .all() as Array<Pick<FxRateDailyRow, "base_currency" | "quote_currency" | "date" | "source">>;

    const sources: Record<string, number> = {};
    const quoteCurrencies: Record<string, number> = {};
    const uniqueDates = new Set<string>();
    let latestDate: string | null = null;

    for (const row of rows) {
      sources[row.source] = (sources[row.source] ?? 0) + 1;
      quoteCurrencies[row.quote_currency] = (quoteCurrencies[row.quote_currency] ?? 0) + 1;
      uniqueDates.add(row.date);
      if (!latestDate || row.date > latestDate) {
        latestDate = row.date;
      }
    }

    return {
      total_rows: rows.length,
      unique_dates: uniqueDates.size,
      latest_date: latestDate,
      sources,
      quote_currencies: quoteCurrencies
    };
  }

  public saveNormalizationEvent(
    input: Omit<NormalizationEvent, "id" | "created_at"> & { id?: string; created_at?: string }
  ): NormalizationEvent {
    const event: NormalizationEvent = {
      ...input,
      id: input.id ?? uuidv4(),
      created_at: input.created_at ?? nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO normalization_events (id, run_id, record_ref, source_name, source_url, work_title, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.run_id,
        event.record_ref,
        event.source_name,
        event.source_url,
        event.work_title ?? null,
        JSON.stringify(event.payload_json),
        event.created_at
      );

    return event;
  }

  public listNormalizationEvents(runId: string, limit = 100): NormalizationEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, record_ref, source_name, source_url, work_title, payload_json, created_at
         FROM normalization_events
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, Math.max(1, Math.min(limit, 500))) as Array<{
        id: string;
        run_id: string;
        record_ref: string;
        source_name: string;
        source_url: string;
        work_title: string | null;
        payload_json: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      run_id: row.run_id,
      record_ref: row.record_ref,
      source_name: row.source_name,
      source_url: row.source_url,
      work_title: row.work_title,
      payload_json: JSON.parse(row.payload_json) as Record<string, unknown>,
      created_at: row.created_at
    }));
  }

  public upsertSourceHost(
    sourceHost: Omit<SourceHost, "id" | "created_at" | "updated_at"> & { id?: string }
  ): SourceHost {
    const existing = this.getSourceHost(sourceHost.host);
    const now = nowIso();
    const payload: SourceHost = {
      ...sourceHost,
      id: existing?.id ?? sourceHost.id ?? uuidv4(),
      created_at: existing?.created_at ?? now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO source_hosts (id, host, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(host)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(
        payload.id,
        payload.host,
        JSON.stringify(payload),
        payload.created_at,
        payload.updated_at
      );

    return payload;
  }

  public getSourceHost(host: string): SourceHost | null {
    const row = this.db.prepare(`SELECT payload_json FROM source_hosts WHERE host = ?`).get(host) as
      | { payload_json: string }
      | undefined;
    return row ? (JSON.parse(row.payload_json) as SourceHost) : null;
  }

  public listSourceHosts(): SourceHost[] {
    const rows = this.db.prepare(`SELECT payload_json FROM source_hosts ORDER BY host ASC`).all() as Array<{
      payload_json: string;
    }>;
    return parsePayloadRows<SourceHost>(rows);
  }

  public recordHostAttempt(host: string, attempt: SourceAttempt): HostHealthRecord {
    const existing = this.getHostHealth(host);
    const existingWithDimensions = existing as HostHealthRecordWithDimensions | null;
    const success = Boolean(attempt.accepted_for_evidence ?? attempt.accepted) && !attempt.failure_class;
    const now = nowIso();
    const lane = attempt.crawl_lane ?? "cheap_fetch";
    const sourceFamily = attempt.source_family ?? "unknown";
    const dimensionKey = `${sourceFamily}::${lane}::${attempt.access_mode}`;
    const existingDimension = existingWithDimensions?.dimensions?.[dimensionKey];
    const nextDimension = {
      source_family: sourceFamily,
      crawl_lane: lane,
      access_mode: attempt.access_mode,
      total_attempts: (existingDimension?.total_attempts ?? 0) + 1,
      success_count: (existingDimension?.success_count ?? 0) + (success ? 1 : 0),
      blocked_count: (existingDimension?.blocked_count ?? 0) + (attempt.source_access_status === "blocked" ? 1 : 0),
      auth_required_count:
        (existingDimension?.auth_required_count ?? 0) + (attempt.source_access_status === "auth_required" ? 1 : 0),
      failure_count:
        (existingDimension?.failure_count ?? 0) + (attempt.failure_class || attempt.source_access_status === "blocked" ? 1 : 0),
      reliability_score: 0,
      last_status: attempt.source_access_status,
      last_failure_class: attempt.failure_class ?? null,
      last_attempt_at: attempt.fetched_at,
      updated_at: now
    };
    nextDimension.reliability_score = Number((nextDimension.success_count / Math.max(1, nextDimension.total_attempts)).toFixed(4));

    const next: HostHealthRecordWithDimensions = {
      host,
      total_attempts: (existing?.total_attempts ?? 0) + 1,
      success_count: (existing?.success_count ?? 0) + (success ? 1 : 0),
      blocked_count: (existing?.blocked_count ?? 0) + (attempt.source_access_status === "blocked" ? 1 : 0),
      auth_required_count: (existing?.auth_required_count ?? 0) + (attempt.source_access_status === "auth_required" ? 1 : 0),
      failure_count:
        (existing?.failure_count ?? 0) +
        (attempt.failure_class || attempt.source_access_status === "blocked" ? 1 : 0),
      consecutive_failures: success ? 0 : (existing?.consecutive_failures ?? 0) + 1,
      reliability_score: 0,
      last_status: attempt.source_access_status,
      last_failure_class: attempt.failure_class ?? null,
      last_attempt_at: attempt.fetched_at,
      updated_at: now,
      dimensions: {
        ...(existingWithDimensions?.dimensions ?? {}),
        [dimensionKey]: nextDimension
      }
    };
    next.reliability_score = Number((next.success_count / Math.max(1, next.total_attempts)).toFixed(4));

    this.withBusyRetry(() =>
      this.db
        .prepare(
          `INSERT INTO host_health (host, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(host)
           DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
        )
        .run(host, JSON.stringify(next), now)
    );

    return next as HostHealthRecord;
  }

  public recordSourceAttempt(attempt: SourceAttempt): SourceHealthRecord {
    const existing = this.getSourceHealth(attempt.source_name);
    const now = nowIso();
    const acceptedForEvidence = Boolean(attempt.accepted_for_evidence ?? attempt.accepted);
    const acceptedForValuation = Boolean(attempt.accepted_for_valuation);

    const next: SourceHealthRecord = {
      source_name: attempt.source_name,
      source_family: attempt.source_family ?? attempt.source_name,
      venue_name: attempt.venue_name ?? attempt.source_name,
      legal_posture: attempt.source_legal_posture ?? "public_permitted",
      total_attempts: (existing?.total_attempts ?? 0) + 1,
      reachable_count: (existing?.reachable_count ?? 0) + (isReachableAttempt(attempt) ? 1 : 0),
      parse_success_count: (existing?.parse_success_count ?? 0) + (hasParsedSignal(attempt) ? 1 : 0),
      price_signal_count: (existing?.price_signal_count ?? 0) + (hasPriceSignal(attempt) ? 1 : 0),
      accepted_for_evidence_count: (existing?.accepted_for_evidence_count ?? 0) + (acceptedForEvidence ? 1 : 0),
      valuation_ready_count: (existing?.valuation_ready_count ?? 0) + (acceptedForValuation ? 1 : 0),
      blocked_count: (existing?.blocked_count ?? 0) + (attempt.source_access_status === "blocked" ? 1 : 0),
      auth_required_count: (existing?.auth_required_count ?? 0) + (attempt.source_access_status === "auth_required" ? 1 : 0),
      failure_count:
        (existing?.failure_count ?? 0) +
        (attempt.failure_class || attempt.source_access_status === "blocked" ? 1 : 0),
      reliability_score: 0,
      last_status: attempt.source_access_status,
      last_failure_class: attempt.failure_class ?? null,
      last_run_id: attempt.run_id,
      last_attempt_at: attempt.fetched_at,
      updated_at: now
    };
    next.reliability_score = Number(
      (next.accepted_for_evidence_count / Math.max(1, next.total_attempts)).toFixed(4)
    );

    this.withBusyRetry(() =>
      this.db
        .prepare(
          `INSERT INTO source_health (source_name, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(source_name)
           DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
        )
        .run(attempt.source_name, JSON.stringify(next), now)
    );

    return next;
  }

  public getHostHealth(host: string): HostHealthRecord | null {
    const row = this.db.prepare(`SELECT payload_json FROM host_health WHERE host = ?`).get(host) as
      | { payload_json: string }
      | undefined;
    return row ? (JSON.parse(row.payload_json) as HostHealthRecord) : null;
  }

  public listHostHealth(limit = 50): HostHealthRecord[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM host_health ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload_json: string }>;
    return parsePayloadRows<HostHealthRecord>(rows);
  }

  public getSourceHealth(sourceName: string): SourceHealthRecord | null {
    const row = this.db.prepare(`SELECT payload_json FROM source_health WHERE source_name = ?`).get(sourceName) as
      | { payload_json: string }
      | undefined;
    return row ? (JSON.parse(row.payload_json) as SourceHealthRecord) : null;
  }

  public listSourceHealth(limit = 50): SourceHealthRecord[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM source_health ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload_json: string }>;
    return parsePayloadRows<SourceHealthRecord>(rows);
  }

  public saveCanaryResult(result: CanaryResult): CanaryResult {
    this.withBusyRetry(() =>
      this.db
        .prepare(
          `INSERT INTO canary_results (id, family, source_name, fixture, payload_json, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id)
           DO UPDATE SET
             family = excluded.family,
             source_name = excluded.source_name,
             fixture = excluded.fixture,
             payload_json = excluded.payload_json,
             recorded_at = excluded.recorded_at`
        )
        .run(
          result.id,
          result.family,
          result.source_name,
          result.fixture,
          JSON.stringify(result),
          result.recorded_at
        )
    );
    return result;
  }

  public listCanaryResults(limit = 50, family?: string): CanaryResult[] {
    const rows = family
      ? (this.db
          .prepare(
            `SELECT payload_json
             FROM canary_results
             WHERE family = ?
             ORDER BY recorded_at DESC
             LIMIT ?`
          )
          .all(family, limit) as Array<{ payload_json: string }>)
      : (this.db
          .prepare(
            `SELECT payload_json
             FROM canary_results
             ORDER BY recorded_at DESC
             LIMIT ?`
          )
          .all(limit) as Array<{ payload_json: string }>);

    return parsePayloadRows<CanaryResult>(rows);
  }

  public enqueueFrontierItem(
    item: Omit<
      FrontierItem,
      | "id"
      | "status"
      | "retry_count"
      | "revisit_after"
      | "last_error"
      | "created_at"
      | "updated_at"
      | "source_family"
      | "source_family_bucket"
    > & Partial<Pick<FrontierItem, "source_family" | "source_family_bucket">>
  ): FrontierItem {
    const now = nowIso();
    const canonicalKey = `${item.adapter_id}:${frontierCanonicalKey(item.url)}`;
    const existing = this.db
      .prepare(`SELECT payload_json FROM crawl_frontier WHERE artist_key = ? AND canonical_key = ?`)
      .get(item.artist_key, canonicalKey) as { payload_json: string } | undefined;
    const existingItem = existing ? (JSON.parse(existing.payload_json) as FrontierItem) : null;
    const isCrossRunReuse = Boolean(existingItem && existingItem.run_id !== item.run_id);
    const preserveProcessingState =
      existingItem?.status === "processing" && existingItem.run_id === item.run_id;
    const frontierItem: FrontierItem = {
      ...item,
      source_family: item.source_family ?? existingItem?.source_family ?? "unknown",
      source_family_bucket: item.source_family_bucket ?? existingItem?.source_family_bucket ?? "open_web",
      id: existingItem?.id ?? uuidv4(),
      status: preserveProcessingState ? "processing" : "pending",
      retry_count: isCrossRunReuse ? 0 : existingItem?.retry_count ?? 0,
      revisit_after: isCrossRunReuse ? null : existingItem?.revisit_after ?? null,
      last_error: isCrossRunReuse ? null : existingItem?.last_error ?? null,
      created_at: isCrossRunReuse ? now : existingItem?.created_at ?? now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO crawl_frontier (id, run_id, artist_key, source_host, url, canonical_key, status, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(artist_key, canonical_key)
         DO UPDATE SET
           run_id = excluded.run_id,
           source_host = excluded.source_host,
           url = excluded.url,
           status = CASE
             WHEN crawl_frontier.status = 'processing' AND crawl_frontier.run_id = excluded.run_id
               THEN crawl_frontier.status
             ELSE 'pending'
           END,
           created_at = excluded.created_at,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(
        frontierItem.id,
        frontierItem.run_id,
        frontierItem.artist_key,
        frontierItem.source_host,
        frontierItem.url,
        canonicalKey,
        frontierItem.status,
        JSON.stringify(frontierItem),
        frontierItem.created_at,
        frontierItem.updated_at
      );

    return frontierItem;
  }

  public listPendingFrontier(runId: string, limit = 100): FrontierItem[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json
         FROM crawl_frontier
         WHERE run_id = ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{ payload_json: string }>;
    return parsePayloadRows<FrontierItem>(rows);
  }

  public claimNextFrontierItem(runId: string): FrontierItem | null {
    const row = this.db
      .prepare(
        `SELECT payload_json
         FROM crawl_frontier
         WHERE run_id = ?
           AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(runId) as { payload_json: string } | undefined;

    if (!row) {
      return null;
    }

    const current = JSON.parse(row.payload_json) as FrontierItem;
    const next: FrontierItem = {
      ...current,
      status: "processing",
      updated_at: nowIso()
    };

    this.db
      .prepare(`UPDATE crawl_frontier SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, JSON.stringify(next), next.updated_at, next.id);

    return next;
  }

  public updateFrontierItemStatus(frontierId: string, status: FrontierStatus): void {
    const row = this.db
      .prepare(`SELECT payload_json FROM crawl_frontier WHERE id = ?`)
      .get(frontierId) as { payload_json: string } | undefined;
    if (!row) {
      return;
    }

    const current = JSON.parse(row.payload_json) as FrontierItem;
    const next: FrontierItem = {
      ...current,
      status,
      retry_count: status === "failed" ? current.retry_count + 1 : current.retry_count,
      updated_at: nowIso()
    };

    this.db
      .prepare(`UPDATE crawl_frontier SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, JSON.stringify(next), next.updated_at, next.id);
  }

  public markFrontierProcessing(frontierId: string): void {
    this.updateFrontierItemStatus(frontierId, "processing");
  }

  public markFrontierCompleted(frontierId: string): void {
    this.updateFrontierItemStatus(frontierId, "completed");
  }

  public markFrontierSkipped(frontierId: string, error?: string): void {
    const row = this.db
      .prepare(`SELECT payload_json FROM crawl_frontier WHERE id = ?`)
      .get(frontierId) as { payload_json: string } | undefined;
    if (!row) {
      return;
    }
    const current = JSON.parse(row.payload_json) as FrontierItem;
    const next: FrontierItem = {
      ...current,
      status: "skipped",
      last_error: error ?? current.last_error,
      updated_at: nowIso()
    };

    this.db
      .prepare(`UPDATE crawl_frontier SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, JSON.stringify(next), next.updated_at, next.id);
  }

  public markFrontierFailed(frontierId: string, error: string): void {
    const row = this.db
      .prepare(`SELECT payload_json FROM crawl_frontier WHERE id = ?`)
      .get(frontierId) as { payload_json: string } | undefined;
    if (!row) {
      return;
    }
    const current = JSON.parse(row.payload_json) as FrontierItem;
    const next: FrontierItem = {
      ...current,
      status: "failed",
      retry_count: current.retry_count + 1,
      last_error: error,
      updated_at: nowIso()
    };

    this.db
      .prepare(`UPDATE crawl_frontier SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, JSON.stringify(next), next.updated_at, next.id);
  }

  public listFrontierItems(runId: string, status?: FrontierStatus): FrontierItem[] {
    const rows = status
      ? (this.db
          .prepare(`SELECT payload_json FROM crawl_frontier WHERE run_id = ? AND status = ? ORDER BY created_at ASC`)
          .all(runId, status) as Array<{ payload_json: string }>)
      : (this.db
          .prepare(`SELECT payload_json FROM crawl_frontier WHERE run_id = ? ORDER BY created_at ASC`)
          .all(runId) as Array<{ payload_json: string }>);

    return parsePayloadRows<FrontierItem>(rows);
  }

  public upsertCrawlCheckpoint(
    checkpoint: Omit<CrawlCheckpoint, "id" | "updated_at"> & { id?: string }
  ): CrawlCheckpoint {
    const existing = this.db
      .prepare(
        `SELECT payload_json FROM crawl_checkpoints WHERE artist_key = ? AND source_host = ? AND section_key = ?`
      )
      .get(checkpoint.artist_key, checkpoint.source_host, checkpoint.section_key) as { payload_json: string } | undefined;

    const next: CrawlCheckpoint = {
      ...checkpoint,
      id: checkpoint.id ?? (existing ? (JSON.parse(existing.payload_json) as CrawlCheckpoint).id : uuidv4()),
      updated_at: nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO crawl_checkpoints (id, artist_key, source_host, section_key, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(artist_key, source_host, section_key)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(next.id, next.artist_key, next.source_host, next.section_key, JSON.stringify(next), next.updated_at);

    return next;
  }

  public listCrawlCheckpoints(artistKey: string): CrawlCheckpoint[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM crawl_checkpoints WHERE artist_key = ? ORDER BY updated_at DESC`)
      .all(artistKey) as Array<{ payload_json: string }>;
    return parsePayloadRows<CrawlCheckpoint>(rows);
  }

  public getCrawlCheckpoint(artistKey: string, sourceHost: string, sectionKey: string): CrawlCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT payload_json
         FROM crawl_checkpoints
         WHERE artist_key = ? AND source_host = ? AND section_key = ?`
      )
      .get(artistKey, sourceHost, sectionKey) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as CrawlCheckpoint) : null;
  }

  public listCrawlCheckpointsForArtist(artistKey: string): CrawlCheckpoint[] {
    return this.listCrawlCheckpoints(artistKey);
  }

  public saveInventoryRecord(
    input: Omit<InventoryRecord, "id" | "created_at" | "updated_at"> & { id?: string }
  ): { record: InventoryRecord; inserted: boolean } {
    const existing = this.db
      .prepare(`SELECT payload_json FROM inventory_records WHERE record_key = ?`)
      .get(input.record_key) as { payload_json: string } | undefined;
    const existingRecord = existing ? (JSON.parse(existing.payload_json) as InventoryRecord) : null;
    const now = nowIso();
    const record: InventoryRecord = {
      ...input,
      id: existingRecord?.id ?? input.id ?? uuidv4(),
      created_at: existingRecord?.created_at ?? now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO inventory_records (id, artist_key, record_key, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_key)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(record.id, record.artist_key, record.record_key, JSON.stringify(record), record.created_at, record.updated_at);

    return {
      record,
      inserted: existingRecord === null
    };
  }

  public upsertInventoryRecord(
    input: Omit<InventoryRecord, "id" | "created_at" | "updated_at"> & { id?: string }
  ): { record: InventoryRecord; inserted: boolean } {
    return this.saveInventoryRecord(input);
  }

  public listInventoryRecordsByArtist(artistKey: string): InventoryRecord[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM inventory_records WHERE artist_key = ? ORDER BY updated_at ASC`)
      .all(artistKey) as Array<{ payload_json: string }>;
    return parsePayloadRows<InventoryRecord>(rows);
  }

  public listInventoryRecordsByRun(runId: string): InventoryRecord[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM inventory_records WHERE json_extract(payload_json, '$.run_id') = ? ORDER BY updated_at ASC`)
      .all(runId) as Array<{ payload_json: string }>;
    return parsePayloadRows<InventoryRecord>(rows);
  }

  public saveArtworkImage(
    input: Omit<ArtworkImage, "id" | "created_at" | "updated_at"> & { id?: string }
  ): { image: ArtworkImage; inserted: boolean } {
    const existing = this.db
      .prepare(`SELECT payload_json FROM artwork_images WHERE record_key = ? AND image_url = ?`)
      .get(input.record_key, input.image_url) as { payload_json: string } | undefined;
    const existingImage = existing ? (JSON.parse(existing.payload_json) as ArtworkImage) : null;
    const now = nowIso();
    const image: ArtworkImage = {
      ...input,
      id: existingImage?.id ?? input.id ?? uuidv4(),
      created_at: existingImage?.created_at ?? now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO artwork_images (id, artist_key, record_key, image_url, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_key, image_url)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(
        image.id,
        image.artist_key,
        image.record_key,
        image.image_url,
        JSON.stringify(image),
        image.created_at,
        image.updated_at
      );

    return {
      image,
      inserted: existingImage === null
    };
  }

  public upsertArtworkImage(
    input: Omit<ArtworkImage, "id" | "created_at" | "updated_at"> & { id?: string }
  ): { image: ArtworkImage; inserted: boolean } {
    return this.saveArtworkImage(input);
  }

  public listArtworkImagesByArtist(artistKey: string): ArtworkImage[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM artwork_images WHERE artist_key = ? ORDER BY updated_at ASC`)
      .all(artistKey) as Array<{ payload_json: string }>;
    return parsePayloadRows<ArtworkImage>(rows);
  }

  public replaceRunClusters(
    artistKey: string,
    clusters: ArtworkCluster[],
    memberships: ClusterMembership[],
    reviewItems: ReviewItem[]
  ): void {
    const existingClusterIds = this.listArtworkClusters(artistKey).map((cluster) => cluster.id);
    if (existingClusterIds.length > 0) {
      const placeholders = existingClusterIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM cluster_memberships WHERE cluster_id IN (${placeholders})`).run(...existingClusterIds);
    }
    this.db.prepare(`DELETE FROM artwork_clusters WHERE artist_key = ?`).run(artistKey);
    this.db.prepare(`DELETE FROM review_items WHERE artist_key = ?`).run(artistKey);

    for (const cluster of clusters) {
      this.db
        .prepare(
          `INSERT INTO artwork_clusters (id, artist_key, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id)
           DO UPDATE SET
             artist_key = excluded.artist_key,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        )
        .run(cluster.id, artistKey, JSON.stringify(cluster), cluster.created_at, cluster.updated_at);
    }

    for (const membership of memberships) {
      this.db
        .prepare(
          `INSERT INTO cluster_memberships (id, cluster_id, record_key, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          membership.id,
          membership.cluster_id,
          membership.record_key,
          JSON.stringify(membership),
          membership.created_at,
          membership.updated_at
        );
    }

    for (const reviewItem of reviewItems) {
      const pairKey = stablePairKey(reviewItem.left_record_key, reviewItem.right_record_key);
      this.db
        .prepare(
          `INSERT INTO review_items (id, artist_key, pair_key, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(pair_key)
           DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
        )
        .run(
          reviewItem.id,
          reviewItem.artist_key,
          pairKey,
          JSON.stringify(reviewItem),
          reviewItem.created_at,
          reviewItem.updated_at
        );
    }
  }

  public replaceClustersForArtist(
    artistKey: string,
    clusters: ArtworkCluster[],
    memberships: ClusterMembership[],
    reviewItems: ReviewItem[]
  ): void {
    this.replaceRunClusters(artistKey, clusters, memberships, reviewItems);
  }

  public listArtworkClusters(artistKey: string): ArtworkCluster[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM artwork_clusters WHERE artist_key = ? ORDER BY updated_at ASC`)
      .all(artistKey) as Array<{ payload_json: string }>;
    return parsePayloadRows<ArtworkCluster>(rows);
  }

  public listClusterMemberships(artistKey: string): ClusterMembership[] {
    const clusterIds = this.listArtworkClusters(artistKey).map((cluster) => cluster.id);
    if (clusterIds.length === 0) {
      return [];
    }

    const placeholders = clusterIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT payload_json FROM cluster_memberships WHERE cluster_id IN (${placeholders}) ORDER BY updated_at ASC`)
      .all(...clusterIds) as Array<{ payload_json: string }>;
    return parsePayloadRows<ClusterMembership>(rows);
  }

  public listReviewItems(artistKey: string): ReviewItem[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM review_items WHERE artist_key = ? ORDER BY updated_at ASC`)
      .all(artistKey) as Array<{ payload_json: string }>;
    return parsePayloadRows<ReviewItem>(rows);
  }

  public adjudicateReviewItem(
    artistKey: string,
    reviewItemId: string,
    decision: "merge" | "keep_separate"
  ): ReviewItem | null {
    const row = this.db
      .prepare(`SELECT payload_json FROM review_items WHERE artist_key = ? AND id = ?`)
      .get(artistKey, reviewItemId) as { payload_json: string } | undefined;
    if (!row) {
      return null;
    }
    const current = JSON.parse(row.payload_json) as ReviewItem;
    const updatedAt = nowIso();
    const next: ReviewItem = {
      ...current,
      recommended_action: decision,
      status: decision === "merge" ? "accepted" : "rejected",
      updated_at: updatedAt
    };

    const pairKey = stablePairKey(next.left_record_key, next.right_record_key);
    this.db
      .prepare(
        `UPDATE review_items
         SET payload_json = ?, pair_key = ?, updated_at = ?
         WHERE id = ? AND artist_key = ?`
      )
      .run(JSON.stringify(next), pairKey, updatedAt, reviewItemId, artistKey);
    return next;
  }

  public listArtworkClustersByArtist(artistKey: string): ArtworkCluster[] {
    return this.listArtworkClusters(artistKey);
  }

  public listReviewItemsByArtist(artistKey: string): ReviewItem[] {
    return this.listReviewItems(artistKey);
  }

  public getRunRoot(runId: string): string {
    const target = path.join(this.runsRoot, runId);
    fs.mkdirSync(path.join(target, "evidence", "screenshots"), { recursive: true });
    fs.mkdirSync(path.join(target, "evidence", "raw"), { recursive: true });
    fs.mkdirSync(path.join(target, "images"), { recursive: true });
    fs.mkdirSync(path.join(target, "exports"), { recursive: true });
    return target;
  }

  public getRunsRoot(): string {
    return this.runsRoot;
  }

  public getRunDetails(runId: string): RunDetails | null {
    const row = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
         FROM runs WHERE id = ?`
      )
      .get(runId) as RunRow | undefined;

    if (!row) {
      return null;
    }

    const recordRows = this.db
      .prepare(`SELECT payload_json FROM records WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as Array<{ payload_json: string }>;
    const records = recordRows.map((entry) => JSON.parse(entry.payload_json) as PriceRecord);

    const attemptRows = this.db
      .prepare(`SELECT payload_json FROM source_attempts WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as Array<{ payload_json: string }>;
    const attempts: SourceAttempt[] = attemptRows.map(
      (entry) => JSON.parse(entry.payload_json) as SourceAttempt
    );

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

    for (const attempt of attempts) {
      sourceStatusBreakdown[attempt.source_access_status] += 1;
      authModeBreakdown[attempt.access_mode] += 1;
    }

    return {
      run: this.mapRun(row),
      records,
      attempts,
      sourceStatusBreakdown,
      authModeBreakdown
    };
  }

  public getRun(runId: string): RunEntity | null {
    const row = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, pinned, pinned_at, error, report_path, results_path, created_at, updated_at
         FROM runs WHERE id = ?`
      )
      .get(runId) as RunRow | undefined;

    if (!row) return null;
    return this.mapRun(row);
  }

  public cachePage(urlHash: string, url: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO page_cache (url_hash, url, payload_json, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(url_hash)
         DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`
      )
      .run(urlHash, url, JSON.stringify(payload), new Date().toISOString());
  }

  public readPageCache(urlHash: string): unknown | null {
    const row = this.db.prepare(`SELECT payload_json FROM page_cache WHERE url_hash = ?`).get(urlHash) as
      | { payload_json: string }
      | undefined;

    return row ? JSON.parse(row.payload_json) : null;
  }

  private getRunDirectorySizeBytes(runId: string): number {
    return this.getDirectorySizeBytes(path.join(this.runsRoot, runId));
  }

  private getDirectorySizeBytes(targetPath: string): number {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
      return 0;
    }

    let total = 0;
    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        total += this.getDirectorySizeBytes(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        total += fs.statSync(entryPath).size;
      } catch {
        // Ignore files that disappear while summarizing usage.
      }
    }
    return total;
  }

  private getLastCleanupObservation(): StorageCleanupObservation | null {
    const row = this.db
      .prepare(`SELECT value_json FROM storage_metadata WHERE key = ?`)
      .get(LAST_CLEANUP_METADATA_KEY) as StorageMetadataRow | undefined;
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.value_json) as StorageCleanupObservation;
    } catch {
      return null;
    }
  }

  private setLastCleanupObservation(observation: StorageCleanupObservation): void {
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO storage_metadata (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(LAST_CLEANUP_METADATA_KEY, JSON.stringify(observation), updatedAt);
  }

  private mapRun(row: RunRow): RunEntity {
    return {
      id: row.id,
      runType: row.run_type,
      query: JSON.parse(row.query_json) as ResearchQuery,
      status: row.status,
      pinned: Boolean(row.pinned),
      pinnedAt: row.pinned_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error ?? undefined,
      reportPath: row.report_path ?? undefined,
      resultsPath: row.results_path ?? undefined
    };
  }

  private listPinnedRunIds(): string[] {
    const rows = this.db.prepare(`SELECT id FROM runs WHERE pinned = 1`).all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private setRunPinned(runId: string, pinned: boolean): RunEntity | null {
    const now = new Date().toISOString();
    const result = this.withBusyRetry(() =>
      this.db
        .prepare(
          `UPDATE runs
           SET pinned = ?,
               pinned_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(pinned ? 1 : 0, pinned ? now : null, now, runId)
    );

    if (result.changes === 0) {
      return null;
    }

    this.syncRunManifestPromotionState(runId, pinned);
    const run = this.getRun(runId);
    if (run?.status === "completed") {
      this.runArtifactGc();
    }
    return run;
  }

  private syncRunManifestPromotionState(runId: string, pinned: boolean): void {
    const manifestPath = path.join(this.runsRoot, runId, ARTIFACT_MANIFEST_FILE);
    const manifest = readArtifactManifest(manifestPath);
    if (!manifest) {
      return;
    }

    const nextPromotionState = pinned ? "promoted" : "standard";
    let mutated = false;
    for (const item of manifest.items) {
      if (item.promotion_state !== nextPromotionState) {
        item.promotion_state = nextPromotionState;
        mutated = true;
      }
    }

    if (mutated) {
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    }
  }

}
