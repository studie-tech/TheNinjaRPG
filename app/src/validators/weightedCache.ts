import { z } from "zod";
import {
  CACHE_MAX_BUNDLE_ITEMS,
  CACHE_MAX_ENTRIES,
  CACHE_MAX_GRANTED_ITEMS,
  CACHE_MAX_QUANTITY,
  CACHE_MAX_ROLLS,
  CACHE_MAX_TIERS,
  CACHE_PROBABILITY_TOTAL,
} from "@/drizzle/constants";
import { PostProcessedRewardSchema } from "@/validators/rewards";

/** Persist probabilities as integer basis points, including zero-weight draft outcomes. */
const probability = z.number().int().min(0).max(CACHE_PROBABILITY_TOTAL);
/** Bound each bundle quantity before expanding it into the existing reward grant format. */
const cacheItemSchema = z.object({
  itemId: z.string().min(1).max(191),
  quantity: z.number().int().min(1).max(CACHE_MAX_QUANTITY),
});

/** Inactive settings survive mode switches, including incomplete probability totals. */
export const weightedCacheDraftSchema = z.object({
  version: z.literal(1),
  displayName: z.string().trim().max(100),
  rolls: z
    .array(
      z.object({
        count: z.number().int().min(1).max(CACHE_MAX_ROLLS),
        probability,
      }),
    )
    .max(CACHE_MAX_ROLLS),
  tiers: z
    .array(
      z.object({
        name: z.string().trim().max(100),
        probability,
        entries: z
          .array(
            z.object({
              items: z.array(cacheItemSchema).max(CACHE_MAX_BUNDLE_ITEMS),
            }),
          )
          .max(CACHE_MAX_ENTRIES),
      }),
    )
    .max(CACHE_MAX_TIERS),
});

/** Active caches require complete distributions, selectable rewards and bounded delivery. */
export const weightedCacheSchema = weightedCacheDraftSchema.superRefine(
  (cache, ctx) => {
    if (!cache.displayName)
      ctx.addIssue({
        code: "custom",
        path: ["displayName"],
        message: "Enter a cache display name",
      });
    for (const field of ["rolls", "tiers"] as const) {
      if (
        cache[field].reduce((sum, entry) => sum + entry.probability, 0) !==
        CACHE_PROBABILITY_TOTAL
      ) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field === "rolls" ? "Roll" : "Tier"} probabilities must total 100%`,
        });
      }
    }
    cache.tiers.forEach((tier, index) => {
      if (!tier.name)
        ctx.addIssue({
          code: "custom",
          path: ["tiers", index, "name"],
          message: "Enter a tier name",
        });
      if (tier.probability > 0 && tier.entries.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["tiers", index, "entries"],
          message: "Selectable tiers need at least one reward entry",
        });
      if (tier.probability > 0)
        tier.entries.forEach((entry, entryIndex) => {
          if (entry.items.length === 0)
            ctx.addIssue({
              code: "custom",
              path: ["tiers", index, "entries", entryIndex],
              message: "Reward entries need at least one item",
            });
        });
    });
    if (maximumCacheItems(cache) > CACHE_MAX_GRANTED_ITEMS)
      ctx.addIssue({
        code: "custom",
        path: ["tiers"],
        message: `A cache can grant at most ${CACHE_MAX_GRANTED_ITEMS} items per opening`,
      });
  },
);
export type WeightedCache = z.infer<typeof weightedCacheSchema>;

/** Worst-case delivery across selectable outcomes; zero-weight drafts cannot add rewards. */
export const maximumCacheItems = (cache: z.infer<typeof weightedCacheDraftSchema>) => {
  const rolls = Math.max(
    0,
    ...cache.rolls.filter((roll) => roll.probability > 0).map((roll) => roll.count),
  );
  const bundle = Math.max(
    0,
    ...cache.tiers
      .filter((tier) => tier.probability > 0)
      .flatMap((tier) =>
        tier.entries.map((entry) =>
          entry.items.reduce((sum, item) => sum + item.quantity, 0),
        ),
      ),
  );
  return rolls * bundle;
};

/** Player-facing item odds describe at least one award per opening, expressed as percentages. */
export const cacheRewardDisplaySchema = z.object({
  displayName: z.string(),
  items: z.array(z.object({ name: z.string(), chance: z.number().min(0).max(100) })),
});
export type CacheRewardDisplay = z.infer<typeof cacheRewardDisplaySchema>;

/** Saved with the audit record so a transport retry returns the original result. */
export const cacheConsumptionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  actionNotice: z.string().optional(),
  notifications: z.array(z.string()),
  rewards: PostProcessedRewardSchema.nullable(),
  cacheRewards: z.array(cacheRewardDisplaySchema),
  petRewards: z
    .array(
      z.object({
        id: z.string(),
        speciesId: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
});
/** Bind the saved response to its inventory stack before accepting a replay. */
export const cacheConsumptionReceiptSchema = z.object({
  userItemId: z.string(),
  response: cacheConsumptionResponseSchema,
});
