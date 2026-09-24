/**
 * Concurrent scan runner with live progress callbacks and cancellation.
 * Results stream in completion order (like Maigret's async output).
 */
import type { CheckResult, FetchLike, MaigretSite } from "./types";
import { checkSite } from "./checker";

export interface ScanJob {
  username: string;
  sites: [string, MaigretSite][];
  timeoutMs: number;
  concurrency: number;
  fetchFn?: FetchLike;
  signal?: AbortSignal;
  onResult?: (result: CheckResult, progress: ScanProgress) => void;
}

export interface ScanProgress {
  completed: number;
  total: number;
  hits: number;
}

export interface ScanSummary extends ScanProgress {
  results: CheckResult[];
  cancelled: boolean;
}

export async function runScan(job: ScanJob): Promise<ScanSummary> {
  const { username, sites, timeoutMs, concurrency, fetchFn, signal, onResult } =
    job;
  const total = sites.length;
  const results: CheckResult[] = [];
  let completed = 0;
  let hits = 0;
  let cancelled = false;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        cancelled = true;
        return;
      }
      const index = cursor++;
      if (index >= sites.length) return;
      const [siteName, site] = sites[index];
      let result: CheckResult;
      try {
        result = await checkSite(siteName, site, username, {
          timeoutMs,
          fetchFn,
        });
      } catch {
        result = {
          siteName,
          url: site.urlProbe ?? site.url,
          profileUrl: site.url,
          status: "error",
          error: "network",
          elapsedMs: 0,
        };
      }
      if (signal?.aborted) {
        cancelled = true;
        return;
      }
      results.push(result);
      completed += 1;
      if (result.status === "claimed") hits += 1;
      onResult?.(result, { completed, total, hits });
    }
  };

  const poolSize = Math.max(
    1,
    Math.min(concurrency, Math.max(sites.length, 1)),
  );
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return { completed, total, hits, results, cancelled };
}
