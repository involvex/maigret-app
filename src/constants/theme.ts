/**
 * Forced dark Zinc / OLED Black theme for the Maigret app.
 * Both `light` and `dark` resolve to the same palette so the UI
 * stays dark regardless of the OS color scheme (see use-theme.ts).
 */

import "@/global.css";

import { Platform } from "react-native";

const zincDark = {
  text: "#fafafa", // zinc-50
  textSecondary: "#a1a1aa", // zinc-400
  background: "#000000", // OLED black
  backgroundElement: "#18181b", // zinc-900 (cards)
  backgroundSelected: "#27272a", // zinc-800 (pressed / borders)
  border: "#27272a", // zinc-800
  accent: "#38bdf8", // sky-400 (links, progress)
  success: "#34d399", // emerald-400 (claimed hits, maigret "[++]" green)
  warning: "#fbbf24", // amber-400
  error: "#f87171", // red-400
} as const;

export const Colors = {
  light: zincDark,
  dark: zincDark,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
