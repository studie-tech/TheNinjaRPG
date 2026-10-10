import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  merchAddSchema,
  merchUpdateSchema,
  shopifyCartSchema,
} from "@/validators/merch";
import { env } from "@/env/server.mjs";
import {
  completeShopifyCart,
  fetchMerchCatalog,
  isMerchCheckoutEnabled,
  isShopifyCheckoutUrl,
  publicMerchCart,
  reconcileCommittedShopifyCart,
  shopifyRequest,
} from "@/server/utils/shopify";
const originalConfiguration = {
  SHOPIFY_STORE_DOMAIN: env.SHOPIFY_STORE_DOMAIN,
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
  MERCH_CHECKOUT_ENABLED: env.MERCH_CHECKOUT_ENABLED,
};
describe("optional Shopify configuration", () => {
  it("accepts the blank example configuration and keeps checkout closed", async () => {
    const { serverSchema } = await import("@/env/schema.mjs");
    const configuration = {
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "",
      MERCH_CHECKOUT_ENABLED: "false",
    };
    for (const key of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STOREFRONT_ACCESS_TOKEN"] as const) {
      expect(serverSchema.shape[key].safeParse(configuration[key]).success).toBe(true);
    }
    Object.assign(env, configuration);
    expect(isMerchCheckoutEnabled()).toBe(false);
  });

  it("continues to reject a non-Shopify host", async () => {
    const { serverSchema } = await import("@/env/schema.mjs");
    expect(serverSchema.shape.SHOPIFY_STORE_DOMAIN.safeParse("example.com").success).toBe(false);
  });
});
beforeEach(() =>
  Object.assign(env, {
    SHOPIFY_STORE_DOMAIN: "test-shop.myshopify.com",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "public-test-token",
    MERCH_CHECKOUT_ENABLED: "false",
  }),
);
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, originalConfiguration);
});
const money = { amount: "29.00", currencyCode: "USD" };
const product = (title: string) => ({
  id: title,
  handle: title,
  title,
  description: "A product",
  productType: "Clothing",
  tags: [],
  images: { nodes: [] },
  options: [],
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/123",
        title: "M",
        availableForSale: true,
        price: money,
        selectedOptions: [{ name: "Size", value: "M" }],
        image: null,
      },
    ],
    pageInfo: { hasNextPage: false },
  },
});

describe("Shopify merch connection", () => {
  it("keeps colour-specific variant mockups in the public catalogue", async () => {
    const shirt = product("Ethereal Monarch — Organic T-Shirt");
    const image = { url: "https://example.com/navy.jpg", altText: "Navy back print" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { products: {
        nodes: [{ ...shirt, variants: { ...shirt.variants,
          nodes: [{ ...shirt.variants.nodes[0], image }] } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }),
    } as Response);
    const catalogue = await fetchMerchCatalog();
    expect(catalogue[0]?.variants[0]?.image).toEqual({
      url: image.url, alt: image.altText,
    });
  });
  it("loads every catalogue page and excludes unrelated products", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            products: {
              nodes: [
                product("TNRG 001 | Blue Blade Eyes | Organic Tee"),
                product("Unrelated merch"),
              ],
              pageInfo: { hasNextPage: true, endCursor: "next-page" },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            products: {
              nodes: [product("TNRG 002 | Cosmic Ascendant | Oversized Crewneck")],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    const catalogue = await fetchMerchCatalog();
    expect(catalogue.map((p) => p.kind)).toEqual([
      "Organic T-Shirt",
      "Oversized Sweatshirt",
    ]);
    expect(catalogue.every((p) => p.tags.includes("Back print"))).toBe(true);
    expect(JSON.parse(request.mock.calls[1]?.[1].body).variables).toEqual({
      after: "next-page",
    });
  });
  it("does not expose cart bearer secrets or checkout links in regular cart responses", () => {
    const cart = shopifyCartSchema.parse({
      id: "gid://shopify/Cart/secret?key=private",
      checkoutUrl: "https://test-shop.myshopify.com/checkouts/private",
      totalQuantity: 1,
      cost: { subtotalAmount: money },
      lines: {
        nodes: [
          {
            id: "gid://shopify/CartLine/line",
            quantity: 1,
            merchandise: {
              id: "gid://shopify/ProductVariant/123",
              title: "Black / M",
              price: money,
              image: null,
              product: { handle: "tee", title: "Blue Blade Eyes" },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    expect(JSON.stringify(publicMerchCart(cart))).not.toMatch(
      /secret|private|checkoutUrl/,
    );
    expect(publicMerchCart(cart).lines[0]?.variantTitle).toBe("Black / M");
  });
  it("returns all 101 cart lines so the last item remains removable", async () => {
    const line = (index: number) => ({
      id: `gid://shopify/CartLine/${index}`,
      quantity: 1,
      merchandise: {
        id: `gid://shopify/ProductVariant/${index}`,
        title: "Black / M",
        price: money,
        image: null,
        product: { handle: `tee-${index}`, title: "Blue Blade Eyes" },
      },
    });
    const cart = shopifyCartSchema.parse({
      id: "gid://shopify/Cart/secret?key=private",
      checkoutUrl: "https://test-shop.myshopify.com/checkouts/private",
      totalQuantity: 101,
      cost: { subtotalAmount: money },
      lines: {
        nodes: Array.from({ length: 100 }, (_, index) => line(index)),
        pageInfo: { hasNextPage: true, endCursor: "line-99" },
      },
    });
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          cart: {
            lines: {
              nodes: [line(100)],
              pageInfo: { hasNextPage: false, endCursor: "line-100" },
            },
          },
        },
      }),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    const result = publicMerchCart(await completeShopifyCart(cart));
    expect(result.lines).toHaveLength(101);
    expect(result.lines[100]?.id).toBe("gid://shopify/CartLine/100");
    expect(JSON.parse(request.mock.calls[0]?.[1].body).variables).toEqual({
      id: cart.id,
      after: "line-99",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|checkoutUrl/);
  });
  it("stops if a cart connection repeats a cursor", async () => {
    const cart = shopifyCartSchema.parse({
      id: "gid://shopify/Cart/secret?key=private",
      checkoutUrl: "https://test-shop.myshopify.com/checkouts/private",
      totalQuantity: 101,
      cost: { subtotalAmount: money },
      lines: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "repeat" } },
    });
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cart: { lines: cart.lines } } }),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    await expect(completeShopifyCart(cart)).rejects.toThrow(
      "Your bag could not be loaded completely",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requests a bag refresh without repeating an already committed cart change", async () => {
    const cart = shopifyCartSchema.parse({
      id: "gid://shopify/Cart/secret?key=private",
      checkoutUrl: "https://test-shop.myshopify.com/checkouts/private",
      totalQuantity: 101,
      cost: { subtotalAmount: money },
      lines: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "line-99" } },
    });
    const request = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    expect(await reconcileCommittedShopifyCart(cart)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]?.[1].body).query).toContain("query BagLines");
    expect(cart.totalQuantity).toBe(101);
  });
  it("allows reducing a quantity accumulated by repeated additions", () => {
    expect(
      merchUpdateSchema.safeParse({
        lineId: "gid://shopify/CartLine/line",
        quantity: 19,
      }).success,
    ).toBe(true);
    expect(
      merchAddSchema.safeParse({
        variantId: "gid://shopify/ProductVariant/123",
        quantity: 11,
      }).success,
    ).toBe(false);
  });
  it("rejects injected checkout destinations and non-HTTPS URLs", () => {
    for (const url of [
      "https://shop.theninja-rpg.com.attacker.example/checkout",
      "https://shop.theninja-rpg.com@attacker.example/checkout",
      "http://shop.theninja-rpg.com/checkout",
      "javascript:alert(1)",
      "invalid",
    ])
      expect(isShopifyCheckoutUrl(url)).toBe(false);
    expect(
      isShopifyCheckoutUrl("https://shop.theninja-rpg.com/checkouts/example"),
    ).toBe(true);
  });
  it("keeps checkout closed until explicitly enabled", () => {
    expect(isMerchCheckoutEnabled()).toBe(false);
    env.MERCH_CHECKOUT_ENABLED = "true";
    expect(isMerchCheckoutEnabled()).toBe(true);
  });
  it("does not leak Shopify error payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ errors: [{ message: "private-cart-secret" }] }),
      }),
    );
    await expect(shopifyRequest("query Test { shop { name } }")).rejects.toThrow(
      "The shop could not complete this request. Please try again.",
    );
  });
  it("rejects preview IDs and invalid cart quantities at the API boundary", () => {
    expect(
      merchAddSchema.safeParse({ variantId: "preview:tee", quantity: 1 }).success,
    ).toBe(false);
    expect(
      merchAddSchema.safeParse({
        variantId: "gid://shopify/ProductVariant/123",
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      merchUpdateSchema.safeParse({
        lineId: "gid://shopify/CartLine/line",
        quantity: 0,
      }).success,
    ).toBe(true);
    expect(
      merchUpdateSchema.safeParse({
        lineId: "gid://shopify/CartLine/line",
        quantity: 2147483648,
      }).success,
    ).toBe(false);
  });
});
