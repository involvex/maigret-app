/**
 * Resolves the site database used for scans: the downloaded full upstream
 * DB cached in SQLite when present, otherwise the bundled offline snapshot.
 */
import { loadBundledDb } from "@/engine/sitesDb";
import type { MaigretDb } from "@/engine/types";
import { kvGet, KV_SITES_DB, KV_SITES_DB_UPDATED_AT } from "./db";

export interface ActiveDb {
  db: MaigretDb;
  siteCount: number;
  source: "cache" | "bundled";
  updatedAt: number | null;
}

export async function getActiveDb(): Promise<ActiveDb> {
  const [raw, updatedAtRaw] = await Promise.all([
    kvGet(KV_SITES_DB),
    kvGet(KV_SITES_DB_UPDATED_AT),
  ]);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MaigretDb;
      if (parsed && typeof parsed.sites === "object") {
        return {
          db: parsed,
          siteCount: Object.keys(parsed.sites).length,
          source: "cache",
          updatedAt: updatedAtRaw ? Number(updatedAtRaw) : null,
        };
      }
    } catch {
      // Fall through to the bundled snapshot.
    }
  }
  const db = await loadBundledDb();
  return {
    db,
    siteCount: Object.keys(db.sites).length,
    source: "bundled",
    updatedAt: null,
  };
}
