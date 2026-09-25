/**
 * User preferences backed by expo-sqlite/kv-store (no extra native dep,
 * works in Expo Go). Keys are namespaced with `maigret.`.
 */
import Storage from "expo-sqlite/kv-store";
import { DEFAULT_SCAN_SETTINGS, type ScanSettings } from "@/engine/types";

const K_TIMEOUT = "maigret.timeoutMs";
const K_CONCURRENCY = "maigret.concurrency";
const K_MAX_SITES = "maigret.maxSites";
const K_TAGS = "maigret.tags";
const K_PROXY = "maigret.proxyUrl";
const K_RETRY = "maigret.retryRateLimited";
const K_MAX_RETRIES = "maigret.maxRetries";

function toInt(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Like toInt but allows 0 (used for maxRetries). */
function toClampedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function getScanSettings(): Promise<ScanSettings> {
  const [
    timeoutMs,
    concurrency,
    maxSites,
    tagsJson,
    proxyUrl,
    retryRaw,
    maxRetriesRaw,
  ] = await Promise.all([
    Storage.getItem(K_TIMEOUT),
    Storage.getItem(K_CONCURRENCY),
    Storage.getItem(K_MAX_SITES),
    Storage.getItem(K_TAGS),
    Storage.getItem(K_PROXY),
    Storage.getItem(K_RETRY),
    Storage.getItem(K_MAX_RETRIES),
  ]);
  let tags: string[] = [];
  try {
    const parsed: unknown = tagsJson ? JSON.parse(tagsJson) : [];
    if (Array.isArray(parsed))
      tags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    tags = [];
  }
  return {
    timeoutMs: toInt(timeoutMs, DEFAULT_SCAN_SETTINGS.timeoutMs),
    concurrency: Math.min(
      toInt(concurrency, DEFAULT_SCAN_SETTINGS.concurrency),
      50,
    ),
    maxSites: Math.max(0, toInt(maxSites, DEFAULT_SCAN_SETTINGS.maxSites)),
    tags,
    proxyUrl: proxyUrl?.trim() ? proxyUrl.trim() : undefined,
    retryRateLimited:
      retryRaw == null
        ? DEFAULT_SCAN_SETTINGS.retryRateLimited
        : retryRaw === "1",
    maxRetries: toClampedInt(
      maxRetriesRaw,
      DEFAULT_SCAN_SETTINGS.maxRetries,
      0,
      3,
    ),
  };
}

export async function setScanSettings(settings: ScanSettings): Promise<void> {
  await Promise.all([
    Storage.setItem(K_TIMEOUT, String(settings.timeoutMs)),
    Storage.setItem(K_CONCURRENCY, String(settings.concurrency)),
    Storage.setItem(K_MAX_SITES, String(settings.maxSites)),
    Storage.setItem(K_TAGS, JSON.stringify(settings.tags)),
    Storage.setItem(K_PROXY, settings.proxyUrl ?? ""),
    Storage.setItem(K_RETRY, settings.retryRateLimited ? "1" : "0"),
    Storage.setItem(K_MAX_RETRIES, String(settings.maxRetries)),
  ]);
}
