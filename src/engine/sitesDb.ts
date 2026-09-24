/**
 * Site-database loading, filtering and URL building.
 * Mirrors Maigret's default behavior: skip disabled sites, order by
 * traffic rank (alexaRank), honor tag filters.
 */
import type { MaigretDb, MaigretSite } from "./types";

export const MAIGRET_DB_URL =
  "https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json";

/** Bundled offline snapshot (top-ranked sites) shipped with the app. */
export async function loadBundledDb(): Promise<MaigretDb> {
  // Metro bundles static JSON via require.
  const data = require("@/assets/db/sites-top.json") as MaigretDb;
  return data;
}

export interface SiteFilter {
  tags?: string[];
  maxSites?: number;
  includeDisabled?: boolean;
}

export function filterSites(
  db: MaigretDb,
  filter: SiteFilter = {},
): [string, MaigretSite][] {
  const { tags = [], maxSites = 0, includeDisabled = false } = filter;
  const wanted = new Set(tags.map((t) => t.toLowerCase()));

  const entries = Object.entries(db.sites).filter(([, site]) => {
    if (!includeDisabled && site.disabled) return false;
    if (wanted.size > 0) {
      const siteTags = (site.tags ?? []).map((t) => t.toLowerCase());
      if (!siteTags.some((t) => wanted.has(t))) return false;
    }
    return true;
  });

  entries.sort(([nameA, a], [nameB, b]) => {
    const rankA =
      typeof a.alexaRank === "number" ? a.alexaRank : Number.MAX_SAFE_INTEGER;
    const rankB =
      typeof b.alexaRank === "number" ? b.alexaRank : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB);
  });

  return maxSites > 0 ? entries.slice(0, maxSites) : entries;
}

/**
 * Build the URL to probe. Maigret formats `{username}` directly into
 * `urlProbe` (falling back to `url`); we keep the username raw to match
 * upstream behavior for typical [a-z0-9_.-] usernames.
 */
export function buildProbeUrl(site: MaigretSite, username: string): string {
  const template = site.urlProbe ?? site.url;
  return template.replace(/\{username\}/g, username);
}

/** Display profile URL for the UI (always based on `url`, not `urlProbe`). */
export function buildProfileUrl(site: MaigretSite, username: string): string {
  return site.url.replace(/\{username\}/g, username);
}

/** True when the site's own regex rejects this username (Maigret: "Illegal"). */
export function isUsernameIllegal(
  site: MaigretSite,
  username: string,
): boolean {
  if (!site.regexCheck) return false;
  try {
    return !new RegExp(site.regexCheck).test(username);
  } catch {
    return false;
  }
}

/** Fetch the full upstream database (used by the Settings DB-update action). */
export async function fetchRemoteDb(
  fetchFn: typeof fetch,
  timeoutMs = 30000,
): Promise<MaigretDb> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(MAIGRET_DB_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`DB download failed with HTTP ${res.status}`);
    const data = (await res.json()) as MaigretDb;
    if (!data.sites || typeof data.sites !== "object") {
      throw new Error('Downloaded database has no "sites" object');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
