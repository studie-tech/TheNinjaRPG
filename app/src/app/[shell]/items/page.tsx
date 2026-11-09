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
import {
  COST_EXTRA_ITEM_SLOT,
  HomeTypeDetails,
  NonActionItemTypes,
} from "@/drizzle/constants";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import { LoadoutHotkeysPanel } from "@/layout/HotkeyControls";
import { BagCapacity, BagTabs } from "@/layout/items/BagTabs";
import { ItemsToolbar } from "@/layout/items/ItemsToolbar";
import { type ItemsPlace, ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import Loader from "@/layout/Loader";
import {
  countsTowardInventoryStorage,
  getHomeStorageBucket,
  getHomeStorageBucketCapacity,
  getInventoryBucket,
  getInventoryBucketCapacity,
  isEquippableUserItem,
} from "@/libs/item";
import { homeStorageBlockReason, homeStorageMoveBlockReason } from "@/libs/itemsPage";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/** Carried inventory, equipment loadouts, and item actions across capacity buckets. */
export default function MyItems() {
  // State
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
    timeDiff,
  } = useRequiredUserData();
  const [activeTab, setActiveTab] = useState("all");
  const [place, setPlace] = useState<ItemsPlace>("backpack");
  const [homeTab, setHomeTab] = useState("all");
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
      onSettled: () => {
        buyItemSlotInFlight.current = false;
      },
    });

  const availableItems = userItems
    ?.filter((ui) => isEquippableUserItem(ui, inventoryTime))
    .map((ui) => ({
      ...ui,
      imbuements: ui.imbuements.filter(
        (i) => !i.craftingFinishedAt || i.craftingFinishedAt < inventoryTime,
      ),
    }));
  // Capacity includes unfinished crafts even though they are absent from the
  // usable-item list. Share the storage rule with server-side capacity guards.
  const carriedItems = userItems?.filter(countsTowardInventoryStorage);
  const bags = (["normal", "event", "materials", "cooking"] as const).map((value) => {
    const count =
      carriedItems?.filter((ui) => getInventoryBucket(ui.item) === value).length ?? 0;
    const max = userData ? getInventoryBucketCapacity(value, userData) : 0;
    return { value, count, max, over: count > max };
  });
  const selectedBag = bags.find((bag) => bag.value === activeTab);

  // Home storage sits beside the backpack while the player can reach it. Furniture stays
  // with the home's decorating.
  const isHomeShown = !!userData && !homeStorageBlockReason(userData);
  const shownPlace: ItemsPlace = isHomeShown ? place : "backpack";
  const homeStorage = userData ? HomeTypeDetails[userData.homeType].storage : 0;
  const storedItems =
    userItems?.filter((ui) => ui.storedAtHome && ui.item.itemType !== "FURNITURE") ??
    [];
  const homeBags = (["normal", "materials", "cooking"] as const).map((value) => {
    const count = storedItems.filter(
      (ui) => getHomeStorageBucket(ui.item) === value,
    ).length;
    const max = getHomeStorageBucketCapacity(value, homeStorage);
    return { value, count, max, over: count > max };
  });
  const selectedHomeBag = homeBags.find((bag) => bag.value === homeTab);
  /** Why a stack cannot move to or from home storage now, using the server's own rules. */
  const homeMoveBlockReason = (userItemId: string, toHome: boolean) =>
    userData && userItems
      ? homeStorageMoveBlockReason({
          rows: userItems,
          userItemId,
          toHome,
          user: userData,
          homeStorage,
        })
      : null;

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
            bag={shownPlace === "home" ? `home:${homeTab}` : activeTab}
            home={
              isHomeShown
                ? {
                    place: shownPlace,
                    onPlaceChange: setPlace,
                    items: storedItems.filter(
                      (ui) =>
                        homeTab === "all" || getHomeStorageBucket(ui.item) === homeTab,
                    ),
                    count: storedItems.length,
                    blockReason: homeMoveBlockReason,
                    status: selectedHomeBag && (
                      <BagCapacity
                        used={selectedHomeBag.count}
                        max={selectedHomeBag.max}
                      />
                    ),
                    bagTabs: (
                      <BagTabs
                        bags={[
                          { value: "all", count: storedItems.length },
                          ...homeBags,
                        ]}
                        active={homeTab}
                        onChange={setHomeTab}
                        storageKey="homeStorageSelection"
                      />
                    ),
                  }
                : undefined
            }
            backpackStatus={
              <div className="flex items-center gap-1">
                {selectedBag && (
                  <BagCapacity used={selectedBag.count} max={selectedBag.max} />
                )}
                {/* Purchased slots extend the Gear bag only. */}
                {activeTab === "normal" && (
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
                bags={[{ value: "all", count: carriedItems?.length ?? 0 }, ...bags]}
                active={activeTab}
                onChange={setActiveTab}
              />
            }
            bagItems={
              availableItems?.filter(
                (ui) =>
                  ui.equipped === "NONE" &&
                  (activeTab === "all" || getInventoryBucket(ui.item) === activeTab),
              ) ?? []
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
