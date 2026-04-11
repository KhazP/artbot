import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type {
  ArtworkCluster,
  ArtworkImage,
  ClusterMembership,
  CrawlCheckpoint,
  FrontierItem,
  FrontierStatus,
  InventoryRecord,
  PriceRecord,
  PriceSemanticLane,
  ResearchQuery,
  ReviewItem,
  RunEntity,
  RunStatus,
  RunType,
  SourceAccessStatus,
  SourceAttempt,
  SourceHost
} from "@artbot/shared-types";

interface RunRow {
  id: string;
  run_type: RunType;
  query_json: string;
  status: RunStatus;
  error: string | null;
  report_path: string | null;
  results_path: string | null;
  created_at: string;
  updated_at: string;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
}

export interface RunDetails {
  run: RunEntity;
  records: PriceRecord[];
  attempts: SourceAttempt[];
  sourceStatusBreakdown: Record<SourceAccessStatus, number>;
  authModeBreakdown: Record<"anonymous" | "authorized" | "licensed", number>;
}

function nowIso(): string {
  return new Date().toISOString();
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

export class ArtbotStorage {
  private readonly db: DatabaseSync;
  private readonly runsRoot: string;

  constructor(databasePath: string, runsRoot: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(runsRoot, { recursive: true });

    this.db = new DatabaseSync(databasePath);
    this.runsRoot = runsRoot;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        run_type TEXT NOT NULL,
        query_json TEXT NOT NULL,
        status TEXT NOT NULL,
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
    `);

    this.ensureRunsColumn("lease_owner", "TEXT");
    this.ensureRunsColumn("lease_expires_at", "TEXT");
    this.ensureRunsColumn("heartbeat_at", "TEXT");
  }

  private ensureRunsColumn(columnName: "lease_owner" | "lease_expires_at" | "heartbeat_at", columnSqlType: "TEXT"): void {
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE runs ADD COLUMN ${columnName} ${columnSqlType}`);
  }

  public createRun(runType: RunType, query: ResearchQuery): RunEntity {
    const now = new Date().toISOString();
    const id = uuidv4();

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
      });

    return {
      id,
      runType,
      query,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
  }

  public getPendingRuns(limit = 5): RunEntity[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
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
        `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
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
            `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
             FROM runs
             WHERE status = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(status, cappedLimit) as unknown as RunRow[])
      : (this.db
          .prepare(
            `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
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
    const result = this.db
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
      .run(nowIso, workerId, leaseExpiresAt, nowIso, runId, nowIso);

    return result.changes > 0;
  }

  public heartbeatRun(runId: string, workerId: string, leaseMs = 120_000): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1, leaseMs)).toISOString();

    const result = this.db
      .prepare(
        `UPDATE runs
         SET updated_at = ?,
             heartbeat_at = ?,
             lease_expires_at = ?
         WHERE id = ?
           AND status = 'running'
           AND lease_owner = ?`
      )
      .run(nowIso, nowIso, leaseExpiresAt, runId, workerId);

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
      .run(reportPath, resultsPath, now, runId);
  }

  public failRun(runId: string, error: string): void {
    const now = new Date().toISOString();
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
      .run(error, now, runId);
  }

  public saveRecord(runId: string, record: PriceRecord): void {
    this.db
      .prepare(`INSERT INTO records (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), runId, JSON.stringify(record), new Date().toISOString());
  }

  public saveAttempt(runId: string, attempt: SourceAttempt): void {
    this.db
      .prepare(`INSERT INTO source_attempts (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), runId, JSON.stringify(attempt), new Date().toISOString());
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

  public enqueueFrontierItem(
    item: Omit<
      FrontierItem,
      "id" | "status" | "retry_count" | "revisit_after" | "last_error" | "created_at" | "updated_at"
    >
  ): FrontierItem {
    const now = nowIso();
    const canonicalKey = frontierCanonicalKey(item.url);
    const existing = this.db
      .prepare(`SELECT payload_json FROM crawl_frontier WHERE artist_key = ? AND canonical_key = ?`)
      .get(item.artist_key, canonicalKey) as { payload_json: string } | undefined;
    const existingItem = existing ? (JSON.parse(existing.payload_json) as FrontierItem) : null;
    const frontierItem: FrontierItem = {
      ...item,
      id: existingItem?.id ?? uuidv4(),
      status: existingItem?.status === "processing" ? "processing" : "pending",
      retry_count: existingItem?.retry_count ?? 0,
      revisit_after: existingItem?.revisit_after ?? null,
      last_error: existingItem?.last_error ?? null,
      created_at: existingItem?.created_at ?? now,
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
           status = CASE WHEN crawl_frontier.status = 'processing' THEN crawl_frontier.status ELSE 'pending' END,
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
        .prepare(`INSERT INTO artwork_clusters (id, artist_key, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
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

  public getRunDetails(runId: string): RunDetails | null {
    const row = this.db
      .prepare(
        `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
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
        `SELECT id, run_type, query_json, status, error, report_path, results_path, created_at, updated_at
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

  private mapRun(row: RunRow): RunEntity {
    return {
      id: row.id,
      runType: row.run_type,
      query: JSON.parse(row.query_json) as ResearchQuery,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error ?? undefined,
      reportPath: row.report_path ?? undefined,
      resultsPath: row.results_path ?? undefined
    };
  }

}
