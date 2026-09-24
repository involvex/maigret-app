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

function toInt(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getScanSettings(): Promise<ScanSettings> {
  const [timeoutMs, concurrency, maxSites, tagsJson, proxyUrl] =
    await Promise.all([
      Storage.getItem(K_TIMEOUT),
      Storage.getItem(K_CONCURRENCY),
      Storage.getItem(K_MAX_SITES),
      Storage.getItem(K_TAGS),
      Storage.getItem(K_PROXY),
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
  };
}

export async function setScanSettings(settings: ScanSettings): Promise<void> {
  await Promise.all([
    Storage.setItem(K_TIMEOUT, String(settings.timeoutMs)),
    Storage.setItem(K_CONCURRENCY, String(settings.concurrency)),
    Storage.setItem(K_MAX_SITES, String(settings.maxSites)),
    Storage.setItem(K_TAGS, JSON.stringify(settings.tags)),
    Storage.setItem(K_PROXY, settings.proxyUrl ?? ""),
  ]);
}
