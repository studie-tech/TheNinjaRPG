"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  applyReadingPreferences,
  DEFAULT_READING_PREFERENCES,
  parseReadingPreferences,
  READING_PREFERENCES_STORAGE_KEY,
  type ReadingPreferences,
} from "@/libs/readingPreferences";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Keeps temporary preferences and save feedback available when settings panels remount. */
export const ReadingPreferencesProvider = ({ children }: { children: ReactNode }) => {
  const value = useStoredReadingPreferences();
  return (
    <ReadingPreferencesContext value={value}>{children}</ReadingPreferencesContext>
  );
};

/** Reads the shared preferences and save status; requires ReadingPreferencesProvider. */
export const useReadingPreferences = () => {
  const value = use(ReadingPreferencesContext);
  if (!value) {
    throw new Error("useReadingPreferences requires ReadingPreferencesProvider");
  }
  return value;
};

const ReadingPreferencesContext = createContext<ReturnType<
  typeof useStoredReadingPreferences
> | null>(null);

/** Owns browser persistence, cross-tab updates, and document styling for one provider. */
const useStoredReadingPreferences = () => {
  // Keep the first render identical to SSR; the head script already styles the page.
  const [preferences, setPreferences] = useState(DEFAULT_READING_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPersisted, setIsPersisted] = useState(true);

  useEffect(() => {
    setPreferences(
      parseReadingPreferences(safeLocalStorageGetItem(READING_PREFERENCES_STORAGE_KEY)),
    );
    setIsLoaded(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === READING_PREFERENCES_STORAGE_KEY || event.key === null) {
        // A null key represents clear(); read current storage even for queued events.
        setPreferences(
          parseReadingPreferences(
            safeLocalStorageGetItem(READING_PREFERENCES_STORAGE_KEY),
          ),
        );
        setIsPersisted(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    // Preserve the head script's saved styles until browser preferences are loaded.
    if (isLoaded) applyReadingPreferences(preferences);
  }, [preferences, isLoaded]);

  const updatePreferences = useCallback((next: ReadingPreferences) => {
    const serialized = JSON.stringify(next);
    const validated = parseReadingPreferences(serialized);
    const saved = safeLocalStorageSetItem(READING_PREFERENCES_STORAGE_KEY, serialized);
    // Failed writes still apply in memory; settings expose the shared status and retry.
    setPreferences(validated);
    setIsPersisted(saved);
  }, []);

  return { preferences, updatePreferences, isPersisted };
};
