import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { CombatStatNames, MasteryNames } from "@/drizzle/constants";
import { battle } from "@/drizzle/schema";
import { captureCombatCacheSnapshot, combatCacheDerived, combatCacheEnergy, combatCacheItems, combatCacheIntegerDelta, combatProfilePatch, canCacheCombatCompletion, type CombatProfileUpdate } from "@/libs/combat/userCache";
import { calcMaxEnergy } from "@/libs/profile";
import { effectiveMasteries } from "@/libs/mastery";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { ZodAllTags } from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";
import { calcBattleResult, maskBattle } from "@/libs/combat/util";

const key = [["profile", "getUser"], { type: "query" }];
const fixture = () => {
  const gear = { id: "chest", quantity: 1, experience: 0, level: 1, equipped: "CHEST" as const, durability: 100,
    item: { itemType: "ARMOR", maxDurability: 100, bloodlineId: null, canBeImbued: false,
      effects: [{ type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 10, powerPerLevel: 0, calculation: "static" },
        { type: "increasemaxpools", poolsAffected: ["Energy"], power: 100, powerPerLevel: 0, calculation: "static" }] as ZodAllTags[] },
  };
  const raw = { userId: "viewer", level: 10, rank: "JONIN" as const,
    ...Object.fromEntries([...CombatStatNames, ...MasteryNames].map((field) => [field, 100])),
    curEnergy: 10, money: 100, experience: 200, seichiSilver: 0, pveFights: 10, regenAt: new Date("2026-01-01T00:00:00Z"), earnedExperience: 100,
    bloodlineId: null, items: [gear], energyQueueHead: 0, energyQueueTail: 0, masteryQueueHead: 0, queue: [] } as unknown as Parameters<typeof captureCombatCacheSnapshot>[0];
  const snapshot = captureCombatCacheSnapshot(raw);
  const { masterySources: _private, ...baseline } = snapshot;
  const items = [{ ...baseline.items[0]!, durability: 0 }];
  const update: CombatProfileUpdate = { userId: raw.userId, battleId: "fight", baseline, items,
    userDelta: { money: 20, experience: 30, offence: 2, ninjutsuMastery: 5, dailyArenaFights: 1 },
    userPatch: { curHealth: 90, curChakra: 80, curStamina: 70, curEnergy: 12, regenAt: new Date("2026-01-01T00:00:10Z"), stealthCooldownAt: new Date(), pvpStreak: 0, pveFights: 11, questData: [],
      ...combatCacheDerived(snapshot, items, { ninjutsuMastery: 5 }) },
  };
  const current = { ...raw, status: "BATTLE", battleId: "fight", money: 100, experience: 200, dailyArenaFights: 0, maxEnergy: calcMaxEnergy(raw), userQuests: [], questData: [] } as unknown as NonNullable<UserWithRelations>;
  return { raw, snapshot, current, update };
};

describe("confirmed combat profile reconciliation", () => {
  it("applies one normal equipped fight without fetching and refuses replay", async () => {
    const { current, update } = fixture();
    const client = new QueryClient();
    client.setQueryData(key, { userData: current });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { reads++; return { userData: { ...current, status: "AWAKE", battleId: null, money: 120 } }; } });
    const close = observer.subscribe(() => {});
    const revision = prepareUserUpdate(client, key);
    await updateUserCache(client, key, (user) => combatProfilePatch(user, update), { revision, delta: update.userDelta });
    const settled = client.getQueryData<{ userData: typeof current }>(key)!.userData;
    expect(settled.money).toBe(120);
    expect(settled.pveFights).toBe(11);
    expect(settled.offence).toBe(102);
    expect(settled.ninjutsuMastery).toBe(105);
    expect(settled.items[0]!.durability).toBe(0);
    expect(settled.effectiveMasteries?.ninjutsuMastery).toBe(105);
    expect(settled.maxEnergy).toBeLessThan(current.maxEnergy);
    expect(reads).toBe(0);
    expect(combatProfilePatch(settled, update)).toBeUndefined();
    await updateUserCache(client, key, (user) => combatProfilePatch(user, update), { revision, delta: update.userDelta });
    expect(reads).toBe(1);
    expect(client.getQueryData<{userData: typeof current}>(key)!.userData.money).toBe(120);
    close(); client.clear();
  });

  it("adds the Assign XP notification when combat grants the first unassigned points", async () => {
    const { current, update } = fixture();
    current.earnedExperience = 0;
    update.baseline.earnedExperience = 0;
    update.userDelta.earnedExperience = 10;
    const client = new QueryClient();
    client.setQueryData(key, { userData: current, notifications: [{ href: "/combat", name: "In combat", color: "red" }] });
    await updateUserCache(client, key, (user) => combatProfilePatch(user, update), { revision: prepareUserUpdate(client, key), delta: update.userDelta });
    const after = client.getQueryData<{ userData: typeof current; notifications: { name: string }[] }>(key)!;
    expect(after.userData.earnedExperience).toBe(10);
    expect(after.notifications.map((entry) => entry.name)).toEqual(["Assign XP"]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("falls back for another viewer, replacement battle, queue, changed progression or gear", () => {
    const { current, update } = fixture();
    for (const changed of [
      { userId: "someone-else" }, { battleId: "new-fight" }, { ninjutsuMastery: 101 },
      { money: 101 }, { experience: 201 }, { seichiSilver: 1 },
      { pveFights: 11 }, { pveFights: 12 },
      { energyQueueTail: 1 },
      { items: current.items.map((item) => ({ ...item, durability: 99 })) },
      { regenAt: new Date(current.regenAt.getTime() + 1) },
    ]) expect(combatProfilePatch({ ...current, ...changed } as typeof current, update)).toBeUndefined();
  });

  it("preserves worn slots and items omitted by battle gates while applying confirmed wear", () => {
    const { snapshot } = fixture();
    const disabled = { ...snapshot.items[0]!, equipped: "NONE", durability: 90 } as Parameters<typeof combatCacheItems>[1][number];
    const settled = combatCacheItems(snapshot, [disabled]);
    expect(settled[0]!.equipped).toBe("CHEST");
    expect(settled[0]!.durability).toBe(90);
    expect(combatCacheItems(snapshot, [])).toEqual(snapshot.items);
  });

  it("stores immutable unscaled source effects and masks them from all viewers", () => {
    const { raw, snapshot } = fixture();
    raw.items[0]!.durability = 0;
    expect(snapshot.masterySources.items![0]!.durability).toBe(100);
    const battle = makeCompleteBattle({ extraState: { profileCacheSnapshots: { viewer: snapshot } } });
    expect(maskBattle(battle, "viewer").extraState.profileCacheSnapshots).toEqual({});
    expect(maskBattle(battle, "opponent").extraState.profileCacheSnapshots).toEqual({});
  });

  it.each(["finished", "future", "null"] as const)("matches relational gear effects after battle JSON serialization (%s imbuement)", (completion) => {
    const { raw } = fixture();
    const gear = raw.items[0]!;
    const effects = gear.item.effects;
    gear.item = { ...gear.item, effects: [], canBeImbued: true };
    const craftingFinishedAt = completion === "null"
      ? null
      : new Date(Date.now() + (completion === "finished" ? -86_400_000 : 86_400_000));
    gear.imbuements = [{ craftingFinishedAt, item: { effects } }];
    const snapshot = captureCombatCacheSnapshot(raw);
    const serialized = battle.extraState.mapToDriverValue({ profileCacheSnapshots: { viewer: snapshot } });
    expect(typeof serialized).toBe("string");
    const restored = (JSON.parse(serialized as string) as { profileCacheSnapshots: { viewer: typeof snapshot } }).profileCacheSnapshots.viewer;
    const savedDate = restored.masterySources.items![0]!.imbuements![0]!.craftingFinishedAt;
    expect(savedDate).toBe(craftingFinishedAt?.toISOString() ?? null);
    const derived = combatCacheDerived(restored, restored.items, {});
    expect(derived.maxEnergy).toBe(calcMaxEnergy(raw));
    expect(derived.effectiveMasteries).toEqual(effectiveMasteries(raw));
    expect(derived.effectiveMasteries.ninjutsuMastery).toBe(completion === "finished" ? 110 : 100);
    expect(restored.masterySources.items![0]!.imbuements![0]!.craftingFinishedAt).toBe(savedDate);
  });

  it("rounds integer rewards from their final balance rather than rounding negative deltas", () => {
    expect(combatCacheIntegerDelta({ money: 100, experience: 200, earnedExperience: 0, seichiSilver: 0 }, { money: -0.5, experience: 0.75, earnedExperience: 0.25, seichiSilver: 0.5 })).toEqual({ money: 0, experience: 1, earnedExperience: 0, seichiSilver: 1 });
  });

  it("uses fractional recovery, reward and caps at the bound settlement clock", () => {
    const { snapshot } = fixture();
    expect(combatCacheEnergy(snapshot, 100, 3, new Date("2026-01-01T00:00:01Z"), 0)).toBeGreaterThan(10);
    expect(combatCacheEnergy(snapshot, 11, 3, new Date("2026-01-01T00:10:00Z"), 20)).toBe(11);
    expect(combatCacheEnergy(snapshot, 100, 3, new Date("2025-12-31T23:00:00Z"), 0)).toBe(10);
  });

  it("keeps PvP, hospitalized outcomes and queued participants on refresh", () => {
    const { snapshot } = fixture();
    const user = makeBattleUser("viewer", { isAi: false, direction: "left", curHealth: 100 });
    const enemy = makeBattleUser("ai", { isAi: true, direction: "right", curHealth: 0, leftBattle: true });
    const battle = makeCompleteBattle({ battleType: "ARENA", usersState: [user, enemy], extraState: { settings: [], profileCacheSnapshots: { viewer: snapshot } } });
    const result = calcBattleResult(battle, "viewer", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    expect(canCacheCombatCompletion(battle, result, "viewer")).toBe(true);
    expect(canCacheCombatCompletion({ ...battle, battleType: "COMBAT" }, result, "viewer")).toBe(false);
    expect(canCacheCombatCompletion(battle, { ...result, curHealth: 0 }, "viewer")).toBe(false);
    expect(canCacheCombatCompletion({ ...battle, usersState: [...battle.usersState, makeBattleUser("other", { isAi: false })] }, result, "viewer")).toBe(false);
    const legacy = { ...snapshot, money: undefined } as unknown as typeof snapshot;
    expect(canCacheCombatCompletion({ ...battle, extraState: { ...battle.extraState, profileCacheSnapshots: { viewer: legacy } } }, result, "viewer")).toBe(false);
    const legacyCounter = { ...snapshot, pveFights: undefined } as unknown as typeof snapshot;
    expect(canCacheCombatCompletion({ ...battle, extraState: { ...battle.extraState, profileCacheSnapshots: { viewer: legacyCounter } } }, result, "viewer")).toBe(false);
    snapshot.hadTrainingQueue = true;
    expect(canCacheCombatCompletion(battle, result, "viewer")).toBe(false);
  });
});
