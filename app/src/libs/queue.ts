/** Scheduling helpers shared by the timed queues (jutsu training and crafting). */

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
