import { z } from "zod";
import {
  STORE_BUNDLE_MAX_ITEMS,
  STORE_BUNDLE_MAX_PRICE_CENTS,
  STORE_BUNDLE_MAX_PURCHASE_LIMIT,
  STORE_BUNDLE_MAX_QUANTITY,
  STORE_BUNDLE_MAX_RYO,
  STORE_BUNDLE_MIN_PRICE_CENTS,
  WEB_REP_MAX,
  WEB_REP_MIN,
} from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import { getStoreBundleMinimumPriceCents } from "@/utils/paypal";

export const buyRepsSchema = z.object({
  reputationPoints: z.number().int().min(WEB_REP_MIN).max(WEB_REP_MAX),
});

export type BuyRepsSchema = z.infer<typeof buyRepsSchema>;

export const searchPaypalTransactionSchema = z.strictObject({
  transactionId: z.string().min(4).max(255),
  transactionDate: z.date(),
});

export type SearchPaypalTransactionSchema = z.infer<
  typeof searchPaypalTransactionSchema
>;

/** Paid bundles contain guaranteed quantities; no random rewards or gameplay multipliers. */
export const storeContentsSchema = z
  .object({
    reputationPoints: z.number().int().min(0).max(WEB_REP_MAX),
    money: z.number().int().min(0).max(STORE_BUNDLE_MAX_RYO),
    items: z
      .array(
        z.object({
          id: z.string().min(1, "Choose an item").max(191),
          quantity: z.number().int().min(1).max(STORE_BUNDLE_MAX_QUANTITY),
        }),
      )
      .max(STORE_BUNDLE_MAX_ITEMS)
      .superRefine((items, context) => {
        const selected = new Set<string>();
        items.forEach((item, index) => {
          if (item.id && selected.has(item.id)) {
            context.addIssue({
              code: "custom",
              message: "Select each item once",
              path: [index, "id"],
            });
          }
          selected.add(item.id);
        });
      }),
  })
  .refine(
    (contents) =>
      contents.reputationPoints > 0 || contents.money > 0 || contents.items.length > 0,
    "Add reputation, ryo or items",
  );
/** Shared contract for the bundle editor and catalog writes; prices are integer USD cents. */
export const storeBundleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  priceCents: z
    .number()
    .int()
    .min(STORE_BUNDLE_MIN_PRICE_CENTS)
    .max(STORE_BUNDLE_MAX_PRICE_CENTS),
  isActive: z.boolean(),
  /** Lifetime purchases by the buyer, including gifts; zero means unlimited. */
  purchaseLimit: z.number().int().min(0).max(STORE_BUNDLE_MAX_PURCHASE_LIMIT),
  contents: storeContentsSchema,
});

/** The editor uses catalog prices; the router rechecks fresh item prices before saving. */
export const storeBundleSchemaForItems = (items: Pick<Item, "id" | "repsCost">[]) =>
  storeBundleSchema.superRefine((bundle, context) => {
    const minimum = getStoreBundleMinimumPriceCents(bundle.contents, items);
    if (bundle.priceCents < minimum)
      context.addIssue({
        code: "custom",
        path: ["priceCents"],
        message: `Minimum price is $${(minimum / 100).toFixed(2)} USD for the included reputation and rep-priced items`,
      });
  });

/** Clients select an offer and recipient; the server supplies its price and reward snapshot. */
export const storeCheckoutSchema = z.object({
  recipientId: z.string().min(1).max(191),
  selection: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("custom"),
      reputationPoints: buyRepsSchema.shape.reputationPoints,
    }),
    z.object({ type: z.literal("bundle"), bundleId: z.string().min(1).max(191) }),
  ]),
});
export type StoreContents = z.infer<typeof storeContentsSchema>;
export type StoreBundleInput = z.infer<typeof storeBundleSchema>;
