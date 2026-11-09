import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCQueryUtils } from "@trpc/react-query";
import { waitFor } from "@testing-library/react";
import { expect, it, vi } from "bun:test";
import { shouldInvalidateEndedBattleCaches } from "@/libs/combat/battleMaps";
import { maskBattle } from "@/libs/combat/masking";
import type { AppRouter } from "@/server/api/root";
import { makeCompleteBattle } from "../setup/combat";
import { guardianVictory } from "../setup/territoryWar";
import { getCombatInventoryUpdate } from "@/deltas/combat";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { readSource, runInScope, sliceCall } from "../setup/sourceSlice";

// Execute the real completion effect without mounting its unrelated WebGL scene,
// following combat-render-lifecycle.test.ts. Keep masking and query utilities real.
const effect = sliceCall(
  readSource("layout/Combat.tsx"),
  /useEffect\(\(\)\s*=>\s*\{\s*const endedBattleId\b/,
);
const complete = (scope: object) => runInScope(effect, scope);

it.each([
  { type: "TERRITORY_WAR", snapshot: true, hasResult: true, invalidates: true },
  { type: "COMBAT", snapshot: true, hasResult: true, invalidates: true },
  { type: "COMBAT", snapshot: false, hasResult: true, invalidates: true },
  { type: "ARENA", snapshot: false, hasResult: true, invalidates: false },
  { type: "TERRITORY_WAR", snapshot: true, hasResult: false, invalidates: false },
] as const)(
  "reconciles public $type completion caches (snapshot: $snapshot, result: $hasResult)",
  async ({ type, snapshot, hasResult, invalidates }) => {
    const authoritative = snapshot ? guardianVictory() : makeCompleteBattle();
    authoritative.battleType = type;
    const battle = maskBattle(authoritative, "player-0");
    expect(battle.extraState).not.toHaveProperty("territoryWar");
    expect(authoritative.extraState.territoryWar !== undefined).toBe(snapshot);

    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const utils = createTRPCQueryUtils({
      client: createTRPCClient<AppRouter>({ links: [] }),
      queryClient: client,
    });
    const keys = ["territoryWar", "village", "clan"].map((router) => [
      [router, router === "territoryWar" ? "getCurrent" : "get"],
      { type: "query" },
    ]);
    for (const key of keys) client.setQueryData(key, { version: "before" });
    const noticeKey = [["territoryWar", "getNotice"], { type: "query" }];
    client.setQueryData(noticeKey, { version: "before" });
    const readNotice = vi.fn(async () => ({ version: "after" }));
    const observer = new QueryObserver(client, {
      queryKey: noticeKey,
      queryFn: readNotice,
    });
    const close = observer.subscribe(() => {});
    try {
      const scope = {
        props: {
          battleState: { battle, result: hasResult ? { outcome: "Won" } : null },
        },
        result: hasResult ? { outcome: "Won" } : null,
        endedBattleInvalidationRef: { current: null },
        completionRevisionRef: { current: null },
        shouldInvalidateEndedBattleCaches,
        prepareUserUpdate: () => 1,
        updateUser: vi.fn(async () => {}),
        prepareInventoryUpdate: vi.fn(),
        updateInventory: vi.fn(async () => undefined),
        prepareSectorUpdate: vi.fn(),
        updateSector: vi.fn(async () => undefined),
        utils,
        useEffect: (callback: () => void) => callback(),
      };
      complete(scope);
      for (const key of keys) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(invalidates);
        // Inactive treasuries stay cached until their pages are opened.
        expect(client.getQueryData(key)).toEqual({ version: "before" });
        expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
      }
      if (invalidates) {
        await waitFor(() =>
          expect(client.getQueryData(noticeKey)).toEqual({ version: "after" }),
        );
      }
      expect(readNotice).toHaveBeenCalledTimes(invalidates ? 1 : 0);
      complete(scope);
      expect(readNotice).toHaveBeenCalledTimes(invalidates ? 1 : 0);
      expect(scope.updateUser).toHaveBeenCalledTimes(hasResult ? 1 : 0);
    } finally {
      close();
      client.clear();
    }
  },
);

it.each([true, false])(
  "reconciles both combat inventories after profile completion (local projection=%s)",
  async (profileApplied) => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const baseline = [
      {
        id: "owned",
        quantity: 2,
        durability: 50,
        level: 1,
        experience: 0,
        equipped: "NONE",
      },
    ];
    const after = [{ ...baseline[0]!, quantity: 1 }];
    const keys = ["items", "variants"].map((name) => [name]);
    let profileSettled = false;
    const reads = keys.map((key) => {
      client.setQueryData(key, baseline);
      return vi.fn(async () => {
        expect(profileSettled).toBe(true);
        return after;
      });
    });
    const stops = keys.map((queryKey, index) =>
      new QueryObserver(client, { queryKey, queryFn: reads[index]! }).subscribe(
        () => {},
      ),
    );
    const updateInventory = vi.fn(
      async (
        update: ((rows: typeof baseline) => typeof baseline | undefined) | undefined,
        snapshot: { revision: number | undefined }[],
      ) => {
        await Promise.all(
          keys.map((key, index) =>
            updateQueryCache(client, key, update, snapshot[index]),
          ),
        );
      },
    );
    const battle = maskBattle(makeCompleteBattle(), "player-0");
    battle.battleType = "ARENA";
    const scope = {
      props: {
        battleState: {
          battle,
          result: {
            outcome: "Won",
            profileUpdate: { baseline: { items: baseline }, items: after },
          },
        },
      },
      result: { outcome: "Won" },
      endedBattleInvalidationRef: { current: null },
      completionRevisionRef: { current: null },
      shouldInvalidateEndedBattleCaches,
      prepareUserUpdate: () => 1,
      updateUser: async () => {
        profileSettled = true;
        return profileApplied;
      },
      prepareInventoryUpdate: () =>
        keys.map((key) => ({ revision: prepareQueryUpdate(client, key) })),
      updateInventory,
      prepareSectorUpdate: vi.fn(),
      updateSector: vi.fn(async () => undefined),
      getCombatInventoryUpdate,
      utils: {},
      useEffect: (callback: () => void) => callback(),
    };
    try {
      complete(scope);
      await waitFor(() => expect(updateInventory).toHaveBeenCalledTimes(1));
      await updateInventory.mock.results[0]!.value;
      keys.forEach((key) => expect(client.getQueryData(key)).toEqual(after));
      reads.forEach((read) =>
        expect(read).toHaveBeenCalledTimes(profileApplied ? 0 : 1),
      );
    } finally {
      stops.forEach((stop) => stop());
      client.clear();
    }
  },
);
