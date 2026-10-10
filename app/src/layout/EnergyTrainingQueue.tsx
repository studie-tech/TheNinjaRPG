"use client";

import { CircleHelp, Plus, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CombatStatName, CombatStatNames } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { showMutationToast } from "@/libs/toast";
import { isStatTrainingCapped, statTrainingBlockMessage } from "@/libs/train";
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
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [stat, setStat] = useState<CombatStatName>("offence");
  const [energy, setEnergy] = useState(user.maxEnergy);
  const [error, setError] = useState<string | null>(null);
  const availableStats = CombatStatNames.filter(
    (value) => !isStatTrainingCapped(user, value),
  );
  const selectedStat = availableStats.includes(stat) ? stat : availableStats[0];
  const entries = user.energyTrainingQueue ?? [];
  const capacity = getQueueTotalCapacity(user);
  const block = statTrainingBlockMessage({
    ...user,
    status: user.status === "ASLEEP" ? "AWAKE" : user.status,
  });
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
              Each entry trains once when its Energy threshold is reached. Entries run
              in order, including while sleeping. Offline progress is collected on your
              next account refresh. Capped stats are skipped, and unused Energy is kept.
            </PopoverContent>
          </Popover>
        </div>
      }
    >
      <div className="space-y-3">
        {entries.length > 0 ? (
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
        ) : (
          <div className="rounded border border-orange-900/30 border-dashed p-4 text-center text-muted-foreground text-sm">
            <Zap className="mx-auto mb-2 h-5 w-5 text-violet-500" />
            Add a stat and an Energy threshold to start your queue.
          </div>
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
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="queue-stat" className="text-xs">
              Stat
            </Label>
            <Select
              value={selectedStat ?? ""}
              onValueChange={(value) => setStat(value as CombatStatName)}
              disabled={isPending || !selectedStat}
            >
              <SelectTrigger
                id="queue-stat"
                aria-label="Queued stat"
                className="capitalize"
              >
                <SelectValue placeholder="All stats capped" />
              </SelectTrigger>
              <SelectContent>
                {availableStats.map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="queue-energy" className="text-xs">
              Energy threshold
            </Label>
            <div className="flex">
              <Input
                id="queue-energy"
                aria-label="Queued Energy"
                type="number"
                min={1}
                max={user.maxEnergy}
                step={1}
                value={energy}
                onChange={(event) => setEnergy(Number(event.target.value))}
                disabled={isPending}
                className="min-w-0 rounded-r-none"
              />
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setEnergy(user.maxEnergy)}
                aria-label="Set queued Energy to your capacity"
                className="h-9 rounded-l-none border-l-0 px-2"
              >
                Max
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            className="col-span-2 h-9 sm:col-span-1"
            disabled={
              isPending ||
              !!block ||
              !selectedStat ||
              entries.length >= capacity ||
              !Number.isFinite(energy) ||
              energy <= 0 ||
              energy > user.maxEnergy
            }
            onClick={() =>
              selectedStat &&
              saveQueue({
                expectedEntries: entries,
                entries: [...entries, { stat: selectedStat, energy }],
                guess: getGuess(),
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            {isPending
              ? "Saving…"
              : entries.length >= capacity
                ? "Queue full"
                : "Add to queue"}
          </Button>
        </div>
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
        {!selectedStat && (
          <p className="text-muted-foreground text-xs">
            All combat stats are capped for your rank.
          </p>
        )}
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
