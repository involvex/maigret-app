import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import { ResultRow } from "@/components/result-row";
import { ExportButtons } from "@/components/export-buttons";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { filterSites, parseProxyUrl, runScan } from "@/engine";
import type {
  CheckResult,
  FetchLike,
  MaigretDb,
  ScanSettings,
} from "@/engine/types";
import {
  applyProxySettings,
  beginScanService,
  createNativeFetch,
  endScanService,
  ensureNotificationPermission,
  isNativeScannerAvailable,
  updateScanService,
} from "@/native/foreground";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { createScan, finishScan, insertResults } from "@/storage/db";
import { getScanSettings, setScanSettings } from "@/storage/prefs";
import { getActiveDb } from "@/storage/sites";

type Filter = "all" | "hits";

function validateUsername(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter a username to scan.";
  if (value.length > 64) return "Username must be 64 characters or fewer.";
  if (/\s/.test(value)) return "Username must not contain whitespace.";
  return null;
}

export default function SearchScreen() {
  const theme = useTheme();
  const [username, setUsername] = useState("");
  const [proxyInput, setProxyInput] = useState("");
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [db, setDb] = useState<MaigretDb | null>(null);
  const [dbSource, setDbSource] = useState<"cache" | "bundled">("bundled");
  const [siteCount, setSiteCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [hits, setHits] = useState(0);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const [loadedSettings, active] = await Promise.all([
        getScanSettings(),
        getActiveDb(),
      ]);
      setSettings(loadedSettings);
      setDb(active.db);
      setDbSource(active.source);
      setSiteCount(active.siteCount);
      if (loadedSettings.proxyUrl) setProxyInput(loadedSettings.proxyUrl);
    })();
  }, []);

  const startScan = useCallback(async () => {
    const usernameError = validateUsername(username);
    if (usernameError) {
      setNotice(usernameError);
      return;
    }
    if (!settings || !db) {
      setNotice("Still loading settings and site database…");
      return;
    }
    const cleanProxy = proxyInput.trim();
    if (cleanProxy) {
      try {
        parseProxyUrl(cleanProxy);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Invalid proxy URL.");
        return;
      }
    }
    const nextSettings: ScanSettings = {
      ...settings,
      proxyUrl: cleanProxy || undefined,
    };
    setSettings(nextSettings);
    await setScanSettings(nextSettings);

    const name = username.trim();
    const sites = filterSites(db, {
      tags: nextSettings.tags,
      maxSites: nextSettings.maxSites,
    });
    if (sites.length === 0) {
      setNotice(
        "No sites match the current tag filter. Adjust it in Settings.",
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setCompleted(0);
    setHits(0);
    setTotal(sites.length);
    setFilter("all");

    // Native layer (dev/production builds): proxied OkHttp fetch + a
    // dataSync foreground service so the scan survives a locked screen.
    // Expo Go: direct connection, no keep-alive.
    const useNative = isNativeScannerAvailable();
    const proxyApplied = useNative
      ? await applyProxySettings(nextSettings.proxyUrl)
      : false;
    const nativeFetch: FetchLike | null = useNative
      ? createNativeFetch(nextSettings.timeoutMs)
      : null;
    let serviceActive = false;
    if (useNative) {
      const permitted = await ensureNotificationPermission();
      serviceActive = await beginScanService(
        `Scanning ${name}`,
        `0/${sites.length} sites checked`,
      );
      if (!permitted || !serviceActive) {
        setNotice(
          "Notification permission denied — the scan runs, but Android may pause it when locked.",
        );
      } else if (!nextSettings.proxyUrl) {
        setNotice(null);
      }
    }
    if (!useNative && nextSettings.proxyUrl) {
      setNotice(
        "Expo Go has no native layer: this scan uses a direct connection. Build a dev client to route via proxy.",
      );
    } else if (!useNative) {
      setNotice(null);
    } else if (nextSettings.proxyUrl && proxyApplied) {
      setNotice("Traffic is routed through the configured native proxy.");
    }

    const scanId = await createScan(
      name,
      sites.length,
      JSON.stringify(nextSettings),
    );
    const collected: CheckResult[] = [];
    let lastServiceUpdate = 0;
    try {
      const summary = await runScan({
        username: name,
        sites,
        timeoutMs: nextSettings.timeoutMs,
        concurrency: nextSettings.concurrency,
        fetchFn: nativeFetch ?? undefined,
        signal: controller.signal,
        onResult: (result, progress) => {
          collected.push(result);
          setResults((prev) => [...prev, result]);
          setCompleted(progress.completed);
          setHits(progress.hits);
          if (
            serviceActive &&
            (progress.completed - lastServiceUpdate >= 5 ||
              progress.completed === progress.total)
          ) {
            lastServiceUpdate = progress.completed;
            void updateScanService(
              `Scanning ${name}`,
              `${progress.completed}/${progress.total} sites · ${progress.hits} hits`,
            );
          }
        },
      });
      await insertResults(scanId, collected);
      await finishScan(scanId, {
        hits: summary.hits,
        completed: summary.completed,
        cancelled: summary.cancelled,
      });
      setNotice(
        summary.cancelled
          ? `Scan cancelled after ${summary.completed}/${summary.total} sites. Partial results saved to History.`
          : `Scan finished: ${summary.hits} hit${summary.hits === 1 ? "" : "s"} on ${summary.total} sites. Saved to History.`,
      );
    } catch {
      setNotice(
        "Scan failed unexpectedly. Partial results were saved to History.",
      );
      try {
        await insertResults(scanId, collected);
        await finishScan(scanId, {
          hits,
          completed: collected.length,
          cancelled: true,
        });
      } catch {
        // Storage failure on top of a scan failure: surface the scan error only.
      }
    } finally {
      if (serviceActive) {
        await endScanService();
      }
      abortRef.current = null;
      setRunning(false);
    }
  }, [username, proxyInput, settings, db, hits]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const openUrl = useCallback(async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setNotice("Could not open the profile URL.");
    }
  }, []);

  const visibleResults = useMemo(
    () =>
      filter === "hits"
        ? results.filter((r) => r.status === "claimed")
        : results,
    [results, filter],
  );

  const progress = total > 0 ? completed / total : 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.inner}>
          <ThemedText type="subtitle">Maigret</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {siteCount > 0
              ? `${siteCount} sites ready (${dbSource === "cache" ? "updated DB" : "offline snapshot"}) · for lawful OSINT use only`
              : "Loading site database…"}
          </ThemedText>

          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="username to investigate"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!running}
            onSubmitEditing={startScan}
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          />
          <TextInput
            value={proxyInput}
            onChangeText={setProxyInput}
            placeholder="SOCKS5/HTTP proxy (optional, e.g. socks5://127.0.0.1:9050)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!running}
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          />

          {notice ? (
            <ThemedText type="small" themeColor="textSecondary">
              {notice}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            {!running ? (
              <Pressable
                onPress={startScan}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: theme.success,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText type="smallBold" style={styles.buttonText}>
                  Start scan
                </ThemedText>
              </Pressable>
            ) : (
              <Pressable
                onPress={cancelScan}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.error, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <ThemedText type="smallBold" style={styles.buttonText}>
                  Cancel
                </ThemedText>
              </Pressable>
            )}
          </View>

          {(running || total > 0) && (
            <View>
              <ThemedText type="small" themeColor="textSecondary">
                {completed}/{total} sites · {hits} hit{hits === 1 ? "" : "s"}
              </ThemedText>
              <View
                style={[
                  styles.track,
                  { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${Math.round(progress * 100)}%`,
                      backgroundColor: theme.success,
                    },
                  ]}
                />
              </View>
              <View style={styles.filters}>
                {(["all", "hits"] as Filter[]).map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          filter === f
                            ? theme.backgroundSelected
                            : "transparent",
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <ThemedText type="small">
                      {f === "all"
                        ? `All (${results.length})`
                        : `Hits (${hits})`}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {!running && results.length > 0 && (
                <ExportButtons
                  username={username.trim()}
                  results={results.map((r) => ({
                    site: r.siteName,
                    url: r.url,
                    profileUrl: r.profileUrl,
                    status: r.status,
                    httpStatus: r.httpStatus,
                    error: r.error,
                  }))}
                  onNotice={setNotice}
                />
              )}
            </View>
          )}

          <FlatList
            data={visibleResults}
            keyExtractor={(item, index) => `${item.siteName}-${index}`}
            renderItem={({ item }) => (
              <ResultRow result={item} onOpen={openUrl} />
            )}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={{ height: Spacing.two }} />
            )}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  inner: {
    flex: 1,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#09090b",
  },
  track: {
    height: 6,
    borderRadius: 3,
    marginTop: Spacing.one,
    overflow: "hidden",
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  filters: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  list: {
    paddingBottom: Spacing.six,
    paddingTop: Spacing.one,
  },
});
