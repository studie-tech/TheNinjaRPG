import { z } from "zod";
import { statFilters } from "@/libs/train";
import {
  ItemTypes,
  ItemRarities,
  ItemSlotTypes,
  AttackTargets,
  AttackMethods,
} from "@/drizzle/constants";

export const itemFilteringSchema = z.object({
  limit: z.number().min(1).max(500),
  name: z.string().optional(),
  itemType: z.enum(ItemTypes).optional(),
  itemRarity: z.enum(ItemRarities).optional(),
  effect: z.array(z.string()).optional(),
  stat: z.enum(statFilters).optional(),
  minCost: z.number().default(0),
  minRepsCost: z.number().default(0),
  minSeichiSilverCost: z.number().default(0),
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
});

export type ItemFilteringSchema = z.infer<typeof itemFilteringSchema>;
