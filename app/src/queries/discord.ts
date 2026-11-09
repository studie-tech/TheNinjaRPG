/**
 * Database access for discord; authorization and transaction scopes stay in callers.
 */
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  ne,
  not,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { ActiveBanStates, DISCORD_INDEFINITE_SANCTION_DAYS } from "@/drizzle/constants";
import {
  actionLog,
  type DiscordLink,
  discordLink,
  discordLinkHistory,
  userData,
  userReport,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { encryptToken } from "@/server/utils/discord/secrets";
import { clampActionLogText } from "@/utils/actionLog";

/** Build the `discordLink` lookup for `getStatus`, using predicates on `userId`. */
export const findDiscordLinkForGetStatus = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.discordLink.findFirst({
    columns: {
      discordId: true,
      discordUsername: true,
      linkedAt: true,
      tokenSource: true,
      syncError: true,
    },
    where: eq(discordLink.userId, ctx.userId),
  });

/** Build the `discordLink` listing for `getStatus`, selecting row fields `userId`, using predicates on `discordId`. */
export const listDiscordLinkForGetStatus = (
  client: Pick<DrizzleClient, "query">,
  link: { discordId: string },
) =>
  client.query.discordLink.findMany({
    columns: { userId: true },
    with: { user: { columns: { username: true } } },
    where: eq(discordLink.discordId, link.discordId),
    orderBy: [desc(discordLink.isPrimary), asc(discordLink.slot)],
  });

/** Build the `discordLink` lookup for `setPrimary`, using predicates on `userId`. */
export const findDiscordLinkForSetPrimary = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.discordLink.findFirst({
    columns: { id: true, discordId: true, discordUsername: true, isPrimary: true },
    where: eq(discordLink.userId, ctx.userId),
  });

/** Build the `discordLink` lookup for `unlink`, selecting only `id`, using predicates on `userId`. */
export const findDiscordLinkForUnlink = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.discordLink.findFirst({
    columns: { id: true },
    where: eq(discordLink.userId, ctx.userId),
  });

/**
 * Build the `discordLink` distinct selection for `searchLinks`, using predicates on
 * `username`, `discordId`, `discordUsername`.
 */
export const selectDistinctDiscordLinkForSearchLinks = (
  client: Pick<DrizzleClient, "selectDistinct">,
  pattern: string,
  input: { query: string },
) =>
  client
    .selectDistinct({ discordId: discordLink.discordId })
    .from(discordLink)
    .leftJoin(userData, eq(userData.userId, discordLink.userId))
    .where(
      or(
        like(userData.username, pattern),
        eq(discordLink.discordId, input.query),
        like(discordLink.discordUsername, pattern),
      ),
    )
    .limit(25);

/**
 * Build the `discordLinkHistory` selection for `searchLinks`, using predicates on
 * `username`, `discordId`, `discordUsername`.
 */
export const selectDiscordLinkHistoryForSearchLinks = (
  client: Pick<DrizzleClient, "select">,
  pattern: string,
  input: { query: string },
) =>
  client
    .select({
      id: discordLinkHistory.id,
      userId: discordLinkHistory.userId,
      username: userData.username,
      discordId: discordLinkHistory.discordId,
      discordUsername: discordLinkHistory.discordUsername,
      linkedAt: discordLinkHistory.linkedAt,
      unlinkedAt: discordLinkHistory.unlinkedAt,
      reason: discordLinkHistory.reason,
      cooldownWaived: discordLinkHistory.cooldownWaived,
    })
    .from(discordLinkHistory)
    .leftJoin(userData, eq(userData.userId, discordLinkHistory.userId))
    .where(
      or(
        like(userData.username, pattern),
        eq(discordLinkHistory.discordId, input.query),
        like(discordLinkHistory.discordUsername, pattern),
      ),
    )
    .orderBy(desc(discordLinkHistory.unlinkedAt))
    .limit(50);

/** Build the `discordLink` selection for `searchLinks`, using predicates on `discordId`. */
export const selectDiscordLinkForSearchLinks = (
  client: Pick<DrizzleClient, "select">,
  matches: Pick<import("@/drizzle/schema").DiscordLink, "discordId">[],
) =>
  client
    .select({
      userId: discordLink.userId,
      username: userData.username,
      avatar: userData.avatarLight,
      discordId: discordLink.discordId,
      discordUsername: discordLink.discordUsername,
      discordCreatedAt: discordLink.discordCreatedAt,
      clerkDiscordId: discordLink.clerkDiscordId,
      linkedAt: discordLink.linkedAt,
      slot: discordLink.slot,
      scopes: discordLink.scopes,
      tokenSource: discordLink.tokenSource,
      syncedAt: discordLink.syncedAt,
      syncedBanned: discordLink.syncedBanned,
      syncError: discordLink.syncError,
    })
    .from(discordLink)
    .leftJoin(userData, eq(userData.userId, discordLink.userId))
    .where(
      inArray(
        discordLink.discordId,
        matches.map((match) => match.discordId),
      ),
    )
    .orderBy(
      asc(discordLink.discordId),
      desc(discordLink.isPrimary),
      asc(discordLink.slot),
    );

/** Build the `discordLink` update for `completeDiscordLink`, using predicates on `id`. */
export const updateDiscordLinkForCompleteDiscordLink = (
  client: Pick<DrizzleClient, "update">,
  tokenColumns: Pick<
    import("@/drizzle/schema").DiscordLink,
    "tokenSource" | "accessToken" | "refreshToken" | "tokenExpiresAt" | "scopes"
  >,
  handle: string,
  clerkDiscordId: null | string,
  existing: { id: string },
) =>
  client
    .update(discordLink)
    .set({
      ...tokenColumns,
      discordUsername: handle,
      clerkDiscordId,
      syncedAt: null,
    })
    .where(eq(discordLink.id, existing.id));

/**
 * Build the `userData` lookup for `removeDiscordLink`, selecting only `username` and
 * `avatarLight`, using predicates on `userId`.
 */
export const findUserDataForRemoveDiscordLink = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { username: true, avatarLight: true },
    where: eq(userData.userId, input.userId),
  });

/** Build the `discordLink` lookup for `removeDiscordLink`, using predicates on `discordId` and `id`. */
export const findDiscordLinkForRemoveDiscordLink2 = (
  client: Pick<DrizzleClient, "query">,
  link: { discordId: string; id: string },
) =>
  client.query.discordLink.findFirst({
    columns: { id: true, userId: true, discordId: true },
    where: and(eq(discordLink.discordId, link.discordId), ne(discordLink.id, link.id)),
  });

/** Build the `discordLink` lookup for `removeDiscordLink`, using predicates on `discordId`. */
export const findDiscordLinkForRemoveDiscordLink3 = (
  client: Pick<DrizzleClient, "query">,
  link: { discordId: string },
) =>
  client.query.discordLink.findFirst({
    columns: { id: true, userId: true, discordId: true },
    where: eq(discordLink.discordId, link.discordId),
  });

/** Build the active indefinite ban or silence report lookup for one character. */
export const selectUserReportForFetchIndefiniteSanction = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ id: userReport.id, status: userReport.status })
    .from(userReport)
    .where(indefiniteSanctionWhere(userId));

/** User ids linked to a Discord account, as a subquery. */
const discordAccountUserIds = (discordId: string) =>
  sql`(SELECT ${discordLink.userId} FROM ${discordLink} WHERE ${discordLink.discordId} = ${discordId})`;

/**
 * Indefinite sanctions of any character linked to a Discord account: the account stays banned
 * while one of them runs.
 */
export const fetchDiscordAccountSanctions = (
  client: DrizzleClient,
  discordId: string,
) =>
  client
    .select({
      id: userReport.id,
      status: userReport.status,
      userId: userReport.reportedUserId,
    })
    .from(userReport)
    .where(indefiniteSanctionWhere(discordAccountUserIds(discordId)));

/**
 * The links of a Discord account, primary first. Without exactly one `isPrimary` row (a race
 * between an unlink and a link can leave none for a moment), the lowest slot counts as
 * primary until the next sync writes it back.
 */
export const fetchDiscordAccountLinks = (client: DrizzleClient, discordId: string) =>
  client.query.discordLink.findMany({
    where: eq(discordLink.discordId, discordId),
    with: { user: { columns: { username: true, level: true, villageId: true } } },
    orderBy: [desc(discordLink.isPrimary), asc(discordLink.slot)],
  });

/**
 * Make one link the primary of its Discord account and every other link of it secondary, in
 * a single statement.
 */
export const setDiscordPrimary = (
  client: DrizzleClient,
  link: Pick<DiscordLink, "id" | "discordId">,
) =>
  client
    .update(discordLink)
    .set({ isPrimary: sql`(${discordLink.id} = ${link.id})` })
    .where(eq(discordLink.discordId, link.discordId));

/** Build the `userData` lookup for `loadLinkCandidate`, using predicates on `userId`. */
export const findUserDataForLoadLinkCandidate = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: {
      userId: true,
      username: true,
      level: true,
      villageId: true,
      isBanned: true,
      avatarLight: true,
    },
    where: eq(userData.userId, input.userId),
  });

/** Build the `discordLink` lookup for `user`, using predicates on `userId`. */
export const findDiscordLinkForUser = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.discordLink.findFirst({
    where: eq(discordLink.userId, input.userId),
  });

/** Build the `discordLink` listing for `loadLinkCandidate`, using predicates on `discordId`. */
export const listDiscordLinkForLoadLinkCandidate = (
  client: Pick<DrizzleClient, "query">,
  input: { discordId: string },
) =>
  client.query.discordLink.findMany({
    columns: { userId: true, slot: true, isPrimary: true, syncedBanned: true },
    where: eq(discordLink.discordId, input.discordId),
    with: { user: { columns: { username: true } } },
  });

/**
 * Build the `discordLinkHistory` listing for `loadLinkCandidate`, using predicates on
 * `userId`, `discordId`, `unlinkedAt`.
 */
export const listDiscordLinkHistoryForLoadLinkCandidate = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string; discordId: string },
  cooldownStart: Date,
) =>
  client.query.discordLinkHistory.findMany({
    columns: {
      userId: true,
      discordId: true,
      unlinkedAt: true,
      cooldownWaived: true,
    },
    where: and(
      or(
        eq(discordLinkHistory.userId, input.userId),
        eq(discordLinkHistory.discordId, input.discordId),
      ),
      gt(discordLinkHistory.unlinkedAt, cooldownStart),
    ),
  });

/** Build the `userReport` selection for `loadLinkCandidate`, using predicates on `reportedUserId`, `status`, `banEnd`. */
export const selectUserReportForLoadLinkCandidate = (
  client: Pick<DrizzleClient, "select">,
  input: { userId: string },
) =>
  client
    .select({ id: userReport.id })
    .from(userReport)
    .where(
      or(
        and(
          eq(userReport.reportedUserId, input.userId),
          inArray(userReport.status, ActiveBanStates),
          gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
        ),
        indefiniteSanctionWhere(input.userId),
      ),
    )
    .limit(1);

/** Build the `discordLink` insert for `insertDiscordLink`. */
export const insertDiscordLinkForInsertDiscordLink = (
  client: Pick<DrizzleClient, "insert">,
  values: typeof discordLink.$inferInsert,
) => client.insert(discordLink).values(values);

/** Build the `discordLinkHistory` insert for `archiveDiscordLink`, updating duplicate keys. */
export const insertDiscordLinkHistoryForArchiveDiscordLink = (
  client: Pick<DrizzleClient, "insert">,
  link: {
    id: string;
    userId: string;
    discordId: string;
    discordUsername: string;
    linkedAt: Date;
  },
  reason: "USER" | "STAFF" | "ACCOUNT_DELETED",
  options: {
    staffUserId?: undefined | string;
    cooldownWaived?: undefined | false | true;
  },
) =>
  client
    .insert(discordLinkHistory)
    .values({
      id: link.id,
      userId: link.userId,
      discordId: link.discordId,
      discordUsername: link.discordUsername,
      linkedAt: link.linkedAt,
      reason,
      unlinkedByUserId: options.staffUserId ?? null,
      cooldownWaived: options.cooldownWaived ?? false,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`${discordLinkHistory.id}` } });

/** Build the `discordLink` deletion for `archiveDiscordLink`, using predicates on `id`. */
export const deleteDiscordLinkForArchiveDiscordLink = (
  client: Pick<DrizzleClient, "delete">,
  link: { id: string },
) => client.delete(discordLink).where(eq(discordLink.id, link.id));

/**
 * Build the `discordLink` listing for `findClerkDiscordFlags`, using predicates on
 * `userId`, `discordId`, `clerkDiscordId`.
 */
export const listDiscordLinkForFindClerkDiscordFlags = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string; discordId: string; clerkDiscordId: null | string },
) =>
  client.query.discordLink.findMany({
    columns: { userId: true, discordId: true, clerkDiscordId: true },
    with: { user: { columns: { username: true } } },
    where: and(
      ne(discordLink.userId, input.userId),
      ne(discordLink.discordId, input.discordId),
      or(
        eq(discordLink.clerkDiscordId, input.discordId),
        input.clerkDiscordId
          ? eq(discordLink.discordId, input.clerkDiscordId)
          : undefined,
      ),
    ),
  });

/** ActionLog entry for link changes; staff read them on the Discord links page. */
export const logDiscordAction = (
  client: DrizzleClient,
  entry: {
    actorUserId: string;
    targetUserId: string;
    message: string;
    changes: string[];
    image?: string | null;
  },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: entry.actorUserId,
    tableName: "discordLink",
    relatedId: entry.targetUserId,
    relatedMsg: clampActionLogText(entry.message),
    relatedImage: entry.image ?? null,
    changes: entry.changes,
  });

/** Discord link ActionLog entries about a character, newest first. */
export const fetchDiscordActionLog = (client: DrizzleClient, userId: string) =>
  client.query.actionLog.findMany({
    columns: {
      id: true,
      createdAt: true,
      relatedMsg: true,
      changes: true,
      userId: true,
    },
    where: and(eq(actionLog.tableName, "discordLink"), eq(actionLog.relatedId, userId)),
    orderBy: desc(actionLog.createdAt),
    limit: 50,
  });

/** Build the `discordLink` lookup for `user`, selecting only `discordId`, using predicates on `userId`. */
export const findDiscordAccountIdForUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.discordLink.findFirst({
    columns: { discordId: true },
    where: eq(discordLink.userId, userId),
  });

/** Table alias for linked joins, keeping its columns distinct from other participants. */
const linked = alias(discordLink, "linked");

/** Table alias for primary joins, keeping its columns distinct from other participants. */
const primary = alias(discordLink, "primaryLink");

/** Build the `discordLink` update for `getLinkAccessToken`, using predicates on `id`. */
export const updateDiscordLinkForGetLinkAccessToken = (
  client: Pick<DrizzleClient, "update">,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  },
  config: { tokenKey: Buffer<ArrayBufferLike> },
  link: { id: string },
) =>
  client
    .update(discordLink)
    .set({
      accessToken: encryptToken(tokens.access_token, config.tokenKey),
      refreshToken: encryptToken(tokens.refresh_token, config.tokenKey),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
    })
    .where(eq(discordLink.id, link.id));

/** Build the `discordLink` update for `getClerkLinkAccessToken`, setting `scopes`, using predicates on `id`. */
export const updateDiscordLinkForGetClerkLinkAccessToken = (
  client: Pick<DrizzleClient, "update">,
  scopes: string,
  link: { id: string },
) =>
  client
    .update(discordLink)
    .set({ scopes: scopes.slice(0, 191) })
    .where(eq(discordLink.id, link.id));

/** Build the Discord synchronization checkpoint update for the supplied link. */
export const saveSyncState = (
  client: DrizzleClient,
  discordId: string,
  update: Partial<typeof discordLink.$inferInsert>,
  errors: string[],
) =>
  client
    .update(discordLink)
    .set({
      ...update,
      syncedAt: new Date(),
      syncError: errors.length ? errors.join("; ").slice(0, 500) : null,
    })
    .where(eq(discordLink.discordId, discordId));

/** Build the `linked` selection for `fetchLinksNeedingSync`, using predicates on `discordId`. */
export const selectLinkedForFetchLinksNeedingSync = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: userReport.id })
    .from(linked)
    .innerJoin(userReport, indefiniteSanctionWhere(linked.userId))
    .where(eq(linked.discordId, discordLink.discordId));

/** Build the `primary` selection for `fetchLinksNeedingSync`, using predicates on `discordId` and `isPrimary`. */
export const selectPrimaryForFetchLinksNeedingSync = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: primary.id })
    .from(primary)
    .where(
      and(eq(primary.discordId, discordLink.discordId), eq(primary.isPrimary, true)),
    );

/**
 * Build the `discordLink` selection for `fetchLinksNeedingSync`, including predicates
 * on `syncedAt`, `syncedBanned`, `isPrimary`.
 */
export const selectDiscordLinkForFetchLinksNeedingSync = (
  client: Pick<DrizzleClient, "select">,
  refreshBefore: Date,
  sanctioned: SQL<unknown>,
  hasPrimary: SQL<unknown>,
  limit: number,
) =>
  client
    .select({
      userId: discordLink.userId,
      discordId: discordLink.discordId,
      syncedAt: discordLink.syncedAt,
    })
    .from(discordLink)
    .innerJoin(userData, eq(userData.userId, discordLink.userId))
    .where(
      or(
        isNull(discordLink.syncedAt),
        lt(discordLink.syncedAt, refreshBefore),
        ne(discordLink.syncedBanned, sanctioned),
        not(hasPrimary),
        // While banned, nickname, roles and metadata are not applied, so they cannot differ.
        and(
          not(sanctioned),
          eq(discordLink.isPrimary, true),
          or(
            sql`NOT (${discordLink.syncedUsername} <=> ${userData.username})`,
            sql`NOT (${discordLink.syncedVillageId} <=> ${userData.villageId})`,
            sql`NOT (${discordLink.syncedLevel} <=> ${userData.level})`,
          ),
        ),
      ),
    )
    .orderBy(asc(discordLink.syncedAt))
    .limit(limit);

/**
 * Bans and silences that ban the linked Discord account: still running, and imposed for at
 * least DISCORD_INDEFINITE_SANCTION_DAYS. The length is measured from the decision
 * (`updatedAt`, written with status and `banEnd` by `updateSanctionReport`), so a long ban
 * keeps matching until it ends instead of dropping out once less than the window remains.
 * `userId` is a value, a joined column or a subquery of user ids.
 */
export const indefiniteSanctionWhere = (userId: string | AnyColumn | SQL) =>
  and(
    userId instanceof SQL
      ? inArray(userReport.reportedUserId, userId)
      : eq(userReport.reportedUserId, userId),
    inArray(userReport.status, [...ActiveBanStates, "SILENCE_ACTIVATED"]),
    gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
    gte(
      userReport.banEnd,
      sql`${userReport.updatedAt} + INTERVAL ${DISCORD_INDEFINITE_SANCTION_DAYS} DAY`,
    ),
  );
