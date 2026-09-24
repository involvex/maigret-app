import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ExportButtons } from "@/components/export-buttons";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  deleteScan,
  getScanResults,
  listScans,
  type ResultRow,
  type ScanRow,
} from "@/storage/db";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function HistoryScreen() {
  const theme = useTheme();
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, ResultRow[]>>({});
  const [refreshing, setRefreshing] = useState(true);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setScans(await listScans());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listScans().then((rows) => {
      if (!cancelled) {
        setScans(rows);
        setRefreshing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (scan: ScanRow) => {
      if (expanded === scan.id) {
        setExpanded(null);
        return;
      }
      setExpanded(scan.id);
      if (!details[scan.id]) {
        const rows = await getScanResults(scan.id);
        setDetails((prev) => ({ ...prev, [scan.id]: rows }));
      }
    },
    [expanded, details],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteScan(id);
      setScans((prev) => prev.filter((s) => s.id !== id));
      if (expanded === id) setExpanded(null);
    },
    [expanded],
  );

  const openUrl = useCallback(async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // No-op: history links are best-effort.
    }
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.inner}>
          <ThemedText type="subtitle">History</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Past scans stay on this device.
          </ThemedText>
          <FlatList
            data={scans}
            keyExtractor={(item) => String(item.id)}
            refreshing={refreshing}
            onRefresh={reload}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={{ height: Spacing.two }} />
            )}
            ListEmptyComponent={
              !refreshing ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No scans yet — run one from Search.
                </ThemedText>
              ) : null
            }
            renderItem={({ item }) => {
              const isOpen = expanded === item.id;
              const rows = details[item.id] ?? [];
              return (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Pressable onPress={() => toggle(item)} style={styles.header}>
                    <View style={styles.headerText}>
                      <ThemedText type="smallBold">{item.username}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatDate(item.started_at)} · {item.hits} hit
                        {item.hits === 1 ? "" : "s"} / {item.total_sites} sites
                        · {item.status}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isOpen ? "▾" : "▸"}
                    </ThemedText>
                  </Pressable>
                  {isOpen && (
                    <View style={styles.details}>
                      {rows.length === 0 ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          Loading results…
                        </ThemedText>
                      ) : (
                        rows
                          .filter((r) => r.status === "claimed")
                          .map((r) => (
                            <Pressable
                              key={r.id}
                              onPress={() => openUrl(r.profile_url)}
                            >
                              <ThemedText
                                type="small"
                                style={{ color: theme.success }}
                              >
                                {r.site}
                              </ThemedText>
                            </Pressable>
                          ))
                      )}
                      {rows.length > 0 &&
                        rows.every((r) => r.status !== "claimed") && (
                          <ThemedText type="small" themeColor="textSecondary">
                            No hits in this scan.
                          </ThemedText>
                        )}
                      {rows.length > 0 && (
                        <ExportButtons
                          username={item.username}
                          results={rows.map((r) => ({
                            site: r.site,
                            url: r.url,
                            profileUrl: r.profile_url,
                            status: r.status,
                            httpStatus: r.http_status,
                            error: r.error,
                          }))}
                          onNotice={() => {}}
                        />
                      )}
                      <Pressable
                        onPress={() => remove(item.id)}
                        style={[styles.delete, { borderColor: theme.border }]}
                      >
                        <ThemedText type="small" style={{ color: theme.error }}>
                          Delete scan
                        </ThemedText>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            }}
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
  list: {
    paddingBottom: Spacing.six,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  details: {
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  delete: {
    marginTop: Spacing.one,
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
});
