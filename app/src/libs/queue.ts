export type QueueTimestamps = {
  startsAt: Date;
  finishesAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
};

export type QueueState = "WAITING" | "ACTIVE" | "DUE" | "COMPLETED" | "CANCELLED";

export const getQueueState = (entry: QueueTimestamps, now = new Date()): QueueState => {
  if (entry.cancelledAt) return "CANCELLED";
  if (entry.completedAt) return "COMPLETED";
  if (now < entry.startsAt) return "WAITING";
  if (now < entry.finishesAt) return "ACTIVE";
  return "DUE";
};

export const getNextQueueSchedule = (
  durationSeconds: number,
  lastUnfinishedFinish?: Date | null,
  now = new Date(),
) => {
  const startsAt =
    lastUnfinishedFinish && lastUnfinishedFinish > now ? lastUnfinishedFinish : now;
  return {
    startsAt,
    finishesAt: new Date(startsAt.getTime() + durationSeconds * 1000),
  };
};

/**
 * Rebuild a FIFO schedule after an active stop or waiting cancellation. Durations
 * are immutable snapshots; only start/finish timestamps move to close the gap.
 */
export const rescheduleQueue = <T extends { durationSeconds: number }>(
  entries: T[],
  startsAt = new Date(),
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

export const splitQueue = <T extends QueueTimestamps>(
  entries: T[],
  now = new Date(),
) => {
  const unfinished = entries.filter(
    (entry) => !entry.completedAt && !entry.cancelledAt,
  );
  return {
    active: unfinished.find((entry) => entry.startsAt <= now) ?? null,
    waiting: unfinished.filter((entry) => entry.startsAt > now),
  };
};
