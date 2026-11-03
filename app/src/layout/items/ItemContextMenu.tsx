"use client";

import { useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { type ItemSlot, NonActionItemTypes } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import { canSetHotkeys } from "@/libs/combat/hotkeys";
import { nonCombatConsume } from "@/libs/item";
import { fittingSlots, slotName } from "@/libs/itemsPage";
import { needsInventoryRepair } from "@/libs/repair";
import type { UserWithRelations } from "@/routers/profile";

interface ItemContextMenuProps {
  userItem: UserItemWithRelations;
  /** Every carried item, to tell empty slots from ones an equip would swap. */
  allUserItems: UserItemWithRelations[];
  userData: NonNullable<UserWithRelations>;
  getBlockedReason: (userItem: UserItemWithRelations, slot: ItemSlot) => string | null;
  onInspect: (userItemId: string) => void;
  onEquip: (userItemId: string, slot: ItemSlot) => void;
  onUnequip: (userItemId: string, slot: ItemSlot) => void;
  onMerge: (userItem: UserItemWithRelations) => void;
  onSetHotkey?: (userItem: UserItemWithRelations) => void;
  children: React.ReactNode;
}

/** A click right after the menu opened is the end of a long press, not a selection. */
const LONG_PRESS_CLICK_MS = 700;

/**
 * Right-click (and long-press on touch screens) actions for an item. Quick actions run
 * directly; actions with their own dialog or confirmation open the inspector.
 */
export function ItemContextMenu({
  userItem,
  allUserItems,
  userData,
  getBlockedReason,
  onInspect,
  onEquip,
  onUnequip,
  onMerge,
  onSetHotkey,
  children,
}: ItemContextMenuProps) {
  const openedAt = useRef(0);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) openedAt.current = Date.now();
      }}
    >
      <ContextMenuTrigger
        className="contents"
        onClickCapture={(event) => {
          if (Date.now() - openedAt.current < LONG_PRESS_CLICK_MS) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ItemMenuEntries
          userItem={userItem}
          allUserItems={allUserItems}
          userData={userData}
          getBlockedReason={getBlockedReason}
          onInspect={onInspect}
          onEquip={onEquip}
          onUnequip={onUnequip}
          onMerge={onMerge}
          onSetHotkey={onSetHotkey}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ItemMenuEntries({
  userItem,
  allUserItems,
  userData,
  getBlockedReason,
  onInspect,
  onEquip,
  onUnequip,
  onMerge,
  onSetHotkey,
}: Omit<ItemContextMenuProps, "children">) {
  const { item } = userItem;
  const inspect = () => onInspect(userItem.id);
  const equippedIn = userItem.equipped === "NONE" ? null : userItem.equipped;
  // Battle keys fire only for equipped items.
  const canSetHotkey =
    !!onSetHotkey &&
    !!equippedIn &&
    canSetHotkeys() &&
    userItem.quantity > 0 &&
    !NonActionItemTypes.includes(item.itemType);
  const hotkeyEntry = canSetHotkey && (
    <ContextMenuItem onSelect={() => onSetHotkey?.(userItem)}>
      Set hotkey…
    </ContextMenuItem>
  );
  const repairEntry = needsInventoryRepair(userItem) && (
    <ContextMenuItem onSelect={inspect}>Repair…</ContextMenuItem>
  );

  if (equippedIn) {
    return (
      <>
        <ContextMenuLabel>{item.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onUnequip(userItem.id, equippedIn)}>
          Unequip
        </ContextMenuItem>
        <ContextMenuItem onSelect={inspect}>Inspect</ContextMenuItem>
        {hotkeyEntry}
        {repairEntry}
      </>
    );
  }

  const slots = fittingSlots(item);
  const isMeal = item.itemType === "MEAL";
  const canConsume = !isMeal && nonCombatConsume(item, userData);
  const hasVariants =
    ((userItem as UserItemWithVariants).item.variants?.length ?? 0) > 0;
  const drops = item.isEventItem || !item.inShop;
  return (
    <>
      <ContextMenuLabel>
        {item.name}
        {userItem.quantity > 1 ? ` ×${userItem.quantity}` : ""}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={inspect}>Inspect</ContextMenuItem>
      {slots.length > 0 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuLabel>Equip in</ContextMenuLabel>
          {slots.map((slot) => {
            const reason = getBlockedReason(userItem, slot);
            const occupied = allUserItems.some((ui) => ui.equipped === slot);
            return (
              <ContextMenuItem
                key={slot}
                disabled={!!reason}
                title={reason ?? undefined}
                onSelect={() => onEquip(userItem.id, slot)}
              >
                {slotName(slot)} · {occupied ? "swap" : "empty"}
              </ContextMenuItem>
            );
          })}
        </>
      )}
      {hotkeyEntry}
      {(isMeal || canConsume) && (
        <ContextMenuItem onSelect={inspect}>
          {isMeal ? "Eat meal…" : "Consume…"}
        </ContextMenuItem>
      )}
      {(item.canStack || hasVariants || repairEntry) && <ContextMenuSeparator />}
      {item.canStack && (
        <ContextMenuItem onSelect={() => onMerge(userItem)}>
          Merge stacks
        </ContextMenuItem>
      )}
      {item.canStack && userItem.quantity > 1 && (
        <ContextMenuItem onSelect={inspect}>Split stack…</ContextMenuItem>
      )}
      {hasVariants && <ContextMenuItem onSelect={inspect}>Variants…</ContextMenuItem>}
      {repairEntry}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={inspect}>
        {drops ? "Drop…" : "Sell…"}
      </ContextMenuItem>
    </>
  );
}
