import { combatSharedCooldown, jutsuEquipLimit } from "@/drizzle/schema";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";
import { afterEach, expect, it, vi } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { battle, item, userData, userItem } from "@/drizzle/schema";
import { getActivityBonuses } from "@/libs/activityBonuses";
import type { CompleteBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { IncreaseHuntingYield } from "@/validators/combat";
import { makeUser } from "../../../../setup/combat";
import { huntingBattleState } from "../../../../setup/hunting";

const defaults = (table: typeof userData | typeof item | typeof userItem) =>
  Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([key, column]) => [
      key,
      column.default &&
      typeof column.default === "object" &&
      "queryChunks" in column.default
        ? new Date()
        : (column.default ?? null),
    ]),
  );

const participant = (userId: string, isAi: boolean) => ({
  ...defaults(userData),
  ...makeUser({
    userId,
    username: userId,
    controllerId: userId,
    isAi,
    experience: 3339000,
    rank: "JONIN",
    status: "AWAKE",
    ninjutsuMastery: 0,
  }),
  items: [],
  jutsus: [],
  userSkills: [],
  queue: [],
  cookingJobs: [],
  raidBuffs: [],
  userQuests: [],
  completedQuests: [],
  bounties: [],
  bountySignups: [],
  bloodline: null,
  sageMode: null,
  village: null,
  clan: null,
  // Joined the village well after sign-up, so the recent-transfer penalty applies.
  regenAt: new Date(),
  joinedVillageAt: new Date(),
  createdAt: new Date(Date.now() - 30 * 86_400_000),
});

afterEach(() => vi.restoreAllMocks());

it.each([true, false])(
  "snapshots hunting gear eligibility after training settlement (completed: %s)",
  async (completed) => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const hunter = {
      ...participant("hunter", false),
      trainingSpeed: "15min",
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: new Date(Date.now() - (completed ? 20 : 5) * 60_000),
      items: [
        {
          ...defaults(userItem),
          id: "worn",
          userId: "hunter",
          itemId: "armor",
          quantity: 1,
          equipped: "CHEST",
          durability: 100,
          imbuements: [],
          item: {
            ...defaults(item),
            id: "armor",
            name: "Hunting armor",
            itemType: "ARMOR",
            slot: "CHEST",
            battleUsageType: "BOTH",
            maxDurability: 100,
            requiredNinjutsuMastery: 50,
            effects: [IncreaseHuntingYield.parse({ power: 2 })],
          },
        },
      ],
    };
    expect(getActivityBonuses(hunter as never).huntingBonusQuantity).toBe(0);
    const users = [hunter, participant("enemy", true)];
    let saved: CompleteBattle | undefined;
    const client = {
      query: new Proxy(
        {},
        {
          get: (_target, key) => ({
            findMany: async () => (key === "userData" ? structuredClone(users) : []),
            findFirst: async () =>
              key === "aiProfile"
                ? { id: "Default", rules: [], includeDefaultRules: false }
                : undefined,
          }),
        },
      ),
      select: () => ({
        from: (table: object) => {
          if (table === combatSharedCooldown) return { orderBy: async () => [] };
          if (table === jutsuEquipLimit)
            return { orderBy: async () => equipLimitFixture };
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(
                table === userData ? [{ average: 0 }] : [{ count: 0 }],
              ).then(resolve),
          };
          return builder;
        },
      }),
      insert: (table: object) => ({
        values: async (value: unknown) => {
          if (table === battle) saved = value as CompleteBattle;
          return { rowsAffected: 1 };
        },
      }),
      update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
      transaction: async (run: (tx: unknown) => Promise<unknown>) => run(client),
    } as unknown as DrizzleClient;
    const result = await initiateBattle(
      {
        client,
        userIds: ["hunter"],
        targetIds: ["enemy"],
        sector: 1,
        biome: "default",
        hunting: huntingBattleState(),
      },
      "HUNTING",
    );
    expect(result.success).toBe(true);
    expect(saved?.extraState.hunting?.huntingBonusQuantity).toBe(completed ? 2 : 0);
    const actor = saved?.usersState.find((user) => user.controllerId === "hunter");
    expect(actor?.ninjutsuMastery).toBe(completed ? 50 : 0);
    expect(actor?.items.find((owned) => owned.id === "worn")?.equipped).toBe(
      completed ? "CHEST" : "NONE",
    );
  },
);
