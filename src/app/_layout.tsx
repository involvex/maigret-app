import { useEffect } from "react";
import { DarkTheme, ThemeProvider, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
// Side effect: defines the headless watch-check task at bundle load
// (required for background launches, not just foreground).
import "@/watch/task";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function useWatchAlertRouting() {
  useEffect(() => {
    const redirect = (notification: Notifications.Notification) => {
      if (notification.request.content.data?.screen === "history") {
        router.push("/history");
      }
    };
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification) redirect(response.notification);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => redirect(response.notification),
    );
    return () => subscription.remove();
  }, []);
}

export default function TabLayout() {
  useWatchAlertRouting();
  return (
    <ThemeProvider value={DarkTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
