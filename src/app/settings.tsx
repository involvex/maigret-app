import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { fetchRemoteDb } from "@/engine/sitesDb";
import { TOR_DEFAULT_PROXY, parseProxyUrl } from "@/engine/proxy";
import { DEFAULT_SCAN_SETTINGS } from "@/engine/types";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { kvSet, KV_SITES_DB, KV_SITES_DB_UPDATED_AT } from "@/storage/db";
import { getScanSettings, setScanSettings } from "@/storage/prefs";
import { getActiveDb } from "@/storage/sites";

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const [timeoutS, setTimeoutS] = useState("15");
  const [concurrency, setConcurrency] = useState("20");
  const [maxSites, setMaxSites] = useState("80");
  const [tags, setTags] = useState("");
  const [proxy, setProxy] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [dbInfo, setDbInfo] = useState("Loading database info…");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    (async () => {
      const [settings, active] = await Promise.all([
        getScanSettings(),
        getActiveDb(),
      ]);
      setTimeoutS(String(Math.round(settings.timeoutMs / 1000)));
      setConcurrency(String(settings.concurrency));
      setMaxSites(String(settings.maxSites));
      setTags(settings.tags.join(", "));
      setProxy(settings.proxyUrl ?? "");
      setDbInfo(
        `${active.siteCount} sites (${active.source === "cache" ? "downloaded full DB" : "bundled offline snapshot"})` +
          (active.updatedAt
            ? ` · updated ${new Date(active.updatedAt).toLocaleDateString()}`
            : ""),
      );
    })();
  }, []);

  const save = async () => {
    const cleanProxy = proxy.trim();
    if (cleanProxy) {
      try {
        parseProxyUrl(cleanProxy);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Invalid proxy URL.");
        return;
      }
    }
    const timeoutMs = Math.max(1, Number.parseInt(timeoutS, 10) || 15) * 1000;
    await setScanSettings({
      timeoutMs,
      concurrency: Math.min(
        50,
        Math.max(1, Number.parseInt(concurrency, 10) || 20),
      ),
      maxSites: Math.max(0, Number.parseInt(maxSites, 10) || 0),
      tags: tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      proxyUrl: cleanProxy || undefined,
    });
    setNotice("Settings saved.");
  };

  const updateDb = async () => {
    setUpdating(true);
    setNotice(null);
    try {
      const remote = await fetchRemoteDb(fetch);
      const count = Object.keys(remote.sites).length;
      await kvSet(KV_SITES_DB, JSON.stringify(remote));
      await kvSet(KV_SITES_DB_UPDATED_AT, String(Date.now()));
      setDbInfo(
        `${count} sites (downloaded full DB) · updated ${new Date().toLocaleDateString()}`,
      );
      setNotice(`Database updated: ${count} sites cached on-device.`);
    } catch (e) {
      setNotice(
        e instanceof Error
          ? `Update failed: ${e.message}`
          : "Database update failed.",
      );
    } finally {
      setUpdating(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.inner}>
          <ThemedText type="subtitle">Settings</ThemedText>

          <NumberField
            label="Request timeout (seconds)"
            value={timeoutS}
            onChange={setTimeoutS}
          />
          <NumberField
            label="Parallel requests (1–50)"
            value={concurrency}
            onChange={setConcurrency}
          />
          <NumberField
            label={`Max sites per scan (bundled: ${DEFAULT_SCAN_SETTINGS.maxSites})`}
            value={maxSites}
            onChange={setMaxSites}
          />

          <View style={styles.field}>
            <ThemedText type="smallBold">
              Site tags (comma-separated, empty = all)
            </ThemedText>
            <TextInput
              value={tags}
              onChangeText={setTags}
              placeholder="e.g. photo, dating"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Proxy (optional)</ThemedText>
            <TextInput
              value={proxy}
              onChangeText={setProxy}
              placeholder="socks5://127.0.0.1:9050"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            />
            <ThemedText type="small" themeColor="textSecondary">
              For Tor, run Orbot on this device and use {TOR_DEFAULT_PROXY}{" "}
              (Maigret default). The proxy is applied natively (SOCKS5 + auth
              supported) in dev/production builds; Expo Go scans use a direct
              connection.
            </ThemedText>
            <Pressable
              onPress={() => setProxy(TOR_DEFAULT_PROXY)}
              style={[styles.secondary, { borderColor: theme.border }]}
            >
              <ThemedText type="small">Use Tor default</ThemedText>
            </Pressable>
          </View>

          {notice ? <ThemedText type="small">{notice}</ThemedText> : null}

          <Pressable
            onPress={save}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.success, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <ThemedText type="smallBold" style={styles.buttonText}>
              Save settings
            </ThemedText>
          </Pressable>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText type="smallBold">Site database</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {dbInfo}
            </ThemedText>
            <Pressable
              disabled={updating}
              onPress={updateDb}
              style={[
                styles.secondary,
                { borderColor: theme.border, opacity: updating ? 0.6 : 1 },
              ]}
            >
              <ThemedText type="small">
                {updating ? "Downloading…" : "Download full database (~2.5 MB)"}
              </ThemedText>
            </Pressable>
            <Pressable
              disabled={updating}
              onPress={async () => {
                await kvSet(KV_SITES_DB, "");
                await kvSet(KV_SITES_DB_UPDATED_AT, "");
                const active = await getActiveDb();
                setDbInfo(
                  `${active.siteCount} sites (bundled offline snapshot)`,
                );
                setNotice("Reverted to the bundled snapshot.");
              }}
              style={[
                styles.secondary,
                { borderColor: theme.border, opacity: updating ? 0.6 : 1 },
              ]}
            >
              <ThemedText type="small">Revert to bundled snapshot</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            For educational and lawful use only. Respect each site&apos;s terms
            and local law (GDPR, CCPA).
          </ThemedText>
        </ScrollView>
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#09090b",
  },
  secondary: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: Spacing.one,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
