"use client";

import { Button } from "@/components/ui/button";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useCosmetics } from "@/hooks/useCosmetics";
import Confirm from "@/layout/Confirm";
import { isEquippableUserItem } from "@/libs/item";
import { fittingSlots } from "@/libs/itemsPage";

/** Confirm permanent consumption before unlocking an equipment appearance. */
export function MakeCosmetic({ userItem }: { userItem: UserItemWithRelations }) {
  const { wardrobe, make, error } = useCosmetics();
  const owned = wardrobe.data?.owned.some((entry) => entry.itemId === userItem.itemId);
  if (!fittingSlots(userItem.item).length) return null;
  const blocked =
    userItem.equipped !== "NONE" ||
    !isEquippableUserItem(userItem) ||
    userItem.imbuements.length > 0 ||
    userItem.quantity <= 0;
  return (
    <div>
      <Confirm
        title="Make Cosmetic"
        tone="destructive"
        keepOpenOnAccept
        isLoading={make.isPending}
        disabled={blocked || owned || !wardrobe.data}
        button={
          <Button variant="outline">
            {owned ? "Already unlocked" : "Make Cosmetic"}
          </Button>
        }
        onAccept={(_event, { close }) =>
          make.mutate(
            { userItemId: userItem.id, expectedQuantity: userItem.quantity },
            {
              onSuccess: (data) => {
                if (data.success) close();
              },
            },
          )
        }
      >
        <p>
          Consume one copy of {userItem.item.name} permanently to unlock its appearance.
          Its upgrades, experience and other instance properties are lost. Your unlocked
          variants will be available in the Cosmetic tab.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </Confirm>
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Unequip the item, take it into your backpack and remove its imbuements first.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
