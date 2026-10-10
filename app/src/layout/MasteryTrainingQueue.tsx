"use client";

import { type ReactNode, useState } from "react";
import { api } from "@/app/_trpc/client";
import type { MasteryName } from "@/drizzle/constants";
import { TimedQueue } from "@/layout/TimedQueue";
import { getMasteryQueue } from "@/libs/queue";
import { showMutationToast } from "@/libs/toast";
import {
  getMasteryQueueSchedule,
  masteryTrainingEndsAt,
  queuedMasteryStartBlockMessage,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getQueueTotalCapacity } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

/** Masteries queued to start one after another behind the active mastery session. */
export const MasteryTrainingQueue = ({
  user,
  timeDiff,
  getLabel,
  stopControl,
  isProcessing,
}: {
  user: NonNullable<UserWithRelations>;
  timeDiff: number;
  getLabel: (stat: MasteryName) => string;
  stopControl: ReactNode;
  isProcessing: boolean;
}) => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [error, setError] = useState<string | null>(null);
  const entries = getMasteryQueue(user);
  const schedule = getMasteryQueueSchedule(user, entries);
  const activeEndsAt = masteryTrainingEndsAt(user);
  const block = entries[0] ? queuedMasteryStartBlockMessage(user, entries[0]) : null;

  const { mutate: saveQueue, isPending } =
    api.train.updateMasteryTrainingQueue.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: (result) => {
        showMutationToast(result);
        setError(result.success ? null : result.message);
      },
      onError: (cause) => setError(cause.message),
      onSettled: (result, _error, _variables, context) =>
        updateUser(result?.success ? result.userPatch : undefined, {
          revision: context?.revision,
          achievementProgress: result?.achievementProgress,
        }),
    });

  if (!user.currentlyTrainingMastery && !entries.length) return null;

  return (
    <TimedQueue
      title="Mastery queue"
      subtitle="Sessions that start when the active one ends"
      capacity={getQueueTotalCapacity(user)}
      help="Select a mastery image below to queue another session at the selected interval. When the active session reaches its full interval, its gains are collected and the next queued mastery starts at that moment, also while you are offline or asleep. The last session waits for you to collect it. Capped masteries are skipped, and the queue pauses at the daily session limit."
      active={
        user.currentlyTrainingMastery && activeEndsAt
          ? {
              title: getLabel(user.currentlyTrainingMastery),
              detail: user.trainingSpeed,
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
          expectedEntries: entries,
          entries: entries.filter((_, index) => !id.startsWith(`${index}-`)),
        })
      }
      isPending={isPending || isProcessing}
      timeDiff={timeDiff}
      emptyText="Select a mastery below to start."
      // The finished session is collected, and the next one started, on the refresh.
      onActiveFinish={() => void utils.profile.getUser.invalidate()}
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
