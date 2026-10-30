/** Materialize owned companions as self-contained AI actors during battle initiation. */
import { nanoid } from "nanoid";
import type { BattleType, PetSpawnPosition, UserRank } from "@/drizzle/constants";
import { CombatStatNames, PET_BASE_STAT, PET_BATTLE_CONFIG } from "@/drizzle/constants";
import type { Jutsu, PetSpecies, UserPet } from "@/drizzle/schema";
import { getDefaultBasicActions, stillInBattle } from "@/libs/combat/actions";
import { GenNames, GROUND_EFFECT_TAG_TYPES } from "@/libs/combat/constants";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { checkFriendlyFire } from "@/libs/combat/process";
import { realizeTag } from "@/libs/combat/tags";
import type {
  BattleUserState,
  CombatQueryUserSkill,
  ExtraState,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import { rollInitiative } from "@/libs/combat/util";
import { selectPetBattleAbilities } from "@/libs/pets/abilities";
import {
  canUsePet,
  getPetLevel,
  getPetRank,
  getPetStatCaps,
} from "@/libs/pets/progression";
import { calcCP, calcHP, calcSP } from "@/libs/profile";

/** Missions, events, stories, the pyramid and dungeons enter through quest PvE battles. */
export const petsAllowedInBattle = (battleType: BattleType) =>
  PET_BATTLE_CONFIG.enabled && PET_BATTLE_CONFIG.battleTypes.includes(battleType);

/**
 * Materialize each explicitly selected dungeon pet, or the ordinary active pet per owner.
 * Abilities, passives and AI rules are frozen here so later turns need no pet reads.
 * Species passives enter battle once, after all companions have joined their teams.
 * petIdsByOwner records only pets actually spawned, binding settlement XP to them.
 */
export const addPetsToBattle = (info: {
  pets: (UserPet & { species: PetSpecies | null })[];
  usersState: BattleUserState[];
  extraState: ExtraState;
  battleType: BattleType;
  width: number;
  height: number;
  ownerRanks?: Record<string, UserRank>;
  selectedPetIdsByOwner?: Record<string, string[]>;
  usersEffects?: UserEffect[];
  groundEffects?: GroundEffect[];
  abilitiesByOwner?: Record<
    string,
    {
      jutsus: Jutsu[];
      skills: CombatQueryUserSkill[];
    }
  >;
}) => {
  const { pets, usersState, extraState, battleType, width, height, ownerRanks } = info;
  extraState.petIdsByOwner = {};
  if (!petsAllowedInBattle(battleType)) return;
  const bonds: {
    owner: BattleUserState;
    actor: BattleUserState;
    species: PetSpecies;
    sourceId: string;
  }[] = [];
  for (const pet of pets) {
    const selected = info.selectedPetIdsByOwner?.[pet.userId];
    if (selected ? !selected.includes(pet.id) : extraState.petIdsByOwner[pet.userId])
      continue;
    const owner = usersState.find((u) => u.userId === pet.userId && !u.isAi);
    // Some modes normalize combat rank; eligibility uses the real preloaded rank.
    if (
      !owner ||
      !pet.species ||
      owner.petTask?.petId === pet.id ||
      (!selected && owner.activePetId !== pet.id) ||
      !canUsePet(pet, { rank: ownerRanks?.[owner.userId] ?? owner.rank })
    )
      continue;
    const location = getPetSpawnLocation(
      owner,
      pet.spawnPosition,
      usersState,
      width,
      height,
    );
    // A crowded team must not overlap combatants or prevent the owner's fight.
    if (!location) continue;
    const actor = createPetBattleUser(pet, owner, location);
    const content = info.abilitiesByOwner?.[owner.userId];
    if (content) {
      const selected = selectPetBattleAbilities({
        pet,
        owner: { rank: ownerRanks?.[owner.userId] ?? owner.rank },
        jutsus: content.jutsus,
        skills: content.skills.filter((entry) => entry.userId === owner.userId),
      });
      actor.jutsus = selected.jutsus.map((jutsu) => {
        extraState.jutsus[jutsu.id] ??= structuredClone(jutsu);
        return {
          id: `pet:${pet.id}:jutsu:${jutsu.id}`,
          jutsuId: jutsu.id,
          level: 1,
          experience: 0,
          equipped: true,
          reskinId: null,
          lastUsedRound: -jutsu.cooldown,
          originalCooldown: jutsu.cooldown,
          origin: "user",
        };
      });
      if (info.usersEffects) {
        actor.activeSkillIds = selected.skills.map((entry) => entry.skillId);
        for (const { skill } of selected.skills) {
          for (const effect of skill.effects) {
            const realized = realizeTag({
              tag: structuredClone(effect) as UserEffect,
              user: actor,
              target: actor,
              actionId: skill.id,
              level: actor.level,
            });
            realized.isNew = false;
            realized.castThisRound = false;
            realized.targetId = actor.userId;
            realized.fromType = "skill";
            info.usersEffects.push(realized);
          }
        }
      }
    }
    bonds.push({
      owner,
      actor,
      species: pet.species,
      sourceId: `pet:${pet.id}:species`,
    });
    actor.initiative = rollInitiative(actor, usersState);
    const aiProfileId = `pet:${pet.id}`;
    extraState.aiProfiles[aiProfileId] = {
      id: aiProfileId,
      userId: owner.userId,
      rules: structuredClone(pet.aiRules),
      includeDefaultRules: pet.includeDefaultRules,
    };
    extraState.petIdsByOwner[owner.userId] ??= pet.id;
    usersState.push(actor);
  }
  // Resolve enemies after spawning every companion, so opposing pets receive the same passives.
  for (const { owner, actor, species, sourceId } of bonds) {
    for (const { skillTarget = "SELF", ...effect } of species.effects) {
      const targets =
        skillTarget === "SELF"
          ? [owner, actor]
          : usersState.filter(
              (target) =>
                !target.isSummonTemplate &&
                stillInBattle(target) &&
                target.direction !== owner.direction,
            );
      for (const target of targets) {
        // Self passives use each recipient's stats; enemy passives use the companion as caster.
        const creator = skillTarget === "SELF" ? target : actor;
        const realized = realizeTag({
          tag: structuredClone(effect) as UserEffect,
          user: creator,
          target,
          actionId: sourceId,
          level: creator.level,
        });
        realized.fromType = "skill";
        if (!checkFriendlyFire(realized, target, usersState)) continue;
        if (GROUND_EFFECT_TAG_TYPES.has(effect.type)) {
          realized.longitude = target.longitude;
          realized.latitude = target.latitude;
          // Battles start at round one; summons/clones must cast on first processing.
          realized.createdRound = 1;
          info.groundEffects?.push(realized);
        } else {
          // These passives are already active; action processing must not recast them.
          realized.isNew = false;
          realized.castThisRound = false;
          realized.targetId = target.userId;
          info.usersEffects?.push(realized);
        }
      }
    }
  }
};

/**
 * Find the nearest unoccupied cell to the owner's preferred relative position,
 * constrained to the owner's half of the grid. Return undefined if that half is full;
 * defeated actors do not occupy cells and equal-distance ties keep grid order.
 */
export const getPetSpawnLocation = (
  owner: Pick<BattleUserState, "longitude" | "latitude" | "direction">,
  position: PetSpawnPosition,
  usersState: Pick<BattleUserState, "longitude" | "latitude" | "curHealth">[],
  width: number,
  height: number,
) => {
  const forward = owner.direction === "left" ? 1 : -1;
  const offset = {
    BEHIND: { x: -forward, y: 0 },
    FRONT: { x: forward, y: 0 },
    LEFT: { x: 0, y: -forward },
    RIGHT: { x: 0, y: forward },
  }[position];
  const desired = { x: owner.longitude + offset.x, y: owner.latitude + offset.y };
  // Pet offsets may fall outside the narrower random starting columns. Every
  // grid cell is playable, so search the owner's half rather than those columns.
  const halfWidth = Math.floor(width / 2);
  const locations: { x: number; y: number }[] = [];
  const minX = owner.direction === "left" ? 0 : halfWidth + 1;
  const maxX = owner.direction === "left" ? halfWidth : width - 1;
  for (let x = minX; x <= maxX; x++) {
    for (let y = 0; y < height; y++) locations.push({ x, y });
  }
  return locations
    .filter(
      (location) =>
        !usersState.some(
          (u) =>
            u.curHealth > 0 && u.longitude === location.x && u.latitude === location.y,
        ),
    )
    .sort(
      (a, b) =>
        Math.abs(a.x - desired.x) +
        Math.abs(a.y - desired.y) -
        Math.abs(b.x - desired.x) -
        Math.abs(b.y - desired.y),
    )[0];
};

/** Build a fresh summon-like AI actor, retaining team context but replacing owner progression/loadout. */
const createPetBattleUser = (
  pet: UserPet & { species?: PetSpecies | null },
  owner: BattleUserState,
  location: { x: number; y: number },
): BattleUserState => {
  const level = getPetLevel(pet);
  const caps = getPetStatCaps(pet);
  // Reuse shared team/battle metadata from the owner, then clear personal powers,
  // economy and turn history so the pet acts only with its own stats and abilities.
  const actor: BattleUserState = {
    ...structuredClone(owner),
    // A battle-only actor ID keeps effects separate; petId identifies the saved companion.
    userId: nanoid(),
    controllerId: owner.userId,
    petId: pet.id,
    petSpeciesId: pet.speciesId,
    username: pet.name,
    avatar: pet.avatar,
    avatarLight: pet.avatar,
    avatarFacing: pet.avatarFacing,
    isAi: true,
    isSummon: true,
    isOriginal: true,
    isPiloted: false,
    isAutoCombat: false,
    isSummonTemplate: false,
    summonSourceId: `pet:${pet.id}`,
    rank: getPetRank(pet.rank).minUserRank,
    level,
    originalLevel: level,
    experience: pet.experience,
    earnedExperience: 0,
    petExperience: 0,
    longitude: location.x,
    latitude: location.y,
    originalLongitude: location.x,
    originalLatitude: location.y,
    curHealth: calcHP(level),
    maxHealth: calcHP(level),
    curStamina: calcSP(level),
    maxStamina: calcSP(level),
    curChakra: calcCP(level),
    maxChakra: calcCP(level),
    statsMultiplier: 1,
    poolsMultiplier: 1,
    money: 0,
    originalMoney: 0,
    medicalExperience: 0,
    sageMasteryExperience: 0,
    bloodlineId: null,
    bloodlineReskinId: null,
    bloodlineMastery: 0,
    sageModeId: null,
    sageMastery: 0,
    sageModeActivated: false,
    sageModeActivatedRound: null,
    sageModeExpiresRound: null,
    sageModeUsedThisBattle: false,
    primaryElement: null,
    preferredDamageElement: getPreferredDamageElement(pet.species ?? {}),
    secondaryElement: null,
    activeTrainedElement: null,
    elementalMastery: {},
    masteryRanks: {},
    bloodright: [],
    bloodrightSpent: 0,
    jutsus: [],
    items: [],
    basicActions: [],
    effects: [],
    enemySkillIds: [],
    activeSkillIds: [],
    skillLockedJutsuIds: [],
    keystoneItemId: null,
    keystoneName: null,
    jutsuLoadout: null,
    itemLoadout: null,
    preferredGeneral1: null,
    preferredGeneral2: null,
    baseStatsForModifiers: undefined,
    diffuseDamage: undefined,
    fledBattle: false,
    leftBattle: false,
    hidden: false,
    isAggressor: false,
    actionPoints: 100,
    round: 0,
    iAmHere: true,
    usedActions: [],
    usedTagTypes: [],
    usedMasteries: {},
    usedStats: { offence: 0, defence: 0 },
    usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
    damageDealt: 0,
    enmity: 0,
    moneyStolen: 0,
    pvpStreak: 0,
    stealthActive: false,
    aiProfileId: `pet:${pet.id}`,
    ninjutsuMastery: PET_BASE_STAT,
    genjutsuMastery: PET_BASE_STAT,
    taijutsuMastery: PET_BASE_STAT,
    bukijutsuMastery: PET_BASE_STAT,
  };
  for (const stat of CombatStatNames)
    actor[stat] = Math.min(
      pet[stat],
      stat === "offence" || stat === "defence" ? caps.stats_cap : caps.gens_cap,
    );
  actor.highestGenerals = GenNames.slice()
    .sort((a, b) => actor[b] - actor[a])
    .slice(0, 2);
  actor.basicActions = Object.values(getDefaultBasicActions(actor)).map((action) => ({
    id: action.id,
    lastUsedRound: action.lastUsedRound ?? -10,
  }));
  return actor;
};
