import { sql } from "drizzle-orm";
import type { UserStatus } from "@/drizzle/constants";
import {
  HOME_FURNITURE_STORAGE_CAPACITY,
  HOME_INVITATION_EXPIRY_SECONDS,
  HOME_MAX_INVITATIONS,
  HomeTypeDetails,
  HomeTypes,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import { userItem } from "@/drizzle/schema";
import { applyActiveVariant } from "@/libs/combat/util";
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
  countsTowardInventoryStorage,
  getHomeStorageBucket,
  getHomeStorageBucketCapacity,
  getHomeStorageBucketFullMessage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
} from "@/libs/item";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { ISOLATED_PYRAMID_MESSAGE } from "@/libs/questRun";
import { calcIsInVillage, getBiomeFromTileType } from "@/libs/travel";
import {
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
import { fetchRequests, insertRequest } from "@/queries/sparring";
import { fetchSectorVillage } from "@/queries/village";
import { fetchUserItems } from "@/routers/item";
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
import { secondsFromNow } from "@/utils/time";
import {
  type HomePlacement,
  type HomeRoomStyle,
  homeFurnitureSaveInputSchema,
  homeInvitationInputSchema,
  homeSharingInputSchema,
  homeSleepResponseSchema,
  homeStorageInputSchema,
  homeUpgradeInputSchema,
  homeVisitInputSchema,
} from "@/validators/home";
import { DEFAULT_FURNITURE_DATA } from "@/validators/itemFurniture";
import { idSchema } from "@/validators/misc";

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

  /** Send the existing request type instead of granting access through an account JSON list. */
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
      return updateRequestState(
        ctx.drizzle,
        request.id,
        "ACCEPTED",
        "HOME",
        undefined,
        "PENDING",
      );
    }),

  /** Rejection changes the same shared request rather than maintaining a second access list. */
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
      return updateRequestState(
        ctx.drizzle,
        request.id,
        "REJECTED",
        "HOME",
        undefined,
        "PENDING",
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
      return updateRequestState(
        ctx.drizzle,
        request.id,
        "CANCELLED",
        "HOME",
        undefined,
        request.status,
      );
    }),

  /** Visibility and the account revision publish together without placing home settings on the account. */
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
      const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
      const newStatus: UserStatus = user.status === "ASLEEP" ? "AWAKE" : "ASLEEP";
      // Guards
      if (user.isOutlaw && inVillage) {
        const sectorVillage = await fetchSectorVillage(ctx.drizzle, user?.sector ?? -1);
        if (
          newStatus === "ASLEEP" &&
          sectorVillage &&
          !["OUTLAW", "HIDEOUT", "STRONGHOLD"].includes(sectorVillage.type)
        ) {
          return errorResponse("You can't sleep in a village as an outlaw");
        }
      } else if (!user.isOutlaw && !inVillage) {
        return errorResponse("You can't sleep outside a village as a non-outlaw");
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
      const output = {
        longitude: user.longitude,
        latitude: user.latitude,
        sector: newStatus === "AWAKE" ? user.sector : -1,
        avatar: user.avatar,
        avatarLight: user.avatarLight,
        level: user.level,
        experience: user.experience,
        rank: user.rank,
        villageId: user.villageId,
        battleId: user.battleId,
        username: user.username,
        status: newStatus,
        location: "",
        userId: ctx.userId,
        curHealth: user.curHealth,
        maxHealth: user.maxHealth,
      };
      const pusher = getServerPusher();
      void updateUserOnMap(pusher, user.sector, output);
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
      // Derived
      const currentHomeIndex = HomeTypes.indexOf(user.homeType);
      const currentHomeCost = HomeTypeDetails[user.homeType].cost;
      // Return all other home types; upgradeCost is what the user pays (target cost minus current home value)
      const upgrades = HomeTypes.map((homeType, i) => {
        const details = HomeTypeDetails[homeType];
        const isUpgrade = i > currentHomeIndex;
        const upgradeCost = isUpgrade ? Math.max(0, details.cost - currentHomeCost) : 0;
        const downgradeRefund = !isUpgrade
          ? Math.floor((currentHomeCost - details.cost) * 0.75)
          : 0;
        return {
          type: homeType,
          ...details,
          isUpgrade,
          upgradeCost,
          downgradeRefund,
        };
      }).filter((upgrade) => upgrade.type !== user.homeType);
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
      const currentHomeCost = HomeTypeDetails[user.homeType].cost;
      const upgradeCost = Math.max(0, targetHome.cost - currentHomeCost);
      // Upgrading or downgrading
      if (HomeTypes.indexOf(input.homeType) > HomeTypes.indexOf(user.homeType)) {
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
        const storedNormalItems =
          storedItems.filter((ui) => getHomeStorageBucket(ui.item) === "normal")
            .length || 0;
        const storedMaterialItems =
          storedItems.filter((ui) => getHomeStorageBucket(ui.item) === "materials")
            .length || 0;
        const storedCookingItems =
          storedItems.filter((ui) => getHomeStorageBucket(ui.item) === "cooking")
            .length || 0;
        const maxMaterials = getHomeStorageBucketCapacity(
          "materials",
          user,
          targetHome.storage,
        );
        const maxCooking = getHomeStorageBucketCapacity(
          "cooking",
          user,
          targetHome.storage,
        );
        if (storedNormalItems > targetHome.storage) {
          return errorResponse(
            `You need to remove some items from storage first (max ${targetHome.storage})`,
          );
        }
        if (storedMaterialItems > maxMaterials) {
          return errorResponse(
            `You need to remove some materials from storage first (max ${maxMaterials})`,
          );
        }
        if (storedCookingItems > maxCooking) {
          return errorResponse(
            `You need to remove some cooking items from storage first (max ${maxCooking})`,
          );
        }
        const downgradeRefund = Math.floor((currentHomeCost - targetHome.cost) * 0.75);
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
      if (!userItemResult) return errorResponse("Item not found or is equipped");
      if (!userItemResult.item) return errorResponse("Item data not found");
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
        const bucketCount =
          nonStoredItems.filter((ui) => getInventoryBucket(ui.item) === inventoryBucket)
            .length || 0;
        if (bucketCount >= getInventoryBucketCapacity(inventoryBucket, user)) {
          return errorResponse(getInventoryBucketFullMessage(inventoryBucket));
        }
      } else {
        // Check storage limits based on home-storage bucket
        const homeBucket = getHomeStorageBucket(userItemResult.item);
        const homeStorage = HomeTypeDetails[user.homeType].storage;
        const storedInBucket =
          storedItems.filter((ui) => getHomeStorageBucket(ui.item) === homeBucket)
            .length || 0;
        if (
          storedInBucket >= getHomeStorageBucketCapacity(homeBucket, user, homeStorage)
        ) {
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
      return {
        success: true,
        message: userItemResult.storedAtHome
          ? "Item retrieved from your home."
          : "Item stored in your home.",
      };
    }),
});

type HomeFurnitureUser = NonNullable<
  Awaited<ReturnType<typeof fetchHomeFurnitureUser>>
>;

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

/** Create home-only settings on the first write; a concurrent insertion retains the existing row. */
const ensureUserHome = async (
  client: DrizzleClient,
  userId: string,
  home: { userId: string } | null | undefined,
) => {
  if (!home) await insertUserHomeForEnsureUserHome(client, userId);
};
