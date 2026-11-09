import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { useItemConsumptionCacheUpdate } from "@/hooks/useItemConsumptionCacheUpdate";
import { useQuestStartCacheUpdate } from "@/hooks/useQuestStartCacheUpdate";
import { profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { trainRouter } from "@/server/api/routers/train";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../setup/factories";
import { callerFor, describeWithDatabase, resetTables } from "../setup/testDatabase";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [],
  stops: (() => void)[] = [];
beforeEach(() =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    profile: api.profile,
    item: api.item,
    raids: api.raids,
    bloodline: api.bloodline,
    pets: api.pets,
    quests: api.quests,
    useUtils: api.useUtils,
  }),
);
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => stop());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

/** Observe application keys with settled data, counting only reads requested by the controllers. */
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  const owned = { id: "stack", itemId: "herb", quantity: 3, variants: ["red"] };
  const candidate = {
    id: "quest",
    questType: "mission",
    hidden: false,
    maxAttempts: 100,
    maxCompletes: 100,
    requiredVillage: null,
    retryDelay: "none",
    previousAttempts: 0,
    previousCompletes: 0,
    periodCompletes: 0,
    periodStartAt: null,
    completed: 0,
  };
  const keys = [
    getQueryKey(api.item.getUserItems, undefined, "query"),
    getQueryKey(api.item.getUserItemsWithVariants, undefined, "query"),
    getQueryKey(api.raids.getUserRaidBuffs, undefined, "query"),
    getQueryKey(api.bloodline.getItemRolls, undefined, "query"),
    getQueryKey(api.pets.getPet, undefined, "query"),
    getQueryKey(
      api.quests.missionHall,
      { level: 50, villageId: VILLAGE_SYNDICATE_ID },
      "query",
    ),
    getQueryKey(
      api.quests.specificQuests,
      { level: 50, questType: "mission" },
      "query",
    ),
    getQueryKey(api.quests.upcomingQuests, { questType: "battlepyramid" }, "query"),
  ];
  const values = [
    [owned],
    [owned],
    { buffs: [] },
    [],
    [],
    [candidate],
    [{ ...candidate, entryRequirements: [] }],
    [],
  ];
  const reads = keys.map((queryKey, i) => {
    client.setQueryData(queryKey, values[i]);
    const queryFn = vi.fn(async () => values[i]);
    stops.push(new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {}));
    return queryFn;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <api.Provider client={api.createClient({ links: [] })} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  const view = renderHook(
    () => ({
      consumption: useItemConsumptionCacheUpdate(),
      starts: useQuestStartCacheUpdate(),
    }),
    { wrapper },
  );
  const inventoryChanges = [
    { id: owned.id, itemId: owned.itemId, beforeQuantity: owned.quantity, quantity: 2 },
  ];
  const consumed = {
    success: true,
    message: "Consumed",
    inventoryChanges,
    bloodlineRollsChanged: false,
    raidBuffsChanged: false,
  } as RouterOutputs["item"]["consume"];
  const started = {
    success: true,
    message: "Started",
    inventoryChanges: [],
  } as RouterOutputs["quests"]["startQuest"];
  return {
    client,
    keys,
    values,
    reads,
    view,
    consumed,
    started,
    candidate,
    inventoryChanges,
    owned,
  };
};

it("consumes a confirmed stack in both views without related reads and preserves variants", async () => {
  const t = setup(),
    hook = t.view.result.current.consumption;
  await act(async () =>
    hook.updateConsumption(t.consumed, hook.prepareConsumptionUpdate(), true),
  );
  expect(t.client.getQueryData(t.keys[0]!)).toEqual([{ ...t.owned, quantity: 2 }]);
  expect(t.client.getQueryData(t.keys[1]!)).toEqual(t.client.getQueryData(t.keys[0]!));
  t.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
});

it.each([
  "profile recovery",
  "transport uncertainty",
  "withheld quantities",
  "inventory revision",
  "stack baseline",
])("retains inventory recovery after %s", async (reason) => {
  const t = setup(),
    hook = t.view.result.current.consumption,
    snapshot = hook.prepareConsumptionUpdate();
  if (reason === "inventory revision") t.client.setQueryData(t.keys[0]!, t.values[0]);
  const result =
    reason === "transport uncertainty"
      ? undefined
      : {
          ...t.consumed,
          inventoryChanges:
            reason === "withheld quantities"
              ? undefined
              : reason === "stack baseline"
                ? [{ ...t.inventoryChanges[0]!, beforeQuantity: 9 }]
                : t.inventoryChanges,
        };
  await act(async () =>
    hook.updateConsumption(result, snapshot, reason !== "profile recovery"),
  );
  expect(t.reads[0]).toHaveBeenCalledTimes(1);
  expect(t.reads[1]).toHaveBeenCalledTimes(reason === "inventory revision" ? 0 : 1);
  expect(t.reads[2]).toHaveBeenCalledTimes(
    reason === "profile recovery" || reason === "transport uncertainty" ? 1 : 0,
  );
  expect(t.reads[3]).toHaveBeenCalledTimes(
    reason === "profile recovery" || reason === "transport uncertainty" ? 1 : 0,
  );
});

it("refreshes loaded discovery inputs without inventory fan-out", async () => {
  const t = setup(),
    hook = t.view.result.current.starts,
    snapshot = hook.prepareQuestStartUpdate();
  const after = [{ ...t.candidate, previousAttempts: 1 }];
  t.reads.slice(5).forEach((read) => read.mockResolvedValueOnce(after as never));
  await act(async () =>
    hook.updateQuestStart(
      { ...t.started, inventoryChanges: t.inventoryChanges },
      snapshot,
      true,
    ),
  );
  for (const key of t.keys.slice(0, 2))
    expect(t.client.getQueryData(key)).toEqual([{ ...t.owned, quantity: 2 }]);
  for (const key of t.keys.slice(5)) expect(t.client.getQueryData(key)).toEqual(after);
  t.reads.slice(0, 5).forEach((read) => expect(read).not.toHaveBeenCalled());
  t.reads.slice(5).forEach((read) => expect(read).toHaveBeenCalledTimes(1));
});

it.each([
  "profile recovery",
  "transport uncertainty",
  "withheld quantities",
  "inventory revision",
])("retains quest-start recovery after %s", async (reason) => {
  const t = setup(),
    hook = t.view.result.current.starts,
    snapshot = hook.prepareQuestStartUpdate();
  if (reason === "inventory revision") t.client.setQueryData(t.keys[0]!, t.values[0]);
  const result =
    reason === "transport uncertainty"
      ? undefined
      : {
          ...t.started,
          inventoryChanges: reason === "withheld quantities" ? undefined : [],
        };
  await act(async () =>
    hook.updateQuestStart(result, snapshot, reason !== "profile recovery"),
  );
  t.reads.slice(5).forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  expect(t.reads[0]).toHaveBeenCalledTimes(1);
  expect(t.reads[1]).toHaveBeenCalledTimes(reason === "inventory revision" ? 0 : 1);
});

describeWithDatabase("quest-start discovery reconciliation", () => {
  it("includes quests unlocked by mastery training before the start mutation", async () => {
    const now = new Date("2026-11-02T12:00:00Z"),
      playerId = "quest-start-discovery";
    const startedAt = new Date(now.getTime() - 14 * 60000);
    setSystemTime(now);
    try {
      await resetTables(questHistory, quest, userData);
      await insertUsers([
        {
          userId: playerId,
          username: playerId,
          rank: "JONIN",
          level: 50,
          primaryElement: "Fire",
          secondaryElement: "Water",
          isOutlaw: true,
          status: "AWAKE",
          sector: 0,
          regeneration: 0,
          ninjutsuMastery: 10,
          currentlyTrainingMastery: "ninjutsuMastery",
          masteryTrainingStartedAt: startedAt,
          masteryTrainingSpeed: "15min",
        },
      ]);
      const content = {
        objectives: [
          SimpleObjective.parse({ id: "train", task: "stats_trained", value: 100000 }),
        ],
        reward: ObjectiveReward.parse({}),
        sceneBackground: "",
        sceneCharacters: [],
      };
      await insertQuests([
        { id: "ordinary", questType: "mastery", content },
        { id: "unlocked", questType: "mastery", requiredNinjutsuMastery: 50, content },
      ]);
      const quests = await callerFor(questsRouter, playerId),
        profile = await callerFor(profileRouter, playerId);
      const input = { level: 50, questType: "mastery" as const };
      const before = await quests.specificQuests(input);
      expect(before.map((row) => row.id)).toEqual(["ordinary"]);
      const t = setup(),
        hook = t.view.result.current.starts;
      const profileKey = getQueryKey(api.profile.getUser, undefined, "query");
      const discoveryKey = getQueryKey(api.quests.specificQuests, input, "query");
      t.client.setQueryData(profileKey, await profile.getUser());
      t.client.setQueryData(discoveryKey, before);
      const read = vi.fn(() => quests.specificQuests(input));
      stops.push(
        new QueryObserver(t.client, {
          queryKey: discoveryKey,
          queryFn: read,
        }).subscribe(() => {}),
      );
      const training = await (
        await callerFor(trainRouter, playerId)
      ).stopMasteryTraining({ stat: "ninjutsuMastery", startedAt });
      expect(training.success, training.message).toBe(true);
      expect(
        await updateUserCache(t.client, profileKey, training, {
          revision: prepareUserUpdate(t.client, profileKey),
        }),
      ).toBe(true);
      expect(
        t.client.getQueryData<RouterOutputs["profile"]["getUser"]>(profileKey)!
          .userData!.ninjutsuMastery,
      ).toBeGreaterThan(50);
      const snapshot = hook.prepareQuestStartUpdate();
      const result = await quests.startQuest({
        questId: "ordinary",
        userSector: 0,
        supportsAnnouncements: true,
      });
      expect(result.success, result.message).toBe(true);
      const applied = await updateUserCache(t.client, profileKey, result, {
        revision: prepareUserUpdate(t.client, profileKey),
      });
      expect(applied).toBe(true);
      await act(async () => hook.updateQuestStart(result, snapshot, applied));
      const refreshed = t.client.getQueryData<typeof before>(discoveryKey)!;
      expect(refreshed.map((row) => row.id)).toContain("unlocked");
      expect(refreshed).toEqual(await quests.specificQuests(input));
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      setSystemTime();
    }
  });
});
