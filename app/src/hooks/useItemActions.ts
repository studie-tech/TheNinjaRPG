"use client";

import { api } from "@/app/_trpc/client";
import {
  getEquippedInventory,
  getInventoryQuantities,
  getSoldInventory,
} from "@/deltas/item";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useItemConsumptionCacheUpdate } from "@/hooks/useItemConsumptionCacheUpdate";
import {
  finishItemConsumeRequest,
  getItemConsumeErrorMessage,
} from "@/libs/itemConsumption";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Every action on a single carried item, shared by the backpack, the slot picker, the
 * inspector and the item menus. `onDone` runs once an action settles, so the caller can
 * close whatever panel or dialog started it.
 */
export const useItemActions = ({
  userData,
  useritem,
  onDone,
}: {
  userData: NonNullable<UserWithRelations>;
  useritem: UserItemWithRelations | undefined;
  onDone: () => void;
}) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();
  const { prepareConsumptionUpdate, updateConsumption } =
    useItemConsumptionCacheUpdate();

  // Handler for when mutations are settled
  const onSettled = () => {
    onDone();
  };

  const { mutate: merge, isPending: isMerging } = api.item.mergeStacks.useMutation({
    onMutate: prepareInventoryUpdate,
    onSuccess: async (data, _input, snapshot) => {
      showMutationToast(data);
      await updateInventory(
        data.success
          ? (rows) => getInventoryQuantities(rows, data.inventoryChanges)
          : undefined,
        snapshot,
      );
    },
    onError: async (error) => {
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await invalidateInventory();
    },
    onSettled,
  });

  const { mutate: consume, isPending: isConsuming } = api.item.consume.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      consumption: prepareConsumptionUpdate(),
    }),
    onSuccess: async (data, variables, context) => {
      finishItemConsumeRequest(userData.userId, variables.userItemId);
      if (data.success && "rewards" in data && data.rewards) {
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
        // A rejected snapshot must refresh the next panel's quantity and account state.
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.item.getUserItemsWithVariants.invalidate(),
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

  const { mutate: sell, isPending: isSelling } = api.item.sellUserItem.useMutation({
    onMutate: prepareInventoryUpdate,
    onSuccess: async (data, input, context) => {
      showMutationToast(data);
      if (data.success) {
        await updateInventory(
          (rows) => getSoldInventory(rows, input.userItemId),
          context,
        );
      }
    },
    onError: async (error) => {
      // A local handler replaces the provider's default toast; report before recovery reads.
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await invalidateInventory();
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
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItemsWithVariants.invalidate();
        }
      },
      onSettled,
    });

  const { mutate: repairWithKit, isPending: isUsingRepairItem } =
    repairWithKitProcedure.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          onDone();
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: repairWithRyo, isPending: isRepairingWithRyo } =
    api.item.repair.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          onSettled();
          await Promise.all([
            utils.item.getUserItemsWithVariants.invalidate(),
            updateUser(data.userPatch, { revision, delta: data.userDelta }),
          ]);
        }
      },
    });

  const { mutate: evolve, isPending: isEvolving } = api.item.evolveItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
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
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.item.getUserItemsWithVariants.invalidate();
        }
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

// Alias the procedure so its action name is not interpreted as a React hook.
const repairWithKitProcedure = api.item.useRepairItem;
