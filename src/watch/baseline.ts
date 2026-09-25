/**
 * Baseline diffing for watch alerts.
 *
 * Identity is the site NAME (stable across URL/probe changes). The caller
 * (watch cycle) decides alerting policy; this module only reports set
 * changes. Convention used by the cycle:
 * - empty previous baseline + non-empty current => first run, seed silently
 * - `added` => fire an alert
 * - `removed` => prune silently (account deleted, never alerted)
 */
import type { CheckResult } from "@/engine/types";

export interface BaselineDiff {
  /** Currently claimed site names, sorted. */
  current: string[];
  /** Claimed now but absent from the baseline. Sorted. */
  added: string[];
  /** In the baseline but no longer claimed. Sorted. */
  removed: string[];
}

export function claimedSites(results: CheckResult[]): string[] {
  const names = new Set<string>();
  for (const r of results) {
    if (r.status === "claimed") names.add(r.siteName);
  }
  return [...names].sort();
}

export function diffBaseline(
  previous: Set<string> | string[],
  results: CheckResult[],
): BaselineDiff {
  const prev = previous instanceof Set ? previous : new Set(previous);
  const current = claimedSites(results);
  const currentSet = new Set(current);
  const added = current.filter((s) => !prev.has(s));
  const removed = [...prev].filter((s) => !currentSet.has(s)).sort();
  return { current, added, removed };
}
