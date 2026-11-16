import type { ReactPromise } from "react";

/**
 * Create a queue that runs async operations one at a time, in call order. The returned
 * function resolves or rejects with its own operation; a failure never blocks the next one.
 */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = tail.then(operation);
    tail = pending.catch(() => undefined);
    return pending;
  };
};

/**
 * Wrap a dynamic import so every call starts or joins one download, for rendering with
 * `use()`. The promise is marked fulfilled when it settles, which React reads to return a
 * loaded module synchronously: a component preloaded before it first renders never shows
 * its Suspense fallback. A failed import is forgotten, so the next call retries it.
 */
export const createModuleLoader = <T>(importModule: () => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return (): ReactPromise<T> => {
    if (!pending) {
      const started = importModule();
      started.then(
        (value) => Object.assign(started, { status: "fulfilled", value }),
        () => {
          if (pending === started) pending = undefined;
        },
      );
      pending = started;
    }
    return pending;
  };
};
