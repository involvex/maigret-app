/**
 * File-based export: the user picks a folder (e.g. Downloads) once per
 * save via the system picker, and the report lands there as a real file.
 * Uses the expo-file-system v57 `File`/`Directory` API (SDK-compatible,
 * works in Expo Go). Cancelled pickers resolve as `{ saved: false }`
 * without an error.
 */
import { Directory } from "expo-file-system";
import {
  buildExportFilename,
  formatExport,
  type ExportFormat,
  type ExportRow,
} from "./formats";

const MIME_TYPES: Record<ExportFormat, string> = {
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
};

export interface SaveOutcome {
  saved: boolean;
  fileName?: string;
  error?: string;
}

export async function saveExportToFolder(
  format: ExportFormat,
  username: string,
  results: ExportRow[],
): Promise<SaveOutcome> {
  if (results.length === 0) {
    return { saved: false, error: "Nothing to export yet." };
  }
  try {
    const dir = await Directory.pickDirectoryAsync();
    if (!dir) {
      return { saved: false };
    }
    const fileName = buildExportFilename(username, format);
    const file = dir.createFile(fileName, MIME_TYPES[format]);
    file.write(formatExport(format, username, results));
    return { saved: true, fileName };
  } catch (e) {
    // Picker cancellation surfaces as an error on some Android versions.
    const message = e instanceof Error ? e.message : String(e);
    if (/cancel|cancelled|abort/i.test(message)) {
      return { saved: false };
    }
    return { saved: false, error: message || "Could not save the file." };
  }
}
