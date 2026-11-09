"use client";

import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

export const useLocalStorage = <T>(
  key: string,
  initialValue: T,
  checkUrlAnchor = false,
): [T, (newValue: T) => void] => {
  // Get value from URL anchor if present and enabled
  const getAnchorValue = (): T | null => {
    if (typeof window !== "undefined" && checkUrlAnchor) {
      const hash = window.location.hash;
      if (hash) {
        try {
          // Remove the # and decode the URL component
          const decodedAnchor = decodeURIComponent(hash.substring(1));
          if (decodedAnchor) {
            return decodedAnchor as unknown as T;
          }
        } catch {
          // Ignore malformed URL fragments, retaining the stored or current value.
        }
      }
    }
    return null;
  };

  // Get the initial value from local storage or URL anchor
  const getInitialValue = () => {
    // First check for URL anchor if enabled
    const anchorValue = getAnchorValue();
    if (anchorValue !== null) {
      return anchorValue;
    }

    // Fall back to local storage using safe utility
    const storedValue = safeLocalStorageGetItem(key);
    if (storedValue && storedValue !== "undefined") {
      try {
        return JSON.parse(storedValue) as T;
      } catch {
        return initialValue;
      }
    }

    return initialValue;
  };

  // Set the initial value
  const [value, setValue] = useState<T>(getInitialValue);

  // Listen for URL anchor changes (initial value already handled by lazy initialization)
  useEffect(() => {
    if (checkUrlAnchor) {
      const handleHashChange = () => {
        const anchorValue = getAnchorValue();
        if (anchorValue !== null) {
          setValue(anchorValue);
        }
      };

      // Listen for hash changes - event handlers are fine, initial value handled by getInitialValue
      window.addEventListener("hashchange", handleHashChange);
      return () => {
        window.removeEventListener("hashchange", handleHashChange);
      };
    }
  }, [checkUrlAnchor]);

  // Update the local storage when the value changes using safe utility
  useEffect(() => {
    const serializedValue = JSON.stringify(value);
    if (safeLocalStorageGetItem(key) !== serializedValue) {
      safeLocalStorageSetItem(key, serializedValue);
    }
  }, [key, value]);

  // Listen for storage changes from other tabs (StorageEvent) and same-page instances (CustomEvent)
  useEffect(() => {
    // Handle cross-tab storage changes
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.newValue !== null) {
        try {
          const newValue = JSON.parse(event.newValue) as T;
          setValue(newValue);
        } catch {
          // Ignore parse errors
        }
      }
    };

    // Handle same-page storage changes via custom event
    const handleLocalStorageSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ key: string; value: string }>;
      if (customEvent.detail.key === key) {
        try {
          const newValue = JSON.parse(customEvent.detail.value) as T;
          setValue(newValue);
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageSync", handleLocalStorageSync);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageSync", handleLocalStorageSync);
    };
  }, [key]);

  // When calling the setValue function, only remove the URL anchor if checkUrlAnchor is enabled
  // Memoized to prevent unnecessary re-renders when passed as prop
  const setValueCallback = useCallback(
    (newValue: T) => {
      setValue(newValue);
      // Dispatch custom event to sync same-page instances
      if (typeof window !== "undefined") {
        const serializedValue = JSON.stringify(newValue);
        window.dispatchEvent(
          new CustomEvent("localStorageSync", {
            detail: { key, value: serializedValue },
          }),
        );
      }
      // Only clear the URL anchor if this hook is configured to use URL anchors
      // Preserve query parameters when clearing the anchor
      if (checkUrlAnchor && typeof window !== "undefined") {
        window.history.replaceState(
          {},
          "",
          window.location.pathname + window.location.search,
        );
      }
    },
    [key, checkUrlAnchor],
  );

  // Return the value and the setValue callback
  return [value, setValueCallback];
};
