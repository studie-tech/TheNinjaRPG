"use client";

import { BookOpen, Gem, Hammer, Info, Star, Wrench, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CRAFTING_MAX_IMBUED_ITEMS,
  CRAFTING_RANKS,
  CRAFTING_REQUIRED_EXP,
  CRAFTING_TIMES_MINS,
} from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Accordion from "@/layout/Accordion";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import Countdown from "@/layout/Countdown";
import CraftingCatalog from "@/layout/CraftingCatalog";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal from "@/layout/Modal";
import { TimedQueue } from "@/layout/TimedQueue";
import {
  getCraftingRankProgress,
  getCurrentCraftingStatus,
  getEffectiveMaxImbuements,
  getImbueBlockedMessage,
  getImbuementRankCapMessage,
} from "@/libs/crafting";
import {
  calcItemRepairCost,
  finishedImbuementItems,
  finishedImbuements,
  isImbuing,
} from "@/libs/item";
import { calcRepairAllCost } from "@/libs/repair";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";

/** Manages recipes, the crafting queue, item imbuements and repairs. */
export default function OccupationCrafting({
  renderHeader,
}: {
  renderHeader: (repairAllAction: ReactNode) => ReactNode;
}) {
  // Utils
  const utils = api.useUtils();

  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const [openCatalog, setOpenCatalog] = useState("Catalog / Queue");
  const [openImbue, setOpenImbue] = useState("Imbue");
  const [openRepair, setOpenRepair] = useState("Repair Items");

  // API calls
  const { data: userItems, isError: hasInventoryError } =
    api.item.getUserItems.useQuery(undefined, {
      enabled: userData?.occupation === "CRAFTING",
    });
  const { data: craftableItems } = api.occupation.getCraftableItems.useQuery();
  const { data: craftingQueue } = api.occupation.getCraftingQueue.useQuery();
  const { mutate: cancelQueuedCraft, isPending: isCancellingQueuedCraft } =
    api.occupation.cancelQueuedCraft.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        await Promise.all([
          utils.occupation.getCraftingQueue.invalidate(),
          utils.item.getUserItems.invalidate(),
          ...(data.success ? [updateUser(data, { revision })] : []),
        ]);
      },
    });

  // Get currently imbuing items
  const activeImbuingItem = (userItems || []).find((userItem) => isImbuing(userItem));
  const activeImbuement = activeImbuingItem?.imbuements.find(
    (imbuement) => imbuement.craftingFinishedAt > new Date(),
  );

  const imbueItemMutation = api.occupation.imbueItem.useMutation({
    meta: { handlesTransportError: true },
  });

  const finishCraftingImmediatelyMutation =
    api.occupation.finishCraftingImmediately.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        // Finishing early may have started the next queued craft.
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          utils.occupation.getCraftingQueue.invalidate(),
          utils.profile.getSidebarTimers.invalidate(),
        ]);
      },
    });

  const finishImbuingImmediatelyMutation =
    api.occupation.finishImbuingImmediately.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          utils.profile.getSidebarTimers.invalidate(),
        ]);
      },
    });

  const removeImbuementMutation = api.occupation.removeImbuement.useMutation({
    meta: { handlesTransportError: true },
  });

  const repairItem = api.item.repair.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.userRecovery && !data.success) void updateUser(data, { revision });
      if (data.success) {
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          updateUser(data, { revision, delta: data.userDelta }),
        ]);
      }
    },
  });
  const repairAll = api.item.repairAll.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.userRecovery && !data.success) void updateUser(data, { revision });
      if (data.success) {
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          updateUser(data, { revision, delta: data.userDelta }),
        ]);
      }
    },
  });

  const [selectedImbuableItem, setSelectedImbuableItem] = useState<
    UserItemWithRelations | undefined
  >(undefined);
  const [selectedCrystalUserItem, setSelectedCrystalUserItem] = useState<
    UserItemWithRelations | undefined
  >(undefined);
  const [isImbueModalOpen, setIsImbueModalOpen] = useState<boolean>(false);
  const imbueFlight = useSingleFlight<{
    userItemId: string;
    userCrystalItemId: string;
    crystalItemId: string;
    targetName: string;
    crystalName: string;
  }>();
  const [committedImbue, setCommittedImbue] = useState<{
    userItemId: string;
    imbuementItemId: string;
    targetName: string;
    crystalName: string;
  } | null>(null);
  const [removeImbuementTarget, setRemoveImbuementTarget] =
    useState<ImbuementRemoval | null>(null);
  const removeImbuementFlight = useSingleFlight<ImbuementRemoval>();
  const pendingRemoveImbuement = removeImbuementFlight.pending;
  const [removedImbuementIds, setRemovedImbuementIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Clear the optimistic success marker only after authoritative inventory data contains the
  // exact imbuement. Until then it prevents stale cache data from exposing another imbue action.
  useEffect(() => {
    if (!committedImbue) return;
    const committedTarget = userItems?.find(
      (userItem) => userItem.id === committedImbue.userItemId,
    );
    if (
      committedTarget?.imbuements.some(
        (imbuement) => imbuement.imbuementItemId === committedImbue.imbuementItemId,
      )
    ) {
      setCommittedImbue(null);
    }
  }, [committedImbue, userItems]);

  // Derive crafting status from user data and items
  const craftingStatus = userData
    ? getCurrentCraftingStatus(userData, userItems || [])
    : null;
  const currentCraftingUserItemId = craftingStatus?.currentCraftingUserItemId;

  // Derive crystals and imbuable items from user inventory
  const crystals = (userItems || []).filter(
    (userItem) =>
      userItem.item?.itemType === "CRYSTAL" &&
      userItem.quantity > 0 &&
      !userItem.isInAuction,
  );
  const imbuableItems = (userItems || []).filter(
    (userItem) => userItem.item?.canBeImbued && userItem.quantity > 0,
  );

  /** Imbuements in effect: finished, and not removed by this session's mutations. */
  const shownImbuements = <
    T extends { id: string; craftingFinishedAt: Date | null },
  >(userItem: {
    imbuements: T[];
  }) =>
    finishedImbuements(userItem).filter(
      (imbuement) => !removedImbuementIds.has(imbuement.id),
    );

  // Calculate max crystals per item based on crafting rank
  const userCraftingRank = craftingStatus?.craftingRank || "NOVICE";
  const maxCrystalsPerItem = CRAFTING_MAX_IMBUED_ITEMS[userCraftingRank];

  // Items still able to take a crystal, and items blocked only by the crafting rank
  const imbueOptions = imbuableItems.map((userItem) => {
    const itemMaxImbuements = userItem.item?.maxImbueNumber || 1;
    const effectiveMaxImbuements = getEffectiveMaxImbuements(
      userCraftingRank,
      itemMaxImbuements,
    );
    const currentCrystals = finishedImbuements(userItem).length;
    return {
      userItem,
      effectiveMaxImbuements,
      currentCrystals,
      canAddMoreCrystals: currentCrystals < effectiveMaxImbuements,
      rankCapMessage: getImbuementRankCapMessage(
        userCraftingRank,
        itemMaxImbuements,
        currentCrystals,
      ),
    };
  });
  const openImbueOptions = imbueOptions.filter((option) => option.canAddMoreCrystals);
  const rankCappedItems = imbueOptions.filter((option) => option.rankCapMessage);
  const imbueBlockedMessage = getImbueBlockedMessage(
    userCraftingRank,
    imbuableItems.length,
    openImbueOptions.length,
    crystals.length,
  );

  const rankCapNotes = rankCappedItems.length > 0 && (
    <div
      className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
      data-testid="imbue-rank-cap-notes"
    >
      <p className="mb-1 flex items-center gap-2 font-medium text-sm">
        <Info className="h-4 w-4" />
        Limited by your crafting rank
      </p>
      <ul className="space-y-1 text-sm">
        {rankCappedItems.map(({ userItem, rankCapMessage }) => (
          <li key={userItem.id}>
            <strong>{userItem.item?.name || "Unknown"}</strong>: {rankCapMessage}
          </li>
        ))}
      </ul>
    </div>
  );

  // Guard
  if (userData?.occupation !== "CRAFTING") return null;

  /** Submit the captured item/crystal pair once and retain its committed success marker. */
  const handleImbueItem = async () => {
    if (
      committedImbue ||
      !selectedImbuableItem ||
      !selectedCrystalUserItem ||
      !selectedCrystalUserItem.itemId
    ) {
      return;
    }

    // Capture the exact target and crystal for the whole request.
    const request = {
      userItemId: selectedImbuableItem.id,
      userCrystalItemId: selectedCrystalUserItem.id,
      crystalItemId: selectedCrystalUserItem.itemId,
      targetName: selectedImbuableItem.item?.name || "item",
      crystalName: selectedCrystalUserItem.item?.name || "crystal",
    };

    await imbueFlight.run(request, async () => {
      const revision = prepareUserUpdate();
      try {
        const data = await imbueItemMutation.mutateAsync({
          userItemId: request.userItemId,
          userCrystalItemId: request.userCrystalItemId,
        });
        showMutationToast(data);
        if (data.success || ("userRecovery" in data && data.userRecovery))
          await updateUser(data, { revision, refetch: false });
        if (!data.success) return;

        // Commit local truth before closing or refreshing. A failed/stale refetch cannot expose a
        // second charge while the server is already imbuing this exact target with this crystal.
        setCommittedImbue({
          userItemId: request.userItemId,
          imbuementItemId: request.crystalItemId,
          targetName: request.targetName,
          crystalName: request.crystalName,
        });
        setIsImbueModalOpen(false);
        setSelectedImbuableItem(undefined);
        setSelectedCrystalUserItem(undefined);
        void Promise.allSettled([
          utils.item.getUserItems.invalidate(),
          utils.profile.getSidebarTimers.invalidate(),
        ]);
      } catch (error) {
        // The exact item/crystal selection stays in place for a retry.
        showRetryableErrorToast(
          error,
          "Could not imbue this item. Check your connection and try again.",
        );
      }
    });
  };

  /** Remove the captured imbuement once while preserving a separately changed selection. */
  const handleRemoveImbuement = async () => {
    const target = removeImbuementTarget;
    if (!target) return;

    // Capture the exact inventory row and imbuement for the whole request.
    const request = { ...target };

    await removeImbuementFlight.run(request, async () => {
      try {
        const data = await removeImbuementMutation.mutateAsync({
          userItemImbuementId: request.userItemImbuementId,
        });
        showMutationToast(data);
        if (!data.success) return;

        // Hide only the committed imbuement before any refresh. The marker deliberately survives
        // stale inventory results, so the destructive action cannot reappear after the server has
        // already removed it; sibling items and imbuements remain available.
        setRemovedImbuementIds((current) => {
          const next = new Set(current);
          next.add(request.userItemImbuementId);
          return next;
        });
        setRemoveImbuementTarget((current) =>
          current?.userItemImbuementId === request.userItemImbuementId ? null : current,
        );
        void utils.item.getUserItems.invalidate();
      } catch (error) {
        // The exact target stays in place for a retry.
        showRetryableErrorToast(
          error,
          `Could not remove ${request.crystalName}. Check your connection and try again.`,
        );
      }
    });
  };

  const rankProgress = getCraftingRankProgress(userData?.craftingExperience || 0);
  const currentCraft = craftingStatus?.isCurrentlyCrafting
    ? craftingStatus.currentCraftingItem?.name
    : undefined;
  const queuedCount = craftingQueue?.waiting.length ?? 0;
  const craftSummary = [
    currentCraft && `Crafting ${currentCraft}`,
    queuedCount > 0 && `${queuedCount} queued`,
  ]
    .filter(Boolean)
    .join(" · ");
  const imbueTarget = committedImbue?.targetName ?? activeImbuingItem?.item.name;
  const imbueSummary = imbueTarget ? `Imbuing ${imbueTarget}` : undefined;

  const { itemsNeedingRepair, totalCost } = calcRepairAllCost(userItems);
  const count = itemsNeedingRepair.length;
  const itemLabel = `${count} item${count === 1 ? "" : "s"}`;
  const canAffordRepair = userData.money >= totalCost;
  const isRepairPending = repairItem.isPending || repairAll.isPending;
  const isRepairAllDisabled = !count || !canAffordRepair || isRepairPending;
  const repairStatus = !userItems
    ? hasInventoryError
      ? "Inventory unavailable"
      : "Loading inventory"
    : !count
      ? "No items need repair"
      : undefined;
  const unavailableReason =
    repairStatus ??
    (!canAffordRepair
      ? `You need ${totalCost.toLocaleString()} ryo to repair all items`
      : undefined);
  const repairAllAction = (
    <Confirm
      title="Repair All Items"
      proceed_label="Repair All"
      disabled={isRepairAllDisabled}
      confirmDisabled={isRepairAllDisabled}
      button={
        <Button variant="secondary" className="gap-2" title={unavailableReason}>
          <Wrench className="h-4 w-4" aria-hidden="true" />
          {repairAll.isPending ? "Repairing…" : "Repair All"}
        </Button>
      }
      onAccept={() => {
        if (!isRepairAllDisabled) repairAll.mutate();
      }}
    >
      <p>
        Repair all {itemLabel} for <strong>{totalCost.toLocaleString()} ryo</strong>?
      </p>
    </Confirm>
  );

  const craftingPanel = (
    <ContentBox title="Crafting" initialBreak>
      <div className="space-y-6">
        {/* Crafting Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              Crafting Rank:{" "}
              {capitalizeFirstLetter(craftingStatus?.craftingRank || "NOVICE")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Experience: {craftingStatus?.craftingExperience || 0}</span>
                {rankProgress.nextRankExperience && (
                  <span>
                    Next rank: {rankProgress.nextRankExperience.toLocaleString()} exp
                  </span>
                )}
              </div>
              <Progress value={rankProgress.progress} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Accordion
          title="Catalog / Queue"
          icon={BookOpen}
          selectedTitle={openCatalog}
          unselectedSubtitle={craftSummary}
          onClick={setOpenCatalog}
          collapsible
          keepMounted
        >
          <div className="space-y-4 py-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Crafting Catalog
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-muted-foreground text-sm">
                  Browse all craftable recipes by category. Select a category to view
                  available items.
                </p>
                <CraftingCatalog
                  craftableItems={craftableItems}
                  userItems={userItems}
                  userData={userData}
                  isBusy={
                    !!craftingStatus?.isCurrentlyCrafting ||
                    !!craftingQueue?.waiting.length
                  }
                  isQueueFull={
                    (!!craftingStatus?.isCurrentlyCrafting ||
                      !!craftingQueue?.waiting.length) &&
                    (craftingStatus?.isCurrentlyCrafting ? 1 : 0) +
                      (craftingQueue?.waiting.length ?? 0) >=
                      (craftingQueue?.capacity ?? 1)
                  }
                />
              </CardContent>
            </Card>

            <TimedQueue
              title="Crafting queue"
              subtitle="Crafts that start when the current one is ready"
              initialBreak={false}
              capacity={craftingQueue?.capacity ?? 1}
              help="Choose a recipe while crafting to queue it. Its materials are set aside when queued and returned if you cancel before it starts. Crafting experience and quest progress are granted when a queued craft starts, also while you are offline. Waiting times are base durations; Territory War bonuses active when a job starts can shorten them."
              waitingDurationLabel="base time"
              active={
                craftingStatus?.isCurrentlyCrafting &&
                craftingStatus.craftingFinishedAt &&
                craftingStatus.currentCraftingItem
                  ? {
                      title: craftingStatus.currentCraftingItem.name,
                      finishesAt: new Date(craftingStatus.craftingFinishedAt),
                    }
                  : null
              }
              waiting={(craftingQueue?.waiting ?? []).map((job) => ({
                id: job.id,
                title: `${job.quantity}x ${job.name}`,
                detail: job.materials.map((m) => `${m.quantity} ${m.name}`).join(", "),
                startsAt: job.startsAt,
                finishesAt: job.finishesAt,
              }))}
              cancelLabel="Cancel and return materials"
              onCancel={(queueId) => cancelQueuedCraft({ queueId })}
              isPending={isCancellingQueuedCraft}
              emptyText="Nothing crafting. Pick a recipe from the catalog to start."
              onActiveFinish={() => {
                // Reading the queue starts the next craft, so the inventory is read after it.
                void utils.occupation.getCraftingQueue
                  .invalidate()
                  .then(() => utils.item.getUserItems.invalidate());
              }}
            />

            {/* Current Crafting */}
            {craftingStatus?.isCurrentlyCrafting && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hammer className="h-5 w-5" />
                    Currently Crafting
                    {craftingStatus.craftingFinishedAt && (
                      <span className="font-normal text-muted-foreground text-sm">
                        (
                        <Countdown
                          targetDate={craftingStatus.craftingFinishedAt}
                          onEndShow="Ready!"
                          onFinish={() => {
                            void utils.item.getUserItems.invalidate();
                          }}
                        />
                        )
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-4">
                    {craftingStatus.currentCraftingItem && (
                      <ItemWithEffects item={craftingStatus.currentCraftingItem} />
                    )}
                    {craftingStatus.craftingFinishedAt &&
                      new Date(craftingStatus.craftingFinishedAt) <= new Date() && (
                        <div className="font-medium text-green-600 text-sm">
                          Finished!
                        </div>
                      )}
                    {currentCraftingUserItemId &&
                      canChangeContent(userData?.role || "USER") && (
                        <Button
                          onClick={() =>
                            finishCraftingImmediatelyMutation.mutate({
                              userItemId: currentCraftingUserItemId,
                            })
                          }
                          disabled={finishCraftingImmediatelyMutation.isPending}
                          loading={finishCraftingImmediatelyMutation.isPending}
                          variant="outline"
                          size="sm"
                          className="w-fit"
                        >
                          <Zap className="mr-2 h-4 w-4" />
                          Instant Finish (Staff)
                        </Button>
                      )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </Accordion>

        <Accordion
          title="Imbue"
          icon={Gem}
          selectedTitle={openImbue}
          unselectedSubtitle={imbueSummary}
          onClick={setOpenImbue}
          collapsible
          keepMounted
        >
          <div className="space-y-4 py-3">
            {/* Current Imbuing */}
            {activeImbuement && activeImbuingItem && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gem className="h-5 w-5" />
                    Currently Imbuing
                    {activeImbuement?.craftingFinishedAt && (
                      <span className="font-normal text-muted-foreground text-sm">
                        (
                        <Countdown
                          targetDate={new Date(activeImbuement.craftingFinishedAt)}
                          onEndShow="Ready!"
                          onFinish={() => {
                            void utils.item.getUserItems.invalidate();
                          }}
                        />
                        )
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-4">
                    <p className="text-muted-foreground text-sm">
                      You can imbue one item at a time. Imbueable Items comes back when
                      this one finishes.
                    </p>
                    <ItemWithEffects
                      item={{
                        ...activeImbuingItem.item,
                        imbuements: activeImbuingItem.imbuements.map((i) => i.item),
                      }}
                      key={activeImbuingItem.id}
                    />
                    {canChangeContent(userData?.role || "USER") && activeImbuement && (
                      <Button
                        onClick={() =>
                          finishImbuingImmediatelyMutation.mutate({
                            userItemImbuementId: activeImbuement.id,
                          })
                        }
                        disabled={finishImbuingImmediatelyMutation.isPending}
                        loading={finishImbuingImmediatelyMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="w-fit"
                      >
                        <Zap className="mr-2 h-4 w-4" />
                        Instant Finish (Staff)
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Imbue New Item */}
            {!activeImbuingItem && !activeImbuement && !committedImbue && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gem className="h-5 w-5" />
                    Imbueable Items
                    <Badge variant="outline" className="ml-auto">
                      {capitalizeFirstLetter(userCraftingRank)} rank: up to{" "}
                      {maxCrystalsPerItem} per item
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {imbueBlockedMessage ? (
                      <>
                        <p
                          className="text-muted-foreground text-sm"
                          data-testid="imbue-blocked-message"
                        >
                          {imbueBlockedMessage}
                        </p>
                        {maxCrystalsPerItem > 0 && rankCapNotes}
                      </>
                    ) : (
                      <>
                        <div>
                          <h4 className="mb-2 font-medium">Select Item to Imbue</h4>
                          <ActionSelector
                            items={openImbueOptions.map(
                              ({
                                userItem,
                                currentCrystals,
                                effectiveMaxImbuements,
                              }) => ({
                                id: userItem.id,
                                name: `${userItem.item?.name || "Unknown"} (${currentCrystals}/${effectiveMaxImbuements} crystals)`,
                                image: userItem.item?.image || "",
                                rarity: userItem.item?.rarity || "COMMON",
                                type: "item" as const,
                                effects: userItem.item?.effects || [],
                                hidden: false,
                              }),
                            )}
                            selectedId={selectedImbuableItem?.id}
                            showBgColor={false}
                            showLabels={true}
                            onClick={(id) => {
                              const item = imbuableItems.find((item) => item.id === id);
                              setSelectedImbuableItem(
                                item === selectedImbuableItem ? undefined : item,
                              );
                              setSelectedCrystalUserItem(undefined);
                            }}
                          />
                          {rankCapNotes}
                        </div>

                        {selectedImbuableItem && (
                          <div>
                            <h4 className="mb-2 font-medium">Select Crystal</h4>
                            <p className="mb-2 text-muted-foreground text-sm">
                              Only crystals compatible with{" "}
                              <strong>{selectedImbuableItem.item?.itemType}</strong>{" "}
                              items are shown. PvE-only crystals require a PvE-only
                              item.
                            </p>
                            <ActionSelector
                              items={crystals
                                .filter((userItem) => {
                                  const crystal = userItem.item;
                                  if (!crystal) return false;
                                  if (
                                    crystal.battleUsageType === "PVE" &&
                                    selectedImbuableItem.item?.battleUsageType !== "PVE"
                                  ) {
                                    return false;
                                  }

                                  const alreadyOnItem =
                                    selectedImbuableItem.imbuements?.some(
                                      (imb) => imb.imbuementItemId === crystal.id,
                                    );
                                  if (alreadyOnItem) return false;

                                  // If crystal has no target types specified, it can be used on any item
                                  if (!crystal.crystalTargetTypes) {
                                    return true;
                                  }

                                  // Check if the target item type matches the crystal's allowed type
                                  return (
                                    crystal.crystalTargetTypes ===
                                    selectedImbuableItem.item?.itemType
                                  );
                                })
                                .map((userItem) => ({
                                  id: userItem.id,
                                  name: userItem.item?.name || "Unknown",
                                  image: userItem.item?.image || "",
                                  rarity: userItem.item?.rarity || "COMMON",
                                  type: "item" as const,
                                  effects: userItem.item?.effects || [],
                                  hidden: false,
                                }))}
                              selectedId={selectedCrystalUserItem?.id}
                              showBgColor={false}
                              showLabels={true}
                              onClick={(id) => {
                                const crystal = crystals.find((item) => item.id === id);
                                setSelectedCrystalUserItem(
                                  crystal === selectedCrystalUserItem
                                    ? undefined
                                    : crystal,
                                );
                                if (crystal && crystal !== selectedCrystalUserItem) {
                                  setIsImbueModalOpen(true);
                                }
                              }}
                            />
                          </div>
                        )}

                        {isImbueModalOpen &&
                          selectedImbuableItem &&
                          selectedCrystalUserItem && (
                            <Modal
                              title="Imbue Item"
                              proceed_label="Imbue Item"
                              proceed_loading_label="Imbuing"
                              isOpen={isImbueModalOpen}
                              setIsOpen={setIsImbueModalOpen}
                              isLoading={imbueFlight.isPending}
                              keepOpenOnAccept
                              proceedDisabled={committedImbue !== null}
                              onAccept={() => void handleImbueItem()}
                              confirmClassName="bg-purple-600 text-white hover:bg-purple-700"
                            >
                              <div className="space-y-4">
                                <div>
                                  <h4 className="mb-2 font-semibold text-sm">
                                    Target Item
                                  </h4>
                                  {selectedImbuableItem.item && (
                                    <ItemWithEffects
                                      item={{
                                        ...selectedImbuableItem.item,
                                        imbuements: shownImbuements(
                                          selectedImbuableItem,
                                        ).map((i) => i.item),
                                      }}
                                    />
                                  )}
                                </div>
                                <div>
                                  <h4 className="mb-2 font-semibold text-sm">
                                    Crystal
                                  </h4>
                                  {selectedCrystalUserItem.item && (
                                    <ItemWithEffects
                                      item={selectedCrystalUserItem.item}
                                    />
                                  )}
                                </div>
                                <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                                  <p className="text-muted-foreground text-sm">
                                    This will permanently imbue your{" "}
                                    {selectedImbuableItem.item?.name} with the effects
                                    of {selectedCrystalUserItem.item?.name}. The crystal
                                    will be consumed in the process.
                                  </p>
                                </div>
                              </div>
                            </Modal>
                          )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {committedImbue && (
              <Card aria-busy="true">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gem className="h-5 w-5" />
                    Imbuement Started
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-muted-foreground text-sm"
                  >
                    {committedImbue.targetName} is being imbued with{" "}
                    {committedImbue.crystalName}. Updating your inventory…
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Manage Existing Imbuements */}
            {(() => {
              const itemsWithImbuements = (userItems || []).filter(
                (userItem) => shownImbuements(userItem).length > 0,
              );

              return itemsWithImbuements.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Star className="h-5 w-5" />
                      Manage Existing Imbuements
                      <Badge variant="outline" className="ml-auto">
                        {itemsWithImbuements.length} item
                        {itemsWithImbuements.length !== 1 ? "s" : ""}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {itemsWithImbuements.map((userItem) => (
                        <div key={userItem.id} className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center gap-3">
                            <ContentImage
                              image={userItem.item?.image || ""}
                              alt={userItem.item?.name || "Unknown"}
                              className="h-12 w-12"
                            />
                            <div>
                              <h4 className="font-semibold">{userItem.item?.name}</h4>
                              {(() => {
                                const done = shownImbuements(userItem).length;
                                return (
                                  <p className="text-muted-foreground text-sm">
                                    {done} imbuement{done !== 1 ? "s" : ""}
                                  </p>
                                );
                              })()}
                            </div>
                          </div>
                          <ItemWithEffects
                            item={{
                              ...userItem.item,
                              imbuements: shownImbuements(userItem).map((i) => i.item),
                            }}
                          />
                          {/* Imbuements with remove buttons */}
                          {userItem.imbuements.length > 0 && (
                            <div className="mt-3 rounded-lg bg-purple-100 p-3">
                              <h4 className="mb-2 font-semibold text-purple-800">
                                Imbuements
                              </h4>
                              <div className="space-y-2">
                                {shownImbuements(userItem).map((imbuement) => (
                                  <div
                                    key={imbuement.id}
                                    className="flex items-center justify-between rounded bg-white p-2"
                                  >
                                    <div className="flex items-center space-x-2">
                                      <ContentImage
                                        image={imbuement.item.image}
                                        alt={imbuement.item.name}
                                        className="h-8 w-8"
                                      />
                                      <span className="font-medium">
                                        {imbuement.item.name}
                                      </span>
                                    </div>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      disabled={
                                        pendingRemoveImbuement?.userItemImbuementId ===
                                        imbuement.id
                                      }
                                      onClick={() => {
                                        setRemoveImbuementTarget({
                                          userItemId: userItem.id,
                                          userItemImbuementId: imbuement.id,
                                          targetName: userItem.item?.name || "item",
                                          crystalName: imbuement.item.name,
                                          returnsCrystal: !userItem.item?.canBeImbued,
                                        });
                                      }}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null;
            })()}

            <Modal
              id="remove-imbuement-confirmation"
              title="Remove Imbuement"
              isOpen={removeImbuementTarget !== null}
              setIsOpen={(open) => {
                if (!open && !pendingRemoveImbuement) {
                  setRemoveImbuementTarget(null);
                }
              }}
              proceed_label="Remove"
              proceed_loading_label="Removing"
              confirmClassName="bg-red-600 text-white hover:bg-red-700"
              isLoading={removeImbuementFlight.isPending}
              keepOpenOnAccept
              onAccept={() => void handleRemoveImbuement()}
            >
              {removeImbuementTarget && (
                <div className="space-y-3">
                  <p>
                    Remove the <strong>{removeImbuementTarget.crystalName}</strong>{" "}
                    imbuement from <strong>{removeImbuementTarget.targetName}</strong>?
                  </p>
                  {removeImbuementTarget.returnsCrystal ? (
                    <p className="text-muted-foreground text-sm">
                      Imbuing is disabled on this item, so the crystal will be returned
                      to your inventory.
                    </p>
                  ) : (
                    <p className="font-medium text-red-700 text-sm">
                      This cannot be undone. The crystal will be destroyed and will not
                      be returned to your inventory.
                    </p>
                  )}
                  {pendingRemoveImbuement && (
                    <p role="status" aria-live="polite" className="text-sm">
                      Removing
                    </p>
                  )}
                </div>
              )}
            </Modal>
          </div>
        </Accordion>

        <Accordion
          title="Repair Items"
          icon={Wrench}
          selectedTitle={openRepair}
          unselectedSubtitle={repairStatus ?? `Items needing repair: ${count}`}
          onClick={setOpenRepair}
          collapsible
        >
          {count > 0 ? (
            <Card className="my-3">
              <CardHeader>
                <CardDescription>
                  Total repair cost: {totalCost.toLocaleString()} ryo.
                  {!canAffordRepair &&
                    ` You have ${userData.money.toLocaleString()} ryo.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {itemsNeedingRepair.map((userItem) => {
                    const repairCost = calcItemRepairCost(userItem);
                    const durabilityPercent = Math.round(
                      (userItem.durability / userItem.item.maxDurability) * 100,
                    );
                    return (
                      <div key={userItem.id} className="rounded-lg border p-4">
                        <div className="mb-3 flex items-center gap-3">
                          <ContentImage
                            image={userItem.item?.image || ""}
                            alt={userItem.item?.name || "Unknown"}
                            className="h-12 w-12"
                          />
                          <div className="flex-1">
                            <h4 className="font-semibold">{userItem.item?.name}</h4>
                            <p className="text-muted-foreground text-sm">
                              Durability: {userItem.durability} /{" "}
                              {userItem.item.maxDurability} ({durabilityPercent}%)
                            </p>
                          </div>
                        </div>
                        <ItemWithEffects
                          item={{
                            ...userItem.item,
                            imbuements: finishedImbuementItems(userItem),
                            curDurability: userItem.durability,
                          }}
                        />
                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-sm">
                            <span className="font-medium">Repair Cost: </span>
                            <span className="text-green-600">
                              {repairCost.toLocaleString()} ryo
                            </span>
                          </div>
                          <Button
                            variant="info"
                            onClick={() =>
                              repairItem.mutate({ userItemId: userItem.id })
                            }
                            disabled={isRepairPending}
                            loading={repairItem.isPending}
                          >
                            <Wrench className="mr-2 h-4 w-4" />
                            Repair
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground py-3 text-sm">{repairStatus}</p>
          )}
        </Accordion>

        <CraftingInfoCard />
      </div>
    </ContentBox>
  );

  return (
    <>
      {renderHeader(repairAllAction)}
      {craftingPanel}
    </>
  );
}

/** Crafting rank experience ranges, rarity times and the crafting rules. */
const CraftingInfoCard = () => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Info className="h-5 w-5" />
        Crafting Information
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        <div>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {CRAFTING_RANKS.map((rank, index) => {
              const nextRank = CRAFTING_RANKS[index + 1];
              const minExp = CRAFTING_REQUIRED_EXP[rank].toLocaleString();
              return (
                <div key={rank}>
                  <Badge variant="outline" className="mb-2">
                    {capitalizeFirstLetter(rank)} (
                    {nextRank
                      ? `${minExp}-${(CRAFTING_REQUIRED_EXP[nextRank] - 1).toLocaleString()}`
                      : `${minExp}+`}{" "}
                    exp)
                  </Badge>
                  <ul className="space-y-1 text-muted-foreground">
                    {Object.entries(CRAFTING_TIMES_MINS[rank])
                      .filter(([, minutes]) => minutes > 0)
                      .map(([rarity, minutes]) => (
                        <li key={rarity}>
                          • {capitalizeFirstLetter(rarity)}: {minutes} minutes
                        </li>
                      ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h4 className="mb-2 font-medium">How Crafting Works</h4>
          <ul className="space-y-1 text-muted-foreground text-sm">
            <li>• Items need crafting requirements set by administrators</li>
            <li>• One item crafts at a time; more can wait in your crafting queue</li>
            <li>• Required materials are consumed when you start or queue a craft</li>
            <li>• Experience is gained when a craft starts, queued ones included</li>
            <li>• Higher ranks unlock new rarities and faster crafting times</li>
            <li>• Items are automatically finished when the timer expires</li>
          </ul>
        </div>
      </div>
    </CardContent>
  </Card>
);

type ImbuementRemoval = {
  userItemId: string;
  userItemImbuementId: string;
  targetName: string;
  crystalName: string;
  returnsCrystal: boolean;
};
