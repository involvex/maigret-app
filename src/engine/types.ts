/**
 * TypeScript port of the Maigret site-database schema
 * (upstream: https://github.com/soxoj/maigret `maigret/resources/data.json`).
 */

/** A single site entry from the Maigret database. */
export interface MaigretSite {
  url: string;
  urlMain: string;
  /** Preferred check URL, may differ from the profile URL. */
  urlProbe?: string;
  /** "message" | "status_code" | "response_url". Missing => engine/status fallback. */
  checkType?: string;
  /** Engine name for sites without an explicit checkType (e.g. "engine404"). */
  engine?: string;
  disabled?: boolean;
  tags?: string[];
  /** Per-site username allowlist regex. Non-match => "illegal", skip. */
  regexCheck?: string;
  /** Upstream typo is `presenseStrs`; both spellings are honored. */
  absenceStrs?: string[];
  presenseStrs?: string[];
  presenceStrs?: string[];
  /** Known block/captcha substrings mapped to a human-readable reason. */
  errors?: Record<string, string>;
  headers?: Record<string, string>;
  requestHeadOnly?: boolean;
  requestMethod?: string;
  ignore403?: boolean;
  alexaRank?: number;
  usernameClaimed?: string;
  usernameUnclaimed?: string;
}

export interface MaigretDb {
  sites: Record<string, MaigretSite>;
}

export type ClaimStatus = "claimed" | "unclaimed" | "illegal" | "error";

export interface CheckResult {
  siteName: string;
  /** The exact URL that was requested. */
  url: string;
  /** Human-facing profile URL shown in the UI. */
  profileUrl: string;
  status: ClaimStatus;
  httpStatus?: number;
  /** Machine-readable error reason: timeout | network | blocked | http_* */
  error?: string;
  elapsedMs: number;
}

export interface ScanSettings {
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Max parallel requests (mobile-friendly default). */
  concurrency: number;
  /** Max number of sites per scan (0 = no limit). */
  maxSites: number;
  /** Only scan sites carrying one of these tags (empty = all). */
  tags: string[];
  /** Proxy URL from settings, e.g. http://host:port or socks5://127.0.0.1:9050. */
  proxyUrl?: string;
  /** Re-check HTTP-429 sites once after a cooldown (default true). */
  retryRateLimited: boolean;
  /** Extra passes over throttled sites, 0-3 (default 2). */
  maxRetries: number;
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  timeoutMs: 15000,
  concurrency: 12,
  maxSites: 80,
  tags: [],
  retryRateLimited: true,
  maxRetries: 2,
};

/** Minimal fetch surface the engine needs (keeps checker unit-testable). */
export interface FetchLike {
  (input: string, init?: RequestInit): Promise<FetchLikeResponse>;
}

export interface FetchLikeResponse {
  status: number;
  url: string;
  text(): Promise<string>;
}
