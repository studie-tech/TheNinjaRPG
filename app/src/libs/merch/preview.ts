import { merchProductSchema } from "@/validators/merch";
import { getMerchDesign } from "./catalog";
import mockups from "./preview-catalog.json";

/** Development selections are review options, not a live stock or sizing guarantee. */
export function createMerchPreviewCatalog() {
  return mockups.map((mockup) => {
    const design = getMerchDesign(mockup.designKey);
    if (!design) throw new Error("A merch preview references an unknown design.");
    const apparel = /T-Shirt|Hoodie|Sweatshirt/.test(mockup.kind);
    const colour = mockup.kind === "Straw Lid Water Bottle" ? "White" : "Black";
    const sizes = apparel
      ? ["S", "M", "L", "XL", "2XL"]
      : mockup.kind === "Black Glossy Mug"
        ? ["11 oz", "15 oz"]
        : mockup.kind === "Straw Lid Water Bottle"
          ? ["32 oz"]
          : ["One size"];
    return merchProductSchema.parse({
      id: `preview:${mockup.handle}`,
      handle: mockup.handle,
      title: `${design.name} — ${mockup.kind}`,
      designKey: design.key,
      designName: design.name,
      category: design.category,
      kind: mockup.kind,
      description: design.graphic.split(/(?<=[.!?])\s+/)[0],
      images: [{ url: mockup.image, alt: `${design.name} on ${mockup.kind}` }],
      options: [
        { name: "Color", values: [colour] },
        { name: "Size", values: sizes },
      ],
      variants: sizes.map((size) => ({
        id: `preview:${mockup.handle}:${size}`,
        title: `${colour} / ${size}`,
        available: true,
        price: null,
        selectedOptions: [
          { name: "Color", value: colour },
          { name: "Size", value: size },
        ],
      })),
      tags: [apparel ? "Back print" : "Accessory"],
      preview: true,
    });
  });
}
