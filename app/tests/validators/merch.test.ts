import { describe, expect, it } from "bun:test";
import { merchAddSchema, merchUpdateSchema } from "@/validators/merch";

describe("merch cart inputs", () => {
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
