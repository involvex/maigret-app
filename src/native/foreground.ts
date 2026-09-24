/**
 * App-side facade for the `maigret-foreground` native module.
 *
 * - Expo Go / web: every helper degrades to a no-op / null so scans run on
 *   plain React Native `fetch` (direct connection, no keep-alive).
 * - Dev / production builds: scans run behind a `dataSync` foreground
 *   service and HTTP goes through the module's OkHttp client, which is the
 *   only path that can apply SOCKS5 (Tor/Orbot) and authenticated proxies.
 */
import { PermissionsAndroid, Platform } from "react-native";
import {
  getNativeModule,
  isAvailable as isNativeModuleAvailable,
} from "maigret-foreground";
import type { FetchLike } from "@/engine/types";

export function isNativeScannerAvailable(): boolean {
  return Platform.OS === "android" && isNativeModuleAvailable();
}

/** Android 13+: foreground services need an approved notification permission. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Platform.Version < 33) return true;
  try {
    const current = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (current) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function beginScanService(
  title: string,
  body: string,
): Promise<boolean> {
  const native = getNativeModule();
  if (!native) return false;
  try {
    return await native.startService(title, body);
  } catch {
    return false;
  }
}

export async function updateScanService(
  title: string,
  body: string,
): Promise<void> {
  const native = getNativeModule();
  if (!native) return;
  try {
    await native.updateService(title, body);
  } catch {
    // Notification updates are best-effort; the scan continues regardless.
  }
}

export async function endScanService(): Promise<void> {
  const native = getNativeModule();
  if (!native) return;
  try {
    await native.stopService();
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Rebuilds the native OkHttp client around `proxyUrl` (or clears it).
 * No-op without the native module — the caller must fall back to direct
 * connections and say so in the UI.
 */
export async function applyProxySettings(proxyUrl?: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native) return false;
  try {
    if (proxyUrl && proxyUrl.trim()) {
      await native.setProxy(proxyUrl.trim());
    } else {
      await native.clearProxy();
    }
    return true;
  } catch {
    return false;
  }
}

interface AbortErrorLike extends Error {
  name: "AbortError";
}

function toAbortError(reason: string): AbortErrorLike {
  const error = new Error(reason) as AbortErrorLike;
  error.name = "AbortError";
  return error;
}

/**
 * FetchLike backed by native OkHttp. Timeouts are enforced natively, so the
 * JS-side AbortSignal is intentionally not forwarded (in-flight native calls
 * are bounded by `timeoutMs`); cancellation still stops the scan loop
 * between requests.
 */
export function createNativeFetch(timeoutMs: number): FetchLike | null {
  const native = getNativeModule();
  if (!native) return null;
  return async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      if (typeof (rawHeaders as Headers).forEach === "function") {
        (rawHeaders as Headers).forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(rawHeaders)) {
        for (const [key, value] of rawHeaders as [string, string][]) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, rawHeaders as Record<string, string>);
      }
    }
    const result = await native.fetchUrl({
      url: input,
      method: init?.method ?? "GET",
      headers,
      timeoutMs,
    });
    if (result.error) {
      if (result.error === "timeout") throw toAbortError("timeout");
      throw new Error(result.error);
    }
    return {
      status: result.status,
      url: result.url,
      text: async () => result.body,
    };
  };
}
