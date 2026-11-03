"use client";

import { useEffect } from "react";
import { isNativeUserAgent } from "@/libs/native/userAgent";

export default function PWAManager() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void registerServiceWorker();
  }, []);

  const registerServiceWorker = async () => {
    try {
      if (isNativeUserAgent(navigator.userAgent)) {
        // The native shell owns offline recovery. Remove this app's existing web
        // worker so subsequent navigations use the WebView's native request context.
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) =>
              [registration.active, registration.waiting, registration.installing].some(
                (worker) =>
                  worker?.scriptURL === new URL("/sw.js", location.origin).href,
              ),
            )
            .map((registration) => registration.unregister()),
        );
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (error) {
      console.error("Service Worker registration failed:", error as Error);
    }
  };

  return null;
}
