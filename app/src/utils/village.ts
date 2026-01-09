import { findVillageUserRelationship } from "@/utils/alliance";
import { calcIsInVillage } from "@/libs/travel";
import type { UserWithRelations } from "@/routers/profile";
import type { Village, VillageStructure, VillageAlliance } from "@/drizzle/schema";
import type { StructureRoute, SHRINE_BOOST_TYPE } from "@/drizzle/constants";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  FED_NORMAL_BANK_INTEREST,
  FED_SILVER_BANK_INTEREST,
  FED_GOLD_BANK_INTEREST,
  SHRINE_BOOST_BASE_PERC,
  SHRINE_BOOST_PER_SHRINE_PERC,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";

/**
 * Checks if a user can access a specific structure in a village.
 * @param userData - The user data.
 * @param structureName - The name of the structure to check access for.
 * @param sectorVillage - The sector village data, including relationships and structures.
 * @returns A boolean indicating whether the user can access the structure.
 */
export const canAccessStructure = (
  userData: NonNullable<UserWithRelations>,
  structureRoute?: StructureRoute,
  sectorVillage?:
    | (Village & {
        relationshipA: VillageAlliance[];
        relationshipB: VillageAlliance[];
        structures: VillageStructure[];
      })
    | null,
) => {
  let structureAccess = true;
  const ownVillage = userData?.village?.sector === sectorVillage?.sector;
  const safeZone = sectorVillage?.type === "SAFEZONE";
  if (structureRoute && sectorVillage) {
    const relationship = findVillageUserRelationship(
      sectorVillage,
      userData.villageId ?? "syndicate",
    );
    const isAlly = relationship?.status === "ALLY";
    const structure = sectorVillage?.structures.find((s) => s.route === structureRoute);
    const inVillage =
      calcIsInVillage({
        x: userData.longitude,
        y: userData.latitude,
      }) || sectorVillage.type === "SAFEZONE";
    if (
      !structure ||
      !inVillage ||
      (!ownVillage && !safeZone && (!isAlly || structure.allyAccess === 0))
    ) {
      structureAccess = false;
    }
  } else if (structureRoute && !sectorVillage) {
    structureAccess = false;
  }
  return structureAccess;
};

export type StructureAttribute =
  | "anbuSquadsPerLvl"
  | "arenaRewardPerLvl"
  | "bankInterestPerLvl"
  | "blackDiscountPerLvl"
  | "clansPerLvl"
  | "hospitalSpeedupPerLvl"
  | "itemDiscountPerLvl"
  | "patrolsPerLvl"
  | "ramenDiscountPerLvl"
  | "regenIncreasePerLvl"
  | "sleepRegenPerLvl"
  | "structureDiscountPerLvl"
  | "trainBoostPerLvl"
  | "villageDefencePerLvl";

/**
 * Calculates the effective level of a structure, including temporary bonuses from war victories.
 * @param structure - The village structure.
 * @returns The effective level including temporary bonus if not expired.
 */
export const getEffectiveStructureLevel = (structure: VillageStructure): number => {
  const now = new Date();
  const bonusExpiry = structure.temporaryLevelBonusExpiresAt;
  const bonusActive = bonusExpiry && new Date(bonusExpiry) > now;
  return structure.level + (bonusActive ? structure.temporaryLevelBonus : 0);
};

/**
 * Calculates the total boost for a given structure attribute in a village.
 * @param attribute - The attribute to calculate the boost for.
 * @param structures - An optional array of village structures.
 * @returns The total boost for the given attribute.
 */
export const getStrucBoost = (
  attribute: StructureAttribute,
  structures?: VillageStructure[],
) => {
  return (
    structures?.reduce((a, b) => a + b[attribute] * getEffectiveStructureLevel(b), 0) ??
    0
  );
};

/**
 * Calculates the boost factor for a given shrine boost type.
 * Uses base boost of 10% with 1+ shrines, plus ~3.33% per additional shrine
 * for a range of 10% (1 shrine) to 20% (4 shrines).
 * @param village - The village to calculate the boost for.
 * @param sectors - The number of sectors in the village.
 * @param boostType - The type of boost to calculate.
 * @returns The boost factor for the given shrine boost type.
 */
export const getShrineBoost = (
  sectors: number,
  boostType: SHRINE_BOOST_TYPE,
  village?: Village | null,
) => {
  const now = new Date();
  const shrineBoost = village?.shrineSettings?.activeBoosts?.[boostType];
  const expiry = shrineBoost ? new Date(shrineBoost) : now;
  if (expiry < now) return 0;
  if (!shrineBoost || sectors <= 0) return 0;
  // Base 10% with 1+ shrines, plus ~3.33% per additional shrine (10-20% range)
  const boostPercentage =
    SHRINE_BOOST_BASE_PERC + (sectors - 1) * SHRINE_BOOST_PER_SHRINE_PERC;
  return boostPercentage / 100;
};

/**
 * Calculates the bank interest rate based on the boost value. Boost value is
 * the sum of all bank interest boosts from village structures multiplied by the
 * level of the structure.
 *
 * @param boost - The boost value to calculate the interest rate.
 * @returns The calculated bank interest rate.
 */
export const calcBankInterest = (boost: number, user?: UserData) => {
  const baseFactor = boost > 1 ? 1 + (boost - 1) * 0.1 : 1;
  if (!user) return baseFactor;
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return baseFactor + FED_NORMAL_BANK_INTEREST / 100;
    case "SILVER":
      return baseFactor + FED_SILVER_BANK_INTEREST / 100;
    case "GOLD":
      return baseFactor + FED_GOLD_BANK_INTEREST / 100;
  }
  return baseFactor;
};

/**
 * Calculates the cost of upgrading a village structure.
 *
 * @param structure - The village structure to upgrade.
 * @returns The cost of upgrading the structure in village funds
 */
export const calcStructureUpgrade = (
  structure: VillageStructure,
  village: Village & { structures: VillageStructure[] },
) => {
  // Base cost (uses base level, not effective level - upgrades are based on permanent level)
  const cost = Math.floor(structure.baseCost * (structure.level + 1));
  // Village tax
  const population = village.populationCount;
  const hundredsOver200 = Math.max(Math.floor((population - 200) / 100), 0);
  const taxPerc = Math.min(hundredsOver200 * 0.05, 0.25);
  const tax = Math.floor(cost * taxPerc);
  const subTotal = cost + tax;
  // Discount (uses effective level for benefits)
  const townHall = village?.structures.find((s) => s.name === "Town Hall");
  const discountLevel = !!townHall
    ? getEffectiveStructureLevel(townHall) * townHall?.structureDiscountPerLvl
    : 1;
  const discount = Math.floor(subTotal * (0 + discountLevel / 100));
  // Return result & infor on calculation
  return { cost, tax, discount, total: subTotal - discount };
};
