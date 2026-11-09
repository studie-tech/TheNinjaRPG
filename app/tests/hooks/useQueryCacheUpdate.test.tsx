import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { getRenamedLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

afterEach(cleanup);

describe("query cache mutation hook", () => {
  it.each(["item", "jutsu"])(
    "renames a confirmed %s loadout without a read",
    async (feature) => {
      const client = new QueryClient();
      const key = [[feature, "getLoadouts"], { type: "query" }];
      const other = { id: "other", name: "Other", ids: ["kept"] };
      const rows = [{ id: "one", name: "One", ids: ["saved"] }, other];
      client.setQueryData(key, rows);
      let reads = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: async () => {
          reads++;
          return rows;
        },
      });
      const unsubscribe = observer.subscribe(() => {});
      const view = renderHook(() => useQueryCacheUpdate<typeof rows>(key), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      const snapshot = view.result.current.prepareUpdate();
      await act(async () =>
        view.result.current.updateCache(
          (current) => getRenamedLoadouts(current, { id: "one", name: " Renamed " }),
          snapshot,
        ),
      );
      expect(client.getQueryData(key)).toEqual([
        { ...rows[0], name: "Renamed" },
        other,
      ]);
      expect(client.getQueryData<typeof rows>(key)?.[1]).toBe(other);
      expect(reads).toBe(0);
      view.unmount();
      unsubscribe();
      client.clear();
    },
  );

  it("reconciles the captured input after the component changes queries", async () => {
    const client = new QueryClient();
    const firstKey = ["rows", { category: "one" }];
    const secondKey = ["rows", { category: "two" }];
    client.setQueryData(firstKey, [{ id: "one", name: "First" }]);
    const second = [{ id: "two", name: "Second" }];
    client.setQueryData(secondKey, second);
    const view = renderHook(
      ({ queryKey }) => useQueryCacheUpdate<typeof second>(queryKey),
      {
        initialProps: { queryKey: firstKey },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    const snapshot = view.result.current.prepareUpdate();
    view.rerender({ queryKey: secondKey });
    await act(async () =>
      view.result.current.updateCache(
        (current) => getRenamedLoadouts(current, { id: "one", name: "Renamed" }),
        snapshot,
      ),
    );
    expect(client.getQueryData(firstKey)).toEqual([{ id: "one", name: "Renamed" }]);
    expect(client.getQueryData(secondKey)).toBe(second);
    view.unmount();
    client.clear();
  });
});
