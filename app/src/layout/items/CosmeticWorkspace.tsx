"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ItemSlot } from "@/drizzle/constants";
import { IMG_EQUIP_SILHOUETTE } from "@/drizzle/constants";
import { useCosmetics } from "@/hooks/useCosmetics";
import ContentImage from "@/layout/ContentImage";
import { EquipmentPreview } from "@/layout/EquipmentPreview";
import Image from "@/layout/Image";
import { EQUIPMENT_LAYOUT } from "@/layout/items/EquipmentFigure";
import Loader from "@/layout/Loader";
import { fittingSlots, slotName } from "@/libs/itemsPage";
import type { SpriteUser } from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";

/** Choose and remove independent visual overrides using the equipment slot layout. */
export function CosmeticWorkspace({ user }: { user: SpriteUser }) {
  const [slot, setSlot] = useState<ItemSlot>("HEAD");
  const { wardrobe, select, error } = useCosmetics();
  if (wardrobe.isPending) return <Loader explanation="Loading cosmetics" />;
  if (!wardrobe.data)
    return (
      <div role="alert">
        Could not load cosmetics.{" "}
        <Button onClick={() => void wardrobe.refetch()}>Retry</Button>
      </div>
    );
  const { owned, slots, unlocks } = wardrobe.data;
  const current = slots.find((entry) => entry.slot === slot);
  const candidates = owned.filter((entry) => fittingSlots(entry.item).includes(slot));
  const isOccupied = user.items?.some(
    (entry) => entry.equipped === slot && (entry.quantity ?? 0) > 0,
  );
  return (
    <div className="grid gap-4 p-3 sm:grid-cols-[290px_minmax(0,1fr)]">
      <div>
        <EquipmentPreview user={{ ...user, cosmeticSlots: slots }} items={user.items} />
        <div className="relative mx-auto w-full max-w-[290px]">
          <Image
            src={IMG_EQUIP_SILHOUETTE}
            alt="Cosmetic equipment slots"
            width={290}
            height={461}
            className="w-full opacity-50"
          />
          {EQUIPMENT_LAYOUT.map((entry) => {
            const selected = slots.find((selection) => selection.slot === entry.slot);
            const name = selected?.variant?.name ?? selected?.item?.name;
            return (
              <button
                key={entry.slot}
                type="button"
                data-slot={entry.slot}
                aria-label={`${slotName(entry.slot)} cosmetic${name ? `: ${name}` : ", empty"}`}
                aria-current={slot === entry.slot ? "true" : undefined}
                onClick={() => setSlot(entry.slot)}
                className={cn(
                  "absolute flex aspect-square w-1/5 items-center justify-center rounded-xl border-2 bg-card p-1 text-xs",
                  entry.pos,
                  slot === entry.slot && "ring-4 ring-primary/60",
                )}
              >
                {selected?.item ? (
                  <ContentImage
                    image={selected.variant?.image ?? selected.item.image}
                    alt={name ?? entry.label}
                    className="h-full w-full"
                    hideBorder
                  />
                ) : (
                  entry.label
                )}
              </button>
            );
          })}
        </div>
      </div>
      <section
        aria-label={`${slotName(slot)} cosmetic choices`}
        aria-busy={select.isPending}
        className="flex flex-col gap-3"
      >
        <h2 className="font-bold text-xl">{slotName(slot)}</h2>
        {current && (
          <div className="rounded-lg border p-3">
            <p>{current.variant?.name ?? current.item?.name}</p>
            {!isOccupied && (
              <p className="text-sm text-muted-foreground">
                Saved. Equip gear in this slot to display the cosmetic.
              </p>
            )}
            <Button
              variant="outline"
              disabled={select.isPending}
              onClick={() =>
                select.mutate({ slot: slot as Exclude<ItemSlot, "NONE">, itemId: null })
              }
            >
              Remove cosmetic
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {candidates.length === 0 && (
          <p>
            Make an item cosmetic from your backpack to unlock its appearance for this
            slot.
          </p>
        )}
        {candidates.map(({ item }) => (
          <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3">
            {[
              null,
              ...item.variants.filter((variant) =>
                unlocks.some((unlock) => unlock.variantId === variant.id),
              ),
            ].map((variant) => {
              const isSelected =
                current?.itemId === item.id &&
                current.variantId === (variant?.id ?? null);
              return (
                <Button
                  key={variant?.id ?? "base"}
                  variant={isSelected ? "secondary" : "outline"}
                  className="h-auto justify-start gap-3 whitespace-normal text-left"
                  disabled={select.isPending || isSelected}
                  onClick={() =>
                    select.mutate({
                      slot: slot as Exclude<ItemSlot, "NONE">,
                      itemId: item.id,
                      variantId: variant?.id ?? null,
                    })
                  }
                >
                  <ContentImage
                    image={variant?.image ?? item.image}
                    alt={variant?.name ?? item.name}
                    className="h-12 w-12 shrink-0"
                    hideBorder
                  />
                  {variant?.name ?? item.name}
                  {isSelected ? " · Selected" : ""}
                </Button>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
