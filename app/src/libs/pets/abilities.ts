/** Shared loadout eligibility for the pet editor, mutations and battle initiation. */
import {
  PET_ABILITY_POWER_BUDGET_BONUS,
  PET_ABILITY_SLOTS_BY_RARITY,
  PET_JUTSU_POWER_COST_BY_RANK,
  PET_MIN_SKILL_POWER_COST,
  type UserRank,
} from "@/drizzle/constants";
import type { Jutsu, PetSpecies, SkillTree, UserPet } from "@/drizzle/schema";
import type { CombatQueryUserSkill } from "@/libs/combat/types";
import { getMaxPetRank, getPetLevel, getPetRank } from "@/libs/pets/progression";
import { hasRequiredRank } from "@/libs/rank";
import type { ZodAllTags } from "@/validators/combat";

/** Species rarity grants slots immediately; rank limits the combined ability power. */
export const getPetAbilityCapacity = (
  pet: Pick<UserPet, "rank"> & { species: Pick<PetSpecies, "rarity"> | null },
) => ({
  maxSlots: pet.species ? PET_ABILITY_SLOTS_BY_RARITY[pet.species.rarity] : 0,
  budget: pet.rank + PET_ABILITY_POWER_BUDGET_BONUS,
});

/** Ability-budget cost by jutsu rank; forbidden H-rank content cannot fit any budget. */
export const getPetJutsuCost = (jutsu: Pick<Jutsu, "jutsuRank">) =>
  PET_JUTSU_POWER_COST_BY_RANK[jutsu.jutsuRank];

/** Passive skills spend their tier from the same budget as active jutsus. */
export const getPetSkillCost = (skill: Pick<SkillTree, "tier">) =>
  Math.max(PET_MIN_SKILL_POWER_COST, skill.tier);

/** Catalog abilities may affect combatants without introducing new content dependencies. */
const activeEffects = new Set<ZodAllTags["type"]>([
  "damage",
  "elementaldamage",
  "heal",
  "shield",
  "increasestat",
  "decreasestat",
  "increasedamagegiven",
  "decreasedamagegiven",
  "increasedamagetaken",
  "decreasedamagetaken",
  "clear",
  "cleanse",
  "move",
]);
const passiveEffects = new Set<ZodAllTags["type"]>([
  "increasestat",
  "increasedamagegiven",
  "decreasedamagetaken",
  "increasemaxpools",
  "increaseaggro",
  "decreaseaggro",
]);
const masteryRequirements = [
  "requiredNinjutsuMastery",
  "requiredGenjutsuMastery",
  "requiredTaijutsuMastery",
  "requiredBukijutsuMastery",
  "requiredBloodlineMastery",
  "requiredSageMastery",
] as const;

/** Allowed pet jutsu that are unlocked for everyone or locked to this species. */
export const isPetJutsuAllowedForSpecies = (jutsu: Jutsu, speciesId?: string | null) =>
  isPetJutsuAllowed(jutsu) &&
  (!jutsu.requiredPetSpeciesId || jutsu.requiredPetSpeciesId === speciesId);

/** Pets have no inherited elements, equipment, bloodline, mastery unlocks or content grants. */
export const isPetJutsuAllowed = (jutsu: Jutsu) =>
  !jutsu.hidden &&
  !jutsu.injectableInBattle &&
  jutsu.jutsuType === "PETS" &&
  jutsu.battleUsageType !== "PVP" &&
  jutsu.jutsuRank !== "H" &&
  !jutsu.bloodlineId &&
  !jutsu.bloodlineReskinId &&
  !jutsu.reskinParentJutsuId &&
  !jutsu.villageId &&
  !jutsu.requiredSkillId &&
  !jutsu.requiredBloodlineItemId &&
  jutsu.jutsuWeapon === "NONE" &&
  (!jutsu.elementClassification || jutsu.elementClassification === "None") &&
  masteryRequirements.every((key) => !jutsu[key]) &&
  [
    jutsu.healthCost,
    jutsu.chakraCost,
    jutsu.staminaCost,
    jutsu.healthCostReducePerLvl,
    jutsu.chakraCostReducePerLvl,
    jutsu.staminaCostReducePerLvl,
    jutsu.range,
    jutsu.cooldown,
  ].every((value) => Number.isFinite(value) && value >= 0) &&
  Number.isFinite(jutsu.actionCostPerc) &&
  jutsu.actionCostPerc >= 10 &&
  jutsu.actionCostPerc <= 100 &&
  jutsu.effects.length > 0 &&
  jutsu.effects.every((effect) => isAllowedEffect(effect, activeEffects));

/** Only standalone, published self passives can be transferred to a companion. */
export const isPetSkillAllowed = (skill: SkillTree) =>
  !skill.hidden &&
  skill.pathType === "SKILL" &&
  skill.skillType === "DEFAULT" &&
  skill.target === "SELF" &&
  !skill.bloodlineId &&
  skill.requiredSkillIds.length === 0 &&
  Number.isInteger(skill.tier) &&
  skill.tier >= 1 &&
  skill.effects.length > 0 &&
  skill.effects.every(
    (effect) =>
      effect.target !== "COORDINATES" && isAllowedEffect(effect, passiveEffects),
  );

/**
 * Return the first player-facing loadout rejection, or null when valid.
 * The caller supplies the published companion catalogue and the owner's
 * purchased, activated skills; only those entries may be selected.
 * Species restrictions are checked here for both saved loadouts and battle selection.
 */
export const validatePetAbilities = ({
  pet,
  owner,
  jutsus,
  skills,
}: {
  pet: PetAbilityLoadout;
  owner: { rank: UserRank };
  jutsus: Jutsu[];
  skills: SkillTree[];
}): string | null => {
  if (
    !Number.isInteger(pet.rank) ||
    pet.rank < 1 ||
    pet.rank > getMaxPetRank(owner.rank)
  )
    return "Your rank does not support this pet's abilities.";
  const { maxSlots, budget } = getPetAbilityCapacity(pet);
  if (!pet.species) return "Your companion's species is unavailable.";
  if (
    new Set(pet.jutsuIds).size !== pet.jutsuIds.length ||
    new Set(pet.skillIds).size !== pet.skillIds.length
  )
    return "Equip each ability only once.";
  if (pet.jutsuIds.length + pet.skillIds.length > maxSlots)
    return "This loadout exceeds your companion's rarity-based ability slots.";
  let spent = 0;
  for (const id of pet.jutsuIds) {
    const jutsu = jutsus.find((entry) => entry.id === id);
    if (!jutsu) return "A selected companion jutsu is no longer available.";
    if (!isPetJutsuAllowed(jutsu)) return `${jutsu.name} is not compatible with pets.`;
    if (
      !hasRequiredRank(getPetRank(pet.rank).minUserRank, jutsu.requiredRank) ||
      jutsu.requiredLevel > getPetLevel(pet)
    )
      return `${jutsu.name} requires a higher pet rank or level.`;
    if (jutsu.requiredPetSpeciesId && jutsu.requiredPetSpeciesId !== pet.species.id)
      return `${jutsu.name} requires a different companion species.`;
    spent += getPetJutsuCost(jutsu);
  }
  for (const id of pet.skillIds) {
    const skill = skills.find((entry) => entry.id === id);
    if (!skill) return "A selected skill is no longer activated by your character.";
    if (!isPetSkillAllowed(skill)) return `${skill.name} is not compatible with pets.`;
    spent += getPetSkillCost(skill);
  }
  return spent > budget
    ? "This loadout exceeds your pet's ability power budget."
    : null;
};

/**
 * Revalidate against initiation's frozen catalogue, keeping usable choices
 * when other content became unavailable. Saved jutsus take budget priority,
 * followed by skills; each rejected entry leaves room for later valid entries.
 */
export const selectPetBattleAbilities = ({
  pet,
  owner,
  jutsus,
  skills,
}: {
  pet: PetAbilityLoadout;
  owner: { rank: UserRank };
  jutsus: Jutsu[];
  skills: CombatQueryUserSkill[];
}) => {
  const selected = { ...pet, jutsuIds: [] as string[], skillIds: [] as string[] };
  const availableSkills = skills
    .filter((entry) => entry.activated)
    .map((entry) => entry.skill);
  for (const field of ["jutsuIds", "skillIds"] as const) {
    for (const id of pet[field]) {
      const candidate = { ...selected, [field]: [...selected[field], id] };
      if (
        !validatePetAbilities({
          pet: candidate,
          owner,
          jutsus,
          skills: availableSkills,
        })
      )
        selected[field].push(id);
    }
  }
  return {
    jutsus: selected.jutsuIds.flatMap((id) => {
      const entry = jutsus.find((row) => row.id === id);
      return entry ? [entry] : [];
    }),
    skills: selected.skillIds.flatMap((id) => {
      const entry = skills.find((row) => row.skillId === id && row.activated);
      return entry ? [entry] : [];
    }),
  };
};

/** Reject unsupported tags, invalid scaling and elemental dependencies before copying content. */
const isAllowedEffect = (effect: ZodAllTags, allowed: Set<ZodAllTags["type"]>) =>
  allowed.has(effect.type) &&
  Number.isFinite(effect.power) &&
  effect.power >= 0 &&
  Number.isFinite(effect.powerPerLevel) &&
  effect.powerPerLevel >= 0 &&
  (effect.calculation !== "percentage" || effect.power <= 100) &&
  (!("elements" in effect) || !effect.elements?.some((element) => element !== "None"));

/** Saved selections plus the progression and species fields needed for capacity and eligibility checks. */
export type PetAbilityLoadout = Pick<
  UserPet,
  "rank" | "experience" | "jutsuIds" | "skillIds"
> & { species: Pick<PetSpecies, "id" | "rarity"> | null };
