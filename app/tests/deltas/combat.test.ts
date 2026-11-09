import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  type CombatProfileUpdate,
  canCacheCombatCompletion,
  captureCombatCacheSnapshot,
  combatCacheDerived,
  combatCacheEnergy,
  combatCacheIntegerDelta,
  combatCacheItems,
  combatProfilePatch,
  getCombatAdmissionUserUpdate,
  getCombatInventoryUpdate,
} from "@/deltas/combat";
import {
  CombatStatNames,
  ELEMENTAL_MASTERY_CAP,
  MasteryNames,
} from "@/drizzle/constants";
import { battle } from "@/drizzle/schema";
import { maskBattle } from "@/libs/combat/masking";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { ZodAllTags } from "@/validators/combat";
import { QuestTracker } from "@/validators/objectives";
import { observeProfile, soloPveResult } from "../libs/combat/helpers/profileCache";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

const key = [["profile", "getUser"], { type: "query" }];
const fixture = () => {
  const gear = {
    id: "chest",
    quantity: 1,
    experience: 0,
    level: 1,
    equipped: "CHEST" as const,
    durability: 100,
    item: {
      itemType: "ARMOR",
      maxDurability: 100,
      bloodlineId: null,
      canBeImbued: false,
      effects: [
        {
          type: "increasemastery",
          masteryTypes: ["Ninjutsu"],
          power: 10,
          powerPerLevel: 0,
          calculation: "static",
        },
        {
          type: "increasemaxpools",
          poolsAffected: ["Energy"],
          power: 100,
          powerPerLevel: 0,
          calculation: "static",
        },
      ] as ZodAllTags[],
    },
  };
  const raw = {
    userId: "viewer",
    level: 10,
    rank: "JONIN" as const,
    ...Object.fromEntries(
      [...CombatStatNames, ...MasteryNames].map((field) => [field, 100]),
    ),
    curEnergy: 10,
    money: 100,
    experience: 200,
    seichiSilver: 0,
    pveFights: 10,
    regenAt: new Date("2026-01-01T00:00:00Z"),
    earnedExperience: 100,
    bloodlineId: null,
    items: [gear],
    energyQueueHead: 0,
    energyQueueTail: 0,
    masteryQueueHead: 0,
    elementalQueueHead: 0,
    queue: [],
    elementalMastery: {},
    currentlyTrainingElement: null,
    elementalTrainingStartedAt: null,
    elementalTrainingSpeed: "15min",
    dailyTrainings: 0,
  } as unknown as Parameters<typeof captureCombatCacheSnapshot>[0];
  const snapshot = captureCombatCacheSnapshot(raw);
  const { masterySources: _private, ...baseline } = snapshot;
  const items = [{ ...baseline.items[0]!, durability: 0 }];
  const update: CombatProfileUpdate = {
    userId: raw.userId,
    battleId: "fight",
    baseline,
    items,
    removedQuestIds: [],
    userDelta: {
      money: 20,
      experience: 30,
      offence: 2,
      ninjutsuMastery: 5,
      dailyArenaFights: 1,
    },
    userPatch: {
      status: "AWAKE",
      curHealth: 90,
      curChakra: 80,
      curStamina: 70,
      curEnergy: 12,
      regenAt: new Date("2026-01-01T00:00:10Z"),
      stealthCooldownAt: new Date(),
      pvpStreak: 0,
      pveFights: 11,
      questData: [],
      ...combatCacheDerived(snapshot, items, { ninjutsuMastery: 5 }),
    },
  };
  const current = {
    ...raw,
    status: "BATTLE",
    battleId: "fight",
    money: 100,
    experience: 200,
    dailyArenaFights: 0,
    maxEnergy: calcMaxEnergy(raw),
    userQuests: [],
    questData: [],
  } as unknown as NonNullable<UserWithRelations>;
  return { raw, snapshot, current, update };
};

it("projects confirmed combat items into inventory views without losing extensions or accepting changed baselines", () => {
  const { update } = fixture();
  const rows = update.baseline.items.map((row) => ({ ...row, variants: ["skin"] }));
  const next = getCombatInventoryUpdate(rows, update);
  expect(next?.[0]?.durability).toBe(0);
  expect(next?.[0]?.variants).toBe(rows[0]!.variants);
  expect(rows[0]?.durability).toBe(100);
  expect(
    getCombatInventoryUpdate([{ ...rows[0]!, quantity: 2 }], update),
  ).toBeUndefined();
  expect(getCombatInventoryUpdate([], update)).toBeUndefined();
  expect(getCombatInventoryUpdate(rows, undefined)).toBeUndefined();
  expect(
    getCombatInventoryUpdate(rows, {
      ...update,
      items: update.items.map((row) => ({ ...row, quantity: 0 })),
    }),
  ).toEqual([]);
});

describe("confirmed combat profile reconciliation", () => {
  it.each(["sparse", "complete"])(
    "merges %s public tracker snapshots while replacing loaded targets and appending new trackers",
    (snapshot) => {
      const { current, update } = fixture();
      const omitted = QuestTracker.parse({
        id: "omitted",
        goals: [{ id: "goal", value: 5 }],
      });
      const loaded = QuestTracker.parse({
        id: "loaded",
        goals: [{ id: "goal", value: 1, sector: 2 }],
      });
      const settled = QuestTracker.parse({
        id: "loaded",
        goals: [{ id: "goal", value: 2 }],
      });
      const added = QuestTracker.parse({ id: "added" });
      current.questData = [loaded, omitted];
      update.userPatch.questData =
        snapshot === "complete" ? [settled, omitted, added] : [settled, added];
      expect(combatProfilePatch(current, update)?.questData).toEqual([
        settled,
        omitted,
        added,
      ]);
      expect(current.questData).toEqual([loaded, omitted]);
    },
  );

  it("removes expired loaded trackers while retaining omitted public trackers", () => {
    const { current, update } = fixture();
    const expired = QuestTracker.parse({
      id: "expired",
      goals: [{ id: "target", sector: 1, longitude: 4, latitude: 5 }],
    });
    const omitted = QuestTracker.parse({
      id: "omitted",
      goals: [{ id: "goal", value: 5 }],
    });
    current.questData = [expired, omitted];
    update.removedQuestIds = ["expired"];
    expect(combatProfilePatch(current, update)?.questData).toEqual([omitted]);
    expect(current.questData).toEqual([expired, omitted]);
  });

  it.each([false, true])(
    "replaces trackers from older complete settlement responses (empty: %s)",
    (empty) => {
      const { current, update } = fixture();
      current.questData = [QuestTracker.parse({ id: "removed" })];
      update.userPatch.questData = empty ? [] : [QuestTracker.parse({ id: "settled" })];
      delete update.removedQuestIds;
      expect(combatProfilePatch(current, update)?.questData).toEqual(
        update.userPatch.questData,
      );
    },
  );

  it("retains permanent title mastery through combat completion cache reconciliation", () => {
    const { raw } = fixture();
    raw.titles = [
      {
        userId: raw.userId,
        titleId: "mastery-title",
        createdAt: new Date(),
        effects: [{ type: "increasemastery", power: 25, masteryTypes: ["Ninjutsu"] }],
      },
    ];
    const snapshot = captureCombatCacheSnapshot(raw);
    raw.titles[0]!.effects = [];
    expect(
      combatCacheDerived(snapshot, [], {}).effectiveMasteries.ninjutsuMastery,
    ).toBe(125);
  });
  it("preserves BATTLE between isolated Pyramid floors while clearing the settled battle", () => {
    const { current, update } = fixture();
    update.userPatch.status = "BATTLE";
    expect(combatProfilePatch(current, update)).toMatchObject({
      status: "BATTLE",
      battleId: null,
    });
  });
  it.each([false, true])(
    "applies one normal equipped fight without fetching and refuses replay (collected titles: %s)",
    async (hasTitles) => {
      const { current, update } = fixture();
      if (hasTitles) {
        current.titles = ["second", "first"].map((titleId) => ({
          userId: current.userId,
          titleId,
          effects: [],
          createdAt: new Date(),
        }));
        update.baseline.titleIds = ["first", "second"];
        current.activeTitleId = "second";
      }
      const profile = observeProfile({ userData: current }, async () => ({
        userData: { ...current, status: "AWAKE", battleId: null, money: 120 },
      }));
      const revision = profile.revision();
      await profile.apply(update, revision);
      const settled = profile.user();
      expect(settled.money).toBe(120);
      expect(settled.pveFights).toBe(11);
      expect(settled.offence).toBe(102);
      expect(settled.ninjutsuMastery).toBe(105);
      expect(settled.items[0]!.durability).toBe(0);
      expect(settled.effectiveMasteries?.ninjutsuMastery).toBe(105);
      expect(settled.maxEnergy).toBeLessThan(current.maxEnergy);
      expect(profile.reads()).toBe(0);
      expect(combatProfilePatch(settled, update)).toBeUndefined();
      await profile.apply(update, revision);
      expect(profile.reads()).toBe(1);
      expect(profile.user().money).toBe(120);
      profile.close();
    },
  );

  it("applies confirmed admission and completion through the same profile cache without fetching", async () => {
    const { current, update } = fixture();
    const initial = { ...current, status: "AWAKE" as const, battleId: null };
    const profile = observeProfile({ userData: initial }, async () => ({
      userData: { ...current, ...update.userPatch },
    }));
    const { client, key } = profile;
    try {
      const admission = getCombatAdmissionUserUpdate({
        cacheActor: { userId: current.userId, bracketImmunityLiftedUntil: new Date(0) },
        requiresUserRefresh: false,
        allParticipantIds: [current.userId],
        queuedParticipants: [],
        battleType: "ARENA",
        warAggressorIds: [],
        bracketImmunityAggressorIds: [],
        now: new Date(),
        battleId: update.battleId,
        stealthBreakUserIds: [],
        isTournament: false,
      });
      await updateUserCache(
        client,
        key,
        { success: true, ...admission },
        {
          revision: prepareUserUpdate(client, key),
          refetch: false,
        },
      );
      expect(profile.user()).toMatchObject({
        status: "BATTLE",
        battleId: update.battleId,
        pveFights: update.baseline.pveFights + 1,
      });
      await profile.apply(update);
      expect(profile.reads()).toBe(0);
      expect(profile.user()).toMatchObject({
        status: "AWAKE",
        battleId: null,
        pveFights: update.userPatch.pveFights,
        money: 120,
      });
    } finally {
      profile.close();
    }
  });

  it("adds the Assign XP notification when combat grants the first unassigned points", async () => {
    const { current, update } = fixture();
    current.earnedExperience = 0;
    update.baseline.earnedExperience = 0;
    update.userDelta.earnedExperience = 10;
    const client = new QueryClient();
    client.setQueryData(key, {
      userData: current,
      notifications: [{ href: "/combat", name: "In combat", color: "red" }],
    });
    await updateUserCache(client, key, (user) => combatProfilePatch(user, update), {
      revision: prepareUserUpdate(client, key),
      delta: update.userDelta,
    });
    const after = client.getQueryData<{
      userData: typeof current;
      notifications: { name: string }[];
    }>(key)!;
    expect(after.userData.earnedExperience).toBe(10);
    expect(after.notifications.map((entry) => entry.name)).toEqual(["Assign XP"]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("refreshes elemental training settled before the arena snapshot was captured", async () => {
    const { raw, current, update } = fixture();
    current.elementalMastery = { Wind: ELEMENTAL_MASTERY_CAP - 100 };
    current.currentlyTrainingElement = "Wind";
    current.elementalTrainingStartedAt = raw.regenAt;
    const server = {
      ...raw,
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP },
      currentlyTrainingElement: null,
      elementalTrainingStartedAt: null,
      dailyTrainings: 1,
    };
    const { masterySources: _private, ...baseline } =
      captureCombatCacheSnapshot(server);
    update.baseline = baseline;
    expect(baseline.hadTrainingQueue).toBe(false);
    expect(combatProfilePatch(current, update)).toBeUndefined();

    const profile = observeProfile({ userData: current }, async () => ({
      userData: { ...current, ...server, status: "AWAKE", battleId: null },
    }));
    await profile.apply(update);
    expect(profile.reads()).toBe(1);
    expect(profile.user()).toMatchObject({
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP },
      currentlyTrainingElement: null,
      elementalTrainingStartedAt: null,
      dailyTrainings: 1,
    });
    profile.close();
  });

  it("falls back for another viewer, replacement battle, queue, changed progression or gear", () => {
    const { current, update } = fixture();
    for (const changed of [
      { userId: "someone-else" },
      { battleId: "new-fight" },
      { ninjutsuMastery: 101 },
      { money: 101 },
      { experience: 201 },
      { seichiSilver: 1 },
      { pveFights: 12 },
      { energyQueueTail: 1 },
      { items: current.items.map((item) => ({ ...item, durability: 99 })) },
      { regenAt: new Date(current.regenAt.getTime() + 1) },
      {
        titles: [
          {
            userId: current.userId,
            titleId: "new-title",
            createdAt: new Date(),
            effects: [],
          },
        ],
      },
    ])
      expect(
        combatProfilePatch({ ...current, ...changed } as typeof current, update),
      ).toBeUndefined();
  });

  it("refreshes changed ownership even when the title count matches", () => {
    const { current, update } = fixture();
    update.baseline.titleIds = ["previous-title"];
    current.titles = [
      {
        userId: current.userId,
        titleId: "new-title",
        createdAt: new Date(),
        effects: [],
      },
    ];
    expect(combatProfilePatch(current, update)).toBeUndefined();
    current.titles = [];
    expect(combatProfilePatch(current, update)).toBeUndefined();
  });

  it("preserves worn slots and items omitted by battle gates while applying confirmed wear", () => {
    const { snapshot } = fixture();
    const disabled = {
      ...snapshot.items[0]!,
      equipped: "NONE",
      durability: 90,
    } as Parameters<typeof combatCacheItems>[1][number];
    const settled = combatCacheItems(snapshot, [disabled]);
    expect(settled[0]!.equipped).toBe("CHEST");
    expect(settled[0]!.durability).toBe(90);
    expect(combatCacheItems(snapshot, [])).toEqual(snapshot.items);
  });

  it("stores immutable unscaled source effects and masks them from all viewers", () => {
    const { raw, snapshot } = fixture();
    raw.items[0]!.durability = 0;
    expect(snapshot.masterySources.items![0]!.durability).toBe(100);
    const battle = makeCompleteBattle({
      extraState: { profileCacheSnapshots: { viewer: snapshot } },
    });
    expect(maskBattle(battle, "viewer").extraState.profileCacheSnapshots).toEqual({});
    expect(maskBattle(battle, "opponent").extraState.profileCacheSnapshots).toEqual({});
  });

  it.each(["finished", "future", "null"] as const)(
    "matches relational gear effects after battle JSON serialization (%s imbuement)",
    (completion) => {
      const { raw } = fixture();
      const gear = raw.items[0]!;
      const effects = gear.item.effects;
      gear.item = { ...gear.item, effects: [], canBeImbued: true };
      const craftingFinishedAt =
        completion === "null"
          ? null
          : new Date(
              Date.now() + (completion === "finished" ? -86_400_000 : 86_400_000),
            );
      gear.imbuements = [{ craftingFinishedAt, item: { effects } }];
      const snapshot = captureCombatCacheSnapshot(raw);
      const serialized = battle.extraState.mapToDriverValue({
        profileCacheSnapshots: { viewer: snapshot },
      });
      expect(typeof serialized).toBe("string");
      const restored = (
        JSON.parse(serialized as string) as {
          profileCacheSnapshots: { viewer: typeof snapshot };
        }
      ).profileCacheSnapshots.viewer;
      const savedDate =
        restored.masterySources.items![0]!.imbuements![0]!.craftingFinishedAt;
      expect(savedDate).toBe<string | null>(craftingFinishedAt?.toISOString() ?? null);
      const derived = combatCacheDerived(restored, restored.items, {});
      expect(derived.maxEnergy).toBe(calcMaxEnergy(raw));
      expect(derived.effectiveMasteries).toEqual(effectiveMasteries(raw));
      expect(derived.effectiveMasteries.ninjutsuMastery).toBe(
        completion === "finished" ? 110 : 100,
      );
      expect(
        restored.masterySources.items![0]!.imbuements![0]!.craftingFinishedAt,
      ).toBe(savedDate);
    },
  );

  it("rounds integer rewards from their final balance rather than rounding negative deltas", () => {
    expect(
      combatCacheIntegerDelta(
        { money: 100, experience: 200, earnedExperience: 0, seichiSilver: 0 },
        { money: -0.5, experience: 0.75, earnedExperience: 0.25, seichiSilver: 0.5 },
      ),
    ).toEqual({ money: 0, experience: 1, earnedExperience: 0, seichiSilver: 1 });
  });

  it("uses fractional recovery, reward and caps at the bound settlement clock", () => {
    const { snapshot } = fixture();
    expect(
      combatCacheEnergy(snapshot, 100, 3, new Date("2026-01-01T00:00:01Z"), 0),
    ).toBeGreaterThan(10);
    expect(
      combatCacheEnergy(snapshot, 11, 3, new Date("2026-01-01T00:10:00Z"), 20),
    ).toBe(11);
    expect(
      combatCacheEnergy(snapshot, 100, 3, new Date("2025-12-31T23:00:00Z"), 0),
    ).toBe(10);
  });

  it("keeps PvP, hospitalized outcomes and queued participants on refresh", () => {
    const { snapshot } = fixture();
    const user = makeBattleUser("viewer", {
      isAi: false,
      direction: "left",
      curHealth: 100,
    });
    const enemy = makeBattleUser("ai", {
      isAi: true,
      direction: "right",
      curHealth: 0,
      leftBattle: true,
    });
    const battle = makeCompleteBattle({
      battleType: "ARENA",
      usersState: [user, enemy],
      extraState: { settings: [], profileCacheSnapshots: { viewer: snapshot } },
    });
    const result = soloPveResult(battle, "viewer");
    expect(canCacheCombatCompletion(battle, result, "viewer")).toBe(true);
    expect(
      canCacheCombatCompletion(
        {
          ...battle,
          extraState: { ...battle.extraState, petIdsByOwner: { viewer: "pet-1" } },
        },
        result,
        "viewer",
      ),
    ).toBe(false);
    expect(
      canCacheCombatCompletion({ ...battle, battleType: "COMBAT" }, result, "viewer"),
    ).toBe(false);
    expect(
      canCacheCombatCompletion(battle, { ...result, curHealth: 0 }, "viewer"),
    ).toBe(false);
    expect(
      canCacheCombatCompletion(
        {
          ...battle,
          usersState: [...battle.usersState, makeBattleUser("other", { isAi: false })],
        },
        result,
        "viewer",
      ),
    ).toBe(false);
    const legacy = { ...snapshot, money: undefined } as unknown as typeof snapshot;
    expect(
      canCacheCombatCompletion(
        {
          ...battle,
          extraState: {
            ...battle.extraState,
            profileCacheSnapshots: { viewer: legacy },
          },
        },
        result,
        "viewer",
      ),
    ).toBe(false);
    const legacyCounter = {
      ...snapshot,
      pveFights: undefined,
    } as unknown as typeof snapshot;
    expect(
      canCacheCombatCompletion(
        {
          ...battle,
          extraState: {
            ...battle.extraState,
            profileCacheSnapshots: { viewer: legacyCounter },
          },
        },
        result,
        "viewer",
      ),
    ).toBe(false);
    snapshot.hadTrainingQueue = true;
    expect(canCacheCombatCompletion(battle, result, "viewer")).toBe(false);
  });

  it.each([-900_000, 900_000])(
    "refreshes standalone elemental training across combat at offset %s",
    (offset) => {
      const { raw, current, update } = fixture();
      const training = {
        currentlyTrainingElement: "Wind" as const,
        elementalTrainingStartedAt: new Date(Date.now() + offset),
      };
      const snapshot = captureCombatCacheSnapshot({ ...raw, ...training });
      const user = makeBattleUser("viewer", {
        isAi: false,
        direction: "left",
        curHealth: 100,
      });
      const enemy = makeBattleUser("ai", {
        isAi: true,
        direction: "right",
        curHealth: 0,
        leftBattle: true,
      });
      const battle = makeCompleteBattle({
        battleType: "ARENA",
        usersState: [user, enemy],
        extraState: { settings: [], profileCacheSnapshots: { viewer: snapshot } },
      });
      const result = soloPveResult(battle, "viewer");
      expect(snapshot.hadTrainingQueue).toBe(true);
      expect(canCacheCombatCompletion(battle, result, "viewer")).toBe(false);
      expect(combatProfilePatch({ ...current, ...training }, update)).toBeUndefined();
    },
  );
});
