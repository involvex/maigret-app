/**
 * SQLite persistence for scans and results (expo-sqlite, SDK 57 API).
 * Scan history survives restarts; the `kv` table caches the site database.
 */
import * as SQLite from "expo-sqlite";
import type { CheckResult } from "@/engine/types";

const DB_NAME = "maigret.db";
const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      const row = await db.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      const version = row?.user_version ?? 0;
      if (version < SCHEMA_VERSION) {
        await db.execAsync(`
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  total_sites INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  settings_json TEXT
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  site TEXT NOT NULL,
  url TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  error TEXT,
  elapsed_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_results_scan ON results(scan_id);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
PRAGMA user_version = 1;
`);
      }
      return db;
    })();
  }
  return dbPromise;
}

export interface ScanRow {
  id: number;
  username: string;
  started_at: number;
  finished_at: number | null;
  total_sites: number;
  hits: number;
  status: string;
}

export async function createScan(
  username: string,
  totalSites: number,
  settingsJson: string,
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    "INSERT INTO scans (username, started_at, total_sites, status, settings_json) VALUES (?, ?, ?, ?, ?)",
    [username, Date.now(), totalSites, "running", settingsJson],
  );
  return res.lastInsertRowId;
}

export async function finishScan(
  id: number,
  outcome: { hits: number; completed: number; cancelled: boolean },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE scans SET finished_at = ?, hits = ?, total_sites = ?, status = ? WHERE id = ?",
    [
      Date.now(),
      outcome.hits,
      outcome.completed,
      outcome.cancelled ? "cancelled" : "done",
      id,
    ],
  );
}

export async function insertResults(
  scanId: number,
  results: CheckResult[],
): Promise<void> {
  if (results.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of results) {
      await db.runAsync(
        "INSERT INTO results (scan_id, site, url, profile_url, status, http_status, error, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          scanId,
          r.siteName,
          r.url,
          r.profileUrl,
          r.status,
          r.httpStatus ?? null,
          r.error ?? null,
          r.elapsedMs,
        ],
      );
    }
  });
}

export async function listScans(limit = 50): Promise<ScanRow[]> {
  const db = await getDb();
  return db.getAllAsync<ScanRow>(
    "SELECT * FROM scans ORDER BY started_at DESC LIMIT ?",
    [limit],
  );
}

export interface ResultRow {
  id: number;
  site: string;
  url: string;
  profile_url: string;
  status: string;
  http_status: number | null;
  error: string | null;
  elapsed_ms: number;
}

export async function getScanResults(scanId: number): Promise<ResultRow[]> {
  const db = await getDb();
  return db.getAllAsync<ResultRow>(
    "SELECT * FROM results WHERE scan_id = ? ORDER BY CASE status WHEN ? THEN 0 ELSE 1 END, site ASC",
    [scanId, "claimed"],
  );
}

export async function deleteScan(id: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM results WHERE scan_id = ?", [id]);
    await db.runAsync("DELETE FROM scans WHERE id = ?", [id]);
  });
}

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export const KV_SITES_DB = "sitesDbJson";
export const KV_SITES_DB_UPDATED_AT = "sitesDbUpdatedAt";
