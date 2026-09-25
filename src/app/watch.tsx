import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  listWatched,
  removeWatched,
  upsertWatched,
  type WatchedRow,
} from "@/storage/db";
import { runWatchCycle } from "@/watch/check";
import {
  ensureAlertPermission,
  ensureWatchChannel,
  fireNewHitsAlert,
} from "@/watch/notifications";
import {
  isWatchTaskRegistered,
  registerWatchTask,
  triggerWatchTaskForTesting,
  unregisterWatchTask,
} from "@/watch/task";
import { defaultWatchDeps } from "@/watch/wiring";

const INTERVALS = [360, 720, 1440];

function intervalLabel(minutes: number): string {
  if (minutes >= 1440) return "24h";
  if (minutes >= 720) return "12h";
  return "6h";
}

function formatChecked(ts: number | null): string {
  if (ts == null) return "never checked";
  return `checked ${new Date(ts).toLocaleDateString()} ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function WatchScreen() {
  const theme = useTheme();
  const [rows, setRows] = useState<WatchedRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newInterval, setNewInterval] = useState(720);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureWatchChannel().catch(() => {});
    listWatched()
      .then(async (current) => {
        if (cancelled) return;
        setRows(current);
        setRegistered(await isWatchTaskRegistered().catch(() => false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const syncScheduling = useCallback(async (current: WatchedRow[]) => {
    const enabled = current.filter((r) => r.enabled === 1);
    if (enabled.length === 0) {
      await unregisterWatchTask().catch(() => {});
      setRegistered(false);
      return;
    }
    const minInterval = Math.min(...enabled.map((r) => r.interval_minutes));
    await registerWatchTask(minInterval).catch(() => {});
    setRegistered(true);
  }, []);

  const refresh = useCallback(async () => {
    const current = await listWatched();
    setRows(current);
    await syncScheduling(current);
  }, [syncScheduling]);

  const add = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      setNotice("Enter a username to watch.");
      return;
    }
    const permitted = await ensureAlertPermission();
    if (!permitted) {
      setNotice("Allow notifications first — alerts need the permission.");
      return;
    }
    await upsertWatched(name, { enabled: true, intervalMinutes: newInterval });
    setNewName("");
    setNotice(
      `Watching ${name}. First check builds a silent baseline; alerts start after that.`,
    );
    await refresh();
  }, [newName, newInterval, refresh]);

  const toggle = useCallback(
    async (row: WatchedRow) => {
      await upsertWatched(row.username, { enabled: row.enabled !== 1 });
      await refresh();
    },
    [refresh],
  );

  const cycleInterval = useCallback(
    async (row: WatchedRow) => {
      const next =
        INTERVALS[
          (INTERVALS.indexOf(row.interval_minutes) + 1) % INTERVALS.length
        ] ?? 720;
      await upsertWatched(row.username, { intervalMinutes: next });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (row: WatchedRow) => {
      await removeWatched(row.id);
      await refresh();
    },
    [refresh],
  );

  const checkNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setNotice("Running watch check…");
    try {
      const report = await runWatchCycle(defaultWatchDeps());
      const alerts = report.alerted
        .map((a) => `${a.username}: ${a.added.join(", ")}`)
        .join("; ");
      setNotice(
        report.checked.length === 0
          ? "Nothing due right now."
          : alerts
            ? `New hits — ${alerts}`
            : `Checked ${report.checked.join(", ")} — no new hits.` +
              (report.errors.length > 0
                ? ` (${report.errors.length} failed)`
                : ""),
      );
    } catch {
      setNotice("Watch check failed unexpectedly.");
    } finally {
      setChecking(false);
      await refresh();
    }
  }, [checking, refresh]);

  const testAlert = useCallback(async () => {
    const permitted = await ensureAlertPermission();
    if (!permitted) {
      setNotice("Allow notifications first — alerts need the permission.");
      return;
    }
    await ensureWatchChannel();
    await fireNewHitsAlert(newName.trim() || "preview", ["GitHub", "GitLab"]);
  }, [newName]);

  const triggerWorker = useCallback(async () => {
    try {
      await triggerWatchTaskForTesting();
      setNotice("Background worker triggered (dev builds only).");
    } catch {
      setNotice("Worker trigger is dev-only and failed here.");
    }
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.inner}>
          <ThemedText type="subtitle">Watchlist</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {registered
              ? "Background checks are scheduled (timing is OS-decided, battery-friendly)."
              : "Add a username to schedule background checks."}{" "}
            New sites claiming you trigger a notification.
          </ThemedText>

          <View style={styles.addRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="username to watch"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={add}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            />
            <Pressable
              onPress={() =>
                setNewInterval(
                  INTERVALS[
                    (INTERVALS.indexOf(newInterval) + 1) % INTERVALS.length
                  ] ?? 720,
                )
              }
              style={[styles.chip, { borderColor: theme.border }]}
            >
              <ThemedText type="smallBold">
                {intervalLabel(newInterval)}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={add}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.success, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <ThemedText type="smallBold" style={styles.addButtonText}>
                Add
              </ThemedText>
            </Pressable>
          </View>

          {notice ? <ThemedText type="small">{notice}</ThemedText> : null}

          <FlatList
            data={rows}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={{ height: Spacing.two }} />
            )}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary">
                Nobody watched yet. Your first check per name is silent — it
                only learns which accounts already exist.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <ThemedText type="smallBold">{item.username}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      every {intervalLabel(item.interval_minutes)} ·{" "}
                      {formatChecked(item.last_checked_at)}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => toggle(item)}
                    style={[
                      styles.chip,
                      {
                        borderColor: theme.border,
                        backgroundColor:
                          item.enabled === 1
                            ? theme.backgroundSelected
                            : "transparent",
                      },
                    ]}
                  >
                    <ThemedText type="small">
                      {item.enabled === 1 ? "On" : "Off"}
                    </ThemedText>
                  </Pressable>
                </View>
                <View style={styles.actions}>
                  <Pressable onPress={() => cycleInterval(item)}>
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      Interval: {intervalLabel(item.interval_minutes)}
                    </ThemedText>
                  </Pressable>
                  <Pressable onPress={() => remove(item)}>
                    <ThemedText type="small" style={{ color: theme.error }}>
                      Remove
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
          />

          <View style={styles.footer}>
            <Pressable
              disabled={checking}
              onPress={checkNow}
              style={[
                styles.secondary,
                { borderColor: theme.border, opacity: checking ? 0.6 : 1 },
              ]}
            >
              <ThemedText type="small">
                {checking ? "Checking…" : "Check now"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={testAlert}
              style={[styles.secondary, { borderColor: theme.border }]}
            >
              <ThemedText type="small">Test alert</ThemedText>
            </Pressable>
            {__DEV__ ? (
              <Pressable
                onPress={triggerWorker}
                style={[styles.secondary, { borderColor: theme.border }]}
              >
                <ThemedText type="small">Trigger worker (dev)</ThemedText>
              </Pressable>
            ) : null}
          </View>
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
  addRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  addButton: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  addButtonText: {
    color: "#09090b",
  },
  list: {
    paddingBottom: Spacing.two,
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
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footer: {
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  secondary: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
});
