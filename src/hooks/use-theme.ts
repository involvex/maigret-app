/**
 * Forced dark mode: the Maigret app uses a Zinc/OLED Black theme
 * regardless of the OS color scheme.
 */

import { Colors } from "@/constants/theme";

export function useTheme() {
  return Colors.dark;
}
