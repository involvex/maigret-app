/**
 * Per-site username check. Ports Maigret's three `checkType` strategies:
 * - status_code: 2xx => claimed, 404/410 => unclaimed, blocks/errors => error
 * - message: absence strings => unclaimed, presence strings => claimed
 * - response_url: redirect away from the probe URL => unclaimed
 * Sites without a checkType (engine-based) fall back to the status rule.
 */
import type { CheckResult, ClaimStatus, FetchLike, MaigretSite } from "./types";
import { buildProbeUrl, buildProfileUrl, isUsernameIllegal } from "./sitesDb";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Generic block-page markers used when a site defines no explicit `errors`. */
const GENERIC_BLOCK_MARKERS = [
  "captcha",
  "cloudflare",
  "attention required",
  "access denied",
  "request blocked",
  "are you a robot",
  "verify you are human",
];

export interface ClassifyInput {
  checkType?: string;
  status: number;
  finalUrl: string;
  probeUrl: string;
  body: string;
  site: MaigretSite;
}

export function classifyResponse(input: ClassifyInput): {
  status: ClaimStatus;
  error?: string;
} {
  const { status, finalUrl, probeUrl, body, site } = input;
  const checkType = (
    input.checkType ??
    site.checkType ??
    site.engine ??
    ""
  ).toLowerCase();

  // Explicit per-site error markers (WAF / captcha / censorship) win over everything.
  if (site.errors) {
    for (const [marker, reason] of Object.entries(site.errors)) {
      if (marker && body.toLowerCase().includes(marker.toLowerCase())) {
        return { status: "error", error: `blocked: ${reason}` };
      }
    }
  }

  if (status === 429) return { status: "error", error: "rate_limited" };
  if (status >= 500) return { status: "error", error: `http_${status}` };
  if (status === 403 || status === 401) {
    if (site.ignore403) return { status: "unclaimed" };
    const lowered = body.toLowerCase();
    if (GENERIC_BLOCK_MARKERS.some((m) => lowered.includes(m))) {
      return { status: "error", error: "blocked" };
    }
    return { status: "error", error: `http_${status}` };
  }

  if (checkType === "response_url") {
    return normalizeUrl(finalUrl) === normalizeUrl(probeUrl)
      ? { status: "claimed" }
      : { status: "unclaimed" };
  }

  if (checkType === "message") {
    const absence = site.absenceStrs ?? [];
    if (absence.some((s) => s && body.includes(s))) {
      return { status: "unclaimed" };
    }
    const presence = [
      ...(site.presenseStrs ?? []),
      ...(site.presenceStrs ?? []),
    ];
    if (presence.length > 0) {
      return presence.some((s) => s && body.includes(s))
        ? { status: "claimed" }
        : { status: "unclaimed" };
    }
    // No markers defined: fall through to the status rule.
  }

  // status_code + engine fallback (engine404 behaves like a status check).
  if (status >= 200 && status < 300) return { status: "claimed" };
  if (status === 404 || status === 410) return { status: "unclaimed" };
  if (status >= 300 && status < 400) return { status: "claimed" };
  return { status: "error", error: `http_${status}` };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Ignore trailing slashes and fragments when comparing redirect targets.
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

export interface CheckOptions {
  timeoutMs: number;
  fetchFn?: FetchLike;
}

/**
 * Check a single site for `username`. Never throws: transport failures are
 * reported as `{ status: 'error' }` results (Maigret prints them as errors,
 * it does not abort the scan).
 */
export async function checkSite(
  siteName: string,
  site: MaigretSite,
  username: string,
  options: CheckOptions,
): Promise<CheckResult> {
  const started = Date.now();
  const profileUrl = buildProfileUrl(site, username);
  const probeUrl = buildProbeUrl(site, username);

  if (isUsernameIllegal(site, username)) {
    return {
      siteName,
      url: probeUrl,
      profileUrl,
      status: "illegal",
      elapsedMs: 0,
    };
  }

  const fetchFn: FetchLike =
    options.fetchFn ??
    ((input, init) => fetch(input, init) as unknown as Promise<never>);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const method = (
      site.requestMethod ?? (site.requestHeadOnly ? "HEAD" : "GET")
    ).toUpperCase();
    const res = await fetchFn(probeUrl, {
      method,
      headers: { ...DEFAULT_HEADERS, ...(site.headers ?? {}) },
      signal: controller.signal,
    });
    const body = method === "HEAD" ? "" : await res.text();
    const { status, error } = classifyResponse({
      status: res.status,
      finalUrl: res.url || probeUrl,
      probeUrl,
      body,
      site,
    });
    return {
      siteName,
      url: res.url || probeUrl,
      profileUrl,
      status,
      httpStatus: res.status,
      error,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    const aborted =
      e instanceof DOMException
        ? e.name === "AbortError"
        : (e as Error)?.name === "AbortError";
    return {
      siteName,
      url: probeUrl,
      profileUrl,
      status: "error",
      error: aborted ? "timeout" : "network",
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
