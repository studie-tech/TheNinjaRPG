import type { Item, Jutsu, Village } from "@/drizzle/schema";
import type { BoostStructure } from "@/utils/village";

/** Authoring, shop and profession columns that no battle reads. */
const OMITTED_JUTSU_FIELDS = ["description", "createdAt", "updatedAt"] as const;
const OMITTED_ITEM_FIELDS = [
  "description",
  "createdAt",
  "updatedAt",
  "expireFromStoreAt",
  "furnitureData",
  "cost",
  "repsCost",
  "seichiSilverCost",
  "maxImbueNumber",
  "inShop",
  "isEventItem",
  "parentItemId",
  "canBeCrafted",
  "canBeHunted",
  "canBeGathered",
  "canBeTraded",
  "auctionMinPrice",
  "auctionMaxPrice",
  "purchaseLimit",
  "purchaseLimitPeriod",
  "isFarmSeed",
  "farmGrowTimeSeconds",
  "farmYieldItemId",
  "farmMinLevel",
  "farmPlantExperience",
  "farmHarvestExperience",
  "farmSellValue",
  "farmExtractSeedItemId",
  "farmExtractSeedCount",
  "isFarmFertilizer",
  "farmTimeReductionSeconds",
  "farmFertilizerExperience",
  "cookingMinLevel",
  "cookingTimeSeconds",
  "cookingOutputQuantity",
  "cookingExperience",
  "mealDurationSeconds",
  "craftingExperience",
  "crystalTargetTypes",
] as const;

/**
 * Gates read a missing requirement exactly as an empty one, and nearly all content has
 * none, so these are stored only when set. A set requirement always stays enforced.
 */
const REQUIREMENT_FIELDS = [
  "requiredNinjutsuMastery",
  "requiredGenjutsuMastery",
  "requiredTaijutsuMastery",
  "requiredBukijutsuMastery",
  "requiredBloodlineMastery",
  "requiredSageMastery",
  "requiredStrength",
  "requiredSpeed",
  "requiredIntelligence",
  "requiredWillpower",
  "requiredSkillId",
] as const;
const OPTIONAL_JUTSU_FIELDS = [
  ...REQUIREMENT_FIELDS,
  "requiredPetSpeciesId",
  "requiredBloodlineItemId",
  "reskinParentJutsuId",
  "bloodlineReskinId",
  "villageId",
  "parentJutsuId",
] as const;

type OmittedJutsuField = (typeof OMITTED_JUTSU_FIELDS)[number];
type OmittedItemField = (typeof OMITTED_ITEM_FIELDS)[number];
type OptionalJutsuField = (typeof OPTIONAL_JUTSU_FIELDS)[number];
type RequirementField = (typeof REQUIREMENT_FIELDS)[number];

/** Combat's view of a jutsu; a full `Jutsu` satisfies it, so loads need no conversion. */
export type BattleJutsu = Omit<Jutsu, OmittedJutsuField | OptionalJutsuField> &
  Partial<Pick<Jutsu, OptionalJutsuField>>;
/** Combat's view of an item; a full `Item` satisfies it, so loads need no conversion. */
export type BattleItem = Omit<Item, OmittedItemField | RequirementField> &
  Partial<Pick<Item, RequirementField>>;

/** Every structure boost: settlement and lobby reprocessing read several of them. */
const STRUCTURE_FIELDS = [
  "level",
  "temporaryLevelBonus",
  "temporaryLevelBonusExpiresAt",
  "raidBoostExpiresAt",
  "anbuSquadsPerLvl",
  "arenaRewardPerLvl",
  "bankInterestPerLvl",
  "blackDiscountPerLvl",
  "clansPerLvl",
  "hospitalSpeedupPerLvl",
  "itemDiscountPerLvl",
  "missionRewardPerLvl",
  "patrolSlotsPerLvl",
  "ramenDiscountPerLvl",
  "regenIncreasePerLvl",
  "sleepRegenPerLvl",
  "structureDiscountPerLvl",
  "trainBoostPerLvl",
  "villageDefencePerLvl",
] as const satisfies readonly (keyof BoostStructure)[];

/** A structure's level and boosts, without its map placement or artwork. */
export type BattleStructure = BoostStructure;
/** Combat's view of a village, holding only the structures that grant a boost. */
export type BattleVillage = Village & {
  structures?: BattleStructure[];
  sectors?: { sector: number; shrineLevel?: number; boostLockedUntil?: Date | null }[];
};

/** Copy a catalog row without the omitted columns or the unset optional ones. */
const compactRow = <T extends object>(
  row: T,
  omitted: ReadonlySet<string>,
  optional: ReadonlySet<string>,
) =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([key, value]) => !omitted.has(key) && (!!value || !optional.has(key)),
    ),
  );

const omittedJutsu = new Set<string>(OMITTED_JUTSU_FIELDS);
const optionalJutsu = new Set<string>(OPTIONAL_JUTSU_FIELDS);
const omittedItem = new Set<string>(OMITTED_ITEM_FIELDS);
const optionalItem = new Set<string>(REQUIREMENT_FIELDS);

const compactEntries = <T>(entries: Record<string, T>, compact: (row: T) => T) =>
  Object.fromEntries(Object.entries(entries).map(([id, row]) => [id, compact(row)]));

const compactVillage = <T extends BattleVillage>(village: T): T => ({
  ...village,
  structures: village.structures
    ?.filter((structure) =>
      STRUCTURE_FIELDS.some((key) => key.endsWith("PerLvl") && !!structure[key]),
    )
    .map(
      (structure) =>
        Object.fromEntries(
          STRUCTURE_FIELDS.map((key) => [key, structure[key]]),
        ) as BattleStructure,
    ),
});

/**
 * Reduce the catalogs a battle row stores to what combat reads. Every action reads the
 * whole row, so these bytes are paid on each turn; `BattleJutsu`, `BattleItem` and
 * `BattleVillage` keep future combat code from depending on a removed column.
 */
export const compactBattleCatalogs = <
  T extends {
    jutsus?: Record<string, BattleJutsu>;
    items?: Record<string, BattleItem>;
    villages?: Record<string, BattleVillage>;
  },
>(
  extraState: T,
): T => {
  const jutsu = (row: BattleJutsu) =>
    compactRow(row, omittedJutsu, optionalJutsu) as BattleJutsu;
  const item = (row: BattleItem) =>
    compactRow(row, omittedItem, optionalItem) as BattleItem;
  return {
    ...extraState,
    ...(extraState.jutsus ? { jutsus: compactEntries(extraState.jutsus, jutsu) } : {}),
    ...(extraState.items ? { items: compactEntries(extraState.items, item) } : {}),
    ...(extraState.villages
      ? { villages: compactEntries(extraState.villages, compactVillage) }
      : {}),
  };
};
