import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { useBattleHotkeys } from "@/hooks/useBattleHotkeys";
import type { HotkeyMap } from "@/libs/combat/hotkeys";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Save = { hotkeys: HotkeyMap; confirm: () => Promise<void> };

/** Loadout reads and hotkey saves backed by a query client, with saves confirmed by the test. */
const mount = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const server = { jutsu: {} as HotkeyMap, item: {} as HotkeyMap };
  const reads = { jutsu: 0, item: 0 };
  const saves: Save[] = [];
  const feature = (kind: "jutsu" | "item", key: string[], id: string) => ({
    utils: {
      setData: (_input: undefined, update: (rows: unknown) => unknown) =>
        queryClient.setQueryData(key, update),
      cancel: () => queryClient.cancelQueries({ queryKey: key }),
      invalidate: () => queryClient.invalidateQueries({ queryKey: key }),
    },
    useQuery: (_input: undefined, options: object) =>
      useQuery({
        ...options,
        queryKey: key,
        queryFn: async () => {
          reads[kind]++;
          return [{ id, name: `${kind} set`, hotkeys: { ...server[kind] } }];
        },
      }),
    useMutation: (options: object) =>
      useMutation({
        ...options,
        mutationFn: (input: { hotkeys: HotkeyMap }) =>
          new Promise((resolve) => {
            saves.push({
              hotkeys: input.hotkeys,
              confirm: async () => {
                server[kind] = input.hotkeys;
                resolve({ success: true, message: "Saved" });
                await new Promise((done) => setTimeout(done, 0));
              },
            });
          }),
      }),
  });
  const jutsu = feature("jutsu", ["jutsu", "getLoadouts"], "jutsu-set");
  const item = feature("item", ["item", "getItemLoadouts"], "item-set");
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      jutsu: { getLoadouts: jutsu.utils },
      item: { getItemLoadouts: item.utils },
    }),
    jutsu: {
      getLoadouts: { useQuery: jutsu.useQuery },
      setLoadoutHotkeys: { useMutation: jutsu.useMutation },
    },
    item: {
      getItemLoadouts: { useQuery: item.useQuery },
      setLoadoutHotkeys: { useMutation: item.useMutation },
    },
  });
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: { jutsuLoadout: "jutsu-set", itemLoadout: "item-set" },
  } as never);
  const view = renderHook(() => useBattleHotkeys(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { view, saves, reads, server, queryClient };
};

it("keeps queued keys shown until the last save settles, then refetches both loadouts", async () => {
  const { view, saves, reads, server, queryClient } = mount();
  await waitFor(() => expect(view.result.current.hasItemLoadout).toBe(true));
  expect(reads).toEqual({ jutsu: 1, item: 1 });

  act(() => {
    view.result.current.setHotkey("jutsu", "first", "k");
  });
  act(() => {
    view.result.current.setHotkey("item", "second", "l");
  });
  await waitFor(() => expect(saves).toHaveLength(1));

  // The first save settles while the second waits; the shown keys stay.
  await act(() => saves[0]!.confirm());
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(reads).toEqual({ jutsu: 1, item: 1 });
  expect(view.result.current.byKey).toMatchObject({ k: "first", l: "second" });

  // A further change builds on every queued key, not on the first save alone.
  act(() => {
    view.result.current.setHotkey("jutsu", "third", "p");
  });
  await act(() => saves[1]!.confirm());
  await waitFor(() => expect(saves).toHaveLength(3));
  expect(saves[2]!.hotkeys).toEqual({ first: "k", third: "p" });

  await act(() => saves[2]!.confirm());
  await waitFor(() => expect(reads).toEqual({ jutsu: 2, item: 2 }));
  expect(server).toEqual({ jutsu: { first: "k", third: "p" }, item: { second: "l" } });
  expect(view.result.current.byKey).toMatchObject({ k: "first", l: "second", p: "third" });
  queryClient.clear();
});

it("drops a refetch already in flight when a new key is shown", async () => {
  const { view, saves, reads, queryClient } = mount();
  await waitFor(() => expect(view.result.current.hasJutsuLoadout).toBe(true));

  act(() => {
    void queryClient.invalidateQueries({ queryKey: ["jutsu", "getLoadouts"] });
    view.result.current.setHotkey("jutsu", "first", "k");
  });
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(view.result.current.byKey.k).toBe("first");
  await act(() => saves[0]!.confirm());
  await waitFor(() => expect(reads.jutsu).toBe(3));
  expect(view.result.current.byKey.k).toBe("first");
  queryClient.clear();
});
