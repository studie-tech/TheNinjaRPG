import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { captureCombatCacheSnapshot } from "@/deltas/combat";
import type { BattleType } from "@/drizzle/constants";
import { MAP_WAR_TORN_BATTLEGROUND_SECTOR } from "@/drizzle/constants";
import { battle, item, jutsu, userData, userItem, userJutsu } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import type { PusherClient } from "@/libs/pusher";
import * as quest from "@/libs/quest";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
} from "../../setup/combat";
import {
  insertItems,
  insertJutsus,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";
import { soloPveResult } from "./helpers/profileCache";

const pusher = { trigger: async () => {} } as unknown as PusherClient;

const standing = {
  rank: "JONIN",
  rankedLp: 100,
  rankedStreak: 0,
  rankedWins: 0,
  money: 1000,
  pvpStreak: 0,
} as const;

const scenario = (battleType: BattleType, player: Partial<BattleUserState> = {}) =>
  makeCompleteBattle({
    id: "rewards",
    battleType,
    rewardScaling: 1,
    usersState: [
      makeBattleUser("player", {
        direction: "left",
        ...standing,
        villageId: "red",
        isAi: false,
        isSummon: false,
        curHealth: 100,
        sector: 1,
        ...player,
      }),
      makeBattleUser("foe", {
        ...standing,
        villageId: "blue",
        direction: "right",
        isAi: true,
        isSummon: false,
        curHealth: 0,
        sector: 1,
        leftBattle: true,
      }),
    ],
  });

const settle = async (
  state: CompleteBattle,
  outcome: { didWin: number; outcome: "Won" | "Lost" } = { didWin: 1, outcome: "Won" },
) => {
  const result = { ...calcBattleResult(structuredClone(state), "player")!, ...outcome };
  const { statements } = await recordQueries(async () =>
    updateUser(await getTestDatabase(), pusher, state, result, "player"),
  );
  return { result, statements };
};

const carried = (battleItem: Parameters<typeof makeBattleUserItem>[0]) =>
  makeBattleUserItem({ itemId: "gear", ...battleItem });

const gearCatalog = (maxDurability = 100, itemType = "ARMOR") =>
  ({
    gear: { id: "gear", name: "Gear", itemType, maxDurability },
  }) as unknown as NonNullable<CompleteBattle["extraState"]["items"]>;

describeWithDatabase("combat player settlement rewards", () => {
  beforeEach(async () => {
    await resetTables(battle, userJutsu, jutsu, userItem, item, userData);
    await insertUsers([
      {
        userId: "player",
        username: "player",
        status: "BATTLE",
        battleId: "rewards",
        regeneration: 0,
      },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["COMBAT", "pvp_kills"],
    ["ARENA", "arena_kills"],
    ["RANDOM_ENCOUNTER", "random_encounter_wins"],
    ["SPARRING", "spars_won"],
  ] as const)(
    "counts a %s win as %s only when the player won",
    async (battleType, task) => {
      const trackers = vi.spyOn(quest, "getNewTrackers");
      await settle(scenario(battleType));
      await settle(scenario(battleType), { didWin: 0, outcome: "Lost" });
      const [won, lost] = trackers.mock.calls.map(([, tasks]) => tasks);
      expect(won).toContainEqual({ task, increment: 1 });
      expect(lost?.some((entry) => entry.task === task)).toBe(false);
    },
  );

  it("emits no win task for battle types without one", async () => {
    const trackers = vi.spyOn(quest, "getNewTrackers");
    await settle(scenario("RANKED_PVP"));
    const tasks = trackers.mock.calls[0]![1].map((entry) => entry.task);
    for (const task of [
      "pvp_kills",
      "arena_kills",
      "random_encounter_wins",
      "spars_won",
    ])
      expect(tasks).not.toContain(task);
  });

  it.each([
    {
      initial: 100,
      final: 0,
      message: "Gear has broken and cannot be used until repaired!",
    },
    {
      initial: 60,
      final: 24,
      message:
        "Gear durability is critically low at 24%! Repair it soon to prevent it from breaking!",
    },
    {
      initial: 60,
      final: 40,
      message: "Gear durability is now 40%. Consider repairing it soon!",
    },
    { initial: 60, final: 51, message: undefined },
    { initial: 25, final: 20, message: undefined },
    { initial: 0, final: 0, message: undefined },
  ])(
    "warns when durability falls from $initial to $final",
    async ({ initial, final, message }) => {
      const state = scenario("ARENA", {
        items: [carried({ id: "armor", equipped: "CHEST", durability: final })],
      });
      state.extraState.items = gearCatalog();
      state.extraState.initialDurability = { player: { armor: initial } };
      const { result } = await settle(state);
      const warnings = result.notifications.filter((text) => text.startsWith("Gear"));
      expect(warnings).toEqual(message ? [message] : []);
    },
  );

  it("ignores items without a recorded starting durability or a durability limit", async () => {
    const state = scenario("ARENA", {
      items: [carried({ id: "armor", equipped: "CHEST", durability: 0 })],
    });
    state.extraState.items = gearCatalog();
    state.extraState.initialDurability = { player: {} };
    expect((await settle(state)).result.notifications).toEqual([]);
    const limitless = scenario("ARENA", {
      items: [carried({ id: "armor", equipped: "CHEST", durability: 0 })],
    });
    limitless.extraState.items = gearCatalog(0);
    limitless.extraState.initialDurability = { player: { armor: 100 } };
    expect((await settle(limitless)).result.notifications).toEqual([]);
  });

  it("charges the war-torn death penalty to equipped durable gear before warning", async () => {
    const state = scenario("COMBAT", {
      sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
      items: [
        carried({ id: "worn", equipped: "CHEST", durability: 70 }),
        carried({ id: "stored", equipped: "NONE", durability: 70 }),
        carried({ id: "nearly-gone", equipped: "LEGS", durability: 30 }),
      ],
    });
    state.extraState.items = gearCatalog();
    state.extraState.initialDurability = {
      player: { worn: 70, stored: 70, "nearly-gone": 30 },
    };
    const { result } = await settle(state, { didWin: 0, outcome: "Lost" });
    expect(state.usersState[0]!.items.map((entry) => entry.durability)).toEqual([
      20, 70, 0,
    ]);
    expect(result.notifications).toEqual(
      expect.arrayContaining([
        "Gear durability is critically low at 20%! Repair it soon to prevent it from breaking!",
        "Gear has broken and cannot be used until repaired!",
      ]),
    );
  });

  it.each([
    { didWin: 1, outcome: "Won" as const, sector: 1 },
    { didWin: 1, outcome: "Won" as const, sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR },
    { didWin: 0, outcome: "Lost" as const, sector: 1 },
  ])(
    "keeps durability outside a war-torn defeat ($outcome, sector $sector)",
    async ({ sector, ...outcome }) => {
      const state = scenario("COMBAT", {
        sector,
        items: [carried({ id: "worn", equipped: "CHEST", durability: 70 })],
      });
      state.extraState.items = gearCatalog();
      await settle(state, outcome);
      expect(state.usersState[0]!.items[0]!.durability).toBe(70);
    },
  );

  it("spares consumables and limitless gear from the war-torn penalty", async () => {
    const consumable = scenario("COMBAT", {
      sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
      items: [carried({ id: "worn", equipped: "CHEST", durability: 70 })],
    });
    consumable.extraState.items = gearCatalog(100, "CONSUMABLE");
    await settle(consumable, { didWin: 0, outcome: "Lost" });
    expect(consumable.usersState[0]!.items[0]!.durability).toBe(70);
    const limitless = scenario("COMBAT", {
      sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
      items: [carried({ id: "worn", equipped: "CHEST", durability: 70 })],
    });
    limitless.extraState.items = gearCatalog(0);
    await settle(limitless, { didWin: 0, outcome: "Lost" });
    expect(limitless.usersState[0]!.items[0]!.durability).toBe(70);
  });

  it.each([
    { rankedStreak: 0, rankedWins: 0, bonus: 0 },
    { rankedStreak: 2, rankedWins: 0, bonus: 1 },
    { rankedStreak: 0, rankedWins: 5, bonus: 1 },
    { rankedStreak: 2, rankedWins: 5, bonus: 2 },
  ])(
    "grants ranked milestones at streak $rankedStreak and wins $rankedWins",
    async ({ rankedStreak, rankedWins, bonus }) => {
      const state = scenario("RANKED_PVP", { rankedStreak, rankedWins });
      const base = calcBattleResult(structuredClone(state), "player")!.seichiSilver;
      const { result } = await settle(state);
      expect(result.seichiSilver).toBe(base + bonus);
    },
  );

  it("grants no ranked milestone on a loss or outside ranked battles", async () => {
    const lost = scenario("RANKED_PVP", { rankedStreak: 2, rankedWins: 2 });
    const lostBase = calcBattleResult(structuredClone(lost), "player")!.seichiSilver;
    expect(
      (await settle(lost, { didWin: 0, outcome: "Lost" })).result.seichiSilver,
    ).toBe(lostBase);
    const unranked = scenario("COMBAT", { rankedStreak: 2, rankedWins: 2 });
    const unrankedBase = calcBattleResult(
      structuredClone(unranked),
      "player",
    )!.seichiSilver;
    expect((await settle(unranked)).result.seichiSilver).toBe(unrankedBase);
  });

  it("groups jutsu experience once per progression cap and skips unknown jutsu", async () => {
    await insertJutsus([
      { id: "plain" },
      { id: "plain-2" },
      { id: "elite", requiredRank: "ELITE JONIN" },
    ]);
    const database = await getTestDatabase();
    await database.insert(userJutsu).values(
      ["plain", "plain-2", "elite"].map((jutsuId) => ({
        id: `owned-${jutsuId}`,
        userId: "player",
        jutsuId,
        level: 1,
        experience: 0,
      })),
    );
    const state = scenario("COMBAT", {
      usedActions: [
        { id: "plain", type: "jutsu" },
        { id: "plain", type: "jutsu" },
        { id: "plain-2", type: "jutsu" },
        { id: "elite", type: "jutsu" },
        { id: "unknown", type: "jutsu" },
        { id: "gear", type: "item" },
      ],
    });
    state.extraState.jutsus = {
      plain: { id: "plain", requiredRank: "GENIN" },
      "plain-2": { id: "plain-2", requiredRank: "GENIN" },
      elite: { id: "elite", requiredRank: "ELITE JONIN" },
    } as unknown as CompleteBattle["extraState"]["jutsus"];
    const { statements } = await settle(state);
    expect(
      statements.filter((statement) => /update\s+`?UserJutsu/i.test(statement)),
    ).toHaveLength(2);
    const saved = await database.query.userJutsu.findMany({
      where: eq(userJutsu.userId, "player"),
    });
    expect(saved.map((row) => row.experience > 0)).toEqual([true, true, true]);
  });

  it("groups equipped item experience by level curve and credits the source row", async () => {
    await insertItems([
      { id: "default-curve", name: "Default" },
      { id: "fast-curve", name: "Fast", xpToLevel: 10 },
    ]);
    await insertUserItems(
      [
        ["sword", "default-curve"],
        ["shield", "default-curve"],
        ["ring", "fast-curve"],
        ["source", "fast-curve"],
        ["unequipped", "default-curve"],
        ["spent", "default-curve"],
      ].map(([id, itemId]) => ({
        id: id!,
        itemId: itemId!,
        userId: "player",
        quantity: 1,
        durability: 100,
      })),
    );
    const state = scenario("COMBAT", {
      items: [
        makeBattleUserItem({
          id: "sword",
          itemId: "default-curve",
          equipped: "HAND_1",
        }),
        makeBattleUserItem({
          id: "shield",
          itemId: "default-curve",
          equipped: "HAND_2",
        }),
        makeBattleUserItem({ id: "ring", itemId: "fast-curve", equipped: "ITEM_1" }),
        makeBattleUserItem({
          id: "forced",
          itemId: "fast-curve",
          equipped: "ITEM_2",
          progressionRowId: "source",
        }),
        makeBattleUserItem({
          id: "unequipped",
          itemId: "default-curve",
          equipped: "NONE",
        }),
        makeBattleUserItem({
          id: "spent",
          itemId: "default-curve",
          equipped: "ITEM_3",
          quantity: 0,
        }),
      ],
    });
    state.extraState.items = {
      "default-curve": { id: "default-curve", itemType: "WEAPON" },
      "fast-curve": { id: "fast-curve", itemType: "WEAPON", xpToLevel: 10 },
    } as unknown as CompleteBattle["extraState"]["items"];
    const before = await (await getTestDatabase()).query.userItem.findMany();
    const { statements } = await settle(state);
    const after = await (await getTestDatabase()).query.userItem.findMany();
    const gained = (id: string) => {
      const row = (rows: typeof before) => rows.find((entry) => entry.id === id);
      return (
        row(after)!.experience + 10 * row(after)!.level >
        row(before)!.experience + 10 * row(before)!.level
      );
    };
    expect(
      statements.filter((statement) =>
        /^update `UserItem` .*experience/is.test(statement),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(["sword", "shield", "ring", "source"].map(gained)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(gained("unequipped")).toBe(false);
  });

  it("keeps an isolated pyramid fighter in the run at one health", async () => {
    const database = await getTestDatabase();
    const original = (await database.query.userData.findFirst({
      where: eq(userData.userId, "player"),
      with: { items: { with: { item: true } } },
    }))!;
    const state = makeCompleteBattle({
      id: "rewards",
      battleType: "ARENA",
      rewardScaling: 1,
      usersState: [
        makeBattleUser("player", {
          direction: "left",
          rank: "NONE",
          isAi: false,
          isSummon: false,
          curHealth: 0,
          sector: 1,
          items: [],
        }),
        makeBattleUser("foe", {
          direction: "right",
          isAi: true,
          curHealth: 0,
          sector: 1,
          leftBattle: true,
        }),
      ],
      extraState: {
        profileCacheSnapshots: { player: captureCombatCacheSnapshot(original) },
        energyCapacity: { player: 100 },
        energyRegeneration: { player: 0 },
        userQuests: {
          player: [
            {
              questId: "pyramid",
              isolated: true,
              endAt: null,
              completed: 0,
              quest: {
                id: "pyramid",
                questType: "battlepyramid",
                content: { objectives: [] },
              },
            },
          ],
        } as unknown as CompleteBattle["extraState"]["userQuests"],
      },
    });
    const result = soloPveResult(state, "player");
    result.curHealth = 0;
    await updateUser(database, pusher, state, result, "player");
    expect(result.curHealth).toBe(1);
    expect(result.profileUpdate?.userPatch.status).toBe("BATTLE");
  });

  it("releases an ordinary fighter to the awake status in the profile patch", async () => {
    const database = await getTestDatabase();
    const original = (await database.query.userData.findFirst({
      where: eq(userData.userId, "player"),
      with: { items: { with: { item: true } } },
    }))!;
    const state = makeCompleteBattle({
      id: "rewards",
      battleType: "ARENA",
      rewardScaling: 1,
      usersState: [
        makeBattleUser("player", {
          direction: "left",
          rank: "NONE",
          isAi: false,
          isSummon: false,
          curHealth: 100,
          sector: 1,
          items: [],
        }),
        makeBattleUser("foe", {
          direction: "right",
          isAi: true,
          curHealth: 0,
          sector: 1,
          leftBattle: true,
        }),
      ],
      extraState: {
        profileCacheSnapshots: { player: captureCombatCacheSnapshot(original) },
        energyCapacity: { player: 100 },
        energyRegeneration: { player: 0 },
      },
    });
    const result = soloPveResult(state, "player");
    await updateUser(database, pusher, state, result, "player");
    expect(result.profileUpdate?.userPatch.status).toBe("AWAKE");
  });
});
