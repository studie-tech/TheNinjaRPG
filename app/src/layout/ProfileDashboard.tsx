"use client";

import { noCase } from "change-case";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Coins,
  Dumbbell,
  Eye,
  Gift,
  Hammer,
  MapPin,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Swords,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import { useActivityStreaks, useClaimStreakDay } from "@/hooks/useActivityStreaks";
import { useClaimBankInterest, usePendingBankInterest } from "@/hooks/useBankInterest";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import Confirm from "@/layout/Confirm";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { LogbookActive } from "@/layout/Logbook";
import { bankAccessBlockMessage } from "@/libs/bank";
import { getRewardPreview } from "@/libs/objectives";
import { calcLevelRequirements, levelUpBlockMessage } from "@/libs/profile";
import {
  buildDashboardCatalogue,
  type DashboardCatalogueEntry,
  dashboardContentActionLabel,
  dashboardContentHref,
  describeOccupationLine,
  raidContinueHref,
  selectDashboardHighlights,
} from "@/libs/profileDashboard";
import { cn } from "@/libs/shadui";
import { canStartStatTraining, statTrainingEndsAt } from "@/libs/train";
import { capitalizeFirstLetter } from "@/utils/string";
import { nextUtcDayAt } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

const categoryLabels = {
  events: "Events",
  missions: "Missions & crimes",
  story: "Story",
  battlePyramids: "Battle pyramids",
  raids: "Raids",
} as const;

export default function ProfileDashboard() {
  const { data: userData, timeDiff } = useRequiredUserData();
  const utils = api.useUtils();
  const { sectorVillage } = useSectorVillage(userData);
  const [showAllContent, setShowAllContent] = useState(false);

  const dashboard = api.profile.getDashboard.useQuery(undefined, {
    staleTime: 60_000,
  });
  const streaks = useActivityStreaks(true, timeDiff ?? 0);
  const interest = usePendingBankInterest(true, timeDiff ?? 0);
  const sidebarTimers = api.profile.getSidebarTimers.useQuery();

  const claimInterest = useClaimBankInterest();
  const claimStreak = useClaimStreakDay();

  const claimableStreak = streaks.data?.streaks.find((streak) => streak.canClaimToday);
  const catchUpStreak = streaks.data?.streaks.find((streak) => streak.needsCatchUp);
  const recurringStreak = streaks.data?.activeRecurringConfig;
  const canClaimInterest =
    (interest.data?.totalPending ?? 0) > 0 &&
    !!userData &&
    !bankAccessBlockMessage(userData);
  const canLevelUp = !!userData && !levelUpBlockMessage(userData);
  const claimableRaidRewards =
    dashboard.data?.raidRewards.reduce((sum, raid) => sum + raid.claimableCount, 0) ??
    0;

  const trainingFinish = userData ? statTrainingEndsAt(userData) : null;
  const training = userData?.currentlyTraining
    ? {
        title: capitalizeFirstLetter(noCase(userData.currentlyTraining)),
        startedAt: userData.trainingStartedAt,
        endsAt: trainingFinish,
      }
    : sidebarTimers.data?.jutsuTraining
      ? {
          title: `${sidebarTimers.data.jutsuTraining.name} to level ${sidebarTimers.data.jutsuTraining.level}`,
          startedAt: sidebarTimers.data.jutsuTraining.trainingStartedAt,
          endsAt: sidebarTimers.data.jutsuTraining.finishTraining,
        }
      : null;
  const craftingTimers = [
    ...(sidebarTimers.data?.crafting
      ? [
          {
            kind: "crafting" as const,
            label: "Crafting",
            title: sidebarTimers.data.crafting.itemName,
            href: "/occupation",
            startedAt: sidebarTimers.data.crafting.craftingStartedAt,
            endsAt: sidebarTimers.data.crafting.craftingFinishedAt,
          },
        ]
      : []),
    ...(sidebarTimers.data?.imbuement
      ? [
          {
            kind: "imbuement" as const,
            label: "Imbuing",
            title: sidebarTimers.data.imbuement.targetName,
            href: "/items",
            startedAt: sidebarTimers.data.imbuement.craftingStartedAt,
            endsAt: sidebarTimers.data.imbuement.craftingFinishedAt,
          },
        ]
      : []),
  ];

  const catalogue = useMemo(
    () =>
      userData
        ? buildDashboardCatalogue(
            dashboard.data?.candidates ?? [],
            userData,
            sectorVillage,
          )
        : [],
    [dashboard.data?.candidates, userData, sectorVillage],
  );

  const previewContent = useMemo(() => {
    if (showAllContent) return catalogue;
    return selectDashboardHighlights(catalogue);
  }, [catalogue, showAllContent]);

  useRefreshAt(
    [
      nextUtcDayAt(new Date(Date.now() - (timeDiff ?? 0))),
      ...(dashboard.data?.candidates ?? []).flatMap((entry) => [
        entry.startsAt,
        entry.endsAt,
      ]),
      ...(userData?.activeRaids ?? []).map((raid) => raid.raidEndsAt),
    ],
    () => {
      void Promise.allSettled([
        dashboard.refetch({ cancelRefetch: false }),
        utils.profile.getUser.invalidate(),
      ]);
    },
    timeDiff ?? 0,
  );

  if (!userData) return <Loader explanation="Loading your logbook..." />;

  const hasActiveQuests = userData.userQuests.some(
    (entry) => !["tier", "achievement"].includes(entry.quest.questType),
  );
  const activeRaids = (userData.activeRaids ?? []).flatMap((raid) => {
    const progress = dashboard.data?.raidProgress.find(
      (entry) => entry.raidId === raid.id,
    );
    return progress ? [{ ...raid, damageDealt: progress.damageDealt }] : [];
  });
  const recommended = catalogue.find((entry) => entry.availability === "available");
  const occupationLine = describeOccupationLine({
    occupation: userData.occupation,
    quests: userData.userQuests,
    trackers: userData.questData,
    craftingItemName:
      userData.occupation === "CRAFTING" &&
      sidebarTimers.isLoading &&
      !sidebarTimers.data
        ? undefined
        : (sidebarTimers.data?.crafting?.itemName ?? null),
  });
  const visibleCraftTimers = craftingTimers.filter(
    (timer) => !(timer.kind === "crafting" && occupationLine.craftTimer),
  );
  const levelRequirement = calcLevelRequirements(userData.level);
  const experienceToGo = Math.max(levelRequirement - userData.experience, 0);
  const levelProgress =
    levelRequirement > 0
      ? Math.min(100, (userData.experience / levelRequirement) * 100)
      : 100;
  const claimsLoading = streaks.isLoading || interest.isLoading || dashboard.isLoading;
  const claimsFailed = streaks.isError || interest.isError || dashboard.isError;
  const streakNeedsAttention = Boolean(
    claimableStreak || catchUpStreak || recurringStreak,
  );
  const bankWaiting = (interest.data?.totalPending ?? 0) > 0;
  const hasCollectible =
    streakNeedsAttention || bankWaiting || claimableRaidRewards > 0;
  const recurringReward = getRewardPreview(
    recurringStreak?.rewards.find((reward) => reward.dayNumber === 1)?.rewards ?? null,
  );
  const awake = userData.status === "AWAKE";
  const craftTimer = craftingTimers.find((timer) => timer.kind === "crafting");
  const canStartTraining = !training && canStartStatTraining(userData);
  const raidTitle =
    dashboard.data?.raidRewards.length === 1
      ? (dashboard.data.raidRewards[0]?.raidName ?? "Raid rewards")
      : "Raid rewards";
  const pendingInterestDays = interest.data?.records.length ?? 0;

  return (
    <div className="space-y-8 p-3 sm:p-4">
      <section aria-labelledby="now-heading">
        <SectionHeader eyebrow="Right now" title="In progress" id="now-heading" />
        <div className="rounded-md border bg-card px-4">
          {claimsLoading && (
            <p className="border-t py-3 text-muted-foreground text-sm first:border-t-0">
              Checking the streak, the bank, and raids...
            </p>
          )}
          {streaks.isError && (
            <div className="border-t py-3 first:border-t-0">
              <RetryPanel
                message="The activity streak could not be loaded."
                onRetry={() => void streaks.refetch()}
              />
            </div>
          )}
          {interest.isError && (
            <div className="border-t py-3 first:border-t-0">
              <RetryPanel
                message="Bank interest could not be loaded."
                onRetry={() => void interest.refetch()}
              />
            </div>
          )}
          {dashboard.isError && (
            <div className="border-t py-3 first:border-t-0">
              <RetryPanel
                message="Raid rewards could not be loaded."
                onRetry={() => void dashboard.refetch()}
              />
            </div>
          )}
          {catchUpStreak && (
            <StatusRow
              label="Streak"
              title={`${catchUpStreak.daysToGo ?? 1} ${(catchUpStreak.daysToGo ?? 1) === 1 ? "day" : "days"} behind`}
              detail={`Day ${catchUpStreak.nextDayNumber}: ${getRewardPreview(catchUpStreak.nextRewards) || "Daily reward"}. ${COST_STREAK_CATCHUP_DAY} rep per day to catch up.`}
              note={
                <>
                  {!awake && <p>You can claim this once you are awake.</p>}
                  {claimStreak.error && (
                    <p className="text-destructive">{claimStreak.error.message}</p>
                  )}
                </>
              }
              action={
                <>
                  <Confirm
                    title="Reset Streak"
                    button={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!awake || claimStreak.isPending}
                        className="w-full gap-1.5 hover:text-black"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                      </Button>
                    }
                    onAccept={(event) => {
                      event.preventDefault();
                      claimStreak.mutate({
                        configId: catchUpStreak.configId,
                        reset: true,
                      });
                    }}
                  >
                    <p>
                      Your streak will reset to day 1. Current progress (day{" "}
                      {catchUpStreak.currentDay}) will be lost.
                    </p>
                  </Confirm>
                  <RowAction
                    icon={Timer}
                    variant="default"
                    disabled={!awake || claimStreak.isPending}
                    onClick={() =>
                      claimStreak.mutate({
                        configId: catchUpStreak.configId,
                        payCatchUp: true,
                      })
                    }
                  >
                    {claimStreak.isPending ? "Claiming..." : "Catch up"}
                  </RowAction>
                </>
              }
            />
          )}
          {!catchUpStreak && claimableStreak && (
            <StatusRow
              label="Streak"
              title={`Day ${claimableStreak.nextDayNumber}`}
              detail={
                getRewardPreview(claimableStreak.nextRewards) ||
                "Claim today’s activity reward."
              }
              note={
                <>
                  {!awake && <p>You can claim this once you are awake.</p>}
                  {claimStreak.error && (
                    <p className="text-destructive">{claimStreak.error.message}</p>
                  )}
                </>
              }
              action={
                <RowAction
                  icon={Gift}
                  variant="default"
                  disabled={!awake || claimStreak.isPending}
                  onClick={() =>
                    claimStreak.mutate({ configId: claimableStreak.configId })
                  }
                >
                  {claimStreak.isPending ? "Claiming..." : "Claim"}
                </RowAction>
              }
            />
          )}
          {!catchUpStreak && !claimableStreak && recurringStreak && (
            <StatusRow
              label="Streak"
              title="Day 1"
              detail={recurringReward || "Claim today’s activity reward."}
              note={
                <>
                  {!awake && <p>You can claim this once you are awake.</p>}
                  {claimStreak.error && (
                    <p className="text-destructive">{claimStreak.error.message}</p>
                  )}
                </>
              }
              action={
                <RowAction
                  icon={Gift}
                  variant="default"
                  disabled={!awake || claimStreak.isPending}
                  onClick={() => claimStreak.mutate({ configId: recurringStreak.id })}
                >
                  {claimStreak.isPending ? "Claiming..." : "Claim"}
                </RowAction>
              }
            />
          )}
          {bankWaiting && (
            <StatusRow
              label="Bank"
              title={`${(interest.data?.totalPending ?? 0).toLocaleString()} ryo`}
              detail={
                pendingInterestDays > 0
                  ? `${pendingInterestDays} unclaimed ${pendingInterestDays === 1 ? "day" : "days"}`
                  : "Ready to collect"
              }
              note={
                claimInterest.error ? (
                  <p className="text-destructive">{claimInterest.error.message}</p>
                ) : null
              }
              action={
                <RowAction
                  icon={Coins}
                  variant="default"
                  disabled={!canClaimInterest || claimInterest.isPending}
                  onClick={() => claimInterest.mutate()}
                >
                  {claimInterest.isPending ? "Collecting..." : "Collect"}
                </RowAction>
              }
            />
          )}
          {claimableRaidRewards > 0 && (
            <StatusRow
              label="Raids"
              title={raidTitle}
              detail={`${claimableRaidRewards} ready`}
              action={
                <RowAction href="/globalanbuhq" icon={Swords}>
                  Open
                </RowAction>
              }
            />
          )}
          {training ? (
            <StatusRow
              label="Training"
              title={training.title}
              detail={
                training.endsAt ? (
                  <Countdown
                    targetDate={training.endsAt}
                    timeDiff={timeDiff}
                    onEndShow="Ready"
                  />
                ) : null
              }
              meter={
                training.startedAt && training.endsAt ? (
                  <ElapsedMeter
                    startedAt={training.startedAt}
                    endsAt={training.endsAt}
                    timeDiff={timeDiff}
                    onFinish={() => void sidebarTimers.refetch()}
                  />
                ) : null
              }
              action={
                <RowAction href="/traininggrounds" icon={Eye}>
                  View
                </RowAction>
              }
            />
          ) : canStartTraining ? (
            <StatusRow
              label="Training"
              title="Training grounds"
              action={
                <RowAction href="/traininggrounds" icon={Dumbbell}>
                  Train
                </RowAction>
              }
            />
          ) : null}
          <StatusRow
            label={occupationLine.label}
            title={occupationLine.title}
            detail={
              occupationLine.craftTimer && craftTimer ? (
                <Countdown
                  targetDate={craftTimer.endsAt}
                  timeDiff={timeDiff}
                  onEndShow="Ready"
                />
              ) : (
                occupationLine.detail
              )
            }
            progress={occupationLine.craftTimer ? null : occupationLine.progress}
            meter={
              occupationLine.craftTimer && craftTimer ? (
                <ElapsedMeter
                  startedAt={craftTimer.startedAt}
                  endsAt={craftTimer.endsAt}
                  timeDiff={timeDiff}
                  onFinish={() => void sidebarTimers.refetch()}
                />
              ) : null
            }
            action={
              <RowAction
                href="/occupation"
                icon={iconForRowAction(occupationLine.action)}
              >
                {occupationLine.action}
              </RowAction>
            }
          />
          {visibleCraftTimers.map((timer) => (
            <StatusRow
              key={`${timer.kind}-${timer.title}`}
              label={timer.label}
              title={timer.title}
              detail={
                <Countdown
                  targetDate={timer.endsAt}
                  timeDiff={timeDiff}
                  onEndShow="Ready"
                />
              }
              meter={
                <ElapsedMeter
                  startedAt={timer.startedAt}
                  endsAt={timer.endsAt}
                  timeDiff={timeDiff}
                  onFinish={() => void sidebarTimers.refetch()}
                />
              }
              action={
                <RowAction href={timer.href} icon={Eye}>
                  View
                </RowAction>
              }
            />
          ))}
          {sidebarTimers.isError && (
            <div className="border-t py-3">
              <RetryPanel
                message="Training and crafting timers could not be loaded."
                onRetry={() => void sidebarTimers.refetch()}
              />
            </div>
          )}
          <div className="border-t py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 min-w-12 shrink-0 flex-col items-center justify-center rounded-md border border-amber-600/50 bg-gradient-to-b from-amber-100 to-amber-200/60 px-2 shadow-sm dark:from-amber-950 dark:to-amber-900/50">
                <span className="font-semibold text-[8px] text-amber-900 uppercase leading-none tracking-wide dark:text-amber-200">
                  Level
                </span>
                <span className="mt-0.5 font-bold font-mono text-amber-950 text-base leading-none dark:text-amber-100">
                  {userData.level}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-amber-900 uppercase tracking-wide dark:text-amber-200">
                    XP
                  </span>
                  <span className="text-muted-foreground">
                    {canLevelUp
                      ? "Ready to level up"
                      : `${Number(experienceToGo.toFixed(0)).toLocaleString()} XP to go`}
                  </span>
                </div>
                <div className="relative">
                  <Progress
                    value={levelProgress}
                    aria-label={`Experience toward leveling up from level ${userData.level}`}
                    aria-valuenow={levelProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-3 rounded-sm border border-amber-900/30 bg-amber-950/10 shadow-inner dark:border-amber-300/25 dark:bg-black/30"
                    indicatorClassName="bg-gradient-to-r from-amber-700 via-amber-500 to-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-sm bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(12.5%-1px),rgba(120,53,15,0.25)_calc(12.5%-1px),rgba(120,53,15,0.25)_12.5%)]"
                  />
                </div>
              </div>
            </div>
            <LevelUpBtn id="tutorial-level-up-dashboard" />
          </div>
          {!claimsLoading && !claimsFailed && !hasCollectible && (
            <p className="border-t py-3 text-muted-foreground text-sm">
              Nothing to collect from the streak, the bank, or raids.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="catalogue-heading">
        <SectionHeader
          eyebrow="Opportunities"
          title="Available content"
          id="catalogue-heading"
          action={
            catalogue.length > previewContent.length ? (
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-foreground"
                onClick={() => setShowAllContent(true)}
              >
                View all content <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : showAllContent && catalogue.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-foreground"
                onClick={() => setShowAllContent(false)}
              >
                Show highlights
              </Button>
            ) : null
          }
        />
        {dashboard.isLoading && catalogue.length === 0 ? (
          <Loader explanation="Loading available content..." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {previewContent.map((entry) => (
              <ContentCard key={`${entry.category}-${entry.id}`} entry={entry} />
            ))}
            {previewContent.length === 0 && (
              <div className="col-span-full rounded-md border border-dashed p-5 text-muted-foreground text-sm">
                No discoverable content is published for your character right now.
              </div>
            )}
          </div>
        )}
        {dashboard.isError && (
          <RetryPanel
            message="Quest discovery could not be loaded. This is not the same as having no available content."
            onRetry={() => void dashboard.refetch()}
          />
        )}
      </section>

      <section aria-labelledby="progress-heading">
        <SectionHeader
          eyebrow="Your logbook"
          title="In progress"
          id="progress-heading"
        />
        <div className="overflow-hidden rounded-md border bg-card">
          {hasActiveQuests ? (
            <LogbookActive />
          ) : dashboard.isLoading ? (
            <Loader explanation="Finding your next activity..." />
          ) : recommended ? (
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Your logbook is clear.</p>
                <p className="text-muted-foreground text-sm">
                  A good next step is {recommended.name} in {recommended.location}.
                </p>
              </div>
              <Button asChild>
                <Link href={dashboardContentHref(recommended)}>View next activity</Link>
              </Button>
            </div>
          ) : (
            <div className="p-4 text-muted-foreground text-sm">
              No active activity or eligible recommendation is available right now.
            </div>
          )}
        </div>
        {activeRaids.length > 0 && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {activeRaids.map((raid) => (
              <Card key={raid.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-red-400" />
                    {raid.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{raid.damageDealt.toLocaleString()} damage dealt</p>
                  <p className="text-muted-foreground">
                    {raid.raidEndsAt
                      ? `Ends ${raid.raidEndsAt.toLocaleString()}`
                      : "No published deadline"}
                  </p>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="hover:text-black"
                  >
                    <Link href={raidContinueHref(raid.sector, userData.sector)}>
                      Continue raid
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  id,
  action,
}: {
  eyebrow: string;
  title: string;
  id: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <p className="font-mono text-primary text-xs uppercase tracking-[0.18em] dark:text-muted-foreground">
          {eyebrow}
        </p>
        <h2 id={id} className="font-bold text-2xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

const rowActionIcons = {
  "Start a job": Briefcase,
  "Pick a quest": ScrollText,
  "Open quest": BookOpen,
  View: Eye,
  "Start crafting": Hammer,
  Open: ArrowRight,
} as const;

const iconForRowAction = (action: string) =>
  action in rowActionIcons
    ? rowActionIcons[action as keyof typeof rowActionIcons]
    : ArrowRight;

function RowAction({
  href,
  icon: Icon,
  children,
  variant = "outline",
  disabled,
  onClick,
}: {
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  variant?: "default" | "outline";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className = cn("w-full gap-1.5", variant === "outline" && "hover:text-black");
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </>
  );
  if (href) {
    return (
      <Button asChild size="sm" variant={variant} className={className}>
        <Link href={href}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </Button>
  );
}

function StatusRow({
  label,
  title,
  detail,
  progress,
  meter,
  note,
  action,
}: {
  label: string;
  title: string;
  detail?: React.ReactNode;
  progress?: number | null;
  meter?: React.ReactNode;
  note?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-t py-3 first:border-t-0 sm:grid-cols-[7.5rem_minmax(0,1fr)_10rem] sm:items-center sm:gap-3">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {detail ? <div className="text-muted-foreground text-sm">{detail}</div> : null}
        {typeof progress === "number" ? (
          <Progress value={progress} className="mt-1.5 h-1.5" />
        ) : null}
        {meter}
        {note ? <div className="mt-1 text-muted-foreground text-xs">{note}</div> : null}
      </div>
      {action ? (
        <div className="flex w-full flex-col gap-2 [&>*]:w-full">{action}</div>
      ) : null}
    </div>
  );
}

function ElapsedMeter({
  startedAt,
  endsAt,
  timeDiff,
  onFinish,
}: {
  startedAt: Date;
  endsAt: Date;
  timeDiff: number;
  onFinish?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const hasFinishedRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const adjustedStart = startedAt.getTime() + timeDiff;
  const adjustedEnd = endsAt.getTime() + timeDiff;
  const duration = Math.max(adjustedEnd - adjustedStart, 1);
  const progress = Math.min(100, Math.max(0, ((now - adjustedStart) / duration) * 100));

  useEffect(() => {
    hasFinishedRef.current = false;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [adjustedStart, adjustedEnd]);

  useEffect(() => {
    if (progress < 100 || hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    onFinishRef.current?.();
  }, [progress]);

  return <Progress value={progress} className="mt-1.5 h-1.5" />;
}

function RetryPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span>{message}</span>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="hover:text-black"
          onClick={onRetry}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Retry
        </Button>
      )}
    </div>
  );
}

function ContentCard({ entry }: { entry: DashboardCatalogueEntry }) {
  const destination = dashboardContentHref(entry);
  const actionLabel = dashboardContentActionLabel(entry);
  return (
    <Card className="group overflow-hidden">
      <div className="relative aspect-[16/7] overflow-hidden bg-muted">
        {entry.image ? (
          <Image
            src={entry.image}
            alt=""
            width={640}
            height={280}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
      </div>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{categoryLabels[entry.category]}</Badge>
          <Badge
            variant="outline"
            className={cn(
              entry.availability === "available" && "border-green-500 text-green-500",
              entry.availability === "travel" && "border-amber-500 text-amber-500",
            )}
          >
            {entry.availability === "available" ? "Available here" : "Travel required"}
          </Badge>
        </div>
        <CardTitle className="text-base">{entry.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="line-clamp-3 text-muted-foreground">
          {plainText(entry.description) || "No description has been published."}
        </p>
        <p className="flex items-center gap-1 text-xs">
          <MapPin className="h-3.5 w-3.5" /> {entry.location}
        </p>
        {entry.endsAt && (
          <p className="text-muted-foreground text-xs">
            Available until {new Date(entry.endsAt).toLocaleString()}
          </p>
        )}
        {entry.availabilityReason && (
          <p className="text-muted-foreground text-xs">{entry.availabilityReason}</p>
        )}
        <Button
          asChild
          size="sm"
          variant="outline"
          className="mt-1 w-full hover:text-black"
        >
          <Link href={destination}>
            {actionLabel}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const plainText = (value: string | null) =>
  value
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
