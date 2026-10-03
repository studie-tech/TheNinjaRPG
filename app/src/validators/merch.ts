import { z } from "zod";

export const merchMoneySchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
});
export const merchImageSchema = z.object({ url: z.url(), alt: z.string() });
export const merchOptionSchema = z.object({ name: z.string(), value: z.string() });
export const merchVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  available: z.boolean(),
  price: merchMoneySchema.nullable(),
  selectedOptions: z.array(merchOptionSchema),
});
export const merchProductSchema = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  designKey: z.string(),
  designName: z.string(),
  category: z.string(),
  kind: z.string(),
  description: z.string(),
  images: z.array(merchImageSchema),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  variants: z.array(merchVariantSchema),
  tags: z.array(z.string()),
  preview: z.boolean(),
});
export const merchCartLineSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  handle: z.string(),
  title: z.string(),
  variantTitle: z.string(),
  quantity: z.number().int().min(1).max(99),
  image: merchImageSchema.nullable(),
  price: merchMoneySchema.nullable(),
});
export const merchReviewCartSchema = z.array(merchCartLineSchema).max(50);
export const merchAddSchema = z.object({
  variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  quantity: z.number().int().min(1).max(10),
});
export const merchUpdateSchema = z.object({
  lineId: z.string().regex(/^gid:\/\/shopify\/CartLine\/[A-Za-z0-9?=&_%.-]+$/),
  quantity: z.number().int().min(0).max(10),
});

export type MerchProduct = z.infer<typeof merchProductSchema>;
export type MerchVariant = z.infer<typeof merchVariantSchema>;
export type MerchCartLine = z.infer<typeof merchCartLineSchema>;
export type MerchMoney = z.infer<typeof merchMoneySchema>;

// Shopify responses are validated before they enter the public catalogue or cart.
export const shopifyImageSchema = z.object({
  url: z.url(),
  altText: z.string().nullable(),
});
export const shopifyProductSchema = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  description: z.string(),
  productType: z.string(),
  tags: z.array(z.string()),
  images: z.object({ nodes: z.array(shopifyImageSchema) }),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  variants: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        availableForSale: z.boolean(),
        price: merchMoneySchema,
        selectedOptions: z.array(merchOptionSchema),
      }),
    ),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});
export const shopifyCatalogSchema = z.object({
  products: z.object({
    nodes: z.array(shopifyProductSchema),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});
export const shopifyCartSchema = z.object({
  id: z.string(),
  checkoutUrl: z.url(),
  totalQuantity: z.number(),
  cost: z.object({ subtotalAmount: merchMoneySchema }),
  lines: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        quantity: z.number(),
        merchandise: z.object({
          id: z.string(),
          title: z.string(),
          price: merchMoneySchema,
          image: shopifyImageSchema.nullable(),
          product: z.object({ handle: z.string(), title: z.string() }),
        }),
      }),
    ),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});
export const shopifyCartQuerySchema = z.object({ cart: shopifyCartSchema.nullable() });
export const shopifyCartPayloadSchema = z.object({
  cart: shopifyCartSchema.nullable(),
  userErrors: z.array(z.object({ message: z.string(), code: z.string().nullable() })),
  warnings: z.array(z.object({ message: z.string() })).optional(),
});
