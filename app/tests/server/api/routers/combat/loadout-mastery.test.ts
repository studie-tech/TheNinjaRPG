import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  type BattleType,
  MAX_PLAYER_LEVEL,
  RANKED_PVP_STATS,
  REGEN_SECONDS,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  bloodlineReskin,
  item,
  itemLoadout,
  jutsu,
  jutsuEquipLimit,
  jutsuLoadout,
  jutsuReskin,
  title,
  userData,
  userItem,
  userJutsu,
  userTitle,
} from "@/drizzle/schema";
import { userJutsuToAction } from "@/libs/combat/actions";
import { refreshMasteries } from "@/libs/combat/mastery";
import { applyEffects } from "@/libs/combat/process";
import type { CombatQueryUser } from "@/libs/combat/types";
import { jutsuRequirementWarning } from "@/libs/jutsuRequirements";
import { effectiveMasteries } from "@/libs/mastery";
import { calcCP, calcHP, calcSP, manuallyAssignUserStats } from "@/libs/profile";
import { Pusher } from "@/libs/pusher";
import { validateItemLoadout } from "@/libs/ranked_pvp";
import { fetchBattleEssentials } from "@/queries/combat";
import type { UserWithRelations } from "@/routers/profile";
import { combatRouter } from "@/server/api/routers/combat";
import { fetchUserJutsus } from "@/server/api/routers/jutsu";
import { getTagSchema } from "@/validators/combat";
import {
  insertSnapshotLobby,
  loadCombatant,
  preloadLobby,
} from "../../../../libs/combat/helpers/preload";
import { makeCompleteBattle } from "../../../../setup/combat";
import {
  insertDefaultAiProfile,
  insertItems,
  insertJutsus,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "lobby-mastery-user";
const BATTLE = "lobby-mastery-battle";

const seedLobby = async (
  wearArmor = false,
  raidBuffs: NonNullable<CombatQueryUser["raidBuffs"]> = [],
  options: { titles?: CombatQueryUser["titles"]; battleType?: BattleType } = {},
) => {
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
  await insertDefaultAiProfile();
  await insertJutsus([
    { id: "gated", name: "Gated", requiredRank: "GENIN", requiredNinjutsuMastery: 500 },
    {
      id: "usable",
      name: "Usable",
      description: "Usable",
      battleDescription: "Usable",
      requiredRank: "GENIN",
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
  const essentials = await fetchBattleEssentials(db);
  const raw = await loadCombatant(db, USER, essentials, {
    raidBuffs,
    titles: options.titles,
  });
  const battleType = options.battleType ?? "COMBAT";
  const processed = await preloadLobby(db, [raw], essentials, battleType);
  await insertSnapshotLobby(db, BATTLE, battleType, raw, processed);
  return { raw, essentials };
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
    await resetTables(jutsuEquipLimit);
    await (await getTestDatabase()).insert(jutsuEquipLimit).values(equipLimitFixture);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battle,
      aiProfile,
      userJutsu,
      jutsuReskin,
      bloodlineReskin,
      jutsuLoadout,
      jutsu,
      userItem,
      itemLoadout,
      item,
      userTitle,
      title,
      userData,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["COMBAT", "SPARRING"] as const)(
    "%s retains preloaded title mastery and its jutsu and gear requirements across repeated lobby switches",
    async (battleType) => {
      const db = await getTestDatabase();
      const titles: NonNullable<CombatQueryUser["titles"]> = [250, 150].map(
        (power, index) => ({
          userId: USER,
          titleId: `mastery-title-${index}`,
          createdAt: new Date(),
          effects: [{ type: "increasemastery", masteryTypes: ["Ninjutsu"], power }],
        }),
      );
      await seedLobby(false, [], { titles, battleType });
      await db.insert(title).values(
        titles.map((owned) => ({
          id: owned.titleId,
          name: owned.titleId,
          effects: owned.effects,
        })),
      );
      await db.insert(userTitle).values(titles);
      await db
        .update(item)
        .set({ requiredNinjutsuMastery: 500 })
        .where(eq(item.id, "armor"));
      const initial = (await db.query.battle.findFirst({
        where: eq(battle.id, BATTLE),
      }))!;
      expect(initial.usersState[0]!.ninjutsuMastery).toBe(500);
      expect(initial.usersState[0]).not.toHaveProperty("titles");
      // Battle JSON retains the pre-combat status and serializes dates as strings.
      // Elapsed ticks must not make title-bearing lobby switches fail or refill pools.
      initial.usersState[0]!.regenAt = new Date(Date.now() - REGEN_SECONDS * 2500);
      initial.usersState[0]!.curHealth = 50;
      initial.usersState[0]!.curChakra = 40;
      initial.usersState[0]!.curStamina = 30;
      await db
        .update(battle)
        .set({ usersState: initial.usersState })
        .where(eq(battle.id, BATTLE));
      // Ownership acquired after initiation belongs to the next encounter.
      await db.insert(title).values({
        id: "later-title",
        name: "Later title",
        effects: [{ type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 900 }],
      });
      await db.insert(userTitle).values({
        userId: USER,
        titleId: "later-title",
        effects: [{ type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 900 }],
      });
      const caller = await callerFor(combatRouter, USER);
      for (const itemLoadoutId of [
        undefined,
        "with-armor",
        "without-armor",
        "with-armor",
      ]) {
        const result = await caller.updateCombatLoadout({
          battleId: BATTLE,
          jutsuLoadoutId: "new-jutsus",
          itemLoadoutId,
        });
        expect(result.success).toBe(true);
        expect(result.message).toBe("");
        expect(await equippedIds()).toEqual(["gated", "usable"]);
        const updated = (await db.query.battle.findFirst({
          where: eq(battle.id, BATTLE),
        }))!;
        expect(updated.usersState[0]).toMatchObject({
          curHealth: 50,
          curChakra: 40,
          curStamina: 30,
        });
        const hasArmor = itemLoadoutId === "with-armor";
        expect(updated.usersState[0]!.ninjutsuMastery).toBe(hasArmor ? 900 : 500);
        expect(
          updated.usersState[0]!.jutsus.map((owned) => owned.jutsuId).sort(),
        ).toEqual(["gated", "usable"]);
        expect(
          updated.usersState[0]!.items.some(
            (owned) => owned.itemId === "armor" && owned.equipped === "CHEST",
          ),
        ).toBe(hasArmor);
        expect(
          updated.usersEffects.filter((effect) => effect.type === "increasemastery"),
        ).toHaveLength(hasArmor ? 3 : 2);
        expect(
          updated.usersEffects.filter((effect) =>
            titles.some((owned) => owned.titleId === effect.actionId),
          ),
        ).toHaveLength(2);
        expect(updated.usersState[0]).not.toHaveProperty("titles");
      }
    },
  );

  it("keeps live timed bonuses once across loadout switches and drops expired and removed equipment effects", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await seedLobby(true, [
      {
        id: "meal-bonus",
        userId: USER,
        questId: null,
        itemId: null,
        createdAt: new Date(),
        expiresAt,
        effects: [
          getTagSchema("increasestat").parse({ statTypes: ["Ninjutsu"], power: 20 }),
        ],
      },
      {
        id: "raid-bonus",
        userId: USER,
        questId: null,
        itemId: null,
        createdAt: new Date(),
        expiresAt,
        effects: [
          getTagSchema("increasestat").parse({ generalTypes: ["Strength"], power: 10 }),
        ],
      },
    ]);
    const db = await getTestDatabase();
    const initial = (await db.query.battle.findFirst({
      where: eq(battle.id, BATTLE),
    }))!;
    expect(initial.usersState[0]).not.toHaveProperty("raidBuffs");
    expect(
      initial.usersEffects.filter((effect) => effect.timedBuffExpiresAt),
    ).toHaveLength(2);
    initial.usersEffects.push({
      ...initial.usersEffects.find((effect) => effect.timedBuffExpiresAt)!,
      id: "expired-bonus",
      timedBuffExpiresAt: Date.now() - 1,
    });
    await db
      .update(battle)
      .set({ usersEffects: initial.usersEffects })
      .where(eq(battle.id, BATTLE));
    const caller = await callerFor(combatRouter, USER);
    for (const itemLoadoutId of ["without-armor", "with-armor", "without-armor"]) {
      expect(
        (await caller.updateCombatLoadout({ battleId: BATTLE, itemLoadoutId })).success,
      ).toBe(true);
      const updated = (await db.query.battle.findFirst({
        where: eq(battle.id, BATTLE),
      }))!;
      expect(
        updated.usersEffects.filter((effect) => effect.timedBuffExpiresAt),
      ).toEqual(
        initial.usersEffects.filter(
          (effect) => (effect.timedBuffExpiresAt ?? 0) > Date.now(),
        ),
      );
      expect(
        updated.usersEffects.filter((effect) => effect.type === "increasemastery"),
      ).toHaveLength(itemLoadoutId === "with-armor" ? 1 : 0);
      const current = makeCompleteBattle(updated);
      const { newBattle } = applyEffects(current, USER);
      expect(current.usersState[0]!.offence).toBeCloseTo(
        initial.usersState[0]!.offence * 1.2,
      );
      expect(current.usersState[0]!.strength).toBeCloseTo(
        initial.usersState[0]!.strength * 1.1,
      );
      applyEffects(newBattle, USER);
      expect(newBattle.usersState[0]!.offence).toBeCloseTo(
        current.usersState[0]!.offence,
      );
      expect(newBattle.usersState[0]!.strength).toBeCloseTo(
        current.usersState[0]!.strength,
      );
    }
  });

  it("preloads linked bloodline cosmetics and retains them after a lobby loadout switch", async () => {
    const { raw, essentials } = await seedLobby();
    const db = await getTestDatabase();
    await db.insert(bloodlineReskin).values({
      id: "scarlet",
      bloodlineId: "blood",
      name: "Scarlet",
      description: "Scarlet",
      image: "",
      createdBy: USER,
    });
    await db
      .update(userData)
      .set({ bloodlineId: "blood", bloodlineReskinId: "scarlet" })
      .where(eq(userData.userId, USER));
    await db
      .update(jutsu)
      .set({ bloodlineId: "blood", jutsuType: "BLOODLINE" })
      .where(eq(jutsu.id, "usable"));
    const parent = await db.query.jutsu.findFirst({ where: eq(jutsu.id, "usable") });
    if (!parent) throw new Error("Missing usable jutsu");
    await insertJutsus([
      {
        ...parent,
        id: "scarlet-jutsu",
        name: "Scarlet cast",
        reskinParentJutsuId: "usable",
        bloodlineReskinId: "scarlet",
        hidden: true,
        jutsuRank: "H",
      },
    ]);
    // Battle initialization receives relational rows without resolved variants.
    const owned = await db.query.userJutsu.findMany({
      where: eq(userJutsu.userId, USER),
      with: { jutsu: true },
    });
    const processed = await preloadLobby(
      db,
      [
        {
          ...raw,
          bloodlineId: "blood",
          bloodlineReskinId: "scarlet",
          jutsus: owned.filter((row) => row.equipped),
        },
      ],
      essentials,
      "COMBAT",
    );
    await db
      .update(battle)
      .set({ usersState: processed.usersState, extraState: processed.extraState })
      .where(eq(battle.id, BATTLE));
    const assertCosmetics = async () => {
      const stored = await db.query.battle.findFirst({ where: eq(battle.id, BATTLE) });
      if (!stored) throw new Error("Missing battle");
      const ref = stored.usersState[0]?.jutsus.find((row) => row.jutsuId === "usable");
      if (!ref) throw new Error("Missing learned jutsu");
      expect(ref.linkedReskinId).toBe("scarlet-jutsu");
      expect(userJutsuToAction(ref, stored)).toMatchObject({
        id: "usable",
        name: "Scarlet cast",
      });
      expect(stored.extraState.jutsus.usable?.name).toBe("Usable");
    };
    await assertCosmetics();
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      jutsuLoadoutId: "new-jutsus",
    });
    expect(result.success).toBe(true);
    await assertCosmetics();
    expect(await equippedIds()).toEqual(["usable"]);
  });

  it("preserves the initiating team and its faction credit when the initiator changes loadout", async () => {
    await seedLobby();
    const db = await getTestDatabase();
    const initial = (await db.query.battle.findFirst({
      where: eq(battle.id, BATTLE),
    }))!;
    initial.usersState[0]!.isAggressor = true;
    initial.usersState[0]!.direction = "left";
    await db
      .update(battle)
      .set({ usersState: initial.usersState })
      .where(eq(battle.id, BATTLE));
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      jutsuLoadoutId: "new-jutsus",
    });
    expect(result.success).toBe(true);
    const updated = (await db.query.battle.findFirst({
      where: eq(battle.id, BATTLE),
    }))!;
    expect(
      updated.usersState.find((member) => member.userId === USER)?.isAggressor,
    ).toBe(true);
    expect(updated.usersState.find((member) => member.userId === USER)?.direction).toBe(
      "left",
    );
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])(
    "keeps cosmetics with their owner (owner switches first: %s, opponent reskinned: %s)",
    async (ownerFirst, opponentReskinned) => {
      const { raw, essentials } = await seedLobby();
      const db = await getTestDatabase();
      const opponentId = "reskin-opponent";
      await insertUsers([
        { userId: opponentId, username: opponentId, rank: "GENIN", level: 20 },
      ]);
      await db.insert(jutsuReskin).values({
        id: "owner-reskin",
        userId: USER,
        jutsuId: "usable",
        name: "Owner Phoenix",
        description: "Owner description",
        battleDescription: "Owner casts Phoenix",
        image: "/phoenix.png",
      });
      await db
        .update(userJutsu)
        .set({ reskinId: "owner-reskin" })
        .where(eq(userJutsu.id, "owned-usable"));
      await db.insert(userJutsu).values({
        id: "opponent-usable",
        userId: opponentId,
        jutsuId: "usable",
        equipped: true,
      });
      if (opponentReskinned) {
        await db.insert(jutsuReskin).values({
          id: "opponent-reskin",
          userId: opponentId,
          jutsuId: "usable",
          name: "Opponent Dragon",
          description: "Opponent description",
          battleDescription: "Opponent casts Dragon",
          image: "/dragon.png",
        });
        await db
          .update(userJutsu)
          .set({ reskinId: "opponent-reskin" })
          .where(eq(userJutsu.id, "opponent-usable"));
      }
      await db
        .insert(jutsuLoadout)
        .values({ id: "opponent-loadout", userId: opponentId, jutsuIds: ["usable"] });
      const ownerJutsus = await fetchUserJutsus(db, USER, undefined, {
        applyReskins: false,
      });
      // Normal jutsu-page consumers still receive personalized data.
      expect(
        (await fetchUserJutsus(db, USER)).find((uj) => uj.jutsuId === "usable")?.jutsu
          .name,
      ).toBe("Owner Phoenix");
      const opponentJutsus = await fetchUserJutsus(db, opponentId, undefined, {
        applyReskins: false,
      });
      const processed = await preloadLobby(
        db,
        [
          { ...raw, jutsus: ownerJutsus.filter((uj) => uj.equipped) },
          { ...raw, userId: opponentId, username: opponentId, jutsus: opponentJutsus },
        ] as CombatQueryUser[],
        essentials,
        "COMBAT",
      );
      await db
        .update(battle)
        .set({ usersState: processed.usersState, extraState: processed.extraState })
        .where(eq(battle.id, BATTLE));
      const switches = [
        { userId: USER, loadout: "new-jutsus" },
        { userId: opponentId, loadout: "opponent-loadout" },
      ];
      if (!ownerFirst) switches.reverse();
      for (const change of switches) {
        const result = await (
          await callerFor(combatRouter, change.userId)
        ).updateCombatLoadout({ battleId: BATTLE, jutsuLoadoutId: change.loadout });
        expect(result.success).toBe(true);
        const stored = await db.query.battle.findFirst({
          where: eq(battle.id, BATTLE),
        });
        if (!stored) throw new Error("Missing battle");
        expect(stored.extraState.jutsus.usable?.name).toBe("Usable");
        for (const actor of stored.usersState) {
          const ref = actor.jutsus.find((uj) => uj.jutsuId === "usable");
          if (!ref) throw new Error("Missing shared jutsu");
          const action = userJutsuToAction(ref, stored);
          const isOwner = actor.userId === USER;
          expect(action.name).toBe(
            isOwner
              ? "Owner Phoenix"
              : opponentReskinned
                ? "Opponent Dragon"
                : "Usable",
          );
          expect(action.image).toBe(
            isOwner ? "/phoenix.png" : opponentReskinned ? "/dragon.png" : "",
          );
          expect(action.battleDescription).toBe(
            isOwner
              ? "Owner casts Phoenix"
              : opponentReskinned
                ? "Opponent casts Dragon"
                : "Usable",
          );
        }
      }
    },
  );

  it.each(["RANKED_PVP", "RANKED_SPARRING"] as const)(
    "%s keeps mastery-gated worn gear despite another item's mastery penalty, but disables broken gear",
    async (battleType) => {
      const { raw, essentials } = await seedLobby(true);
      const armor = raw.items[0]!;
      const gated = {
        ...armor,
        id: "gated-armor",
        equipped: "ITEM_1" as const,
        item: {
          ...armor.item,
          id: "gated-armor",
          inShop: true,
          effects: [],
          requiredNinjutsuMastery: RANKED_PVP_STATS.ninjutsuMastery,
        },
      };
      const penalty = {
        ...armor,
        id: "penalty-armor",
        equipped: "ITEM_1" as const,
        item: {
          ...armor.item,
          id: "penalty-armor",
          inShop: true,
          effects: [
            getTagSchema("decreasemastery").parse({
              masteryTypes: ["Ninjutsu"],
              power: 100,
              powerPerLevel: 0,
              calculation: "static",
              rounds: 10,
            }),
          ],
        },
      };
      const broken = { ...gated, id: "broken-armor", durability: 0 };
      // Ranked's item validator accepts these shop items, and forced loadouts equip them in ITEM_1.
      expect(validateItemLoadout([gated.item, penalty.item]).check).toBe(true);
      manuallyAssignUserStats(raw, RANKED_PVP_STATS);
      raw.items = [gated, penalty, broken];
      const result = await preloadLobby(
        await getTestDatabase(),
        [raw],
        essentials,
        battleType,
      );
      expect(result.usersState[0]).toMatchObject({
        level: MAX_PLAYER_LEVEL,
        offence: RANKED_PVP_STATS.offence,
        strength: RANKED_PVP_STATS.strength,
        maxHealth: calcHP(MAX_PLAYER_LEVEL),
        curHealth: calcHP(MAX_PLAYER_LEVEL),
        maxChakra: calcCP(MAX_PLAYER_LEVEL),
        curChakra: calcCP(MAX_PLAYER_LEVEL),
        maxStamina: calcSP(MAX_PLAYER_LEVEL),
        curStamina: calcSP(MAX_PLAYER_LEVEL),
      });
      const equipped = result.usersState[0]!.items;
      expect(equipped.find((ui) => ui.id === gated.id)?.equipped).toBe("ITEM_1");
      expect(equipped.find((ui) => ui.id === broken.id)?.equipped).toBe("NONE");
    },
  );

  it("keeps jutsu unlocked by an anchored gear chain during battle preparation", async () => {
    const { raw, essentials } = await seedLobby(true);
    const armor = raw.items[0]!;
    const helm = {
      ...armor,
      id: "owned-helm",
      equipped: "HEAD" as const,
      item: {
        ...armor.item,
        id: "helm",
        effects: armor.item.effects.map((tag) => ({ ...tag, power: 100 })),
      },
    };
    const chest = {
      ...armor,
      item: { ...armor.item, requiredNinjutsuMastery: 200 },
    };
    raw.items = [chest, helm];
    expect(effectiveMasteries(raw).ninjutsuMastery).toBe(600);
    expect(
      jutsuRequirementWarning(
        raw.jutsus[0]!.jutsu,
        raw as unknown as NonNullable<UserWithRelations>,
        raw.items,
      ),
    ).toBe("");
    const result = await preloadLobby(
      await getTestDatabase(),
      [raw],
      essentials,
      "COMBAT",
    );
    const actor = result.usersState[0]!;
    expect(actor.items.find((ui) => ui.id === chest.id)?.equipped).toBe("CHEST");
    expect(actor.items.find((ui) => ui.id === helm.id)?.equipped).toBe("HEAD");
    expect(actor.jutsus.map((uj) => uj.jutsuId)).toContain("gated");
    refreshMasteries(result.usersState, result.userEffects);
    expect(actor.ninjutsuMastery).toBe(600);
  });

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

  it.each(["COMBAT", "SPARRING"] as const)(
    "restores skipped jutsu after selecting required items in a %s lobby",
    async (battleType) => {
      await seedLobby();
      const db = await getTestDatabase();
      await db.update(battle).set({ battleType }).where(eq(battle.id, BATTLE));
      const caller = await callerFor(combatRouter, USER);
      expect(
        (
          await caller.updateCombatLoadout({
            battleId: BATTLE,
            jutsuLoadoutId: "new-jutsus",
          })
        ).success,
      ).toBe(true);
      expect(await equippedIds()).toEqual(["usable"]);
      expect(
        (
          await caller.updateCombatLoadout({
            battleId: BATTLE,
            itemLoadoutId: "with-armor",
          })
        ).success,
      ).toBe(true);
      expect(await equippedIds()).toEqual(["gated", "usable"]);
      const stored = await db.query.battle.findFirst({ where: eq(battle.id, BATTLE) });
      expect(
        stored?.usersState[0]?.jutsus.map((entry) => entry.jutsuId).sort(),
      ).toEqual(["gated", "usable"]);
    },
  );

  it("rejects an invalid jutsu loadout before persisting the item loadout", async () => {
    await seedLobby();
    const result = await (await callerFor(combatRouter, USER)).updateCombatLoadout({
      battleId: BATTLE,
      itemLoadoutId: "with-armor",
      jutsuLoadoutId: "missing-loadout",
    });
    expect(result.success).toBe(false);
    const db = await getTestDatabase();
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "owned-armor") }))
        ?.equipped,
    ).toBe("NONE");
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
