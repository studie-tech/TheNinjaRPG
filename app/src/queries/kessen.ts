/**
 * Database access for Kessen: the card catalog, matches, decks, progress, packs and
 * payouts. Authorization and orchestration stay in callers.
 */
import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  KESSEN_DAILY_DROP_ROLLS,
  KESSEN_DAILY_REWARDED_MATCHES,
  KESSEN_PACK_ID_PREFIX,
} from "@/drizzle/constants";
import {
  badge,
  item,
  type KessenDeckCard,
  type KessenMatch,
  kessenDeck,
  kessenMatch,
  kessenNpcProgress,
  kessenProgress,
  title,
  userBadge,
  userData,
  userItem,
  userTitle,
  village,
} from "@/drizzle/schema";
import { KESSEN_ACADEMY_FIRST_LESSON } from "@/libs/kessen/academy";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { DrizzleClient } from "@/server/db";
import type { KessenFaction } from "@/validators/itemCard";
import type { KessenStoredMatch, KessenStoredPvpMatch } from "@/validators/kessen";
import type { QuestTrackerType } from "@/validators/objectives";

/** Card items with their display fields, optionally restricted to ids. */
export const listKessenCards = (
  client: Pick<DrizzleClient, "select">,
  ids?: readonly string[],
) =>
  client
    .select({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      image: item.image,
      description: item.description,
      itemType: item.itemType,
      cardData: item.cardData,
    })
    .from(item)
    .where(
      and(
        eq(item.itemType, "CARD"),
        ids ? inArray(item.id, ids.length > 0 ? [...ids] : [""]) : undefined,
      ),
    );

/** Card pack items with the weighted caches their odds are read from. */
export const listKessenPackItems = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      id: item.id,
      name: item.name,
      image: item.image,
      description: item.description,
      effects: item.effects,
    })
    .from(item)
    .where(like(item.id, `${KESSEN_PACK_ID_PREFIX}%`));

/** One NPC match of the player, with its stored state. */
export const findKessenMatch = (
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
        eq(kessenMatch.userId, userId),
        eq(kessenMatch.kind, "NPC"),
      ),
    )
    .limit(1);

/**
 * The player's ACTIVE NPC matches on the current rules, newest first, without their (large)
 * state: the mode and, as one JSON text, where the engine stands (round, phase, turn,
 * the player's pending mulligan and every finished round's winner). A match on a
 * retired engine version can no longer be played, so it neither counts as active nor
 * blocks a start; `rejectTurn` and the idle cron expire it.
 */
export const listActiveKessenMatches = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      id: kessenMatch.id,
      npcKey: kessenMatch.npcKey,
      version: kessenMatch.version,
      mode: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${kessenMatch.state}, '$.mode'))`,
      lesson: sql<
        string | null
      >`JSON_UNQUOTE(JSON_EXTRACT(${kessenMatch.state}, '$.lesson'))`,
      challengeQuestId: sql<
        string | null
      >`JSON_UNQUOTE(JSON_EXTRACT(${kessenMatch.state}, '$.challenge.questId'))`,
      challengeObjectiveId: sql<
        string | null
      >`JSON_UNQUOTE(JSON_EXTRACT(${kessenMatch.state}, '$.challenge.objectiveId'))`,
      standing: sql<string | null>`CAST(JSON_OBJECT(
        'round', JSON_EXTRACT(${kessenMatch.state}, '$.engine.round'),
        'phase', JSON_EXTRACT(${kessenMatch.state}, '$.engine.phase'),
        'turn', JSON_EXTRACT(${kessenMatch.state}, '$.engine.turn'),
        'mull', JSON_EXTRACT(${kessenMatch.state}, '$.engine.seats[0].mull'),
        'winners', JSON_EXTRACT(${kessenMatch.state}, '$.engine.history[*].winner')
      ) AS CHAR)`,
    })
    .from(kessenMatch)
    .where(
      and(
        eq(kessenMatch.userId, userId),
        eq(kessenMatch.kind, "NPC"),
        eq(kessenMatch.status, "ACTIVE"),
        eq(kessenMatch.engineVersion, CARD_ENGINE_VERSION),
      ),
    )
    .orderBy(desc(kessenMatch.startedAt));

/**
 * The player's finished matches that granted a first win, with the kind of their
 * first-win choice, its number of options and whether it is still unclaimed
 * (`claimedType` is `NULL`). A first win writes the match's `finishedAt` and the NPC
 * record's first-win time from one clock reading, so the join on them finds exactly
 * those matches; the choice is read only for the joined rows.
 */
export const listKessenFirstWinChoices = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      id: kessenMatch.id,
      npcKey: kessenMatch.npcKey,
      kind: sql<
        string | null
      >`JSON_UNQUOTE(JSON_EXTRACT(${kessenMatch.state}, '$.result.firstWin.choice.kind'))`,
      claimedType: sql<
        string | null
      >`JSON_TYPE(JSON_EXTRACT(${kessenMatch.state}, '$.result.firstWin.choice.claimed'))`,
      options: sql<
        number | null
      >`JSON_LENGTH(${kessenMatch.state}, '$.result.firstWin.choice.options')`.mapWith(
        Number,
      ),
    })
    .from(kessenMatch)
    .innerJoin(
      kessenNpcProgress,
      and(
        eq(kessenNpcProgress.userId, kessenMatch.userId),
        eq(kessenNpcProgress.npcKey, kessenMatch.npcKey),
        or(
          eq(kessenMatch.finishedAt, kessenNpcProgress.firstWinAt),
          eq(kessenMatch.finishedAt, kessenNpcProgress.ascendedFirstWinAt),
        ),
      ),
    )
    .where(and(eq(kessenMatch.userId, userId), eq(kessenMatch.status, "FINISHED")))
    .orderBy(desc(kessenMatch.finishedAt));

export const findKessenProgress = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select()
    .from(kessenProgress)
    .where(eq(kessenProgress.userId, userId))
    .limit(1);

/** The player's records against every NPC, or against one NPC. */
export const findKessenNpcProgressRows = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  npcKey?: string,
) =>
  client
    .select()
    .from(kessenNpcProgress)
    .where(
      and(
        eq(kessenNpcProgress.userId, userId),
        npcKey ? eq(kessenNpcProgress.npcKey, npcKey) : undefined,
      ),
    );

/**
 * Owned card copies per card, split by whether they are listed in the auction house.
 * Deck building excludes listed copies; sales, match rewards and pack dupe protection
 * count them.
 */
export const listOwnedKessenCardCounts = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      itemId: item.id,
      isInAuction: userItem.isInAuction,
      quantity: sql<number>`CAST(SUM(${userItem.quantity}) AS SIGNED)`.mapWith(Number),
    })
    .from(userItem)
    .innerJoin(item, eq(item.id, userItem.itemId))
    .where(and(eq(userItem.userId, userId), eq(item.itemType, "CARD")))
    .groupBy(item.id, userItem.isInAuction);

/** The player's unopened pack stacks outside the auction house, one row per stack. */
export const listKessenPackStacks = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      userItemId: userItem.id,
      itemId: userItem.itemId,
      name: item.name,
      quantity: userItem.quantity,
    })
    .from(userItem)
    .innerJoin(item, eq(item.id, userItem.itemId))
    .where(
      and(
        eq(userItem.userId, userId),
        like(userItem.itemId, `${KESSEN_PACK_ID_PREFIX}%`),
        eq(userItem.isInAuction, false),
        gt(userItem.quantity, 0),
      ),
    )
    .orderBy(userItem.id);

/** The player's saved decks, oldest first. */
export const listKessenDecks = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      id: kessenDeck.id,
      name: kessenDeck.name,
      leaderItemId: kessenDeck.leaderItemId,
      cards: kessenDeck.cards,
      updatedAt: kessenDeck.updatedAt,
    })
    .from(kessenDeck)
    .where(eq(kessenDeck.userId, userId))
    .orderBy(kessenDeck.createdAt);

export const findKessenDeck = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  deckId: string,
) =>
  client
    .select()
    .from(kessenDeck)
    .where(and(eq(kessenDeck.id, deckId), eq(kessenDeck.userId, userId)))
    .limit(1);

/** The number of a player's saved decks. */
export const countKessenDecks = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ decks: count() })
    .from(kessenDeck)
    .where(eq(kessenDeck.userId, userId));

export const insertKessenDeck = (
  client: Pick<DrizzleClient, "insert">,
  deck: {
    id: string;
    userId: string;
    name: string;
    leaderItemId: string;
    cards: KessenDeckCard[];
    createdAt: Date;
    updatedAt: Date;
  },
) => client.insert(kessenDeck).values(deck);

/** Rewrites one of the player's decks; no affected row when the player has no such deck. */
export const updateKessenDeck = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  deckId: string,
  deck: {
    name: string;
    leaderItemId: string;
    cards: KessenDeckCard[];
    updatedAt: Date;
  },
) =>
  client
    .update(kessenDeck)
    .set(deck)
    .where(and(eq(kessenDeck.id, deckId), eq(kessenDeck.userId, userId)));

/** Deletes one of the player's decks; no affected row when the player has no such deck. */
export const deleteKessenDeck = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  deckId: string,
) =>
  client
    .delete(kessenDeck)
    .where(and(eq(kessenDeck.id, deckId), eq(kessenDeck.userId, userId)));

/** The player's village name and outlaw flag, which decide the home faction. */
export const findKessenPlayer = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      userId: userData.userId,
      isOutlaw: userData.isOutlaw,
      villageName: village.name,
    })
    .from(userData)
    .leftJoin(village, eq(village.id, userData.villageId))
    .where(eq(userData.userId, userId))
    .limit(1);

/** A player's default progress row; the JSON columns have no column default. */
const kessenProgressDefaults = (userId: string) => ({
  userId,
  academy: {},
  seenKeywords: [],
  npcWinsToday: {},
});

/** Creates default progress rows for players who have none; existing rows are kept. */
export const insertKessenProgressRowsIfMissing = (
  client: Pick<DrizzleClient, "insert">,
  userIds: readonly string[],
) =>
  client
    .insert(kessenProgress)
    .values(userIds.map((userId) => kessenProgressDefaults(userId)))
    .onDuplicateKeyUpdate({ set: { userId: sql`${kessenProgress.userId}` } });

/** Creates the player's default progress row; an existing row is kept. */
export const insertKessenProgressIfMissing = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
) => insertKessenProgressRowsIfMissing(client, [userId]);

/** Sets the auto-sell toggle, creating the player's progress row when it is missing. */
export const upsertKessenProgressAutoSell = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  enabled: boolean,
) =>
  client
    .insert(kessenProgress)
    .values({ ...kessenProgressDefaults(userId), autoSellSurplus: enabled })
    .onDuplicateKeyUpdate({
      set: { autoSellSurplus: enabled, updatedAt: sql`CURRENT_TIMESTAMP(3)` },
    });

/**
 * The one-time starter claim: only a player who finished the first Academy lesson and
 * has not received a starter yet matches, so `rowsAffected` tells the caller whether
 * to grant.
 */
export const updateKessenProgressForChooseStarter = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  faction: KessenFaction,
) =>
  client
    .update(kessenProgress)
    .set({
      starterGranted: true,
      starterFaction: faction,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(kessenProgress.userId, userId),
        eq(kessenProgress.starterGranted, false),
        sql`JSON_CONTAINS_PATH(${kessenProgress.academy}, 'one', ${academyPath(KESSEN_ACADEMY_FIRST_LESSON)})`,
      ),
    );

/**
 * The pity reservation of one pack opening: writes the counters after the pack only
 * while the row still holds the counters the opening was planned from.
 */
export const updateKessenProgressForReservePackPity = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  expected: { packsSinceEpic: number; packsSinceLegendary: number },
  next: {
    packsSinceEpic: number;
    packsSinceLegendary: number;
    firstBundleOpened: boolean;
  },
) =>
  client
    .update(kessenProgress)
    .set({
      packsSinceEpic: next.packsSinceEpic,
      packsSinceLegendary: next.packsSinceLegendary,
      ...(next.firstBundleOpened ? { firstBundleOpened: true } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(kessenProgress.userId, userId),
        eq(kessenProgress.packsSinceEpic, expected.packsSinceEpic),
        eq(kessenProgress.packsSinceLegendary, expected.packsSinceLegendary),
      ),
    );

/** An item's id and name, for checking that items exist before a grant. */
export const listItemForKessenGrant = (
  client: Pick<DrizzleClient, "select">,
  ids: readonly string[],
) =>
  client
    .select({ id: item.id, name: item.name })
    .from(item)
    .where(inArray(item.id, ids.length > 0 ? [...ids] : [""]));

/** The item an inventory stack holds, for `openPack`. */
export const findUserItemForOpenPack = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  userItemId: string,
) =>
  client
    .select({ itemId: userItem.itemId, quantity: userItem.quantity })
    .from(userItem)
    .where(and(eq(userItem.id, userItemId), eq(userItem.userId, userId)))
    .limit(1);

/** Stores a new NPC match or duel. */
export const insertKessenMatch = (
  client: Pick<DrizzleClient, "insert">,
  row: Omit<KessenMatch, "state"> & { state: KessenStoredMatch | KessenStoredPvpMatch },
) =>
  client.insert(kessenMatch).values({
    ...row,
    state: row.state as unknown as Record<string, unknown>,
  });

/** Ends ACTIVE matches as unrewarded (concession or a replaced match). */
export const updateKessenMatchesForConcede = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  matchIds: string[],
  now: Date,
) =>
  client
    .update(kessenMatch)
    .set({
      status: "CONCEDED",
      version: sql`${kessenMatch.version} + 1`,
      updatedAt: now,
      finishedAt: now,
    })
    .where(
      and(
        eq(kessenMatch.userId, userId),
        inArray(kessenMatch.id, matchIds),
        eq(kessenMatch.status, "ACTIVE"),
      ),
    );

/**
 * The condition that a match is still ACTIVE at `version`, for writes that must land only
 * before the turn that ends the match does, such as a quest challenge's objective.
 */
export const kessenMatchIsActive = (
  client: Pick<DrizzleClient, "select">,
  match: { id: string; userId: string; version: number },
) =>
  exists(
    client
      .select({ id: kessenMatch.id })
      .from(kessenMatch)
      .where(
        and(
          eq(kessenMatch.id, match.id),
          eq(kessenMatch.userId, match.userId),
          eq(kessenMatch.version, match.version),
          eq(kessenMatch.status, "ACTIVE"),
        ),
      ),
  );

/**
 * The one write of an NPC turn or a duel decision (or of the clock forcing one): a CAS on
 * `version` of an ACTIVE match. An ending write sets the terminal status in the same
 * statement, so exactly one request ends (and pays) a match. Duels pass their turn
 * clock's `deadline`; NPC matches have none.
 */
export const updateKessenMatchForTurn = (
  client: Pick<DrizzleClient, "update">,
  match: { id: string; version: number },
  change: {
    state: KessenStoredMatch | KessenStoredPvpMatch;
    now: Date;
    deadline?: Date | null;
    status?: "FINISHED" | "CONCEDED" | "EXPIRED";
    rewarded?: boolean;
  },
) =>
  client
    .update(kessenMatch)
    .set({
      state: change.state as unknown as Record<string, unknown>,
      version: match.version + 1,
      updatedAt: change.now,
      ...(change.deadline !== undefined ? { turnDeadline: change.deadline } : {}),
      ...(change.status ? { status: change.status, finishedAt: change.now } : {}),
      ...(change.rewarded !== undefined ? { rewarded: change.rewarded } : {}),
    })
    .where(
      and(
        eq(kessenMatch.id, match.id),
        eq(kessenMatch.version, match.version),
        eq(kessenMatch.status, "ACTIVE"),
      ),
    );

/**
 * Rewrites the stored result of a finished match (its settled payout, a first-win pick);
 * CAS on version.
 */
export const updateKessenMatchResult = (
  client: Pick<DrizzleClient, "update">,
  match: { id: string; userId: string; version: number },
  change: { state: KessenStoredMatch; rewarded: boolean; now: Date },
) =>
  client
    .update(kessenMatch)
    .set({
      state: change.state as unknown as Record<string, unknown>,
      rewarded: change.rewarded,
      version: match.version + 1,
      updatedAt: change.now,
    })
    .where(
      and(
        eq(kessenMatch.id, match.id),
        eq(kessenMatch.userId, match.userId),
        eq(kessenMatch.version, match.version),
        eq(kessenMatch.status, "FINISHED"),
      ),
    );

/**
 * NPC matches idle since `before` become EXPIRED (unrewarded); `version` moves on. Duels
 * end through their turn clock instead.
 */
export const updateIdleKessenMatchesForExpiry = (
  client: Pick<DrizzleClient, "update">,
  before: Date,
  now: Date,
) =>
  client
    .update(kessenMatch)
    .set({
      status: "EXPIRED",
      version: sql`${kessenMatch.version} + 1`,
      updatedAt: now,
      finishedAt: now,
    })
    .where(
      and(
        eq(kessenMatch.status, "ACTIVE"),
        eq(kessenMatch.kind, "NPC"),
        lt(kessenMatch.updatedAt, before),
      ),
    );

/** One ACTIVE match becomes EXPIRED (its rules version is gone); CAS on version. */
export const updateKessenMatchForExpiry = (
  client: Pick<DrizzleClient, "update">,
  match: { id: string; version: number },
  now: Date,
) =>
  client
    .update(kessenMatch)
    .set({
      status: "EXPIRED",
      version: match.version + 1,
      updatedAt: now,
      finishedAt: now,
    })
    .where(
      and(
        eq(kessenMatch.id, match.id),
        eq(kessenMatch.version, match.version),
        eq(kessenMatch.status, "ACTIVE"),
      ),
    );

/**
 * Counts one rewarded match against the daily caps and is the reward's claim: it fails
 * (no row) once a cap it relies on is used up, for a day the counters already left, when
 * it claims the weekly first-win pack and the week already counts a rewarded win, or
 * when this match claimed it before (`rewardedMatchId` names the match that claimed
 * last). Day and week keys reset the counters. Raw SQL because MySQL evaluates SET
 * assignments left to right and the resets must read `dayKey` and `weekKey` before they
 * are overwritten; Drizzle orders SET by column.
 */
export const updateKessenProgressForRewardedMatch = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    matchId: string;
    userId: string;
    dayKey: string;
    weekKey: string;
    npcKey: string;
    win: boolean;
    dropRoll: boolean;
    weeklyFirstWin: boolean;
    seenKeywords: string[];
  },
) => {
  const p = kessenProgress;
  const day = input.dayKey;
  const drop = input.dropRoll ? 1 : 0;
  const win = input.win ? 1 : 0;
  const path = `$."${input.npcKey}"`;
  return client.execute(sql`
    UPDATE ${p}
    SET ${p.rewardedToday} = IF(${p.dayKey} = ${day}, ${p.rewardedToday} + 1, 1),
        ${p.dropsToday} = IF(${p.dayKey} = ${day}, ${p.dropsToday} + ${drop}, ${drop}),
        ${p.npcWinsToday} = ${
          input.win
            ? sql`IF(${p.dayKey} = ${day},
                JSON_SET(${p.npcWinsToday}, ${path},
                  COALESCE(JSON_EXTRACT(${p.npcWinsToday}, ${path}), 0) + 1),
                JSON_OBJECT(${input.npcKey}, 1))`
            : sql`IF(${p.dayKey} = ${day}, ${p.npcWinsToday}, JSON_OBJECT())`
        },
        ${p.weeklyWins} = IF(${p.weekKey} = ${input.weekKey}, ${p.weeklyWins} + ${win}, ${win}),
        ${p.weekKey} = ${input.weekKey},
        ${p.seenKeywords} = CAST(${JSON.stringify(input.seenKeywords)} AS JSON),
        ${p.rewardedMatchId} = ${input.matchId},
        ${p.dayKey} = ${day}
    WHERE ${p.userId} = ${input.userId}
      AND ${p.dayKey} <= ${day}
      AND (${p.rewardedMatchId} IS NULL OR ${p.rewardedMatchId} <> ${input.matchId})
      AND (${p.dayKey} <> ${day} OR ${p.rewardedToday} < ${KESSEN_DAILY_REWARDED_MATCHES})
      ${input.dropRoll ? sql`AND (${p.dayKey} <> ${day} OR ${p.dropsToday} < ${KESSEN_DAILY_DROP_ROLLS})` : sql``}
      ${input.weeklyFirstWin ? sql`AND (${p.weekKey} <> ${input.weekKey} OR ${p.weeklyWins} = 0)` : sql``}
  `);
};

/** Records the keywords a finished match revealed; unrewarded matches still teach. */
export const updateKessenProgressSeenKeywords = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  seenKeywords: string[],
) =>
  client
    .update(kessenProgress)
    .set({ seenKeywords })
    .where(eq(kessenProgress.userId, userId));

/**
 * Records the first completion of an Academy lesson under the match that completed it;
 * one affected row is the claim of the lesson's reward. A lesson already completed
 * leaves the row untouched.
 */
export const updateKessenProgressForAcademyLesson = (
  client: Pick<DrizzleClient, "update">,
  input: { userId: string; lesson: string; matchId: string; seenKeywords: string[] },
) => {
  const path = academyPath(input.lesson);
  return client
    .update(kessenProgress)
    .set({
      academy: sql`JSON_SET(${kessenProgress.academy}, ${path}, ${input.matchId})`,
      seenKeywords: input.seenKeywords,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(kessenProgress.userId, input.userId),
        sql`JSON_EXTRACT(${kessenProgress.academy}, ${path}) IS NULL`,
      ),
    );
};

/**
 * Claims the Academy's graduation pack for `matchId`: only a player who has completed
 * every listed lesson and has no graduation yet matches.
 */
export const updateKessenProgressForAcademyGraduation = (
  client: Pick<DrizzleClient, "update">,
  input: { userId: string; matchId: string; lessons: readonly string[] },
) =>
  client
    .update(kessenProgress)
    .set({ academyGraduatedMatchId: input.matchId })
    .where(
      and(
        eq(kessenProgress.userId, input.userId),
        isNull(kessenProgress.academyGraduatedMatchId),
        sql`JSON_CONTAINS_PATH(${kessenProgress.academy}, 'all', ${sql.join(
          input.lessons.map((lesson) => sql`${academyPath(lesson)}`),
          sql`, `,
        )})`,
      ),
    );

/** JSON path of a lesson key in `KessenProgress.academy`. */
const academyPath = (lesson: string) => `$."${lesson}"`;

/**
 * Records a standard win. The row is created by the first standard win only (Ascended
 * rematches open after it), so an insert (one affected row) is the first-win claim.
 * `now` is the match's finish time: a win already recorded at that time (the same
 * match settling again) is not counted twice.
 */
export const upsertKessenNpcProgressForStandardWin = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  npcKey: string,
  now: Date,
) =>
  client
    .insert(kessenNpcProgress)
    .values({ userId, npcKey, wins: 1, firstWinAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({
      set: {
        wins: sql`IF(${kessenNpcProgress.updatedAt} = ${sql.param(now, kessenNpcProgress.updatedAt)}, ${kessenNpcProgress.wins}, ${kessenNpcProgress.wins} + 1)`,
        updatedAt: now,
      },
    });

/**
 * Claims the first Ascended win at the match's finish time; no affected row means it
 * was claimed before. It leaves `updatedAt` to the win count.
 */
export const updateKessenNpcProgressForAscendedFirstWin = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  npcKey: string,
  now: Date,
) =>
  client
    .update(kessenNpcProgress)
    .set({ ascendedFirstWinAt: now })
    .where(
      and(
        eq(kessenNpcProgress.userId, userId),
        eq(kessenNpcProgress.npcKey, npcKey),
        isNull(kessenNpcProgress.ascendedFirstWinAt),
      ),
    );

/**
 * Counts an Ascended win on the NPC's record at the match's finish time, once: a win
 * already recorded at that time is the same match settling again.
 */
export const updateKessenNpcProgressForWin = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  npcKey: string,
  now: Date,
) =>
  client
    .update(kessenNpcProgress)
    .set({ wins: sql`${kessenNpcProgress.wins} + 1`, updatedAt: now })
    .where(
      and(
        eq(kessenNpcProgress.userId, userId),
        eq(kessenNpcProgress.npcKey, npcKey),
        ne(kessenNpcProgress.updatedAt, now),
      ),
    );

/** Pays match ryo as a SQL increment, with the quest trackers a win advanced. */
export const updateUserDataForKessenPayout = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  ryo: number,
  questData: QuestTrackerType[] | undefined,
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${ryo}`,
      ...(questData ? { questData } : {}),
    })
    .where(eq(userData.userId, userId));

/** Badges granted by first wins, by name, that the player does not hold yet. */
export const listKessenRewardBadges = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  names: string[],
) =>
  client
    .select({ id: badge.id, name: badge.name, image: badge.image })
    .from(badge)
    .leftJoin(
      userBadge,
      and(eq(userBadge.badgeId, badge.id), eq(userBadge.userId, userId)),
    )
    .where(and(inArray(badge.name, names), isNull(userBadge.userId)));

/** Titles granted by first wins, by name, that the player does not hold yet. */
export const listKessenRewardTitles = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  names: string[],
) =>
  client
    .select({ id: title.id })
    .from(title)
    .leftJoin(
      userTitle,
      and(eq(userTitle.titleId, title.id), eq(userTitle.userId, userId)),
    )
    .where(
      and(
        inArray(title.name, names),
        eq(title.archived, false),
        isNull(userTitle.userId),
      ),
    );
