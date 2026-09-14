"use client";

import { useEffect, useState } from "react";
import { isNativeUserAgent } from "@/libs/native/userAgent";

export default function PWAManager() {
  const [, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    // Check if service workers are supported
    if ("serviceWorker" in navigator) {
      // Register service worker
      void registerServiceWorker();
    }
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
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      setRegistration(reg);

      // Listen for updates
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New update available
              console.log("New version available! Please refresh.");
            }
          });
        }
      });
    } catch (error) {
      console.error("Service Worker registration failed:", error as Error);
    }
  };

  // This component doesn't render anything, it just manages PWA functionality
  return null;
}
