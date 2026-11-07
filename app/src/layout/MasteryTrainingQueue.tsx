"use client";

import type { ReactNode } from "react";
import {
  MASTERY_QUEUE_KIND_LABELS,
  type MasteryQueueKind,
  type TimedMasteryName,
} from "@/drizzle/constants";
import { useMasteryTrainingQueue } from "@/hooks/useMasteryTrainingQueue";
import { TimedQueue } from "@/layout/TimedQueue";
import { getMasteryQueue } from "@/libs/queue";
import {
  getMasteryQueueSchedule,
  getMasteryTrainingState,
  masteryTrainingEndsAt,
  queuedMasteryStartBlockMessage,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getQueueTotalCapacity } from "@/utils/paypal";

/** Masteries queued to start one after another behind the active mastery session. */
export const MasteryTrainingQueue = ({
  user,
  timeDiff,
  getLabel,
  stopControl,
  isProcessing,
  kind = "MASTERY",
}: {
  user: NonNullable<UserWithRelations>;
  timeDiff: number;
  getLabel: (stat: TimedMasteryName) => string;
  stopControl: ReactNode;
  isProcessing: boolean;
  kind?: MasteryQueueKind;
}) => {
  const { saveQueue, isPending, error } = useMasteryTrainingQueue();
  const entries = getMasteryQueue(user, kind);
  const session = getMasteryTrainingState(user, kind);
  const schedule = getMasteryQueueSchedule(user, entries, new Date(), kind);
  const activeEndsAt = masteryTrainingEndsAt(user, kind);
  const label = MASTERY_QUEUE_KIND_LABELS[kind];
  const block = entries[0] ? queuedMasteryStartBlockMessage(user, entries[0]) : null;

  if (!session.stat && !entries.length) return null;

  return (
    <TimedQueue
      title={`${label} queue`}
      subtitle="Sessions that start when the active one ends"
      capacity={getQueueTotalCapacity(user)}
      help="Select an image below to queue another session at the selected interval. Elements and Masteries have separate queues and can train at the same time. Each session finishes and collects its gains automatically, including the last one, also while you are offline or asleep. The next queued session starts when the previous one ends. Capped or unavailable entries are skipped, and the queue pauses at the daily session limit."
      active={
        session.stat && activeEndsAt
          ? {
              title: getLabel(session.stat),
              detail: session.speed,
              finishesAt: activeEndsAt,
              stopControl,
            }
          : null
      }
      waiting={schedule.map((entry, index) => ({
        id: `${index}-${entry.stat}-${entry.speed}`,
        title: getLabel(entry.stat),
        detail: entry.speed,
        startsAt: entry.startsAt,
        finishesAt: entry.finishesAt,
      }))}
      cancelLabel="Remove from queue"
      onCancel={(id) =>
        saveQueue({
          kind,
          expectedEntries: entries,
          entries: entries.filter((_, index) => !id.startsWith(`${index}-`)),
        })
      }
      isPending={isPending || isProcessing}
      timeDiff={timeDiff}
      emptyText="Select a mastery below to start."
    >
      {block && <p className="text-muted-foreground text-xs">Queue paused: {block}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </TimedQueue>
  );
};
