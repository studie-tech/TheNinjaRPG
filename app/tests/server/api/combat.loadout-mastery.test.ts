import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  aiProfile,
  battle,
  item,
  itemLoadout,
  jutsu,
  jutsuLoadout,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import {
  combatRouter,
  fetchBattleEssentials,
  processUsersForBattle,
} from "@/server/api/routers/combat";
import { fetchUserItemsWithVariants } from "@/server/api/routers/item";
import { fetchUserJutsus } from "@/server/api/routers/jutsu";
import { getTagSchema } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER = "lobby-mastery-user";
const BATTLE = "lobby-mastery-battle";

const seedLobby = async (wearArmor = false) => {
  const db = await getTestDatabase();
  await insertUsers([
    {
      userId: USER,
      username: USER,
      rank: "GENIN",
      level: 20,
      ninjutsuMastery: 100,
      isOutlaw: true,
    },
  ]);
  await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
  await db.insert(jutsu).values([
    {
      id: "gated",
      name: "Gated",
      description: "Gated",
      battleDescription: "Gated",
      effects: [],
      target: "SELF",
      range: 0,
      requiredRank: "GENIN",
      jutsuType: "NORMAL",
      image: "",
      requiredNinjutsuMastery: 500,
    },
    {
      id: "usable",
      name: "Usable",
      description: "Usable",
      battleDescription: "Usable",
      effects: [],
      target: "SELF",
      range: 0,
      requiredRank: "GENIN",
      jutsuType: "NORMAL",
      image: "",
    },
  ]);
  await db.insert(userJutsu).values([
    { id: "owned-gated", userId: USER, jutsuId: "gated", equipped: wearArmor },
    { id: "owned-usable", userId: USER, jutsuId: "usable", equipped: !wearArmor },
  ]);
  await db
    .insert(jutsuLoadout)
    .values({ id: "new-jutsus", userId: USER, jutsuIds: ["gated", "usable"] });
  await insertItems([
    {
      id: "armor",
      name: "Mastery armor",
      itemType: "ARMOR",
      slot: "CHEST",
      effects: [
        getTagSchema("increasemastery").parse({
          masteryTypes: ["Ninjutsu"],
          power: 400,
          powerPerLevel: 0,
          calculation: "static",
          rounds: 10,
        }),
      ],
    },
  ]);
  await insertUserItems([
    {
      id: "owned-armor",
      userId: USER,
      itemId: "armor",
      equipped: wearArmor ? "CHEST" : "NONE",
      durability: 100,
    },
  ]);
  await db.insert(itemLoadout).values([
    {
      id: "with-armor",
      userId: USER,
      itemData: [{ userItemId: "owned-armor", itemId: "armor", slot: "CHEST" }],
    },
    { id: "without-armor", userId: USER, itemData: [] },
  ]);
  const row = await db.query.userData.findFirst({ where: eq(userData.userId, USER) });
  if (!row) throw new Error("Missing lobby user");
  const essentials = await fetchBattleEssentials(db);
  const raw = {
    ...row,
    items: await fetchUserItemsWithVariants(db, USER),
    jutsus: (await fetchUserJutsus(db, USER)).filter((j) => j.equipped),
    userSkills: [],
    bloodline: null,
    village: null,
    aiProfile: essentials.defaultProfile,
  } as CombatQueryUser;
  const processed = await processUsersForBattle(db, {
    users: [raw],
    ...essentials,
    wars: essentials.activeWars,
    battleType: "COMBAT",
    hide: false,
    isSummon: false,
    width: 13,
    height: 9,
  });
  await db
    .insert(battle)
    .values({
      id: BATTLE,
      background: "default",
      battleType: "COMBAT",
      roundStartAt: new Date(Date.now() + 60_000),
      usersState: processed.usersState,
      usersEffects: processed.userEffects,
      extraState: processed.extraState,
      groundEffects: [],
    });
};

const equippedIds = async () => {
  const db = await getTestDatabase();
  return (await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, USER) }))
    .filter((j) => j.equipped)
    .map((j) => j.jutsuId)
    .sort();
};

describeWithDatabase("combat lobby mastery loadouts", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battle,
      aiProfile,
      userJutsu,
      jutsuLoadout,
      jutsu,
      userItem,
      itemLoadout,
      item,
      userData,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("persists only eligible jutsu and keeps usable entries in the selected loadout", async () => {
    await seedLobby();
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      jutsuLoadoutId: "new-jutsus",
    });
    expect(result.success).toBe(true);
    expect(await equippedIds()).toEqual(["usable"]);
    expect(result.message).toContain("500 Ninjutsu Mastery");
  });

  it("uses mastery armor from the item loadout selected in the same request", async () => {
    await seedLobby();
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      jutsuLoadoutId: "new-jutsus",
      itemLoadoutId: "with-armor",
    });
    expect(result.success).toBe(true);
    expect(await equippedIds()).toEqual(["gated", "usable"]);
  });

  it("clears persisted jutsu equips after an item-only switch removes their mastery source", async () => {
    await seedLobby(true);
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      itemLoadoutId: "without-armor",
    });
    expect(result.success).toBe(true);
    expect(await equippedIds()).toEqual([]);
  });
});
