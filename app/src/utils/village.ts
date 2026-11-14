import type { SHRINE_BOOST_TYPE, StructureRoute } from "@/drizzle/constants";
import {
  BUILDING_UPGRADE_BASE_COST,
  BUILDING_UPGRADE_PER_LEVEL_COST,
  FACTION_RAID_BOOST_PERCENT,
  FED_BANK_INTEREST,
  SHRINE_BOOST_BASE_PERC,
  SHRINE_BOOST_PER_SHRINE_PERC,
  VILLAGE_MAINTAINED_STRUCTURE_ROUTES,
  VILLAGE_STRUCTURE_UPGRADE_BASE_COST,
  VILLAGE_STRUCTURE_UPGRADE_PER_LEVEL_COST,
} from "@/drizzle/constants";
import type {
  UserData,
  Village,
  VillageAlliance,
  VillageStructure,
} from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship } from "@/utils/alliance";
import { getUserFederalStatus } from "@/utils/paypal";

/** A village with the relations that sector and structure checks read. */
export type SectorVillage = Village & {
  relationshipA: VillageAlliance[];
  relationshipB: VillageAlliance[];
  structures: VillageStructure[];
};

/**
 * The player's own village while they stand in its sector, read from the user data that
 * `profile.getUser` already returned. It is the row `travel.getVillageInSector` resolves
 * for that sector, so the sidebar and structure checks need not wait for that request.
 * Outlaws get undefined: their sector village comes from a different lookup.
 * @param userData - The user data.
 * @returns The user's village, or undefined outside its sector.
 */
export const getOwnSectorVillage = (
  userData?: Pick<
    NonNullable<UserWithRelations>,
    "sector" | "isOutlaw" | "village"
  > | null,
): SectorVillage | undefined => {
  const village = userData?.village;
  if (!userData || userData.isOutlaw || village?.type !== "VILLAGE") return undefined;
  if (village.sector !== userData.sector) return undefined;
  if (!village.structures || !village.relationshipA || !village.relationshipB) {
    return undefined;
  }
  return village as SectorVillage;
};

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
  sectorVillage?: SectorVillage | null,
) => {
  if (!structureRoute) return true;
  if (!sectorVillage) return false;
  const structure = sectorVillage.structures.find((s) => s.route === structureRoute);
  if (!structure) return false;
  const ownVillage = userData.village?.sector === sectorVillage.sector;
  if (ownVillage || sectorVillage.type === "SAFEZONE") return true;
  const relationship = findVillageUserRelationship(sectorVillage, userData.villageId);
  return relationship?.status === "ALLY" && structure.allyAccess !== 0;
};

/**
 * Explains why `canAccessStructure` refused a building, naming where to travel when the
 * player's own village has it.
 * @param userData - The user data, whose village carries its structures.
 * @param structureRoute - The requested structure, or none for the village itself.
 * @param sectorVillage - The village in the player's current sector, if any.
 * @returns A sentence for the player.
 */
export const structureAccessDeniedMessage = (
  userData: Pick<NonNullable<UserWithRelations>, "village">,
  structureRoute?: StructureRoute,
  sectorVillage?: SectorVillage | null,
) => {
  const home = userData.village;
  const homeStructure = structureRoute
    ? home?.structures?.find((s) => s.route === structureRoute)
    : undefined;
  const hereStructure = structureRoute
    ? sectorVillage?.structures.find((s) => s.route === structureRoute)
    : undefined;
  const place = hereStructure?.name ?? homeStructure?.name;
  const travelHome = home && (!structureRoute || homeStructure);
  if (!sectorVillage) {
    if (!travelHome)
      return "You need to be in a village to go there. Travel to one first.";
    return place
      ? `The ${place} is in ${home.name}. Travel there first.`
      : `You are outside ${home.name}. Travel there first.`;
  }
  if (!hereStructure) {
    return travelHome && home.id !== sectorVillage.id
      ? `${sectorVillage.name} has no ${place ?? "such building"}. Travel to ${home.name} to use yours.`
      : `${sectorVillage.name} has no ${place ?? "such building"}.`;
  }
  return travelHome
    ? `The ${place} in ${sectorVillage.name} is closed to your village. Travel to ${home.name} to use yours.`
    : `The ${place} in ${sectorVillage.name} is closed to your village.`;
};

export type StructureAttribute = Extract<keyof VillageStructure, `${string}PerLvl`>;

/** What boost calculations read, which battle snapshots keep from each structure. */
export type BoostStructure = Pick<
  VillageStructure,
  | StructureAttribute
  | "level"
  | "temporaryLevelBonus"
  | "temporaryLevelBonusExpiresAt"
  | "raidBoostExpiresAt"
>;

/**
 * Calculates the effective level of a structure, including temporary bonuses from war victories.
 * @param structure - The village structure.
 * @param now - The current date (optional, defaults to now)
 * @returns The effective level including temporary bonus if not expired.
 */
export const getEffectiveStructureLevel = (
  structure: BoostStructure,
  now: Date = new Date(),
): number => {
  const bonusExpiry = structure.temporaryLevelBonusExpiresAt;
  const bonusActive = bonusExpiry && new Date(bonusExpiry) > now;
  const level = structure.level + (bonusActive ? structure.temporaryLevelBonus : 0);
  return Math.max(0, level);
};

/**
 * Calculates the total boost for a given structure attribute in a village.
 * @param attribute - The attribute to calculate the boost for.
 * @param structures - An optional array of village structures.
 * @returns The total boost for the given attribute.
 */
export const getStrucBoost = (
  attribute: StructureAttribute,
  structures?: BoostStructure[],
) => {
  return (
    structures?.reduce(
      (a, b) =>
        a +
        b[attribute] * getEffectiveStructureLevel(b) * getRaidStructureMultiplier(b),
      0,
    ) ?? 0
  );
};

/**
 * Calculates the boost factor for a given shrine boost type: 0 unless the village has
 * that boost active, otherwise getShrineBoostPercentage(sectors) / 100.
 * @param sectors - The number of boosting shrines (countBoostingShrines).
 * @param boostType - The type of boost to calculate.
 * @param village - The village to calculate the boost for.
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
  return getShrineBoostPercentage(sectors) / 100;
};

/** Boost percentage from boosting shrines: base with 1+, then a step per additional shrine. */
export const getShrineBoostPercentage = (shrineCount: number) =>
  shrineCount > 0
    ? SHRINE_BOOST_BASE_PERC + (shrineCount - 1) * SHRINE_BOOST_PER_SHRINE_PERC
    : 0;

/**
 * Calculates the bank interest rate based on the boost value. Boost value is
 * the sum of all bank interest boosts from village structures multiplied by the
 * level of the structure.
 *
 * @param boost - The boost value to calculate the interest rate.
 * @param user - Adds the federal supporter bonus when given.
 * @returns The daily bank interest rate in percent.
 */
export const calcBankInterest = (
  boost: number,
  user?: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const baseFactor = boost > 1 ? 1 + (boost - 1) * 0.1 : 1;
  if (!user) return baseFactor;
  return baseFactor + FED_BANK_INTEREST[getUserFederalStatus(user)];
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
  const isVillageStructure =
    village.type === "VILLAGE" && isMaintainedStructure(structure.route);
  const cost = isVillageStructure
    ? VILLAGE_STRUCTURE_UPGRADE_BASE_COST +
      VILLAGE_STRUCTURE_UPGRADE_PER_LEVEL_COST * structure.level
    : BUILDING_UPGRADE_BASE_COST + BUILDING_UPGRADE_PER_LEVEL_COST * structure.level;
  // Village tax
  const population = village.populationCount;
  const hundredsOver200 = Math.max(Math.floor((population - 200) / 100), 0);
  const taxPerc = Math.min(hundredsOver200 * 0.05, 0.25);
  const tax = Math.floor(cost * taxPerc);
  const subTotal = cost + tax;
  // Discount (uses effective level for benefits)
  const townHall = village?.structures.find((s) => s.name === "Town Hall");
  const discountLevel = townHall
    ? getEffectiveStructureLevel(townHall) * (townHall.structureDiscountPerLvl ?? 0)
    : 0;
  const discount = Math.floor(subTotal * (discountLevel / 100));
  // Return result & infor on calculation
  return { cost, tax, discount, total: subTotal - discount };
};

/** Whether a structure at this route is village-funded and billed monthly upkeep. */
export const isMaintainedStructure = (route: string) =>
  (VILLAGE_MAINTAINED_STRUCTURE_ROUTES as readonly string[]).includes(route);

/** Built structures a village is billed monthly upkeep for. */
export const countMaintainedStructures = (
  structures: Pick<VillageStructure, "level" | "route">[],
) =>
  structures.filter(
    (structure) => structure.level > 0 && isMaintainedStructure(structure.route),
  ).length;

/** Raid bonuses multiply each benefit supplied by the matching structure. */
export const getRaidStructureMultiplier = (
  structure: BoostStructure,
  now = new Date(),
) =>
  structure.raidBoostExpiresAt && new Date(structure.raidBoostExpiresAt) > now
    ? 1 + FACTION_RAID_BOOST_PERCENT / 100
    : 1;

/**
 * Count only active, unlocked shrines for every boost consumer. Omitted shrine levels
 * preserve callers that already load only active shrines; reserve locks retain ownership.
 */
export const countBoostingShrines = (
  sectors:
    | {
        sector?: number;
        boostLockedUntil?: Date | string | null;
        shrineLevel?: number;
      }[]
    | undefined,
  now = new Date(),
) =>
  sectors?.filter(
    (sector) =>
      (sector.shrineLevel === undefined || sector.shrineLevel > 0) &&
      (!sector.boostLockedUntil || new Date(sector.boostLockedUntil) <= now),
  ).length ?? 0;
