"use client";

import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";

export const SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY = "showDayNightMapOverlays";

const readStoredPreference = () => {
  const storedValue = safeLocalStorageGetItem(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY);
  if (storedValue && storedValue !== "undefined") {
    try {
      return JSON.parse(storedValue) as boolean;
    } catch {
      // Ignore malformed preferences and retain the default.
    }
  }
  return true;
};

/**
 * Cached preference for day/night map shading overlays.
 * Defaults to true so existing users keep current behavior.
 */
export const useDayNightMapOverlays = () => {
  // Keep the server and first client render identical. The persisted preference
  // is applied after hydration so React never has to reconcile different markup.
  const [showDayNightMapOverlays, setShowDayNightMapOverlaysState] = useState(true);

  useEffect(() => {
    setShowDayNightMapOverlaysState(readStoredPreference());

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY && event.newValue !== null) {
        try {
          setShowDayNightMapOverlaysState(JSON.parse(event.newValue) as boolean);
        } catch {
          // Ignore malformed preferences.
        }
      }
    };
    const handleLocalStorageSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ key: string; value: string }>;
      if (customEvent.detail.key === SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY) {
        try {
          setShowDayNightMapOverlaysState(
            JSON.parse(customEvent.detail.value) as boolean,
          );
        } catch {
          // Ignore malformed preferences.
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageSync", handleLocalStorageSync);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageSync", handleLocalStorageSync);
    };
  }, []);

  const setShowDayNightMapOverlays = useCallback((newValue: boolean) => {
    setShowDayNightMapOverlaysState(newValue);
    const serializedValue = JSON.stringify(newValue);
    safeLocalStorageSetItem(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY, serializedValue);
    window.dispatchEvent(
      new window.CustomEvent("localStorageSync", {
        detail: { key: SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY, value: serializedValue },
      }),
    );
  }, []);

  return { showDayNightMapOverlays, setShowDayNightMapOverlays };
};
