/**
 * Belt-and-braces config plugin: the MaigretScanService entry and the
 * permissions also ship in the module's own AndroidManifest.xml (which
 * merges automatically), but declaring the permissions here keeps the
 * requirement explicit in app config and survives manifest-merge changes.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const REQUIRED_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.POST_NOTIFICATIONS",
];

const withMaigretForeground = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    for (const name of REQUIRED_PERMISSIONS) {
      const exists = manifest["uses-permission"].some(
        (item) => item.$ && item.$["android:name"] === name,
      );
      if (!exists) {
        manifest["uses-permission"].push({ $: { "android:name": name } });
      }
    }
    return config;
  });
};

module.exports = withMaigretForeground;
