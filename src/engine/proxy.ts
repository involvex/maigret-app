/**
 * Proxy configuration (settings input + validation).
 *
 * MVP reality: React Native's `fetch` does not honor SOCKS5/HTTP proxy
 * env vars. The proxy URL is therefore validated, persisted and forwarded
 * to the engine settings so a future native layer (OkHttp Proxy / Orbot
 * Tor gateway) can apply it — Phase 5 work. Direct connections are used
 * until then and the UI states this explicitly.
 */
export interface ParsedProxy {
  scheme: "http" | "https" | "socks5" | "socks5h";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const DEFAULT_PORTS: Record<ParsedProxy["scheme"], number> = {
  http: 8080,
  https: 8080,
  socks5: 1080,
  socks5h: 1080,
};

export function parseProxyUrl(raw: string): ParsedProxy {
  const value = raw.trim();
  if (!value) throw new Error("Proxy URL is empty");
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `socks5://${value}`);
  } catch {
    throw new Error(
      "Proxy URL is not valid (expected host:port or scheme://host:port)",
    );
  }
  const scheme = url.protocol
    .replace(":", "")
    .toLowerCase() as ParsedProxy["scheme"];
  if (!["http", "https", "socks5", "socks5h"].includes(scheme)) {
    throw new Error(
      `Unsupported proxy scheme "${scheme}" (use http/https/socks5)`,
    );
  }
  if (!url.hostname) throw new Error("Proxy URL is missing a host");
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[scheme];
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Proxy port is out of range (1-65535)");
  }
  return {
    scheme,
    host: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

/** Short human-readable label, e.g. "socks5://127.0.0.1:9050". Never includes credentials. */
export function formatProxyLabel(proxy: ParsedProxy): string {
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

/** Tor convention used by Maigret docs: socks5://127.0.0.1:9050 (via Orbot on Android). */
export const TOR_DEFAULT_PROXY = "socks5://127.0.0.1:9050";
