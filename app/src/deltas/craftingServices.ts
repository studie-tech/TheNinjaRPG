import type { RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities, getInventoryQuantityChanges } from "@/deltas/item";
import type { CraftingServiceRequest, UserData, UserItem } from "@/drizzle/schema";
import type { fetchUpdatedUser } from "@/server/api/routers/profile";

type Hydration = Pick<
  Awaited<ReturnType<typeof fetchUpdatedUser>>,
  | "requiresUserRefresh"
  | "requiresProgressionRefresh"
  | "craftingItemsChanged"
  | "startedQueuedJobs"
>;
type InventoryBaseline = Pick<
  UserItem,
  "id" | "itemId" | "userId" | "quantity" | "updatedAt" | "equipped"
>;

/** Describe only fee, escrow and receipt changes when neither participant's hydration changed other views. */
export const getServiceSubmissionCacheUpdate = ({
  requester,
  requesterResult,
  crafterResult,
  request,
  consumptions,
  equipment,
  crafterName,
  crystalName,
}: {
  requester: Pick<UserData, "userId" | "status" | "money" | "username">;
  requesterResult: Hydration;
  crafterResult: Hydration;
  request: CraftingServiceRequest;
  consumptions: { row: InventoryBaseline; quantity: number }[];
  equipment?: InventoryBaseline;
  crafterName: string;
  crystalName?: string;
}) => {
  if (
    requester.status !== "AWAKE" ||
    request.service === "REPAIR" ||
    request.service === "FORTIFY" ||
    [requesterResult, crafterResult].some(
      (result) =>
        result.requiresUserRefresh !== false ||
        result.requiresProgressionRefresh !== false ||
        result.craftingItemsChanged !== false ||
        result.startedQueuedJobs !== 0,
    )
  )
    return;
  const removals = [
    ...consumptions.map(({ row, quantity }) => ({
      row,
      quantity: row.quantity - quantity,
    })),
    ...(equipment ? [{ row: equipment, quantity: 0 }] : []),
  ];
  // Escrow and materials must never be part of the profile's equipped-item projection.
  if (
    removals.some(
      ({ row }) => row.equipped !== "NONE" || row.userId !== requester.userId,
    )
  )
    return;
  return {
    requesterId: requester.userId,
    beforeMoney: requester.money,
    userDelta: { money: -request.fee },
    inventoryChanges: getInventoryQuantityChanges(
      removals.map(({ row }) => row),
      removals.map(({ row, quantity }) => ({ id: row.id, quantity })),
      request.createdAt,
    ).map((change, index) => ({
      ...change,
      beforeUpdatedAt: removals[index]!.row.updatedAt,
    })),
    receipt: {
      ...request,
      crafter: { username: crafterName },
      requester: { username: requester.username },
      crystal: crystalName ? { name: crystalName } : null,
      settlementError: null,
    },
  };
};

type ServiceSubmissionUpdate = NonNullable<
  ReturnType<typeof getServiceSubmissionCacheUpdate>
>;

/** Validate the captured requester's fee baseline and preserve all unrelated profile fields. */
export const getServiceRequesterPatch = (
  current: Pick<UserData, "userId" | "money" | "status"> & { items: { id: string }[] },
  update: ServiceSubmissionUpdate | undefined,
) =>
  update &&
  current.userId === update.requesterId &&
  current.status === "AWAKE" &&
  current.money === update.beforeMoney &&
  !current.items.some((row) =>
    update.inventoryChanges.some((change) => change.id === row.id),
  )
    ? {}
    : undefined;

/** Remove escrow and consume materials in either inventory view only against the exact loaded row identities/revisions. */
export const getServiceSubmittedInventory = <T extends InventoryBaseline>(
  current: T[],
  update: ServiceSubmissionUpdate | undefined,
): T[] | undefined => {
  if (
    !update ||
    update.inventoryChanges.some(
      (change) =>
        !current.some(
          (row) =>
            row.id === change.id &&
            row.userId === update.requesterId &&
            row.equipped === "NONE" &&
            row.updatedAt.getTime() === change.beforeUpdatedAt.getTime(),
        ),
    )
  )
    return;
  return getInventoryQuantities(current, update.inventoryChanges);
};

/** Add the known pending receipt without duplicating one already observed through another response. */
export const getSubmittedServiceRequests = (
  current: RouterOutputs["occupation"]["getServiceRequests"],
  update: ServiceSubmissionUpdate | undefined,
): RouterOutputs["occupation"]["getServiceRequests"] | undefined =>
  update && !current.some((row) => row.id === update.receipt.id)
    ? [update.receipt, ...current]
    : undefined;

/** Preserve requester queue and timers only when submission had no settlement or recovery effects. */
export const getServiceSubmissionUnchanged = <T>(
  current: T,
  update: ServiceSubmissionUpdate | undefined,
): T | undefined => (update ? current : undefined);
