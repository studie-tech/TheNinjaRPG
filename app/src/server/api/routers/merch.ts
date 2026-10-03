import { cookies } from "next/headers";
import { createMerchPreviewCatalog } from "@/libs/merch/preview";
import { createTRPCRouter, errorResponse, publicProcedure } from "@/server/api/trpc";
import {
  CART_FIELDS,
  completeShopifyCart,
  fetchMerchCatalog,
  isMerchCheckoutEnabled,
  isShopifyCheckoutUrl,
  isShopifyConfigured,
  publicMerchCart,
  shopifyRequest,
} from "@/server/utils/shopify";
import {
  merchAddSchema,
  merchUpdateSchema,
  shopifyCartPayloadSchema,
  shopifyCartQuerySchema,
} from "@/validators/merch";

const CART_COOKIE = "tnr-merch-cart";

export const merchRouter = createTRPCRouter({
  getCatalog: publicProcedure.query(async () => {
    if (!isShopifyConfigured()) {
      const preview = process.env.NODE_ENV === "development";
      return {
        products: preview ? createMerchPreviewCatalog() : [],
        preview,
        checkoutEnabled: false,
      };
    }
    return {
      products: await fetchMerchCatalog(),
      preview: false,
      checkoutEnabled: isMerchCheckoutEnabled(),
    };
  }),
  getCart: publicProcedure.query(async () => {
    if (!isShopifyConfigured()) return publicMerchCart(null);
    return publicMerchCart(await readCart());
  }),
  addToCart: publicProcedure.input(merchAddSchema).mutation(async ({ input }) => {
    if (!isShopifyConfigured())
      return errorResponse("The collection is not open for orders yet.");
    const id = await readCartId();
    const operation = id ? "cartLinesAdd" : "cartCreate";
    const query = id
      ? `mutation Add($id: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $id, lines: $lines) { cart { ${CART_FIELDS} } userErrors { code message } warnings { message } } }`
      : `mutation Create($input: CartInput!) { cartCreate(input: $input) { cart { ${CART_FIELDS} } userErrors { code message } warnings { message } } }`;
    const lines = [{ merchandiseId: input.variantId, quantity: input.quantity }];
    const data = await shopifyRequest(query, id ? { id, lines } : { input: { lines } });
    const payload = shopifyCartPayloadSchema.parse(
      (data as Record<string, unknown>)[operation],
    );
    if (!payload.cart) (await cookies()).delete(CART_COOKIE);
    if (payload.userErrors.length || !payload.cart)
      return errorResponse(
        payload.userErrors[0]?.message ||
          "Your cart has expired. Please add your item again.",
      );
    await saveCartId(payload.cart.id);
    return {
      success: true as const,
      message:
        payload.warnings?.map((w) => w.message).join(" ") || "Added to your bag.",
      cart: publicMerchCart(await completeShopifyCart(payload.cart)),
    };
  }),
  updateCart: publicProcedure.input(merchUpdateSchema).mutation(async ({ input }) => {
    if (!isShopifyConfigured())
      return errorResponse("The collection is not open for orders yet.");
    const id = await readCartId();
    if (!id) return errorResponse("Your bag has expired. Please add your items again.");
    const remove = input.quantity === 0;
    const operation = remove ? "cartLinesRemove" : "cartLinesUpdate";
    const query = remove
      ? `mutation Remove($id: ID!, $lines: [ID!]!) { cartLinesRemove(cartId: $id, lineIds: $lines) { cart { ${CART_FIELDS} } userErrors { code message } warnings { message } } }`
      : `mutation Update($id: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $id, lines: $lines) { cart { ${CART_FIELDS} } userErrors { code message } warnings { message } } }`;
    const data = await shopifyRequest(query, {
      id,
      lines: remove ? [input.lineId] : [{ id: input.lineId, quantity: input.quantity }],
    });
    const payload = shopifyCartPayloadSchema.parse(
      (data as Record<string, unknown>)[operation],
    );
    if (!payload.cart) (await cookies()).delete(CART_COOKIE);
    if (payload.userErrors.length || !payload.cart)
      return errorResponse(
        payload.userErrors[0]?.message ||
          "Your bag could not be updated. Please try again.",
      );
    return {
      success: true as const,
      message: payload.warnings?.map((w) => w.message).join(" ") || "Bag updated.",
      cart: publicMerchCart(await completeShopifyCart(payload.cart)),
    };
  }),
  checkout: publicProcedure.mutation(async () => {
    if (!isMerchCheckoutEnabled())
      return errorResponse(
        "Checkout is not open yet. Please check back for the collection launch.",
      );
    const cart = await readCart();
    if (!cart) {
      (await cookies()).delete(CART_COOKIE);
      return errorResponse("Your bag has expired. Please add your items again.");
    }
    if (!cart?.totalQuantity)
      return errorResponse("Your bag is empty. Add something you love first.");
    // Refresh the checkout URL rather than reusing a stale link from an earlier render.
    if (!isShopifyCheckoutUrl(cart.checkoutUrl))
      throw new Error("The checkout destination could not be verified.");
    return {
      success: true as const,
      message: "Opening secure checkout.",
      checkoutUrl: cart.checkoutUrl,
    };
  }),
});

async function readCartId() {
  const id = (await cookies()).get(CART_COOKIE)?.value;
  return id && /^gid:\/\/shopify\/Cart\/[A-Za-z0-9?=&_%.-]{1,500}$/.test(id)
    ? id
    : null;
}

async function saveCartId(id: string) {
  // Shopify cart IDs contain a bearer secret. Keep it out of JS, tRPC inputs and telemetry.
  (await cookies()).set(CART_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 10,
  });
}

async function readCart() {
  const id = await readCartId();
  if (!id) return null;
  const cart = shopifyCartQuerySchema.parse(
    await shopifyRequest(`query Bag($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`, {
      id,
    }),
  ).cart;
  return cart ? completeShopifyCart(cart) : null;
}
