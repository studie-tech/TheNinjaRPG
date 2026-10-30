import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  JUTSU_LEVEL_CAP,
  QUEUE_WAITING_SLOTS,
  type QueueKind,
  type TimedQueueKind,
  TimedQueueKinds,
} from "@/drizzle/constants";
import {
  type GameSetting,
  type Item,
  item,
  type Jutsu,
  type UserData,
  type UserQueue,
  userData,
  type userItem,
  userQueue,
} from "@/drizzle/schema";
import {
  countsTowardInventoryStorage,
  getInventoryBucket,
  getInventoryBucketCapacity,
} from "@/libs/item";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import { boostPvpGain, getPvpBoost } from "@/libs/pvpExperience";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  getNextQueueSchedule,
  getQueuedJobStart,
  isOrderedSubsequence,
  latestDate,
  rescheduleQueue,
} from "@/libs/queue";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import {
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  checkJutsuBloodline,
  checkJutsuVillage,
  masteryTrainingFields,
} from "@/libs/train";
import { insertUserItems } from "@/queries/item";
import { debitUserMoney, incrementUserMoney } from "@/queries/profile";
import { fetchStudents } from "@/queries/sensei";
import {
  deleteDeadQueueRows,
  deleteUserQueueForClaimQueueRow,
  findUserDataForFetchQuestUser,
  insertUserCookingJobForStartQueuedCraft,
  insertUserItemForReturnMaterials,
  insertUserJutsuForStartQueuedJutsu,
  insertUserQueueRows,
  listUserQueueForFetchCraftingQueue,
  listUserQueueForFetchJutsuTrainingQueue,
  selectUserItemForSettleCrafts,
  selectUserItemForSettleWaitingJobs,
  selectUserJutsuForSettleJutsus,
  selectUserJutsuForSettleWaitingJobs,
  selectUserQueueForAppendQueueEntries,
  selectUserQueueForFetchQueuedJutsuIds,
  updateUserDataForSettleWaitingJobs,
  updateUserDataForUpdateQueueOwner,
  updateUserDataForUpdateQueueOwner2,
  updateUserItemForMerge,
  updateUserJutsuForStartQueuedJutsu,
  updateUserQueueForRescheduleWaiting,
} from "@/queries/train";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { getQueueTotalCapacity } from "@/utils/paypal";
import type {
  CraftingQueueMaterial,
  EnergyTrainingQueueEntry,
  MasteryTrainingQueueEntry,
} from "@/validators/train";

/**
 * Every queue lives in `UserQueue`. Queues are settled lazily, when their owner's data is
 * read. Single-row changes use guarded statements; publishing a replacement or starting
 * a timed job uses a short transaction to commit its rows and owner state together.
 *
 * - JUTSU and CRAFT jobs are timed. A waiting job has already paid (ryo, materials).
 *   When its turn comes, deleting its row claims it, and it is started as a direct start
 *   would be, backdated to the moment its predecessor finished, so the outcome does not
 *   depend on when settlement runs.
 * - MASTERY, ELEMENT and ENERGY entries are settled in memory (`settleQueuedTraining`) and
 *   consumed by advancing the user's queue head in the same write as the gains.
 *
 * `fetchUpdatedUser` and combat setup load the rows with the user in the same query, so
 * users without rows pay no extra query, and timed jobs only cost writes when one is due.
 */

type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
type QueueClient = DrizzleClient | Transaction;

type JobOutcome = { finishesAt: Date } | "dropped" | "conflict";

/** A waiting jutsu level with its JUTSU columns narrowed. */
export type QueuedJutsu = Omit<
  UserQueue,
  "jutsuId" | "reservedRyo" | "durationSeconds" | "startsAt" | "finishesAt"
> & {
  jutsuId: string;
  reservedRyo: number;
  durationSeconds: number;
  startsAt: Date;
  finishesAt: Date;
  jutsu: Jutsu | null;
};

/** A waiting craft with its CRAFT columns narrowed. */
export type QueuedCraft = Omit<
  UserQueue,
  "itemId" | "quantity" | "materials" | "durationSeconds" | "startsAt" | "finishesAt"
> & {
  itemId: string;
  quantity: number;
  materials: CraftingQueueMaterial[];
  durationSeconds: number;
  startsAt: Date;
  finishesAt: Date;
  item: Item | null;
};

/** Columns of a new entry; id, owner and position are filled in on insert. */
export type QueueEntryInsert = Omit<
  typeof userQueue.$inferInsert,
  "id" | "userId" | "kind" | "position"
>;

/** Timed rows keep their timestamps; a row missing them is treated as due now. */
const timed = (row: UserQueue) => {
  const startsAt = row.startsAt ?? row.createdAt;
  const durationSeconds = row.durationSeconds ?? 0;
  return {
    durationSeconds,
    startsAt,
    finishesAt: row.finishesAt ?? new Date(startsAt.getTime() + durationSeconds * 1000),
  };
};

/** Narrow a JUTSU row; one missing its columns finds no jutsu and is refunded. */
export const toQueuedJutsu = (
  row: UserQueue & { jutsu: Jutsu | null },
): QueuedJutsu => ({
  ...row,
  ...timed(row),
  jutsuId: row.jutsuId ?? "",
  reservedRyo: row.reservedRyo ?? 0,
});

/** Narrow a CRAFT row; one missing its columns finds no item and returns its materials. */
export const toQueuedCraft = (row: UserQueue & { item: Item | null }): QueuedCraft => ({
  ...row,
  ...timed(row),
  itemId: row.itemId ?? "",
  quantity: row.quantity ?? 0,
  materials: row.materials ?? [],
});

/** Waiting jutsu levels in queue order. */
export const fetchJutsuTrainingQueue = async (client: DrizzleClient, userId: string) =>
  (await listUserQueueForFetchJutsuTrainingQueue(client, userId)).map(toQueuedJutsu);

/** Waiting crafts in queue order. */
export const fetchCraftingQueue = async (client: DrizzleClient, userId: string) =>
  (await listUserQueueForFetchCraftingQueue(client, userId)).map(toQueuedCraft);

/** Jutsu ids with levels waiting in the user's queue. */
export const fetchQueuedJutsuIds = async (client: DrizzleClient, userId: string) => {
  const rows = await selectUserQueueForFetchQueuedJutsuIds(client, userId);
  return new Set(rows.flatMap((row) => (row.jutsuId ? [row.jutsuId] : [])));
};

/** Whether another job may be added behind the active one. */
export const hasQueueRoom = (
  user: Parameters<typeof getQueueTotalCapacity>[0],
  waiting: number,
) => 1 + waiting < getQueueTotalCapacity(user);

/** Most levels of one jutsu a single request can buy: the active slot plus every waiting one. */
export const MAX_JUTSU_LEVELS_PER_REQUEST =
  1 + Math.max(...Object.values(QUEUE_WAITING_SLOTS));

/** Whether a JUTSU or CRAFT row among `rows` is due to start. */
export const hasDueTimedJob = (
  rows: readonly Pick<UserQueue, "kind" | "startsAt">[],
  now = new Date(),
) =>
  rows.some(
    (row) =>
      (TimedQueueKinds as readonly QueueKind[]).includes(row.kind) &&
      (!row.startsAt || row.startsAt <= now),
  );

/**
 * Append entries to one queue, after its last position, in one statement. The unique
 * (user, kind, position) index makes concurrent appends from the same read collide, so
 * at most one wins. Pass `lastPosition` when the rows were just read to skip reading it.
 */
export const appendQueueEntries = async (
  client: DrizzleClient,
  userId: string,
  kind: TimedQueueKind,
  entries: QueueEntryInsert[],
  lastPosition?: number,
) => {
  if (entries.length === 0) return [];
  let last = lastPosition;
  if (last === undefined) {
    const [row] = await selectUserQueueForAppendQueueEntries(client, userId, kind);
    last = Number(row?.position ?? 0);
  }
  const rows = queueRows(userId, kind, last, entries);
  await insertUserQueueRows(client, rows);
  return rows;
};

/** The last position used by a queue among `rows`, or 0. */
export const lastQueuePosition = (
  rows: readonly Pick<UserQueue, "kind" | "position">[],
  kind: QueueKind,
) =>
  rows.reduce(
    (last, row) => (row.kind === kind ? Math.max(last, row.position) : last),
    0,
  );

/** New queue rows for `entries`, at positions after `after`. */
const queueRows = (
  userId: string,
  kind: QueueKind,
  after: number,
  entries: readonly QueueEntryInsert[],
): UserQueue[] => {
  const createdAt = new Date();
  return entries.map((entry, index) => ({
    jutsuId: null,
    itemId: null,
    stat: null,
    speed: null,
    energy: null,
    reservedRyo: null,
    quantity: null,
    materials: null,
    durationSeconds: null,
    startsAt: null,
    finishesAt: null,
    createdAt,
    ...entry,
    id: nanoid(),
    userId,
    kind,
    position: after + index + 1,
  }));
};

/**
 * Publish replacement rows and the head together. The snapshot guards the edit, while
 * the transaction prevents readers seeing a new head with missing replacement rows
 * and rolls the head back if insertion fails. Retired rows are removed in the same write.
 */
export const claimAndReplaceTrainingQueue = async ({
  client,
  user,
  kind,
  entries,
  where = [],
}: {
  client: DrizzleClient;
  user: Pick<
    UserData,
    | "userId"
    | "updatedAt"
    | "energyQueueHead"
    | "energyQueueTail"
    | "masteryQueueHead"
    | "elementalQueueHead"
  > & { queue: readonly UserQueue[] };
  kind: "MASTERY" | "ELEMENT" | "ENERGY";
  entries: readonly (EnergyTrainingQueueEntry | MasteryTrainingQueueEntry)[];
  where?: Parameters<typeof claimUserSnapshot>[0]["where"];
}) => {
  const existing = user.queue.filter((row) => row.kind === kind);
  const head = Math.max(
    kind === "ENERGY" ? user.energyQueueHead : user[masteryTrainingFields[kind].head],
    kind === "ENERGY" ? user.energyQueueTail : 0,
    lastQueuePosition(existing, kind),
  );
  const heads =
    kind === "ENERGY"
      ? { energyQueueHead: head, energyQueueTail: head + entries.length }
      : { [masteryTrainingFields[kind].head]: head };
  const rows = queueRows(user.userId, kind, head, entries);
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const claim = await claimUserSnapshot({
        client: tx,
        userId: user.userId,
        updatedAt: user.updatedAt,
        where,
        set: heads,
      });
      if (!claim.success) return null;
      if (rows.length) await insertUserQueueRows(tx, rows);
      if (existing.length) await deleteDeadQueueRows(tx, user.userId, kind, head);
      return {
        updatedAt: claim.claimedAt,
        ...heads,
        queue: [...user.queue.filter((row) => row.kind !== kind), ...rows],
      };
    }),
  );
};

/**
 * The one edit path for MASTERY, ELEMENT and ENERGY queues: the client sends the queue it saw
 * (`expected`) and the queue it wants (`entries`). A stale view is rejected. Pure removals
 * (entries kept in order) are always allowed; anything that adds or changes an entry
 * runs the kind's `validate` first.
 */
export const editTrainingQueue = async <
  T extends EnergyTrainingQueueEntry | MasteryTrainingQueueEntry,
>({
  client,
  user,
  kind,
  current,
  expected,
  entries,
  validate,
  where,
  messages,
}: {
  client: DrizzleClient;
  user: Parameters<typeof claimAndReplaceTrainingQueue>[0]["user"];
  kind: "MASTERY" | "ELEMENT" | "ENERGY";
  current: readonly T[];
  expected: readonly T[];
  entries: readonly T[];
  /** Checks for adding or changing entries; returns an error message or null */
  validate: () => string | null | Promise<string | null>;
  where?: Parameters<typeof claimUserSnapshot>[0]["where"];
  messages: { stale: string; conflict: string; saved: string; cleared: string };
}) => {
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    return { success: false as const, message: messages.stale };
  }
  if (!isOrderedSubsequence(entries, current)) {
    const error = await validate();
    if (error) return { success: false as const, message: error };
  }
  const saved = await claimAndReplaceTrainingQueue({
    client,
    user,
    kind,
    entries,
    where,
  });
  if (!saved) return { success: false as const, message: messages.conflict };
  return {
    success: true as const,
    message: entries.length ? messages.saved : messages.cleared,
    saved,
  };
};

/**
 * Price and schedule `count` successive levels of one jutsu, starting at `fromLevel` (the
 * level the first queued entry trains from) and running back to back after
 * `previousFinish`. Each level is priced and timed for the level it will be at.
 */
export const planJutsuLevels = ({
  info,
  user,
  students,
  fromLevel,
  count,
  previousFinish,
  now = new Date(),
}: {
  info: Jutsu;
  user: UserData;
  students: UserData[];
  fromLevel: number;
  count: number;
  previousFinish: Date | null | undefined;
  now?: Date;
}) => {
  const entries: {
    level: number;
    reservedRyo: number;
    durationSeconds: number;
    startsAt: Date;
    finishesAt: Date;
  }[] = [];
  let cursor = previousFinish;
  for (let i = 0; i < count; i++) {
    const level = fromLevel + i;
    const durationSeconds = Math.ceil(calcJutsuTrainTime(info, level, user) / 1000);
    const schedule = getNextQueueSchedule(durationSeconds, cursor, now);
    entries.push({
      level,
      reservedRyo: calcJutsuTrainCost(info, level, user, students),
      durationSeconds,
      ...schedule,
    });
    cursor = schedule.finishesAt;
  }
  return entries;
};

/**
 * Reserve the ryo for planned levels and insert them as waiting rows. The guarded debit
 * fails without enough ryo; the insert fails when a concurrent enqueue took the same
 * positions, and the ryo is then refunded. `user.queue` holds the rows just read.
 */
export const enqueueJutsuLevels = async (
  client: DrizzleClient,
  user: Parameters<typeof getQueueTotalCapacity>[0] & {
    userId: string;
    queue: readonly UserQueue[];
  },
  jutsuId: string,
  entries: ReturnType<typeof planJutsuLevels>,
): Promise<{ success: true; cost: number } | { success: false; message: string }> => {
  if (entries.length === 0) return { success: true, cost: 0 };
  const waiting = user.queue.filter((row) => row.kind === "JUTSU");
  if (waiting.length + entries.length > getQueueTotalCapacity(user) - 1) {
    return { success: false, message: "Your jutsu training queue is full" };
  }
  const cost = entries.reduce((sum, entry) => sum + entry.reservedRyo, 0);
  const reserved = await debitUserMoney(client, cost, user);
  if (reserved.rowsAffected !== 1) {
    return { success: false, message: "You don't have enough money" };
  }
  try {
    await appendQueueEntries(
      client,
      user.userId,
      "JUTSU",
      entries.map((entry) => ({
        jutsuId,
        reservedRyo: entry.reservedRyo,
        durationSeconds: entry.durationSeconds,
        startsAt: entry.startsAt,
        finishesAt: entry.finishesAt,
      })),
      lastQueuePosition(waiting, "JUTSU"),
    );
  } catch (error) {
    await refundRyo(client, user.userId, cost);
    if (isMysqlDuplicateKeyError(error)) {
      return {
        success: false,
        message: "Your jutsu training queue changed. Please try again",
      };
    }
    throw error;
  }
  return { success: true, cost };
};

/**
 * Start every waiting jutsu level whose turn has come. The queue, the running training
 * and (when a level may start) the sensei data are read in one parallel round trip;
 * pass `waiting` when the rows were just read to skip reading them again.
 */
const settleJutsus = async (
  client: DrizzleClient,
  userId: string,
  now: Date,
  preloaded?: QueuedJutsu[],
) => {
  const mayStart = !preloaded || hasDueTimedJob(preloaded, now);
  const [waiting, owned, students] = await Promise.all([
    preloaded ?? fetchJutsuTrainingQueue(client, userId),
    selectUserJutsuForSettleJutsus(client, userId),
    mayStart ? fetchStudents(client, userId) : undefined,
  ]);
  if (waiting.length === 0) return 0;
  let sensei = students;
  return settleWaitingJobs({
    client,
    userId,
    kind: "JUTSU",
    waiting,
    now,
    lastFinish: latestDate(owned.map((row) => row.finishTraining)),
    start: async (tx, entry, startsAt) => {
      sensei ??= await fetchStudents(client, userId);
      return startQueuedJutsu(tx, entry, startsAt, sensei);
    },
  });
};

/** Start every waiting craft whose turn has come. Returns how many started. */
const settleCrafts = async (
  client: DrizzleClient,
  userId: string,
  now: Date,
  preloaded?: QueuedCraft[],
) => {
  const [waiting, crafting, average] = await Promise.all([
    preloaded ?? fetchCraftingQueue(client, userId),
    selectUserItemForSettleCrafts(client, userId),
    // PlanetScale transaction sessions cannot execute concurrent reads.
    fetchPvpExperienceAverage(client),
  ]);
  if (waiting.length === 0) return 0;
  return settleWaitingJobs({
    client,
    userId,
    kind: "CRAFT",
    waiting,
    now,
    lastFinish: latestDate(crafting.map((row) => row.craftingFinishedAt)),
    start: (tx, entry, startsAt) => startQueuedCraft(tx, entry, startsAt, average),
  });
};

/**
 * Start every waiting job of one timed kind whose turn has come and move the rest behind
 * the job now running. Returns how many started. Also run right after an event that ends
 * the active job early (stop, instant finish, cancellation), so the next job starts now
 * rather than in the old slot. Pass the rows when they were just read.
 */
export const settleTimedQueue = (
  client: DrizzleClient,
  userId: string,
  kind: TimedQueueKind,
  now = new Date(),
  preloaded?: QueuedJutsu[] | QueuedCraft[],
) =>
  kind === "JUTSU"
    ? settleJutsus(client, userId, now, preloaded as QueuedJutsu[] | undefined)
    : settleCrafts(client, userId, now, preloaded as QueuedCraft[] | undefined);

export const settleJutsuTrainingQueue = (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
  preloaded?: QueuedJutsu[],
) => settleJutsus(client, userId, now, preloaded);

export const settleCraftingQueue = (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
  preloaded?: QueuedCraft[],
) => settleCrafts(client, userId, now, preloaded);

/**
 * Settle the timed queues of every user whose loaded rows hold a due job. Users run in
 * parallel; the kinds of one user run in sequence (both may write its questData).
 * Returns how many jobs started.
 */
export const settleDueTimedQueues = async (
  client: DrizzleClient,
  users: readonly { userId: string; queue?: readonly UserQueue[] | null }[],
  now = new Date(),
) => {
  const started = await Promise.all(
    users.map(async (user) => {
      let count = 0;
      for (const kind of TimedQueueKinds) {
        const rows = (user.queue ?? []).filter((row) => row.kind === kind);
        if (hasDueTimedJob(rows, now)) {
          count += await settleTimedQueue(client, user.userId, kind, now);
        }
      }
      return count;
    }),
  );
  return started.reduce((sum, count) => sum + count, 0);
};

/**
 * Cancel a waiting timed job: deleting its row claims it, so a concurrent cancellation
 * or start cannot also win it; then its ryo (JUTSU) or materials (CRAFT) are returned,
 * and the rest move up. Returns the cancelled row and how many jobs started, or null
 * when it already started.
 */
export const cancelQueuedJob = async (
  client: DrizzleClient,
  userId: string,
  kind: TimedQueueKind,
  queueId: string,
  preloaded?: (QueuedJutsu | QueuedCraft)[],
) => {
  const waiting: (QueuedJutsu | QueuedCraft)[] =
    preloaded ??
    (kind === "JUTSU"
      ? await fetchJutsuTrainingQueue(client, userId)
      : await fetchCraftingQueue(client, userId));
  const entry = waiting.find((row) => row.id === queueId);
  if (!entry) return null;
  if (!(await claimQueueRow(client, entry.id))) return null;
  if (entry.kind === "JUTSU") {
    await refundRyo(client, userId, entry.reservedRyo ?? 0);
  } else {
    await returnMaterials(client, userId, entry.materials ?? []);
  }
  const rest = waiting.filter((row) => row.id !== entry.id);
  const started = rest.length
    ? await settleTimedQueue(
        client,
        userId,
        kind,
        new Date(),
        rest as QueuedJutsu[] | QueuedCraft[],
      )
    : 0;
  return { entry, started, remaining: rest.length };
};

/**
 * Cancel a waiting jutsu level. Returns the refunded ryo and how many queued levels
 * started right after, or null.
 */
export const cancelQueuedJutsuTraining = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const cancelled = await cancelQueuedJob(client, userId, "JUTSU", queueId);
  return cancelled
    ? { refunded: cancelled.entry.reservedRyo ?? 0, started: cancelled.started }
    : null;
};

/** Cancel a waiting craft and return its materials. */
export const cancelQueuedCraft = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
  preloaded?: QueuedCraft[],
) => cancelQueuedJob(client, userId, "CRAFT", queueId, preloaded);

/**
 * Walk the waiting jobs in order: start each whose turn has come, then move the rest
 * so they follow the job that is now running.
 */
const settleWaitingJobs = async <
  T extends { id: string; startsAt: Date; finishesAt: Date; durationSeconds: number },
>(props: {
  client: DrizzleClient;
  userId: string;
  kind: TimedQueueKind;
  waiting: T[];
  now: Date;
  lastFinish: Date | null;
  start: (client: Transaction, entry: T, startsAt: Date) => Promise<JobOutcome>;
}) => {
  const { client, userId, kind, waiting, now, start } = props;
  if (props.lastFinish && props.lastFinish > now) {
    await rescheduleWaiting(client, waiting, props.lastFinish);
    return 0;
  }
  // Different queue rows must not start in parallel. Lock the existing owner row,
  // then read the active deadline: the upfront reads can come from different snapshots.
  // MySQL cannot DELETE a queue receipt, INSERT outputs and UPDATE its owner/job
  // in one statement. A failed reward write must retain the prepaid receipt for retry.
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      await updateUserDataForSettleWaitingJobs(tx, userId);
      const deadlines =
        kind === "JUTSU"
          ? await selectUserJutsuForSettleWaitingJobs(tx, userId)
          : await selectUserItemForSettleWaitingJobs(tx, userId);
      const lastFinish = latestDate(deadlines.map((row) => row.finish));
      let chainedFinish: Date | null = null;
      let started = 0;
      for (const [index, entry] of waiting.entries()) {
        const startsAt = getQueuedJobStart({
          scheduledStart: entry.startsAt,
          lastFinish,
          chainedFinish,
          now,
        });
        if (!startsAt) {
          await rescheduleWaiting(
            tx,
            waiting.slice(index),
            chainedFinish ?? lastFinish ?? now,
          );
          break;
        }
        const outcome = await start(tx, entry, startsAt);
        if (outcome === "conflict") break;
        if (outcome === "dropped") {
          chainedFinish = startsAt;
          continue;
        }
        chainedFinish = outcome.finishesAt;
        started++;
      }
      return started;
    }),
  );
};

const rescheduleWaiting = async (
  client: QueueClient,
  entries: { id: string; startsAt: Date; finishesAt: Date; durationSeconds: number }[],
  startsAt: Date,
) => {
  const moved = rescheduleQueue(entries, startsAt).filter(
    ({ entry, startsAt: next }) => entry.startsAt.getTime() !== next.getTime(),
  );
  if (moved.length === 0) return;
  // One statement works on a single-session transaction and keeps the round-trip
  // count independent of queue length. Encode dates as the datetime columns do.
  const scheduleCase = (column: "startsAt" | "finishesAt") =>
    sql`CASE ${userQueue.id} ${sql.join(
      moved.map(
        (schedule) =>
          sql`WHEN ${schedule.entry.id} THEN ${sql.param(schedule[column], userQueue[column])}`,
      ),
      sql` `,
    )} END`;
  await updateUserQueueForRescheduleWaiting(client, scheduleCase, moved);
};

/**
 * Start a queued jutsu level as `jutsu.startTraining` would, except the ryo was paid on
 * enqueue. Price and duration use the level reached by then; ryo above the current price
 * is refunded. A level that can no longer be trained is dropped with a full refund.
 */
const startQueuedJutsu = async (
  client: Transaction,
  entry: QueuedJutsu,
  startsAt: Date,
  students: Awaited<ReturnType<typeof fetchStudents>>,
): Promise<JobOutcome> => {
  if (!(await claimQueueRow(client, entry.id))) return "conflict";
  // Delayed collection must use the bonus at the queue's historical start.
  const user = await fetchQuestUser(client, entry.userId, entry.jutsuId, startsAt);
  const owned = user.jutsus[0];
  const info = entry.jutsu;
  const level = owned?.level ?? 0;
  const trainable =
    !!info &&
    !info.hidden &&
    level < JUTSU_LEVEL_CAP &&
    (!info.parentJutsuId || !!owned) &&
    checkJutsuBloodline(info, user) &&
    checkJutsuVillage(info, user);
  if (!info || !trainable) {
    await refundRyo(client, entry.userId, entry.reservedRyo);
    return "dropped";
  }
  const cost = Math.min(
    entry.reservedRyo,
    calcJutsuTrainCost(info, level, user, students),
  );
  const finishesAt = new Date(
    startsAt.getTime() + calcJutsuTrainTime(info, level, user, startsAt),
  );
  const started = owned
    ? (await updateUserJutsuForStartQueuedJutsu(client, startsAt, finishesAt, owned))
        .rowsAffected === 1
    : await insertUserJutsuForStartQueuedJutsu(
        client,
        entry,
        startsAt,
        finishesAt,
      ).then(
        () => true,
        (error: unknown) => {
          if (isMysqlDuplicateKeyError(error)) return false;
          throw error;
        },
      );
  if (!started) {
    // The jutsu changed concurrently: put the job back for the next settlement.
    await restoreQueueRow(client, entry);
    return "conflict";
  }
  await updateQueueOwner(client, user, {
    refund: entry.reservedRyo - cost,
    trackers: owned
      ? undefined
      : [
          { task: "jutsus_mastered", increment: 1 },
          {
            task: "train_specific_jutsu",
            increment: 1,
            contentId: entry.jutsuId,
            masteryTypes: jutsuMasteryTypes(info),
          },
        ],
  });
  return { finishesAt };
};

/**
 * Start a queued craft as `occupation.craftItem` would: the output appears locked until
 * the craft finishes, and crafting experience and quest progress are granted now. The
 * materials were taken on enqueue; a craft that is no longer possible returns them.
 */
const startQueuedCraft = async (
  client: Transaction,
  entry: QueuedCraft,
  startsAt: Date,
  average: GameSetting,
): Promise<JobOutcome> => {
  if (!(await claimQueueRow(client, entry.id))) return "conflict";
  const craftable = !!entry.item && !entry.item.hidden && entry.item.canBeCrafted;
  if (!entry.item || !craftable) {
    await returnMaterials(client, entry.userId, entry.materials, true);
    return "dropped";
  }
  // Waiting durations are unboosted; eligibility is fixed when this job actually starts.
  const user = await fetchQuestUser(client, entry.userId, undefined, startsAt);
  const territoryBoost = getTerritoryWarBoost(user, startsAt);
  const finishesAt = new Date(
    startsAt.getTime() +
      Math.max(1, Math.round(entry.durationSeconds * (1 - territoryBoost))) * 1000,
  );
  const outputs: (typeof userItem.$inferInsert)[] = [];
  const stackSize = Math.max(1, entry.item.stackSize);
  for (let remaining = entry.quantity; remaining > 0; remaining -= stackSize) {
    outputs.push({
      id: nanoid(),
      userId: entry.userId,
      itemId: entry.itemId,
      quantity: Math.min(remaining, stackSize),
      craftingFinishedAt: finishesAt,
    });
  }
  // Cooking output must still fit the carried cooking bucket when the craft starts.
  if (getInventoryBucket(entry.item) === "cooking") {
    const carried = user.items.filter(
      (row) =>
        row.quantity > 0 &&
        countsTowardInventoryStorage(row) &&
        row.item &&
        getInventoryBucket(row.item) === "cooking",
    ).length;
    if (carried + outputs.length > getInventoryBucketCapacity("cooking", user)) {
      await returnMaterials(client, entry.userId, entry.materials, true);
      return "dropped";
    }
  }
  // Rollback retains the queue receipt and its reserved materials on insert failure.
  await insertUserItems(client, outputs);
  if (entry.item.itemType === "MEAL") {
    await insertUserCookingJobForStartQueuedCraft(
      client,
      {
        userId: entry.userId,
        item: { cookingExperience: entry.item.cookingExperience },
        quantity: entry.quantity,
      },
      territoryBoost,
      finishesAt,
    );
    return { finishesAt };
  }
  // Clan boosts apply to the experience as they do for a direct craft.
  const clanBoost = user.isOutlaw ? 0 : (user.clan?.craftingExpBoost ?? 0) / 100;
  const expGain = Math.floor(
    boostPvpGain(
      (entry.item.craftingExperience ?? 0) *
        entry.quantity *
        (1 + clanBoost + territoryBoost),
      getPvpBoost(user, [average]).totalPercent,
    ),
  );
  await updateQueueOwner(client, user, {
    craftingExperience: expGain,
    trackers: [
      { task: "crafting_experience_gained", increment: expGain },
      { task: "items_crafted", increment: entry.quantity },
      {
        task: "craft_specific_item",
        increment: entry.quantity,
        contentId: entry.itemId,
      },
    ],
  });
  return { finishesAt };
};

/** Deleting the row is the claim: only one settlement or cancellation can win it. */
const claimQueueRow = async (client: QueueClient, id: string) => {
  const result = await deleteUserQueueForClaimQueueRow(client, id);
  return result.rowsAffected === 1;
};

/**
 * Put a claimed job back unchanged. When its position was taken meanwhile, the job is
 * cancelled instead and its ryo or materials are returned.
 */
const restoreQueueRow = async (
  client: Transaction,
  entry: QueuedJutsu | QueuedCraft,
) => {
  const { jutsu: _jutsu, item: _item, ...row } = entry as QueuedJutsu & QueuedCraft;
  try {
    await insertUserQueueRows(client, [row]);
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    if (entry.kind === "JUTSU")
      await refundRyo(client, entry.userId, row.reservedRyo ?? 0);
    else await returnMaterials(client, entry.userId, row.materials ?? [], true);
  }
};

const QUEST_WRITE_ATTEMPTS = 3;

/**
 * One write for what a started job changes on its owner: refund, crafting experience
 * and quest progress. Amounts are added in SQL. Quest progress is written under the
 * owner's snapshot (`updatedAt`), recomputed from a fresh read when another request
 * changed the owner first; after a few lost races the amounts are written without it.
 */
const updateQueueOwner = async (
  client: QueueClient,
  owner: Awaited<ReturnType<typeof fetchQuestUser>>,
  changes: {
    refund?: number;
    craftingExperience?: number;
    trackers?: Parameters<typeof getNewTrackers>[1];
  },
) => {
  const { refund = 0, craftingExperience = 0, trackers } = changes;
  const amounts = {
    ...(refund > 0 ? { money: sql`${userData.money} + ${refund}` } : {}),
    ...(craftingExperience > 0
      ? {
          craftingExperience: sql`${userData.craftingExperience} + ${craftingExperience}`,
        }
      : {}),
  };
  const nextSnapshot = sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`;
  let user = owner;
  for (let attempt = 0; trackers && attempt < QUEST_WRITE_ATTEMPTS; attempt++) {
    const questData = filterQuestTrackersForDbPersist(
      getNewTrackers(user, trackers).trackers,
      user,
      true,
    );
    const written = await updateUserDataForUpdateQueueOwner(
      client,
      amounts,
      questData,
      nextSnapshot,
      user,
    );
    if (written.rowsAffected === 1) return;
    user = await fetchQuestUser(client, user.userId);
  }
  if (trackers) {
    Sentry.captureMessage("Queued job quest progress lost to concurrent writes", {
      level: "warning",
      extra: { userId: owner.userId },
    });
  }
  if (Object.keys(amounts).length === 0) return;
  await updateUserDataForUpdateQueueOwner2(client, amounts, nextSnapshot, owner);
};

const refundRyo = async (client: QueueClient, userId: string, amount: number) => {
  if (amount <= 0) return;
  await incrementUserMoney(client, amount, userId);
};

/**
 * Put taken materials back on the stacks they came from while those exist, are in a
 * normal state and have room, otherwise as new stacks in the same place. The merges run
 * in parallel outside transactions; a transaction must await them because its session
 * cannot execute concurrent statements. Per-stack results determine which materials
 * need new stacks; the rest go in one insert.
 */
const returnMaterials = async (
  client: QueueClient,
  userId: string,
  materials: CraftingQueueMaterial[],
  inTransaction = false,
) => {
  if (materials.length === 0) return;
  const merge = (material: CraftingQueueMaterial) => {
    // The material's stack size, read in the same statement; 0 means unlimited.
    const stackSize = sql`(SELECT NULLIF(${item.stackSize}, 0) FROM ${item} WHERE ${item.id} = ${material.itemId})`;
    return updateUserItemForMerge(client, material, userId, stackSize);
  };
  const merged: Awaited<ReturnType<typeof merge>>[] = [];
  if (inTransaction) {
    for (const material of materials) merged.push(await merge(material));
  } else {
    merged.push(...(await Promise.all(materials.map(merge))));
  }
  const unmerged = materials.filter((_, index) => merged[index]?.rowsAffected !== 1);
  if (unmerged.length === 0) return;
  await insertUserItemForReturnMaterials(client, unmerged, userId);
};

/** Return materials taken for a craft that did not get queued. */
export const returnCraftMaterials = returnMaterials;

/**
 * Quest context of a job's owner. Unlike a session refresh, settling a queue must not
 * regenerate pools, assign quests or mark the user online.
 * Include bonus history back to the queued job's logical start in the same read.
 */
const fetchQuestUser = async (
  client: QueueClient,
  userId: string,
  jutsuId?: string,
  startsAt?: Date,
) => {
  const user = await findUserDataForFetchQuestUser(client, userId, startsAt, jutsuId);
  if (!user) throw new Error(`Could not settle queue for missing user ${userId}`);
  // Tracker evaluation reads quests, village and items, all loaded above.
  return user as unknown as NonNullable<UserWithRelations> & {
    jutsus: (typeof user)["jutsus"];
    items: (typeof user)["items"];
  };
};
