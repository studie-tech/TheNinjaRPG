import { describe, expect, it } from "vitest";
import { selectedMerchImage, selectedMerchVariant } from "@/libs/merch/catalog";
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
