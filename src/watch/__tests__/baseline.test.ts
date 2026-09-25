import { describe, expect, test } from "bun:test";
import { claimedSites, diffBaseline } from "../baseline";
import type { CheckResult } from "@/engine/types";

function result(site: string, status: CheckResult["status"]): CheckResult {
  return {
    siteName: site,
    url: `https://${site}/u`,
    profileUrl: `https://${site}/u`,
    status,
    elapsedMs: 1,
  };
}

describe("claimedSites", () => {
  test("collects only claimed names, deduped and sorted", () => {
    expect(
      claimedSites([
        result("Zebra", "claimed"),
        result("Alpha", "claimed"),
        result("Beta", "unclaimed"),
        result("Gamma", "error"),
        result("Alpha", "claimed"),
      ]),
    ).toEqual(["Alpha", "Zebra"]);
  });
});

describe("diffBaseline", () => {
  test("reports added and removed", () => {
    const diff = diffBaseline(new Set(["A", "B"]), [
      result("B", "claimed"),
      result("C", "claimed"),
      result("D", "unclaimed"),
    ]);
    expect(diff.added).toEqual(["C"]);
    expect(diff.removed).toEqual(["A"]);
    expect(diff.current).toEqual(["B", "C"]);
  });

  test("no changes means empty diff", () => {
    const diff = diffBaseline(["A"], [result("A", "claimed")]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("empty previous baseline marks everything added (caller seeds silently)", () => {
    const diff = diffBaseline(new Set(), [result("A", "claimed")]);
    expect(diff.added).toEqual(["A"]);
    expect(diff.removed).toEqual([]);
  });

  test("empty current run removes the whole baseline", () => {
    const diff = diffBaseline(["A", "B"], [result("A", "unclaimed")]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["A", "B"]);
    expect(diff.current).toEqual([]);
  });
});
