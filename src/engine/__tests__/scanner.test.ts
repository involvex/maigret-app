import { describe, expect, test } from "bun:test";
import { runScan } from "../scanner";
import type { CheckResult, FetchLike, MaigretSite } from "../types";

function site(rank: number): MaigretSite {
  return {
    url: `https://s${rank}.example/{username}`,
    urlMain: `https://s${rank}.example`,
  };
}

const okFetch: FetchLike = async (input) => ({
  status: 200,
  url: String(input),
  text: async () => "hello",
});

const flakyFetch: FetchLike = async () => {
  throw new Error("boom");
};

describe("runScan", () => {
  test("streams results and counts hits", async () => {
    const sites = Array.from(
      { length: 10 },
      (_, i) => [`s${i}`, site(i)] as [string, MaigretSite],
    );
    const seen: CheckResult[] = [];
    const summary = await runScan({
      username: "alice",
      sites,
      timeoutMs: 5000,
      concurrency: 3,
      fetchFn: okFetch,
      onResult: (r) => seen.push(r),
    });
    expect(summary.total).toBe(10);
    expect(summary.completed).toBe(10);
    expect(summary.hits).toBe(10);
    expect(seen).toHaveLength(10);
    expect(summary.cancelled).toBe(false);
  });

  test("transport failures become error results, not throws", async () => {
    const summary = await runScan({
      username: "alice",
      sites: [["s0", site(0)]],
      timeoutMs: 5000,
      concurrency: 1,
      fetchFn: flakyFetch,
    });
    expect(summary.results[0]?.status).toBe("error");
    expect(summary.results[0]?.error).toBe("network");
  });

  test("aborted scans report cancelled", async () => {
    const slowFetch: FetchLike = async (input) => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200, url: String(input), text: async () => "" };
    };
    const controller = new AbortController();
    const sites = Array.from(
      { length: 20 },
      (_, i) => [`s${i}`, site(i)] as [string, MaigretSite],
    );
    setTimeout(() => controller.abort(), 10);
    const summary = await runScan({
      username: "alice",
      sites,
      timeoutMs: 5000,
      concurrency: 2,
      fetchFn: slowFetch,
      signal: controller.signal,
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.completed).toBeLessThan(20);
  });
});

describe("rate-limit retries", () => {
  function flakyThenOk(): { fetch: FetchLike; calls: Map<string, number> } {
    const calls = new Map<string, number>();
    const fetch: FetchLike = async (input) => {
      const url = String(input);
      const n = (calls.get(url) ?? 0) + 1;
      calls.set(url, n);
      if (n === 1) {
        return { status: 429, url, text: async () => "slow down" };
      }
      return { status: 200, url, text: async () => "hello" };
    };
    return { fetch, calls };
  }

  test("429s are re-checked once and replaced in place", async () => {
    const { fetch } = flakyThenOk();
    const seen: { site: string; pass: number }[] = [];
    const retries: { pass: number; count: number }[] = [];
    const summary = await runScan({
      username: "alice",
      sites: [
        ["s0", site(0)],
        ["s1", site(1)],
      ],
      timeoutMs: 5000,
      concurrency: 2,
      fetchFn: fetch,
      retryDelayMs: 0,
      onResult: (r, _p, meta) =>
        seen.push({ site: r.siteName, pass: meta?.retryPass ?? 0 }),
      onRetry: (info) => retries.push(info),
    });
    expect(summary.retryPasses).toBe(1);
    expect(retries).toEqual([{ pass: 1, count: 2 }]);
    // 2 initial + 2 retry emissions, completed counts each site once.
    expect(seen).toHaveLength(4);
    expect(seen.filter((s) => s.pass === 1)).toHaveLength(2);
    expect(summary.completed).toBe(2);
    expect(summary.hits).toBe(2);
    expect(summary.results.every((r) => r.status === "claimed")).toBe(true);
  });

  test("no retry when disabled", async () => {
    const { fetch } = flakyThenOk();
    const summary = await runScan({
      username: "alice",
      sites: [["s0", site(0)]],
      timeoutMs: 5000,
      concurrency: 1,
      fetchFn: fetch,
      retryRateLimited: false,
      retryDelayMs: 0,
    });
    expect(summary.retryPasses).toBe(0);
    expect(summary.results[0]?.status).toBe("error");
    expect(summary.results[0]?.error).toBe("rate_limited");
  });

  test("persistent 429s stop after maxRetries", async () => {
    const alwaysLimited: FetchLike = async (input) => ({
      status: 429,
      url: String(input),
      text: async () => "slow down",
    });
    const summary = await runScan({
      username: "alice",
      sites: [["s0", site(0)]],
      timeoutMs: 5000,
      concurrency: 1,
      fetchFn: alwaysLimited,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    expect(summary.retryPasses).toBe(2);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]?.error).toBe("rate_limited");
  });
});
