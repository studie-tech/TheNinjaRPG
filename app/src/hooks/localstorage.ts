"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Safe localStorage and sessionStorage utility functions
 * These handle cases where storage might be null (e.g., in Android WebView without domStorageEnabled),
 * in SSR environments where window is not defined, or when browser privacy settings block storage access.
 * Note: Accessing window.localStorage or window.sessionStorage itself can throw a SecurityError
 * in some browsers with strict privacy settings, so all property accesses must be inside try-catch.
 */

/**
 * Safely gets an item from localStorage
 * @param key - The key to retrieve
 * @returns The value from localStorage, or null if localStorage is unavailable or key doesn't exist
 */
export const safeLocalStorageGetItem = (key: string): string | null => {
  try {
    // Check if we're in a browser environment and localStorage is available
    if (typeof window !== "undefined" && window.localStorage) {
      return localStorage.getItem(key);
    }
    return null;
  } catch (error) {
    // Handle any errors that might occur (e.g., SecurityError, QuotaExceededError)
    console.warn(`Failed to get item from localStorage: ${key}`, error);
    return null;
  }
};

/**
 * Safely sets an item in localStorage
 * @param key - The key to set
 * @param value - The value to store
 * @returns true if successful, false otherwise
 */
export const safeLocalStorageSetItem = (key: string, value: string): boolean => {
  try {
    // Check if we're in a browser environment and localStorage is available
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(key, value);
      return true;
    }
    return false;
  } catch (error) {
    // Handle any errors that might occur (e.g., SecurityError, QuotaExceededError)
    console.warn(`Failed to set item in localStorage: ${key}`, error);
    return false;
  }
};

/**
 * Safely removes an item from localStorage
 * @param key - The key to remove
 * @returns true if successful, false otherwise
 */
export const safeLocalStorageRemoveItem = (key: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    // SecurityError or other storage access errors
    return false;
  }
};

/**
 * Safely gets an item from sessionStorage
 * @param key - The key to retrieve
 * @returns The value from sessionStorage, or null if sessionStorage is unavailable or key doesn't exist
 */
export const safeSessionStorageGetItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // SecurityError or other storage access errors
    return null;
  }
};

/**
 * Safely sets an item in sessionStorage
 * @param key - The key to set
 * @param value - The value to store
 * @returns true if successful, false otherwise
 */
export const safeSessionStorageSetItem = (key: string, value: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    // SecurityError or other storage access errors
    return false;
  }
};

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
        // Remove the # and decode the URL component
        const decodedAnchor = decodeURIComponent(hash.substring(1));
        if (decodedAnchor) {
          return decodedAnchor as unknown as T;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkUrlAnchor]);

  // Update the local storage when the value changes using safe utility
  useEffect(() => {
    safeLocalStorageSetItem(key, JSON.stringify(value));
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
