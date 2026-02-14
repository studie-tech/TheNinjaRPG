import { z } from "zod";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
} from "@/drizzle/constants";
import { statFilters } from "@/libs/train";

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
