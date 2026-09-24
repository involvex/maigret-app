import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type { CheckResult } from "@/engine/types";

const STATUS_DOT: Record<CheckResult["status"], string> = {
  claimed: "success",
  unclaimed: "textSecondary",
  illegal: "warning",
  error: "error",
} as const;

interface Props {
  result: CheckResult;
  onOpen: (url: string) => void;
}

export const ResultRow = memo(function ResultRow({ result, onOpen }: Props) {
  const theme = useTheme();
  const dotKey = STATUS_DOT[result.status];
  const dotColor =
    dotKey === "success"
      ? theme.success
      : dotKey === "warning"
        ? theme.warning
        : dotKey === "error"
          ? theme.error
          : theme.textSecondary;
  const tappable = result.status === "claimed";

  return (
    <Pressable
      disabled={!tappable}
      onPress={() => onOpen(result.profileUrl)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={styles.body}>
        <ThemedText type="smallBold">{result.siteName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {result.status === "claimed"
            ? result.profileUrl
            : result.status === "error"
              ? `Error: ${result.error ?? "unknown"}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}`
              : result.status === "illegal"
                ? "Username not allowed on this site"
                : "No account found"}
        </ThemedText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
