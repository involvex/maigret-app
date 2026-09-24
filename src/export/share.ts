import { Share } from "react-native";
import {
  buildExportFilename,
  formatExport,
  type ExportFormat,
  type ExportRow,
} from "./formats";

export type { ExportFormat, ExportRow };

/**
 * Opens the system share sheet with the report text. File-based export
 * (save-to-Downloads) is a future step requiring a file-system dependency;
 * the share sheet already reaches Files, Drive, mail and messengers.
 */
export async function shareExport(
  format: ExportFormat,
  username: string,
  results: ExportRow[],
): Promise<{ shared: boolean; error?: string }> {
  if (results.length === 0) {
    return { shared: false, error: "Nothing to export yet." };
  }
  try {
    const action = await Share.share({
      title: buildExportFilename(username, format),
      message: formatExport(format, username, results),
    });
    return { shared: action.action === Share.sharedAction };
  } catch (e) {
    return {
      shared: false,
      error: e instanceof Error ? e.message : "Share sheet failed.",
    };
  }
}
