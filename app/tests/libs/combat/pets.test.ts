import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { BattleTypes, COMBAT_ENMITY_PER_DAMAGE, PET_BASE_STAT, PET_BATTLE_CONFIG } from "@/drizzle/constants";
import type { AiProfile, UserPet } from "@/drizzle/schema";
import { availableUserActions, insertAction } from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import { addPetsToBattle, getPetSpawnLocation, petsAllowedInBattle } from "@/libs/combat/pets";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, CombatQueryUser, ReturnedBattle } from "@/libs/combat/types";
import { hasLiveSummon, isClone, spliceOrphanedSummons } from "@/libs/combat/summon";
import { applyPoolAdjustmentsToBase, getBattleGrid, getTurnControl, resolveDamageCreditUser } from "@/libs/combat/util";
import { TerrainHex } from "@/libs/hexgrid";
import { processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeBattleUser, makeBattleUserItem, makeCompleteBattle, makeEffect } from "./helpers/battleScenario";
import { AiRule } from "@/validators/ai";
import { BarrierTag, CloneTag, DamageTag, IncreaseMaxPoolsTag, InjectJutsusTag, IncreaseStatTag, DecreaseStatTag, MoveTag, PoisonTag, ShieldTag, SummonTag, VisualTag } from "@/validators/combat";
import { updatePetAiSchema } from "@/validators/pets";
import { ownedPetSkill, petJutsuFixture, petSkillFixture } from "../pets/helpers/abilities";
import { petSpeciesFixture } from "../pets/helpers/species";

type BattlePet = Parameters<typeof addPetsToBattle>[0]["pets"][number];
const petFixture = (patch: Partial<BattlePet> = {}): BattlePet => ({
  id: "pet-1", userId: "owner", name: "Nami", rank: 1, experience: 1000,
  storedExperience: 0, lastFedAt: null, species: petSpeciesFixture(), jutsuIds: [], skillIds: [],
  speciesId: "pet-species-0", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, gender: null,
  offence: 50, defence: 40, strength: 30, intelligence: 20, willpower: 10, speed: 25,
  avatar: "https://example.com/pet.png", avatarFacing: "left",
  battleEnabled: true, spawnPosition: "BEHIND", aiRules: [], includeDefaultRules: true,
  generationStatus: "READY", generationToken: null, generationStartedAt: null,
  generationAttempts: 0,
  artRank: 1, revision: 0, createdAt: new Date(), updatedAt: new Date(), ...patch,
});
const scenario = () => makeCompleteBattle({
  battleType: "QUEST", width: 13, height: 9, version: 1,
  createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(),
  usersState: [
    makeBattleUser("owner", {
      isAi: false, activePetId: "pet-1", direction: "left", rank: "GENIN", longitude: 3, latitude: 3,
      bloodlineId: "bloodline", sageModeId: "sage", sageModeActivated: true,
      medicalExperience: 100000, isAutoCombat: true, elementalMastery: { Fire: 100 },
      activeSkillIds: ["skill"], items: [makeBattleUserItem()],
      effects: [makeEffect("damage")],
    }),
    makeBattleUser("enemy", {
      isAi: true, direction: "right", rank: "GENIN", longitude: 10, latitude: 3,
    }),
  ],
  extraState: {
    aiProfiles: {}, jutsus: {}, items: {}, bloodlines: {}, sageModes: {},
    villages: {}, anbuSquads: {}, clans: {}, wars: {}, relations: {},
    userQuests: {}, completedQuests: {}, questData: {}, bounties: {}, bountySignups: {},
  },
});
const add = (battle: ReturnType<typeof scenario>, pets = [petFixture()]) =>
  addPetsToBattle({ ...battle, pets });

describe("owned pets in combat", () => {
  let previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
  beforeEach(() => {
    previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
    PET_BATTLE_CONFIG.enabled = true;
  });
  afterEach(() => {
    PET_BATTLE_CONFIG.enabled = previousBattleEnabled;
  });

  it("spawns both selected solo dungeon pets with independent actors and distinct cells", () => {
    const battle = scenario();
    addPetsToBattle({ ...battle, pets: [petFixture(), petFixture({ id: "pet-2" }), petFixture({ id: "pet-3" })], selectedPetIdsByOwner: { owner: ["pet-1", "pet-2"] } });
    const pets = battle.usersState.filter((user) => user.petId);
    expect(pets.map((pet) => pet.petId)).toEqual(["pet-1", "pet-2"]);
    expect(new Set(pets.map((pet) => `${pet.longitude},${pet.latitude}`)).size).toBe(2);
    expect(pets.every((pet) => pet.isAi && pet.isSummon && pet.controllerId === "owner")).toBe(true);
    expect(pets[0]?.aiProfileId).not.toBe(pets[1]?.aiProfileId);
  });

  it.each(["left", "right"] as const)("preloads %s-facing source art for the shared AI combat renderer", (avatarFacing) => {
    const battle = scenario();
    add(battle, [petFixture({ avatarFacing })]);
    expect(battle.usersState.find((user) => user.petId === "pet-1")?.avatarFacing).toBe(avatarFacing);
  });

  it("uses the species damage preference independently of its owner", () => {
    const battle = scenario();
    battle.usersState[0]!.preferredDamageElement = "Wind";
    add(battle, [petFixture({ species: petSpeciesFixture({ preferredDamageElement: "Water" }) })]);
    expect(battle.usersState.find(user => user.petId === "pet-1")?.preferredDamageElement).toBe("Water");
  });

  it.each([...BattleTypes])("excludes pets, abilities and settlement identities from %s while companion battles are disabled", (battleType) => {
    PET_BATTLE_CONFIG.enabled = false;
    const battle = scenario();
    battle.battleType = battleType;
    battle.extraState.petIdsByOwner = { owner: "previous-pet" };
    const originalUsers = structuredClone(battle.usersState);
    const originalEffects = structuredClone(battle.usersEffects);
    const jutsu = petJutsuFixture();
    const skill = ownedPetSkill(petSkillFixture());
    addPetsToBattle({ ...battle,
      pets: [petFixture({ jutsuIds: [jutsu.id], skillIds: [skill.skillId] })],
      abilitiesByOwner: { owner: { jutsus: [jutsu], skills: [skill] } },
    });
    expect(petsAllowedInBattle(battleType)).toBe(false);
    expect(battle.usersState).toEqual(originalUsers);
    expect(battle.usersEffects).toEqual(originalEffects);
    expect(battle.extraState.petIdsByOwner).toEqual({});
    expect(battle.extraState.aiProfiles).toEqual({});
    expect(battle.extraState.jutsus).toEqual({});
  });

  it("uses pet progression and a distinct identity without inheriting the owner's abilities", () => {
    const battle = scenario();
    add(battle);
    const actor = battle.usersState.find((u) => u.petId === "pet-1");
    expect(actor).toBeDefined();
    expect(actor).toMatchObject({
      controllerId: "owner", username: "Nami", isAi: true, isSummon: true,
      isOriginal: true, isPiloted: false, isAutoCombat: false,
      offence: 50, strength: 30, bloodlineId: null, sageModeId: null,
      sageModeActivated: false, medicalExperience: 0,
      ninjutsuMastery: PET_BASE_STAT, jutsus: [], items: [], effects: [], activeSkillIds: [],
    });
    expect(actor?.userId).not.toBe("owner");
    expect(actor?.level).toBeLessThanOrEqual(5);
    expect(battle.extraState.petIdsByOwner).toEqual({ owner: "pet-1" });
    expect(battle.usersState[0]?.items).toHaveLength(1);
    expect(getTurnControl(actor!, "owner")).toEqual({ isUserTurn: false, isAITurn: true });
    expect(resolveDamageCreditUser(battle.usersState, actor!)?.userId).toBe("owner");
    expect(hasLiveSummon(battle.usersState, "owner", [])).toBe(false);
  });

  it("starts with its own threat and credits pet damage threat separately from owner quest damage", () => {
    const battle = scenario();
    const owner = battle.usersState[0]!;
    owner.enmity = 300;
    add(battle);
    const actor = battle.usersState.find((u) => u.petId === "pet-1")!;
    expect(actor.enmity).toBe(0);
    expect(owner.enmity).toBe(300);
    const target = battle.usersState.find((u) => u.userId === "enemy")!;
    const initialHealth = target.curHealth;
    battle.usersEffects = [makeEffect("damage", {
      calculation: "static", power: 100, rounds: 0,
    }, {
      creatorId: actor.userId, targetId: target.userId, targetType: "user",
      isNew: true, createdRound: battle.round, fromType: "jutsu",
    })];
    const resolved = applyEffects(battle, actor.userId).newBattle;
    const healthLost = initialHealth - resolved.usersState.find((u) => u.userId === "enemy")!.curHealth;
    const resolvedOwner = resolved.usersState.find((u) => u.userId === "owner")!;
    const resolvedPet = resolved.usersState.find((u) => u.petId === "pet-1")!;
    expect(healthLost).toBeGreaterThan(0);
    expect(resolvedPet.enmity).toBe(healthLost * COMBAT_ENMITY_PER_DAMAGE);
    expect(resolvedOwner.enmity).toBe(300);
    expect(resolvedOwner.damageDealt).toBe(healthLost);
    expect(resolvedPet.damageDealt).toBe(0);
  });

  it("preloads published companion abilities at level one and applies only the pet's selected self passives", () => {
    const battle = scenario();
    battle.usersState[0]!.rank = "CHUNIN";
    const published = petJutsuFixture();
    const skill = ownedPetSkill();
    addPetsToBattle({ ...battle,
      pets: [petFixture({ rank: 4, artRank: 4, experience: 100000,
        jutsuIds: [published.id], skillIds: [skill.skillId] })],
      abilitiesByOwner: { owner: { jutsus: [published], skills: [skill] } },
    });
    const actor = battle.usersState.find((u) => u.petId)!;
    expect(actor.jutsus).toMatchObject([{ jutsuId: published.id, level: 1,
      originalCooldown: 1, lastUsedRound: -1, reskinId: null }]);
    expect(actor.jutsus[0]!.id).not.toBe(published.id);
    expect(battle.extraState.jutsus[published.id]).toEqual(published);
    expect(actor.activeSkillIds).toEqual([skill.skillId]);
    expect(battle.usersEffects.filter((effect) => effect.fromType === "skill"))
      .toMatchObject([{ creatorId: actor.userId, targetId: actor.userId, actionId: skill.skillId }]);
    const ownerStrength = battle.usersState[0]!.strength;
    const resolved = applyEffects(battle, actor.userId).newBattle;
    expect(actor.strength).toBeGreaterThan(30);
    expect(resolved.usersState.find((u) => u.petId)!.strength).toBe(30);
    expect(resolved.usersState.find((u) => u.userId === "owner")!.strength).toBe(ownerStrength);
  });

  it("executes a selected pet jutsu autonomously from the frozen catalog", () => {
    const battle = scenario();
    battle.usersState[1]!.longitude = 4;
    addPetsToBattle({ ...battle,
      pets: [petFixture({ jutsuIds: ["pet-strike"], includeDefaultRules: false,
        aiRules: [AiRule.parse({ conditions: [], action: {
          type: "use_specific_jutsu", jutsuId: "pet-strike", target: "CLOSEST_OPPONENT",
        } })] })],
      abilitiesByOwner: { owner: { jutsus: [petJutsuFixture()], skills: [] } },
    });
    const actor = battle.usersState.find((u) => u.petId)!;
    const grid = new Grid(TerrainHex, rectangle({ width: 13, height: 9 }))
      .map((tile) => { tile.cost = 1; return tile; });
    const before = battle.usersState[1]!.curHealth;
    const result = performAIaction(battle, grid, actor.userId);
    expect(result.nextActionId).toBe("pet-strike");
    expect(result.nextBattle.usersState.find((u) => u.userId === "enemy")!.curHealth).toBeLessThan(before);
    expect(result.nextBattle.usersState.find((u) => u.petId)!.jutsus[0]!.lastUsedRound).toBe(battle.round);
  });

  it.each(["COMBAT", "RANKED_PVP"] as const)("separates stale and injected companion actions from every other actor in %s", (battleType) => {
    const battle = scenario();
    const jutsu = petJutsuFixture();
    battle.extraState.jutsus[jutsu.id] = jutsu;
    battle.battleType = battleType;
    for (const patch of [
      { isAi: false }, { isAi: true }, { isAi: true, isSummon: true },
    ]) {
      const actor = battle.usersState[0]!;
      Object.assign(actor, patch);
      actor.jutsus = [{ id: "stale", jutsuId: jutsu.id, level: 1, experience: 0,
        equipped: true, lastUsedRound: -1, originalCooldown: 1, reskinId: null, origin: "user" }];
      expect(availableUserActions(battle, actor.userId).some((action) => action.id === jutsu.id)).toBe(false);
      actor.jutsus = [];
      battle.usersEffects = [makeEffect("injectjutsus", InjectJutsusTag.parse({ jutsuIds: [jutsu.id] }), {
        creatorId: actor.userId, targetId: actor.userId, createdRound: battle.round, rounds: 10,
      })];
      expect(availableUserActions(battle, actor.userId).some((action) => action.id === jutsu.id)).toBe(false);
      expect(actor.jutsus).toMatchObject([{ jutsuId: jutsu.id, origin: "injected" }]);
    }
  });

  it.each(["COMBAT", "RANKED_PVP"] as const)("drops companion jutsu from player, AI and summon loadouts at %s initiation", async (battleType) => {
    const jutsu = petJutsuFixture();
    for (const isAi of [false, true]) {
      for (const isSummon of [false, true]) {
        const caster = { ...makeBattleUser("owner", { isAi, rank: "JONIN" }),
          regeneration: 0, regenAt: new Date(), money: 0, bloodright: [],
          effects: [], userSkills: [], items: [],
          jutsus: [{ id: "owned", userId: "owner", jutsuId: jutsu.id, jutsu,
            createdAt: new Date(0), updatedAt: new Date(0), level: 1, experience: 0,
            equipped: true, finishTraining: null, reskinId: null }],
        } as unknown as CombatQueryUser;
        const processed = await processUsersForBattle({} as DrizzleClient, {
          users: [caster], battleType, leftSideUserIds: ["owner"], hide: false, isSummon,
          width: 13, height: 9, settings: [], relations: [], wars: [], villages: [],
          defaultProfile: { id: "Default" } as AiProfile,
        });
        expect(processed.usersState[0]!.jutsus).toEqual([]);
        expect(processed.extraState.jutsus[jutsu.id]).toBeUndefined();
      }
    }
  });

  it("does not offer ordinary jutsu to a companion from a stale or injected loadout", () => {
    const battle = scenario();
    add(battle);
    const actor = battle.usersState.find((user) => user.petId)!;
    const jutsu = petJutsuFixture({ jutsuType: "NORMAL" });
    battle.extraState.jutsus[jutsu.id] = jutsu;
    actor.jutsus = [{ id: "stale", jutsuId: jutsu.id, level: 1, experience: 0,
      equipped: true, lastUsedRound: -1, originalCooldown: 1, reskinId: null, origin: "user" }];
    expect(availableUserActions(battle, actor.userId).some((action) => action.id === jutsu.id)).toBe(false);
    actor.jutsus = [];
    battle.usersEffects = [makeEffect("injectjutsus", InjectJutsusTag.parse({ jutsuIds: [jutsu.id] }), {
      creatorId: actor.userId, targetId: actor.userId, createdRound: battle.round, rounds: 10,
    })];
    expect(availableUserActions(battle, actor.userId).some((action) => action.id === jutsu.id)).toBe(false);
    expect(actor.jutsus).toMatchObject([{ jutsuId: jutsu.id, origin: "injected" }]);
  });

  it("casts its selected self shield through a saved highest-power AI rule", () => {
    const battle = scenario();
    const savedAi = updatePetAiSchema.parse({
      petId: "pet-1", includeDefaultRules: false,
      rules: [AiRule.parse({ conditions: [], action: {
        type: "use_highest_power_action", effect: "shield", target: "SELF",
      } })],
    });
    const jutsu = petJutsuFixture({ id: "pet-guard", target: "SELF", range: 0,
      effects: [ShieldTag.parse({ calculation: "static", power: 100, health: 100 })],
    });
    addPetsToBattle({ ...battle,
      pets: [petFixture({ jutsuIds: [jutsu.id], aiRules: savedAi.rules,
        includeDefaultRules: savedAi.includeDefaultRules })],
      abilitiesByOwner: { owner: { jutsus: [jutsu], skills: [] } },
    });
    const actor = battle.usersState.find((user) => user.petId)!;
    const grid = new Grid(TerrainHex, rectangle({ width: 13, height: 9 }))
      .map((tile) => { tile.cost = 1; return tile; });
    const result = performAIaction(battle, grid, actor.userId);
    expect(result.nextActionId).toBe(jutsu.id);
    expect(result.nextBattle.usersEffects.filter((effect) => effect.type === "shield"))
      .toMatchObject([{ creatorId: actor.userId, targetId: actor.userId, health: 100 }]);
    expect(result.nextBattle.usersState.find((user) => user.petId)!.jutsus[0]!.lastUsedRound)
      .toBe(battle.round);
  });

  it("keeps the basic pet when selected abilities were removed, changed or belong to another owner", () => {
    const battle = scenario();
    const forbidden = petJutsuFixture({ effects: [SummonTag.parse({ aiId: "unloaded" })] });
    addPetsToBattle({ ...battle,
      pets: [petFixture({ jutsuIds: [forbidden.id], skillIds: ["pet-muscle"] })],
      abilitiesByOwner: { owner: { jutsus: [forbidden],
        skills: [ownedPetSkill(petSkillFixture(), "someone-else")] } },
    });
    const actor = battle.usersState.find((u) => u.petId)!;
    expect(actor.jutsus).toEqual([]);
    expect(actor.activeSkillIds).toEqual([]);
    expect(actor.basicActions.length).toBeGreaterThan(0);
    expect(battle.extraState.petIdsByOwner).toEqual({ owner: "pet-1" });
    expect(battle.usersState.filter((u) => u.isSummon)).toHaveLength(1);
  });

  it("does not spawn more than one companion for an owner", () => {
    const battle = scenario();
    add(battle, [petFixture(), petFixture({ id: "inactive-pet" })]);
    expect(battle.usersState.filter((actor) => actor.petId)).toHaveLength(1);
    expect(battle.extraState.petIdsByOwner).toEqual({ owner: "pet-1" });
  });

  it("ignores a stale active-pet preload and spawns the owner's selected companion", () => {
    const battle = scenario();
    battle.usersState[0]!.activePetId = "selected-pet";
    add(battle, [petFixture(), petFixture({ id: "selected-pet" })]);
    expect(battle.usersState.filter((actor) => actor.petId).map((actor) => actor.petId))
      .toEqual(["selected-pet"]);
    expect(battle.extraState.petIdsByOwner).toEqual({ owner: "selected-pet" });
  });

  it("initializes selected pool passives without compounding or changing the owner's pools", () => {
    const battle = scenario();
    const skill = ownedPetSkill(petSkillFixture({ effects: [IncreaseMaxPoolsTag.parse({
      poolsAffected: ["Health"], calculation: "percentage", power: 20,
    })] }));
    addPetsToBattle({ ...battle, pets: [petFixture({ skillIds: [skill.skillId] })],
      abilitiesByOwner: { owner: { jutsus: [], skills: [skill] } },
    });
    const actor = battle.usersState.find((user) => user.petId)!;
    const originalHealth = actor.curHealth;
    const ownerHealth = battle.usersState[0]!.curHealth;
    applyPoolAdjustmentsToBase(actor, battle.usersEffects);
    expect(actor.curHealth).toBeGreaterThan(originalHealth);
    const adjustedHealth = actor.curHealth;
    applyPoolAdjustmentsToBase(actor, battle.usersEffects);
    expect(actor.curHealth).toBe(adjustedHealth);
    expect(battle.usersState[0]!.curHealth).toBe(ownerHealth);
  });

  it.each(["BEHIND", "FRONT", "LEFT", "RIGHT"] as const)(
    "allocates the %s relative position for either team", (position) => {
      for (const direction of ["left", "right"] as const) {
        const owner = { longitude: direction === "left" ? 3 : 9, latitude: 3, direction, curHealth: 100 };
        const location = getPetSpawnLocation(owner, position, [owner], 13, 9);
        const forward = direction === "left" ? 1 : -1;
        const expected = {
          BEHIND: { x: owner.longitude - forward, y: 3 },
          FRONT: { x: owner.longitude + forward, y: 3 },
          LEFT: { x: owner.longitude, y: 3 - forward },
          RIGHT: { x: owner.longitude, y: 3 + forward },
        }[position];
        expect(location).toEqual(expected);
      }
    },
  );

  it("falls back to an unoccupied team cell when the requested spot is occupied", () => {
    const battle = scenario();
    battle.usersState.push(makeBattleUser("ally", { direction: "left", longitude: 2, latitude: 3 }));
    add(battle);
    const actor = battle.usersState.find((u) => u.petId);
    expect(actor).toBeDefined();
    expect(battle.usersState.filter((u) => u.longitude === actor?.longitude && u.latitude === actor.latitude)).toHaveLength(1);
  });

  it.each([
    { battleEnabled: false }, { generationStatus: "PENDING" }, { artRank: 0 },
    { avatar: null }, { rank: 4, artRank: 4 },
  ] satisfies Partial<UserPet>[])("excludes an unavailable pet: %j", (patch) => {
    const battle = scenario();
    add(battle, [petFixture(patch)]);
    expect(battle.usersState).toHaveLength(2);
    expect(battle.extraState.petIdsByOwner).toEqual({});
  });

  it.each(["KAGE_AI", "CLAN_CHALLENGE", "RANKED_PVP", "RANKED_SPARRING"] as const)("preserves %s summon restrictions", (battleType) => {
    const battle = scenario(); battle.battleType = battleType;
    add(battle);
    expect(battle.usersState).toHaveLength(2);
    expect(battle.extraState.petIdsByOwner).toEqual({});
  });

  it("uses the owner's real rank when combat rank has been normalized", () => {
    const battle = scenario();
    battle.usersState[0]!.rank = "ELITE JONIN";
    addPetsToBattle({ ...battle, pets: [petFixture({ rank: 2, artRank: 2 })],
      ownerRanks: { owner: "STUDENT" } });
    expect(battle.usersState).toHaveLength(2);
    expect(battle.extraState.petIdsByOwner).toEqual({});
  });

  it.each(BattleTypes.filter((type) => type !== "QUEST"))("excludes pets and their innate bonuses from %s", (battleType) => {
    const battle = scenario(); battle.battleType = battleType;
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [ShieldTag.parse({})] }) })]);
    expect(battle.usersState).toHaveLength(2);
    expect(battle.usersEffects).toEqual([]);
    expect(battle.extraState.petIdsByOwner).toEqual({});
    expect(battle.extraState.enemySkills ?? {}).toEqual({});
  });

  it("prevents a frozen pet in a disallowed battle from attacking", () => {
    const battle = scenario(); add(battle);
    const actor = battle.usersState.find((user) => user.petId)!;
    battle.battleType = "COMBAT";
    expect(availableUserActions(battle, actor.userId).map((action) => action.id)).toEqual(["wait"]);
  });

  it("does not spawn or buff a companion while its accepted task is away", () => {
    const battle = scenario();
    battle.usersState[0]!.petTask = { petId: "pet-1", questId: "contract", questHistoryId: "attempt", startedAt: 1, questVersion: 1, finishesAt: 2 };
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [ShieldTag.parse({})] }) })]);
    expect(battle.usersState).toHaveLength(2);
    expect(battle.usersEffects).toEqual([]);
    expect(battle.extraState.petIdsByOwner).toEqual({});
  });

  it("freezes innate self bonuses for only the pet and its owner", () => {
    const battle = scenario();
    battle.usersState.push(makeBattleUser("ally", { direction: "left", longitude: 1, latitude: 1 }));
    const species = petSpeciesFixture({ effects: [IncreaseMaxPoolsTag.parse({ poolsAffected: ["Health"], calculation: "percentage", power: 20 })] });
    add(battle, [petFixture({ species })]);
    const actor = battle.usersState.find((user) => user.petId)!;
    const owner = battle.usersState[0]!;
    expect(battle.usersEffects.map((effect) => effect.targetId)).toEqual([owner.userId, actor.userId]);
    expect(battle.usersEffects.map((effect) => effect.creatorId)).toEqual([owner.userId, actor.userId]);
    Object.assign(species.effects[0]!, { power: 999 });
    expect(battle.usersEffects.every((effect) => "power" in effect && effect.power === 20)).toBe(true);
    const ownerHealth = owner.curHealth;
    const petHealth = actor.curHealth;
    applyPoolAdjustmentsToBase(owner, battle.usersEffects);
    applyPoolAdjustmentsToBase(actor, battle.usersEffects);
    expect(owner.curHealth).toBeGreaterThan(ownerHealth);
    expect(actor.curHealth).toBeGreaterThan(petHealth);
    expect(battle.usersEffects.some((effect) => effect.targetId === "ally")).toBe(false);
  });

  it("applies mixed innate targets once at initiation and never attaches them to actions", () => {
    const battle = scenario();
    battle.usersState[1]!.longitude = 4;
    battle.usersState.push(
      makeBattleUser("ally", { direction: "left", longitude: 1, latitude: 1 }),
      makeBattleUser("enemy-two", { direction: "right", longitude: 8, latitude: 1 }),
      makeBattleUser("template", { direction: "right", isSummonTemplate: true, curHealth: 0 }),
      makeBattleUser("defeated", { direction: "right", curHealth: 0 }),
      makeBattleUser("fled", { direction: "right", fledBattle: true }),
    );
    const species = petSpeciesFixture({ effects: [
      { ...IncreaseStatTag.parse({ generalTypes: ["Strength"], power: 30 }), skillTarget: "SELF" },
      { ...DecreaseStatTag.parse({ generalTypes: ["Strength"], power: 25 }), skillTarget: "ENEMIES" },
    ] });
    add(battle, [petFixture({ species })]);
    const actor = battle.usersState.find((user) => user.petId)!;
    const passives = battle.usersEffects.filter((effect) => effect.fromType === "skill");
    expect(passives).toHaveLength(4);
    expect(passives.filter((effect) => effect.type === "increasestat").map((effect) => effect.targetId))
      .toEqual(["owner", actor.userId]);
    expect(passives.filter((effect) => effect.type === "decreasestat").map((effect) => effect.targetId))
      .toEqual(["enemy", "enemy-two"]);
    expect(passives.every((effect) => !effect.isNew && !effect.castThisRound)).toBe(true);
    expect(battle.extraState.enemySkills ?? {}).toEqual({});
    expect(actor.enemySkillIds ?? []).toEqual([]);
    Object.assign(species.effects[1]!, { power: 999 });
    expect(passives.filter((effect) => effect.type === "decreasestat").every((effect) => effect.power === 25)).toBe(true);
    const action = { id: "basicAttack", name: "Attack", type: "basic", target: "OTHER_USER", method: "SINGLE", range: 5,
      battleDescription: "", healthCost: 0, chakraCost: 0, staminaCost: 0, actionCostPerc: 10,
      cooldown: 0, originalCooldown: 0, level: 1, effects: [DamageTag.parse({ power: 10 })] } as CombatAction;
    for (const actorId of ["owner", actor.userId, "owner", actor.userId]) {
      expect(insertAction({ battle, grid: getBattleGrid(20, battle), action, actorId, longitude: 4, latitude: 3 })).toBe(true);
    }
    expect(battle.usersEffects.filter((effect) => effect.fromType === "skill")).toEqual(passives);
    const resolved = applyEffects(battle, "owner");
    expect(resolved.actionEffects.some((effect) => /Strength.*(increased|decreased)/.test(effect.txt))).toBe(false);
    expect(battle.usersState.find((user) => user.userId === "enemy")!.strength).toBeLessThan(
      resolved.newBattle.usersState.find((user) => user.userId === "enemy")!.strength,
    );
  });

  it.each(["SELF", "ENEMIES"] as const)("respects friendly-fire filters for %s innate passives", (skillTarget) => {
    const battle = scenario();
    const matching = skillTarget === "SELF" ? "FRIENDLY" : "ENEMIES";
    const blocked = skillTarget === "SELF" ? "ENEMIES" : "FRIENDLY";
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [
      { ...IncreaseStatTag.parse({ power: 20, friendlyFire: matching }), skillTarget },
      { ...IncreaseStatTag.parse({ power: 99, friendlyFire: blocked }), skillTarget },
    ] }) })]);
    expect(battle.usersEffects).toHaveLength(skillTarget === "SELF" ? 2 : 1);
    expect(battle.usersEffects.every((effect) => effect.power === 20)).toBe(true);
  });

  it.each([false, true])("includes opposing companions independent of pet preload order (reversed=%s)", (reverse) => {
    const battle = scenario();
    Object.assign(battle.usersState[1]!, { isAi: false, activePetId: "enemy-pet" });
    const pets = [petFixture({ species: petSpeciesFixture({ effects: [
      { ...DecreaseStatTag.parse({}), skillTarget: "ENEMIES" },
    ] }) }), petFixture({ id: "enemy-pet", userId: "enemy" })];
    add(battle, reverse ? pets.reverse() : pets);
    const enemyPet = battle.usersState.find((user) => user.petId === "enemy-pet")!;
    expect(battle.usersEffects.map((effect) => effect.targetId)).toEqual(["enemy", enemyPet.userId]);
  });

  it.each([MoveTag.parse({}), SummonTag.parse({ aiId: "summoned-ai" }), CloneTag.parse({}), VisualTag.parse({})])("queues innate $type effects on the owner's and companion's cells", (effect) => {
    const battle = scenario();
    const species = petSpeciesFixture({ effects: [effect, ShieldTag.parse({})] });
    add(battle, [petFixture({ species })]);
    const actor = battle.usersState.find((user) => user.petId)!;
    expect(battle.groundEffects).toHaveLength(2);
    for (const [index, target] of [battle.usersState[0]!, actor].entries()) {
      expect(battle.groundEffects[index]).toMatchObject({
        type: effect.type, creatorId: target.userId, longitude: target.longitude,
        latitude: target.latitude, isNew: true, createdRound: battle.round, fromType: "skill",
      });
    }
    expect(battle.usersEffects.map((tag) => tag.type)).toEqual(["shield", "shield"]);
    expect(species.effects[0]).toEqual(effect);
  });

  it("executes innate summons once from their preloaded AI template", () => {
    const battle = scenario();
    battle.usersState.push(makeBattleUser("template", {
      isAi: true, isSummon: true, isSummonTemplate: true, controllerId: "summoned-ai",
      curHealth: 0, longitude: 0, latitude: 0, effects: [],
    }));
    add(battle, [petFixture({ species: petSpeciesFixture({
      effects: [SummonTag.parse({ aiId: "summoned-ai", aiHp: 500, power: 100 })],
    }) })]);
    const spawned = (state: typeof battle) => state.usersState.filter((user) => user.summonSourceId === "summoned-ai");
    const resolved = applyEffects(battle, "owner").newBattle;
    expect(spawned(resolved)).toHaveLength(2);
    expect(spawned(resolved).every((user) => user.curHealth === 500 && user.direction === "left")).toBe(true);
    expect(spawned(applyEffects(resolved, "owner").newBattle)).toHaveLength(2);
  });

  it.each(["SELF", "ENEMIES"] as const)("places %s innate clones and summons on distinct empty cells", (skillTarget) => {
    for (const tag of [CloneTag.parse({ power: 100 }), SummonTag.parse({ aiId: "summoned-ai", power: 100 })]) {
      const battle = scenario();
      battle.usersState[1]!.longitude = 4;
      battle.usersState.push(makeBattleUser("template", {
        isAi: true, isSummon: true, isSummonTemplate: true, controllerId: "summoned-ai", curHealth: 0, effects: [],
      }));
      battle.groundEffects.push({ ...makeEffect("barrier", BarrierTag.parse({ staticAssetPath: "barrier" }), {
        creatorId: "enemy", longitude: 3, latitude: 2, rounds: 3,
      }) });
      add(battle, [petFixture({ species: petSpeciesFixture({ effects: [tag, tag].map(effect => ({ ...effect, skillTarget })) }) })]);
      const pet = battle.usersState.find((user) => user.petId)!;
      if (skillTarget === "ENEMIES") {
        for (const actorId of ["owner", pet.userId]) {
          const action = availableUserActions(battle, actorId).find((action) => action.id === "basicAttack")!;
          action.range = 5;
          expect(insertAction({ battle, grid: getBattleGrid(20, battle), action, actorId, longitude: 4, latitude: 3 })).toBe(true);
        }
      }
      const resolved = applyEffects(battle, "owner").newBattle;
      const spawned = resolved.usersState.filter((user) => isClone(user) || user.summonSourceId === "summoned-ai");
      expect(spawned).toHaveLength(skillTarget === "SELF" ? tag.type === "clone" ? 4 : 2 : tag.type === "clone" ? 2 : 1);
      const living = resolved.usersState.filter((user) => user.curHealth > 0);
      expect(new Set(living.map((user) => `${user.longitude},${user.latitude}`)).size).toBe(living.length);
      expect(spawned.some((user) => user.longitude === 3 && user.latitude === 2)).toBe(false);
      expect(resolved.usersState.find((user) => user.userId === "owner")).toMatchObject({ longitude: 3, latitude: 3 });
      expect(resolved.usersState.find((user) => user.petId)).toMatchObject({ longitude: 2, latitude: 3 });
      const attack = availableUserActions(resolved, "enemy").find((action) => action.id === "basicAttack")!;
      Object.assign(attack, { target: "OPPONENT", range: 20, actionCostPerc: 1 });
      for (const target of living.filter((user) => user.direction === "left")) {
        expect(insertAction({ battle: resolved, grid: getBattleGrid(20, resolved), action: attack, actorId: "enemy", longitude: target.longitude, latitude: target.latitude })).toBe(true);
      }
    }
  });

  it("omits innate spawns when every battlefield cell is occupied", () => {
    const battle = scenario();
    battle.width = 3; battle.height = 1;
    Object.assign(battle.usersState[0]!, { longitude: 0, latitude: 0 });
    Object.assign(battle.usersState[1]!, { longitude: 2, latitude: 0 });
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [CloneTag.parse({})] }) })]);
    expect(battle.usersState).toHaveLength(3);
    const resolved = applyEffects(battle, "owner").newBattle;
    expect(resolved.usersState).toHaveLength(3);
    expect(resolved.groundEffects.some((effect) => effect.type === "clone")).toBe(false);
  });

  it.each(["SELF", "ENEMIES"] as const)("keeps enemies targetable when a saved %s innate skill contains movement", (skillTarget) => {
    const battle = scenario();
    battle.usersState[1]!.longitude = 4;
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [{ ...MoveTag.parse({}), skillTarget }] }) })]);
    battle.usersState[0]!.latitude = 4;
    const action = availableUserActions(battle, "owner").find((action) => action.id === "basicAttack")!;
    action.actionCostPerc = 10;
    action.range = 5;
    const cast = (state: typeof battle) => insertAction({ battle: state, grid: getBattleGrid(20, state), action, actorId: "owner", longitude: 4, latitude: 3 });
    expect(cast(battle)).toBe(true);
    const resolved = applyEffects(battle, "owner").newBattle;
    expect(resolved.usersState.find((user) => user.userId === "owner")).toMatchObject({ longitude: 3, latitude: 4 });
    expect(cast(resolved)).toBe(true);
  });

  it.each([null, "pet-species-0", "other-species"])("checks species restrictions on injected pet jutsu requiring %s", (requiredPetSpeciesId) => {
    const battle = scenario();
    battle.usersState[1]!.longitude = 4;
    const jutsu = petJutsuFixture({ requiredPetSpeciesId, injectableInBattle: true });
    battle.extraState.jutsus[jutsu.id] = jutsu;
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [InjectJutsusTag.parse({ jutsuIds: [jutsu.id] })] }) })]);
    const actor = battle.usersState.find((user) => user.petId)!;
    const action = availableUserActions(battle, actor.userId).find((action) => action.id === jutsu.id);
    expect(actor.jutsus).toMatchObject([{ jutsuId: jutsu.id, origin: "injected" }]);
    expect(Boolean(action)).toBe(requiredPetSpeciesId !== "other-species");
    if (action) expect(insertAction({ battle, grid: getBattleGrid(20, battle), action, actorId: actor.userId, longitude: 4, latitude: 3 })).toBe(true);
  });

  it("does not let clones recast their companion's innate passives", () => {
    const battle = scenario();
    battle.usersState[1]!.longitude = 4;
    battle.extraState.aiProfiles.Default = { id: "Default", userId: "owner", includeDefaultRules: false,
      rules: [AiRule.parse({ conditions: [], action: { type: "use_highest_power_action", effect: "damage", target: "CLOSEST_OPPONENT" } })] };
    add(battle, [petFixture({ species: petSpeciesFixture({ effects: [CloneTag.parse({ power: 100 }), PoisonTag.parse({ power: 1, rounds: 3 })].map(effect => ({ ...effect, skillTarget: "ENEMIES" })) }) })]);
    const action = availableUserActions(battle, "owner").find((action) => action.id === "basicAttack")!;
    expect(insertAction({ battle, grid: getBattleGrid(20, battle), action, actorId: "owner", longitude: 4, latitude: 3 })).toBe(true);
    const resolved = applyEffects(battle, "owner").newBattle;
    const clone = resolved.usersState.find(isClone)!;
    expect(clone).toBeDefined();
    // Keep the clone in attack range independently of its spawn position.
    Object.assign(clone, { longitude: 4, latitude: 2, actionPoints: 100 });
    const result = performAIaction(resolved, getBattleGrid(20, resolved), clone.userId);
    expect(result.nextActionId).toBe("basicAttack");
    expect(result.nextBattle.usersState.filter(isClone)).toHaveLength(1);
    expect(result.nextBattle.usersEffects.some((effect) => effect.type === "poison" && effect.creatorId === clone.userId)).toBe(false);
  });

  it.each(["SELF", "ENEMIES"] as const)("preloads species summons and returns %s effects from battle initiation", async (skillTarget) => {
    const participant = (id: string, isAi: boolean) => ({
      ...makeBattleUser(id, { isAi, rank: "GENIN", activePetId: isAi ? null : "pet-1" }),
      regeneration: 0, regenAt: new Date(), money: 0, bloodright: [],
      effects: [], userSkills: [], items: [], jutsus: [],
    }) as unknown as CombatQueryUser;
    const findMany = vi.fn(async () => [participant("summoned-ai", true)]);
    const processed = await processUsersForBattle({ query: { userData: { findMany } } } as unknown as DrizzleClient, {
      users: [participant("owner", false)], battleType: "QUEST", leftSideUserIds: ["owner"],
      hide: false, isSummon: false, width: 13, height: 9, settings: [], relations: [], wars: [], villages: [],
      defaultProfile: { id: "Default" } as AiProfile,
      petPreload: { pets: [petFixture({ species: petSpeciesFixture({
        effects: [{ ...SummonTag.parse({ aiId: "summoned-ai" }), skillTarget }],
      }) })] },
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(processed.usersState.find((user) => user.controllerId === "summoned-ai"))
      .toMatchObject({ isSummonTemplate: true, curHealth: 0 });
    expect(processed.groundEffects).toHaveLength(skillTarget === "SELF" ? 2 : 0);
    expect(processed.userEffects.some((effect) => effect.type === "summon")).toBe(false);
    if (skillTarget === "ENEMIES") {
      expect(processed.extraState.enemySkills ?? {}).toEqual({});
    }
  });

  it("uses the normal autonomous AI with preloaded basic actions", () => {
    const battle = scenario(); add(battle);
    const actor = battle.usersState.find((u) => u.petId)!;
    const start = { x: actor.longitude, y: actor.latitude };
    const grid = new Grid(TerrainHex, rectangle({ width: 13, height: 9 }))
      .map((tile) => { tile.cost = 1; return tile; });
    const { nextBattle } = performAIaction(battle, grid, actor.userId);
    const moved = nextBattle.usersState.find((u) => u.userId === actor.userId)!;
    expect(moved.curHealth).toBeGreaterThan(0);
    expect({ x: moved.longitude, y: moved.latitude }).not.toEqual(start);
  });

  it.each(["same-village", "opposing-village"])("default pet AI approaches opponents and spares its teammates in %s quest matches", (enemyVillage) => {
    const battle = scenario();
    battle.battleType = "QUEST";
    battle.width = 12; battle.height = 10;
    battle.usersState = [
      makeBattleUser("owner", { isAi: false, activePetId: "pet-1", rank: "ELITE JONIN", villageId: "same-village", clanId: "clan-1", direction: "left", longitude: 3, latitude: 3, initiative: 22 }),
      makeBattleUser("ally", { isAi: false, activePetId: "ally-pet", rank: "ELITE JONIN", villageId: "same-village", clanId: "clan-1", direction: "left", longitude: 4, latitude: 3, initiative: 20.9 }),
      makeBattleUser("enemy-1", { isAi: false, rank: "ELITE JONIN", villageId: enemyVillage, clanId: "clan-2", direction: "right", longitude: 9, latitude: 3, initiative: 19.8 }),
      makeBattleUser("enemy-2", { isAi: false, rank: "ELITE JONIN", villageId: enemyVillage, clanId: "clan-2", direction: "right", longitude: 9, latitude: 5, initiative: 18.7 }),
    ];
    add(battle, [petFixture({ spawnPosition: "FRONT" }), petFixture({ id: "ally-pet", userId: "ally", spawnPosition: "FRONT" })]);
    const actor = battle.usersState.find((u) => u.petId === "pet-1")!;
    expect(actor).toMatchObject({ controllerId: "owner", clanId: "clan-1", villageId: "same-village", direction: "left", longitude: 4, latitude: 2 });
    expect(battle.extraState.aiProfiles[actor.aiProfileId!]!).toMatchObject({ rules: [], includeDefaultRules: true });
    battle.usersState.sort((left, right) => right.initiative - left.initiative);
    battle.activeUserId = actor.userId;
    const grid = new Grid(TerrainHex, rectangle({ width: battle.width, height: battle.height }))
      .map((tile) => { tile.cost = 1; return tile; });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { nextBattle, nextActionId } = performAIaction(battle, grid, actor.userId);
      expect(nextActionId).toBe("move");
      const moved = nextBattle.usersState.find((u) => u.userId === actor.userId)!;
      expect(moved.longitude).toBeGreaterThan(actor.longitude);
      for (const teammate of battle.usersState.filter((u) => u.direction === "left")) {
        expect(nextBattle.usersState.find((u) => u.userId === teammate.userId)?.curHealth).toBe(teammate.curHealth);
      }
    } finally {
      random.mockRestore();
    }
  });

  it("retreats with its defeated owner while retaining the frozen settlement identity", () => {
    const battle = scenario(); add(battle);
    battle.usersState[0]!.curHealth = 0;
    expect(spliceOrphanedSummons(battle.usersState, []).map((u) => u.petId)).toEqual(["pet-1"]);
    expect(battle.usersState.some((u) => u.petId)).toBe(false);
    expect(battle.extraState.petIdsByOwner).toEqual({ owner: "pet-1" });
  });
});
