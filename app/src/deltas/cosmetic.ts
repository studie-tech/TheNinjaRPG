import type { RouterOutputs } from "@/app/_trpc/client";

type Wardrobe = RouterOutputs["cosmetic"]["get"];
type Selection = { slot: string; itemId: string | null; variantId: string | null };

/** Replace only the confirmed slot using already loaded ownership and variant data. */
export const getCosmeticSlots = (
  slots: Wardrobe["slots"],
  owned: Wardrobe["owned"],
  input: Selection,
) => {
  const remaining = slots.filter((entry) => entry.slot !== input.slot);
  if (!input.itemId) return remaining;
  const cosmetic = owned.find((entry) => entry.itemId === input.itemId);
  if (!cosmetic) return;
  return [
    ...remaining,
    {
      userId: cosmetic.userId,
      slot: input.slot as Wardrobe["slots"][number]["slot"],
      itemId: cosmetic.itemId,
      variantId: input.variantId,
      item: cosmetic.item,
      variant:
        cosmetic.item.variants.find((entry) => entry.id === input.variantId) ?? null,
    },
  ];
};
