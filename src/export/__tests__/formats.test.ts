import { describe, expect, test } from "bun:test";
import {
  buildExportFilename,
  toCsv,
  toJson,
  toTxt,
  type ExportRow,
} from "../formats";

const rows: ExportRow[] = [
  {
    site: "GitHub",
    url: "https://api.github.com/users/blue",
    profileUrl: "https://github.com/blue",
    status: "claimed",
    httpStatus: 200,
  },
  {
    site: "GitLab",
    url: "https://gitlab.com/blue",
    profileUrl: "https://gitlab.com/blue",
    status: "unclaimed",
    httpStatus: 404,
  },
  {
    site: 'Weird "Site", Inc',
    url: "https://w.example/blue",
    profileUrl: "https://w.example/blue",
    status: "error",
    error: "timeout",
  },
];

describe("toJson", () => {
  test("includes metadata and all results", () => {
    const parsed = JSON.parse(toJson("blue", rows, { siteCount: 3 }));
    expect(parsed.username).toBe("blue");
    expect(parsed.hits).toBe(1);
    expect(parsed.totalSites).toBe(3);
    expect(parsed.results).toHaveLength(3);
  });
});

describe("toCsv", () => {
  test("quotes cells with commas and quotes", () => {
    const csv = toCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("site,profile_url,status,http_status,error");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('"Weird ""Site"", Inc"');
    expect(lines[3]?.endsWith(",timeout")).toBe(true);
  });
});

describe("toTxt", () => {
  test("lists hits only", () => {
    const txt = toTxt("blue", rows);
    expect(txt).toContain("[+] GitHub: https://github.com/blue");
    expect(txt).not.toContain("GitLab");
    expect(txt).toContain("Hits: 1/3");
  });

  test("handles zero hits", () => {
    expect(toTxt("blue", [])).toContain("No accounts found.");
  });
});

describe("buildExportFilename", () => {
  test("sanitizes usernames and adds extension", () => {
    const name = buildExportFilename("Blue Bear!", "csv");
    expect(name.startsWith("maigret_blue_bear_")).toBe(true);
    expect(name.endsWith(".csv")).toBe(true);
  });

  test("falls back for empty usernames", () => {
    expect(buildExportFilename("   ", "json")).toMatch(
      /^maigret_scan_.*\.json$/,
    );
  });
});
