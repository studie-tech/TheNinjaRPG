"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getUserCaps,
  type MasteryName,
  MasteryNames,
  type TrainingSpeed,
  TrainingSpeeds,
} from "@/drizzle/constants";
import { TimedQueue } from "@/layout/TimedQueue";
import { getMasteryQueue } from "@/libs/queue";
import { showMutationToast } from "@/libs/toast";
import {
  getMasteryQueueSchedule,
  masteryTrainingEndsAt,
  queuedMasteryStartBlockMessage,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

/** Masteries queued to start one after another behind the active mastery session. */
export const MasteryTrainingQueue = ({
  user,
  timeDiff,
  getLabel,
}: {
  user: NonNullable<UserWithRelations>;
  timeDiff: number;
  getLabel: (stat: MasteryName) => string;
}) => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const { mastery_cap } = getUserCaps(user.rank);
  const available = MasteryNames.filter((stat) => user[stat] < mastery_cap);
  const [stat, setStat] = useState<MasteryName | null>(null);
  const [speed, setSpeed] = useState<TrainingSpeed>(user.trainingSpeed);
  const [error, setError] = useState<string | null>(null);
  const selectedStat = stat && available.includes(stat) ? stat : available[0];
  const entries = getMasteryQueue(user);
  const schedule = getMasteryQueueSchedule(user, entries);
  const activeEndsAt = masteryTrainingEndsAt(user);
  const isFull = entries.length >= getQueueWaitingSlots(user);
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

  return (
    <TimedQueue
      title="Mastery queue"
      subtitle="Sessions that start when the active one ends"
      capacity={getQueueTotalCapacity(user)}
      help="When the active session reaches its full interval, its gains are collected and the next queued mastery starts at that moment, also while you are offline or asleep. The last session waits for you to collect it. Capped masteries are skipped, and the queue pauses at the daily session limit."
      active={
        user.currentlyTrainingMastery && activeEndsAt
          ? {
              title: getLabel(user.currentlyTrainingMastery),
              detail: user.trainingSpeed,
              finishesAt: activeEndsAt,
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
      isPending={isPending}
      timeDiff={timeDiff}
      emptyText="Start a mastery session, then queue the next ones here."
      // The finished session is collected, and the next one started, on the refresh.
      onActiveFinish={() => void utils.profile.getUser.invalidate()}
    >
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="mastery-queue-stat" className="text-xs">
            Mastery
          </Label>
          <Select
            value={selectedStat ?? ""}
            onValueChange={(value) => setStat(value as MasteryName)}
            disabled={isPending || !selectedStat}
          >
            <SelectTrigger id="mastery-queue-stat" aria-label="Queued mastery">
              <SelectValue placeholder="All masteries capped" />
            </SelectTrigger>
            <SelectContent>
              {available.map((value) => (
                <SelectItem key={value} value={value}>
                  {getLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mastery-queue-speed" className="text-xs">
            Interval
          </Label>
          <Select
            value={speed}
            onValueChange={(value) => setSpeed(value as TrainingSpeed)}
            disabled={isPending}
          >
            <SelectTrigger id="mastery-queue-speed" aria-label="Queued interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TrainingSpeeds.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="col-span-2 h-9 sm:col-span-1"
          disabled={
            isPending || !selectedStat || isFull || !user.currentlyTrainingMastery
          }
          onClick={() =>
            selectedStat &&
            saveQueue({
              expectedEntries: entries,
              entries: [...entries, { stat: selectedStat, speed }],
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          {isPending ? "Saving…" : isFull ? "Queue full" : "Add to queue"}
        </Button>
      </div>
      {!user.currentlyTrainingMastery && (
        <p className="text-muted-foreground text-xs">
          Queued sessions follow an active one; pick a mastery above to start.
        </p>
      )}
      {block && <p className="text-muted-foreground text-xs">Queue paused: {block}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </TimedQueue>
  );
};
