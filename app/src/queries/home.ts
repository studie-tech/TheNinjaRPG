/**
 * Database access for home; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { eq, gt, isNull, lte, or } from "drizzle-orm";
import type { HomeType } from "@/drizzle/constants";
import { userData, userItem } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Cosmetic home writes need account state and its home sector without advancing gameplay timers. */
export const fetchHomeFurnitureUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      homeType: true,
      homeFurnitureRevision: true,
      updatedAt: true,
      username: true,
      isAi: true,
      deletionAt: true,
      isBanned: true,
      status: true,
      sector: true,
      villageId: true,
      isOutlaw: true,
    },
    with: {
      home: true,
      village: { columns: { sector: true } },
      items: {
        where: gt(userItem.quantity, 0),
        with: { item: { with: { variants: true } } },
      },
    },
  });
  // Deleted item definitions can leave inventory rows behind, as in fetchUserItems.
  return user && { ...user, items: user.items.filter((owned) => owned.item) };
};

import { and, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { item, userHome, userRequest } from "@/drizzle/schema";

import { getNextUserSnapshotAt } from "@/server/utils/concurrency";

/**
 * Build the `userRequest` lookup for `getVisitedHome`, selecting only `id`, including
 * predicates on `senderId`, `receiverId`, `type`.
 */
export const findUserRequestForGetVisitedHome = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
  ctx: { userId: string },
) =>
  client.query.userRequest.findFirst({
    where: and(
      eq(userRequest.senderId, input.userId),
      eq(userRequest.receiverId, ctx.userId),
      eq(userRequest.type, "HOME"),
      eq(userRequest.status, "ACCEPTED"),
    ),
    columns: { id: true },
  });

/** Build the `userData` lookup for `inviteHomeVisitor`, using predicates on `userId`. */
export const findUserDataForInviteHomeVisitor = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: { isBanned: true, isAi: true, deletionAt: true },
  });

/** Build the `userData` lookup for `inviteHomeVisitor`, using predicates on `username`. */
export const findUserDataForInviteHomeVisitor2 = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.username, input.username),
    columns: { userId: true, isAi: true, isBanned: true, deletionAt: true },
  });

/** Execute the database statement for `setHomeSharing`. */
export const executeResultForSetHomeSharing = (
  client: Pick<DrizzleClient, "execute">,
  input: { isPublic: false | true; revision: number },
  ctx: { userId: string },
) =>
  client.execute(sql`
        UPDATE ${userData} INNER JOIN ${userHome} ON ${userHome.userId} = ${userData.userId}
        SET ${userHome.isPublic} = ${input.isPublic}, ${userData.homeFurnitureRevision} = ${userData.homeFurnitureRevision} + 1
        WHERE ${and(eq(userData.userId, ctx.userId), eq(userData.isBanned, false), eq(userData.homeFurnitureRevision, input.revision))}
      `);

/** Build the `userData` update for `toggleSleep`, setting `status`, using predicates on `userId`, `status`, `curHealth`. */
export const updateUserDataForToggleSleep = (
  client: Pick<DrizzleClient, "update">,
  newStatus: "AWAKE" | "ASLEEP",
  ctx: { userId: string },
  user: { status: import("@/drizzle/schema").UserStatus },
) =>
  client
    .update(userData)
    .set({ status: newStatus })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.status, user.status),
        gte(userData.curHealth, 0),
      ),
    );

/** Build the `userHome` lookup for `upgradeHome`, using predicates on `userId`. */
export const findUserHomeForUpgradeHome = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userHome.findFirst({
    where: eq(userHome.userId, ctx.userId),
  });

/** Build the `userData` update for `upgradeHome`, including predicates on `userId`, `homeType`, `homeFurnitureRevision`. */
export const updateUserDataForUpgradeHome = (
  client: Pick<DrizzleClient, "update">,
  upgradeCost: number,
  input: {
    homeType: HomeType;
  },
  user: {
    updatedAt: Date;
    homeType: HomeType;
    homeFurnitureRevision: number;
  },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      homeFurnitureRevision: sql`${userData.homeFurnitureRevision} + 1`,
      money: sql`${userData.money} - ${upgradeCost}`,
      homeType: input.homeType,
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.homeType, user.homeType),
        eq(userData.homeFurnitureRevision, user.homeFurnitureRevision),
        eq(userData.updatedAt, user.updatedAt),
        gte(userData.money, upgradeCost),
      ),
    );

/** Execute the database statement for `upgradeHome`. */
export const executeResultForUpgradeHome = (
  client: Pick<DrizzleClient, "execute">,
  retainedRooms: Set<
    | "main"
    | "room-1"
    | "room-2"
    | "room-3"
    | "room-4"
    | "room-5"
    | "room-6"
    | "room-7"
    | "room-8"
    | "room-9"
    | "yard"
  >,
  home:
    | { roomStyles: undefined | import("@/validators/home").HomeRoomStyle[] }
    | undefined,
  input: {
    homeType: HomeType;
  },
  downgradeRefund: number,
  user: {
    updatedAt: Date;
    homeType: HomeType;
    homeFurnitureRevision: number;
  },
  ctx: { userId: string },
) =>
  client.execute(sql`
            UPDATE ${userData}
            LEFT JOIN ${userItem} ON ${userItem.userId} = ${userData.userId}
              AND ${isNotNull(userItem.homeX)}
              AND ${notInArray(userItem.homeRoom, [...retainedRooms])}
            INNER JOIN ${userHome} ON ${userHome.userId} = ${userData.userId}
            SET ${userData.homeFurnitureRevision} = ${userData.homeFurnitureRevision} + 1,
                ${userHome.roomStyles} = ${JSON.stringify((home?.roomStyles ?? []).filter(({ room }) => retainedRooms.has(room)))},
                ${userData.homeType} = ${input.homeType},
                ${userData.money} = ${userData.money} + ${downgradeRefund},
                ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt)},
                ${userItem.homeX} = NULL,
                ${userItem.homeY} = NULL,
                ${userItem.homeRoom} = ${"main"},
                ${userItem.homeRotation} = 0,
                ${userItem.storedAtHome} = CASE WHEN ${userItem.isInAuction}
                  THEN ${userItem.storedAtHome} ELSE ${true} END
            WHERE ${and(
              eq(userData.userId, ctx.userId),
              eq(userData.homeType, user.homeType),
              eq(userData.homeFurnitureRevision, user.homeFurnitureRevision),
              eq(userData.updatedAt, user.updatedAt),
            )}
          `);

/** Execute the database statement for `toggleStoreItem`. */
export const executeResultForToggleStoreItem = (
  client: Pick<DrizzleClient, "execute">,
  user: { updatedAt: Date },
  userItemResult: { storedAtHome: false | true },
  ctx: { userId: string },
  input: { userItemId: string },
) =>
  client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${userItem} ON ${userItem.userId} = ${userData.userId}
          SET ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt)},
              ${userItem.storedAtHome} = ${!userItemResult.storedAtHome}
          WHERE ${and(
            eq(userData.userId, ctx.userId),
            eq(userData.updatedAt, user.updatedAt),
            eq(userItem.id, input.userItemId),
            eq(userItem.storedAtHome, userItemResult.storedAtHome),
            gt(userItem.quantity, 0),
            // Never move auction/offer escrow into home storage.
            userItemResult.storedAtHome ? undefined : eq(userItem.isInAuction, false),
          )}
        `);

/** Execute the database statement for `publishHomeFurnitureLayout`. */
export const executeRowsForPublishHomeFurnitureLayout = (
  client: Pick<DrizzleClient, "execute">,

  user: NonNullable<Awaited<ReturnType<typeof fetchHomeFurnitureUser>>>,
  styles: undefined | import("@/validators/home").HomeRoomStyle[],
  placements: import("@/validators/home").HomePlacement[],
  placementCase: (field: "room" | "x" | "y" | "rotation") => SQL<unknown>,

  userId: string,
  revision: number,
) =>
  client.execute(sql`
    UPDATE ${userData}
    LEFT JOIN (${userItem} INNER JOIN ${item} ON ${item.id} = ${userItem.itemId})
      ON ${userItem.userId} = ${userData.userId}
      AND ${availableHomeFurnitureItems()}
      AND ${item.itemType} = ${"FURNITURE"} AND ${item.hidden} = ${false}
    INNER JOIN ${userHome} ON ${userHome.userId} = ${userData.userId}
    SET ${userData.homeFurnitureRevision} = ${userData.homeFurnitureRevision} + 1,
        ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt)},
        ${userHome.roomStyles} = ${JSON.stringify(styles ?? user.home?.roomStyles ?? [])},
        ${userItem.storedAtHome} = CASE WHEN (${userItem.homeX} IS NOT NULL ${
          placements.length
            ? sql`OR ${inArray(
                userItem.id,
                placements.map(({ id }) => id),
              )}`
            : sql``
        }) THEN ${true} ELSE ${userItem.storedAtHome} END,
        ${userItem.homeRoom} = ${placementCase("room")},
        ${userItem.homeX} = ${placementCase("x")},
        ${userItem.homeY} = ${placementCase("y")},
        ${userItem.homeRotation} = ${placementCase("rotation")}
    WHERE ${homeFurnitureWriteGuard(user, userId, revision)}
  `);

/** Build the `userHome` insert for `ensureUserHome`. */
export const insertUserHomeForEnsureUserHome = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
) => client.insert(userHome).ignore().values({ userId });

/** Only available inventory can be placed; auction escrow and unfinished crafts remain inaccessible. */
const availableHomeFurnitureItems = () =>
  and(
    gt(userItem.quantity, 0),
    eq(userItem.isInAuction, false),
    or(
      isNull(userItem.craftingFinishedAt),
      lte(userItem.craftingFinishedAt, new Date()),
    ),
  );

/** Recheck access and the furniture revision in the same statement that publishes the change. */
const homeFurnitureWriteGuard = (
  user: NonNullable<Awaited<ReturnType<typeof fetchHomeFurnitureUser>>>,
  userId: string,
  revision: number,
) =>
  and(
    eq(userData.userId, userId),
    eq(userData.homeFurnitureRevision, revision),
    eq(userData.updatedAt, user.updatedAt),
    eq(userData.homeType, user.homeType),
    eq(userData.isBanned, false),
    eq(userData.villageId, user.villageId ?? ""),
    eq(userData.sector, user.sector),
    eq(userData.isOutlaw, user.isOutlaw),
    inArray(userData.status, ["AWAKE", "ASLEEP"]),
  );
