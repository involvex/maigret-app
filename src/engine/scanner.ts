/**
 * Concurrent scan runner with live progress callbacks and cancellation.
 * Results stream in completion order (like Maigret's async output).
 *
 * Throttled sites are retried before the scan completes with exponential
 * backoff: servers often clear short bans within seconds, and a claimed
 * hit hiding behind a 429/999 must not silently become an "error" in the
 * exported report. Hard blocks (captcha markers) are never retried.
 */
import type { CheckResult, FetchLike, MaigretSite } from "./types";
import { checkSite } from "./checker";

/** Transport-level throttling worth another attempt. */
export const RETRYABLE_ERRORS: ReadonlySet<string> = new Set([
  "rate_limited", // HTTP 429 and LinkedIn-style 999
  "http_503",
  "http_403", // transient WAF throttles; captcha pages classify as "blocked"
]);

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
  /** Retry throttled sites (default true). */
  retryRateLimited?: boolean;
  /** Extra passes over throttled sites (default 2). */
  maxRetries?: number;
  /** Base wait between passes, doubled per pass plus jitter (default 3000ms). */
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
    maxRetries = 2,
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

  // Retry passes: only throttled sites, replaced in place, with
  // exponential backoff (base × 2^(pass-1)) plus bounded jitter.
  if (retryRateLimited && maxRetries > 0) {
    for (let pass = 1; pass <= maxRetries; pass += 1) {
      if (aborted(signal)) {
        cancelled = true;
        break;
      }
      const limited = sites.filter(([name]) => {
        const current = results.find((r) => r.siteName === name);
        return (
          current?.status === "error" &&
          RETRYABLE_ERRORS.has(current.error ?? "")
        );
      });
      if (limited.length === 0) break;
      onRetry?.({ pass, count: limited.length });
      const base = retryDelayMs * 2 ** (pass - 1);
      const wait = base + Math.random() * Math.min(1000, base);
      const settled = await delay(wait, signal);
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
