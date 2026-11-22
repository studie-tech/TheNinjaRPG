/**
 * Database access for Kessen duels between players: duel matches, the turn clock, the
 * ranked queue and ladder, and friendly challenges (`UserRequest` rows of type KESSEN).
 * Authorization and orchestration stay in callers.
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  KESSEN_RANKED_DAILY_REWARDED_WINS,
  KESSEN_RANKED_WEEKLY_PACK_WINS,
} from "@/drizzle/constants";
import {
  kessenMatch,
  kessenProgress,
  kessenRankedQueue,
  userBlackList,
  userData,
  userRequest,
  village,
} from "@/drizzle/schema";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { DrizzleClient } from "@/server/db";
import type { KessenDeckSource, KessenStoredPvpMatch } from "@/validators/kessen";

const DUEL_KINDS = ["FRIENDLY", "RANKED"] as const;

/** A duel the player sits in (either seat), with its stored state. */
export const findKessenPvpMatch = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  matchId: string,
) =>
  client
    .select()
    .from(kessenMatch)
    .where(
      and(
        eq(kessenMatch.id, matchId),
        inArray(kessenMatch.kind, [...DUEL_KINDS]),
        or(eq(kessenMatch.userId, userId), eq(kessenMatch.opponentId, userId)),
      ),
    )
    .limit(1);

/** A duel by id, for work no player drives (the clock sweep). */
export const findKessenPvpMatchById = (
  client: Pick<DrizzleClient, "select">,
  matchId: string,
) =>
  client
    .select()
    .from(kessenMatch)
    .where(and(eq(kessenMatch.id, matchId), inArray(kessenMatch.kind, [...DUEL_KINDS])))
    .limit(1);

/**
 * ACTIVE matches of any kind on the current rules that one of `userIds` sits in, without
 * their state: the one-active-match guard and the lobby's duel summary. `standing` is
 * one JSON text with the engine's phase, turn and both seats' pending mulligans, and
 * `players` the duel's player snapshot.
 */
export const listActiveKessenMatchesForPlayers = (
  client: Pick<DrizzleClient, "select">,
  userIds: readonly string[],
) =>
  client
    .select({
      id: kessenMatch.id,
      kind: kessenMatch.kind,
      userId: kessenMatch.userId,
      opponentId: kessenMatch.opponentId,
      turnDeadline: kessenMatch.turnDeadline,
      standing: sql<string | null>`CAST(JSON_OBJECT(
        'phase', JSON_EXTRACT(${kessenMatch.state}, '$.engine.phase'),
        'turn', JSON_EXTRACT(${kessenMatch.state}, '$.engine.turn'),
        'mull0', JSON_EXTRACT(${kessenMatch.state}, '$.engine.seats[0].mull'),
        'mull1', JSON_EXTRACT(${kessenMatch.state}, '$.engine.seats[1].mull'),
        'names', JSON_EXTRACT(${kessenMatch.state}, '$.players[*].username')
      ) AS CHAR)`,
    })
    .from(kessenMatch)
    .where(
      and(
        eq(kessenMatch.status, "ACTIVE"),
        eq(kessenMatch.engineVersion, CARD_ENGINE_VERSION),
        or(
          inArray(kessenMatch.userId, userIds.length > 0 ? [...userIds] : [""]),
          inArray(kessenMatch.opponentId, userIds.length > 0 ? [...userIds] : [""]),
        ),
      ),
    )
    .orderBy(desc(kessenMatch.startedAt));

/** Rewrites the stored result of an ended duel (its settled result); CAS on version. */
export const updateKessenPvpMatchResult = (
  client: Pick<DrizzleClient, "update">,
  match: { id: string; version: number },
  change: { state: KessenStoredPvpMatch; now: Date },
) =>
  client
    .update(kessenMatch)
    .set({
      state: change.state as unknown as Record<string, unknown>,
      version: match.version + 1,
      updatedAt: change.now,
    })
    .where(
      and(
        eq(kessenMatch.id, match.id),
        eq(kessenMatch.version, match.version),
        inArray(kessenMatch.status, ["FINISHED", "CONCEDED"]),
      ),
    );

/**
 * Ends ACTIVE duels without a winner or rating (a clashing match of one of the players);
 * `version` moves on.
 */
export const updateKessenPvpMatchesForVoid = (
  client: Pick<DrizzleClient, "update">,
  matchIds: string[],
  now: Date,
) =>
  client
    .update(kessenMatch)
    .set({
      status: "EXPIRED",
      version: sql`${kessenMatch.version} + 1`,
      updatedAt: now,
      finishedAt: now,
      turnDeadline: null,
    })
    .where(
      and(
        inArray(kessenMatch.id, matchIds.length > 0 ? matchIds : [""]),
        eq(kessenMatch.status, "ACTIVE"),
      ),
    );

/** ACTIVE duels whose clock ran out before `before`, oldest deadline first. */
export const listOverdueKessenPvpMatches = (
  client: Pick<DrizzleClient, "select">,
  before: Date,
  limit: number,
) =>
  client
    .select()
    .from(kessenMatch)
    .where(
      and(
        eq(kessenMatch.status, "ACTIVE"),
        isNotNull(kessenMatch.turnDeadline),
        lt(kessenMatch.turnDeadline, before),
      ),
    )
    .orderBy(kessenMatch.turnDeadline)
    .limit(limit);

/**
 * Ended ranked duels whose settlement is still pending (the ending request stopped
 * before writing the settled result), ended between `since` and `before`, oldest first.
 * Only the ending write leaves `updatedAt` equal to `finishedAt`, so that column
 * comparison narrows the rows before the stored state is read.
 */
export const listUnsettledKessenPvpMatches = (
  client: Pick<DrizzleClient, "select">,
  input: { since: Date; before: Date; limit: number },
) =>
  client
    .select()
    .from(kessenMatch)
    .where(
      and(
        inArray(kessenMatch.status, ["FINISHED", "CONCEDED"]),
        gte(kessenMatch.updatedAt, input.since),
        lt(kessenMatch.updatedAt, input.before),
        eq(kessenMatch.kind, "RANKED"),
        eq(kessenMatch.updatedAt, kessenMatch.finishedAt),
        sql`JSON_TYPE(JSON_EXTRACT(${kessenMatch.state}, '$.settlement')) = 'OBJECT'`,
      ),
    )
    .orderBy(kessenMatch.updatedAt)
    .limit(input.limit);

/**
 * Ranked duels the player finished with a rating since `since`, as seat pairs, for the
 * per-opponent daily cap.
 */
export const listKessenRatedPairs = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  since: Date,
) =>
  // One branch per seat, so each reads its own index: seat 0 through
  // (userId, npcKey, finishedAt), where duels have no NPC, past the player's NPC matches.
  client
    .select({ userId: kessenMatch.userId, opponentId: kessenMatch.opponentId })
    .from(kessenMatch)
    .where(
      and(
        eq(kessenMatch.userId, userId),
        isNull(kessenMatch.npcKey),
        gte(kessenMatch.finishedAt, since),
        eq(kessenMatch.kind, "RANKED"),
        eq(kessenMatch.rated, true),
      ),
    )
    .unionAll(
      client
        .select({ userId: kessenMatch.userId, opponentId: kessenMatch.opponentId })
        .from(kessenMatch)
        .where(
          and(
            eq(kessenMatch.opponentId, userId),
            gte(kessenMatch.finishedAt, since),
            eq(kessenMatch.kind, "RANKED"),
            eq(kessenMatch.rated, true),
          ),
        ),
    );

/** Progress rows of several players (ratings and ranked counters). */
export const listKessenProgressRows = (
  client: Pick<DrizzleClient, "select">,
  userIds: readonly string[],
) =>
  client
    .select()
    .from(kessenProgress)
    .where(inArray(kessenProgress.userId, userIds.length > 0 ? [...userIds] : [""]));

/**
 * The rating claim of a ranked duel: marks the match rated and applies both seats'
 * rating changes and records in one guarded multi-table statement, so a rating moves
 * exactly once per match. Each seat's change was computed from its `before` rating and
 * `played` count, and the claim holds only while both still stand. No affected row means
 * the match was rated before, a rating moved since the changes were computed (or a
 * progress row is missing). Raw SQL because Drizzle's MySQL update cannot JOIN and SET
 * several tables.
 */
export const updateKessenMatchForRatingClaim = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    matchId: string;
    seats: [RatingSeat, RatingSeat];
    floor: number;
  },
) => {
  const m = kessenMatch;
  const [a, b] = input.seats;
  const setSeat = (alias: string, seat: RatingSeat) => sql`
    ${sql.raw(alias)}.rating = GREATEST(${sql.raw(alias)}.rating + ${seat.delta}, ${input.floor}),
    ${sql.raw(alias)}.rankedPlayed = ${sql.raw(alias)}.rankedPlayed + 1,
    ${sql.raw(alias)}.rankedWins = ${sql.raw(alias)}.rankedWins + ${seat.score === 1 ? 1 : 0},
    ${sql.raw(alias)}.rankedLosses = ${sql.raw(alias)}.rankedLosses + ${seat.score === 0 ? 1 : 0},
    ${sql.raw(alias)}.rankedDraws = ${sql.raw(alias)}.rankedDraws + ${seat.score === 0.5 ? 1 : 0},
    ${sql.raw(alias)}.updatedAt = CURRENT_TIMESTAMP(3)`;
  return client.execute(sql`
    UPDATE ${m}
      JOIN ${kessenProgress} AS pa ON pa.userId = ${a.userId}
      JOIN ${kessenProgress} AS pb ON pb.userId = ${b.userId}
    SET ${m.rated} = TRUE,
        ${setSeat("pa", a)},
        ${setSeat("pb", b)}
    WHERE ${m.id} = ${input.matchId}
      AND ${m.kind} = 'RANKED'
      AND ${m.rated} = FALSE
      AND pa.rating = ${a.before} AND pa.rankedPlayed = ${a.played}
      AND pb.rating = ${b.before} AND pb.rankedPlayed = ${b.played}
      AND ${m.status} IN ('FINISHED', 'CONCEDED')
  `);
};

/**
 * Counts one rewarded ranked win against the daily cap and the weekly count, and is the
 * reward's claim: no affected row once today's cap is used up, for a day the counters
 * already left, or when this match claimed it before (`rankedRewardMatchId`). `pack`
 * states whether this win reaches `KESSEN_RANKED_WEEKLY_PACK_WINS`, and the claim holds
 * only while that is still true, so the weekly pack follows the count the claim writes.
 * Raw SQL because the resets must read `rankedRewardDay` and `rankedWeekKey` before they
 * are overwritten and MySQL evaluates SET left to right.
 */
export const updateKessenProgressForRankedReward = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    matchId: string;
    userId: string;
    dayKey: string;
    weekKey: string;
    pack: boolean;
  },
) => {
  const p = kessenProgress;
  const day = input.dayKey;
  const weeklyAfter = sql`IF(${p.rankedWeekKey} = ${input.weekKey}, ${p.rankedWeeklyWins} + 1, 1)`;
  return client.execute(sql`
    UPDATE ${p}
    SET ${p.rankedRewardsToday} = IF(${p.rankedRewardDay} = ${day}, ${p.rankedRewardsToday} + 1, 1),
        ${p.rankedWeeklyWins} = ${weeklyAfter},
        ${p.rankedWeekKey} = ${input.weekKey},
        ${p.rankedRewardMatchId} = ${input.matchId},
        ${p.rankedRewardDay} = ${day}
    WHERE ${p.userId} = ${input.userId}
      AND ${p.rankedRewardDay} <= ${day}
      AND (${p.rankedRewardMatchId} IS NULL OR ${p.rankedRewardMatchId} <> ${input.matchId})
      AND (${p.rankedRewardDay} <> ${day} OR ${p.rankedRewardsToday} < ${KESSEN_RANKED_DAILY_REWARDED_WINS})
      AND (${weeklyAfter} = ${KESSEN_RANKED_WEEKLY_PACK_WINS}) = ${input.pack ? 1 : 0}
  `);
};

/** The ladder: players with a rated match, best rating first, with display fields. */
export const listKessenLeaderboard = (
  client: Pick<DrizzleClient, "select">,
  limit: number,
) =>
  client
    .select({
      userId: kessenProgress.userId,
      rating: kessenProgress.rating,
      wins: kessenProgress.rankedWins,
      losses: kessenProgress.rankedLosses,
      draws: kessenProgress.rankedDraws,
      username: userData.username,
      avatar: userData.avatar,
      level: userData.level,
    })
    .from(kessenProgress)
    .innerJoin(userData, eq(userData.userId, kessenProgress.userId))
    .where(and(gt(kessenProgress.rankedPlayed, 0), eq(userData.isBanned, false)))
    .orderBy(desc(kessenProgress.rating), kessenProgress.userId)
    .limit(limit);

/** Ladder players rated above `rating` (the viewer's rank is this plus one). */
export const countKessenRatingsAbove = (
  client: Pick<DrizzleClient, "select">,
  rating: number,
) =>
  client
    .select({ above: count() })
    .from(kessenProgress)
    .innerJoin(userData, eq(userData.userId, kessenProgress.userId))
    .where(
      and(
        gt(kessenProgress.rankedPlayed, 0),
        gt(kessenProgress.rating, rating),
        eq(userData.isBanned, false),
      ),
    );

/** The players a duel needs: standing, display fields and their village name. */
export const listKessenDuelists = (
  client: Pick<DrizzleClient, "select">,
  userIds: readonly string[],
) =>
  client
    .select({
      userId: userData.userId,
      username: userData.username,
      avatar: userData.avatar,
      level: userData.level,
      rank: userData.rank,
      isAi: userData.isAi,
      isBanned: userData.isBanned,
      deletionAt: userData.deletionAt,
      isOutlaw: userData.isOutlaw,
      villageName: village.name,
    })
    .from(userData)
    .leftJoin(village, eq(village.id, userData.villageId))
    .where(inArray(userData.userId, userIds.length > 0 ? [...userIds] : [""]));

/**
 * Blacklist entries between `userId` and any of `others`, in either direction (who
 * blocked whom is not revealed to the caller).
 */
export const listKessenBlacklistBetween = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  others?: readonly string[],
) =>
  client
    .select({
      creatorUserId: userBlackList.creatorUserId,
      targetUserId: userBlackList.targetUserId,
    })
    .from(userBlackList)
    .where(
      or(
        and(
          eq(userBlackList.creatorUserId, userId),
          others ? inArray(userBlackList.targetUserId, [...others, ""]) : undefined,
        ),
        and(
          eq(userBlackList.targetUserId, userId),
          others ? inArray(userBlackList.creatorUserId, [...others, ""]) : undefined,
        ),
      ),
    );

/**
 * Marks pending challenges older than `before` EXPIRED, which frees their pair slot;
 * only those involving `userIds` when given (the cron passes none).
 */
export const updateUserRequestForExpireKessenChallenges = (
  client: Pick<DrizzleClient, "update">,
  before: Date,
  userIds?: readonly string[],
) =>
  client
    .update(userRequest)
    .set({ status: "EXPIRED" })
    .where(
      and(
        eq(userRequest.type, "KESSEN"),
        eq(userRequest.status, "PENDING"),
        lt(userRequest.createdAt, before),
        userIds
          ? or(
              inArray(userRequest.senderId, [...userIds, ""]),
              inArray(userRequest.receiverId, [...userIds, ""]),
            )
          : undefined,
      ),
    );

/** Queue rows that can still match or hold a claim, plus the caller's own row. */
export const listKessenRankedQueue = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  seenSince: Date,
) =>
  client
    .select()
    .from(kessenRankedQueue)
    .where(
      or(
        eq(kessenRankedQueue.userId, userId),
        gte(kessenRankedQueue.seenAt, seenSince),
        isNotNull(kessenRankedQueue.matchId),
      ),
    );

/** Players in the queue who polled since `seenSince`. */
export const countKessenRankedQueue = (
  client: Pick<DrizzleClient, "select">,
  seenSince: Date,
) =>
  client
    .select({ queued: count() })
    .from(kessenRankedQueue)
    .where(
      and(isNull(kessenRankedQueue.matchId), gte(kessenRankedQueue.seenAt, seenSince)),
    );

export const findKessenRankedQueueRow = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select()
    .from(kessenRankedQueue)
    .where(eq(kessenRankedQueue.userId, userId))
    .limit(1);

export const insertKessenRankedQueue = (
  client: Pick<DrizzleClient, "insert">,
  row: { userId: string; rating: number; deck: KessenDeckSource; now: Date },
) =>
  client.insert(kessenRankedQueue).values({
    userId: row.userId,
    rating: row.rating,
    deck: row.deck as unknown as Record<string, unknown>,
    queuedAt: row.now,
    seenAt: row.now,
  });

/** Records a queue poll. */
export const updateKessenRankedQueueSeen = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  now: Date,
) =>
  client
    .update(kessenRankedQueue)
    .set({ seenAt: now })
    .where(eq(kessenRankedQueue.userId, userId));

/**
 * The matchmaking claim: writes `matchId` into both players' rows only while neither
 * row holds a claim, in one statement (a self-join), so exactly one matcher pairs them.
 * Two affected rows means this caller won.
 */
export const updateKessenRankedQueueForClaim = (
  client: Pick<DrizzleClient, "execute">,
  input: { userIds: [string, string]; matchId: string; now: Date },
) => {
  const q = kessenRankedQueue;
  return client.execute(sql`
    UPDATE ${q} AS q1 JOIN ${q} AS q2 ON q1.userId = ${input.userIds[0]} AND q2.userId = ${input.userIds[1]}
    SET q1.matchId = ${input.matchId}, q1.matchedAt = ${input.now},
        q2.matchId = ${input.matchId}, q2.matchedAt = ${input.now}
    WHERE q1.matchId IS NULL AND q2.matchId IS NULL
  `);
};

/** Releases a claim whose match was never created, so both players can match again. */
export const updateKessenRankedQueueForRelease = (
  client: Pick<DrizzleClient, "update">,
  userIds: readonly string[],
  matchId: string,
) =>
  client
    .update(kessenRankedQueue)
    .set({ matchId: null, matchedAt: null })
    .where(
      and(
        inArray(kessenRankedQueue.userId, [...userIds, ""]),
        eq(kessenRankedQueue.matchId, matchId),
      ),
    );

/** Removes queue rows, optionally only those holding `matchId`. */
export const deleteKessenRankedQueueRows = (
  client: Pick<DrizzleClient, "delete">,
  userIds: readonly string[],
  matchId?: string,
) =>
  client
    .delete(kessenRankedQueue)
    .where(
      and(
        inArray(kessenRankedQueue.userId, [...userIds, ""]),
        matchId ? eq(kessenRankedQueue.matchId, matchId) : undefined,
      ),
    );

/** Leaves the queue unless matchmaking already claimed the row. */
export const deleteKessenRankedQueueForLeave = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client
    .delete(kessenRankedQueue)
    .where(
      and(eq(kessenRankedQueue.userId, userId), isNull(kessenRankedQueue.matchId)),
    );

/** Drops unclaimed rows of players who stopped polling before `before`. */
export const deleteStaleKessenRankedQueue = (
  client: Pick<DrizzleClient, "delete">,
  before: Date,
) =>
  client
    .delete(kessenRankedQueue)
    .where(
      and(isNull(kessenRankedQueue.matchId), lt(kessenRankedQueue.seenAt, before)),
    );

/** A rated seat of `updateKessenMatchForRatingClaim`. */
export interface RatingSeat {
  userId: string;
  /** Rating and rated matches the change was computed from. */
  before: number;
  played: number;
  delta: number;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
}
