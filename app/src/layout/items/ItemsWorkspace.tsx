"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useItemActions } from "@/hooks/useItemActions";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { EquipmentPreview } from "@/layout/EquipmentPreview";
import { useHotkeyAssignment } from "@/layout/HotkeyControls";
import { BackpackList } from "@/layout/items/BackpackList";
import { EquipmentFigure } from "@/layout/items/EquipmentFigure";
import { ItemContextMenu } from "@/layout/items/ItemContextMenu";
import { ItemInspector } from "@/layout/items/ItemInspector";
import { SlotPicker } from "@/layout/items/SlotPicker";
import { applyActiveVariant } from "@/libs/combat/util";
import { dropTargetsFor, equipLimitReason, slotName } from "@/libs/itemsPage";
import { gearMissingMastery } from "@/libs/mastery";
import { cn } from "@/libs/shadui";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";

/**
 * The Equipped figure beside the backpack, where a slot opens its picker and an item its
 * inspector. Wide containers show them side by side; narrow ones use Equipment and
 * Backpack tabs with panels in a bottom sheet. With a mouse or trackpad, backpack items can
 * be dragged onto fitting slots; every item opens a menu by right-click or long-press.
 */
export function ItemsWorkspace({
  userData,
  userItems,
  bagItems,
  bag,
  backpackStatus,
  bagTabs,
}: ItemsWorkspaceProps) {
  const [opened, setOpened] = useState<{ bag: string; view: ItemsView }>({
    bag,
    view: { kind: "backpack" },
  });
  const [phoneTab, setPhoneTab] = useState("equipment");
  const [dragging, setDragging] = useState<UserItemWithRelations | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backpackRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Toggling an equip twice reverses it on the server, so one change is sent at a time.
  const equipInFlight = useRef(false);
  const hasFinePointer = useMediaQuery("(any-pointer: fine)");

  const { equip, merge, isEquipping } = useItemActions({
    userData,
    useritem: undefined,
    onDone: () => {},
  });
  const equipOnce = (
    input: { userItemId: string; slot?: ItemSlot },
    onSettled?: () => void,
  ) => {
    if (equipInFlight.current) return;
    equipInFlight.current = true;
    // Released by this equip alone; other actions settling must not open the guard.
    equip(input, {
      onSettled: () => {
        equipInFlight.current = false;
        onSettled?.();
      },
    });
  };
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
  // Hidden items show only to content staff, as everywhere else items are listed.
  const choosable = canChangeContent(userData.role)
    ? userItems
    : userItems.filter((ui) => !ui.item.hidden);
  const choosableBag = canChangeContent(userData.role)
    ? bagItems
    : bagItems.filter((ui) => !ui.item.hidden);

  // Panels sit beside the figure when there is room, else in a bottom sheet above the
  // layout's own navigation.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setIsNarrow(entry.contentRect.width < 600);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const openView = (next: ItemsView, opener = document.activeElement) => {
    // Panel controls disappear on navigation; retain the equipment/card trigger.
    if (opener instanceof HTMLElement && !panelRef.current?.contains(opener)) {
      returnFocusRef.current = opener;
    }
    setOpened({ bag, view: next });
  };
  const closeView = () => {
    setOpened({ bag, view: { kind: "backpack" } });
    // Inline panels restore focus after rendering; sheets wait until their focus scope closes.
    const target = returnFocusRef.current;
    if (!isNarrow && target?.isConnected) {
      requestAnimationFrame(() => target.focus());
    }
  };

  // Opening or reselecting a panel moves focus there so Escape and Tab work there.
  useEffect(() => {
    if (opened.view.kind === "backpack") return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [opened]);

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
  // The server refuses gear at its equip limit, and gear whose mastery is unmet once the
  // slot's current item is removed.
  const getBlockedReason = (userItem: UserItemWithRelations, slot: ItemSlot) => {
    const limit = equipLimitReason(userItem, userItems);
    if (limit) return limit;
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
      onInspect={(userItemId, trigger) =>
        openView({ kind: "item", userItemId }, trigger)
      }
      onEquip={(userItemId, slot) => equipOnce({ userItemId, slot })}
      onUnequip={(userItemId, slot) => equipOnce({ userItemId, slot })}
      onMerge={(target) => merge({ itemId: target.itemId })}
      onSetHotkey={setHotkey}
    >
      {trigger}
    </ItemContextMenu>
  );

  const panelTitle =
    view.kind === "slot"
      ? `${slotName(view.slot)} slot`
      : inspected
        ? applyActiveVariant(inspected).name
        : "Item";
  const panel = (
    <>
      {view.kind === "slot" && (
        <SlotPicker
          slot={view.slot}
          userItems={choosable}
          getBlockedReason={getBlockedReason}
          onEquip={(userItemId, slot) => equipOnce({ userItemId, slot })}
          onUnequip={(userItemId, slot) => equipOnce({ userItemId, slot })}
          onInspect={(userItemId) => openView({ kind: "item", userItemId })}
          onShowInBackpack={() => {
            setPhoneTab("backpack");
            returnFocusRef.current = backpackRef.current;
            closeView();
          }}
          onClose={closeView}
          isPending={isEquipping}
        />
      )}
      {inspected && (
        <ItemInspector
          key={inspected.id}
          userItem={inspected}
          allUserItems={userItems}
          userData={userData}
          onClose={closeView}
          onEquip={equipOnce}
          isEquipping={isEquipping}
          onSetHotkey={setHotkey}
          masteryWarning={masteryWarning(inspected)}
        />
      )}
    </>
  );

  return (
    <Tabs
      ref={rootRef}
      value={phoneTab}
      onValueChange={setPhoneTab}
      className="@container"
    >
      {hotkeyDialog}
      <TabsList
        aria-label="Items view"
        className="flex-nowrap gap-1.5 rounded-none bg-transparent px-3 pt-3 pb-0 @min-[600px]:hidden"
      >
        <PhoneTab value="equipment">Equipment</PhoneTab>
        <PhoneTab value="backpack">Backpack · {choosableBag.length}</PhoneTab>
      </TabsList>
      <div className="grid @min-[600px]:grid-cols-[314px_minmax(0,1fr)]">
        {/* Keep both panels mounted for the wide layout and durable opener refs. */}
        <TabsContent
          value="equipment"
          forceMount
          tabIndex={isNarrow ? 0 : -1}
          className={cn(
            "mt-0 min-w-0 p-3",
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
                equipOnce({ userItemId, slot });
              }}
              wrapTile={(_slot, userItem, tile) =>
                userItem ? withMenu(userItem, tile) : tile
              }
            />
          </div>
        </TabsContent>
        <TabsContent
          ref={backpackRef}
          value="backpack"
          forceMount
          tabIndex={isNarrow ? 0 : -1}
          className={cn(
            "mt-0 min-w-0 overflow-y-auto border-t-2 border-dashed bg-poppopover p-3 @min-[600px]:max-h-[600px] @min-[600px]:border-t-0 @min-[600px]:border-l-2",
            phoneTab === "equipment" && "@max-[600px]:hidden",
            hasPanel && !isNarrow && "@min-[600px]:hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-2xl text-foreground">Backpack</h2>
            {backpackStatus}
          </div>
          {bagTabs && <div className="mt-1 mb-3">{bagTabs}</div>}
          <BackpackList
            items={bagItems}
            userData={userData}
            selectedId={inspected?.id}
            onSelect={(userItemId) => openView({ kind: "item", userItemId })}
            onDragItem={hasFinePointer ? setDragging : undefined}
            wrapCard={withMenu}
          />
        </TabsContent>
        {hasPanel && !isNarrow && (
          <div
            ref={panelRef}
            data-items-panel
            className="col-start-2 row-start-1 max-h-[600px] min-w-0 overflow-y-auto border-l-2 border-dashed bg-poppopover p-3"
          >
            {panel}
          </div>
        )}
      </div>
      {isNarrow && (
        <Sheet open={hasPanel} onOpenChange={(open) => !open && closeView()}>
          <SheetContent
            ref={panelRef}
            side="bottom"
            // The panels draw their own close button in their header.
            showCloseButton={false}
            className="max-h-[85dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none"
            // Focus the sheet itself so the close button does not open with a focus ring.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (returnFocusRef.current?.isConnected) {
                event.preventDefault();
                returnFocusRef.current.focus();
              }
            }}
            // The sheet's strict containment would ignore the panel's height; keep it
            // content-sized up to the maximum.
            style={{ contain: "layout paint" }}
          >
            <SheetTitle className="sr-only">{panelTitle}</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </Tabs>
  );
}

/** Uses shared tab semantics and focus handling for the compact inventory view switcher. */
function PhoneTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 flex-1 rounded-lg bg-muted font-semibold text-foreground text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

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
  /** Shown beside the Backpack heading: the bag's capacity and slot purchase. */
  backpackStatus?: React.ReactNode;
  /** Shown under the Backpack heading: the bag switcher. */
  bagTabs?: React.ReactNode;
}
