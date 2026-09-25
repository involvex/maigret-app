import { describe, expect, test } from "bun:test";
import { isDue, runWatchCycle, type WatchCycleDeps } from "../check";
import type { CheckResult } from "@/engine/types";
import type { WatchedRow } from "@/storage/db";

function result(site: string, status: CheckResult["status"]): CheckResult {
  return {
    siteName: site,
    url: `https://${site}/u`,
    profileUrl: `https://${site}/u`,
    status,
    elapsedMs: 1,
  };
}

function watched(
  username: string,
  overrides: Partial<WatchedRow> = {},
): WatchedRow {
  return {
    id: 1,
    username,
    enabled: 1,
    interval_minutes: 720,
    // New rows have never been checked (NULL in SQLite).
    last_checked_at: null,
    created_at: 0,
    ...overrides,
  };
}

interface Harness {
  deps: WatchCycleDeps;
  baseline: Map<string, Set<string>>;
  notified: { username: string; added: string[] }[];
  scans: { username: string; origin: string }[];
}

function harness(
  rows: WatchedRow[],
  claims: Record<string, string[]>,
): Harness {
  const baseline = new Map<string, Set<string>>();
  const notified: Harness["notified"] = [];
  const scans: Harness["scans"] = [];
  const deps: WatchCycleDeps = {
    listWatched: async () => rows,
    getSettings: async () => ({
      timeoutMs: 1000,
      concurrency: 2,
      maxSites: 0,
      tags: [],
      retryRateLimited: false,
      maxRetries: 0,
    }),
    getSites: async () => [["GitHub", { url: "", urlMain: "" }]],
    scan: async (username) => {
      const claimed = claims[username] ?? [];
      const results = claimed.map((s) => result(s, "claimed"));
      return {
        results,
        hits: results.length,
        completed: results.length || 1,
        cancelled: false,
      };
    },
    createScanRecord: async (username) => {
      scans.push({ username, origin: "watch" });
      return scans.length;
    },
    insertResults: async () => {},
    finishScanRecord: async () => {},
    getBaseline: async (username) => [...(baseline.get(username) ?? [])],
    addBaselineSites: async (username, sites) => {
      const set = baseline.get(username) ?? new Set<string>();
      for (const s of sites) set.add(s);
      baseline.set(username, set);
    },
    pruneBaseline: async (username, keep) => {
      baseline.set(username, new Set(keep));
    },
    updateLastChecked: async () => {},
    notify: async (username, added) => {
      notified.push({ username, added });
    },
  };
  return { deps, baseline, notified, scans };
}

describe("isDue", () => {
  test("never-checked is due, recent check is not", () => {
    const now = 1_000_000_000;
    expect(isDue(null, 720, now)).toBe(true);
    expect(isDue(now - 60_000, 720, now)).toBe(false);
    expect(isDue(now - 721 * 60_000, 720, now)).toBe(true);
  });
});

describe("runWatchCycle", () => {
  test("first run seeds silently", async () => {
    const h = harness([watched("alice")], { alice: ["GitHub"] });
    const report = await runWatchCycle(h.deps);
    expect(report.checked).toEqual(["alice"]);
    expect(report.alerted).toEqual([]);
    expect(h.notified).toEqual([]);
    expect(h.baseline.get("alice")).toEqual(new Set(["GitHub"]));
    expect(h.scans).toEqual([{ username: "alice", origin: "watch" }]);
  });

  test("new claim on later run fires an alert", async () => {
    const h = harness([watched("alice")], { alice: ["GitHub"] });
    await runWatchCycle(h.deps);
    h.deps.scan = async (username) => {
      void username;
      const results = [
        result("GitHub", "claimed"),
        result("GitLab", "claimed"),
      ];
      return { results, hits: 2, completed: 2, cancelled: false };
    };
    // Pretend a full interval passed by resetting last_checked.
    h.deps.listWatched = async () => [watched("alice", { last_checked_at: 0 })];
    const report = await runWatchCycle(h.deps);
    expect(report.alerted).toEqual([{ username: "alice", added: ["GitLab"] }]);
    expect(h.notified).toEqual([{ username: "alice", added: ["GitLab"] }]);
  });

  test("removals prune silently", async () => {
    const h = harness([watched("alice")], { alice: ["GitHub", "Dead"] });
    await runWatchCycle(h.deps);
    h.deps.scan = async () => {
      const results = [result("GitHub", "claimed")];
      return { results, hits: 1, completed: 1, cancelled: false };
    };
    h.deps.listWatched = async () => [watched("alice", { last_checked_at: 0 })];
    const report = await runWatchCycle(h.deps);
    expect(report.alerted).toEqual([]);
    expect(h.baseline.get("alice")).toEqual(new Set(["GitHub"]));
  });

  test("failed low-coverage run keeps baseline and records error", async () => {
    const h = harness([watched("alice")], { alice: ["GitHub"] });
    await runWatchCycle(h.deps);
    h.deps.scan = async () => ({
      results: [],
      hits: 0,
      completed: 0,
      cancelled: false,
    });
    h.deps.listWatched = async () => [watched("alice", { last_checked_at: 0 })];
    // entries.length is 1 -> coverage needs >= 1, completed 0 fails.
    const report = await runWatchCycle(h.deps);
    expect(report.alerted).toEqual([]);
    expect(report.errors).toEqual([
      { username: "alice", error: "low_coverage" },
    ]);
    expect(h.baseline.get("alice")).toEqual(new Set(["GitHub"]));
  });

  test("disabled and not-due usernames are skipped", async () => {
    const h = harness(
      [
        watched("off", { id: 1, enabled: 0 }),
        watched("fresh", { id: 2, last_checked_at: Date.now() }),
      ],
      {},
    );
    const report = await runWatchCycle(h.deps);
    expect(report.checked).toEqual([]);
    expect(h.scans).toEqual([]);
  });
});
