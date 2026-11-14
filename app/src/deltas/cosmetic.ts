import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserItem } from "@/drizzle/schema";

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

/** Consume exactly the confirmed source quantity, withholding stale inventory snapshots. */
export const getCosmeticConsumedInventory = <T extends UserItem>(
  rows: T[],
  id: string,
  before: number,
  quantity: number,
) => {
  if (rows.find((entry) => entry.id === id)?.quantity !== before) return;
  return rows.flatMap((entry) =>
    entry.id !== id ? [entry] : quantity > 0 ? [{ ...entry, quantity }] : [],
  );
};
