"use client";

import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Dumbbell,
  Gift,
  Landmark,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Loader from "@/layout/Loader";
import { LogbookActive } from "@/layout/Logbook";
import { getRewardPreview } from "@/libs/objectives";
import { calcLevelRequirements, formatTrainingStatName } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { trainingSpeedSeconds } from "@/libs/train";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useRequiredUserData } from "@/utils/UserContext";
import type { DashboardContentSummary } from "@/validators/profileDashboard";

const categoryLabels = {
  events: "Events",
  missions: "Missions & crimes",
  story: "Story",
  battlePyramids: "Battle pyramids",
  raids: "Raids",
} as const;

type CatalogueEntry = Omit<DashboardContentSummary, "category"> & {
  category: DashboardContentSummary["category"] | "raids";
};

export default function ProfileDashboard() {
  const { data: userData, updateUser, timeDiff } = useRequiredUserData();
  const utils = api.useUtils();
  const [showAllContent, setShowAllContent] = useState(false);

  const dashboard = api.profile.getDashboard.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnMount: "always",
  });
  const streaks = api.activityStreak.getUserStreaks.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const interest = api.bank.getPendingInterest.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const sidebarTimers = api.profile.getSidebarTimers.useQuery(undefined, {
    staleTime: 30_000,
  });
  const raids = api.raids.getAvailableRaids.useQuery(undefined, {
    staleTime: 60_000,
  });

  const refreshDashboard = async () => {
    await Promise.allSettled([
      dashboard.refetch(),
      streaks.refetch(),
      interest.refetch(),
      raids.refetch(),
      utils.profile.getUser.invalidate(),
    ]);
  };

  const claimStreak = api.activityStreak.claimStreakDay.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) await refreshDashboard();
    },
  });
  const claimInterest = api.bank.claimInterest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && data.data) {
        await updateUser({ bank: data.data.bank });
        await refreshDashboard();
      }
    },
  });

  const claimableStreak = streaks.data?.streaks.find((streak) => streak.canClaimToday);
  const recurringStreak = streaks.data?.activeRecurringConfig;
  const streakConfigId = claimableStreak?.configId ?? recurringStreak?.id;
  const streakDay = claimableStreak?.nextDayNumber ?? (recurringStreak ? 1 : null);
  const streakReward = claimableStreak
    ? getRewardPreview(claimableStreak.nextRewards)
    : recurringStreak
      ? getRewardPreview(
          recurringStreak.rewards.find((reward) => reward.dayNumber === 1)?.rewards ??
            null,
        )
      : null;
  const canClaimStreak = !!streakConfigId && userData?.status === "AWAKE";
  const canClaimInterest =
    (interest.data?.totalPending ?? 0) > 0 && userData?.status !== "BATTLE";
  const canLevelUp =
    !!userData &&
    userData.level < 100 &&
    userData.experience >= calcLevelRequirements(userData.level);
  const canChooseOccupation = !userData?.occupation && userData?.status === "AWAKE";
  const claimableRaidRewards =
    dashboard.data?.raidRewards.reduce((sum, raid) => sum + raid.claimableCount, 0) ??
    0;
  const readyCount = [
    canClaimStreak,
    canClaimInterest,
    canLevelUp,
    canChooseOccupation,
    claimableRaidRewards > 0,
  ].filter(Boolean).length;

  const statTrainingEndsAt =
    userData?.trainingStartedAt && userData.currentlyTraining
      ? new Date(
          userData.trainingStartedAt.getTime() +
            trainingSpeedSeconds(userData.trainingSpeed) * 1000,
        )
      : null;
  const training = userData?.currentlyTraining
    ? {
        title: `${formatTrainingStatName(userData.currentlyTraining)} training`,
        startedAt: userData.trainingStartedAt,
        endsAt: statTrainingEndsAt,
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
            label: `Crafting ${sidebarTimers.data.crafting.itemName}`,
            startedAt: sidebarTimers.data.crafting.craftingStartedAt,
            endsAt: sidebarTimers.data.crafting.craftingFinishedAt,
          },
        ]
      : []),
    ...(sidebarTimers.data?.imbuement
      ? [
          {
            label: `Imbuing ${sidebarTimers.data.imbuement.targetName}`,
            startedAt: sidebarTimers.data.imbuement.craftingStartedAt,
            endsAt: sidebarTimers.data.imbuement.craftingFinishedAt,
          },
        ]
      : []),
  ];

  const catalogue = useMemo<CatalogueEntry[]>(() => {
    const quests = dashboard.data?.content ?? [];
    const raidEntries: CatalogueEntry[] = (raids.data?.raids ?? []).map((raid) => {
      const travelRequired =
        raid.raidSector !== null && raid.raidSector !== userData?.sector;
      return {
        id: raid.id,
        name: raid.name,
        description: raid.description,
        image: raid.image,
        category: "raids",
        questType: "raid",
        rank: "RAID",
        location:
          raid.raidSector === null ? "Global ANBU HQ" : `Sector ${raid.raidSector}`,
        destination: travelRequired ? "/travel" : "/globalanbuhq",
        availability: travelRequired ? "travel" : "available",
        availabilityReason: travelRequired
          ? `Travel to sector ${raid.raidSector} to participate`
          : null,
        startsAt: null,
        endsAt: raid.raidEndsAt?.toISOString() ?? null,
      };
    });
    const categoryOrder = ["events", "missions", "story", "battlePyramids", "raids"];
    const availabilityOrder = { available: 0, travel: 1, locked: 2 };
    return [...quests, ...raidEntries].sort(
      (left, right) =>
        categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
        availabilityOrder[left.availability] - availabilityOrder[right.availability] ||
        left.name.localeCompare(right.name),
    );
  }, [dashboard.data?.content, raids.data?.raids, userData?.sector]);

  const previewContent = useMemo(() => {
    if (showAllContent) return catalogue;
    const seen = new Set<string>();
    return catalogue.filter((entry) => {
      if (seen.has(entry.category)) return false;
      seen.add(entry.category);
      return true;
    });
  }, [catalogue, showAllContent]);

  useEffect(() => {
    const timestamps = catalogue
      .flatMap((entry) => [entry.startsAt, entry.endsAt])
      .filter((date): date is string => !!date)
      .map((date) => new Date(date).getTime() + (timeDiff ?? 0))
      .filter((timestamp) => timestamp > Date.now());
    if (timestamps.length === 0) return;
    const nextBoundary = Math.min(...timestamps);
    const timeout = window.setTimeout(
      () => void Promise.allSettled([dashboard.refetch(), raids.refetch()]),
      Math.min(nextBoundary - Date.now() + 1_000, 2_147_000_000),
    );
    return () => window.clearTimeout(timeout);
  }, [catalogue, dashboard.refetch, raids.refetch, timeDiff]);

  if (!userData) return <Loader explanation="Loading your logbook..." />;

  const hasActiveQuests = userData.userQuests.some(
    (entry) => !["tier", "achievement"].includes(entry.quest.questType),
  );
  const activeRaids = (raids.data?.raids ?? []).filter(
    (raid) => raid.userParticipation,
  );
  const recommended = catalogue.find((entry) => entry.availability === "available");

  return (
    <div className="space-y-8 p-3 sm:p-4">
      <section aria-labelledby="priority-heading">
        <SectionHeader
          eyebrow="Priority queue"
          title="Claim before you roam"
          id="priority-heading"
          aside={`${readyCount} ${readyCount === 1 ? "action" : "actions"} ready`}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PriorityCard
            icon={Gift}
            label="Reward"
            title="Activity streak"
            accent="amber"
            isLoading={streaks.isLoading}
            error={streaks.error?.message}
            onRetry={() => void streaks.refetch()}
          >
            {streakDay ? (
              <>
                <p>Day {streakDay} is ready.</p>
                <p className="text-muted-foreground text-xs">
                  {streakReward || "Claim today’s activity reward."}
                </p>
                <Button
                  className="mt-auto w-full"
                  disabled={!canClaimStreak || claimStreak.isPending}
                  onClick={() =>
                    streakConfigId && claimStreak.mutate({ configId: streakConfigId })
                  }
                >
                  {claimStreak.isPending ? "Claiming..." : `Claim day ${streakDay}`}
                </Button>
                {claimStreak.error && (
                  <p className="text-destructive text-xs">
                    {claimStreak.error.message}
                  </p>
                )}
              </>
            ) : (
              <EmptyPriority text="Today’s streak reward is already handled." />
            )}
          </PriorityCard>

          <PriorityCard
            icon={Landmark}
            label="Bank"
            title="Pending interest"
            accent="blue"
            isLoading={interest.isLoading}
            error={interest.error?.message}
            onRetry={() => void interest.refetch()}
          >
            {(interest.data?.totalPending ?? 0) > 0 ? (
              <>
                <p className="font-semibold text-lg">
                  +{interest.data?.totalPending.toLocaleString()} ryo
                </p>
                <p className="text-muted-foreground text-xs">
                  Across {interest.data?.records.length} unclaimed daily records.
                </p>
                <Button
                  className="mt-auto w-full"
                  disabled={!canClaimInterest || claimInterest.isPending}
                  onClick={() => claimInterest.mutate()}
                >
                  {claimInterest.isPending ? "Collecting..." : "Collect interest"}
                </Button>
                {claimInterest.error && (
                  <p className="text-destructive text-xs">
                    {claimInterest.error.message}
                  </p>
                )}
              </>
            ) : (
              <EmptyPriority text="No bank interest is waiting." />
            )}
          </PriorityCard>

          <PriorityCard
            icon={Trophy}
            label="Raids"
            title="Earned rewards"
            accent="red"
            isLoading={dashboard.isLoading}
            error={dashboard.error?.message}
            onRetry={() => void dashboard.refetch()}
          >
            {claimableRaidRewards > 0 ? (
              <>
                <p className="font-semibold text-lg">
                  {claimableRaidRewards} threshold reward
                  {claimableRaidRewards === 1 ? "" : "s"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {dashboard.data?.raidRewards.map((raid) => raid.raidName).join(", ")}
                </p>
                <Button asChild className="mt-auto w-full">
                  <Link href="/globalanbuhq">Open raid rewards</Link>
                </Button>
              </>
            ) : (
              <EmptyPriority text="No raid threshold rewards are ready." />
            )}
          </PriorityCard>

          <PriorityCard
            icon={Dumbbell}
            label="Training"
            title={training?.title ?? "Training grounds"}
            accent="red"
          >
            <p className="text-muted-foreground text-xs">
              {training?.endsAt
                ? `Current session ends ${training.endsAt.toLocaleString()}.`
                : "No stat or jutsu training is active."}
            </p>
            {training?.startedAt && training.endsAt && (
              <TimerProgress
                label="Training progress"
                startedAt={training.startedAt}
                endsAt={training.endsAt}
                timeDiff={timeDiff}
                onFinish={() => void sidebarTimers.refetch()}
              />
            )}
            <Button
              asChild
              variant="outline"
              className="mt-auto w-full hover:text-black"
            >
              <Link href="/traininggrounds">
                {training ? "View training" : "Start training"}
              </Link>
            </Button>
          </PriorityCard>

          <PriorityCard
            icon={BriefcaseBusiness}
            label="Occupation"
            title={
              userData.occupation
                ? capitalizeFirstLetter(userData.occupation)
                : "Choose an occupation"
            }
            accent="amber"
          >
            <p className="text-muted-foreground text-xs">
              {sidebarTimers.data?.crafting
                ? `${sidebarTimers.data.crafting.itemName} is being crafted.`
                : userData.occupation
                  ? "Continue your work and check collection readiness."
                  : "Select a profession to unlock steady work and rewards."}
            </p>
            {craftingTimers.map((timer) => (
              <TimerProgress
                key={`${timer.label}-${timer.endsAt.toISOString()}`}
                label={timer.label}
                startedAt={timer.startedAt}
                endsAt={timer.endsAt}
                timeDiff={timeDiff}
                onFinish={() => void sidebarTimers.refetch()}
              />
            ))}
            <Button
              asChild
              variant="outline"
              className="mt-auto w-full hover:text-black"
            >
              <Link href="/occupation">
                {userData.occupation ? "Continue work" : "Start a job"}
              </Link>
            </Button>
          </PriorityCard>

          <PriorityCard
            icon={Sparkles}
            label="Growth"
            title={canLevelUp ? "Level up ready" : `Level ${userData.level}`}
            accent="blue"
          >
            <p className="text-muted-foreground text-xs">
              {canLevelUp
                ? "You have enough experience for your next level."
                : `${Math.max(calcLevelRequirements(userData.level) - userData.experience, 0).toFixed(0)} experience until your next level.`}
            </p>
            <div className="mt-auto">
              <LevelUpBtn id="tutorial-level-up-dashboard" />
            </div>
          </PriorityCard>
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
        {(dashboard.isLoading || raids.isLoading) && catalogue.length === 0 ? (
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
        {raids.isError && (
          <RetryPanel
            message="Raid availability could not be loaded; other categories are still shown."
            onRetry={() => void raids.refetch()}
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
                <Link href={recommended.destination}>View next activity</Link>
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
                  <p>
                    {(raid.userParticipation?.damageDealt ?? 0).toLocaleString()} damage
                    dealt
                  </p>
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
                    <Link
                      href={
                        raid.raidSector === userData.sector
                          ? "/globalanbuhq"
                          : "/travel"
                      }
                    >
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
  aside,
  action,
}: {
  eyebrow: string;
  title: string;
  id: string;
  aside?: string;
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
      {aside && <Badge variant="outline">{aside}</Badge>}
      {action}
    </div>
  );
}

function PriorityCard({
  icon: Icon,
  label,
  title,
  accent,
  isLoading,
  error,
  onRetry,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  accent: "amber" | "blue" | "red";
  isLoading?: boolean;
  error?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "flex min-h-56 flex-col border-t-2",
        accent === "amber" && "border-t-amber-400",
        accent === "blue" && "border-t-sky-400",
        accent === "red" && "border-t-red-400",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 font-mono text-muted-foreground text-xs uppercase tracking-wider">
          <Icon className="h-4 w-4" /> {label}
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 text-sm">
        {isLoading ? (
          <Loader explanation={`Loading ${label.toLowerCase()}...`} />
        ) : error ? (
          <RetryPanel message={error} onRetry={onRetry} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function EmptyPriority({ text }: { text: string }) {
  return <p className="text-muted-foreground text-sm">{text}</p>;
}

function TimerProgress({
  label,
  startedAt,
  endsAt,
  timeDiff,
  onFinish,
}: {
  label: string;
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

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {Math.round(progress)}% ·{" "}
          <Countdown targetDate={endsAt} timeDiff={timeDiff} onEndShow="Ready" />
        </span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
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

function ContentCard({ entry }: { entry: CatalogueEntry }) {
  const routesThroughWakeIsland =
    entry.category === "events" || entry.category === "story";
  const destination =
    entry.category === "battlePyramids"
      ? "/battlearena#Battle%20Pyramid"
      : routesThroughWakeIsland || entry.availability === "travel"
        ? "/travel"
        : entry.destination;
  const actionLabel = routesThroughWakeIsland
    ? "Go to Wake Island"
    : entry.availability === "travel"
      ? "Open travel"
      : entry.availability === "locked"
        ? "View requirements"
        : "Open content";
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
              entry.availability === "locked" && "border-muted-foreground",
            )}
          >
            {entry.availability === "available"
              ? "Available here"
              : entry.availability === "travel"
                ? "Travel required"
                : "Locked"}
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
