"use client";

import { CircleFadingArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COST_EXTRA_ITEM_SLOT, NonActionItemTypes } from "@/drizzle/constants";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import { LoadoutHotkeysPanel } from "@/layout/HotkeyControls";
import { BagCapacity, BagTabs } from "@/layout/items/BagTabs";
import { ItemsToolbar } from "@/layout/items/ItemsToolbar";
import { ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import Loader from "@/layout/Loader";
import {
  calcMaxCookingItems,
  calcMaxEventItems,
  calcMaxItems,
  calcMaxMaterials,
  countsTowardInventoryStorage,
  getInventoryBucket,
  isEquippableUserItem,
} from "@/libs/item";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/** Carried inventory, equipment loadouts, and item actions across capacity buckets. */
export default function MyItems() {
  // State
  const availableTabs = ["all", "normal", "event", "materials", "cooking"];
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
    timeDiff,
  } = useRequiredUserData();
  const [activeTab, setActiveTab] = useState<(typeof availableTabs)[number]>("all");
  const [isBuyItemSlotOpen, setIsBuyItemSlotOpen] = useState(false);
  const buyItemSlotInFlight = useRef(false);

  // tRPC utils
  const utils = api.useUtils();

  // Data from DB
  const {
    data: userItems,
    dataUpdatedAt,
    isPending: isLoadingItems,
    isFetching,
  } = api.item.getUserItemsWithVariants.useQuery(undefined, {
    enabled: !!userData,
    // Items are granted by many flows (quests, battles, queued jobs, other players' trades)
    // that cannot all invalidate this cache, so re-read the inventory on every visit.
    refetchOnMount: "always",
  });

  // A deadline must refresh the query timestamp even when the inventory rows are unchanged.
  // Render-time Date reads alone can be memoized by React Compiler.
  useRefreshAt(
    userItems?.flatMap((item) => [
      item.craftingFinishedAt,
      ...item.imbuements.map((imbuement) => imbuement.craftingFinishedAt),
    ]) ?? [],
    () => {
      void utils.item.getUserItemsWithVariants.invalidate();
    },
    timeDiff,
  );
  const inventoryTime = new Date(dataUpdatedAt - timeDiff);

  // Mutations
  const { mutate: buyItemSlot, isPending: isBuyingItemSlot } =
    api.blackmarket.buyItemSlot.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(undefined, { revision, delta: data.userDelta });
          setIsBuyItemSlotOpen(false);
        }
      },
      onError: (error) => {
        showMutationToast({
          success: false,
          message: error.message,
          variant: "destructive",
        });
      },
      onSettled: () => {
        buyItemSlotInFlight.current = false;
      },
    });

  // Subtitle
  const availableItems = userItems
    ?.filter((ui) => isEquippableUserItem(ui, inventoryTime))
    .map((ui) => ({
      ...ui,
      imbuements: ui.imbuements.filter(
        (i) => !i.craftingFinishedAt || i.craftingFinishedAt < inventoryTime,
      ),
    }));
  const normalItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "normal",
  );
  const eventItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "event",
  );
  const materialsItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "materials",
  );
  const cookingItems = availableItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "cooking",
  );

  // Capacity includes unfinished crafts even though they are absent from the
  // usable-item list. Share the storage rule with server-side capacity guards.
  const carriedItems = userItems?.filter(countsTowardInventoryStorage);
  const normalItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "normal",
  ).length;
  const eventItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "event",
  ).length;
  const materialsItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "materials",
  ).length;
  const cookingItemCount = carriedItems?.filter(
    (ui) => getInventoryBucket(ui.item) === "cooking",
  ).length;

  // Calculate inventory limits
  const maxNormalItems = userData ? calcMaxItems(userData) : 0;
  const maxEventItems = userData ? calcMaxEventItems(userData) : 0;
  const maxMaterials = userData ? calcMaxMaterials(userData) : 0;
  const maxCookingItems = userData ? calcMaxCookingItems(userData) : 0;

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isLoadingItems) return <Loader explanation="Loading items" />;

  // Can afford removing
  const canAfford = userData.reputationPoints >= COST_EXTRA_ITEM_SLOT;

  return (
    <>
      <ContentBox title="Items" padding={false}>
        <ItemsToolbar userData={userData} userItems={userItems} />
        {isFetching && <Loader explanation="Refreshing items" />}
        {/* Wait for the updated equipment state before accepting another action. */}
        <div inert={isFetching}>
          <ItemsWorkspace
            userData={userData}
            userItems={availableItems ?? []}
            bag={activeTab}
            backpackStatus={
              <div className="flex items-center gap-1">
                {activeTab === "all" ? (
                  <BagCapacity
                    used={normalItemCount ?? 0}
                    max={maxNormalItems}
                    bag="Gear"
                  />
                ) : (
                  <BagCapacity
                    used={
                      (activeTab === "normal"
                        ? normalItemCount
                        : activeTab === "event"
                          ? eventItemCount
                          : activeTab === "materials"
                            ? materialsItemCount
                            : cookingItemCount) ?? 0
                    }
                    max={
                      activeTab === "normal"
                        ? maxNormalItems
                        : activeTab === "event"
                          ? maxEventItems
                          : activeTab === "materials"
                            ? maxMaterials
                            : maxCookingItems
                    }
                  />
                )}
                {/* Purchased slots extend the Gear bag only. */}
                {(activeTab === "normal" || activeTab === "all") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Buy an extra Gear bag slot"
                    hoverText="Buy an extra Gear bag slot"
                    aria-busy={isBuyingItemSlot}
                    disabled={isBuyingItemSlot}
                    loading={isBuyingItemSlot}
                    onClick={() => setIsBuyItemSlotOpen(true)}
                  >
                    <CircleFadingArrowUp className="h-5 w-5" />
                  </Button>
                )}
              </div>
            }
            bagTabs={
              <BagTabs
                bags={[
                  {
                    value: "all",
                    count:
                      (normalItemCount ?? 0) +
                      (eventItemCount ?? 0) +
                      (materialsItemCount ?? 0) +
                      (cookingItemCount ?? 0),
                  },
                  { value: "normal", count: normalItemCount ?? 0 },
                  { value: "event", count: eventItemCount ?? 0 },
                  { value: "materials", count: materialsItemCount ?? 0 },
                  { value: "cooking", count: cookingItemCount ?? 0 },
                ]}
                active={activeTab}
                onChange={setActiveTab}
              />
            }
            bagItems={
              (activeTab === "all"
                ? availableItems
                : activeTab === "normal"
                  ? normalItems
                  : activeTab === "event"
                    ? eventItems
                    : activeTab === "materials"
                      ? materialsItems
                      : cookingItems
              )?.filter((ui) => ui.equipped === "NONE") ?? []
            }
          />
        </div>
      </ContentBox>
      <Dialog
        open={isBuyItemSlotOpen}
        onOpenChange={(open) => {
          if (!isBuyingItemSlot) setIsBuyItemSlotOpen(open);
        }}
      >
        <DialogContent
          aria-busy={isBuyingItemSlot}
          onEscapeKeyDown={(event) => {
            if (isBuyingItemSlot) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (isBuyingItemSlot) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Extra Item Slot</DialogTitle>
            <DialogDescription>
              Purchase an extra item slot for {COST_EXTRA_ITEM_SLOT} reputation points.
              You currently have {userData.reputationPoints} reputation{" "}
              {userData.reputationPoints === 1 ? "point" : "points"}.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-8" aria-live="polite" aria-atomic="true">
            {isBuyingItemSlot ? (
              <Loader explanation="Purchasing" noPadding />
            ) : canAfford ? (
              <p>Are you sure you want to complete this purchase?</p>
            ) : (
              <p>
                You need {COST_EXTRA_ITEM_SLOT - userData.reputationPoints} more
                reputation points.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!canAfford || isBuyingItemSlot}
              aria-busy={isBuyingItemSlot}
              loading={isBuyingItemSlot}
              onClick={() => {
                if (!canAfford || buyItemSlotInFlight.current) return;
                buyItemSlotInFlight.current = true;
                buyItemSlot();
              }}
            >
              {isBuyingItemSlot
                ? "Purchasing"
                : canAfford
                  ? `Purchase for ${COST_EXTRA_ITEM_SLOT} reps`
                  : `Need ${COST_EXTRA_ITEM_SLOT - userData.reputationPoints} more reps`}
            </Button>
            <Button
              variant="secondary"
              disabled={isBuyingItemSlot}
              onClick={() => setIsBuyItemSlotOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {userItems && (
        // Keep hotkey setup out of the way without a mouse or trackpad.
        <div className="not-any-pointer-fine:hidden">
          <ContentBox
            title="Battle Hotkeys"
            subtitle="Keys for your equipped items"
            initialBreak={true}
          >
            <LoadoutHotkeysPanel
              kind="item"
              actions={userItems
                .filter(
                  (ui) =>
                    ui.equipped !== "NONE" &&
                    ui.quantity > 0 &&
                    !NonActionItemTypes.includes(ui.item.itemType),
                )
                .map((ui) => ({
                  id: ui.itemId,
                  name: ui.item.name,
                  hidden: ui.item.hidden,
                }))
                .filter(
                  (action, index, list) =>
                    list.findIndex((other) => other.id === action.id) === index,
                )}
            />
          </ContentBox>
        </div>
      )}
    </>
  );
}
