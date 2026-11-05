import { merchProductSchema } from "@/validators/merch";
import { getMerchDesign, merchDescriptionLead } from "./catalog";
import mockups from "./preview-catalog.json";
import { isApparelMerchKind, merchPrintTag } from "./products";

/** Development selections are review options, not a live stock or sizing guarantee. */
export function createMerchPreviewCatalog() {
  return mockups.map((mockup) => {
    const design = getMerchDesign(mockup.designKey);
    if (!design) throw new Error("A merch preview references an unknown design.");
    const colour = mockup.kind === "Straw Lid Water Bottle" ? "White" : "Black";
    const sizes = isApparelMerchKind(mockup.kind)
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
      description: merchDescriptionLead(design.graphic),
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
      tags: [merchPrintTag(mockup.kind)],
      preview: true,
    });
  });
}
