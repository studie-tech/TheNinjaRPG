import { z } from "zod";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ITEM_LEVEL_CAP,
  ItemRarities,
  ItemSlots,
  ItemSlotTypes,
  ItemTypes,
  MAX_ITEM_SHOP_PURCHASE_QUANTITY,
  MAX_ITEM_VARIANTS,
  VARIANT_COST_TYPES,
} from "@/drizzle/constants";
import { statFilters } from "@/libs/train";

export const itemBuySchema = z.object({
  itemId: z.string(),
  stack: z.number().int().min(1).max(MAX_ITEM_SHOP_PURCHASE_QUANTITY),
  villageId: z.string().nullish(),
});

export const getItemEvolutionsSchema = z.object({
  itemId: z.string(),
});

export const evolveItemSchema = z.object({
  userItemId: z.string(),
  evolutionItemId: z.string(),
});

export const getPublicUserItemsSchema = z.object({
  userId: z.string(),
});

export const adjustUserItemSchema = z.object({
  userId: z.string(),
  expectedUsername: z.string().min(1).max(191),
  expectedIsAi: z.boolean(),
  userItemId: z.string(),
  itemId: z.string(),
  expectedItemName: z.string().min(1).max(191),
  expectedLevel: z.number().int().min(1).max(ITEM_LEVEL_CAP),
  level: z.number().int().min(1).max(ITEM_LEVEL_CAP),
  expectedQuantity: z.number().int().positive(),
  expectedExperience: z.number().int().min(0),
  expectedEquipped: z.enum(ItemSlots),
  expectedDurability: z.number().int().min(0),
  expectedDropChancePerc: z.number().int().min(0).max(100),
  expectedStoredAtHome: z.boolean(),
  expectedIsInAuction: z.boolean(),
  expectedActiveVariantId: z.string().nullable(),
  expectedCraftingFinishedAt: z.date().nullable(),
  expectedImbuements: z
    .array(
      z.object({
        id: z.string(),
        itemId: z.string(),
        craftingFinishedAt: z.date(),
      }),
    )
    .max(100),
  requestId: z.string().uuid(),
});

export const itemFilteringSchema = z.object({
  limit: z.number().min(1).max(500),
  name: z.string().optional(),
  itemType: z.enum(ItemTypes).optional(),
  itemRarity: z.enum(ItemRarities).optional(),
  effect: z.array(z.string()).optional(),
  stat: z.enum(statFilters).optional(),
  minCost: z.number().prefault(0),
  minRepsCost: z.number().prefault(0),
  minSeichiSilverCost: z.number().prefault(0),
  maxSeichiSilverCost: z.number().optional(),
  onlyInShop: z.boolean().optional(),
  /** Drop rows whose store listing date has passed. Shop catalogs page on this. */
  excludeExpiredFromStore: z.boolean().optional(),
  eventItems: z.boolean().optional(),
  slot: z.enum(ItemSlotTypes).optional(),
  target: z.enum(AttackTargets).optional(),
  method: z.enum(AttackMethods).optional(),
  hidden: z.boolean().optional(),
  canBeCrafted: z.boolean().optional(),
  canBeImbued: z.boolean().optional(),
  canBeHunted: z.boolean().optional(),
  canBeGathered: z.boolean().optional(),
  canBeTraded: z.boolean().optional(),
  maxLevel: z.number().optional(),
  battleUsageType: z.enum(BattleUsageTypes).optional(),
  actionCostPerc: z.number().optional(),
});

export type ItemFilteringSchema = z.infer<typeof itemFilteringSchema>;

export const ItemVariantValidator = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name required"),
  image: z.string().min(1, "Image required"),
  costType: z.enum(VARIANT_COST_TYPES),
  cost: z.coerce.number().int().min(0),
  order: z.coerce.number().int().min(1).max(MAX_ITEM_VARIANTS),
  // .optional() (string | undefined) is correct here: the form treats absent fields as
  // undefined, not null. The tRPC output schema uses .nullish() because MySQL returns SQL NULL.
  description: z.string().optional(),
  battleDescription: z.string().optional(),
});
export type ZodItemVariantType = z.infer<typeof ItemVariantValidator>;

const COST_TYPE_LABELS: Record<(typeof VARIANT_COST_TYPES)[number], string> = {
  MONEY: "Ryo",
  REPUTATION: "Reputation",
  SEICHI_SILVER: "Seichi Silver",
  VILLAGE_PRESTIGE: "Village Prestige",
  VARIANT_TOKEN: "Variant Token",
};

/** Returns the human-readable label for a variant cost type. */
export const displayCostType = (type: (typeof VARIANT_COST_TYPES)[number]): string =>
  COST_TYPE_LABELS[type];

export const ItemVariantResponseSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  name: z.string(),
  image: z.string(),
  costType: z.enum(VARIANT_COST_TYPES),
  cost: z.number(),
  order: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  description: z.string().nullish(),
  battleDescription: z.string().nullish(),
});

export const UserUnlockedVariantResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  variantId: z.string(),
  createdAt: z.date(),
});
