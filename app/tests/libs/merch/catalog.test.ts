import { describe, expect, it } from "bun:test";
import { preferredMerchImage, selectedMerchImage, selectedMerchVariant } from "@/libs/merch/catalog";
import { merchProductSchema } from "@/validators/merch";

const black = { url: "https://example.com/black.jpg", alt: "Black back print" };
const navy = { url: "https://example.com/navy.jpg", alt: "Navy back print" };
const product = merchProductSchema.parse({
  id: "shirt", handle: "shirt", title: "Shirt", designKey: "monarch",
  designName: "Monarch", category: "S-ranks", kind: "Organic T-Shirt",
  description: "A shirt", images: [black], preview: false, tags: [],
  options: [{ name: "Color", values: ["Black", "French Navy"] },
    { name: "Size", values: ["S", "M"] }],
  variants: [
    { id: "black-s", title: "Black / S", available: true, price: null, image: black,
      selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
    { id: "navy-m", title: "French Navy / M", available: true, price: null, image: navy,
      selectedOptions: [{ name: "Color", value: "French Navy" }, { name: "Size", value: "M" }] },
  ],
});

describe("merch colour selections", () => {
  it("previews the selected colour before a size is chosen without selecting a purchasable variant", () => {
    expect(selectedMerchImage(product, { Color: "French Navy" })).toEqual(navy);
    expect(selectedMerchVariant(product, { Color: "French Navy" })).toBeUndefined();
  });
  it("does not resolve a missing colour and size combination to another colour", () => {
    expect(selectedMerchVariant(product, { Color: "French Navy", Size: "S" })).toBeUndefined();
    expect(selectedMerchImage(product, { Color: "French Navy", Size: "S" })).toEqual(navy);
    expect(selectedMerchVariant(product, { Color: "French Navy", Size: "M" })?.id).toBe("navy-m");
  });
  it("falls back to the product image when a variant has no mockup", () => {
    const missing = { ...product, variants: product.variants.map((item) => ({ ...item, image: null })) };
    expect(selectedMerchImage(missing, { Color: "French Navy", Size: "M" })).toEqual(black);
  });
  it("automatically resolves a single colour while still requiring size", () => {
    const single = { ...product, options: [{ name: "Color", values: ["Black"] }, product.options[1]!],
      variants: [product.variants[0]!] };
    expect(selectedMerchVariant(single, {})).toBeUndefined();
    expect(selectedMerchVariant(single, { Size: "S" })?.id).toBe("black-s");
  });
});

describe("merch artwork-facing mockups", () => {
  const back = { url: "https://example.com/product-black-back-123.jpg", alt: "Back" };
  const front = { url: "https://example.com/product-black-front-123.jpg", alt: "Front" };

  it.each(["Utility Backpack", "Black Glossy Mug", "Straw Lid Water Bottle"])(
    "shows the artwork-facing image for %s even when Shopify lists the back first",
    (kind) => {
      const accessory = { ...product, kind, images: [back, front], variants: [] };
      expect(preferredMerchImage(accessory)).toEqual(front);
      expect(selectedMerchImage(accessory, {})).toEqual(front);
    },
  );

  it("keeps the back-print view for apparel", () => {
    expect(preferredMerchImage({ ...product, images: [back, front] })).toEqual(back);
  });

  it("retains a usable fallback when the artwork-facing mockup is missing", () => {
    expect(preferredMerchImage({ ...product, kind: "Utility Backpack", images: [back] })).toEqual(back);
  });
});
