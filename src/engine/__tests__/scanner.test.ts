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
