import { requireOptionalNativeModule } from "expo-modules-core";

export interface NativeFetchResult {
  status: number;
  url: string;
  body: string;
  error?: string | null;
}

export interface NativeFetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface MaigretForegroundNativeModule {
  startService(title: string, body: string): Promise<boolean>;
  updateService(title: string, body: string): Promise<boolean>;
  stopService(): Promise<boolean>;
  setProxy(url: string): Promise<boolean>;
  clearProxy(): Promise<boolean>;
  fetchUrl(options: NativeFetchOptions): Promise<NativeFetchResult>;
}

/**
 * Null in Expo Go / web / any build where the native module is not linked.
 * Every consumer must null-check via `isAvailable()`.
 */
const nativeModule =
  requireOptionalNativeModule<MaigretForegroundNativeModule>(
    "MaigretForeground",
  );

export function isAvailable(): boolean {
  return nativeModule != null;
}

export function getNativeModule(): MaigretForegroundNativeModule | null {
  return nativeModule;
}
