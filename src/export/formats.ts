/**
 * Maigret-style report export (mirrors `--json` / `--csv` / `--txt`).
 * Pure functions — unit-tested, no native dependencies.
 */

export interface ExportRow {
  site: string;
  url: string;
  profileUrl: string;
  status: string;
  httpStatus?: number | null;
  error?: string | null;
}

export type ExportFormat = "json" | "csv" | "txt";

export function toJson(
  username: string,
  results: ExportRow[],
  meta: { exportedAt?: number; siteCount?: number } = {},
): string {
  const hits = results.filter((r) => r.status === "claimed");
  return JSON.stringify(
    {
      username,
      exportedAt: new Date(meta.exportedAt ?? Date.now()).toISOString(),
      totalSites: meta.siteCount ?? results.length,
      hits: hits.length,
      results: results.map((r) => ({
        site: r.site,
        url: r.profileUrl,
        status: r.status,
        httpStatus: r.httpStatus ?? null,
        error: r.error ?? null,
      })),
    },
    null,
    2,
  );
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(results: ExportRow[]): string {
  const header = "site,profile_url,status,http_status,error";
  const lines = results.map((r) =>
    [
      csvCell(r.site),
      csvCell(r.profileUrl),
      csvCell(r.status),
      csvCell(r.httpStatus),
      csvCell(r.error),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

/** Hit list with profile URLs, like `maigret --txt`. */
export function toTxt(username: string, results: ExportRow[]): string {
  const hits = results.filter((r) => r.status === "claimed");
  const lines = [
    `Maigret scan: ${username}`,
    `Hits: ${hits.length}/${results.length}`,
    "",
  ];
  for (const hit of hits) {
    lines.push(`[+] ${hit.site}: ${hit.profileUrl}`);
  }
  if (hits.length === 0) {
    lines.push("No accounts found.");
  }
  return lines.join("\n");
}

export function formatExport(
  format: ExportFormat,
  username: string,
  results: ExportRow[],
): string {
  switch (format) {
    case "json":
      return toJson(username, results, { siteCount: results.length });
    case "csv":
      return toCsv(results);
    case "txt":
      return toTxt(username, results);
  }
}

const EXTENSIONS: Record<ExportFormat, string> = {
  json: "json",
  csv: "csv",
  txt: "txt",
};

export function buildExportFilename(
  username: string,
  format: ExportFormat,
): string {
  const safe =
    username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "scan";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  return `maigret_${safe}_${stamp}.${EXTENSIONS[format]}`;
}
