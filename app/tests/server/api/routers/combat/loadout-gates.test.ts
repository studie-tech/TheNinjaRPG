import { fetchBattleEssentials } from "@/queries/combat";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { BattleType } from "@/drizzle/constants";
import { aiProfile, battle, jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { captureCombatCacheSnapshot } from "@/deltas/combat";
import { refreshMasteries } from "@/libs/combat/util";
import { effectiveMasteries } from "@/libs/mastery";
import { Pusher } from "@/libs/pusher";
import { battleJutsuGateFailure } from "@/libs/train";
import { combatRouter, processUsersForBattle } from "@/server/api/routers/combat";
import { fetchUserItemsWithVariants } from "@/server/api/routers/item";
import { fetchUserJutsus, jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const USER = "lobby-gates-user";
const BATTLE = "lobby-gates-battle";
const VALID = Array.from({ length: 15 }, (_, index) => `valid-${index}`);
const LOCKED = ["element-locked", "wrong-bloodline", "hidden"];

const jutsuRow = (id: string, extra: Partial<typeof jutsu.$inferInsert> = {}) => ({
  id, name: id, image: "", description: id, battleDescription: id, effects: [],
  target: "SELF" as const, range: 0, requiredRank: "GENIN" as const, jutsuType: "NORMAL" as const,
  ...extra,
});

/** Locked jutsu first so, without the shared gates, they take three of the 15 slots. */
const seedJutsu = async () => {
  const db = await getTestDatabase();
  await db.insert(jutsu).values([
    jutsuRow("element-locked", { elementClassification: "Fire" }),
    jutsuRow("wrong-bloodline", { bloodlineId: "other-bloodline", jutsuType: "BLOODLINE" }),
    jutsuRow("hidden", { hidden: true }),
    jutsuRow("level-locked", { requiredLevel: 100 }),
    jutsuRow("weapon-locked", { jutsuWeapon: "SWORD" }),
    jutsuRow("mastery-locked", { requiredNinjutsuMastery: 500 }),
    ...VALID.map((id) => jutsuRow(id)),
  ]);
  const ids = [...LOCKED, "level-locked", "weapon-locked", "mastery-locked", ...VALID];
  await db.insert(userJutsu).values(ids.map((jutsuId) => ({ id: `owned-${jutsuId}`, userId: USER, jutsuId, equipped: false })));
  await db.insert(jutsuLoadout).values({ id: "gates", userId: USER, jutsuIds: [...LOCKED, ...VALID] });
};

/** The combatant exactly as battle initiation receives it, with every owned jutsu equipped. */
const rawUser = async (onlyEquipped: boolean) => {
  const db = await getTestDatabase();
  const row = await db.query.userData.findFirst({ where: eq(userData.userId, USER) });
  if (!row) throw new Error("Missing lobby user");
  const essentials = await fetchBattleEssentials(db);
  const jutsus = await fetchUserJutsus(db, USER, undefined, { applyReskins: false });
  const raw = {
    ...row,
    items: await fetchUserItemsWithVariants(db, USER),
    jutsus: onlyEquipped ? jutsus.filter((owned) => owned.equipped) : jutsus,
    userSkills: [],
    bloodline: null,
    village: null,
    aiProfile: essentials.defaultProfile,
  } as CombatQueryUser;
  return { raw, essentials };
};

const processFor = async (battleType: BattleType, onlyEquipped = true) => {
  const db = await getTestDatabase();
  const { raw, essentials } = await rawUser(onlyEquipped);
  const processed = await processUsersForBattle(db, {
    users: [raw], ...essentials, wars: essentials.activeWars, battleType,
    hide: false, isSummon: false, width: 13, height: 9,
  });
  return { raw, essentials, processed };
};

const seedLobby = async () => {
  const db = await getTestDatabase();
  const { raw, processed } = await processFor("COMBAT");
  processed.extraState.profileCacheSnapshots = { [USER]: captureCombatCacheSnapshot(raw) };
  refreshMasteries(processed.usersState, processed.userEffects);
  await db.insert(battle).values({
    id: BATTLE, background: "default", battleType: "COMBAT",
    roundStartAt: new Date(Date.now() + 60_000),
    usersState: processed.usersState, usersEffects: processed.userEffects,
    extraState: processed.extraState, groundEffects: [],
  });
};

const equippedIds = async () => {
  const db = await getTestDatabase();
  return (await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, USER) }))
    .filter((owned) => owned.equipped)
    .map((owned) => owned.jutsuId)
    .sort();
};

describeWithDatabase("combat lobby jutsu gates", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(battle, aiProfile, userJutsu, jutsuLoadout, jutsu, userData);
    // JONIN (9) + gold federal (3) + 2 extra slots + 1 base = 15 equip slots.
    await insertUsers([{
      userId: USER, username: USER, rank: "GENIN", level: 20, federalStatus: "GOLD",
      extraJutsuSlots: 2, isOutlaw: true, ninjutsuMastery: 100,
      // Keep Fire locked when profile maintenance runs between equip operations.
      primaryElement: "Water", secondaryElement: "Wind",
    }]);
    await (await getTestDatabase()).update(userData).set({ rank: "JONIN" }).where(eq(userData.userId, USER));
    await (await getTestDatabase()).insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await seedJutsu();
  });
  afterEach(() => vi.restoreAllMocks());

  it("skips locked jutsu in the lobby, warns about each and persists the Jutsu page's equipped set", async () => {
    const db = await getTestDatabase();
    await seedLobby();
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({ battleId: BATTLE, jutsuLoadoutId: "gates" });
    expect(result.success).toBe(true);
    const warnings = result.message.split("Warnings: ")[1]?.split(", ") ?? [];
    expect(warnings).toHaveLength(3);
    expect(warnings.map((warning) => warning.split(/:| is hidden/)[0])).toEqual(LOCKED);
    const lobbyEquipped = await equippedIds();
    expect(lobbyEquipped).toEqual([...VALID].sort());
    // Battle initiation keeps every jutsu the lobby equipped.
    const stored = (await db.query.battle.findFirst({ where: eq(battle.id, BATTLE) }))!;
    expect(stored.usersState[0]!.jutsus.map((owned) => owned.jutsuId).sort()).toEqual(lobbyEquipped);

    await db.update(userJutsu).set({ equipped: false }).where(eq(userJutsu.userId, USER));
    const page = await (await callerFor(jutsuRouter, USER)).selectJutsuLoadout({ id: "gates" });
    expect(page.success).toBe(true);
    expect(await equippedIds()).toEqual(lobbyEquipped);
  });

  it.each(["COMBAT", "SPARRING", "RANKED_PVP"] as const)("%s initiation drops exactly the jutsu the shared gate rejects", async (battleType) => {
    const { raw, processed } = await processFor(battleType, false);
    const masteries = effectiveMasteries({ ...raw, items: raw.items.filter((ui) => ui.equipped !== "NONE") });
    const expected = raw.jutsus
      .filter((owned) => !battleJutsuGateFailure(owned.jutsu, raw, battleType, masteries))
      .map((owned) => owned.jutsuId)
      .sort();
    expect(processed.usersState[0]!.jutsus.map((owned) => owned.jutsuId).sort()).toEqual(expected);
    // Ranked waives usability and weapon requirements, never the bloodline binding.
    const ranked = battleType === "RANKED_PVP";
    const rejected = ["element-locked", "level-locked", "weapon-locked", "mastery-locked"];
    for (const id of rejected) expect(expected.includes(id)).toBe(ranked);
    expect(expected).not.toContain("wrong-bloodline");
    expect(expected).toEqual(expect.arrayContaining(VALID));
  });

  it("explains each gate and lets AI combatants bypass player requirements", async () => {
    const { raw } = await rawUser(false);
    const masteries = effectiveMasteries(raw);
    const failure = (id: string, user = raw) =>
      battleJutsuGateFailure(raw.jutsus.find((owned) => owned.jutsuId === id)!.jutsu, user, "COMBAT", masteries);
    expect(failure("valid-0")).toBeUndefined();
    expect(failure("element-locked")).toBe("element-locked: You do not have the required elements to use this jutsu.");
    expect(failure("wrong-bloodline")).toBe("wrong-bloodline: You do not have the required bloodline to use this jutsu.");
    expect(failure("weapon-locked")).toBe("weapon-locked: no sword weapon equipped");
    expect(failure("mastery-locked")).toBe("mastery-locked: requires 500 Ninjutsu Mastery");
    expect(failure("element-locked", { ...raw, isAi: true })).toBeUndefined();
  });
});
