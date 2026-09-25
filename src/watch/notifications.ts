/**
 * Local alert notifications for the watchlist.
 * No push server involved: alerts are scheduled/presented on-device.
 */
import * as Notifications from "expo-notifications";

export const WATCH_CHANNEL_ID = "maigret-watch";

export async function ensureWatchChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(WATCH_CHANNEL_ID, {
    name: "Watch alerts",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#34d399",
  });
}

export async function ensureAlertPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Immediate local alert listing the newly claimed sites (max 5 + overflow). */
export async function fireNewHitsAlert(
  username: string,
  added: string[],
): Promise<string> {
  const shown = added.slice(0, 5);
  const overflow = added.length - shown.length;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `New hits for ${username}`,
      body:
        overflow > 0
          ? `${shown.join(", ")} (+${overflow} more)`
          : shown.join(", "),
      data: { username, screen: "history" },
      color: "#34d399",
    },
    trigger: null,
  });
}
