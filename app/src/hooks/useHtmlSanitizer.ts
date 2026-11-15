import { useEffect, useSyncExternalStore } from "react";

const sanitizer = createLazyModule(() => import("@/utils/sanitize"));

/**
 * The sanitize-html allowlist is the same module the server applies to stored content. Its
 * parser dependencies are large, so browser code loads it on demand rather than with the page.
 * A failed load is retried by the next call, and every mounted hook sees the outcome.
 */
export const loadHtmlSanitizer = () => sanitizer.load();

/** Mention and reaction builders for optimistic chat updates; they share the sanitizer chunk. */
export const loadChatHelpers = () => import("@/utils/chat");

/**
 * The sanitizer once it has loaded, and whether the latest attempt failed. Loading starts
 * when `enabled` becomes true; after a failure it waits for the next `loadHtmlSanitizer()`.
 */
export const useHtmlSanitizer = (enabled: boolean) => {
  const { module, failed } = useLazyModule(sanitizer, enabled);
  return { sanitizer: module, failed };
};

/**
 * Subscribes to a module from `createLazyModule`, starting its load when `enabled` becomes
 * true. A failed load is not repeated here; the next `load()` call from anywhere retries it.
 */
export const useLazyModule = <T>(store: LazyModule<T>, enabled: boolean) => {
  const current = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getInitialState,
  );
  useEffect(() => {
    if (enabled && !current.module && !current.failed)
      store.load().catch(() => undefined);
  }, [enabled, current, store]);
  return current;
};

/**
 * A module imported on demand and shared by every hook reading it. Subscribers are notified
 * when a load starts after a failure, succeeds or fails, whoever started it.
 */
export function createLazyModule<T>(importModule: () => Promise<T>) {
  const initial: LazyModuleState<T> = { failed: false };
  let state = initial;
  let pending: Promise<T> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: LazyModuleState<T>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const load = () => {
    if (!pending) {
      if (state.failed) update({ failed: false });
      pending = importModule().then(
        (module) => {
          update({ module, failed: false });
          return module;
        },
        (error: unknown) => {
          pending = undefined;
          update({ failed: true });
          throw error;
        },
      );
    }
    return pending;
  };
  return {
    load,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    getInitialState: () => initial,
  };
}

type LazyModuleState<T> = { module?: T; failed: boolean };
type LazyModule<T> = ReturnType<typeof createLazyModule<T>>;
