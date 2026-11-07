"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UserItemWithRelations } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import { applyActiveVariant, calcItemSellingPrice } from "@/libs/item";
import { bulkSellTotals, warnedItems } from "@/libs/itemsPage";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";

/**
 * The two confirmations of a bulk sell. The review lists every selected stack with its art,
 * name, quantity and what it gives; ticks there edit the selection. When a Rare or better
 * stack is still ticked, a second step shows only those, larger, before the final Confirm.
 */
export function BulkSellDialog({
  items,
  selectedIds,
  userData,
  isSelling,
  onToggle,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: BulkSellDialogProps) {
  const [rareIds, setRareIds] = useState<string[] | null>(null);
  const structures = userData.village?.structures;
  const ticked = items.filter((ui) => selectedIds.includes(ui.id));
  const warned = warnedItems(ticked);
  const totals = bulkSellTotals(ticked, userData, structures);
  const rows = rareIds ? items.filter((ui) => rareIds.includes(ui.id)) : items;
  const isRareStep = rareIds !== null;
  const confirm = () => onConfirm(ticked.map((ui) => ui.id));

  return (
    <Dialog open onOpenChange={(open) => !open && !isSelling && onClose()}>
      <DialogContent
        aria-busy={isSelling}
        closeDisabled={isSelling}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {isRareStep
              ? "These are Rare or better"
              : `Sell or drop ${ticked.length} item${ticked.length === 1 ? "" : "s"}`}
          </DialogTitle>
          <DialogDescription className={cn(isRareStep && "text-destructive")}>
            {isRareStep ? (
              <>
                <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />
                They can't be bought back. Untick any you want to keep.
              </>
            ) : (
              "Untick anything you want to keep."
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1">
          {rows.map((userItem) => (
            <BulkSellRow
              key={userItem.id}
              userItem={userItem}
              price={calcItemSellingPrice(userData, userItem, structures)}
              isTicked={selectedIds.includes(userItem.id)}
              isLarge={isRareStep}
              disabled={isSelling}
              onToggle={() => !isSelling && onToggle(userItem.id)}
            />
          ))}
        </ul>
        <p className="font-semibold text-sm" aria-live="polite">
          {bulkSellSummary(totals)}
        </p>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={isSelling}
            onClick={() => (isRareStep ? setRareIds(null) : onClose())}
          >
            Back
          </Button>
          {!isRareStep && warned.length > 0 ? (
            <Button
              disabled={ticked.length === 0 || isSelling}
              onClick={() => setRareIds(warned.map((ui) => ui.id))}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={ticked.length === 0 || isSelling}
              loading={isSelling}
              onClick={confirm}
            >
              {isRareStep ? "Confirm" : "Sell / drop"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One stack in a confirmation, with a tick that keeps it in the selection. */
function BulkSellRow({
  userItem,
  price,
  isTicked,
  isLarge,
  disabled,
  onToggle,
}: {
  userItem: UserItemWithRelations;
  price: number;
  isTicked: boolean;
  isLarge: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const look = applyActiveVariant(userItem);
  const id = `bulk-sell-${userItem.id}`;
  return (
    <li
      aria-label={look.name}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card p-1.5",
        !isTicked && "opacity-50",
      )}
    >
      <Checkbox
        id={id}
        checked={isTicked}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={`Keep selling ${look.name}`}
        className="h-5 w-5"
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("relative shrink-0", isLarge ? "h-16 w-16" : "h-10 w-10")}>
          <ContentImage
            image={look.image}
            alt={look.name}
            rarity={userItem.item.rarity}
            className={isLarge ? "h-16 w-16" : "h-10 w-10"}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-sm">{look.name}</span>
          <span
            className={cn(
              "block text-xs font-medium",
              rarityTextClass[userItem.item.rarity],
            )}
          >
            {rarityLabel[userItem.item.rarity]}
            {userItem.quantity > 1 && ` · ×${userItem.quantity}`}
          </span>
        </span>
        <span className="shrink-0 font-semibold text-xs">
          {price > 0 ? `+${price.toLocaleString()} ryo` : "Drop"}
        </span>
      </label>
    </li>
  );
}

/** "Sell for 3,400 ryo · Drop 3", leaving out the parts that do not apply. */
export const bulkSellSummary = (totals: ReturnType<typeof bulkSellTotals>) =>
  [
    totals.sellCount > 0 && `Sell for ${totals.ryo.toLocaleString()} ryo`,
    totals.dropCount > 0 && `Drop ${totals.dropCount}`,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing selected";

interface BulkSellDialogProps {
  /** Every stack the review opened with, ticked or not. */
  items: UserItemWithRelations[];
  selectedIds: string[];
  userData: NonNullable<UserWithRelations>;
  isSelling: boolean;
  onToggle: (userItemId: string) => void;
  onConfirm: (userItemIds: string[]) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}
