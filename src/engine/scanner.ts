/**
 * Concurrent scan runner with live progress callbacks and cancellation.
 * Results stream in completion order (like Maigret's async output).
 *
 * Rate-limited sites (HTTP 429) are retried before the scan completes:
 * servers often clear short bans within seconds, and a claimed hit hiding
 * behind a 429 must not silently become an "error" in the exported report.
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
  onResult?: (
    result: CheckResult,
    progress: ScanProgress,
    meta?: { retryPass: number },
  ) => void;
  /** Fired before each retry pass over rate-limited sites. */
  onRetry?: (info: { pass: number; count: number }) => void;
  /** Retry 429s (default true). */
  retryRateLimited?: boolean;
  /** Extra passes over rate-limited sites (default 1). */
  maxRetries?: number;
  /** Wait between passes so short bans can clear (default 3000ms). */
  retryDelayMs?: number;
}

export interface ScanProgress {
  completed: number;
  total: number;
  hits: number;
}

export interface ScanSummary extends ScanProgress {
  results: CheckResult[];
  cancelled: boolean;
  /** How many retry passes actually ran. */
  retryPasses: number;
}

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

function delay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!aborted(signal));
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(!aborted(signal));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    if (aborted(signal)) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function runScan(job: ScanJob): Promise<ScanSummary> {
  const {
    username,
    sites,
    timeoutMs,
    concurrency,
    fetchFn,
    signal,
    onResult,
    onRetry,
    retryRateLimited = true,
    maxRetries = 1,
    retryDelayMs = 3000,
  } = job;
  const total = sites.length;
  const results: CheckResult[] = [];
  let completed = 0;
  let hits = 0;
  let cancelled = false;
  let retryPasses = 0;

  const checkOne = async (
    siteName: string,
    site: MaigretSite,
  ): Promise<CheckResult> => {
    try {
      return await checkSite(siteName, site, username, {
        timeoutMs,
        fetchFn,
      });
    } catch {
      return {
        siteName,
        url: site.urlProbe ?? site.url,
        profileUrl: site.url,
        status: "error",
        error: "network",
        elapsedMs: 0,
      };
    }
  };

  const record = (result: CheckResult, retryPass: number) => {
    const existing = results.findIndex((r) => r.siteName === result.siteName);
    if (existing >= 0) {
      if (results[existing]?.status === "claimed") hits -= 1;
      results[existing] = result;
    } else {
      results.push(result);
      completed += 1;
    }
    if (result.status === "claimed") hits += 1;
    onResult?.(result, { completed, total, hits }, { retryPass });
  };

  const runPool = async (
    entries: [string, MaigretSite][],
    retryPass: number,
  ) => {
    let cursor = 0;
    const worker = async () => {
      while (true) {
        if (aborted(signal)) {
          cancelled = true;
          return;
        }
        const index = cursor++;
        if (index >= entries.length) return;
        const entry = entries[index];
        if (!entry) return;
        const [siteName, site] = entry;
        const result = await checkOne(siteName, site);
        if (aborted(signal)) {
          cancelled = true;
          return;
        }
        record(result, retryPass);
      }
    };
    const poolSize = Math.max(
      1,
      Math.min(concurrency, Math.max(entries.length, 1)),
    );
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  };

  await runPool(sites, 0);

  // Retry passes: only rate-limited sites, replaced in place.
  if (retryRateLimited && maxRetries > 0) {
    for (let pass = 1; pass <= maxRetries; pass += 1) {
      if (aborted(signal)) {
        cancelled = true;
        break;
      }
      const limited = sites.filter(([name]) => {
        const current = results.find((r) => r.siteName === name);
        return current?.status === "error" && current.error === "rate_limited";
      });
      if (limited.length === 0) break;
      onRetry?.({ pass, count: limited.length });
      const settled = await delay(retryDelayMs, signal);
      if (!settled) {
        cancelled = true;
        break;
      }
      retryPasses += 1;
      await runPool(limited, pass);
    }
  }

  return { completed, total, hits, results, cancelled, retryPasses };
}
