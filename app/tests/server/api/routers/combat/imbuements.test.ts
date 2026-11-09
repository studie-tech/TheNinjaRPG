import { fetchBattleEssentials } from "@/queries/combat";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  aiProfile,
  battle,
  item,
  jutsu,
  jutsuLoadout,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
} from "@/drizzle/schema";
import { userItemToAction } from "@/libs/combat/actions";
import type { UserEffect } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import { getTagSchema } from "@/validators/combat";
import {
  insertLobbyBattle,
  loadCombatant,
  preloadLobby,
} from "../../../../libs/combat/helpers/preload";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertJutsus,
  insertDefaultAiProfile,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const BATTLE = "imbue-battle";
const USERS = ["imbue-a", "imbue-b"] as const;
// Each player's crystal carries a distinct power so its effects can be traced.
const POWER = { "imbue-a": 111, "imbue-b": 222 } as const;
const BASE_POWER = 5;

const masteryTag = (power: number) =>
  getTagSchema("increasemastery").parse({
    masteryTypes: ["Ninjutsu"],
    power,
    powerPerLevel: 0,
    calculation: "static",
    rounds: 10,
  });

const powersOf = (effects: { power?: number }[]) =>
  effects.map((effect) => effect.power).sort((a, b) => (a ?? 0) - (b ?? 0));

const seedBattle = async () => {
  const db = await getTestDatabase();
  await insertUsers(USERS.map((userId) => ({ userId, username: userId, level: 20 })));
  await insertDefaultAiProfile();
  await insertJutsus([{ id: "basic", name: "Basic", requiredRank: "GENIN" }]);
  await insertItems([
    {
      id: "shared-armor",
      name: "Shared armor",
      itemType: "ARMOR",
      slot: "CHEST",
      canBeImbued: true,
      maxImbueNumber: 1,
      maxDurability: 100,
      effects: [masteryTag(BASE_POWER)],
    },
    {
      id: "shared-weapon",
      name: "Shared weapon",
      itemType: "WEAPON",
      slot: "HAND",
      canBeImbued: true,
      maxImbueNumber: 1,
      maxDurability: 100,
      effects: [masteryTag(BASE_POWER)],
    },
    ...USERS.map((userId) => ({
      id: `crystal-${userId}`,
      name: `Crystal ${userId}`,
      itemType: "MATERIAL" as const,
      effects: [masteryTag(POWER[userId])],
    })),
  ]);
  const finished = new Date(Date.now() - 60_000);
  for (const userId of USERS) {
    await db.insert(userJutsu).values({
      id: `owned-basic-${userId}`,
      userId,
      jutsuId: "basic",
      equipped: true,
    });
    await db
      .insert(jutsuLoadout)
      .values({ id: `loadout-${userId}`, userId, jutsuIds: ["basic"] });
    await insertUserItems([
      {
        id: `armor-${userId}`,
        userId,
        itemId: "shared-armor",
        equipped: "CHEST",
        durability: 100,
      },
      {
        id: `weapon-${userId}`,
        userId,
        itemId: "shared-weapon",
        equipped: "HAND_1",
        durability: 100,
      },
    ]);
    await db.insert(userItemImbuement).values(
      ["armor", "weapon"].map((kind) => ({
        id: `imbue-${kind}-${userId}`,
        userItemId: `${kind}-${userId}`,
        imbuementItemId: `crystal-${userId}`,
        craftingFinishedAt: finished,
      })),
    );
  }

  const essentials = await fetchBattleEssentials(db);
  const users = await Promise.all(
    USERS.map((userId) =>
      loadCombatant(db, userId, essentials, { equippedItemsOnly: true }),
    ),
  );
  const processed = await preloadLobby(db, users, essentials, "SPARRING");
  await insertLobbyBattle(db, BATTLE, "SPARRING", processed);
};

const loadBattle = async () => {
  const db = await getTestDatabase();
  const stored = await db.query.battle.findFirst({ where: eq(battle.id, BATTLE) });
  if (!stored) throw new Error("Missing battle");
  return stored;
};

const armorPowers = (effects: UserEffect[], userId: string) =>
  powersOf(effects.filter((e) => e.targetId === userId && e.fromType === "armor"));

const weaponPowers = async (userId: string) => {
  const stored = await loadBattle();
  const user = stored.usersState.find((u) => u.userId === userId);
  const weapon = user?.items.find((ui) => ui.itemId === "shared-weapon");
  if (!user || !weapon) throw new Error(`Missing weapon for ${userId}`);
  return powersOf(userItemToAction(weapon, user, stored).effects as UserEffect[]);
};

describeWithDatabase("combat imbuements on a shared item template", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battle,
      aiProfile,
      userJutsu,
      jutsuLoadout,
      jutsu,
      userItemImbuement,
      userItem,
      item,
      userData,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps each player's own armor and weapon imbuements", async () => {
    await seedBattle();
    const stored = await loadBattle();
    for (const userId of USERS) {
      expect(armorPowers(stored.usersEffects, userId)).toEqual([
        BASE_POWER,
        POWER[userId],
      ]);
      expect(await weaponPowers(userId)).toEqual([BASE_POWER, POWER[userId]]);
    }
    // The shared catalog entry holds the item template alone.
    expect(powersOf(stored.extraState.items["shared-armor"]!.effects)).toEqual([
      BASE_POWER,
    ]);
  });

  it("keeps each player's own imbuements after either player changes loadout", async () => {
    await seedBattle();
    for (const changer of [...USERS].reverse()) {
      const caller = await callerFor(combatRouter, changer);
      const result = await caller.updateCombatLoadout({
        battleId: BATTLE,
        jutsuLoadoutId: `loadout-${changer}`,
      });
      expect(result.success).toBe(true);
      const stored = await loadBattle();
      for (const userId of USERS) {
        expect(armorPowers(stored.usersEffects, userId)).toEqual([
          BASE_POWER,
          POWER[userId],
        ]);
        expect(await weaponPowers(userId)).toEqual([BASE_POWER, POWER[userId]]);
      }
    }
  });
});
