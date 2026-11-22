import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import type { CraftingServiceRequest, UserData, UserItem } from "@/drizzle/schema";
import {
  conversation,
  conversationComment,
  craftingServicePrice,
  craftingServiceRequest,
  storeUserIdAlias,
  user2conversation,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import type { QueryCondition } from "@/utils/typeutils";

/** Public offers, including disabled offers when editing one's prices. */
export const findServicePrices = (db: DrizzleClient, userId: string) =>
  db.select().from(craftingServicePrice).where(eq(craftingServicePrice.userId, userId));
/** Publish an offer atomically for this service and rarity. */
export const saveServicePrice = (
  db: DrizzleClient,
  value: typeof craftingServicePrice.$inferInsert,
) =>
  db
    .insert(craftingServicePrice)
    .values(value)
    .onDuplicateKeyUpdate({
      set: {
        fee: value.fee,
        enabled: value.enabled,
        revision: sql`${craftingServicePrice.revision} + 1`,
      },
    });
/** Load every unsettled receipt involving a player; history has a separate bounded read. */
export const findOpenServiceRequests = (db: DrizzleClient, userId: string) =>
  db.query.craftingServiceRequest.findMany({
    where: and(
      or(
        eq(craftingServiceRequest.requesterId, userId),
        eq(craftingServiceRequest.crafterId, userId),
      ),
      inArray(craftingServiceRequest.status, ["PENDING", "ACTIVE"]),
    ),
  });
/** Read the durable outcome when another request wins immediate service settlement. */
export const findServiceRequest = (db: DrizzleClient, requestId: string) =>
  db.query.craftingServiceRequest.findFirst({
    where: eq(craftingServiceRequest.id, requestId),
  });
/** Paginate recent request history without omitting pending work. */
export const findServiceHistory = (db: DrizzleClient, userId: string) =>
  db.query.craftingServiceRequest.findMany({
    where: and(
      or(
        eq(craftingServiceRequest.requesterId, userId),
        eq(craftingServiceRequest.crafterId, userId),
      ),
      inArray(craftingServiceRequest.status, ["COMPLETED", "REFUNDED"]),
    ),
    orderBy: desc(craftingServiceRequest.createdAt),
    limit: 100,
    with: {
      crystal: { columns: { name: true } },
      crafter: { columns: { username: true } },
      requester: { columns: { username: true } },
    },
  });
/** Reserve a user snapshot and optional fee or active service slot. */
export const claimServiceUser = (
  db: DrizzleClient,
  user: Pick<UserData, "userId" | "updatedAt" | "status" | "occupation">,
  fee = 0,
  readiness?: ActionReadinessWrite,
) =>
  db
    .update(userData)
    .set({
      updatedAt: nextSnapshotSql(userData.updatedAt),
      money: sql`${userData.money} - ${fee}`,
      ...readiness?.set,
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.isBanned, false),
        readiness?.where ?? eq(userData.status, "AWAKE"),
        gte(userData.money, fee),
        liveServiceIdentity(db, user.userId),
      ),
    );
/** Insert the escrow receipt in the transaction that reserves its fee and inventory. */
export const insertServiceRequest = (
  db: DrizzleClient,
  row: typeof craftingServiceRequest.$inferInsert,
) => db.insert(craftingServiceRequest).values(row);
/** Claim a receipt transition exactly once before its money or inventory is delivered. */
export const transitionServiceRequest = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
  status: CraftingServiceRequest["status"],
) =>
  db
    .update(craftingServiceRequest)
    .set({ status })
    .where(
      and(
        eq(craftingServiceRequest.id, request.id),
        eq(craftingServiceRequest.status, request.status),
        eq(craftingServiceRequest.requesterId, request.requesterId),
        eq(craftingServiceRequest.crafterId, request.crafterId),
      ),
    );
/** Consume an exact material snapshot without touching listed, stored or busy copies. */
export const consumeServiceMaterial = (
  db: DrizzleClient,
  row: UserItem,
  quantity: number,
  updatedAt: Date,
) =>
  db
    .update(userItem)
    .set({ quantity: sql`${userItem.quantity} - ${quantity}`, updatedAt })
    .where(
      and(
        eq(userItem.id, row.id),
        eq(userItem.userId, row.userId),
        eq(userItem.quantity, row.quantity),
        gte(userItem.quantity, quantity),
        isNull(userItem.fortification),
        eq(userItem.updatedAt, row.updatedAt),
        eq(userItem.equipped, "NONE"),
        eq(userItem.isInAuction, false),
        eq(userItem.storedAtHome, false),
        or(
          isNull(userItem.craftingFinishedAt),
          lte(userItem.craftingFinishedAt, new Date()),
        ),
      ),
    );
/** Move the complete equipment copy into receipt-owned escrow, preserving its imbuements. */
export const escrowServiceEquipment = (
  db: DrizzleClient,
  row: UserItem,
  requestId: string,
  definitionGuard?: SQL,
) =>
  db
    .update(userItem)
    .set({ userId: requestId, updatedAt: new Date() })
    .where(
      and(
        eq(userItem.id, row.id),
        eq(userItem.userId, row.userId),
        eq(userItem.updatedAt, row.updatedAt),
        eq(userItem.durability, row.durability),
        definitionGuard,
        eq(userItem.quantity, 1),
        eq(userItem.equipped, "NONE"),
        eq(userItem.isInAuction, false),
        eq(userItem.storedAtHome, false),
        or(
          isNull(userItem.craftingFinishedAt),
          lte(userItem.craftingFinishedAt, new Date()),
        ),
      ),
    );
/** Return escrow to the requester; receipts cannot transfer another request's item. */
export const deliverServiceEquipment = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
  durability?: number,
  fortify?: { state: NonNullable<UserItem["fortification"]>; beforeUpdatedAt: Date },
  updatedAt = new Date(),
) =>
  db
    .update(userItem)
    .set({
      userId: request.requesterId,
      updatedAt,
      ...(durability === undefined ? {} : { durability }),
      ...(fortify ? { fortification: fortify.state } : {}),
    })
    .where(
      and(
        eq(userItem.id, request.targetUserItemId ?? ""),
        eq(userItem.userId, request.id),
        gt(userItem.quantity, 0),
        fortify ? eq(userItem.updatedAt, fortify.beforeUpdatedAt) : undefined,
      ),
    );
/** Read escrow only for a known receipt ID. */
export const findServiceEquipment = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
) =>
  db.query.userItem.findFirst({
    where: and(
      eq(userItem.id, request.targetUserItemId ?? ""),
      eq(userItem.userId, request.id),
    ),
    with: { item: true, imbuements: { with: { item: true } } },
  });
/** Attach a completed crystal to equipment that is still held in escrow. */
export const insertServiceImbuement = (
  db: DrizzleClient,
  targetUserItemId: string,
  crystalItemId: string,
  finishesAt: Date,
) =>
  db.insert(userItemImbuement).values({
    id: nanoid(),
    userItemId: targetUserItemId,
    imbuementItemId: crystalItemId,
    craftingFinishedAt: finishesAt,
  });
/** Remove only the submitted imbuement from this receipt's equipment. */
export const removeServiceImbuement = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
) =>
  db
    .delete(userItemImbuement)
    .where(
      and(
        eq(userItemImbuement.id, request.imbuementId ?? ""),
        eq(userItemImbuement.userItemId, request.targetUserItemId ?? ""),
      ),
    );
/** Add settlement gains without replacing concurrent balance or experience changes. */
export const rewardServiceUser = (db: DrizzleClient, userId: string, fee: number) =>
  db
    .update(userData)
    .set({
      money: sql`${userData.money} + ${fee}`,
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(eq(userData.userId, userId));
/** Claim the receipt, both live identities and the crafter's exact slot/progression snapshot atomically. */
export const acceptServiceRequest = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
  user: Pick<UserData, "userId" | "updatedAt">,
  experience: number,
  questState: {
    set: Record<string, unknown>;
    where?: QueryCondition[];
    claimedAt: Date;
  },
  finishesAt: Date,
  readiness?: ActionReadinessWrite,
) => {
  const requester = alias(userData, "serviceRequester");
  return db.execute(sql`
    UPDATE ${craftingServiceRequest}
    INNER JOIN ${userData} ON ${userData.userId} = ${craftingServiceRequest.crafterId}
    INNER JOIN ${userData} AS ${requester} ON ${requester.userId} = ${craftingServiceRequest.requesterId}
    SET ${actionReadinessSqlSet(
      { set: { ...readiness?.set, ...questState.set }, where: readiness?.where },
      ["craftingExperience", "serviceCraftUntil", "updatedAt"],
    )}
      ${craftingServiceRequest.status} = 'ACTIVE',
      ${craftingServiceRequest.startedAt} = ${sql.param(new Date(), craftingServiceRequest.startedAt)},
      ${craftingServiceRequest.finishesAt} = ${sql.param(finishesAt, craftingServiceRequest.finishesAt)},
      ${userData.craftingExperience} = ${userData.craftingExperience} + ${experience},
      ${userData.serviceCraftUntil} = ${sql.param(finishesAt, userData.serviceCraftUntil)},
      ${userData.updatedAt} = ${sql.param(questState.claimedAt, userData.updatedAt)},
      ${requester.updatedAt} = ${nextSnapshotSql(requester.updatedAt)}
    WHERE ${and(
      eq(craftingServiceRequest.id, request.id),
      eq(craftingServiceRequest.status, "PENDING"),
      ne(craftingServiceRequest.requesterId, craftingServiceRequest.crafterId),
      eq(craftingServiceRequest.requesterId, request.requesterId),
      eq(craftingServiceRequest.crafterId, request.crafterId),
      eq(userData.userId, user.userId),
      eq(userData.updatedAt, user.updatedAt),
      eq(userData.isBanned, false),
      ...(questState.where ?? []),
      liveServiceIdentity(db, user.userId),
      liveServiceIdentity(db, request.requesterId),
      readiness?.where ?? eq(userData.status, "AWAKE"),
    )}
  `);
};
/** Move both participant identities and public prices during staff account renames. */
export const renameCraftingServices = async (
  db: DrizzleClient,
  from: string,
  to: string,
) => {
  await db
    .update(craftingServicePrice)
    .set({ userId: to })
    .where(eq(craftingServicePrice.userId, from));
  await db
    .update(craftingServiceRequest)
    .set({ requesterId: to })
    .where(eq(craftingServiceRequest.requesterId, from));
  await db
    .update(craftingServiceRequest)
    .set({ crafterId: to })
    .where(eq(craftingServiceRequest.crafterId, from));
};
/** Remove a retiring account's offers and terminal receipts after escrow refunds. */
export const deleteCraftingServices = async (db: DrizzleClient, userId: string) => {
  await db.delete(craftingServicePrice).where(eq(craftingServicePrice.userId, userId));
  await db
    .delete(craftingServiceRequest)
    .where(
      or(
        eq(craftingServiceRequest.requesterId, userId),
        eq(craftingServiceRequest.crafterId, userId),
      ),
    );
};

/** Write a private, automatic inbox receipt with its unread counter in the escrow transaction. */
export const notifyServiceRequest = async (
  db: DrizzleClient,
  request: CraftingServiceRequest,
  event: "requested" | "completed" | "refunded",
) => {
  const id = nanoid();
  const countedAt = Date.now();
  const recipients =
    event === "requested"
      ? [request.crafterId]
      : [...new Set([request.requesterId, request.crafterId])];
  await db.insert(conversation).values({
    id,
    title: `Crafting service ${event}`,
    createdById: request.requesterId,
    isPublic: false,
    isLocked: true,
  });
  await db
    .insert(user2conversation)
    .values(recipients.map((userId) => ({ conversationId: id, userId })));
  await db.insert(conversationComment).values({
    id: nanoid(),
    conversationId: id,
    userId: event === "requested" ? request.requesterId : request.crafterId,
    authorId: event === "requested" ? request.requesterId : request.crafterId,
    content: `<p>Automatic crafting service notification: your ${request.service.toLowerCase()} service was ${event}. ${event === "completed" ? "Items have been delivered to inventory, including overflow when full." : event === "refunded" ? "The fee and escrow have been returned." : "Review the request to accept or decline."} <a href="/occupation?tab=services">Open Service Requests</a></p>`,
  });
  await db
    .update(userData)
    .set({ inboxNews: sql`${userData.inboxNews} + 1` })
    .where(inArray(userData.userId, recipients));
  return {
    conversationId: id,
    recipientIds: recipients,
    countedAt,
    senderId: event === "requested" ? request.requesterId : request.crafterId,
  };
};

/** Pin the crafter identity while submission reserves cross-account escrow. */
export const claimServiceCrafter = (
  db: DrizzleClient,
  user: Pick<UserData, "userId" | "updatedAt">,
) =>
  db
    .update(userData)
    .set({ updatedAt: nextSnapshotSql(userData.updatedAt) })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.occupation, "CRAFTING"),
        liveServiceIdentity(db, user.userId),
      ),
    );
/** Release a cancelled active slot without clearing a later service's reservation. */
export const releaseServiceSlot = (
  db: DrizzleClient,
  request: CraftingServiceRequest,
) =>
  db
    .update(userData)
    .set({ serviceCraftUntil: null })
    .where(
      and(
        eq(userData.userId, request.crafterId),
        request.finishesAt
          ? eq(userData.serviceCraftUntil, request.finishesAt)
          : sql`FALSE`,
      ),
    );

/** Write-time identity gate; retirement waits on the same user row before escrow discovery. */
const liveServiceIdentity = (db: DrizzleClient, userId: string) =>
  notExists(
    db
      .select({ id: storeUserIdAlias.oldUserId })
      .from(storeUserIdAlias)
      .where(eq(storeUserIdAlias.oldUserId, userId)),
  );
/** Lock the exact advertised offer while publishing escrow; an edit or disable wins atomically. */
export const claimServiceOffer = (
  db: DrizzleClient,
  price: typeof craftingServicePrice.$inferSelect,
) =>
  db
    .update(craftingServicePrice)
    .set({ revision: sql`${craftingServicePrice.revision} + 1` })
    .where(
      and(
        eq(craftingServicePrice.userId, price.userId),
        eq(craftingServicePrice.service, price.service),
        eq(craftingServicePrice.rarity, price.rarity),
        eq(craftingServicePrice.fee, price.fee),
        eq(craftingServicePrice.enabled, true),
      ),
    );
/** Serialize settlement against renaming and deletion without granting to a retired ID. */
export const lockServiceParticipant = (db: DrizzleClient, userId: string) =>
  db
    .update(userData)
    .set({ updatedAt: nextSnapshotSql(userData.updatedAt) })
    .where(eq(userData.userId, userId));
/** Load all open requests with their public participants for the service desk. */
export const findVisibleOpenServiceRequests = (db: DrizzleClient, userId: string) =>
  db.query.craftingServiceRequest.findMany({
    where: and(
      or(
        eq(craftingServiceRequest.requesterId, userId),
        eq(craftingServiceRequest.crafterId, userId),
      ),
      inArray(craftingServiceRequest.status, ["PENDING", "ACTIVE"]),
    ),
    orderBy: desc(craftingServiceRequest.createdAt),
    with: {
      crystal: { columns: { name: true } },
      crafter: { columns: { username: true } },
      requester: { columns: { username: true } },
    },
  });
