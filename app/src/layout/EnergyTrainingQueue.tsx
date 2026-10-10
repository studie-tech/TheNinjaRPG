"use client";

import { CircleHelp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import ContentBox from "@/layout/ContentBox";
import { getEnergyQueue } from "@/libs/queue";
import { showMutationToast } from "@/libs/toast";
import { statTrainingBlockMessage } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getQueueTotalCapacity } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

export const EnergyTrainingQueue = ({
  user,
  availableEnergy,
  getGuess,
  refreshCaptcha,
}: {
  user: NonNullable<UserWithRelations>;
  availableEnergy: number;
  getGuess: () => string;
  refreshCaptcha: () => Promise<void>;
}) => {
  const utils = api.useUtils();
  const { saveQueue, isPending, error } = useEnergyTrainingQueue(refreshCaptcha);
  const entries = getEnergyQueue(user);
  const capacity = getQueueTotalCapacity(user);
  const block = statTrainingBlockMessage({
    ...user,
    status: user.status === "ASLEEP" ? "AWAKE" : user.status,
  });
  useEffect(() => {
    if (!entries.length) return;
    const timer = setInterval(() => void utils.profile.getUser.invalidate(), 60_000);
    return () => clearInterval(timer);
  }, [entries.length, utils]);

  return (
    <ContentBox
      title="Energy queue"
      subtitle="Train automatically as Energy recovers"
      initialBreak
      topRightContent={
        <div className="ml-2 flex items-center gap-2 text-xs">
          <span className="whitespace-nowrap">
            {entries.length} / {capacity} slots
          </span>
          <Popover>
            <PopoverTrigger aria-label="About the Energy queue" className="p-1">
              <CircleHelp className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent className="max-w-72 text-sm">
              Select Queue beside the Energy amount, then choose a stat image below to
              add it to the queue. Each entry trains once when its Energy threshold is
              reached. Entries run in order, including while sleeping. Offline progress
              is collected on your next account refresh. Capped stats are skipped, and
              unused Energy is kept.
            </PopoverContent>
          </Popover>
        </div>
      }
    >
      <div className="space-y-3">
        {entries.length > 0 && (
          <ol className="divide-y divide-orange-900/20 rounded border border-orange-900/30">
            {entries.map((entry, index) => (
              <li
                key={`${index}-${entry.stat}-${entry.energy}`}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="w-9 text-muted-foreground text-xs">
                  {index === 0 ? "Next" : `${index + 1}.`}
                </span>
                <span className="flex-1 capitalize">
                  {entry.stat}{" "}
                  <span className="text-muted-foreground">
                    · {entry.energy.toLocaleString()} Energy
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove queue entry ${index + 1}`}
                  disabled={isPending}
                  onClick={() =>
                    saveQueue({
                      expectedEntries: entries,
                      entries: entries.filter((_, i) => i !== index),
                      guess: getGuess(),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {entries[0] && (
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>Energy available</span>
              <span>
                {Math.floor(availableEnergy).toLocaleString()} /{" "}
                {entries[0].energy.toLocaleString()}
              </span>
            </div>
            <Progress
              aria-label="Energy toward the next queue entry"
              value={Math.min(100, (availableEnergy / entries[0].energy) * 100)}
              indicatorClassName="bg-violet-500"
              className="h-1.5 bg-violet-500/15"
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
          <span>One time per entry · Works offline and asleep</span>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => saveQueue({ expectedEntries: entries, entries: [] })}
            >
              Clear queue
            </Button>
          )}
        </div>
        {block && (
          <p className="text-muted-foreground text-xs">Queue paused: {block}</p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </ContentBox>
  );
};

/** Keep account and captcha state in sync after any Energy queue edit. */
export const useEnergyTrainingQueue = (refreshCaptcha: () => Promise<void>) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [error, setError] = useState<string | null>(null);
  const { mutate: saveQueue, isPending } =
    api.train.updateEnergyTrainingQueue.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: (result) => {
        showMutationToast(result);
        setError(result.success ? null : result.message);
      },
      onError: (cause) => setError(cause.message),
      onSettled: async (result, _error, variables, context) => {
        // Validation consumes a captcha even when the guess or a later write fails.
        await Promise.all([
          updateUser(result?.success ? result.userPatch : undefined, {
            revision: context?.revision,
            achievementProgress: result?.achievementProgress,
          }),
          ...(variables.entries.length && variables.guess ? [refreshCaptcha()] : []),
        ]);
      },
    });
  return { saveQueue, isPending, error };
};
