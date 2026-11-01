import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { useEffect, useState } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { useCombatUpdates } from "@/hooks/combat";
import type { BattleUpdate } from "@/libs/combat/log";
import type { BattleState } from "@/libs/combat/types";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

// Keep the real tRPC observer and mutation lifecycle; control network ordering.
const testApi = createTRPCReact<AppRouter>();
type ActionResponse = RouterOutputs["combat"]["performAction"];
let queryClient: QueryClient;
let onEvent: (data: BattleUpdate) => Promise<void>;
let setState: (state: BattleState) => void;
let performAction: () => void;
let finishAction: (response: ActionResponse) => void;
let failAction: (error: Error) => void;
let reads: string[];
let finishRead: ((state: BattleState) => void) | undefined;
let pauseSuccess: Promise<void> | undefined;
let latestState: BattleState;

const stateAt = (version: number, patch: Partial<BattleState> = {}) =>
  ({ battle: { id: "battle", version, updatedAt: new Date(0) }, result: null, isPending: false, ...patch }) as BattleState;

beforeEach(() => {
  ensureDom();
  reads = [];
  finishRead = undefined;
  pauseSuccess = undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  Object.assign(vi.spyOn(client, "api" as never), { combat: testApi.combat, useUtils: testApi.useUtils });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ pusher: {
    subscribe: () => ({ bind: (_event: string, handler: typeof onEvent) => { onEvent = handler; }, unbind: vi.fn() }),
    unsubscribe: vi.fn(),
  } } as never);
});

afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

const mount = (initial = stateAt(1)) => {
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "combat.performAction") {
      finishAction = (data) => { observer.next({ result: { data } }); observer.complete(); };
      failAction = (error) => observer.error(TRPCClientError.from<AppRouter>(error));
    } else if (op.path === "combat.getBattle") {
      reads.push(op.path);
      if (reads.length === 1) { observer.next({ result: { data: initial } }); observer.complete(); }
      else finishRead = (data) => { observer.next({ result: { data } }); observer.complete(); };
    } else throw new Error(`Unexpected procedure ${op.path}`);
  })] });
  function Hook() {
    const [state, updateState] = useState(initial);
    setState = updateState;
    latestState = state;
    const { startAction, settleAction } = useCombatUpdates(state);
    const { data } = testApi.combat.getBattle.useQuery({ battleId: state.battle?.id });
    // The combat page applies query responses independently of the mutation.
    useEffect(() => { if (data?.battle) updateState({ ...data, isPending: false }); }, [data]);
    const action = testApi.combat.performAction.useMutation({
      onMutate: () => { updateState((current) => ({ ...current, isPending: true })); },
      onSuccess: async (data) => {
        await pauseSuccess;
        updateState((current) => data.battleUpdate && data.updateClient
          ? { battle: data.battleUpdate, result: data.result, isPending: false }
          : { ...current, isPending: false });
      },
      onError: () => {
        updateState((current) => ({ ...current, isPending: false }));
      },
      onSettled: (data, error, variables) => settleAction(variables.battleId, {
        battle: data?.updateClient ? data.battleUpdate : undefined, result: data?.result,
      }, !!error || (!!data?.updateClient && !data.battleUpdate)),
    });
    performAction = () => {
      if (!startAction("battle")) return;
      action.mutate({ battleId: "battle" } as never);
    };
    return null;
  }
  return render(<testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><Hook /></QueryClientProvider></testApi.Provider>);
};

const actionResponse = (version: number) => ({ updateClient: true, battleUpdate: stateAt(version).battle!, result: null, logEntries: [], updatedQuestIds: [] });

const beginAction = async () => {
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => performAction());
  await waitFor(() => expect(queryClient.isMutating()).toBe(1));
};
const respond = async (version = 2) => {
  await act(async () => finishAction(actionResponse(version)));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
};

it("avoids the extra getBattle request when the actor broadcast precedes the same response version", async () => {
  mount();
  await beginAction();
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(1);
  await respond();
  expect(reads).toHaveLength(1);
  expect(queryClient.getQueryData<BattleState>(getQueryKey(testApi.combat.getBattle, { battleId: "battle" }, "query"))?.battle?.version).toBe(2);
});

it("does not refresh when the mutation response precedes its broadcast", async () => {
  mount();
  await beginAction();
  await respond();
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(1);
  await act(async () => onEvent({ version: 3 }));
  expect(reads).toHaveLength(2);
});

it("cancels an older poll and recovers without regressing the committed action", async () => {
  mount();
  await beginAction();
  const key = getQueryKey(testApi.combat.getBattle, { battleId: "battle" }, "query");
  await act(async () => { void queryClient.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(reads).toHaveLength(2));
  const finishOldRead = finishRead;
  await respond();
  await waitFor(() => expect(reads).toHaveLength(3));
  await act(async () => finishOldRead?.(stateAt(1, { battle: { ...stateAt(1).battle!, updatedAt: new Date(1) } as never })));
  expect(latestState.battle?.version).toBe(2);
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(3);
  await act(async () => finishRead?.(stateAt(2)));
  await waitFor(() => expect(latestState.battle?.version).toBe(2));
});

it("blocks synchronous duplicate submissions and retains an uncovered opponent event", async () => {
  mount();
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { performAction(); performAction(); });
  expect(queryClient.isMutating()).toBe(1);
  await act(async () => onEvent({ version: 3 }));
  await act(async () => performAction());
  expect(queryClient.isMutating()).toBe(1);
  await respond(2);
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => finishRead?.(stateAt(3)));
  await waitFor(() => expect(latestState.battle?.version).toBe(3));
  // Successful settlement releases the guard for the next real action.
  await act(async () => performAction());
  await waitFor(() => expect(queryClient.isMutating()).toBe(1));
  await respond(4);
  expect(reads).toHaveLength(2);
});

it.each(["failure", "no-op"])("allows another submission after a %s settles", async (outcome) => {
  mount();
  await beginAction();
  await act(async () => {
    if (outcome === "failure") failAction(new Error("Connection lost"));
    else finishAction({ notification: "Not your turn. Wait for opponent" });
  });
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  if (outcome === "failure") await act(async () => finishRead?.(stateAt(1)));
  await act(async () => performAction());
  await waitFor(() => expect(queryClient.isMutating()).toBe(1));
  await respond();
  expect(latestState.battle?.version).toBe(2);
});

it("retains the maximum opponent version across duplicate and reordered pending events", async () => {
  mount();
  await beginAction();
  await act(async () => { for (const version of [2, 5, 3, 5, 4]) await onEvent({ version }); });
  expect(reads).toHaveLength(1);
  await respond(4);
  await waitFor(() => expect(reads).toHaveLength(2));
});

it.each(["failure", "stale", "no-op"])("recovers an event not covered by a %s action response with one read", async (outcome) => {
  mount();
  await beginAction();
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(1);
  await act(async () => {
    if (outcome === "failure") failAction(new Error("Connection lost"));
    else finishAction({ updateClient: outcome === "stale", notification: "Try again" });
  });
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => finishRead?.(stateAt(2)));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(reads).toHaveLength(2);
});

it("keeps spectator updates immediate and ignores versions already displayed", async () => {
  mount();
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => { await onEvent({ version: 1 }); await onEvent({ version: 0 }); });
  expect(reads).toHaveLength(1);
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(2);
});

it("does not refresh held results after a pending final action", async () => {
  mount();
  await beginAction();
  await act(async () => onEvent({ version: 3, finished: true }));
  await act(async () => finishAction({ ...actionResponse(2), result: { outcome: "Won" } as never }));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(reads).toHaveLength(1);
});

it("waits for the actual mutation when a poll clears the displayed pending flag", async () => {
  mount();
  await beginAction();
  await act(async () => setState(stateAt(1)));
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(1);
  await respond();
  expect(reads).toHaveLength(1);
});

it("recovers a newer opponent event even when a poll already rendered it before the older action response", async () => {
  mount();
  await beginAction();
  await act(async () => setState(stateAt(3)));
  await act(async () => onEvent({ version: 3 }));
  await respond(2);
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => finishRead?.(stateAt(3)));
  expect(reads).toHaveLength(2);
});

it("retains events while asynchronous success processing has not applied the response", async () => {
  let resume!: () => void;
  pauseSuccess = new Promise<void>((resolve) => { resume = resolve; });
  mount();
  await beginAction();
  await act(async () => setState(stateAt(1)));
  await act(async () => finishAction(actionResponse(2)));
  await act(async () => onEvent({ version: 2 }));
  expect(reads).toHaveLength(1);
  await act(async () => resume());
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(reads).toHaveLength(1);
});

it("fetches a newer event that arrived after an error recovery request began", async () => {
  mount();
  await beginAction();
  await act(async () => onEvent({ version: 2 }));
  await act(async () => failAction(new Error("Connection lost")));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => onEvent({ version: 3 }));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  await waitFor(() => expect(reads).toHaveLength(3));
  await act(async () => finishRead?.(stateAt(3)));
  expect(reads).toHaveLength(3);
});

it("does not leak deferred versions into a different battle", async () => {
  mount();
  await beginAction();
  await act(async () => onEvent({ version: 8 }));
  await act(async () => setState(stateAt(1, { battle: { id: "next-battle", version: 1 } as never })));
  await act(async () => finishAction({ updateClient: false }));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  // The new query key loads once; the old event must not cause a refresh of it.
  expect(reads).toHaveLength(2);
});

it("keeps final results out of recovery reads even if their battle cache is stale", async () => {
  mount();
  await beginAction();
  const key = getQueryKey(testApi.combat.getBattle, { battleId: "battle" }, "query");
  await act(async () => { await queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" }); });
  await act(async () => finishAction({ ...actionResponse(2), result: { outcome: "Won" } as never }));
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(reads).toHaveLength(1);
  expect(latestState.result?.outcome).toBe("Won");
});
