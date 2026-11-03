"use client";

import { useEffect, useRef, useState } from "react";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useItemActions } from "@/hooks/useItemActions";
import { EquipmentPreview } from "@/layout/EquipmentPreview";
import { useHotkeyAssignment } from "@/layout/HotkeyControls";
import { BackpackList } from "@/layout/items/BackpackList";
import { EquipmentFigure } from "@/layout/items/EquipmentFigure";
import { ItemContextMenu } from "@/layout/items/ItemContextMenu";
import { ItemInspector } from "@/layout/items/ItemInspector";
import { SlotPicker } from "@/layout/items/SlotPicker";
import { dropTargetsFor } from "@/libs/itemsPage";
import { gearMissingMastery } from "@/libs/mastery";
import { cn } from "@/libs/shadui";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import type { UserWithRelations } from "@/routers/profile";

/** What the side panel shows: the backpack, one slot's picker, or one item. */
export type ItemsView =
  | { kind: "backpack" }
  | { kind: "slot"; slot: ItemSlot }
  | { kind: "item"; userItemId: string };

interface ItemsWorkspaceProps {
  userData: NonNullable<UserWithRelations>;
  /** Every carried, usable item across bags. */
  userItems: UserItemWithRelations[];
  /** Unequipped items of the selected bag. */
  bagItems: UserItemWithRelations[];
  /** The selected bag; panels opened in another bag close on a switch. */
  bag: string;
}

/**
 * The Equipped figure beside the backpack, where a slot opens its picker and an item its
 * inspector. Wide containers show them side by side; narrow ones use Equipment and
 * Backpack tabs with panels as bottom sheets. Items can be dragged onto fitting slots and
 * opened in a menu by right-click or long-press.
 */
export function ItemsWorkspace({
  userData,
  userItems,
  bagItems,
  bag,
}: ItemsWorkspaceProps) {
  const [opened, setOpened] = useState<{ bag: string; view: ItemsView }>({
    bag,
    view: { kind: "backpack" },
  });
  const [phoneTab, setPhoneTab] = useState<"equipment" | "backpack">("equipment");
  const [dragging, setDragging] = useState<UserItemWithRelations | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const { equip, merge } = useItemActions({
    userData,
    useritem: undefined,
    onDone: () => {},
  });
  const {
    hotkeys,
    assign: assignHotkey,
    dialog: hotkeyDialog,
  } = useHotkeyAssignment(
    Object.fromEntries(userItems.map((ui) => [ui.itemId, ui.item.name])),
  );

  // A panel belongs to the bag it was opened in, and an item panel to an item still carried.
  const view: ItemsView =
    opened.bag !== bag ||
    (opened.view.kind === "item" &&
      !userItems.some(
        (ui) => opened.view.kind === "item" && ui.id === opened.view.userItemId,
      ))
      ? { kind: "backpack" }
      : opened.view;
  const inspected =
    view.kind === "item"
      ? userItems.find((ui) => ui.id === view.userItemId)
      : undefined;
  const hasPanel = view.kind !== "backpack";

  const openView = (next: ItemsView) => {
    if (document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    setOpened({ bag, view: next });
  };
  const closeView = () => {
    setOpened({ bag, view: { kind: "backpack" } });
    // Return keyboard focus to whatever opened the panel.
    const opener = openerRef.current;
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  };

  // Move focus into a newly opened panel so Escape and Tab start there.
  const panelKey =
    view.kind === "slot" ? view.slot : view.kind === "item" ? view.userItemId : "";
  useEffect(() => {
    if (!panelKey) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [panelKey]);

  // Battles unequip worn gear and hide weapons whose mastery gate is unmet; activated
  // skills count toward masteries as they do there.
  const wearer = { ...userData, items: userItems };
  const masteryWarning = (userItem: UserItemWithRelations) => {
    if (userItem.equipped === "NONE") return undefined;
    if (!hasRequiredSkill(userItem.item, wearer)) {
      return "Unusable in battle: activate the required skill";
    }
    const missing = gearMissingMastery(userItem, wearer);
    if (!missing) return undefined;
    const current = Math.floor(missing.current).toLocaleString();
    return `Unusable in battle: requires ${missing.required.toLocaleString()} ${missing.label} (you have ${current})`;
  };
  // The server refuses gear whose mastery is unmet once the slot's current item is removed.
  const getBlockedReason = (userItem: UserItemWithRelations, slot: ItemSlot) => {
    const missing = gearMissingMastery(userItem, {
      ...wearer,
      items: userItems.filter((ui) => ui.equipped !== slot),
    });
    return missing
      ? `Needs ${missing.required.toLocaleString()} ${missing.label}`
      : null;
  };

  const setHotkey = (userItem: UserItemWithRelations) =>
    assignHotkey({ id: userItem.itemId, name: userItem.item.name, kind: "item" });
  const withMenu = (userItem: UserItemWithRelations, trigger: React.ReactNode) => (
    <ItemContextMenu
      userItem={userItem}
      allUserItems={userItems}
      userData={userData}
      getBlockedReason={getBlockedReason}
      onInspect={(userItemId) => openView({ kind: "item", userItemId })}
      onEquip={(userItemId, slot) => equip({ userItemId, slot })}
      onUnequip={(userItemId, slot) => equip({ userItemId, slot })}
      onMerge={(target) => merge({ itemId: target.itemId })}
      onSetHotkey={setHotkey}
    >
      {trigger}
    </ItemContextMenu>
  );

  return (
    <div className="@container">
      {hotkeyDialog}
      <div
        role="tablist"
        aria-label="Items view"
        className="flex gap-1.5 px-3 pt-3 @min-[600px]:hidden"
      >
        <PhoneTab
          selected={phoneTab === "equipment"}
          onSelect={() => setPhoneTab("equipment")}
        >
          Equipment
        </PhoneTab>
        <PhoneTab
          selected={phoneTab === "backpack"}
          onSelect={() => setPhoneTab("backpack")}
        >
          Backpack · {bagItems.length}
        </PhoneTab>
      </div>
      <div className="grid @min-[600px]:grid-cols-[314px_minmax(0,1fr)]">
        <div
          className={cn(
            "min-w-0 p-3",
            phoneTab === "backpack" && "@max-[600px]:hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-2xl text-foreground">Equipped</h2>
            <EquipmentPreview user={userData} items={userItems} />
          </div>
          <div className="relative mx-auto w-full max-w-[290px]">
            <EquipmentFigure
              userItems={userItems}
              activeSlot={view.kind === "slot" ? view.slot : undefined}
              dropTargets={
                dragging ? dropTargetsFor(dragging, getBlockedReason) : undefined
              }
              masteryWarning={masteryWarning}
              hotkeys={hotkeys.byAction}
              onSlotClick={(slot) => openView({ kind: "slot", slot })}
              onDropItem={(userItemId, slot) => {
                setDragging(null);
                equip({ userItemId, slot });
              }}
              onDragItem={setDragging}
              wrapTile={(_slot, userItem, tile) =>
                userItem ? withMenu(userItem, tile) : tile
              }
            />
          </div>
        </div>
        <div
          className={cn(
            "min-w-0 overflow-y-auto border-t-2 border-dashed bg-poppopover p-3 @min-[600px]:max-h-[600px] @min-[600px]:border-t-0 @min-[600px]:border-l-2",
            phoneTab === "equipment" && "@max-[600px]:hidden",
            hasPanel && "@min-[600px]:hidden",
          )}
        >
          <h2 className="mb-2 font-bold text-2xl text-foreground">Backpack</h2>
          <BackpackList
            items={bagItems}
            userData={userData}
            selectedId={inspected?.id}
            onSelect={(userItemId) => openView({ kind: "item", userItemId })}
            onDragItem={setDragging}
            wrapCard={withMenu}
          />
        </div>
        {hasPanel && (
          <>
            <button
              type="button"
              aria-label="Close panel"
              tabIndex={-1}
              className="fixed inset-0 z-40 bg-black/40 @min-[600px]:hidden"
              onClick={closeView}
            />
            <div
              ref={panelRef}
              data-items-panel
              className="min-w-0 bg-poppopover p-3 @max-[600px]:fixed @max-[600px]:inset-x-0 @max-[600px]:bottom-0 @max-[600px]:z-50 @max-[600px]:max-h-[85dvh] @max-[600px]:overflow-y-auto @max-[600px]:rounded-t-2xl @max-[600px]:border-primary @max-[600px]:border-t-2 @max-[600px]:shadow-2xl @min-[600px]:col-start-2 @min-[600px]:row-start-1 @min-[600px]:max-h-[600px] @min-[600px]:overflow-y-auto @min-[600px]:border-l-2 @min-[600px]:border-dashed"
            >
              {view.kind === "slot" && (
                <SlotPicker
                  slot={view.slot}
                  userItems={userItems}
                  getBlockedReason={getBlockedReason}
                  onEquip={(userItemId, slot) => equip({ userItemId, slot })}
                  onUnequip={(userItemId, slot) => equip({ userItemId, slot })}
                  onInspect={(userItemId) => openView({ kind: "item", userItemId })}
                  onShowInBackpack={() => {
                    setPhoneTab("backpack");
                    closeView();
                  }}
                  onClose={closeView}
                />
              )}
              {inspected && (
                <ItemInspector
                  key={inspected.id}
                  userItem={inspected}
                  allUserItems={userItems}
                  userData={userData}
                  onClose={closeView}
                  onSetHotkey={setHotkey}
                  masteryWarning={masteryWarning(inspected)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhoneTab({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "h-11 flex-1 rounded-lg font-semibold text-sm",
        selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}
