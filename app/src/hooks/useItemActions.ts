"use client";

import { api } from "@/app/_trpc/client";
import {
  getEquippedInventory,
  getImbuementRemovedInventory,
  getInventoryDurabilities,
  getInventoryQuantities,
  getSoldInventory,
} from "@/deltas/item";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useItemConsumptionCacheUpdate } from "@/hooks/useItemConsumptionCacheUpdate";
import {
  finishItemConsumeRequest,
  getItemConsumeErrorMessage,
} from "@/libs/itemConsumption";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useRequiredUserInfo, useUserDataSelector } from "@/utils/UserContext";
import type { CardPackReveal } from "@/validators/weightedCache";

/**
 * Binds per-item tRPC mutations to the shared inventory and profile cache controllers.
 * Each action owns when onDone dismisses its initiating view; repairs dismiss only after
 * confirmed success, while actions with settlement handlers also dismiss after rejection.
 * Inventory reconciliation after confirmed writes runs in the background, so the pressed
 * control is released as soon as the server answers. `onPackReveal` receives the reveal
 * of an opened Kessen card pack in place of the reward toast.
 */
export const useItemActions = ({
  useritem,
  onDone,
  onPackReveal,
}: {
  useritem: UserItemWithRelations | undefined;
  onDone: () => void;
  onPackReveal?: (reveal: CardPackReveal) => void;
}) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const utils = api.useUtils();
  const {
    prepareInventoryUpdate,
    updateInventory,
    invalidateInventory,
    reconcileCardMoves,
  } = useInventoryCacheUpdate();

  // Dismiss the initiating view for actions that finish on settlement.
  const onSettled = () => {
    onDone();
  };

  const { mutate: merge, isPending: isMerging } = api.item.mergeStacks.useMutation({
    onMutate: () => ({
      inventory: prepareInventoryUpdate(),
      user: prepareUserUpdate(),
      itemType: useritem?.item.itemType,
    }),
    onSuccess: async (data, _input, snapshot) => {
      showMutationToast(data);
      if (data.userRecovery) await updateUser(data, { revision: snapshot.user });
      await Promise.all([
        updateInventory(
          data.success
            ? (rows) => getInventoryQuantities(rows, data.inventoryChanges)
            : undefined,
          snapshot.inventory,
        ),
        // The Card Hall lists pack stacks by id, so merged-away packs leave it.
        data.success ? reconcileCardMoves([snapshot.itemType]) : undefined,
      ]);
    },
    onError: async (error, _input, snapshot) => {
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await Promise.all([
        invalidateInventory(),
        reconcileCardMoves([snapshot?.itemType]),
      ]);
    },
    onSettled,
  });

  const { consume, isConsuming } = useConsumeItem({
    useritem,
    inventoryQuery: "getUserItemsWithVariants",
    onSettled,
    onPackReveal,
  });

  const { mutate: sell, isPending: isSelling } = api.item.sellUserItem.useMutation({
    onMutate: () => ({
      inventory: prepareInventoryUpdate(),
      user: prepareUserUpdate(),
      itemType: useritem?.item.itemType,
    }),
    onSuccess: async (data, input, context) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateInventory(
            (rows) => getSoldInventory(rows, input.userItemId),
            context.inventory,
          ),
          updateUser(data, { revision: context.user }),
          reconcileCardMoves([context.itemType]),
        ]);
      }
    },
    onError: async (error, _input, context) => {
      // A local handler replaces the provider's default toast; report before recovery reads.
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      // The sale may have committed before the error, so both views need authoritative reads.
      await Promise.all([
        invalidateInventory(),
        updateUser(undefined, { revision: undefined }),
        reconcileCardMoves([context?.itemType]),
      ]);
    },
    onSettled,
  });

  const { mutate: equip, isPending: isEquipping } = api.item.toggleEquip.useMutation({
    onMutate: prepareInventoryUpdate,
    onSuccess: async (data, _input, context) => {
      showMutationToast(data);
      if (data.success) {
        await updateInventory(
          (rows) => getEquippedInventory(rows, data.equipmentChanges),
          context,
        );
      }
    },
    onError: async (error) => {
      // The write may have committed before the error; show feedback and recover both views.
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await invalidateInventory();
    },
    onSettled,
  });

  const { mutate: splitStack, isPending: isSplitting } =
    api.item.splitStack.useMutation({
      onMutate: () => ({ itemType: useritem?.item.itemType }),
      onSuccess: async (data, _input, context) => {
        showMutationToast(data);
        // The source may have moved or changed cosmetics in another tab before splitting.
        if (data.success) {
          void invalidateInventory();
          void reconcileCardMoves([context.itemType]);
        }
      },
      onSettled,
    });

  const { mutate: repairWithKit, isPending: isUsingRepairItem } =
    repairWithKitProcedure.useMutation({
      onMutate: () => ({
        inventory: prepareInventoryUpdate(),
        user: prepareUserUpdate(),
      }),
      onSuccess: async (data, _variables, context) => {
        showMutationToast(data);
        if (data.userRecovery && !data.success)
          void updateUser(data, { revision: context.user });
        if (data.success) {
          onDone();
          await updateUser(data, { revision: context.user });
          void updateInventory(
            (rows) =>
              getInventoryDurabilities(
                getInventoryQuantities(rows, data.inventoryChanges),
                data.durabilityChanges,
              ),
            context.inventory,
          );
        }
      },
    });

  const { mutate: repairWithRyo, isPending: isRepairingWithRyo } =
    api.item.repair.useMutation({
      onMutate: () => ({
        inventory: prepareInventoryUpdate(),
        user: prepareUserUpdate(),
      }),
      onSuccess: async (data, _variables, context) => {
        showMutationToast(data);
        if (data.userRecovery && !data.success)
          void updateUser(data, { revision: context.user });
        if (data.success) {
          onSettled();
          await updateUser(data, { revision: context.user });
          void updateInventory(
            (rows) => getInventoryDurabilities(rows, data.durabilityChanges),
            context.inventory,
          );
        }
      },
    });

  const { mutate: evolve, isPending: isEvolving } = api.item.evolveItem.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success || data.userRecovery)
        await updateUser(data, { revision, refetch: false });
      if (data.success) {
        void Promise.all([
          utils.item.getUserItemsWithVariants.invalidate(),
          utils.item.getEvolutions.invalidate(),
          utils.item.getItemLoadouts.invalidate(),
        ]);
      }
    },
    onSettled,
  });

  const { mutate: removeImbuement, isPending: isRemovingImbuement } =
    api.occupation.removeImbuement.useMutation({
      onMutate: prepareInventoryUpdate,
      onSuccess: async (data, _variables, context) => {
        showMutationToast(data);
        if (data.success)
          void updateInventory(
            (rows) =>
              data.removedImbuement?.returnedCrystal
                ? undefined
                : getImbuementRemovedInventory(rows, data.removedImbuement),
            context,
          );
      },
      onSettled,
    });

  return {
    merge,
    consume,
    sell,
    equip,
    splitStack,
    repairWithKit,
    repairWithRyo,
    evolve,
    removeImbuement,
    isMerging,
    isConsuming,
    isSelling,
    isEvolving,
    isEquipping,
    isSplitting,
    isUsingRepairItem,
    isRepairingWithRyo,
    isPending:
      isMerging ||
      isConsuming ||
      isSelling ||
      isEquipping ||
      isSplitting ||
      isUsingRepairItem ||
      isEvolving ||
      isRemovingImbuement ||
      isRepairingWithRyo,
  };
};

// Alias the procedure so its action name is not interpreted as a React hook. Optional
// access lets the module load where tests replace the client without this router.
const repairWithKitProcedure = api.item?.useRepairItem;

/**
 * Consume one stack and reconcile profile, inventory and effect caches. `useritem` is the
 * selected stack and `inventoryQuery` the inventory view the caller shows. A caller that
 * can show the Kessen pack ceremony passes `onPackReveal`, which then replaces the reward
 * toast of a card pack.
 */
export const useConsumeItem = ({
  useritem,
  inventoryQuery,
  onSettled,
  onPackReveal,
}: {
  useritem: { item: Pick<Item, "itemType" | "effects"> } | undefined;
  inventoryQuery: "getUserItems" | "getUserItemsWithVariants";
  onSettled: () => void;
  onPackReveal?: (reveal: CardPackReveal) => void;
}) => {
  // Selecting the id alone keeps the travel map from rendering on every move.
  const {
    data: userId,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector(selectUserId);
  const utils = api.useUtils();
  const { prepareConsumptionUpdate, updateConsumption } =
    useItemConsumptionCacheUpdate();

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onMutate: (variables) => ({
      userRevision: prepareUserUpdate(),
      consumption: prepareConsumptionUpdate(variables.userItemId),
    }),
    onSuccess: async (data, variables, context) => {
      finishItemConsumeRequest(userId ?? "", variables.userItemId);
      const packReveal = data.success ? data.kessenReveal : undefined;
      if (packReveal && onPackReveal) {
        onPackReveal(packReveal);
      } else if (data.success && "rewards" in data && data.rewards) {
        showRewardToast(
          data.notifications ?? [],
          data.rewards,
          data.message,
          false,
          undefined,
          undefined,
          data.cacheRewards,
          data.petRewards,
        );
      } else {
        let message = data.message || "Consume failed";
        if ("notifications" in data && data.notifications) {
          for (const notification of data.notifications || []) {
            message += `\n${notification}`;
          }
        }
        showMutationToast({ success: data.success, message });
      }
      if (data.success) {
        // The action is complete; keep reconciliation off the dialog's pending path.
        void Promise.allSettled([
          updateUser(data, { revision: context.userRevision }).then((profileApplied) =>
            updateConsumption(data, context.consumption, profileApplied),
          ),
        ]);
      } else if (useritem?.item.itemType === "MEAL") {
        // A rejected snapshot must refresh the next view's quantity and account state.
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.item[inventoryQuery].invalidate(),
        ]);
      }
    },
    onError: async (error, _input, context) => {
      const message = getItemConsumeErrorMessage(error, useritem?.item);
      if (message) showMutationToast({ success: false, message });
      await updateUser(undefined);
      await updateConsumption(
        undefined,
        context?.consumption ?? prepareConsumptionUpdate(),
        false,
      );
    },
    onSettled,
  });

  return { consume, isConsuming };
};

/** Subscribe item actions to account identity without observing unrelated profile fields. */
const selectUserId = (user: NonNullable<UserWithRelations>) => user.userId;
