/**
 * Watch-cycle orchestrator: for each due watched username, run a scan,
 * diff the claimed set against the stored baseline, and alert on additions.
 *
 * Policy:
 * - First check for a username seeds the baseline SILENTLY (no alert for
 *   accounts the user already knows about).
 * - Removals prune silently (deleted accounts are not news).
 * - A run covering less than half its sites is treated as failed: baseline
 *   untouched (no wipe, no false alerts), error recorded in the report.
 *
 * All storage/notification side effects are injected so the cycle is fully
 * unit-testable without native modules.
 */
import { runScan } from "@/engine/scanner";
import type { CheckResult, MaigretSite, ScanSettings } from "@/engine/types";
import type { WatchedRow } from "@/storage/db";
import { diffBaseline } from "./baseline";

export interface ScanSummaryLike {
  results: CheckResult[];
  hits: number;
  completed: number;
  cancelled: boolean;
}

export interface WatchCycleDeps {
  listWatched: () => Promise<WatchedRow[]>;
  getSettings: () => Promise<ScanSettings>;
  getSites: (settings: ScanSettings) => Promise<[string, MaigretSite][]>;
  scan: (
    username: string,
    entries: [string, MaigretSite][],
    settings: ScanSettings,
  ) => Promise<ScanSummaryLike>;
  createScanRecord: (
    username: string,
    total: number,
    settings: ScanSettings,
  ) => Promise<number>;
  insertResults: (scanId: number, results: CheckResult[]) => Promise<void>;
  finishScanRecord: (
    scanId: number,
    summary: { hits: number; completed: number; cancelled: boolean },
  ) => Promise<void>;
  getBaseline: (username: string) => Promise<string[]>;
  addBaselineSites: (username: string, sites: string[]) => Promise<void>;
  pruneBaseline: (username: string, keep: string[]) => Promise<void>;
  updateLastChecked: (username: string) => Promise<void>;
  notify: (username: string, added: string[]) => Promise<unknown>;
}

export interface WatchCycleReport {
  checked: string[];
  alerted: { username: string; added: string[] }[];
  errors: { username: string; error: string }[];
}

/** Default production scan: engine defaults (retries + backoff included). */
export async function defaultScan(
  username: string,
  entries: [string, MaigretSite][],
  settings: ScanSettings,
): Promise<ScanSummaryLike> {
  return runScan({
    username,
    sites: entries,
    timeoutMs: settings.timeoutMs,
    concurrency: settings.concurrency,
    retryRateLimited: settings.retryRateLimited,
    maxRetries: settings.maxRetries,
  });
}

export function isDue(
  lastCheckedAt: number | null,
  intervalMinutes: number,
  now = Date.now(),
): boolean {
  if (lastCheckedAt == null) return true;
  return now - lastCheckedAt >= intervalMinutes * 60_000;
}

export async function runWatchCycle(
  deps: WatchCycleDeps,
): Promise<WatchCycleReport> {
  const report: WatchCycleReport = { checked: [], alerted: [], errors: [] };
  const watched = await deps.listWatched();
  if (watched.length === 0) return report;

  const settings = await deps.getSettings();
  const entries = await deps.getSites(settings);
  if (entries.length === 0) return report;

  for (const row of watched) {
    if (!row.enabled) continue;
    if (!isDue(row.last_checked_at, row.interval_minutes)) continue;
    const username = row.username;
    try {
      const scanId = await deps.createScanRecord(
        username,
        entries.length,
        settings,
      );
      const summary = await deps.scan(username, entries, settings);
      await deps.insertResults(scanId, summary.results);
      await deps.finishScanRecord(scanId, {
        hits: summary.hits,
        completed: summary.completed,
        cancelled: summary.cancelled,
      });

      const baseline = new Set(await deps.getBaseline(username));
      const isFirstRun = row.last_checked_at == null;
      const { added, current } = diffBaseline(baseline, summary.results);

      // Failed run (spotty network / mass blocks): keep the old baseline.
      const coverageOk =
        summary.completed >= Math.max(1, Math.floor(entries.length / 2));
      if (!coverageOk) {
        report.errors.push({ username, error: "low_coverage" });
      } else if (isFirstRun) {
        await deps.addBaselineSites(username, current);
      } else {
        if (added.length > 0) {
          await deps.notify(username, added);
          report.alerted.push({ username, added });
        }
        await deps.addBaselineSites(username, added);
        await deps.pruneBaseline(username, current);
      }
      await deps.updateLastChecked(username);
      report.checked.push(username);
    } catch (e) {
      report.errors.push({
        username,
        error: e instanceof Error ? e.message : "watch_failed",
      });
    }
  }
  return report;
}
