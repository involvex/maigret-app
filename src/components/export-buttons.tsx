import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";
import { saveExportToFolder } from "@/export/files";
import { shareExport, type ExportFormat, type ExportRow } from "@/export/share";

const FORMATS: ExportFormat[] = ["json", "csv", "txt"];

type Mode = "share" | "save";

interface Props {
  username: string;
  results: ExportRow[];
  disabled?: boolean;
  onNotice: (notice: string | null) => void;
}

export const ExportButtons = memo(function ExportButtons({
  username,
  results,
  disabled,
  onNotice,
}: Props) {
  const theme = useTheme();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [mode, setMode] = useState<Mode>("share");

  const exportAs = async (format: ExportFormat) => {
    if (disabled || busy) return;
    setBusy(format);
    try {
      if (mode === "save") {
        const outcome = await saveExportToFolder(format, username, results);
        if (outcome.saved) {
          onNotice(
            `Saved ${outcome.fileName} — pick the file in your file manager.`,
          );
        } else if (outcome.error) {
          onNotice(outcome.error);
        }
      } else {
        const outcome = await shareExport(format, username, results);
        if (!outcome.shared && outcome.error) {
          onNotice(outcome.error);
        }
      }
    } finally {
      setBusy(null);
    }
  };

  if (results.length === 0) return null;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setMode((m) => (m === "share" ? "save" : "share"))}
        style={[
          styles.chip,
          {
            borderColor: theme.border,
            backgroundColor:
              mode === "save" ? theme.backgroundSelected : "transparent",
          },
        ]}
      >
        <ThemedText type="small" themeColor="textSecondary">
          {mode === "share" ? "Share" : "Save to file"}
        </ThemedText>
      </Pressable>
      {FORMATS.map((format) => (
        <Pressable
          key={format}
          disabled={disabled}
          onPress={() => exportAs(format)}
          style={({ pressed }) => [
            styles.chip,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: pressed || disabled ? 0.6 : 1,
            },
          ]}
        >
          <ThemedText type="smallBold">
            {busy === format ? "…" : format.toUpperCase()}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
