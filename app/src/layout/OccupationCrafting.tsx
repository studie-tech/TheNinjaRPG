"use client";

import { BookOpen, Gem, Hammer, Info, Star, Wrench, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CRAFTING_MAX_IMBUED_ITEMS,
  CRAFTING_REQUIRED_EXP,
  CRAFTING_TIMES_MINS,
} from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import Countdown from "@/layout/Countdown";
import CraftingCatalog from "@/layout/CraftingCatalog";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal from "@/layout/Modal";
import {
  getCraftingRankProgress,
  getCurrentCraftingStatus,
  getEffectiveMaxImbuements,
} from "@/libs/crafting";
import { calcItemRepairCost } from "@/libs/item";
import { needsInventoryRepair } from "@/libs/repair";
import { showMutationToast } from "@/libs/toast";
import { isRetryableTrpcError } from "@/utils/error";
import { canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useRequiredUserData } from "@/utils/UserContext";

export default function OccupationCrafting() {
  // Utils
  const utils = api.useUtils();

  // State
  const { data: userData } = useRequiredUserData();

  // API calls
  const { data: userItems } = api.item.getUserItems.useQuery();
  const { data: craftableItems } = api.occupation.getCraftableItems.useQuery();

  // Get currently imbuing items
  const activeImbuingItem = (userItems || []).find(
    (userItem) =>
      userItem.imbuements &&
      userItem.imbuements.length > 0 &&
      userItem.imbuements.some(
        (imbuement) =>
          imbuement.craftingFinishedAt &&
          new Date(imbuement.craftingFinishedAt) > new Date(),
      ),
  );
  const activeImbuement = activeImbuingItem?.imbuements?.find(
    (imbuement) =>
      imbuement.craftingFinishedAt &&
      new Date(imbuement.craftingFinishedAt) > new Date(),
  );

  const imbueItemMutation = api.occupation.imbueItem.useMutation();

  const finishCraftingImmediatelyMutation =
    api.occupation.finishCraftingImmediately.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.item.getUserItems.invalidate(),
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

  const removeImbuementMutation = api.occupation.removeImbuement.useMutation();

  const repairItemMutation = api.item.repair.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
      }
    },
  });

  const repairAllMutation = api.item.repairAll.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.item.getUserItems.invalidate(),
          utils.profile.getUser.invalidate(),
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
  const [pendingImbueRequest, setPendingImbueRequest] = useState<{
    userId: string;
    userItemId: string;
    userCrystalItemId: string;
    crystalItemId: string;
    targetName: string;
    crystalName: string;
  } | null>(null);
  const [committedImbue, setCommittedImbue] = useState<{
    userId: string;
    userItemId: string;
    imbuementItemId: string;
    targetName: string;
    crystalName: string;
  } | null>(null);
  const imbueRequestRef = useRef(pendingImbueRequest);
  const [removeImbuementTarget, setRemoveImbuementTarget] = useState<{
    userId: string;
    userItemId: string;
    userItemImbuementId: string;
    targetName: string;
    crystalName: string;
    returnsCrystal: boolean;
  } | null>(null);
  const [pendingRemoveImbuement, setPendingRemoveImbuement] = useState<{
    userId: string;
    userItemId: string;
    userItemImbuementId: string;
    targetName: string;
    crystalName: string;
    returnsCrystal: boolean;
  } | null>(null);
  const [removedImbuementIds, setRemovedImbuementIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const removeImbuementRequestsRef = useRef(
    new Map<
      string,
      {
        userId: string;
        userItemId: string;
        userItemImbuementId: string;
        targetName: string;
        crystalName: string;
        returnsCrystal: boolean;
      }
    >(),
  );
  const currentUserIdRef = useRef(userData?.userId);
  currentUserIdRef.current = userData?.userId;

  // Clear the optimistic success marker only after authoritative inventory data contains the
  // exact imbuement. Until then it prevents stale cache data from exposing another imbue action.
  useEffect(() => {
    if (!committedImbue || committedImbue.userId !== userData?.userId) return;
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
  }, [committedImbue, userData?.userId, userItems]);

  // OccupationCrafting normally remounts on account changes. Keep the mutation identity safe even
  // if an auth/profile refresh swaps users without a remount while a request is in flight.
  useEffect(() => {
    if (
      pendingImbueRequest &&
      userData?.userId !== pendingImbueRequest.userId &&
      imbueRequestRef.current === pendingImbueRequest
    ) {
      imbueRequestRef.current = null;
      setPendingImbueRequest(null);
      setIsImbueModalOpen(false);
    }
    if (committedImbue && userData?.userId !== committedImbue.userId) {
      setCommittedImbue(null);
    }
  }, [committedImbue, pendingImbueRequest, userData?.userId]);

  useEffect(() => {
    if (removeImbuementTarget && removeImbuementTarget.userId !== userData?.userId) {
      setRemoveImbuementTarget(null);
    }
    if (pendingRemoveImbuement && pendingRemoveImbuement.userId !== userData?.userId) {
      setPendingRemoveImbuement(null);
    }
    for (const [id, request] of removeImbuementRequestsRef.current) {
      if (request.userId !== userData?.userId) {
        removeImbuementRequestsRef.current.delete(id);
      }
    }
    setRemovedImbuementIds((current) =>
      current.size > 0 && !userData?.userId ? new Set() : current,
    );
  }, [pendingRemoveImbuement, removeImbuementTarget, userData?.userId]);

  // Derive crafting status from user data and items
  const craftingStatus = userData
    ? getCurrentCraftingStatus(userData, userItems || [])
    : null;

  // Derive crystals and imbuable items from user inventory
  const crystals = (userItems || []).filter(
    (userItem) => userItem.item?.itemType === "CRYSTAL" && userItem.quantity > 0,
  );
  const imbuableItems = (userItems || []).filter(
    (userItem) => userItem.item?.canBeImbued && userItem.quantity > 0,
  );

  // Calculate max crystals per item based on crafting rank
  const userCraftingRank = craftingStatus?.craftingRank || "NOVICE";
  const maxCrystalsPerItem = CRAFTING_MAX_IMBUED_ITEMS[userCraftingRank];

  // Guard
  if (userData?.occupation !== "CRAFTING") return null;

  const handleImbueItem = async () => {
    if (
      imbueRequestRef.current ||
      committedImbue ||
      !userData?.userId ||
      !selectedImbuableItem ||
      !selectedCrystalUserItem ||
      !selectedCrystalUserItem.itemId
    ) {
      return;
    }

    // Capture the exact target and crystal synchronously. React's pending flag is only visible on
    // the next render, so the ref is the same-tick duplicate-submit guard for click and Enter.
    const request = {
      userId: userData.userId,
      userItemId: selectedImbuableItem.id,
      userCrystalItemId: selectedCrystalUserItem.id,
      crystalItemId: selectedCrystalUserItem.itemId,
      targetName: selectedImbuableItem.item?.name || "item",
      crystalName: selectedCrystalUserItem.item?.name || "crystal",
    };
    imbueRequestRef.current = request;
    setPendingImbueRequest(request);

    try {
      const data = await imbueItemMutation.mutateAsync({
        userItemId: request.userItemId,
        userCrystalItemId: request.userCrystalItemId,
      });
      if (imbueRequestRef.current !== request || userData.userId !== request.userId) {
        return;
      }

      showMutationToast(data);
      if (!data.success) return;

      // Commit local truth before closing or refreshing. A failed/stale refetch cannot expose a
      // second charge while the server is already imbuing this exact target with this crystal.
      setCommittedImbue({
        userId: request.userId,
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
      // Normal server/validation errors are already reported globally. Transient transport errors
      // are intentionally suppressed there, so supply only that missing feedback and retain the
      // exact item/crystal selection for a safe retry.
      if (
        imbueRequestRef.current === request &&
        error instanceof Error &&
        isRetryableTrpcError(error)
      ) {
        showMutationToast({
          success: false,
          message: "Could not imbue this item. Check your connection and try again.",
        });
      }
    } finally {
      if (imbueRequestRef.current === request) {
        imbueRequestRef.current = null;
        setPendingImbueRequest(null);
      }
    }
  };

  const handleRemoveImbuement = async () => {
    const target = removeImbuementTarget;
    if (
      !target ||
      target.userId !== currentUserIdRef.current ||
      removeImbuementRequestsRef.current.has(target.userItemImbuementId)
    ) {
      return;
    }

    // Capture the exact inventory row and imbuement synchronously. The map closes the same-tick
    // click/Enter gap without disabling unrelated imbuement controls.
    const request = { ...target };
    removeImbuementRequestsRef.current.set(request.userItemImbuementId, request);
    setPendingRemoveImbuement(request);

    try {
      const data = await removeImbuementMutation.mutateAsync({
        userItemImbuementId: request.userItemImbuementId,
      });
      if (
        removeImbuementRequestsRef.current.get(request.userItemImbuementId) !==
          request ||
        currentUserIdRef.current !== request.userId
      ) {
        return;
      }

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
      // Validation errors use the global mutation toast. Only transport failures are suppressed
      // there, so provide that missing feedback while retaining the exact target for retry.
      if (
        removeImbuementRequestsRef.current.get(request.userItemImbuementId) ===
          request &&
        error instanceof Error &&
        isRetryableTrpcError(error)
      ) {
        showMutationToast({
          success: false,
          message: `Could not remove ${request.crystalName}. Check your connection and try again.`,
        });
      }
    } finally {
      if (
        removeImbuementRequestsRef.current.get(request.userItemImbuementId) === request
      ) {
        removeImbuementRequestsRef.current.delete(request.userItemImbuementId);
        setPendingRemoveImbuement((current) =>
          current?.userItemImbuementId === request.userItemImbuementId ? null : current,
        );
      }
    }
  };

  const rankProgress = getCraftingRankProgress(userData?.craftingExperience || 0);

  return (
    <ContentBox title="Crafting" subtitle="Craft items and equipment" initialBreak>
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
                {rankProgress.nextRank && craftingStatus?.nextRankExperience && (
                  <span>
                    Next rank: {craftingStatus.nextRankExperience.toLocaleString()} exp
                  </span>
                )}
              </div>
              <Progress value={rankProgress.progress} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Crafting Catalog */}
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
              isCurrentlyCrafting={craftingStatus?.isCurrentlyCrafting || false}
            />
          </CardContent>
        </Card>

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
                    <div className="font-medium text-green-600 text-sm">Finished!</div>
                  )}
                {/* Find the currently crafting userItem to get its ID */}
                {userItems &&
                  (() => {
                    const currentlyCraftingUserItem = userItems.find(
                      (ui) =>
                        ui.craftingFinishedAt &&
                        new Date(ui.craftingFinishedAt) > new Date(),
                    );
                    return currentlyCraftingUserItem &&
                      canChangeContent(userData?.role || "USER") ? (
                      <Button
                        onClick={() =>
                          finishCraftingImmediatelyMutation.mutate({
                            userItemId: currentlyCraftingUserItem.id,
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
                    ) : null;
                  })()}
              </div>
            </CardContent>
          </Card>
        )}

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
                  Max depends on item & crafting rank
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {maxCrystalsPerItem === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    You need to be at least Apprentice rank to imbue items.
                  </p>
                ) : imbuableItems.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No items available for imbuing. Items must have the &quot;Can Be
                    Imbued&quot; property.
                  </p>
                ) : crystals.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No crystals available for imbuing. Obtain crystals to enhance your
                    items.
                  </p>
                ) : (
                  <>
                    <div>
                      <h4 className="mb-2 font-medium">Select Item to Imbue</h4>
                      <ActionSelector
                        items={imbuableItems
                          .map((userItem) => {
                            const effectiveMaxImbuements = getEffectiveMaxImbuements(
                              userCraftingRank,
                              userItem.item?.maxImbueNumber || 1,
                            );
                            const currentCrystals =
                              userItem.imbuements?.filter(
                                (imbuement) =>
                                  imbuement.craftingFinishedAt &&
                                  new Date(imbuement.craftingFinishedAt) <= new Date(),
                              ).length || 0;
                            const canAddMoreCrystals =
                              currentCrystals < effectiveMaxImbuements;

                            return {
                              id: userItem.id,
                              name: `${userItem.item?.name || "Unknown"} (${currentCrystals}/${effectiveMaxImbuements} crystals)`,
                              image: userItem.item?.image || "",
                              rarity: userItem.item?.rarity || "COMMON",
                              type: "item" as const,
                              effects: userItem.item?.effects || [],
                              hidden: !canAddMoreCrystals,
                            };
                          })
                          .filter((item) => !item.hidden)}
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
                    </div>

                    {selectedImbuableItem && (
                      <div>
                        <h4 className="mb-2 font-medium">Select Crystal</h4>
                        <p className="mb-2 text-muted-foreground text-sm">
                          Only crystals compatible with{" "}
                          <strong>{selectedImbuableItem.item?.itemType}</strong> items
                          are shown.
                        </p>
                        <ActionSelector
                          items={crystals
                            .filter((userItem) => {
                              const crystal = userItem.item;
                              if (!crystal) return false;

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
                              crystal === selectedCrystalUserItem ? undefined : crystal,
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
                          proceed_loading_label={`Imbuing ${pendingImbueRequest?.targetName ?? selectedImbuableItem.item?.name ?? "item"}…`}
                          isOpen={isImbueModalOpen}
                          setIsOpen={setIsImbueModalOpen}
                          isValid={false}
                          isLoading={pendingImbueRequest !== null}
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
                                    imbuements: selectedImbuableItem.imbuements.map(
                                      (i) => i.item,
                                    ),
                                  }}
                                />
                              )}
                            </div>
                            <div>
                              <h4 className="mb-2 font-semibold text-sm">Crystal</h4>
                              {selectedCrystalUserItem.item && (
                                <ItemWithEffects item={selectedCrystalUserItem.item} />
                              )}
                            </div>
                            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                              <p className="text-muted-foreground text-sm">
                                This will permanently imbue your{" "}
                                {selectedImbuableItem.item?.name} with the effects of{" "}
                                {selectedCrystalUserItem.item?.name}. The crystal will
                                be consumed in the process.
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

        {committedImbue && committedImbue.userId === userData.userId && (
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
            (userItem) =>
              userItem.imbuements &&
              userItem.imbuements.length > 0 &&
              userItem.imbuements.some(
                (imbuement) =>
                  !removedImbuementIds.has(imbuement.id) &&
                  (!imbuement.craftingFinishedAt ||
                    new Date(imbuement.craftingFinishedAt) <= new Date()),
              ),
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
                            const done = (userItem.imbuements || []).filter(
                              (i) =>
                                !removedImbuementIds.has(i.id) &&
                                (!i.craftingFinishedAt ||
                                  new Date(i.craftingFinishedAt) <= new Date()),
                            ).length;
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
                          imbuements:
                            userItem.imbuements
                              ?.filter((i) => !removedImbuementIds.has(i.id))
                              .map((i) => i.item) || [],
                        }}
                      />
                      {/* Imbuements with remove buttons */}
                      {userItem.imbuements && userItem.imbuements.length > 0 && (
                        <div className="mt-3 rounded-lg bg-purple-100 p-3">
                          <h4 className="mb-2 font-semibold text-purple-800">
                            Imbuements
                          </h4>
                          <div className="space-y-2">
                            {userItem.imbuements
                              .filter(
                                (imbuement) =>
                                  !removedImbuementIds.has(imbuement.id) &&
                                  (!imbuement.craftingFinishedAt ||
                                    new Date(imbuement.craftingFinishedAt) <=
                                      new Date()),
                              )
                              .map((imbuement) => (
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
                                    disabled={removeImbuementRequestsRef.current.has(
                                      imbuement.id,
                                    )}
                                    onClick={() => {
                                      if (!userData.userId) return;
                                      setRemoveImbuementTarget({
                                        userId: userData.userId,
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
          proceed_loading_label={
            pendingRemoveImbuement
              ? `Removing ${pendingRemoveImbuement.crystalName}…`
              : "Removing imbuement…"
          }
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          isLoading={pendingRemoveImbuement !== null}
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
                  Imbuing is disabled on this item, so the crystal will be returned to
                  your inventory.
                </p>
              ) : (
                <p className="font-medium text-red-700 text-sm">
                  This cannot be undone. The crystal will be destroyed and will not be
                  returned to your inventory.
                </p>
              )}
              {pendingRemoveImbuement && (
                <p role="status" aria-live="polite" className="text-sm">
                  Removing {pendingRemoveImbuement.crystalName} from{" "}
                  {pendingRemoveImbuement.targetName}…
                </p>
              )}
            </div>
          )}
        </Modal>

        {/* Repair Items */}
        {(() => {
          const itemsNeedingRepair = (userItems || []).filter(needsInventoryRepair);

          return itemsNeedingRepair.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Repair Items
                  <Badge variant="outline" className="ml-auto">
                    {itemsNeedingRepair.length} item
                    {itemsNeedingRepair.length !== 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Repair All Button */}
                  {(() => {
                    const totalRepairCost = itemsNeedingRepair.reduce(
                      (total, userItem) => total + calcItemRepairCost(userItem),
                      0,
                    );
                    const canAfford = (userData?.money || 0) >= totalRepairCost;
                    return (
                      <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/50 p-4">
                        <div>
                          <p className="font-semibold">Repair All Items</p>
                          <p className="text-muted-foreground text-sm">
                            Total cost:{" "}
                            <span
                              className={canAfford ? "text-green-600" : "text-red-600"}
                            >
                              {totalRepairCost.toLocaleString()} ryo
                            </span>
                            {!canAfford && (
                              <span className="ml-2">
                                (You have {(userData?.money ?? 0).toLocaleString()} ryo)
                              </span>
                            )}
                          </p>
                        </div>
                        <Confirm
                          title="Repair All Items"
                          proceed_label={
                            repairAllMutation.isPending ? undefined : "Repair All"
                          }
                          button={
                            <Button
                              variant="default"
                              disabled={repairAllMutation.isPending || !canAfford}
                              loading={repairAllMutation.isPending}
                            >
                              <Wrench className="mr-2 h-4 w-4" />
                              Repair All
                            </Button>
                          }
                          onAccept={() => repairAllMutation.mutate()}
                        >
                          <p>
                            Are you sure you want to repair all{" "}
                            {itemsNeedingRepair.length} item
                            {itemsNeedingRepair.length !== 1 ? "s" : ""} for{" "}
                            <strong>{totalRepairCost.toLocaleString()} ryo</strong>?
                          </p>
                        </Confirm>
                      </div>
                    );
                  })()}
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
                            imbuements: userItem.imbuements?.map((i) => i.item) || [],
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
                              repairItemMutation.mutate({ userItemId: userItem.id })
                            }
                            disabled={repairItemMutation.isPending}
                            loading={repairItemMutation.isPending}
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
          ) : null;
        })()}

        {/* Crafting Information */}
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
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Novice (0-
                      {(CRAFTING_REQUIRED_EXP.APPRENTICE - 1).toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.NOVICE.COMMON} minutes</li>
                    </ul>
                  </div>
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Apprentice ({CRAFTING_REQUIRED_EXP.APPRENTICE.toLocaleString()}-
                      {(CRAFTING_REQUIRED_EXP.MASTER - 1).toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.APPRENTICE.COMMON} minutes</li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.APPRENTICE.RARE} minutes</li>
                    </ul>
                  </div>
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Master ({CRAFTING_REQUIRED_EXP.MASTER.toLocaleString()}-
                      {(CRAFTING_REQUIRED_EXP.FORGEMASTER - 1).toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.MASTER.COMMON} minutes</li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.MASTER.RARE} minutes</li>
                      <li>• Epic: {CRAFTING_TIMES_MINS.MASTER.EPIC} minutes</li>
                    </ul>
                  </div>
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Forgemaster ({CRAFTING_REQUIRED_EXP.FORGEMASTER.toLocaleString()}+
                      exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>
                        • Common: {CRAFTING_TIMES_MINS.FORGEMASTER.COMMON} minutes
                      </li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.FORGEMASTER.RARE} minutes</li>
                      <li>• Epic: {CRAFTING_TIMES_MINS.FORGEMASTER.EPIC} minutes</li>
                      <li>
                        • Legendary: {CRAFTING_TIMES_MINS.FORGEMASTER.LEGENDARY} minutes
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-medium">How Crafting Works</h4>
                <ul className="space-y-1 text-muted-foreground text-sm">
                  <li>• Items need crafting requirements set by administrators</li>
                  <li>• You can only craft one item at a time</li>
                  <li>• Required materials are consumed when crafting starts</li>
                  <li>• Experience is gained when starting and completing crafts</li>
                  <li>• Higher ranks unlock new rarities and faster crafting times</li>
                  <li>• Items are automatically finished when the timer expires</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ContentBox>
  );
}
