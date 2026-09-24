import { describe, expect, test } from "bun:test";
import { formatProxyLabel, parseProxyUrl } from "../proxy";

describe("parseProxyUrl", () => {
  test("accepts full socks5 URLs", () => {
    expect(parseProxyUrl("socks5://127.0.0.1:9050")).toEqual({
      scheme: "socks5",
      host: "127.0.0.1",
      port: 9050,
      username: undefined,
      password: undefined,
    });
  });

  test("bare host:port defaults to socks5", () => {
    const p = parseProxyUrl("127.0.0.1:1080");
    expect(p.scheme).toBe("socks5");
    expect(p.port).toBe(1080);
  });

  test("label never leaks credentials", () => {
    const label = formatProxyLabel(
      parseProxyUrl("http://user:secret@proxy.example:8080"),
    );
    expect(label).toBe("http://proxy.example:8080");
    expect(label).not.toContain("secret");
  });

  test("rejects unsupported schemes and bad ports", () => {
    expect(() => parseProxyUrl("ftp://x:21")).toThrow();
    expect(() => parseProxyUrl("")).toThrow();
  });
});
