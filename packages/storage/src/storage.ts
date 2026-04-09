import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { PriceRecord, ResearchQuery, RunEntity, RunStatus, SourceAttempt, SourceAccessStatus } from "@artbot/shared-types";

interface RunRow {
  id: string;
  run_type: "artist" | "work";
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

  public createRun(runType: "artist" | "work", query: ResearchQuery): RunEntity {
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

  public getRunRoot(runId: string): string {
    const target = path.join(this.runsRoot, runId);
    fs.mkdirSync(path.join(target, "evidence", "screenshots"), { recursive: true });
    fs.mkdirSync(path.join(target, "evidence", "raw"), { recursive: true });
    return target;
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
