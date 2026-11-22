import type { RouterOutputs } from "@/app/_trpc/client";
import { incrementInboxNotifications } from "@/deltas/chat";
import { getInventoryQuantities, getInventoryQuantityChanges } from "@/deltas/item";
import type { CraftingServiceRequest, UserData, UserItem } from "@/drizzle/schema";
import type { NavBarDropdownLink } from "@/libs/menus";
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

/** Describe confirmed fees, escrow, fortification and receipts when participant hydration leaves other views unchanged. */
export const getServiceSubmissionCacheUpdate = ({
  requester,
  requesterResult,
  crafterResult,
  request,
  completion,
  consumptions,
  equipment,
  crafterName,
  crystalName,
}: {
  requester: Pick<UserData, "userId" | "status" | "money" | "username" | "inboxNews">;
  requesterResult: Hydration;
  crafterResult: Hydration;
  request: CraftingServiceRequest;
  completion?: { updatedAt: Date; countedAt: number };
  consumptions: { row: InventoryBaseline; quantity: number }[];
  equipment?: InventoryBaseline;
  crafterName: string;
  crystalName?: string;
}) => {
  if (
    requester.status !== "AWAKE" ||
    request.service === "REPAIR" ||
    (request.service === "FORTIFY" &&
      (!completion ||
        request.status !== "COMPLETED" ||
        !request.fortify ||
        !equipment)) ||
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
    ...(equipment
      ? [{ row: equipment, quantity: request.service === "FORTIFY" ? 1 : 0 }]
      : []),
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
    beforeInboxNews: requester.inboxNews,
    fortify:
      request.service === "FORTIFY" && completion && request.fortify
        ? { ...completion, state: request.fortify.state }
        : undefined,
    userDelta: { money: -request.fee - (request.fortify?.cost ?? 0) },
    inventoryChanges: getInventoryQuantityChanges(
      removals.map(({ row }) => row),
      removals.map(({ row, quantity }) => ({ id: row.id, quantity })),
      completion?.updatedAt ?? request.createdAt,
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
  current: Pick<UserData, "userId" | "money" | "status" | "inboxNews"> & {
    items: { id: string }[];
  },
  update: ServiceSubmissionUpdate | undefined,
) =>
  update &&
  current.userId === update.requesterId &&
  current.status === "AWAKE" &&
  current.money === update.beforeMoney &&
  (!update.fortify || current.inboxNews === update.beforeInboxNews) &&
  !current.items.some((row) =>
    update.inventoryChanges.some((change) => change.id === row.id),
  )
    ? update.fortify
      ? { inboxNews: current.inboxNews + 1 }
      : {}
    : undefined;

/** Apply delivered fortification, escrow and materials only against the exact loaded row identities/revisions. */
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
  const rows = getInventoryQuantities(current, update.inventoryChanges);
  const fortify = update.fortify;
  return fortify
    ? rows?.map((row) =>
        row.id === update.receipt.targetUserItemId
          ? { ...row, fortification: fortify.state }
          : row,
      )
    : rows;
};

/** Add the confirmed receipt without duplicating one already observed through another response. */
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

/** Count the completed service's inbox receipt after its profile and inbox-read guards pass. */
export const getServiceSubmissionNotifications = (
  current: NavBarDropdownLink[] | undefined,
  update: ServiceSubmissionUpdate | undefined,
) => (update?.fortify ? incrementInboxNotifications(current) : current);

/** Identify receipt phases whose profile and dependent views have already been reconciled. */
export const getServiceReconciliationSignature = (
  data: RouterOutputs["occupation"]["getServiceRequests"],
  userId: string | undefined,
  generation: number,
) => {
  const terminal = data
    .filter((row) => row.status === "COMPLETED" || row.status === "REFUNDED")
    .map((row) => `${row.id}:${row.status}`)
    .sort()
    .join("|");
  const active = data
    .filter((row) => row.status === "ACTIVE" && row.crafterId === userId)
    .map((row) => row.id)
    .sort()
    .join("|");
  return terminal || active || generation
    ? `${terminal}|${active}|${generation}`
    : undefined;
};
