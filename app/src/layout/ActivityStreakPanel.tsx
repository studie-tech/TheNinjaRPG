"use client";

import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  Gift,
  Lock,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import { useActivityStreaks, useClaimStreakDay } from "@/hooks/useActivityStreaks";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { formatEventPassCost } from "@/libs/activityStreak";
import { getRewardPreview } from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";

export function ActivityStreakPanel() {
  const utils = api.useUtils();
  const { timeDiff, prepareUserUpdate, updateUser } = useUserInfo();

  const { data: userStreaks, isLoading: streaksLoading } = useActivityStreaks(
    true,
    timeDiff,
  );

  const { data: availablePasses, isLoading: passesLoading } =
    api.activityStreak.getAvailablePasses.useQuery();

  const claimStreak = useClaimStreakDay();

  const purchasePass = api.activityStreak.purchaseEventPass.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        void Promise.allSettled([
          utils.activityStreak.getUserStreaks.invalidate(),
          utils.activityStreak.getAvailablePasses.invalidate(),
          updateUser(undefined, { revision, delta: data.userDelta }),
        ]);
      }
    },
  });

  if (streaksLoading || passesLoading) {
    return <Loader explanation="Loading streak data..." />;
  }

  const hasStreaks = userStreaks?.streaks && userStreaks.streaks.length > 0;
  const hasAvailablePasses = availablePasses && availablePasses.length > 0;
  const hasRecurringToEnroll = userStreaks?.activeRecurringConfig;

  if (!hasStreaks && !hasAvailablePasses && !hasRecurringToEnroll) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Activity Streak
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No activity streaks are currently available. Check back later!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active Recurring Streak - Show full calendar even before first claim */}
      {userStreaks?.activeRecurringConfig && (
        <StreakCard
          streak={toEnrollStreak(userStreaks.activeRecurringConfig)}
          claimStreak={claimStreak}
          claimPanelClassName="mt-3"
        />
      )}

      {/* User's Active Streaks */}
      {userStreaks?.streaks.map((streak) => (
        <StreakCard key={streak.configId} streak={streak} claimStreak={claimStreak} />
      ))}

      {/* Available Event Passes for Purchase */}
      {hasAvailablePasses && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Available Event Passes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {availablePasses.map((pass) => {
              const costText = formatEventPassCost(pass, { separator: " + " });

              return (
                <div
                  key={pass.id}
                  className="relative flex items-center justify-between overflow-hidden rounded-lg border p-4"
                >
                  {/* Pass image as background */}
                  {pass.image && (
                    <div className="absolute inset-0 z-0">
                      <Image
                        src={pass.image}
                        alt={pass.name}
                        fill
                        className="object-cover opacity-15"
                        sizes="(max-width: 768px) 100vw, 600px"
                      />
                    </div>
                  )}

                  <div className="z-10 flex flex-1 items-center gap-4">
                    {/* Thumbnail */}
                    {pass.image && (
                      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border">
                        <Image
                          src={pass.image}
                          alt={pass.name}
                          fill
                          className="object-cover"
                          sizes="64px"
                        />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{pass.name}</h3>
                        <Badge variant="secondary">{pass.totalDays} days</Badge>
                      </div>
                      {pass.description && (
                        <p className="mt-1 text-muted-foreground text-sm">
                          {pass.description}
                        </p>
                      )}
                      {(pass.startDate || pass.endDate) && (
                        <div className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
                          <Calendar className="h-3 w-3" />
                          {pass.startDate && (
                            <span>
                              From {new Date(pass.startDate).toLocaleDateString()}
                            </span>
                          )}
                          {pass.endDate && (
                            <span>
                              until {new Date(pass.endDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="mt-2 font-medium text-sm">Cost: {costText}</p>
                    </div>
                  </div>

                  <Confirm
                    title={`Purchase ${pass.name}?`}
                    proceed_label="Confirm Purchase"
                    disabled={purchasePass.isPending}
                    button={
                      <Button
                        variant="outline"
                        disabled={purchasePass.isPending}
                        className="z-10"
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        {purchasePass.isPending ? "Purchasing..." : "Purchase"}
                      </Button>
                    }
                    onAccept={() => purchasePass.mutate({ configId: pass.id })}
                  >
                    <p className="text-muted-foreground text-sm">
                      This event pass costs <strong>{costText}</strong>.
                      <br />
                      <br />
                      You will be able to claim daily rewards for {pass.totalDays} days.
                    </p>
                  </Confirm>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ActivityStreakPanel;

/** One streak's claim state and day calendar. */
const StreakCard: React.FC<{
  streak: StreakCardData;
  claimStreak: ReturnType<typeof useClaimStreakDay>;
  claimPanelClassName?: string;
}> = ({ streak, claimStreak, claimPanelClassName }) => (
  <Card className="relative overflow-hidden">
    <ConfigBanner image={streak.configImage} name={streak.configName} />
    <CardHeader className={cn("pb-2", streak.configImage && "pt-20")}>
      <CardTitle className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Gift className="h-5 w-5" />
          {streak.configName}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant={streak.streakType === "RECURRING" ? "default" : "secondary"}>
            {streak.streakType === "RECURRING" ? "Daily" : "Event"}
          </Badge>
          <span className="font-normal text-muted-foreground text-sm">
            Day {streak.currentDay}/{streak.totalDays}
          </span>
        </div>
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {/* Catchup panel - shown when user is behind and needs to catch up */}
      {streak.needsCatchUp && (
        <div className="mt-2 space-y-3 rounded-lg bg-orange-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
            <div className="flex-1">
              <p className="font-medium text-orange-700 dark:text-orange-400">
                {streak.daysToGo ?? 1} day{(streak.daysToGo ?? 1) > 1 ? "s" : ""}{" "}
                behind!
              </p>
              <p className="mt-1 text-orange-600 text-sm dark:text-orange-500">
                Pay {COST_STREAK_CATCHUP_DAY} rep per day to catch up, or reset your
                streak.
              </p>
            </div>
          </div>

          {/* Catchup progress info */}
          <div className="flex items-center justify-between rounded bg-background/50 p-2 text-sm">
            <span>
              Current: Day {streak.currentDay} → Target: Day{" "}
              {streak.theoreticalMaxDay ?? streak.totalDays}
            </span>
            <span className="font-medium">
              {streak.daysToGo ?? 1} day{(streak.daysToGo ?? 1) > 1 ? "s" : ""} to catch
              up
            </span>
          </div>

          {/* Next reward preview */}
          <div className="text-muted-foreground text-sm">
            <span className="font-medium">Day {streak.nextDayNumber} rewards: </span>
            {getRewardPreview(streak.nextRewards) || "Daily reward"}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Confirm
              title="Reset Streak"
              button={
                <Button
                  variant="outline"
                  disabled={claimStreak.isPending}
                  className="flex-1"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Day 1
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                claimStreak.mutate({ configId: streak.configId, reset: true });
              }}
            >
              <div className="space-y-2">
                <p>
                  Your streak will <strong>reset to day 1</strong>.
                </p>
                <p>Your current progress (day {streak.currentDay}) will be lost.</p>
              </div>
            </Confirm>
            <Button
              variant="default"
              disabled={claimStreak.isPending}
              className="flex-1"
              onClick={() =>
                claimStreak.mutate({
                  configId: streak.configId,
                  payCatchUp: true,
                })
              }
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              {claimStreak.isPending
                ? "Claiming..."
                : `Claim Day ${streak.nextDayNumber} (${COST_STREAK_CATCHUP_DAY} rep)`}
            </Button>
          </div>
        </div>
      )}

      {/* Normal claim button (when streak is not broken) */}
      {streak.canClaimToday && !streak.needsCatchUp && (
        <div
          className={cn(
            "flex items-center justify-between rounded-lg bg-primary/10 p-3",
            claimPanelClassName,
          )}
        >
          <div>
            <p className="font-medium">Day {streak.nextDayNumber} rewards available!</p>
            <p className="text-muted-foreground text-sm">
              {getRewardPreview(streak.nextRewards) || "Claim your daily reward"}
            </p>
          </div>
          <Button
            onClick={() => claimStreak.mutate({ configId: streak.configId })}
            disabled={claimStreak.isPending}
          >
            {claimStreak.isPending ? "Claiming..." : "Claim"}
          </Button>
        </div>
      )}

      {/* Show "all caught up" only when user is caught up and has claimed today */}
      {streak.alreadyClaimedToday && !streak.needsCatchUp && (
        <div className="rounded-lg bg-green-500/10 p-3">
          <p className="font-medium text-green-700 dark:text-green-400">
            Today&apos;s streak claimed! Come back tomorrow.
          </p>
        </div>
      )}

      {/* Progress grid */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: streak.totalDays }, (_, i) => i + 1).map((day, i) => {
          const isClaimed = day <= streak.currentDay;
          const isNext =
            day === streak.nextDayNumber &&
            (streak.canClaimToday || streak.needsCatchUp);
          // A day is "to catch up" if it's between currentDay and theoreticalMaxDay
          const isMissed =
            streak.needsCatchUp &&
            streak.theoreticalMaxDay !== undefined &&
            day > streak.currentDay &&
            day <= streak.theoreticalMaxDay;
          const isFuture = day > (streak.theoreticalMaxDay ?? streak.nextDayNumber);
          const reward = streak.allRewards.find((r) => r.dayNumber === day);
          const rewardPreview = getRewardPreview(reward?.rewards ?? null);

          return (
            <DayCell
              key={`${day}-${i}`}
              day={day}
              isClaimed={isClaimed}
              isNext={isNext}
              isMissed={isMissed && !isNext}
              isFuture={isFuture && !isMissed}
              rewardImage={reward?.image}
              rewardPreview={rewardPreview}
            />
          );
        })}
      </div>

      <StreakLegend showCatchUp={streak.needsCatchUp} />
    </CardContent>
  </Card>
);

/** Explain streak-day colors, including catch-up only when that option is available. */
const StreakLegend: React.FC<{ showCatchUp: boolean }> = ({ showCatchUp }) => (
  <div className="flex flex-wrap gap-4 text-muted-foreground text-xs">
    <div className="flex items-center gap-1">
      <div className="h-3 w-3 rounded border border-green-500 bg-green-500/20" />
      <span>Claimed</span>
    </div>
    <div className="flex items-center gap-1">
      <div className="h-3 w-3 rounded border border-primary bg-primary/20" />
      <span>Available</span>
    </div>
    {showCatchUp && (
      <div className="flex items-center gap-1">
        <div className="h-3 w-3 rounded border border-orange-500 bg-orange-500/20" />
        <span>To Catch Up</span>
      </div>
    )}
    <div className="flex items-center gap-1">
      <div className="h-3 w-3 rounded border border-muted-foreground/20 bg-muted/50" />
      <span>Upcoming</span>
    </div>
  </div>
);

/** Renders a config banner image if available */
const ConfigBanner: React.FC<{ image: string | null; name: string }> = ({
  image,
  name,
}) => {
  if (!image) return null;
  return (
    <div className="absolute top-0 right-0 left-0 h-28 overflow-hidden rounded-t-lg">
      <Image
        src={image}
        alt={name}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 600px"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
    </div>
  );
};

/** Renders a day cell with optional reward image */
const DayCell: React.FC<{
  day: number;
  isClaimed: boolean;
  isNext: boolean;
  isMissed?: boolean;
  isFuture: boolean;
  rewardImage: string | null | undefined;
  rewardPreview: string | null;
}> = ({ day, isClaimed, isNext, isMissed, isFuture, rewardImage, rewardPreview }) => {
  return (
    <div
      className={cn(
        "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border p-1 transition-all",
        isClaimed && "border-green-500 bg-green-500/20",
        isNext && "border-primary bg-primary/20 ring-2 ring-primary",
        isMissed && "border-orange-500 bg-orange-500/20",
        !isClaimed && !isNext && !isMissed && "border-muted-foreground/20 bg-muted/50",
      )}
      title={isMissed ? `Day ${day} (missed)` : rewardPreview || `Day ${day}`}
    >
      {/* Background reward image */}
      {rewardImage && (
        <div className="absolute inset-0">
          <Image
            src={rewardImage}
            alt={`Day ${day} reward`}
            fill
            className={cn(
              "object-cover",
              isClaimed && "opacity-50",
              isMissed && "opacity-40 grayscale",
              isFuture && "opacity-30 grayscale",
            )}
            sizes="60px"
          />
          <div
            className={cn(
              "absolute inset-0",
              isClaimed && "bg-green-500/30",
              isNext && "bg-primary/30",
              isMissed && "bg-orange-500/30",
              isFuture && "bg-background/50",
            )}
          />
        </div>
      )}
      {/* Day number and icon */}
      <span
        className={cn(
          "z-10 font-bold text-xs",
          rewardImage && "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]",
          isMissed && !rewardImage && "text-orange-600",
        )}
      >
        {day}
      </span>
      {isClaimed && (
        <Check
          className={cn(
            "z-10 h-3 w-3",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-green-600",
          )}
        />
      )}
      {isNext && (
        <Gift
          className={cn(
            "z-10 h-3 w-3",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-primary",
          )}
        />
      )}
      {isMissed && (
        <AlertTriangle
          className={cn(
            "z-10 h-3 w-3",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-orange-500",
          )}
        />
      )}
      {isFuture && !rewardImage && !isMissed && (
        <Lock className="z-10 h-3 w-3 text-muted-foreground/50" />
      )}
    </div>
  );
};

/** A recurring config before its first claim, as a streak with day 1 open. */
const toEnrollStreak = (config: EnrollConfig): StreakCardData => ({
  configId: config.id,
  configName: config.name,
  configImage: config.image,
  streakType: "RECURRING",
  totalDays: config.totalDays,
  currentDay: 0,
  nextDayNumber: 1,
  canClaimToday: true,
  alreadyClaimedToday: false,
  needsCatchUp: false,
  nextRewards: config.rewards.find((r) => r.dayNumber === 1)?.rewards ?? null,
  allRewards: config.rewards,
});

type UserStreaks = RouterOutputs["activityStreak"]["getUserStreaks"];
type EnrollConfig = NonNullable<UserStreaks["activeRecurringConfig"]>;
type UserStreak = UserStreaks["streaks"][number];
type StreakCardData = Pick<
  UserStreak,
  | "configId"
  | "configName"
  | "configImage"
  | "streakType"
  | "totalDays"
  | "currentDay"
  | "nextDayNumber"
  | "canClaimToday"
  | "alreadyClaimedToday"
  | "needsCatchUp"
  | "nextRewards"
  | "allRewards"
> &
  Partial<Pick<UserStreak, "theoreticalMaxDay" | "daysToGo">>;
