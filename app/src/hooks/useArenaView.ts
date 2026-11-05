"use client";

import { useSyncExternalStore } from "react";
import { type ArenaMode, arenaModeFromHash } from "@/libs/battleArena";

// History pushes do not fire hashchange, so views opened here notify subscribers directly.
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
};

const getSnapshot = () => arenaModeFromHash(window.location.hash);
const getServerSnapshot = () => null;

const pushPath = (hash: string) => {
  if (window.location.hash === hash) return;
  window.history.pushState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  for (const listener of listeners) listener();
};

/**
 * The battle arena view kept in the URL hash: a mode (`#Sparring`) or, without a hash, the
 * overview. Each change is a history entry, so the browser's back button returns to the
 * previous view.
 */
export const useArenaView = () => {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    mode,
    openMode: (next: ArenaMode) => pushPath(`#${encodeURIComponent(next)}`),
    openOverview: () => pushPath(""),
  };
};
