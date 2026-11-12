import * as Sentry from "@sentry/nextjs";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { HomeType, UserRequestState, UserStatus } from "@/drizzle/constants";
import {
  HOME_DOWNGRADE_REFUND_PERCENT,
  HOME_FURNITURE_STORAGE_CAPACITY,
  HOME_INVITATION_EXPIRY_SECONDS,
  HOME_MAX_INVITATIONS,
  HomeTypeDetails,
  HomeTypes,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MAX_BULK_SELL_ITEMS,
} from "@/drizzle/constants";
import { userData, userItem } from "@/drizzle/schema";
import {
  getHomeLayout,
  type HomeFurniture,
  homeLayoutOrientationError,
  homeLayoutOwnershipError,
  homeLayoutPlacementError,
  recoverHomeLayout,
} from "@/libs/home";
import { getHomeRooms, homeRoomStylesError } from "@/libs/homeProperty";
import {
  applyActiveVariant,
  countsTowardInventoryStorage,
  getEffectiveStackSize,
  getHomeStorageBucket,
  getHomeStorageBucketCapacity,
  getHomeStorageBucketFullMessage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
} from "@/libs/item";
import {
  HOME_STORAGE_STATUSES,
  homeStorageBlockReason,
  homeStorageMoveMessage,
  planHomeStorageMove,
} from "@/libs/itemsPage";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { ISOLATED_PYRAMID_MESSAGE } from "@/libs/questRun";
import { getBiomeFromTileType } from "@/libs/travel";
import {
  executeResultForMoveUserItems,
  executeResultForSetHomeSharing,
  executeResultForToggleStoreItem,
  executeResultForUpgradeHome,
  executeRowsForPublishHomeFurnitureLayout,
  fetchHomeFurnitureUser,
  findUserDataForInviteHomeVisitor,
  findUserDataForInviteHomeVisitor2,
  findUserHomeForUpgradeHome,
  findUserRequestForGetVisitedHome,
  insertUserHomeForEnsureUserHome,
  updateUserDataForToggleSleep,
  updateUserDataForUpgradeHome,
} from "@/queries/home";
import { listUserItemForMergeAllStacks } from "@/queries/item";
import { fetchRequests, insertRequest } from "@/queries/sparring";
import { fetchSectorVillage } from "@/queries/village";
import { executeMergeStacksForItem, fetchUserItems } from "@/routers/item";
import { fetchUpdatedUser } from "@/routers/profile";
import { fetchRequest, updateRequestState } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getSectorTileType } from "@/server/utils/sectorMap";
import { groupBy } from "@/utils/grouping";
import { secondsFromNow } from "@/utils/time";
import {
  type HomePlacement,
  type HomeRoomStyle,
  homeFurnitureSaveInputSchema,
  homeUpgradeInputSchema,
} from "@/validators/home";
import { inventoryQuantityChangeSchema } from "@/validators/inventory";
import { DEFAULT_FURNITURE_DATA } from "@/validators/itemFurniture";
import { idSchema } from "@/validators/misc";

/** The router checks visibility or invitation membership for the requested owner. */
const homeVisitInputSchema = z.strictObject({
  userId: z.string().min(1).max(191),
});

/** Visibility edits are guarded by the furniture revision. */
const homeSharingInputSchema = z.strictObject({
  revision: z.int().nonnegative(),
  isPublic: z.boolean(),
});

/** Invitees are addressed by their current username. */
const homeInvitationInputSchema = z.strictObject({
  username: z.string().trim().min(1).max(191),
});

const homeStorageInputSchema = z.object({ userItemId: z.string() });

const homeSleepResponseSchema = baseServerResponse.extend({
  newStatus: z.enum(["AWAKE", "ASLEEP"]).optional(),
});

export const homeRouter = createTRPCRouter({
  /** Return authorized, placed decorations without repairing the owner's home or exposing inventory. */
  getVisitedHome: protectedProcedure
    .input(homeVisitInputSchema)
    .query(async ({ ctx, input }) => {
      const [owner, invitation] = await Promise.all([
        fetchHomeFurnitureUser(ctx.drizzle, input.userId),
        findUserRequestForGetVisitedHome(ctx.drizzle, input, ctx),
      ]);
      if (
        !owner ||
        owner.isBanned ||
        owner.isAi ||
        owner.deletionAt ||
        (input.userId !== ctx.userId && !owner.home?.isPublic && !invitation)
      ) {
        return {
          success: false as const,
          message:
            "This home is private or unavailable. Ask its owner for an invitation.",
          home: null,
        };
      }
      const owned = owner.items.filter(isAvailableOwnedFurniture);
      const furniture = owned.map(homeFurnitureDetails);
      const layout = recoverHomeLayout(getHomeLayout(owned), furniture, owner.homeType);
      const placed = new Set(layout.map(({ id }) => id));
      return {
        success: true as const,
        message: "",
        home: {
          username: owner.username,
          homeType: owner.homeType,
          biome: getHomeBiome(owner),
          styles: owner.home?.roomStyles ?? [],
          layout,
          furniture: furniture.filter(({ id }) => placed.has(id)),
        },
      };
    }),

  /** Shared requests carry pending invitations and durable, revocable accepted home access. */
  getHomeRequests: protectedProcedure.query(async ({ ctx }) =>
    fetchRequests(ctx.drizzle, ["HOME"], undefined, ctx.userId),
  ),

  /** Invite a player to visit; access is a HOME user request the invitee must accept. */
  inviteHomeVisitor: protectedProcedure
    .input(homeInvitationInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [owner, invitee, requests] = await Promise.all([
        findUserDataForInviteHomeVisitor(ctx.drizzle, ctx),
        findUserDataForInviteHomeVisitor2(ctx.drizzle, input),
        fetchRequests(ctx.drizzle, ["HOME"], undefined, ctx.userId),
      ]);
      if (!owner || owner.isBanned || owner.isAi || owner.deletionAt)
        return errorResponse("Home unavailable");
      if (
        !invitee ||
        invitee.isAi ||
        invitee.isBanned ||
        invitee.deletionAt ||
        invitee.userId === ctx.userId
      )
        return errorResponse("Choose another active player to invite");
      const active = requests.filter(
        (request) =>
          request.senderId === ctx.userId &&
          ["PENDING", "ACCEPTED"].includes(request.status),
      );
      if (active.some((request) => request.receiverId === invitee.userId))
        return errorResponse("This player already has a home invitation");
      if (active.length >= HOME_MAX_INVITATIONS)
        return errorResponse(`You can invite up to ${HOME_MAX_INVITATIONS} players`);
      // The unique active pair prevents duplicate grants. Concurrent invitations to different players
      // can exceed the cosmetic list cap; owners can revoke them without account or inventory costs.
      try {
        await insertRequest(ctx.drizzle, ctx.userId, invitee.userId, "HOME");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("This player already has a home invitation");
        throw error;
      }
      void getServerPusher().trigger(invitee.userId, "event", {
        type: "homeInvitation",
        message: "You have been invited to visit a home",
        route: "/home#home-invitations",
        routeText: "View invitation",
      });
      return { success: true, message: "Home invitation sent" };
    }),

  /** Only the recipient can accept a live invitation; revocation wins against a stale acceptance. */
  acceptHomeInvitation: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "HOME", {
        allowMissing: true,
      });
      if (!request)
        return errorResponse(
          "This invitation is no longer available. Refresh and try again",
        );
      if (request.receiverId !== ctx.userId)
        return errorResponse("Not your invitation to accept");
      if (request.status !== "PENDING")
        return errorResponse("This invitation is no longer pending");
      if (request.createdAt < secondsFromNow(-HOME_INVITATION_EXPIRY_SECONDS))
        return errorResponse("This invitation has expired");
      return transitionHomeInvitation(
        ctx.drizzle,
        request.id,
        "ACCEPTED",
        "PENDING",
        "Invitation accepted",
      );
    }),

  /** The invitee rejects a pending HOME request. */
  rejectHomeInvitation: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "HOME", {
        allowMissing: true,
      });
      if (!request)
        return errorResponse(
          "This invitation is no longer available. Refresh and try again",
        );
      if (request.receiverId !== ctx.userId)
        return errorResponse("Not your invitation to reject");
      if (request.status !== "PENDING")
        return errorResponse("This invitation is no longer pending");
      return transitionHomeInvitation(
        ctx.drizzle,
        request.id,
        "REJECTED",
        "PENDING",
        "Invitation declined",
      );
    }),

  /** The host can cancel pending requests and revoke accepted access with the same guarded transition. */
  cancelHomeInvitation: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "HOME", {
        allowMissing: true,
      });
      if (!request)
        return errorResponse(
          "This invitation is no longer available. Refresh and try again",
        );
      if (request.senderId !== ctx.userId)
        return errorResponse("Only the host can revoke this invitation");
      if (!["PENDING", "ACCEPTED"].includes(request.status))
        return errorResponse("This invitation is no longer active");
      return transitionHomeInvitation(
        ctx.drizzle,
        request.id,
        "CANCELLED",
        request.status,
        request.status === "ACCEPTED" ? "Invitation revoked" : "Invitation cancelled",
      );
    }),

  /** Set home visibility and bump the furniture revision in one guarded statement. */
  setHomeSharing: protectedProcedure
    .input(homeSharingInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const owner = await fetchHomeFurnitureUser(ctx.drizzle, ctx.userId);
      if (!owner || owner.isBanned) return errorResponse("Home unavailable");
      if (owner.homeFurnitureRevision !== input.revision)
        return errorResponse("Your home changed. Refresh and try again");
      await ensureUserHome(ctx.drizzle, ctx.userId, owner.home);
      const result = await executeResultForSetHomeSharing(ctx.drizzle, input, ctx);
      return result.rowsAffected
        ? { success: true, message: "Home access updated" }
        : errorResponse("Your home changed. Refresh and try again");
    }),

  /** Toggle sleep with a single status CAS; publish only after the write succeeds. */
  toggleSleep: protectedProcedure
    .meta({
      mcp: { description: "Toggle between awake and asleep status" },
    })
    .output(homeSleepResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const { user, isPyramidIsolated } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
        rejectIsolatedPyramid: true,
      });
      // Guard
      if (isPyramidIsolated) return errorResponse(ISOLATED_PYRAMID_MESSAGE);
      if (!user) return errorResponse("User not found");
      // Derived
      const newStatus: UserStatus = user.status === "ASLEEP" ? "AWAKE" : "ASLEEP";
      // Guards
      if (user.isOutlaw) {
        const sectorVillage = await fetchSectorVillage(ctx.drizzle, user.sector);
        if (
          newStatus === "ASLEEP" &&
          sectorVillage &&
          !["OUTLAW", "HIDEOUT", "STRONGHOLD"].includes(sectorVillage.type)
        ) {
          return errorResponse("You can't sleep in a village as an outlaw");
        }
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (!["ASLEEP", "AWAKE"].includes(user.status)) {
        return errorResponse("Invalid status, must be awake or asleep");
      }
      if (user.sector !== user.village?.sector && !user.isOutlaw) {
        return errorResponse("Wrong sector");
      }
      if (newStatus === "ASLEEP" && user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR) {
        return errorResponse("You cannot sleep in the war-torn battleground");
      }
      // Mutate
      // Combat can change status after the profile read; neither direction may replace it.
      const result = await updateUserDataForToggleSleep(
        ctx.drizzle,
        newStatus,
        ctx,
        user,
      );
      if (result.rowsAffected === 0) {
        return errorResponse("Your status changed. Refresh and try again.");
      }
      // Push status update to sector
      const pusher = getServerPusher();
      void updateUserOnMap(pusher, user.sector, {
        ...user,
        sector: newStatus === "AWAKE" ? user.sector : -1,
        status: newStatus,
        location: "",
        stealthActive: false,
      });
      // Done
      return {
        success: true,
        message: newStatus === "AWAKE" ? "You have woken up" : "You have gone to sleep",
        newStatus,
      };
    }),

  getUserHome: protectedProcedure
    .meta({ mcp: { description: "Get current user home info" } })
    .query(async ({ ctx }) => {
      // Revision and item positions come from one statement, keeping refetched layouts coherent.
      const user = await fetchHomeFurnitureUser(ctx.drizzle, ctx.userId);
      if (!user) return null;
      const furnitureItems = user.items.filter(isAvailableOwnedFurniture);
      return {
        homeType: user.homeType,
        biome: getHomeBiome(user),
        styles: user.home?.roomStyles ?? [],
        isPublic: user.home?.isPublic ?? false,
        regen: HomeTypeDetails[user.homeType].regen,
        storage: HomeTypeDetails[user.homeType].storage,
        furniture: furnitureItems.map(homeFurnitureDetails),
        furnitureRevision: user.homeFurnitureRevision,
        layout: getHomeLayout(furnitureItems),
      };
    }),

  saveFurnitureLayout: protectedProcedure
    .meta({ mcp: { description: "Save furniture placement in your current home" } })
    .input(homeFurnitureSaveInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchHomeFurnitureUser(ctx.drizzle, ctx.userId);
      const block = homeFurnitureAccessError(user);
      if (block || !user) return errorResponse(block ?? "User not found");
      if (
        user.homeType !== input.homeType ||
        user.homeFurnitureRevision !== input.revision
      ) {
        return errorResponse("Your home changed. Refresh and try again");
      }
      const furniture = user.items.filter(isAvailableOwnedFurniture);
      const stylesError = homeRoomStylesError(
        input.styles ??
          (user.home?.roomStyles ?? []).filter(({ room }) =>
            getHomeRooms(user.homeType).some(({ id }) => id === room),
          ),
        user.homeType,
      );
      if (stylesError) return errorResponse(stylesError);
      const ownershipError = homeLayoutOwnershipError(input.placements, furniture);
      if (ownershipError) return errorResponse(ownershipError);
      const placedIds = new Set(input.placements.map(({ id }) => id));
      const projectedStorage = user.items.filter(
        (owned) =>
          owned.item.itemType === "FURNITURE" &&
          !owned.item.hidden &&
          (owned.storedAtHome ||
            (isAvailableOwnedFurniture(owned) &&
              (owned.homeX !== null || placedIds.has(owned.id)))),
      ).length;
      if (projectedStorage > HOME_FURNITURE_STORAGE_CAPACITY)
        return errorResponse(
          "Your furniture storage is full. Retrieve some furniture before saving",
        );
      const pieces = furniture.map(homeFurnitureDetails);
      const orientationError = homeLayoutOrientationError(input.placements, pieces);
      if (orientationError) return errorResponse(orientationError);
      const placementError = homeLayoutPlacementError(
        input.placements,
        pieces,
        user.homeType,
      );
      if (placementError) return errorResponse(placementError);
      const result = await publishHomeFurnitureLayout(
        ctx.drizzle,
        ctx.userId,
        user,
        input.placements,
        input.revision,
        input.styles,
      );
      // MySQL counts changed inventory rows as well as the account revision.
      if (result.rowsAffected === 0) {
        return errorResponse("Your home changed. Refresh and try again");
      }
      return {
        success: true,
        message: "Your furniture layout has been saved",
      };
    }),

  getAvailableUpgrades: protectedProcedure
    .meta({ mcp: { description: "Get available home upgrades" } })
    .query(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      // Guard
      if (!user) return [];
      // Return all other home types with what a move to each costs or refunds
      const upgrades = HomeTypes.map((homeType) => ({
        type: homeType,
        ...HomeTypeDetails[homeType],
        ...getHomeChangeQuote(user.homeType, homeType),
      })).filter((upgrade) => upgrade.type !== user.homeType);
      return upgrades;
    }),

  upgradeHome: protectedProcedure
    .meta({ mcp: { description: "Upgrade or downgrade home" } })
    .input(homeUpgradeInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      // Read the account snapshot before inventory so its CAS detects concurrent storage changes.
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) return errorResponse("User not found");
      const [useritems, home] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        findUserHomeForUpgradeHome(ctx.drizzle, ctx),
      ]);
      const storedItems = useritems.filter((ui) => ui.storedAtHome);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.homeType === input.homeType)
        return errorResponse("You already own this home type");
      // Derived
      const targetHome = HomeTypeDetails[input.homeType];
      const { isUpgrade, upgradeCost, downgradeRefund } = getHomeChangeQuote(
        user.homeType,
        input.homeType,
      );
      // Upgrading or downgrading
      if (isUpgrade) {
        if (user.money < upgradeCost) return errorResponse("Not enough Ryo");
        const result = await updateUserDataForUpgradeHome(
          ctx.drizzle,
          upgradeCost,
          input,
          user,
          ctx,
        );
        if (result.rowsAffected === 0) {
          return errorResponse(
            "Not enough Ryo or home inventory changed. Refresh and try again",
          );
        }
        return { success: true, message: `Upgraded to ${targetHome.name}` };
      } else {
        const retainedRooms = new Set(getHomeRooms(input.homeType).map(({ id }) => id));
        const projectedFurnitureStorage = useritems.filter(
          (owned) =>
            owned.item.itemType === "FURNITURE" &&
            (owned.storedAtHome ||
              (!owned.isInAuction &&
                !retainedRooms.has(owned.homeRoom) &&
                owned.homeX !== null)),
        ).length;
        if (projectedFurnitureStorage > HOME_FURNITURE_STORAGE_CAPACITY)
          return errorResponse(
            "Your furniture storage is full. Retrieve some furniture before downgrading",
          );
        for (const [bucket, label] of [
          ["normal", "items"],
          ["materials", "materials"],
          ["cooking", "cooking items"],
        ] as const) {
          const stored = storedItems.filter(
            (ui) => getHomeStorageBucket(ui.item) === bucket,
          ).length;
          const max = getHomeStorageBucketCapacity(bucket, targetHome.storage);
          if (stored > max) {
            return errorResponse(
              `You need to remove some ${label} from storage first (max ${max})`,
            );
          }
        }
        // As with layout saves, Drizzle needs a joined statement to publish both tables atomically.
        // Join settings after inventory so MySQL applies the guarded revision to every placement.
        // LEFT JOIN also refunds homes with no removed placements; the owner is updated once.
        // Escrow keeps its storage state so active furniture trades remain fulfillable.
        await ensureUserHome(ctx.drizzle, ctx.userId, home);
        const result = await retryOnDeadlock(() =>
          executeResultForUpgradeHome(
            ctx.drizzle,
            retainedRooms,
            home,
            input,
            downgradeRefund,
            user,
            ctx,
          ),
        );
        if (result.rowsAffected === 0) {
          return errorResponse("Home inventory changed. Refresh and try again");
        }
        return { success: true, message: `Downgraded to ${targetHome.name}` };
      }
    }),

  toggleStoreItem: protectedProcedure
    .meta({ mcp: { description: "Store or retrieve item from home" } })
    .input(homeStorageInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      // Read userData before inventory so the updatedAt CAS below
      // detects any capacity mutation that commits between these snapshots.
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const useritems = await fetchUserItems(ctx.drizzle, ctx.userId);
      const storedItems = useritems.filter((ui) => ui.storedAtHome);
      const nonStoredItems = useritems.filter(countsTowardInventoryStorage);
      const userItemResult = useritems.find((ui) => ui.id === input.userItemId);
      // Guard
      if (!user) return errorResponse("User not found");
      const blocked = homeStorageBlockReason(user);
      if (blocked) return errorResponse(blocked);
      if (!userItemResult) return errorResponse("Item not found or is equipped");
      if (userItemResult.equipped !== "NONE") {
        return errorResponse("You can't store/retrieve already equipped items");
      }
      // Escrowed rows must stay carried so the auction/offer can still deliver them.
      // Retrieval stays open so a previously stored escrowed row can be recovered.
      if (!userItemResult.storedAtHome && userItemResult.isInAuction) {
        return errorResponse(
          "This item is reserved in an auction or trade offer and can't be stored",
        );
      }
      // Mutate
      if (userItemResult.storedAtHome) {
        const inventoryBucket = getInventoryBucket(userItemResult.item);
        const bucketCount = nonStoredItems.filter(
          (ui) => getInventoryBucket(ui.item) === inventoryBucket,
        ).length;
        if (bucketCount >= getInventoryBucketCapacity(inventoryBucket, user)) {
          return errorResponse(getInventoryBucketFullMessage(inventoryBucket));
        }
      } else {
        // Check storage limits based on home-storage bucket
        const homeBucket = getHomeStorageBucket(userItemResult.item);
        const homeStorage = HomeTypeDetails[user.homeType].storage;
        const storedInBucket = storedItems.filter(
          (ui) => getHomeStorageBucket(ui.item) === homeBucket,
        ).length;
        if (storedInBucket >= getHomeStorageBucketCapacity(homeBucket, homeStorage)) {
          return errorResponse(getHomeStorageBucketFullMessage(homeBucket));
        }
      }
      // Publish the item move and capacity snapshot together. Literal assignments avoid
      // depending on MySQL's unspecified joined-UPDATE assignment order.
      const result = await retryOnDeadlock(() =>
        executeResultForToggleStoreItem(ctx.drizzle, user, userItemResult, ctx, input),
      );
      if (result.rowsAffected === 0) {
        return errorResponse("Inventory changed, please refresh and try again");
      }
      // The home page reads the inventory again after a move, so the merge needs no projection.
      await mergeMovedStacks(
        ctx.drizzle,
        ctx.userId,
        useritems,
        [userItemResult],
        !userItemResult.storedAtHome,
      );
      return {
        success: true,
        message: userItemResult.storedAtHome
          ? "Item retrieved from your home."
          : "Item stored in your home.",
      };
    }),
  moveUserItems: protectedProcedure
    .meta({ mcp: { description: "Store or take out several items at home at once" } })
    .input(
      z.object({
        userItemIds: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_SELL_ITEMS)
          .refine((ids) => new Set(ids).size === ids.length, "Each item can move once"),
        toHome: z.boolean(),
      }),
    )
    .output(
      baseServerResponse.extend({
        // Omitted when a stack changed during the move, so clients read the inventory again.
        movedUserItemIds: z.array(z.string()).optional(),
        // Stacks the moved items joined at their destination, applied after the move.
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
        refused: z.array(
          z.object({ userItemId: z.string(), name: z.string(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      // Read userData before inventory so the updatedAt CAS below
      // detects any capacity mutation that commits between these snapshots.
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const useritems = await fetchUserItems(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) return { ...errorResponse("User not found"), refused: [] };
      if (user.isBanned) return { ...errorResponse("You are banned"), refused: [] };
      const blocked = homeStorageBlockReason(user);
      if (blocked) return { ...errorResponse(blocked), refused: [] };
      const { moving, refused } = planHomeStorageMove({
        rows: useritems.flatMap((ui) => (ui.item ? [{ ...ui, item: ui.item }] : [])),
        userItemIds: input.userItemIds,
        toHome: input.toHome,
        user,
        homeStorage: HomeTypeDetails[user.homeType].storage,
      });
      if (moving.length === 0) {
        return {
          ...errorResponse(homeStorageMoveMessage(0, input.toHome, refused)),
          refused,
        };
      }
      // Mutate
      const movingIds = moving.map((ui) => ui.id);
      const result = await retryOnDeadlock(() =>
        executeResultForMoveUserItems(ctx.drizzle, user, movingIds, input.toHome),
      );
      if (result.rowsAffected === 0) {
        return {
          ...errorResponse("Inventory changed, please refresh and try again"),
          refused,
        };
      }
      // The profile row and every planned stack changed only when nothing moved meanwhile.
      if (result.rowsAffected !== movingIds.length + 1) {
        return {
          success: true,
          message: "Some items changed while moving. Your inventory will be refreshed.",
          refused,
        };
      }
      const inventoryChanges = await mergeMovedStacks(
        ctx.drizzle,
        ctx.userId,
        useritems,
        moving,
        input.toHome,
      );
      const message = homeStorageMoveMessage(movingIds.length, input.toHome, refused);
      // A merge that lost a race leaves stacks the client cannot project; it reads them again.
      if (!inventoryChanges) return { success: true, message, refused };
      return {
        success: true,
        message,
        movedUserItemIds: movingIds,
        inventoryChanges,
        refused,
      };
    }),
});

/**
 * Merge the moved items with the stacks already at their destination by the Merge button's
 * rules, so a deposit or withdrawal joins the stack there. The inventory read before the move
 * decides which items have another stack to join; a merge that loses a race or fails leaves
 * the stacks apart for the Merge button, since the move itself has already committed.
 * @returns The confirmed quantity changes, or undefined when a merge did not complete
 */
const mergeMovedStacks = async (
  client: DrizzleClient,
  userId: string,
  useritems: { id: string; itemId: string; storedAtHome: boolean; quantity: number }[],
  moved: {
    id: string;
    itemId: string;
    item: { canStack: boolean; stackSize: number };
  }[],
  storedAtHome: boolean,
) => {
  const movedIds = new Set(moved.map((row) => row.id));
  const itemIds = new Set(
    moved
      .filter(
        (row) =>
          getEffectiveStackSize(row.item) > 1 &&
          useritems.filter(
            (other) =>
              other.itemId === row.itemId &&
              other.quantity > 0 &&
              (movedIds.has(other.id) || other.storedAtHome === storedAtHome),
          ).length > 1,
      )
      .map((row) => row.itemId),
  );
  if (itemIds.size === 0) return [];
  try {
    const rows = await listUserItemForMergeAllStacks(client, { userId }, storedAtHome);
    const results = await Promise.all(
      [
        ...groupBy(
          rows.filter((row) => row.item && itemIds.has(row.itemId)),
          "itemId",
        ),
      ].map(([itemId, itemRows]) =>
        executeMergeStacksForItem(
          client,
          userId,
          itemId,
          { userItems: itemRows, item: itemRows[0]?.item },
          inArray(userData.status, [...HOME_STORAGE_STATUSES]),
        ),
      ),
    );
    return results.every((result) => result.success && result.inventoryChanges)
      ? results.flatMap((result) => result.inventoryChanges ?? [])
      : undefined;
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "home.mergeMovedStacks" } });
    return undefined;
  }
};

type HomeFurnitureUser = NonNullable<
  Awaited<ReturnType<typeof fetchHomeFurnitureUser>>
>;

/** Guarded home invitation transition answered with home-specific wording. */
const transitionHomeInvitation = async (
  client: DrizzleClient,
  requestId: string,
  status: UserRequestState,
  expectedStatus: UserRequestState,
  message: string,
) => {
  const result = await updateRequestState(
    client,
    requestId,
    status,
    "HOME",
    undefined,
    expectedStatus,
  );
  return result.success ? { success: true, message } : result;
};

/** Home scenery follows the owner's village even while the owner or visitor travels. */
const getHomeBiome = (user: HomeFurnitureUser) =>
  user.village
    ? getBiomeFromTileType(getSectorTileType(user.village.sector))
    : "ground";

/** Only visible, completed furniture outside auction escrow is available for placement. */
const isAvailableOwnedFurniture = (owned: HomeFurnitureUser["items"][number]) =>
  owned.item.itemType === "FURNITURE" &&
  !owned.item.hidden &&
  !owned.isInAuction &&
  (!owned.craftingFinishedAt || owned.craftingFinishedAt <= new Date());

/**
 * Publish placements, finishes and their revision together.
 * Saves store newly placed or removed pieces, preserving unplaced carried inventory.
 * Omitted styles retain the saved finishes.
 */
const publishHomeFurnitureLayout = async (
  client: DrizzleClient,
  userId: string,
  user: HomeFurnitureUser,
  placements: HomePlacement[],
  revision: number,
  styles?: HomeRoomStyle[],
) => {
  const placementCase = (field: "room" | "x" | "y" | "rotation") => {
    const fallback = field === "room" ? "main" : field === "rotation" ? 0 : null;
    return placements.length
      ? sql`CASE ${userItem.id} ${sql.join(
          placements.map(
            (placement) =>
              sql`WHEN ${placement.id} THEN ${placement[field] ?? fallback}`,
          ),
          sql` `,
        )} ELSE ${fallback} END`
      : sql`${fallback}`;
  };
  // Drizzle's update builder targets one table. A joined update avoids partial rooms and
  // one save overwriting a concurrent edit, without a transaction.
  // A concurrent sale can only remove a placement; this statement never recreates inventory.
  // Join settings after inventory so MySQL applies the guarded revision to every placement.
  await ensureUserHome(client, userId, user.home);
  return retryOnDeadlock(() =>
    executeRowsForPublishHomeFurnitureLayout(
      client,

      user,
      styles,
      placements,
      placementCase,

      userId,
      revision,
    ),
  );
};

/** The joined inventory snapshot supplies the same active-view geometry to reads and save guards. */
const homeFurnitureDetails = (
  owned: Pick<
    HomeFurnitureUser["items"][number],
    "id" | "itemId" | "quantity" | "activeVariantId" | "item"
  >,
): HomeFurniture => {
  const content = applyActiveVariant(owned);
  const data = content.furnitureData ?? DEFAULT_FURNITURE_DATA;
  return {
    id: owned.id,
    itemId: owned.itemId,
    name: content.name,
    image: content.image,
    width: data.width,
    groundAnchor: data.groundAnchor,
    geometry: data.geometry,
    action: data.action,
    isFloor: data.isFloor,
    quantity: owned.quantity,
    views: data.views ?? {},
  };
};

/** Guests can use residence navigation but only the resident can rearrange its furnishings. */
const homeFurnitureAccessError = (
  user: Awaited<ReturnType<typeof fetchHomeFurnitureUser>>,
) => {
  if (!user) return "User not found";
  if (user.isBanned) return "You are banned";
  if (!user.village || user.sector !== user.village.sector)
    return "Return to your own village to furnish your home";
  if (!["AWAKE", "ASLEEP"].includes(user.status))
    return "You cannot furnish your home right now";
  return null;
};

/**
 * Price of moving between home types: an upgrade pays the price difference, a downgrade
 * refunds HOME_DOWNGRADE_REFUND_PERCENT of it.
 */
const getHomeChangeQuote = (current: HomeType, target: HomeType) => {
  const isUpgrade = HomeTypes.indexOf(target) > HomeTypes.indexOf(current);
  const priceDifference = HomeTypeDetails[target].cost - HomeTypeDetails[current].cost;
  return {
    isUpgrade,
    upgradeCost: isUpgrade ? Math.max(0, priceDifference) : 0,
    downgradeRefund: isUpgrade
      ? 0
      : Math.floor(-priceDifference * (HOME_DOWNGRADE_REFUND_PERCENT / 100)),
  };
};

/** Create home-only settings on the first write; a concurrent insertion retains the existing row. */
const ensureUserHome = async (
  client: DrizzleClient,
  userId: string,
  home: { userId: string } | null | undefined,
) => {
  if (!home) await insertUserHomeForEnsureUserHome(client, userId);
};
