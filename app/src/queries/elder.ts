/**
 * Database access for elder; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  clan,
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { clampActionLogText } from "@/utils/actionLog";

/** One ActionLog row of the monthly elder rotation, logged against the village. */
export type ElderRotationLogEntry = {
  userId: string;
  villageId: string | null;
  message: string;
  changes: string[];
};

/** Build the `villageElderVote` listing for `fetchElderVotes`, using predicates on `villageId` and `status`. */
export const listVillageElderVoteForFetchElderVotes = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.villageId, villageId),
      eq(villageElderVote.status, "PENDING"),
    ),
    with: {
      entries: {
        with: {
          user: { columns: { username: true, userId: true, avatar: true } },
        },
      },
      initiatedBy: { columns: { username: true, userId: true, avatar: true } },
    },
    orderBy: [desc(villageElderVote.createdAt)],
  });

/** Build the `village` selection for `fetchElderVotes`, using predicates on `id`. */
export const selectVillageForFetchElderVotes = (
  client: Pick<DrizzleClient, "select">,
  villageTargetIds: string[],
) =>
  client
    .select({ id: village.id, name: village.name })
    .from(village)
    .where(inArray(village.id, villageTargetIds));

/** Build the `userData` selection for `fetchElderVotes`, using predicates on `userId`. */
export const selectUserDataForFetchElderVotes = (
  client: Pick<DrizzleClient, "select">,
  userTargetIds: string[],
) =>
  client
    .select({ userId: userData.userId, username: userData.username })
    .from(userData)
    .where(inArray(userData.userId, userTargetIds));

/**
 * Fetch a single elder vote by ID
 */
export const fetchElderVote = async (client: DrizzleClient, voteId: string) => {
  return client.query.villageElderVote.findFirst({
    where: eq(villageElderVote.id, voteId),
    with: { entries: true },
  });
};

/**
 * Build the `villageElderVoteEntry` insert for `castElderVoteEntry`. A repeat ballot is
 * ignored, so `rowsAffected` is 0 for it on every driver, with or without CLIENT_FOUND_ROWS.
 */
export const insertVillageElderVoteEntryForCastElderVoteEntry = (
  client: Pick<DrizzleClient, "insert">,
  voteId: string,
  userId: string,
  vote: "YES" | "NO",
) =>
  client
    .insert(villageElderVoteEntry)
    .ignore()
    .values({ id: nanoid(), voteId, userId, vote });

/**
 * Fetch all pending elder votes whose deadline has passed
 */
export const fetchExpiredElderVotes = async (client: DrizzleClient) => {
  return client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.status, "PENDING"),
      lt(villageElderVote.endsAt, new Date()),
    ),
    with: { entries: true },
  });
};

/** Build the `userData` selection for `processExpiredElderVotes`, using predicates on `rank` and `isAi`. */
export const selectUserDataForProcessExpiredElderVotes = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ userId: userData.userId, villageId: userData.villageId })
    .from(userData)
    .where(and(eq(userData.rank, "ELDER"), eq(userData.isAi, false)));

/** Build the `village` listing for `processExpiredElderVotes`. */
export const listVillageForProcessExpiredElderVotes = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findMany({
    columns: { id: true, name: true, kageId: true, tokens: true },
  });

/**
 * Build the `villageElderVote` update for `rejectWarDeclaration`, setting `status` and
 * `endsAt`, using predicates on `id` and `status`.
 */
export const updateVillageElderVoteForRejectWarDeclaration = (
  client: Pick<DrizzleClient, "update">,
  vote: { id: string },
  endsAt: Date,
  fromStatus: "PENDING" | "APPROVED",
) =>
  client
    .update(villageElderVote)
    .set({ status: "REJECTED", endsAt })
    .where(
      and(eq(villageElderVote.id, vote.id), eq(villageElderVote.status, fromStatus)),
    );

/** Build the `village` listing for `handleCutoff`, selecting only `id` and `name`, using predicates on `type`. */
export const listVillageForHandleCutoff = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findMany({
    where: eq(village.type, "VILLAGE"),
    columns: { id: true, name: true },
  });

/** Build the `clan` listing for `handleCutoff`, using predicates on `villageId`. */
export const listClanForHandleCutoff = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    where: isNotNull(clan.villageId),
    columns: {
      id: true,
      villageId: true,
      activityPoints: true,
      points: true,
    },
  });

/** Build the `clan` update for `handleCutoff`, using predicates on `villageId`. */
export const updateClanForHandleCutoff = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(clan)
    .set({
      elderCutoffMonth: null,
      elderCutoffYear: null,
      elderCutoffRank: null,
    })
    .where(inArray(clan.villageId, villageIds));

/** Build the `clan` update for `handleCutoff`, using predicates on `id`. */
export const updateClanForHandleCutoff2 = (
  client: Pick<DrizzleClient, "update">,
  currentMonth: number,
  currentYear: number,
  c: { rank: number; id: string },
) =>
  client
    .update(clan)
    .set({
      elderCutoffMonth: currentMonth,
      elderCutoffYear: currentYear,
      elderCutoffRank: c.rank,
    })
    .where(eq(clan.id, c.id));

/** Build the `clan` listing for `handleRotation`, using predicates on `villageId`. */
export const listClanForHandleRotation = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    where: isNotNull(clan.villageId),
    columns: {
      id: true,
      name: true,
      villageId: true,
      leaderId: true,
      elderNomineeId: true,
      elderCutoffRank: true,
      activityPoints: true,
      points: true,
    },
  });

/** Build the `userData` update for `handleRotation`, setting `rank`, using predicates on `villageId` and `rank`. */
export const updateUserDataForHandleRotation = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(userData)
    .set({ rank: "JONIN" })
    .where(and(inArray(userData.villageId, villageIds), eq(userData.rank, "ELDER")));

/** Build the `userData` listing of current elders for `handleRotation`, using predicates on `villageId` and `rank`. */
export const listUserDataForHandleRotationElders = (
  client: Pick<DrizzleClient, "query">,
  villageIds: string[],
) =>
  client.query.userData.findMany({
    where: and(inArray(userData.villageId, villageIds), eq(userData.rank, "ELDER")),
    columns: { userId: true, username: true, villageId: true },
  });

/** Build the `userData` listing of every nominee for `handleRotation`, using predicates on `userId`. */
export const listUserDataForHandleRotation = (
  client: Pick<DrizzleClient, "query">,
  allNomineeIds: Set<string>,
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, [...allNomineeIds]),
    columns: {
      userId: true,
      username: true,
      clanId: true,
      villageId: true,
      isBanned: true,
      rank: true,
      anbuId: true,
    },
  });

/** Build the `userData` update for `handleRotation`, setting `rank`, using predicates on `userId`. */
export const updateUserDataForHandleRotation2 = (
  client: Pick<DrizzleClient, "update">,
  toPromote: string[],
) =>
  client
    .update(userData)
    .set({ rank: "ELDER" })
    .where(inArray(userData.userId, toPromote));

/** Build the `actionLog` insert for `handleRotation`. */
export const insertActionLogForHandleRotation = (
  client: Pick<DrizzleClient, "insert">,
  entries: ElderRotationLogEntry[],
) =>
  client.insert(actionLog).values(
    entries.map((entry) => ({
      id: nanoid(),
      userId: entry.userId,
      tableName: "village",
      relatedId: entry.villageId,
      relatedMsg: clampActionLogText(entry.message),
      changes: entry.changes,
    })),
  );

/** Build the `clan` update for `handleRotation`, using predicates on `villageId`. */
export const updateClanForHandleRotation = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(clan)
    .set({
      activityPoints: 0,
      elderNomineeId: null,
      elderCutoffMonth: null,
      elderCutoffYear: null,
      elderCutoffRank: null,
    })
    .where(inArray(clan.villageId, villageIds));
