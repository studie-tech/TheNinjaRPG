import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { useItemConsumptionCacheUpdate } from "@/hooks/useItemConsumptionCacheUpdate";
import { useQuestStartCacheUpdate } from "@/hooks/useQuestStartCacheUpdate";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();
const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [], stops: (() => void)[] = [];
beforeEach(() => Object.assign(vi.spyOn(appClient, "api" as never), { profile: api.profile, item: api.item, raids: api.raids, bloodline: api.bloodline, pets: api.pets, quests: api.quests, useUtils: api.useUtils }));
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

/** Observe application keys with settled data, counting only reads requested by the controllers. */
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(client);
  const owned = { id: "stack", itemId: "herb", quantity: 3, variants: ["red"] };
  const user = { level: 50, rank: "JONIN", role: "USER", isOutlaw: true, villageId: null, userQuests: [], completedQuests: [], questData: [] };
  const candidate = { id: "quest", questType: "mission", hidden: false, maxAttempts: 100, maxCompletes: 100, requiredVillage: null, retryDelay: "none", previousAttempts: 0, previousCompletes: 0, periodCompletes: 0, periodStartAt: null, completed: 0 };
  client.setQueryData(getQueryKey(api.profile.getUser, undefined, "query"), { userData: user });
  const keys = [getQueryKey(api.item.getUserItems, undefined, "query"), getQueryKey(api.item.getUserItemsWithVariants, undefined, "query"), getQueryKey(api.raids.getUserRaidBuffs, undefined, "query"), getQueryKey(api.bloodline.getItemRolls, undefined, "query"), getQueryKey(api.pets.getPet, undefined, "query"), getQueryKey(api.quests.missionHall, { level: 50, villageId: VILLAGE_SYNDICATE_ID }, "query"), getQueryKey(api.quests.specificQuests, { level: 50, questType: "mission" }, "query")];
  const values = [[owned], [owned], { buffs: [] }, [], [], [candidate], [{ ...candidate, entryRequirements: [] }]];
  const reads = keys.map((queryKey, i) => {
    client.setQueryData(queryKey, values[i]);
    const queryFn = vi.fn(async () => values[i]);
    stops.push(new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {}));
    return queryFn;
  });
  const wrapper = ({ children }: { children: ReactNode }) => <api.Provider client={api.createClient({ links: [] })} queryClient={client}><QueryClientProvider client={client}>{children}</QueryClientProvider></api.Provider>;
  const view = renderHook(() => ({ consumption: useItemConsumptionCacheUpdate(), starts: useQuestStartCacheUpdate() }), { wrapper });
  const inventoryChanges = [{ id: owned.id, itemId: owned.itemId, beforeQuantity: owned.quantity, quantity: 2 }];
  const consumed = { success: true, message: "Consumed", inventoryChanges, bloodlineRollsChanged: false, raidBuffsChanged: false } as RouterOutputs["item"]["consume"];
  const started = { success: true, message: "Started", inventoryChanges: [], questStartUpdate: { questId: candidate.id, beforePreviousAttempts: 0, after: { previousAttempts: 1, previousCompletes: 0, periodCompletes: 0, periodStartAt: null, completed: 0 } } } as RouterOutputs["quests"]["startQuest"];
  return { client, keys, values, reads, view, consumed, started, candidate, inventoryChanges, owned, user };
};

it("consumes a confirmed stack in both views without related reads and preserves variants", async () => {
  const t = setup(), hook = t.view.result.current.consumption;
  await act(async () => hook.updateConsumption(t.consumed, hook.prepareConsumptionUpdate(), true));
  expect(t.client.getQueryData(t.keys[0]!)).toEqual([{ ...t.owned, quantity: 2 }]);
  expect(t.client.getQueryData(t.keys[1]!)).toEqual(t.client.getQueryData(t.keys[0]!));
  t.reads.forEach(read => expect(read).not.toHaveBeenCalled());
});

it.each(["profile recovery", "transport uncertainty", "withheld quantities", "inventory revision", "stack baseline"])("retains inventory recovery after %s", async reason => {
  const t = setup(), hook = t.view.result.current.consumption, snapshot = hook.prepareConsumptionUpdate();
  if (reason === "inventory revision") t.client.setQueryData(t.keys[0]!, t.values[0]);
  const result = reason === "transport uncertainty" ? undefined : { ...t.consumed, inventoryChanges: reason === "withheld quantities" ? undefined : reason === "stack baseline" ? [{ ...t.inventoryChanges[0]!, beforeQuantity: 9 }] : t.inventoryChanges };
  await act(async () => hook.updateConsumption(result, snapshot, reason !== "profile recovery"));
  expect(t.reads[0]).toHaveBeenCalledTimes(1);
  expect(t.reads[1]).toHaveBeenCalledTimes(reason === "inventory revision" ? 0 : 1);
  expect(t.reads[2]).toHaveBeenCalledTimes(reason === "profile recovery" || reason === "transport uncertainty" ? 1 : 0);
  expect(t.reads[3]).toHaveBeenCalledTimes(reason === "profile recovery" || reason === "transport uncertainty" ? 1 : 0);
});

it("projects quest starts into each captured discovery key without inventory fan-out", async () => {
  const t = setup(), hook = t.view.result.current.starts, snapshot = hook.prepareQuestStartUpdate();
  const newKey = getQueryKey(api.quests.specificQuests, { level: 60, questType: "daily" }, "query");
  t.client.setQueryData(newKey, ["other selection"]);
  await act(async () => hook.updateQuestStart(t.started, snapshot, true));
  for (const key of t.keys.slice(5)) expect(t.client.getQueryData<{ previousAttempts: number }[]>(key)?.[0]?.previousAttempts).toBe(1);
  expect(t.client.getQueryData(newKey)).toEqual(["other selection"]);
  t.reads.forEach(read => expect(read).not.toHaveBeenCalled());
});

it.each(["profile recovery", "missing metadata", "revision", "ticket totals", "eligibility", "daily rollover"])("retains quest-start recovery after %s", async reason => {
  const t = setup(), hook = t.view.result.current.starts;
  if (reason === "ticket totals") t.client.setQueryData(t.keys[6]!, [{ ...t.candidate, entryRequirements: [{ itemId: "herb", owned: 3 }] }]);
  const snapshot = hook.prepareQuestStartUpdate();
  if (reason === "revision") t.client.setQueryData(t.keys[5]!, t.values[5]);
  if (reason === "eligibility") t.client.setQueryData(getQueryKey(api.profile.getUser, undefined, "query"), { userData: { ...t.user, ninjutsuMastery: 1 } });
  if (reason === "daily rollover") snapshot.discovery.forEach(row => { row.queriedAt -= 86400000; });
  const result = { ...t.started, questStartUpdate: reason === "missing metadata" ? undefined : t.started.questStartUpdate, inventoryChanges: reason === "ticket totals" ? t.inventoryChanges : [] };
  await act(async () => hook.updateQuestStart(result, snapshot, reason !== "profile recovery"));
  expect(t.reads[5]).toHaveBeenCalledTimes(reason === "ticket totals" ? 0 : 1);
  expect(t.reads[6]).toHaveBeenCalledTimes(reason === "revision" ? 0 : 1);
  expect(t.reads[0]).toHaveBeenCalledTimes(reason === "profile recovery" || reason === "missing metadata" ? 1 : 0);
});
