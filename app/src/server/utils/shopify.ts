import type { z } from "zod";
import { env } from "@/env/server.mjs";
import { findMerchDesign } from "@/libs/merch/catalog";
import { normalizeMerchKind } from "@/libs/merch/products";
import type { MerchProduct } from "@/validators/merch";
import {
  shopifyCartLinesQuerySchema,
  type shopifyCartSchema,
  shopifyCatalogSchema,
} from "@/validators/merch";

export const isShopifyConfigured = () =>
  Boolean(env.SHOPIFY_STORE_DOMAIN && env.SHOPIFY_STOREFRONT_ACCESS_TOKEN);
export const isMerchCheckoutEnabled = () =>
  isShopifyConfigured() && env.MERCH_CHECKOUT_ENABLED === "true";

export async function shopifyRequest(
  query: string,
  variables: Record<string, unknown> = {},
) {
  if (!isShopifyConfigured()) throw new Error("The shop connection is not configured.");
  const response = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/api/2026-07/graphql.json`,
    {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ?? "",
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok)
    throw new Error("Shopify is temporarily unavailable. Please try again.");
  const result = (await response.json()) as { data?: unknown; errors?: unknown[] };
  // Do not put cart secrets, credentials, or response bodies into error telemetry.
  if (result.errors?.length || !result.data)
    throw new Error("The shop could not complete this request. Please try again.");
  return result.data;
}

const PRODUCT_FIELDS = `id handle title description productType tags
  images(first: 12) { nodes { url altText } }
  options { name values }
  variants(first: 250) { nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } } pageInfo { hasNextPage } }`;

export async function fetchMerchCatalog(): Promise<MerchProduct[]> {
  const products: MerchProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result = shopifyCatalogSchema.parse(
      await shopifyRequest(
        `query MerchCatalog($after: String) { products(first: 100, after: $after) { nodes { ${PRODUCT_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        { after: cursor },
      ),
    );
    for (const product of result.products.nodes) {
      const design = findMerchDesign(product.title, product.tags);
      // Only the curated merch collection is exposed; unrelated templates never enter it.
      if (!design) continue;
      if (product.variants.pageInfo.hasNextPage)
        throw new Error("A shop product has too many variants to display safely.");
      const title = product.title
        .replace(/^TNRG\s+\d+\s*\|\s*/i, "")
        .replace(/\s*\|\s*/g, " — ");
      products.push({
        ...product,
        title,
        designKey: design.key,
        designName: design.name,
        category: design.category,
        kind: normalizeMerchKind(
          title.split(" — ").at(-1) || product.productType || "Merch",
        ),
        images: product.images.nodes.map((i) => ({
          url: i.url,
          alt: i.altText || title,
        })),
        variants: product.variants.nodes.map((v) => ({
          ...v,
          available: v.availableForSale,
        })),
        tags: [
          ...product.tags,
          /tee|hoodie|crewneck|sweatshirt/i.test(title) ? "Back print" : "Accessory",
        ],
        preview: false,
      });
    }
    if (!result.products.pageInfo.hasNextPage) return products;
    cursor = result.products.pageInfo.endCursor;
    if (!cursor) throw new Error("The shop catalogue could not be loaded completely.");
  }
  throw new Error("The shop catalogue is larger than the supported collection.");
}

const CART_LINE_FIELDS = `nodes { id quantity merchandise { ... on ProductVariant { id title price { amount currencyCode } image { url altText } product { handle title } } } } pageInfo { hasNextPage endCursor }`;
export const CART_FIELDS = `id checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } }
  lines(first: 100) { ${CART_LINE_FIELDS} }`;

/** Complete the connection before exposing a cart so every line remains removable. */
export async function completeShopifyCart(cart: z.infer<typeof shopifyCartSchema>) {
  const nodes = [...cart.lines.nodes];
  let pageInfo = cart.lines.pageInfo;
  const seenCursors = new Set<string>();
  while (pageInfo.hasNextPage) {
    const after = pageInfo.endCursor;
    if (!after || seenCursors.has(after))
      throw new Error("Your bag could not be loaded completely. Please try again.");
    seenCursors.add(after);
    const result = shopifyCartLinesQuerySchema.parse(
      await shopifyRequest(
        `query BagLines($id: ID!, $after: String!) { cart(id: $id) { lines(first: 100, after: $after) { ${CART_LINE_FIELDS} } } }`,
        { id: cart.id, after },
      ),
    );
    if (!result.cart)
      throw new Error(
        "Your bag has expired. Please reload it and add your items again.",
      );
    nodes.push(...result.cart.lines.nodes);
    pageInfo = result.cart.lines.pageInfo;
  }
  return { ...cart, lines: { nodes, pageInfo } };
}

/** A read failure after a committed mutation must never invite a duplicate write. */
export async function reconcileCommittedShopifyCart(
  cart: z.infer<typeof shopifyCartSchema>,
) {
  try {
    return publicMerchCart(await completeShopifyCart(cart));
  } catch {
    // The browser refreshes the bag and prevents more changes until that read succeeds.
    return null;
  }
}

export const publicMerchCart = (cart: z.infer<typeof shopifyCartSchema> | null) => {
  if (!cart) return { lines: [], subtotal: null, quantity: 0 };
  if (cart.lines.pageInfo.hasNextPage)
    throw new Error("This cart has too many items. Please contact shop support.");
  return {
    quantity: cart.totalQuantity,
    subtotal: cart.cost.subtotalAmount,
    lines: cart.lines.nodes.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      variantId: line.merchandise.id,
      handle: line.merchandise.product.handle,
      title: line.merchandise.product.title,
      variantTitle: line.merchandise.title,
      price: line.merchandise.price,
      image: line.merchandise.image
        ? {
            url: line.merchandise.image.url,
            alt: line.merchandise.image.altText || line.merchandise.product.title,
          }
        : null,
    })),
  };
};

export function isShopifyCheckoutUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (url.hostname === env.SHOPIFY_STORE_DOMAIN ||
      url.hostname === "shop.theninja-rpg.com" ||
      url.hostname === "checkout.theninja-rpg.com")
  );
}
