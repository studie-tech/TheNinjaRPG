import { afterEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { useBattleHotkeys } from "@/hooks/useBattleHotkeys";
import type { HotkeyMap } from "@/libs/combat/hotkeys";
import { updateQueryCache } from "@/utils/queryCache";
import * as userContext from "@/utils/UserContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Save = { hotkeys: HotkeyMap; confirm: () => Promise<void> };

/** Loadout reads and hotkey saves backed by a query client, with saves confirmed by the test. */
const mount = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const server = { jutsu: {} as HotkeyMap, item: {} as HotkeyMap };
  const reads = { jutsu: 0, item: 0 };
  const readDelays: Partial<Record<"jutsu" | "item", Promise<void>>> = {};
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
          const rows = [
            { id, name: `${kind} set`, hotkeys: { ...server[kind] } },
            { id: `${id}-other`, name: `${kind} other`, hotkeys: {} },
          ];
          await readDelays[kind];
          return rows;
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
  const view = renderHook(
    (options: Parameters<typeof useBattleHotkeys>[0]) => useBattleHotkeys(options),
    {
      initialProps: {},
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  const delayRead = (kind: "jutsu" | "item") => {
    let resume = () => {};
    readDelays[kind] = new Promise<void>((resolve) => {
      resume = resolve;
    });
    return () => {
      delete readDelays[kind];
      resume();
    };
  };
  return { view, saves, reads, server, queryClient, delayRead };
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
  expect(view.result.current.byKey).toMatchObject({
    k: "first",
    l: "second",
    p: "third",
  });
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

it.each(["jutsu", "item"] as const)(
  "preserves queued %s assignments across another mutation's refetch",
  async (kind) => {
    const { view, saves, reads, server, queryClient } = mount();
    await waitFor(() => expect(view.result.current.hasJutsuLoadout).toBe(true));
    const firstAction = kind === "jutsu" ? "move" : "potion";
    const secondAction = kind === "jutsu" ? "wait" : "scroll";
    const key =
      kind === "jutsu" ? ["jutsu", "getLoadouts"] : ["item", "getItemLoadouts"];

    act(() => {
      view.result.current.setHotkey(kind, firstAction, "k");
    });
    await waitFor(() => expect(saves).toHaveLength(1));

    // An equipment mutation without a reusable snapshot requests an authoritative read.
    await act(async () => {
      await updateQueryCache(queryClient, key, undefined, {
        revision: undefined,
      });
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(reads[kind]).toBe(2);
    expect(view.result.current.byAction[firstAction]).toBe("k");
    act(() => {
      const otherKind = kind === "jutsu" ? "item" : "jutsu";
      expect(view.result.current.setHotkey(otherKind, "conflicting", "k")).toBe(false);
    });

    act(() => {
      view.result.current.setHotkey(kind, secondAction, "p");
    });
    await act(() => saves[0]!.confirm());
    await waitFor(() => expect(saves).toHaveLength(2));
    const expected = { [firstAction]: "k", [secondAction]: "p" };
    expect(saves[1]!.hotkeys).toEqual(expected);
    expect(view.result.current.byAction).toMatchObject(expected);

    await act(() => saves[1]!.confirm());
    await waitFor(() => expect(view.result.current.isSaving).toBe(false));
    expect(server[kind]).toEqual(expected);
    queryClient.clear();
  },
);

it.each(["jutsu", "item"] as const)(
  "preserves confirmed %s keys when an older read finishes during another queued save",
  async (kind) => {
    const { view, saves, reads, server, queryClient, delayRead } = mount();
    await waitFor(() => expect(view.result.current.hasItemLoadout).toBe(true));
    const otherKind = kind === "jutsu" ? "item" : "jutsu";
    const key =
      kind === "jutsu" ? ["jutsu", "getLoadouts"] : ["item", "getItemLoadouts"];
    act(() => {
      view.result.current.setHotkey(kind, "first", "k");
    });
    act(() => {
      view.result.current.setHotkey(otherKind, "second", "l");
    });
    await waitFor(() => expect(saves).toHaveLength(1));

    const resumeRead = delayRead(kind);
    act(() => {
      void queryClient.invalidateQueries({ queryKey: key });
    });
    await waitFor(() => expect(reads[kind]).toBe(2));
    await act(() => saves[0]!.confirm());
    await waitFor(() => expect(saves).toHaveLength(2));
    await act(async () => {
      resumeRead();
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(view.result.current.byKey).toMatchObject({ k: "first", l: "second" });

    act(() => {
      view.result.current.setHotkey(kind, "third", "p");
    });
    await act(() => saves[1]!.confirm());
    await waitFor(() => expect(saves).toHaveLength(3));
    expect(saves[2]!.hotkeys).toEqual({ first: "k", third: "p" });
    await act(() => saves[2]!.confirm());
    await waitFor(() => expect(view.result.current.isSaving).toBe(false));
    expect(server[kind]).toEqual({ first: "k", third: "p" });
    expect(server[otherKind]).toEqual({ second: "l" });
    queryClient.clear();
  },
);

it("keeps pending and confirmed keys on their original loadout when selection changes", async () => {
  const { view, saves, queryClient } = mount();
  await waitFor(() => expect(view.result.current.hasJutsuLoadout).toBe(true));
  act(() => {
    view.result.current.setHotkey("jutsu", "move", "k");
  });
  await waitFor(() => expect(saves).toHaveLength(1));

  view.rerender({ jutsuLoadoutId: "jutsu-set-other" });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["jutsu", "getLoadouts"] });
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(view.result.current.byAction.move).toBe("m");
  view.rerender({});
  expect(view.result.current.byAction.move).toBe("k");
  view.rerender({ jutsuLoadoutId: "jutsu-set-other" });

  await act(() => saves[0]!.confirm());
  await waitFor(() => expect(view.result.current.isSaving).toBe(false));
  expect(view.result.current.byAction.move).toBe("m");
  view.rerender({});
  expect(view.result.current.byAction.move).toBe("k");
  queryClient.clear();
});
