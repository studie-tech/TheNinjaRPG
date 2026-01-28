"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { getRewardPreview } from "@/libs/objectives";
import {
  Check,
  Lock,
  Gift,
  ShoppingCart,
  Calendar,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { cn } from "src/libs/shadui";
import Loader from "@/layout/Loader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import Confirm2 from "@/layout/Confirm2";

export function ActivityStreakPanel() {
  const utils = api.useUtils();

  const { data: userStreaks, isLoading: streaksLoading } =
    api.activityStreak.getUserStreaks.useQuery(undefined, {
      staleTime: 0,
      refetchOnMount: "always",
    });

  const { data: availablePasses, isLoading: passesLoading } =
    api.activityStreak.getAvailablePasses.useQuery();

  const claimStreak = api.activityStreak.claimStreakDay.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.activityStreak.getUserStreaks.invalidate();
        void utils.activityStreak.getAvailablePasses.invalidate();
      }
    },
  });

  const purchasePass = api.activityStreak.purchaseEventPass.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.activityStreak.getUserStreaks.invalidate();
        void utils.activityStreak.getAvailablePasses.invalidate();
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
      {hasRecurringToEnroll && userStreaks?.activeRecurringConfig && (
        <Card className="relative overflow-hidden">
          <ConfigBanner
            image={userStreaks.activeRecurringConfig.image}
            name={userStreaks.activeRecurringConfig.name}
          />
          <CardHeader
            className={cn("pb-2", userStreaks.activeRecurringConfig.image && "pt-20")}
          >
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                {userStreaks.activeRecurringConfig.name}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="default">Daily</Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  Day 0/{userStreaks.activeRecurringConfig.totalDays}
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Claim button for day 1 */}
            <div className="flex items-center justify-between p-3 mt-3 bg-primary/10 rounded-lg">
              <div>
                <p className="font-medium">Day 1 rewards available!</p>
                <p className="text-sm text-muted-foreground">
                  {getRewardPreview(
                    userStreaks.activeRecurringConfig.rewards.find(
                      (r) => r.dayNumber === 1,
                    )?.rewards ?? null,
                  ) || "Claim your daily reward"}
                </p>
              </div>
              <Button
                onClick={() =>
                  claimStreak.mutate({
                    configId: userStreaks.activeRecurringConfig!.id,
                  })
                }
                disabled={claimStreak.isPending}
              >
                {claimStreak.isPending ? "Claiming..." : "Claim"}
              </Button>
            </div>

            {/* Progress grid */}
            <div className="grid grid-cols-7 gap-2">
              {Array.from(
                { length: userStreaks.activeRecurringConfig.totalDays },
                (_, i) => i + 1,
              ).map((day) => {
                const isNext = day === 1;
                const isFuture = day > 1;
                const reward = userStreaks.activeRecurringConfig!.rewards.find(
                  (r) => r.dayNumber === day,
                );
                const rewardPreview = getRewardPreview(reward?.rewards ?? null);

                return (
                  <DayCell
                    key={day}
                    day={day}
                    isClaimed={false}
                    isNext={isNext}
                    isFuture={isFuture}
                    rewardImage={reward?.image}
                    rewardPreview={rewardPreview}
                  />
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500" />
                <span>Claimed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-primary/20 border border-primary" />
                <span>Available</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-muted/50 border border-muted-foreground/20" />
                <span>Upcoming</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* User's Active Streaks */}
      {userStreaks?.streaks.map((streak) => (
        <Card key={streak.configId} className="relative overflow-hidden">
          <ConfigBanner image={streak.configImage} name={streak.configName} />
          <CardHeader className={cn("pb-2", streak.configImage && "pt-20")}>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                {streak.configName}
              </span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={streak.streakType === "RECURRING" ? "default" : "secondary"}
                >
                  {streak.streakType === "RECURRING" ? "Daily" : "Event"}
                </Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  Day {streak.currentDay}/{streak.totalDays}
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Catchup panel - shown when user is behind and needs to catch up */}
            {streak.needsCatchUp && (
              <div className="p-4 bg-orange-500/10 rounded-lg mt-2 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-orange-700 dark:text-orange-400">
                      {streak.daysToGo ?? 1} day{(streak.daysToGo ?? 1) > 1 ? "s" : ""}{" "}
                      behind!
                    </p>
                    <p className="text-sm text-orange-600 dark:text-orange-500 mt-1">
                      Pay {COST_STREAK_CATCHUP_DAY} rep per day to catch up, or reset
                      your streak.
                    </p>
                  </div>
                </div>

                {/* Catchup progress info */}
                <div className="flex items-center justify-between text-sm bg-background/50 p-2 rounded">
                  <span>
                    Current: Day {streak.currentDay} → Target: Day{" "}
                    {streak.theoreticalMaxDay ?? streak.totalDays}
                  </span>
                  <span className="font-medium">
                    {streak.daysToGo ?? 1} day{(streak.daysToGo ?? 1) > 1 ? "s" : ""} to
                    catch up
                  </span>
                </div>

                {/* Next reward preview */}
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">
                    Day {streak.nextDayNumber} rewards:{" "}
                  </span>
                  {getRewardPreview(streak.nextRewards) || "Daily reward"}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Confirm2
                    title="Reset Streak"
                    button={
                      <Button
                        variant="outline"
                        disabled={claimStreak.isPending}
                        className="flex-1"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
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
                      <p>
                        Your current progress (day {streak.currentDay}) will be lost.
                      </p>
                    </div>
                  </Confirm2>
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
                    <ArrowRight className="h-4 w-4 mr-2" />
                    {claimStreak.isPending
                      ? "Claiming..."
                      : `Claim Day ${streak.nextDayNumber} (${COST_STREAK_CATCHUP_DAY} rep)`}
                  </Button>
                </div>
              </div>
            )}

            {/* Normal claim button (when streak is not broken) */}
            {streak.canClaimToday && !streak.needsCatchUp && (
              <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
                <div>
                  <p className="font-medium">
                    Day {streak.nextDayNumber} rewards available!
                  </p>
                  <p className="text-sm text-muted-foreground">
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
              <div className="p-3 bg-green-500/10 rounded-lg">
                <p className="font-medium text-green-700 dark:text-green-400">
                  Today&apos;s streak claimed! Come back tomorrow.
                </p>
              </div>
            )}

            {/* Progress grid */}
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: streak.totalDays }, (_, i) => i + 1).map((day) => {
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
                const isFuture =
                  day > (streak.theoreticalMaxDay ?? streak.nextDayNumber);
                const reward = streak.allRewards.find((r) => r.dayNumber === day);
                const rewardPreview = getRewardPreview(reward?.rewards ?? null);

                return (
                  <DayCell
                    key={day}
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

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500" />
                <span>Claimed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-primary/20 border border-primary" />
                <span>Available</span>
              </div>
              {streak.needsCatchUp && (
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-orange-500/20 border border-orange-500" />
                  <span>To Catch Up</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-muted/50 border border-muted-foreground/20" />
                <span>Upcoming</span>
              </div>
            </div>
          </CardContent>
        </Card>
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
              const costParts: string[] = [];
              if (pass.ryoCost > 0) costParts.push(`${pass.ryoCost} ryo`);
              if (pass.repsCost > 0) costParts.push(`${pass.repsCost} reputation`);
              if (pass.seichiSilverCost > 0)
                costParts.push(`${pass.seichiSilverCost} silver`);
              const costText = costParts.length > 0 ? costParts.join(" + ") : "Free";

              return (
                <div
                  key={pass.id}
                  className="relative flex items-center justify-between p-4 border rounded-lg overflow-hidden"
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

                  <div className="flex items-center gap-4 flex-1 z-10">
                    {/* Thumbnail */}
                    {pass.image && (
                      <div className="relative h-16 w-16 flex-shrink-0 rounded-lg overflow-hidden border">
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
                        <p className="text-sm text-muted-foreground mt-1">
                          {pass.description}
                        </p>
                      )}
                      {(pass.startDate || pass.endDate) && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
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
                      <p className="text-sm font-medium mt-2">Cost: {costText}</p>
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={purchasePass.isPending}
                        className="z-10"
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        {purchasePass.isPending ? "Purchasing..." : "Purchase"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Purchase {pass.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This event pass costs <strong>{costText}</strong>.
                          <br />
                          <br />
                          You will be able to claim daily rewards for {
                            pass.totalDays
                          }{" "}
                          days.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => purchasePass.mutate({ configId: pass.id })}
                        >
                          Confirm Purchase
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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

/** Renders a config banner image if available */
const ConfigBanner: React.FC<{ image: string | null; name: string }> = ({
  image,
  name,
}) => {
  if (!image) return null;
  return (
    <div className="absolute top-0 left-0 right-0 h-28 overflow-hidden rounded-t-lg">
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
        "relative aspect-square rounded-lg border flex flex-col items-center justify-center p-1 transition-all overflow-hidden",
        isClaimed && "bg-green-500/20 border-green-500",
        isNext && "bg-primary/20 border-primary ring-2 ring-primary",
        isMissed && "bg-orange-500/20 border-orange-500",
        !isClaimed && !isNext && !isMissed && "bg-muted/50 border-muted-foreground/20",
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
          "text-xs font-bold z-10",
          rewardImage && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] text-white",
          isMissed && !rewardImage && "text-orange-600",
        )}
      >
        {day}
      </span>
      {isClaimed && (
        <Check
          className={cn(
            "h-3 w-3 z-10",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-green-600",
          )}
        />
      )}
      {isNext && (
        <Gift
          className={cn(
            "h-3 w-3 z-10",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-primary",
          )}
        />
      )}
      {isMissed && (
        <AlertTriangle
          className={cn(
            "h-3 w-3 z-10",
            rewardImage
              ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              : "text-orange-500",
          )}
        />
      )}
      {isFuture && !rewardImage && !isMissed && (
        <Lock className="h-3 w-3 text-muted-foreground/50 z-10" />
      )}
    </div>
  );
};
