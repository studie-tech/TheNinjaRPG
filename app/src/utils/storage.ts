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

/**
 * Safely removes an item from sessionStorage
 * @param key - The key to remove
 * @returns true if successful, false otherwise
 */
export const safeSessionStorageRemoveItem = (key: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    // SecurityError or other storage access errors
    return false;
  }
};
