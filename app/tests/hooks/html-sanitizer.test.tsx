import { afterEach, beforeEach, expect, it } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createLazyModule, useLazyModule } from "@/hooks/useHtmlSanitizer";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => installBrowserGlobals());
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

it("reports a failed load and updates every mounted hook when a later load succeeds", async () => {
  let attempts = 0;
  const store = createLazyModule(async () => {
    attempts++;
    if (attempts === 1) throw new Error("chunk failed");
    return { value: "loaded" };
  });
  const first = renderHook(() => useLazyModule(store, true));
  const second = renderHook(() => useLazyModule(store, false));
  await waitFor(() => expect(first.result.current.failed).toBe(true));
  expect(second.result.current.failed).toBe(true);
  expect(first.result.current.module).toBeUndefined();
  // A failed load is not repeated by mounted hooks on their own.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(attempts).toBe(1);

  await act(async () => {
    await store.load();
  });
  expect(attempts).toBe(2);
  expect(first.result.current).toEqual({ module: { value: "loaded" }, failed: false });
  expect(second.result.current.module).toEqual({ value: "loaded" });
});

it("loads once for every hook and only when enabled", async () => {
  let attempts = 0;
  const store = createLazyModule(async () => {
    attempts++;
    return { value: attempts };
  });
  const view = renderHook(({ enabled }) => useLazyModule(store, enabled), {
    initialProps: { enabled: false },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(attempts).toBe(0);
  view.rerender({ enabled: true });
  renderHook(() => useLazyModule(store, true));
  await waitFor(() => expect(view.result.current.module).toEqual({ value: 1 }));
  expect(attempts).toBe(1);
});
