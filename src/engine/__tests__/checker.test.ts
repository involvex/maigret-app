import { describe, expect, test } from "bun:test";
import { classifyResponse, normalizeUrl } from "../checker";
import type { MaigretSite } from "../types";

const base: MaigretSite = {
  url: "https://example.com/{username}",
  urlMain: "https://example.com",
};

describe("status_code checks", () => {
  test("2xx is claimed", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "https://example.com/u",
        probeUrl: "https://example.com/u",
        body: "",
        site: { ...base, checkType: "status_code" },
      }).status,
    ).toBe("claimed");
  });

  test("404 is unclaimed", () => {
    expect(
      classifyResponse({
        status: 404,
        finalUrl: "",
        probeUrl: "",
        body: "not found",
        site: { ...base, checkType: "status_code" },
      }).status,
    ).toBe("unclaimed");
  });

  test("429 is a rate-limit error, not unclaimed", () => {
    const r = classifyResponse({
      status: 429,
      finalUrl: "",
      probeUrl: "",
      body: "",
      site: { ...base, checkType: "status_code" },
    });
    expect(r.status).toBe("error");
    expect(r.error).toBe("rate_limited");
  });

  test("999 (LinkedIn throttle) is a rate-limit error", () => {
    const r = classifyResponse({
      status: 999,
      finalUrl: "",
      probeUrl: "",
      body: "",
      site: { ...base, checkType: "status_code" },
    });
    expect(r.status).toBe("error");
    expect(r.error).toBe("rate_limited");
  });

  test("ignore403 maps 403 to unclaimed", () => {
    expect(
      classifyResponse({
        status: 403,
        finalUrl: "",
        probeUrl: "",
        body: "",
        site: { ...base, checkType: "status_code", ignore403: true },
      }).status,
    ).toBe("unclaimed");
  });

  test("engine sites fall back to the status rule", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "",
        probeUrl: "",
        body: "",
        site: { ...base, engine: "engine404" },
      }).status,
    ).toBe("claimed");
  });
});

describe("message checks", () => {
  const site: MaigretSite = {
    ...base,
    checkType: "message",
    absenceStrs: ["user does not exist"],
    // Upstream typo spelling must be honored.
    presenseStrs: [') | Codex"'],
  };

  test("absence string wins", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "",
        probeUrl: "",
        body: "sorry, user does not exist here",
        site,
      }).status,
    ).toBe("unclaimed");
  });

  test("presence string claims", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "",
        probeUrl: "",
        body: 'profile (xyz) | Codex"',
        site,
      }).status,
    ).toBe("claimed");
  });

  test("canonical presenceStrs spelling also works", () => {
    const s: MaigretSite = {
      ...base,
      checkType: "message",
      presenceStrs: ["Follow @user"],
    };
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "",
        probeUrl: "",
        body: "Follow @user today",
        site: s,
      }).status,
    ).toBe("claimed");
  });
});

describe("response_url checks", () => {
  const site: MaigretSite = { ...base, checkType: "response_url" };

  test("same URL is claimed", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "https://example.com/alice",
        probeUrl: "https://example.com/alice",
        body: "",
        site,
      }).status,
    ).toBe("claimed");
  });

  test("redirect away is unclaimed (trailing slash ignored)", () => {
    expect(
      classifyResponse({
        status: 200,
        finalUrl: "https://example.com/login",
        probeUrl: "https://example.com/alice/",
        body: "",
        site,
      }).status,
    ).toBe("unclaimed");
  });
});

describe("block detection", () => {
  test("per-site error markers map to blocked errors", () => {
    const site: MaigretSite = {
      ...base,
      checkType: "status_code",
      errors: { captcha: "Captcha required" },
    };
    const r = classifyResponse({
      status: 200,
      finalUrl: "",
      probeUrl: "",
      body: "please solve CAPTCHA",
      site,
    });
    expect(r.status).toBe("error");
    expect(r.error).toContain("blocked");
  });
});

describe("normalizeUrl", () => {
  test("ignores case, fragments and trailing slashes", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Alice/#x")).toBe(
      normalizeUrl("https://example.com/alice"),
    );
  });
});
