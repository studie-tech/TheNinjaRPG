/** Helpers shared by every queue in `UserQueue`. */

import type { CombatStatName, MasteryName, QueueKind } from "@/drizzle/constants";
import type { UserQueue } from "@/drizzle/schema";
import type {
  EnergyTrainingQueueEntry,
  MasteryTrainingQueueEntry,
} from "@/validators/train";

export type QueueSchedule = { startsAt: Date; finishesAt: Date };

/** Where a newly enqueued job sits: after the last queued job, or the active one. */
export const getNextQueueSchedule = (
  durationSeconds: number,
  previousFinish: Date | null | undefined,
  now = new Date(),
): QueueSchedule => {
  const startsAt = previousFinish && previousFinish > now ? previousFinish : now;
  return {
    startsAt,
    finishesAt: new Date(startsAt.getTime() + durationSeconds * 1000),
  };
};

/**
 * Chain waiting jobs back to back from `startsAt`. Durations are the snapshots taken on
 * enqueue; only the timestamps move, e.g. after a cancellation or an early stop.
 */
export const rescheduleQueue = <T extends { durationSeconds: number }>(
  entries: readonly T[],
  startsAt: Date,
) => {
  let cursor = startsAt;
  return entries.map((entry) => {
    const schedule = {
      startsAt: cursor,
      finishesAt: new Date(cursor.getTime() + entry.durationSeconds * 1000),
    };
    cursor = schedule.finishesAt;
    return { entry, ...schedule };
  });
};

/**
 * When the next waiting job starts, or null while an earlier job is still running.
 *
 * - `chainedFinish`: end of a job started earlier in the same settlement pass. The next
 *   job follows it directly, even when that moment is in the past, so the outcome does
 *   not depend on when settlement runs.
 * - `lastFinish`: the latest finish recorded before this pass (an active or completed
 *   job). A job never starts before it.
 * - Without a running job, a job scheduled for later (its predecessor was stopped or
 *   cancelled) starts now instead of idling until its old slot.
 */
export const getQueuedJobStart = ({
  scheduledStart,
  lastFinish,
  chainedFinish,
  now,
}: {
  scheduledStart: Date;
  lastFinish: Date | null;
  chainedFinish: Date | null;
  now: Date;
}): Date | null => {
  if (chainedFinish) return chainedFinish > now ? null : chainedFinish;
  if (lastFinish && lastFinish > now) return null;
  const start = scheduledStart < now ? scheduledStart : now;
  return lastFinish && lastFinish > start ? lastFinish : start;
};

/** Latest of the given timestamps, ignoring missing ones. */
export const latestDate = (dates: readonly (Date | null | undefined)[]) =>
  dates.reduce<Date | null>(
    (latest, date) => (date && (!latest || date > latest) ? date : latest),
    null,
  );

/**
 * The live rows of one kind in queue order. MASTERY and ENERGY rows at or below the
 * user's head were consumed by a settlement and only wait for cleanup.
 */
export const liveQueueRows = <T extends Pick<UserQueue, "kind" | "position">>(
  rows: readonly T[],
  kind: QueueKind,
  head = 0,
) =>
  rows
    .filter((row) => row.kind === kind && row.position > head)
    .sort((a, b) => a.position - b.position);

/** The head after consuming the first `consumed` of the live `rows`. */
export const queueHeadAfter = (
  rows: readonly Pick<UserQueue, "position">[],
  consumed: number,
  head: number,
) => (consumed > 0 ? (rows[consumed - 1]?.position ?? head) : head);

export const toEnergyEntries = (
  rows: readonly Pick<UserQueue, "stat" | "energy">[],
): EnergyTrainingQueueEntry[] =>
  rows.map((row) => ({ stat: row.stat as CombatStatName, energy: row.energy ?? 0 }));

export const toMasteryEntries = (
  rows: readonly Pick<UserQueue, "stat" | "speed">[],
): MasteryTrainingQueueEntry[] =>
  rows.map((row) => ({ stat: row.stat as MasteryName, speed: row.speed ?? "15min" }));

/**
 * Whether `entries` only removes entries from `expected`: every entry appears in
 * `expected`, in the same order. Such an edit never needs the checks for adding one.
 */
export const isOrderedSubsequence = <T>(
  entries: readonly T[],
  expected: readonly T[],
) => {
  const keys = expected.map((entry) => JSON.stringify(entry));
  let cursor = 0;
  return entries.every((entry) => {
    const key = JSON.stringify(entry);
    while (cursor < keys.length && keys[cursor] !== key) cursor++;
    return cursor++ < keys.length;
  });
};

type QueueOwner = {
  queue?: readonly UserQueue[] | null;
  energyQueueHead: number;
  masteryQueueHead: number;
};

/** The user's queued Energy training, oldest first. */
export const getEnergyQueue = (user: QueueOwner) =>
  toEnergyEntries(liveQueueRows(user.queue ?? [], "ENERGY", user.energyQueueHead));

/** The masteries queued behind the active mastery session, oldest first. */
export const getMasteryQueue = (user: QueueOwner) =>
  toMasteryEntries(liveQueueRows(user.queue ?? [], "MASTERY", user.masteryQueueHead));

/**
 * Whether the user has queued Energy training. Reads only `UserData` columns, so callers
 * that did not load the rows can decide whether a refresh is needed.
 */
export const hasEnergyQueue = (user: {
  energyQueueHead: number;
  energyQueueTail: number;
}) => user.energyQueueTail > user.energyQueueHead;
