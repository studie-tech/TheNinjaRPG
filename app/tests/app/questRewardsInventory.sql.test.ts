import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  item,
  quest,
  questHistory,
  userData,
  userItem,
  userVote,
  type UserItem,
} from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { CollectItem, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertUserVotes,
} from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const playerId = "reward-inventory-player";
const missionId = "reward-inventory-mission";
const prerequisiteId = "reward-inventory-prerequisite";
const achievementId = "reward-inventory-achievement";
const itemId = "reward-inventory-gift";
const content = {
  objectives: [
    SimpleObjective.parse({ id: "train", task: "stats_trained", value: 10 }),
  ],
  reward: ObjectiveReward.parse({ reward_money: 100, reward_exp: 50 }),
  sceneBackground: "",
  sceneCharacters: [],
};

describeWithDatabase("quest reward inventory reconciliation", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, questHistory, quest, userVote, userData);
    invalidatePublishedMapCache();
    await insertUsers([
      {
        userId: playerId,
        username: "rewardinventory",
        rank: "JONIN",
        level: 50,
        primaryElement: "Fire",
        secondaryElement: "Water",
        isOutlaw: true,
        status: "AWAKE",
        sector: 0,
        longitude: 10,
        latitude: 7,
        money: 1000,
        earnedExperience: 0,
        curEnergy: 30,
        regeneration: 0,
      },
    ]);
    await insertItems([{ id: itemId, name: "Achievement gift" }]);
    await insertQuests([
      {
        id: missionId,
        name: "Inventory mission",
        questType: "mission",
        questRank: "A",
        maxCompletes: 3,
        content,
      },
      { id: prerequisiteId, questType: "mission", content },
      {
        id: "reward-inventory-tier",
        questType: "tier",
        content: {
          ...content,
          objectives: [
            SimpleObjective.parse({ id: "train", task: "stats_trained", value: 10000 }),
          ],
        },
      },
    ]);
    await insertQuestHistory([
      { userId: playerId, questId: "reward-inventory-tier", questType: "tier" },
    ]);
    await insertUserVotes([{ userId: playerId }]);
  });
  afterEach(() => invalidatePublishedMapCache());

  it.each(["withheld", "revision", "inflight"] as const)(
    "refreshes collection items granted during %s profile recovery after a currency reward",
    async (fallback) => {
      const db = await getTestDatabase();
      await insertQuests([
        {
          id: achievementId,
          name: "Collection achievement",
          questType: "achievement",
          requiredLevel: 1,
          prerequisiteQuestId: fallback === "withheld" ? missionId : prerequisiteId,
          content: {
            ...content,
            objectives: [
              CollectItem.parse({
                id: "collect",
                task: "collect_item",
                sector: 0,
                longitude: 10,
                latitude: 7,
                collectItemIds: [itemId],
              }),
            ],
          },
        },
      ]);
      const quests = await callerFor(questsRouter, playerId);
      const profile = await callerFor(profileRouter, playerId);
      const items = await callerFor(itemRouter, playerId);
      expect(
        (await quests.startQuest({ questId: missionId, userSector: 0 })).success,
      ).toBe(true);
      await db
        .update(userData)
        .set({
          questData: [
            {
              id: missionId,
              startAt: new Date().toISOString(),
              goals: [
                {
                  id: "train",
                  value: 10,
                  done: true,
                  collected: false,
                  recentlyDied: false,
                },
              ],
            },
          ],
        })
        .where(eq(userData.userId, playerId));
      const before = await profile.getUser();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      const profileKey = ["profile"];
      client.setQueryData(profileKey, before);
      let blockRead = false;
      const getUser = vi.fn(async () =>
        blockRead ? new Promise<typeof before>(() => {}) : profile.getUser(),
      );
      const stopProfile = new QueryObserver(client, {
        queryKey: profileKey,
        queryFn: getUser,
      }).subscribe(() => {});
      const inventories = [
        { queryKey: ["inventory"], queryFn: vi.fn(() => items.getUserItems()) },
        {
          queryKey: ["variants"],
          queryFn: vi.fn(() => items.getUserItemsWithVariants()),
        },
      ];
      const stops = inventories.map((query) => {
        client.setQueryData(query.queryKey, []);
        return new QueryObserver<UserItem[]>(client, query).subscribe(() => {});
      });
      const invalidations: Promise<void>[] = [];
      const invalidate = (index: number) => () => {
        const pending = client.invalidateQueries({
          queryKey: inventories[index]!.queryKey,
        });
        invalidations.push(pending);
        return pending;
      };
      const leaf = { invalidate: vi.fn(async () => undefined) };
      const bindings = {
        prepareUserUpdate: () => prepareUserUpdate(client, profileKey),
        prepareQuestRewardUpdate: vi.fn(),
        updateQuestRewards: vi.fn(),
        updateUser: (
          data: Parameters<typeof updateUserCache>[2],
          options: Parameters<typeof updateUserCache>[3],
        ) => updateUserCache(client, profileKey, data, options),
        utils: {
          item: {
            getUserItems: { invalidate: invalidate(0) },
            getUserItemsWithVariants: { invalidate: invalidate(1) },
          },
          profile: { getDashboard: leaf },
          quests: {
            missionHall: leaf,
            specificQuests: leaf,
            getQuestHistory: leaf,
            allianceBuilding: leaf,
          },
        },
        showMutationToast: vi.fn(),
        showRewardToast: vi.fn(),
        openRewardChoice: vi.fn(),
        currentStep: undefined,
        handleNextStepAsync: vi.fn(),
      };
      // Execute the feature hook's actual recovery policy after the real profile reconciliation.
      const hookSource = readFileSync(
        join(import.meta.dirname, "../../src/hooks/useQuestRewardCacheUpdate.ts"),
        "utf8",
      );
      const start = hookSource.indexOf("  const updateQuestRewards = async (");
      const end = hookSource.indexOf("\n  return {", start);
      if (start < 0 || end < 0)
        throw new Error("Quest reward cache controller was not found");
      const code = new (require("bun").Transpiler)({ loader: "ts" }).transformSync(
        hookSource.slice(start, end),
      );
      bindings.updateQuestRewards.mockImplementation(
        new Function(
          "dashboard",
          "utils",
          "invalidateInventory",
          `${code}; return updateQuestRewards;`,
        )({ updateCache: async () => false }, bindings.utils, () =>
          Promise.all([
            bindings.utils.item.getUserItems.invalidate(),
            bindings.utils.item.getUserItemsWithVariants.invalidate(),
          ]),
        ),
      );
      // Run the production reward callbacks against real profile reads and both observed inventories.
      const source = readFileSync(
        join(import.meta.dirname, "../../src/layout/Logbook.tsx"),
        "utf8",
      );
      const callbacks = source.match(
        /api\.quests\.checkRewards\.useMutation\((\{[\s\S]*?\n    \})\);/,
      )?.[1];
      if (!callbacks) throw new Error("Quest reward callbacks were not found");
      const options = new Function(...Object.keys(bindings), `return (${callbacks});`)(
        ...Object.values(bindings),
      ) as {
        onMutate: () => { userRevision: number | undefined };
        onSuccess: (
          data: RouterOutputs["quests"]["checkRewards"],
          input: { questId: string },
          context: { userRevision: number | undefined },
        ) => Promise<void>;
      };
      try {
        const context = options.onMutate();
        const result = await quests.checkRewards({ questId: missionId });
        expect(result).toMatchObject({ success: true, resolved: true });
        expect(result.userPatch !== undefined).toBe(fallback !== "withheld");
        expect(
          await db.query.userItem.findMany({ where: eq(userItem.userId, playerId) }),
        ).toEqual([]);
        if (fallback !== "withheld") {
          // A concurrent claim unlocks the achievement before client reconciliation.
          await insertQuestHistory([
            {
              userId: playerId,
              questId: prerequisiteId,
              questType: "mission",
              completed: 1,
              previousCompletes: 1,
              endAt: new Date(),
            },
          ]);
          if (fallback === "revision") client.setQueryData(profileKey, before);
          else {
            blockRead = true;
            void client.refetchQueries({ queryKey: profileKey });
            await Promise.resolve();
            expect(client.getQueryState(profileKey)?.fetchStatus).toBe("fetching");
            blockRead = false;
          }
        }
        await options.onSuccess(result, { questId: missionId }, context);
        expect(bindings.updateQuestRewards).toHaveBeenCalledWith(
          result,
          undefined,
          false,
        );
        await Promise.all(invalidations);
        expect(getUser).toHaveBeenCalledTimes(fallback === "inflight" ? 2 : 1);
        expect(
          await db.query.userItem.findMany({ where: eq(userItem.userId, playerId) }),
        ).toMatchObject([{ itemId }]);
        expect(invalidations).toHaveLength(2);
        for (const inventory of inventories) {
          expect(client.getQueryData(inventory.queryKey)).toMatchObject([{ itemId }]);
          expect(inventory.queryFn).toHaveBeenCalledTimes(1);
        }
      } finally {
        stopProfile();
        for (const stop of stops) stop();
        client.clear();
      }
    },
  );
});
