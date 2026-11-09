import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import superjson from "superjson";
import * as client from "@/app/_trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
import type { BattleAction } from "@/drizzle/schema";
import { useCombatUpdates } from "@/hooks/combat";
import CombatHistory from "@/layout/CombatHistory";
import type { BattleUpdate } from "@/libs/combat/log";
import type { BattleState } from "@/libs/combat/types";
import * as UserContext from "@/utils/UserContext";
import { deferred } from "../setup/deferred";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

// Keep the real history component, subscription hook and tRPC query lifecycle;
// control only websocket delivery, user context and the server's log responses.
let queryClient: QueryClient;
let entries: BattleAction[];
let onEvent: ((event: BattleUpdate) => Promise<void>) | undefined;
let applyLogs: ReturnType<typeof useCombatUpdates>["updateLogs"];
let readEntries: ReturnType<typeof vi.fn>;
const unsubscribe = vi.fn();
const unbind = vi.fn();
const finalState = {
  battle: { id: "battle", version: 4 },
  result: { outcome: "Lost" },
  isPending: false,
} as BattleState;
const lethalEntry = {
  id: "final-hit",
  battleId: "battle",
  battleRound: 1,
  battleVersion: 3,
  userId: "killer",
  actionId: "basicAttack",
  description: "Killer strikes Victim",
  appliedEffects: [{ txt: "Victim takes 100 damage", color: "red" }],
  createdAt: new Date(),
  updatedAt: new Date(),
} as BattleAction;
const row = (version: number) => ({
  ...lethalEntry,
  id: `hit-${version}`,
  battleVersion: version,
});

beforeEach(() => {
  entries = [];
  onEvent = undefined;
  unsubscribe.mockClear();
  unbind.mockClear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  readEntries = vi.fn((): BattleAction[] | Promise<BattleAction[]> => entries);
  Object.assign(vi.spyOn(client, "api" as never), {
    combat: testApi.combat,
    useUtils: testApi.useUtils,
  });
  const user = {
    data: { userId: "victim", role: "USER", showBattleDescription: true },
    pusher: {
      subscribe: () => ({
        bind: (_event: string, handler: typeof onEvent) => {
          onEvent = handler;
        },
        unbind,
      }),
      unsubscribe,
    },
  };
  vi.spyOn(UserContext, "useUserData").mockReturnValue(user as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue(user as never);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

/** Exercise history as either a live battle subscriber or a reopened saved log. */
const History = ({ state, listen }: { state: BattleState; listen: boolean }) => {
  applyLogs = useCombatUpdates(
    listen ? state : { battle: null, result: null, isPending: false },
  ).updateLogs;
  return (
    <CombatHistory
      battleId="battle"
      battleVersion={listen ? state.battle?.version : undefined}
      results={state.result}
    />
  );
};

/** Reuse the query cache across mounts to reproduce navigation with cached reads. */
const mount = (
  listen = true,
  state = finalState,
  extra?: RouterInputs["combat"]["getBattleEntries"],
) => {
  const trpcClient = fakeTrpcClient((path) => {
    if (path !== "combat.getBattleEntries")
      throw new Error(`Unexpected procedure ${path}`);
    return readEntries();
  });
  const tree = (current: BattleState) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <History state={current} listen={listen} />
      {extra && <AdditionalHistory input={extra} />}
    </TrpcTestProviders>
  );
  const view = render(tree(state));
  return {
    ...view,
    changeState: (current: BattleState) => view.rerender(tree(current)),
  };
};

/** Keep a second filtered or paginated view active to count its actual requests. */
const AdditionalHistory = ({
  input,
}: {
  input: RouterInputs["combat"]["getBattleEntries"];
}) => {
  testApi.combat.getBattleEntries.useQuery(input);
  return null;
};

it.each([4, 3, 5])(
  "recovers a lethal hit inserted after settlement, on websocket version %s",
  async (version) => {
    const battleKey = getQueryKey(
      testApi.combat.getBattle,
      { battleId: "battle" },
      "query",
    );
    const otherKey = getQueryKey(
      testApi.combat.getBattleEntries,
      { battleId: "other" },
      "query",
    );
    queryClient.setQueryData(battleKey, finalState);
    queryClient.setQueryData(otherKey, []);
    const view = mount();
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
    expect(view.queryByText(/Victim takes/)).toBeNull();
    entries = [lethalEntry];
    await act(async () => {
      await onEvent?.({
        version,
        logEntries: superjson.serialize(entries),
        finished: true,
      });
    });
    await view.findByText(/Victim takes 100 damage/);
    expect(queryClient.getQueryState(battleKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    view.unmount();
    expect(unbind).toHaveBeenCalledWith("event", expect.any(Function));
    expect(unsubscribe).toHaveBeenCalledWith("battle");
  },
);

it("refreshes a cached saved log when it is reopened after the final insert", async () => {
  const view = mount(false);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  view.unmount();
  entries = [lethalEntry];
  const reopened = mount(false);
  await reopened.findByText(/Victim takes 100 damage/);
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("discards a saved log's pre-insert request when reopened before it finishes", async () => {
  const { promise: oldResponse, resolve: finishOldRead } = deferred<BattleAction[]>();
  readEntries.mockImplementationOnce(() => oldResponse);
  const state = { ...finalState, result: null };
  const view = mount(false, state);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  view.unmount();
  entries = [lethalEntry];
  const reopened = mount(false, state);
  await act(async () => {
    finishOldRead([]);
  });
  await reopened.findByText(/Victim takes 100 damage/);
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("discards an in-flight pre-insert history response when the final event arrives", async () => {
  const { promise: oldResponse, resolve: finishOldRead } = deferred<BattleAction[]>();
  readEntries.mockImplementationOnce(() => oldResponse);
  const view = mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  entries = [lethalEntry];
  await act(async () => {
    await onEvent?.({
      version: 4,
      logEntries: superjson.serialize(entries),
      finished: true,
    });
  });
  await view.findByText(/Victim takes 100 damage/);
  await act(async () => {
    finishOldRead([]);
  });
  expect(view.getByText(/Victim takes 100 damage/)).toBeTruthy();
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("refreshes an older held log on settlement when the deleted battle cannot advance its key", async () => {
  const state = {
    battle: { id: "battle", version: 3 },
    result: null,
    isPending: false,
  } as BattleState;
  const view = mount(true, state);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  entries = [lethalEntry];
  await act(async () => {
    await onEvent?.({
      version: 4,
      logEntries: superjson.serialize(entries),
      finished: true,
    });
  });
  await view.findByText(/Victim takes 100 damage/);
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("still refreshes live battle state for a newer action", async () => {
  const state = { ...finalState, result: null };
  const battleKey = getQueryKey(
    testApi.combat.getBattle,
    { battleId: "battle" },
    "query",
  );
  queryClient.setQueryData(battleKey, state);
  mount(true, state);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  await act(async () => {
    await onEvent?.({ version: 5 });
  });
  await waitFor(() =>
    expect(queryClient.getQueryState(battleKey)?.isInvalidated).toBe(true),
  );
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it.each(["websocket", "response"] as const)(
  "merges ordinary %s actions with no extra history reads, including remounts",
  async (source) => {
    const state = {
      battle: { id: "battle", version: 1 },
      result: null,
      isPending: false,
    } as BattleState;
    const view = mount(true, state);
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
    for (let version = 2; version <= 6; version++) {
      const delta = [
        { ...lethalEntry, id: `hit-${version}`, battleVersion: version - 1 },
      ];
      await act(async () => {
        if (source === "websocket")
          await onEvent?.({ version, logEntries: superjson.serialize(delta) });
        else await applyLogs("battle", version, delta);
      });
      view.changeState({ ...state, battle: { ...state.battle!, version } });
      await waitFor(() =>
        expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(version - 1),
      );
      expect(readEntries).toHaveBeenCalledTimes(1);
    }
    view.unmount();
    const reopened = mount(true, {
      ...state,
      battle: { ...state.battle!, version: 6 },
    });
    await reopened.findAllByText(/Victim takes 100 damage/);
    expect(readEntries).toHaveBeenCalledTimes(1);
  },
);

it("repairs an already-claimed final version from a delta without a read, including duplicates and older delivery", async () => {
  entries = [2, 1].map(row);
  const view = mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  for (const version of [4, 4, 3]) {
    await act(async () => {
      await onEvent?.({
        version,
        logEntries: superjson.serialize([lethalEntry]),
        finished: true,
      });
    });
  }
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3),
  );
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it("preserves newer committed rows already fetched under an older refresh key", async () => {
  const oldInput = { battleId: "battle", refreshKey: 2, checkBattle: false, limit: 30 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, oldInput, "query"),
    [row(1)],
  );
  queryClient.setQueryData(
    getQueryKey(
      testApi.combat.getBattleEntries,
      { ...oldInput, refreshKey: 3 },
      "query",
    ),
    [row(3), row(2), row(1)],
  );
  const state = {
    battle: { id: "battle", version: 3 },
    result: null,
    isPending: false,
  } as BattleState;
  const view = mount(true, state);
  await act(async () => {
    await onEvent?.({ version: 3, logEntries: superjson.serialize([row(2)]) });
  });
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3),
  );
  expect(readEntries).not.toHaveBeenCalled();
});

it("updates a complete older held log directly when terminal state cannot advance its key", async () => {
  const state = { ...finalState, battle: { ...finalState.battle!, version: 3 } };
  const input = { battleId: "battle", refreshKey: 3, checkBattle: true, limit: 30 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, input, "query"),
    [2, 1].map(row),
  );
  const view = mount(true, state);
  await act(async () => {
    await onEvent?.({
      version: 4,
      logEntries: superjson.serialize([lethalEntry]),
      finished: true,
    });
  });
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3),
  );
  expect(readEntries).not.toHaveBeenCalled();
});

it("does not add reads for an oversized ordinary event at the current version", async () => {
  mount(true, { ...finalState, result: null });
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  await act(async () => {
    await onEvent?.({ version: 4, logEntries: null });
  });
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it("does not repeatedly repair a spectator's held result for later ordinary actions", async () => {
  mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  await act(async () => {
    await onEvent?.({
      version: 6,
      logEntries: superjson.serialize([{ ...lethalEntry, battleVersion: 5 }]),
    });
  });
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it("cancels a pre-insert response before seeding a complete final page", async () => {
  let finishOldRead!: (rows: BattleAction[]) => void;
  readEntries.mockImplementationOnce(
    () =>
      new Promise<BattleAction[]>((resolve) => {
        finishOldRead = resolve;
      }),
  );
  const oldInput = { battleId: "battle", refreshKey: 3, checkBattle: true, limit: 30 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, oldInput, "query"),
    [2, 1].map(row),
  );
  const view = mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  await act(async () => {
    await onEvent?.({
      version: 4,
      logEntries: superjson.serialize([lethalEntry]),
      finished: true,
    });
  });
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3),
  );
  await act(async () => {
    finishOldRead([]);
  });
  expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3);
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it.each([
  { userFilter: "opponents" as const },
  { showBasicActions: false },
  { offset: 5 },
])(
  "does not refresh ordinary filtered/paginated pages, but recovers them once after settlement (%j)",
  async (filter) => {
    const state = { ...finalState, result: null };
    const filteredInput = { battleId: "battle", refreshKey: 4, ...filter };
    const view = mount(true, state, filteredInput);
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(2));
    const filteredKey = getQueryKey(
      testApi.combat.getBattleEntries,
      filteredInput,
      "query",
    );
    await act(async () => {
      await onEvent?.({ version: 4, logEntries: superjson.serialize([lethalEntry]) });
    });
    expect(readEntries).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(false);
    entries = [lethalEntry];
    await act(async () => {
      await onEvent?.({ version: 4, logEntries: null, finished: true });
    });
    await view.findByText(/Victim takes 100 damage/);
    await waitFor(() =>
      expect(queryClient.getQueryData<BattleAction[]>(filteredKey)).toEqual(entries),
    );
    expect(readEntries).toHaveBeenCalledTimes(4);
  },
);

it.each([5, 30, 1000])(
  "merges only the freshest retained page for limit %i",
  async (limit) => {
    let sourceVisits = 0;
    const versions = 300;
    const input = { battleId: "battle", limit };
    for (let version = 2; version <= versions + 1; version++) {
      const rows = Array.from(
        { length: Math.min(version - 1, limit) },
        (_, i) =>
          new Proxy(row(version - 1 - i), {
            get(target, key) {
              if (key === "battleId") sourceVisits++;
              return Reflect.get(target, key);
            },
          }),
      );
      queryClient.setQueryData(
        getQueryKey(
          testApi.combat.getBattleEntries,
          { ...input, refreshKey: version },
          "query",
        ),
        rows,
      );
    }
    mount();
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
    await act(async () => {
      await applyLogs("battle", versions + 2, [row(versions + 1)]);
    });
    expect(sourceVisits).toBe(Math.min(versions, limit));
    const latest = queryClient.getQueryData<BattleAction[]>(
      getQueryKey(
        testApi.combat.getBattleEntries,
        { ...input, refreshKey: versions + 2 },
        "query",
      ),
    );
    expect(latest?.map((entry) => entry.battleVersion)).toEqual(
      Array.from({ length: Math.min(versions + 1, limit) }, (_, i) => versions + 1 - i),
    );
  },
);

it.each([{ latest: undefined }, { latest: [2, 1] }])(
  "falls back to complete history when the latest key has missing data or gaps (%j)",
  async ({ latest }) => {
    const input = { battleId: "battle", limit: 5 };
    queryClient.setQueryData(
      getQueryKey(
        testApi.combat.getBattleEntries,
        { ...input, refreshKey: 4 },
        "query",
      ),
      [3, 2, 1].map(row),
    );
    // A mounted version may have an in-flight read without any cached data yet.
    queryClient.getQueryCache().build(queryClient, {
      queryKey: getQueryKey(
        testApi.combat.getBattleEntries,
        { ...input, refreshKey: 5 },
        "query",
      ),
      initialData: latest?.map(row),
    });
    mount();
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
    await act(async () => {
      await applyLogs("battle", 5, [row(4)]);
    });
    const repaired = queryClient.getQueryData<BattleAction[]>(
      getQueryKey(
        testApi.combat.getBattleEntries,
        { ...input, refreshKey: 5 },
        "query",
      ),
    );
    expect(repaired?.map((entry) => entry.battleVersion)).toEqual([4, 3, 2, 1]);
  },
);

it("repairs multiple mounted terminal keys from the freshest complete page", async () => {
  const input = { battleId: "battle", checkBattle: true, limit: 30 };
  const oldest = { ...input, refreshKey: 2 };
  const held = { ...input, refreshKey: 3 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, oldest, "query"),
    [row(1)],
  );
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, held, "query"),
    [row(2), row(1)],
  );
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, { ...input, refreshKey: 4 }, "query"),
    [row(3), row(2), row(1)],
  );
  const state = { ...finalState, battle: { ...finalState.battle!, version: 2 } };
  const view = mount(true, state, held);
  await act(async () => {
    await applyLogs("battle", 5, [row(4)], true);
  });
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(4),
  );
  expect(
    queryClient
      .getQueryData<BattleAction[]>(
        getQueryKey(testApi.combat.getBattleEntries, held, "query"),
      )
      ?.map((entry) => entry.battleVersion),
  ).toEqual([4, 3, 2, 1]);
  expect(readEntries).not.toHaveBeenCalled();
});

it("recovers an inactive terminal key if a held result later remounts", async () => {
  const input = { battleId: "battle", checkBattle: true, limit: 30 };
  const heldKey = getQueryKey(
    testApi.combat.getBattleEntries,
    { ...input, refreshKey: 2 },
    "query",
  );
  queryClient.setQueryData(heldKey, [row(1)]);
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, { ...input, refreshKey: 4 }, "query"),
    [row(3), row(2), row(1)],
  );
  const view = mount();
  await act(async () => {
    await applyLogs("battle", 5, [row(4)], true);
  });
  expect(queryClient.getQueryState(heldKey)?.isInvalidated).toBe(true);
  entries = [4, 3, 2, 1].map(row);
  view.changeState({ ...finalState, battle: { ...finalState.battle!, version: 2 } });
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(4),
  );
  expect(readEntries).toHaveBeenCalledTimes(1);
});

it("keeps saved unversioned logs on recovery reads even when a versioned source is complete", async () => {
  const input = { battleId: "battle", checkBattle: false, limit: 30 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, { ...input, refreshKey: 3 }, "query"),
    [2, 1].map(row),
  );
  const view = mount(false);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  entries = [lethalEntry];
  await act(async () => {
    await applyLogs("battle", 4, [lethalEntry]);
  });
  await view.findByText(/Victim takes 100 damage/);
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("does not overwrite a newer page committed while cancellation is pending", async () => {
  const input = { battleId: "battle", limit: 5 };
  queryClient.setQueryData(
    getQueryKey(testApi.combat.getBattleEntries, { ...input, refreshKey: 3 }, "query"),
    [row(2), row(1)],
  );
  mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  const { promise: pendingCancellation, resolve: finishCancellation } =
    deferred<void>();
  const cancel = vi
    .spyOn(queryClient, "cancelQueries")
    .mockImplementationOnce(() => pendingCancellation);
  const pendingUpdate = applyLogs("battle", 4, [row(3)]);
  expect(cancel).toHaveBeenCalledTimes(1);
  const targetKey = getQueryKey(
    testApi.combat.getBattleEntries,
    { ...input, refreshKey: 4 },
    "query",
  );
  queryClient.setQueryData(targetKey, [row(4), row(3), row(2), row(1)]);
  await act(async () => {
    finishCancellation();
    await pendingUpdate;
  });
  expect(
    queryClient
      .getQueryData<BattleAction[]>(targetKey)
      ?.map((entry) => entry.battleVersion),
  ).toEqual([4, 3, 2, 1]);
});

it("updates complete saved logs without reads, preserving gap recovery and reordered events", async () => {
  entries = [2, 1].map(row);
  const view = mount(false);
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  for (const [version, delta] of [
    [4, 3],
    [4, 3],
    [3, 2],
  ]) {
    await act(async () => applyLogs("battle", version!, [row(delta!)]));
  }
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(3),
  );
  expect(readEntries).toHaveBeenCalledTimes(1);
  entries = [5, 4, 3, 2, 1].map(row);
  await act(async () => applyLogs("battle", 6, [row(5)]));
  await waitFor(() =>
    expect(view.getAllByText(/Victim takes 100 damage/)).toHaveLength(5),
  );
  expect(readEntries).toHaveBeenCalledTimes(2);
});

it("marks an inactive saved log stale once until it is reopened", async () => {
  const key = getQueryKey(
    testApi.combat.getBattleEntries,
    { battleId: "battle", checkBattle: false, limit: 30 },
    "query",
  );
  queryClient.setQueryData(key, []);
  mount();
  await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  for (const version of [4, 5, 6]) {
    await act(async () =>
      applyLogs("battle", version, [{ ...lethalEntry, battleVersion: version - 1 }]),
    );
  }
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(readEntries).toHaveBeenCalledTimes(1);
});
