"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import { useCosmetics } from "@/hooks/useCosmetics";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import { isEquippableUserItem } from "@/libs/item";
import { showMutationToast } from "@/libs/toast";
import { getVillageLoyaltyShopCost } from "@/libs/villageLoyalty";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import { displayCostType } from "@/validators/item";

/** Browses, purchases, unlocks and selects item variants, refreshing affected inventory views. */
export const ItemVariantModal: React.FC<ItemVariantModalProps> = ({
  userItem,
  allUserItems,
  onClose,
}) => {
  const utils = api.useUtils();
  const { refreshWardrobe } = useCosmetics();
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    isOutlaw: u.isOutlaw,
    joinedVillageAt: u.joinedVillageAt,
    villageId: u.villageId,
  }));
  const variants = userItem.item.variants ?? [];
  const { data: itemNames } = api.item.getAllNames.useQuery(undefined, {
    enabled: variants.some((variant) => Boolean(variant.requiredItemId)),
  });

  const { data: unlockedVariants } = api.item.getUserUnlockedVariants.useQuery({
    itemId: userItem.item.id,
  });
  // Until the unlock list resolves, unlockedIds is empty — gate locked actions on
  // this so an already-owned variant never briefly renders a Buy / Use Token button.
  const unlockStatusLoaded = unlockedVariants !== undefined;
  const unlockedIds = new Set(unlockedVariants?.map((u) => u.variantId) ?? []);

  // Match the server's carried, non-auctioned and finished-crafting checks.
  const variantTokens =
    allUserItems?.filter(
      (ui) =>
        isEquippableUserItem(ui) &&
        ui.item.effects.some((e) => e.type === "unlockitemvariant"),
    ) ?? [];

  const purchase = api.item.purchaseVariant.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          refreshWardrobe(),
          utils.item.getUserUnlockedVariants.invalidate({ itemId: userItem.item.id }),
          updateUser(undefined, { revision, delta: result.userDelta }),
        ]);
      }
    },
  });

  const consumeToken = api.item.consumeVariantToken.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      showMutationToast(result);
      if (result.success || result.userRecovery)
        await updateUser(result, { revision, refetch: false });
      if (result.success) {
        onClose();
        await Promise.all([
          refreshWardrobe(),
          utils.item.getUserUnlockedVariants.invalidate({ itemId: userItem.item.id }),
          utils.item.getUserItemsWithVariants.invalidate(),
        ]);
      }
    },
  });

  const select = api.item.selectVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        // One selection changes inventory labels, the profile preview and the public sector recipe.
        await Promise.all([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.profile.getUser.invalidate(),
          utils.travel.getSectorData.invalidate(),
        ]);
        onClose();
      }
    },
  });

  const activeVariantId = userItem.activeVariantId;

  return (
    <Modal
      title={`Variants — ${userItem.item.name}`}
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      isValid={false}
    >
      <p className="mb-4 text-muted-foreground text-sm">
        Purchase and select a variant to change how this item appears.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Base look */}
        <button
          type="button"
          className={`cursor-pointer rounded border p-2 ${!activeVariantId ? "ring-primary ring-2" : ""}`}
          onClick={() => select.mutate({ userItemId: userItem.id, variantId: null })}
        >
          <Image
            src={userItem.item.image}
            alt="Base"
            width={80}
            height={80}
            className="mx-auto rounded"
          />
          <p className="mt-1 text-center font-medium text-xs">Base (Free)</p>
          {!activeVariantId && (
            <p className="text-center text-primary text-xs">Active</p>
          )}
        </button>

        {variants.map((v) => {
          const isUnlocked = unlockedIds.has(v.id);
          const isActive = activeVariantId === v.id;
          const needsToken = v.costType === "VARIANT_TOKEN";
          const matchingToken = variantTokens.find(
            (token) =>
              (!v.requiredItemId || token.item.id === v.requiredItemId) &&
              token.item.effects.some(
                (effect) =>
                  effect.type === "unlockitemvariant" &&
                  (!effect.variantId || effect.variantId === v.id),
              ),
          );
          const tokenActionLabel = matchingToken
            ? `Use ${matchingToken.item.name}`
            : `Need ${itemNames?.find((entry) => entry.id === v.requiredItemId)?.name ?? "compatible token"}`;
          // Preview the same discounted prestige amount guarded and charged by the server.
          const purchaseCost =
            v.costType === "VILLAGE_PRESTIGE" && userData
              ? getVillageLoyaltyShopCost(v.cost, userData)
              : v.cost;

          return (
            <div
              key={v.id}
              className={`rounded border p-2 ${isActive ? "ring-primary ring-2" : ""} ${!isUnlocked ? "opacity-60" : "cursor-pointer"}`}
            >
              <Image
                src={v.image}
                alt={v.name}
                width={80}
                height={80}
                className="mx-auto rounded"
              />
              <p className="mt-1 text-center font-medium text-xs">{v.name}</p>
              {v.description && (
                <div
                  className="mt-0.5 text-center text-muted-foreground text-xs"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized server-side before storage
                  dangerouslySetInnerHTML={{ __html: v.description }}
                />
              )}

              {isUnlocked ? (
                isActive ? (
                  <p className="text-center text-primary text-xs">Active</p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 w-full"
                    onClick={() =>
                      select.mutate({ userItemId: userItem.id, variantId: v.id })
                    }
                    disabled={select.isPending}
                  >
                    Select
                  </Button>
                )
              ) : !unlockStatusLoaded ? (
                <Button size="sm" variant="outline" className="mt-1 w-full" disabled>
                  …
                </Button>
              ) : needsToken ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 w-full"
                  disabled={!matchingToken || consumeToken.isPending}
                  onClick={() => {
                    const token = matchingToken;
                    if (token) {
                      consumeToken.mutate({
                        tokenUserItemId: token.id,
                        variantId: v.id,
                      });
                    }
                  }}
                >
                  <span className="min-w-0 truncate" title={tokenActionLabel}>
                    {tokenActionLabel}
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 w-full"
                  onClick={() => purchase.mutate({ variantId: v.id })}
                  disabled={purchase.isPending}
                >
                  {`Buy: ${purchaseCost.toLocaleString()} ${displayCostType(v.costType)}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

interface ItemVariantModalProps {
  userItem: UserItemWithVariants;
  allUserItems: UserItemWithRelations[] | undefined;
  onClose: () => void;
}
