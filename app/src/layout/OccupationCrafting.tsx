"use client";

import React, { useState } from "react";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal2 from "@/layout/Modal2";
import Countdown from "@/layout/Countdown";
import { ActionSelector } from "@/layout/CombatActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Hammer, Star, Info, Gem, Zap } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import {
  CRAFTING_REQUIRED_EXP,
  CRAFTING_TIMES_MINS,
  CRAFTING_MAX_IMBUED_ITEMS,
} from "@/drizzle/constants";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { canChangeContent } from "@/utils/permissions";
import {
  getCurrentCraftingStatus,
  getCraftingRankProgress,
  getTotalItemQuantity,
  getEffectiveMaxImbuements,
} from "@/libs/crafting";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";

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

  const craftItemMutation = api.occupation.craftItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      setIsModalOpen(false);
      setSelectedItem(undefined);
      await utils.item.getUserItems.invalidate();
    },
  });

  const imbueItemMutation = api.occupation.imbueItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      setIsImbueModalOpen(false);
      setSelectedImbuableItem(undefined);
      setSelectedCrystalUserItem(undefined);
      await utils.item.getUserItems.invalidate();
    },
  });

  const finishCraftingImmediatelyMutation = api.occupation.finishCraftingImmediately.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.item.getUserItems.invalidate();
    },
  });

  const finishImbuingImmediatelyMutation = api.occupation.finishImbuingImmediately.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.item.getUserItems.invalidate();
    },
  });

  const [selectedItem, setSelectedItem] = useState<Item | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedImbuableItem, setSelectedImbuableItem] = useState<
    UserItemWithRelations | undefined
  >(undefined);
  const [selectedCrystalUserItem, setSelectedCrystalUserItem] = useState<
    UserItemWithRelations | undefined
  >(undefined);
  const [isImbueModalOpen, setIsImbueModalOpen] = useState<boolean>(false);

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

  /**
   * Handle the craft item mutation
   */
  const handleCraftItem = () => {
    if (selectedItem) {
      craftItemMutation.mutate({ itemId: selectedItem.id });
    }
  };

  const handleImbueItem = () => {
    if (selectedImbuableItem && selectedCrystalUserItem) {
      imbueItemMutation.mutate({
        userItemId: selectedImbuableItem.id,
        userCrystalItemId: selectedCrystalUserItem.id,
      });
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

        {/* Current Crafting */}
        {craftingStatus?.isCurrentlyCrafting && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hammer className="h-5 w-5" />
                Currently Crafting
                {craftingStatus.craftingFinishedAt && (
                  <span className="text-sm font-normal text-muted-foreground">
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
                    <div className="text-sm text-green-600 font-medium">Finished!</div>
                  )}
                {/* Find the currently crafting userItem to get its ID */}
                {userItems && (() => {
                  const currentlyCraftingUserItem = userItems.find(
                    (ui) =>
                      ui.craftingFinishedAt &&
                      new Date(ui.craftingFinishedAt) > new Date()
                  );
                  return currentlyCraftingUserItem && canChangeContent(userData?.role || "USER") ? (
                    <Button
                      onClick={() => finishCraftingImmediatelyMutation.mutate({ userItemId: currentlyCraftingUserItem.id })}
                      disabled={finishCraftingImmediatelyMutation.isPending}
                      loading={finishCraftingImmediatelyMutation.isPending}
                      variant="outline"
                      size="sm"
                      className="w-fit"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Instant Finish (Staff)
                    </Button>
                  ) : null;
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Craft New Item */}
        {!craftingStatus?.isCurrentlyCrafting && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hammer className="h-5 w-5" />
                Available Items to Craft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActionSelector
                items={craftableItems?.map((item) => ({
                  id: item.id,
                  name: item.name,
                  image: item.image,
                  rarity: item.rarity,
                  type: "item" as const,
                  effects: item.effects,
                  hidden: item.hidden,
                }))}
                selectedId={selectedItem?.id}
                showBgColor={false}
                showLabels={true}
                onClick={(id) => {
                  if (id === selectedItem?.id) {
                    setSelectedItem(undefined);
                    setIsModalOpen(false);
                  } else {
                    const item = craftableItems?.find((item) => item.id === id);
                    setSelectedItem(item as Item);
                    setIsModalOpen(true);
                  }
                }}
              />
              {isModalOpen && selectedItem && (
                <Modal2
                  title="Craft Item"
                  proceed_label={
                    craftItemMutation.isPending
                      ? undefined
                      : (() => {
                          const craftableItem = craftableItems?.find(
                            (item) => item.id === selectedItem.id,
                          );
                          const canCraft =
                            craftableItem?.craftingRequirements?.every((req) => {
                              const totalQuantity = getTotalItemQuantity(
                                userItems || [],
                                req.requirementItemId,
                              );
                              return totalQuantity >= req.quantity;
                            }) ?? false;
                          return canCraft ? "Start Crafting" : "Missing Materials";
                        })()
                  }
                  isOpen={isModalOpen}
                  setIsOpen={setIsModalOpen}
                  isValid={false}
                  onAccept={() => {
                    const craftableItem = craftableItems?.find(
                      (item) => item.id === selectedItem.id,
                    );
                    const canCraft =
                      craftableItem?.craftingRequirements?.every((req) => {
                        const totalQuantity = getTotalItemQuantity(
                          userItems || [],
                          req.requirementItemId,
                        );
                        return totalQuantity >= req.quantity;
                      }) ?? false;
                    if (canCraft) {
                      handleCraftItem();
                    }
                  }}
                  confirmClassName={(() => {
                    const craftableItem = craftableItems?.find(
                      (item) => item.id === selectedItem.id,
                    );
                    const canCraft =
                      craftableItem?.craftingRequirements?.every((req) => {
                        const totalQuantity = getTotalItemQuantity(
                          userItems || [],
                          req.requirementItemId,
                        );
                        return totalQuantity >= req.quantity;
                      }) ?? false;
                    return canCraft
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-red-600 text-white hover:bg-red-700";
                  })()}
                >
                  <div className="space-y-4">
                    <ItemWithEffects item={selectedItem} />
                    {(() => {
                      const craftableItem = craftableItems?.find(
                        (item) => item.id === selectedItem.id,
                      );
                      if (
                        !craftableItem?.craftingRequirements ||
                        craftableItem.craftingRequirements.length === 0
                      ) {
                        return null;
                      }

                      return (
                        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                          <h4 className="font-semibold text-sm mb-2">
                            Required Materials
                          </h4>
                          <div className="space-y-2">
                            {craftableItem.craftingRequirements.map((req, index) => {
                              const totalQuantity = getTotalItemQuantity(
                                userItems || [],
                                req.requirementItemId,
                              );
                              const required = req.quantity;
                              const hasEnough = totalQuantity >= required;

                              return (
                                <div
                                  key={index}
                                  className="flex items-center justify-between"
                                >
                                  <span className="text-sm">
                                    {required}x{" "}
                                    {req.requirementItem?.name || "Unknown Item"}
                                  </span>
                                  <div
                                    className={`text-sm font-medium ${
                                      hasEnough ? "text-green-600" : "text-red-600"
                                    }`}
                                  >
                                    {totalQuantity}/{required}
                                    {hasEnough ? " ✓" : " ✗"}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Modal2>
              )}
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
                  <span className="text-sm font-normal text-muted-foreground">
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
                    onClick={() => finishImbuingImmediatelyMutation.mutate({ userItemImbuementId: activeImbuement.id })}
                    disabled={finishImbuingImmediatelyMutation.isPending}
                    loading={finishImbuingImmediatelyMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="w-fit"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Instant Finish (Staff)
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Imbue New Item */}
        {!activeImbuingItem && !activeImbuement && (
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
                      <h4 className="font-medium mb-2">Select Item to Imbue</h4>
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
                        <h4 className="font-medium mb-2">Select Crystal</h4>
                        <ActionSelector
                          items={crystals.map((userItem) => ({
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
                        <Modal2
                          title="Imbue Item"
                          proceed_label={
                            imbueItemMutation.isPending ? undefined : "Imbue Item"
                          }
                          isOpen={isImbueModalOpen}
                          setIsOpen={setIsImbueModalOpen}
                          isValid={false}
                          onAccept={handleImbueItem}
                          confirmClassName="bg-purple-600 text-white hover:bg-purple-700"
                        >
                          <div className="space-y-4">
                            <div>
                              <h4 className="font-semibold text-sm mb-2">
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
                              <h4 className="font-semibold text-sm mb-2">Crystal</h4>
                              {selectedCrystalUserItem.item && (
                                <ItemWithEffects item={selectedCrystalUserItem.item} />
                              )}
                            </div>
                            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                              <p className="text-sm text-muted-foreground">
                                This will permanently imbue your{" "}
                                {selectedImbuableItem.item?.name} with the effects of{" "}
                                {selectedCrystalUserItem.item?.name}. The crystal will
                                be consumed in the process.
                              </p>
                            </div>
                          </div>
                        </Modal2>
                      )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Novice (0-{CRAFTING_REQUIRED_EXP.APPRENTICE.toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.NOVICE.COMMON} minutes</li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.NOVICE.RARE} minutes</li>
                    </ul>
                  </div>
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Apprentice ({CRAFTING_REQUIRED_EXP.APPRENTICE.toLocaleString()}-
                      {CRAFTING_REQUIRED_EXP.MASTER.toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.APPRENTICE.COMMON} minutes</li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.APPRENTICE.RARE} minutes</li>
                      <li>• Epic: {CRAFTING_TIMES_MINS.APPRENTICE.EPIC} minutes</li>
                    </ul>
                  </div>
                  <div>
                    <Badge variant="outline" className="mb-2">
                      Master ({CRAFTING_REQUIRED_EXP.MASTER.toLocaleString()}-
                      {CRAFTING_REQUIRED_EXP.FORGEMASTER.toLocaleString()} exp)
                    </Badge>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Common: {CRAFTING_TIMES_MINS.MASTER.COMMON} minutes</li>
                      <li>• Rare: {CRAFTING_TIMES_MINS.MASTER.RARE} minutes</li>
                      <li>• Epic: {CRAFTING_TIMES_MINS.MASTER.EPIC} minutes</li>
                      <li>
                        • Legendary: {CRAFTING_TIMES_MINS.MASTER.LEGENDARY} minutes
                      </li>
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
                <h4 className="font-medium mb-2">How Crafting Works</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
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
