/**
 * Production wiring for the watch cycle. Imported by task.ts (headless)
 * and the Watch UI — never imported by unit tests (native modules).
 */
import { filterSites, runScan } from "@/engine";
import type { MaigretSite, ScanSettings } from "@/engine/types";
import {
  applyProxySettings,
  createNativeFetch,
  isNativeScannerAvailable,
} from "@/native/foreground";
import {
  addBaselineSites,
  createScan,
  finishScan,
  getBaseline,
  insertResults,
  listWatched,
  pruneBaseline,
  updateLastChecked,
} from "@/storage/db";
import { getActiveDb } from "@/storage/sites";
import { getScanSettings } from "@/storage/prefs";
import { fireNewHitsAlert } from "./notifications";
import type { WatchCycleDeps } from "./check";

export function defaultWatchDeps(): WatchCycleDeps {
  return {
    listWatched: () => listWatched(),
    getSettings: () => getScanSettings(),
    getSites: async (settings: ScanSettings) => {
      const active = await getActiveDb();
      return filterSites(active.db, {
        tags: settings.tags,
        maxSites: settings.maxSites,
      });
    },
    scan: async (
      username: string,
      entries: [string, MaigretSite][],
      settings: ScanSettings,
    ) => {
      const useNative = isNativeScannerAvailable();
      if (useNative) {
        await applyProxySettings(settings.proxyUrl);
      }
      const nativeFetch = useNative
        ? createNativeFetch(settings.timeoutMs)
        : null;
      return runScan({
        username,
        sites: entries,
        timeoutMs: settings.timeoutMs,
        concurrency: settings.concurrency,
        fetchFn: nativeFetch ?? undefined,
        retryRateLimited: settings.retryRateLimited,
        maxRetries: settings.maxRetries,
      });
    },
    createScanRecord: (
      username: string,
      total: number,
      settings: ScanSettings,
    ) => createScan(username, total, JSON.stringify(settings), "watch"),
    insertResults: (scanId, results) => insertResults(scanId, results),
    finishScanRecord: (scanId, summary) =>
      finishScan(scanId, {
        hits: summary.hits,
        completed: summary.completed,
        cancelled: summary.cancelled,
      }),
    getBaseline: (username: string) => getBaseline(username),
    addBaselineSites: (username: string, sites: string[]) =>
      addBaselineSites(username, sites),
    pruneBaseline: (username: string, keep: string[]) =>
      pruneBaseline(username, keep),
    updateLastChecked: (username: string) => updateLastChecked(username),
    notify: async (username: string, added: string[]) => {
      await fireNewHitsAlert(username, added);
    },
  };
}
