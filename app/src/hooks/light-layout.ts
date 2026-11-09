"use client";

import { useSyncExternalStore } from "react";
import { LIGHT_LAYOUT_STORAGE_KEY } from "@/libs/layoutPreference";
import { safeLocalStorageGetItem } from "@/utils/storage";

/** Reads light mode immediately on client mounts while preserving server hydration. */
export const useLightLayout = () =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);

const listeners = new Set<() => void>();
let storedValue: string | null | undefined;
let lightLayout = false;

const getSnapshot = () => {
  const nextStoredValue = safeLocalStorageGetItem(LIGHT_LAYOUT_STORAGE_KEY);
  if (nextStoredValue !== storedValue) {
    storedValue = nextStoredValue;
    lightLayout = nextStoredValue === "true";
  }
  return lightLayout;
};

const notify = () => {
  for (const listener of listeners) listener();
};

const onStorage = (event: StorageEvent) => {
  if (event.key !== LIGHT_LAYOUT_STORAGE_KEY && event.key !== null) return;
  if (event.storageArea) {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
  }
  // Read current storage rather than an event queued before a more recent change.
  storedValue = undefined;
  notify();
};

const onSync = (event: Event) => {
  const detail = (event as CustomEvent<{ key: string; value: string }>).detail;
  if (detail?.key !== LIGHT_LAYOUT_STORAGE_KEY) return;
  if (detail.value !== "true" && detail.value !== "false") return;
  // useLocalStorage broadcasts before its persistence effect. Retain that value
  // until storage changes, including temporary settings when storage is blocked.
  storedValue = safeLocalStorageGetItem(LIGHT_LAYOUT_STORAGE_KEY);
  lightLayout = detail.value === "true";
  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("localStorageSync", onSync);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("localStorageSync", onSync);
      storedValue = undefined;
    }
  };
};
