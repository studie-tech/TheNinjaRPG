import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
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
import { shopifyCartSchema } from "@/validators/merch";

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
    for (const key of [
      "SHOPIFY_STORE_DOMAIN",
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
    ] as const) {
      expect(serverSchema.shape[key].safeParse(configuration[key]).success).toBe(true);
    }
    Object.assign(env, configuration);
    expect(isMerchCheckoutEnabled()).toBe(false);
  });

  it("continues to reject a non-Shopify host", async () => {
    const { serverSchema } = await import("@/env/schema.mjs");
    expect(
      serverSchema.shape.SHOPIFY_STORE_DOMAIN.safeParse("example.com").success,
    ).toBe(false);
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
const cartFixture = (totalQuantity: number, lines: object) =>
  shopifyCartSchema.parse({
    id: "gid://shopify/Cart/secret?key=private",
    checkoutUrl: "https://test-shop.myshopify.com/checkouts/private",
    totalQuantity,
    cost: { subtotalAmount: money },
    lines,
  });
const graphql = (body: object) => ({ ok: true, json: async () => body }) as Response;

describe("Shopify merch connection", () => {
  it("keeps colour-specific variant mockups in the public catalogue", async () => {
    const shirt = product("Ethereal Monarch — Organic T-Shirt");
    const image = { url: "https://example.com/navy.jpg", altText: "Navy back print" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      graphql({
        data: {
          products: {
            nodes: [
              {
                ...shirt,
                variants: {
                  ...shirt.variants,
                  nodes: [{ ...shirt.variants.nodes[0], image }],
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    );
    const catalogue = await fetchMerchCatalog();
    expect(catalogue[0]?.variants[0]?.image).toEqual({
      url: image.url,
      alt: image.altText,
    });
  });
  it("loads every catalogue page and excludes unrelated products", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        graphql({
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
      )
      .mockResolvedValueOnce(
        graphql({
          data: {
            products: {
              nodes: [product("TNRG 002 | Cosmic Ascendant | Oversized Crewneck")],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      );
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
    const cart = cartFixture(1, {
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
    const cart = cartFixture(101, {
      nodes: Array.from({ length: 100 }, (_, index) => line(index)),
      pageInfo: { hasNextPage: true, endCursor: "line-99" },
    });
    const request = vi.fn().mockResolvedValue(
      graphql({
        data: {
          cart: {
            lines: {
              nodes: [line(100)],
              pageInfo: { hasNextPage: false, endCursor: "line-100" },
            },
          },
        },
      }),
    );
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
    const cart = cartFixture(101, {
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: "repeat" },
    });
    const request = vi
      .fn()
      .mockResolvedValue(graphql({ data: { cart: { lines: cart.lines } } }));
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    await expect(completeShopifyCart(cart)).rejects.toThrow(
      "Your bag could not be loaded completely",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requests a bag refresh without repeating an already committed cart change", async () => {
    const cart = cartFixture(101, {
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: "line-99" },
    });
    const request = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    vi.spyOn(globalThis, "fetch").mockImplementation(request);
    expect(await reconcileCommittedShopifyCart(cart)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]?.[1].body).query).toContain(
      "query BagLines",
    );
    expect(cart.totalQuantity).toBe(101);
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
      vi
        .fn()
        .mockResolvedValue(graphql({ errors: [{ message: "private-cart-secret" }] })),
    );
    await expect(shopifyRequest("query Test { shop { name } }")).rejects.toThrow(
      "The shop could not complete this request. Please try again.",
    );
  });
});
