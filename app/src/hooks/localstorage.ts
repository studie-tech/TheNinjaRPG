"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Safe localStorage utility functions
 * These handle cases where localStorage might be null (e.g., in Android WebView without domStorageEnabled)
 * or in SSR environments where window is not defined.
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
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(key);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`Failed to remove item from localStorage: ${key}`, error);
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

  // When calling the setValue function, remove the URL anchor
  // Memoized to prevent unnecessary re-renders when passed as prop
  const setValueWithoutAnchor = useCallback((newValue: T) => {
    setValue(newValue);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Return the value and the setValueWithoutAnchor function
  return [value, setValueWithoutAnchor];
};
