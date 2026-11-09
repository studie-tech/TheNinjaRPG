/**
 * Database access for account deletion; authorization and transaction scopes stay in callers.
 */
import { and, asc, eq, inArray, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";
import {
  accountDeletion,
  anbuSquad,
  auctionBid,
  auctionListing,
  clan,
  emailReminder,
  supportTicket,
  supportTicketActivity,
  userData,
  userUpload,
  village,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/** Build the `accountDeletion` lookup for `request`, selecting only `userId`, using predicates on `userId`. */
export const findAccountDeletionForRequest = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.accountDeletion.findFirst({
    columns: { userId: true },
    where: eq(accountDeletion.userId, ctx.userId),
  });

/** Build the `accountDeletion` insert for `request`, updating duplicate keys. */
export const insertAccountDeletionForRequest = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  apple: { subject?: undefined | null | string },
) =>
  client
    .insert(accountDeletion)
    .values({ userId: ctx.userId, appleRevokedSubject: apple.subject })
    .onDuplicateKeyUpdate({ set: { userId: ctx.userId } });

/**
 * Build the `auctionListing` lookup for `removeAccountGameData`, selecting only `id`,
 * using predicates on `sellerId` and `status`.
 */
export const findAuctionListingForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.auctionListing.findFirst({
    columns: { id: true },
    where: and(
      eq(auctionListing.sellerId, userId),
      eq(auctionListing.status, "ACTIVE"),
    ),
  });

/** Build the `auctionBid` selection for `removeAccountGameData`, using predicates on `bidderId` and `status`. */
export const selectAuctionBidForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ id: auctionBid.id })
    .from(auctionBid)
    .innerJoin(auctionListing, eq(auctionBid.auctionId, auctionListing.id))
    .where(and(eq(auctionBid.bidderId, userId), eq(auctionListing.status, "ACTIVE")))
    .limit(1);

/** Build the `anbuSquad` update for `removeAccountGameData`, setting `leaderId`, using predicates on `leaderId`. */
export const updateAnbuSquadForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "update" | "select">,
  userId: string,
) => {
  const successor = client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.anbuId, anbuSquad.id), ne(userData.userId, userId)))
    .orderBy(asc(userData.createdAt))
    .limit(1);
  return client
    .update(anbuSquad)
    .set({ leaderId: sql`${successor}` })
    .where(eq(anbuSquad.leaderId, userId));
};

/** Build the `village` update for `removeAccountGameData`, setting `kageId`, using predicates on `kageId`. */
export const updateVillageForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) => client.update(village).set({ kageId: "" }).where(eq(village.kageId, userId));

/** Build the `clan` update for `removeAccountGameData`, setting `leaderId`, using predicates on `leaderId`. */
export const updateClanForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) => client.update(clan).set({ leaderId: "" }).where(eq(clan.leaderId, userId));

/** Build the `clan` update for `removeAccountGameData`, setting `founderId`, using predicates on `founderId`. */
export const updateClanForRemoveAccountGameData2 = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) => client.update(clan).set({ founderId: "" }).where(eq(clan.founderId, userId));

/** Build the `clan` update for `removeAccountGameData`, setting `column`, using predicates on `column`. */
export const updateClanForRemoveAccountGameData3 = (
  client: Pick<DrizzleClient, "update">,
  column:
    | "coLeader1"
    | "coLeader2"
    | "coLeader3"
    | "assassin1"
    | "assassin2"
    | "assassin3"
    | "assassin4"
    | "assassin5"
    | "assassin6"
    | "assassin7"
    | "assassin8"
    | "assassin9"
    | "assassin10",
  userId: string,
) =>
  client
    .update(clan)
    .set({ [column]: null })
    .where(eq(clan[column], userId));

/** Build the `emailReminder` deletion for `removeAccountGameData`, using predicates on `userId`. */
export const deleteEmailReminderForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(emailReminder).where(eq(emailReminder.userId, userId));

/** Build the `table` deletion for `user`, using the configured predicates. */
export const deleteRowsForUser = (
  client: Pick<DrizzleClient, "delete">,
  table: import("drizzle-orm/mysql-core").MySqlTable & {
    userId: import("drizzle-orm/mysql-core").AnyMySqlColumn;
  },
  userId: string,
) => client.delete(table).where(eq(table.userId, userId));

/**
 * Build the `supportTicket` listing for `removeAccountGameData`, selecting only `id`,
 * using predicates on `createdByUserId`.
 */
export const listSupportTicketForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.supportTicket.findMany({
    columns: { id: true },
    where: eq(supportTicket.createdByUserId, userId),
  });

/** Build the `supportTicketActivity` deletion for `removeAccountGameData`, using predicates on `ticketId`. */
export const deleteSupportTicketActivityForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "delete">,
  tickets: Pick<import("@/drizzle/schema").DungeonRun, "id">[],
) =>
  client.delete(supportTicketActivity).where(
    inArray(
      supportTicketActivity.ticketId,
      tickets.map((ticket) => ticket.id),
    ),
  );

/** Build the `supportTicketActivity` deletion for `removeAccountGameData`, using predicates on `authorId`. */
export const deleteSupportTicketActivityForRemoveAccountGameData2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client
    .delete(supportTicketActivity)
    .where(eq(supportTicketActivity.authorId, userId));

/** Build the `supportTicket` deletion for `removeAccountGameData`, using predicates on `createdByUserId`. */
export const deleteSupportTicketForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(supportTicket).where(eq(supportTicket.createdByUserId, userId));

/**
 * Build the `supportTicket` update for `removeAccountGameData`, setting
 * `assignedToUserId`, using predicates on `assignedToUserId`.
 */
export const updateSupportTicketForRemoveAccountGameData = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(supportTicket)
    .set({ assignedToUserId: null })
    .where(eq(supportTicket.assignedToUserId, userId));

/** Build the `emailReminder` deletion for `removeAccountIdentity`, using predicates on `userId` and `email`. */
export const deleteEmailReminderForRemoveAccountIdentity = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  emails: string[],
) =>
  client
    .delete(emailReminder)
    .where(
      or(
        eq(emailReminder.userId, userId),
        ...(emails.length ? [inArray(emailReminder.email, emails)] : []),
      ),
    );

/**
 * Build the `accountDeletion` listing for `processDueDeletions`, including predicates
 * on `userId`, `phase`, `nextAttemptAt`.
 */
export const listAccountDeletionForProcessDueDeletions = (
  client: Pick<DrizzleClient, "query">,
  userId: undefined | string,
  now: Date,
) =>
  client.query.accountDeletion.findMany({
    where: and(
      userId ? eq(accountDeletion.userId, userId) : undefined,
      ne(accountDeletion.phase, "COMPLETE"),
      lte(accountDeletion.nextAttemptAt, now),
      or(isNull(accountDeletion.leaseUntil), lte(accountDeletion.leaseUntil, now)),
    ),
    orderBy: [accountDeletion.nextAttemptAt, accountDeletion.userId],
    limit: userId ? 1 : 3,
  });

/**
 * Build the `accountDeletion` update for `processDueDeletions`, including predicates
 * on `userId`, `phase`, `nextAttemptAt`.
 */
export const updateAccountDeletionForProcessDueDeletions = (
  client: Pick<DrizzleClient, "update">,
  leaseId: string,
  job: { userId: string; phase: "QUEUED" | "IDENTITY_DELETED" | "COMPLETE" },
  now: Date,
) =>
  client
    .update(accountDeletion)
    .set({
      leaseId,
      leaseUntil: secondsFromNow(600),
      attempts: sql`${accountDeletion.attempts} + 1`,
    })
    .where(
      and(
        eq(accountDeletion.userId, job.userId),
        eq(accountDeletion.phase, job.phase),
        lte(accountDeletion.nextAttemptAt, now),
        or(isNull(accountDeletion.leaseUntil), lte(accountDeletion.leaseUntil, now)),
      ),
    );

/** Build the `accountDeletion` update for `advance`, using the configured predicates. */
export const updateAccountDeletionForAdvance = (
  client: Pick<DrizzleClient, "update">,
  phase: "IDENTITY_DELETED" | "COMPLETE",
  delayMs: number,
  job: { appleRevokedSubject: null | string },
  ownedLease: undefined | SQL<unknown>,
) =>
  client
    .update(accountDeletion)
    .set({
      phase,
      nextAttemptAt: secondsFromNow(delayMs / 1000),
      completedAt: phase === "COMPLETE" ? new Date() : null,
      appleRevokedSubject: phase === "COMPLETE" ? null : job.appleRevokedSubject,
      leaseId: null,
      leaseUntil: null,
    })
    .where(ownedLease);

/** Build the `accountDeletion` update for `processDueDeletions`, using the configured predicates. */
export const updateAccountDeletionForProcessDueDeletions2 = (
  client: Pick<DrizzleClient, "update">,
  ownedLease: undefined | SQL<unknown>,
) =>
  client
    .update(accountDeletion)
    .set({ nextAttemptAt: secondsFromNow(3600), leaseId: null, leaseUntil: null })
    .where(ownedLease);

/**
 * Build the `userUpload` listing for `removeAccountProcessorData`, selecting only
 * `imageUrl`, using predicates on `userId`.
 */
export const listUserUploadForRemoveAccountProcessorData = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userUpload.findMany({
    columns: { imageUrl: true },
    where: eq(userUpload.userId, userId),
  });
