"use client";

import {
  Check,
  CirclePlay,
  Clock,
  DoorOpen,
  Gift,
  History,
  Loader2,
  MapPin,
  Skull,
  Swords,
  TimerOff,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  RAID_BATTLE_LOBBY_SECONDS,
  RAID_BATTLE_MAX_USERS_PER_TEAM,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { getRewardArray } from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { calculatePercent } from "@/utils/math";
import { secondsFromDate } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

interface RaidBrowserProps {
  title?: string;
  subtitle?: string;
  initialBreak?: boolean;
  viewOnly?: boolean;
  sectorFilter?: number;
}

const RaidBrowser: React.FC<RaidBrowserProps> = (props) => {
  const {
    title = "Raids",
    subtitle = "Global ANBU HQ",
    initialBreak = true,
    viewOnly = false,
    sectorFilter,
  } = props;
  const util = api.useUtils();

  // State
  const [selectedRaidId, setSelectedRaidId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"active" | "history">("active");
  const { data: userData, pusher } = useRequiredUserData();

  // Queries
  const { data: availableRaidsData, isFetching: raidsFetching } =
    api.raids.getAvailableRaids.useQuery(
      sectorFilter !== undefined ? { sector: sectorFilter } : undefined,
      { enabled: !!userData && viewMode === "active" },
    );

  const { data: completedRaidsData, isFetching: completedFetching } =
    api.raids.getCompletedRaids.useQuery(undefined, {
      enabled: !!userData && viewMode === "history",
    });

  const { data: userQueueData, isFetching: queueFetching } =
    api.raids.getUserRaidQueue.useQuery(undefined, {
      enabled: !!userData,
    });

  const { data: userBuffsData } = api.raids.getUserRaidBuffs.useQuery(undefined, {
    enabled: !!userData,
  });

  const { data: raidDetailsData } = api.raids.getRaidDetails.useQuery(
    { questId: selectedRaidId ?? "" },
    { enabled: !!selectedRaidId },
  );

  const { data: leaderboardData } = api.raids.getRaidLeaderboard.useQuery(
    { questId: selectedRaidId ?? "", limit: 10 },
    { enabled: !!selectedRaidId, refetchInterval: 10000 },
  );

  const { data: activeTeamsData } = api.raids.getActiveRaidTeams.useQuery(
    { questId: selectedRaidId ?? "" },
    { enabled: !!selectedRaidId },
  );

  // Mutations
  const { mutate: joinQueue, isPending: joinPending } =
    api.raids.joinRaidQueue.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        void util.raids.getUserRaidQueue.invalidate();
        void util.raids.getActiveRaidTeams.invalidate();
        void util.profile.getUser.invalidate();
      },
    });

  const { mutate: leaveQueue, isPending: leavePending } =
    api.raids.leaveRaidQueue.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        void util.raids.getUserRaidQueue.invalidate();
        void util.raids.getActiveRaidTeams.invalidate();
        void util.profile.getUser.invalidate();
      },
    });

  const { mutate: startBattle, isPending: startPending } =
    api.raids.startRaidBattle.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        void util.raids.getUserRaidQueue.invalidate();
        void util.raids.getRaidDetails.invalidate();
        void util.profile.getUser.invalidate();
      },
    });

  const { mutate: claimReward, isPending: claimPending } =
    api.raids.claimDamageReward.useMutation({
      onSuccess: (data) => {
        if (data.success && "rewards" in data && data.rewards) {
          showRewardToast([], data.rewards, data.message);
        } else {
          showMutationToast(data);
        }
        void util.raids.getRaidDetails.invalidate();
        void util.profile.getUser.invalidate();
      },
    });

  // Event handlers
  const handleRaidSelect = (raidId: string) => {
    setSelectedRaidId((prev) => (prev === raidId ? null : raidId));
  };

  const handleJoinQueue = (teamId?: string) => {
    if (selectedRaidId) {
      joinQueue({ questId: selectedRaidId, teamId });
    }
  };

  const handleLeaveQueue = () => {
    leaveQueue();
  };

  const handleStartBattle = () => {
    if (userQueueData?.queue?.id) {
      startBattle({ teamId: userQueueData.queue.id });
    }
  };

  const handleClaimReward = (thresholdId: string) => {
    if (selectedRaidId) {
      claimReward({ questId: selectedRaidId, thresholdId });
    }
  };

  // Extract data from response objects
  const availableRaids = useMemo(
    () => availableRaidsData?.raids ?? [],
    [availableRaidsData?.raids],
  );
  const completedRaids = useMemo(
    () => completedRaidsData?.raids ?? [],
    [completedRaidsData?.raids],
  );
  const displayedRaids = viewMode === "active" ? availableRaids : completedRaids;
  const userQueue = userQueueData?.inQueue ? userQueueData.queue : null;
  const userQueueIsClaiming = userQueueData?.isClaiming ?? false;
  const userBuffs = userBuffsData?.buffs ?? [];
  const raidDetails = raidDetailsData?.raid;
  const participation = raidDetailsData?.participation;
  const thresholds = raidDetailsData?.thresholds ?? [];
  const leaderboard = leaderboardData?.participations ?? [];
  const activeTeams = activeTeamsData?.teams ?? [];
  const maxTeams = activeTeamsData?.maxTeams ?? 5;

  // Auto-select the only raid when sectorFilter is provided and there's exactly one raid
  useEffect(() => {
    if (
      sectorFilter !== undefined &&
      availableRaids.length === 1 &&
      availableRaids[0]
    ) {
      setSelectedRaidId(availableRaids[0].id);
    }
  }, [availableRaids, sectorFilter]);

  // Subscribe to Pusher for real-time raid updates (team changes and availability changes)
  useEffect(() => {
    // Determine the sector to subscribe to
    const sector = sectorFilter ?? userData?.sector;
    if (!pusher || sector === undefined || sector === null) return;

    const channel = pusher.subscribe(sector.toString());
    channel.bind("raidTeamUpdate", () => {
      void util.raids.getActiveRaidTeams.invalidate();
      void util.raids.getUserRaidQueue.invalidate();
    });
    channel.bind("raidAvailabilityChange", () => {
      void util.raids.getAvailableRaids.invalidate();
      void util.raids.getRaidDetails.invalidate();
    });

    return () => {
      pusher.unsubscribe(sector.toString());
    };
  }, [pusher, sectorFilter, userData?.sector, util.raids]);

  // Loading state
  const isLoading =
    (viewMode === "active" && raidsFetching && !availableRaidsData) ||
    (viewMode === "history" && completedFetching && !completedRaidsData);

  if (isLoading) {
    return <Loader explanation="Loading raids..." />;
  }

  if (!userData) {
    return null;
  }

  // Check if user is in a queue for the selected raid
  const userInSelectedRaidQueue = userQueue?.questId === selectedRaidId;

  // Check if viewing a completed raid (from history)
  const selectedCompletedRaid = completedRaids.find((r) => r.id === selectedRaidId);
  const isViewingCompletedRaid = viewMode === "history" || !!selectedCompletedRaid;

  // Hide raid selector when there's only one raid in sector-filtered mode
  const hideSelectorCard =
    sectorFilter !== undefined && availableRaids.length === 1 && viewMode === "active";

  // Handle view mode switch - clear selection
  const handleViewModeChange = (mode: "active" | "history") => {
    setViewMode(mode);
    setSelectedRaidId(null);
  };

  return (
    <>
      {/* Available Raids List - hidden when only one raid in filtered mode */}
      {!hideSelectorCard && (
        <ContentBox
          title={title}
          subtitle={subtitle}
          initialBreak={initialBreak}
          padding={false}
        >
          <div className="p-3">
            {/* View Mode Tabs */}
            <div className="mb-4 flex gap-2">
              <Button
                variant={viewMode === "active" ? "default" : "outline"}
                size="sm"
                onClick={() => handleViewModeChange("active")}
                className="flex items-center gap-2"
              >
                <Swords className="h-4 w-4" />
                Active Raids
              </Button>
              <Button
                variant={viewMode === "history" ? "default" : "outline"}
                size="sm"
                onClick={() => handleViewModeChange("history")}
                className="flex items-center gap-2"
              >
                <History className="h-4 w-4" />
                Raid History
              </Button>
            </div>

            <p className="mb-4 text-muted-foreground text-sm">
              {viewMode === "active"
                ? "Raids are cooperative boss battles where multiple teams fight to deal damage to a shared boss. Damage-based rewards are available to participants."
                : "View completed raids, check leaderboards, and claim any unclaimed rewards from raids you participated in."}
            </p>

            {displayedRaids.length > 0 ? (
              <div className="grid gap-3">
                {displayedRaids.map((raid) => {
                  const healthPercent = calculatePercent(
                    raid.raidBossCurrentHealth ?? 0,
                    raid.raidBossMaxHealth ?? 0,
                  );
                  const isCompleted = "completionStatus" in raid;
                  const completionStatus = isCompleted
                    ? (raid as (typeof completedRaids)[number]).completionStatus
                    : null;

                  return (
                    <button
                      type="button"
                      key={raid.id}
                      className={`w-full cursor-pointer rounded-lg border p-4 text-left transition-colors ${selectedRaidId === raid.id ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                      onClick={() => handleRaidSelect(raid.id)}
                      aria-pressed={selectedRaidId === raid.id}
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <div className="flex flex-col gap-1">
                          <h3 className="font-medium">{raid.name}</h3>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${raid.raidType === "open" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"}`}
                            >
                              {raid.raidType === "open"
                                ? "Open Raid"
                                : "Exclusive Raid"}
                            </span>
                            {isCompleted && (
                              <span
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${completionStatus === "boss_defeated" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}
                              >
                                {completionStatus === "boss_defeated" ? (
                                  <>
                                    <Skull className="h-3 w-3" />
                                    Boss Defeated
                                  </>
                                ) : (
                                  <>
                                    <TimerOff className="h-3 w-3" />
                                    Time Expired
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        <Swords className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-muted-foreground text-sm">
                          <span>Boss HP</span>
                          <span>{healthPercent.toFixed(1)}%</span>
                        </div>
                        <Progress value={healthPercent} className="h-2" />
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        {raid.raidSector !== null && (
                          <div className="flex items-center gap-1 text-muted-foreground text-xs">
                            <MapPin className="h-3 w-3" />
                            <span>Sector {raid.raidSector}</span>
                          </div>
                        )}
                        {raid.raidEndsAt && (
                          <p className="text-muted-foreground text-xs">
                            {isCompleted ? (
                              <>
                                Ended: {new Date(raid.raidEndsAt).toLocaleDateString()}
                              </>
                            ) : (
                              <Countdown
                                targetDate={new Date(raid.raidEndsAt)}
                                timeDiff={0}
                                onEndShow="Ended"
                              />
                            )}
                          </p>
                        )}
                      </div>

                      {/* Show if user participated in completed raid */}
                      {isCompleted && raid.userParticipation && (
                        <div className="mt-2 border-t pt-2 text-muted-foreground text-xs">
                          You dealt{" "}
                          <span className="font-medium text-foreground">
                            {raid.userParticipation.damageDealt.toLocaleString()}
                          </span>{" "}
                          damage
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-muted-foreground">
                {viewMode === "active"
                  ? "No raids are currently available."
                  : "No completed raids found."}
              </p>
            )}
          </div>
        </ContentBox>
      )}

      {/* Selected Raid Details */}
      {selectedRaidId && raidDetails && (
        <ContentBox
          title={raidDetails.name}
          subtitle={`${raidDetails.raidType === "open" ? "Open" : "Exclusive"} Raid`}
          initialBreak={true}
        >
          <div className="space-y-4">
            {/* Completed Raid Banner */}
            {isViewingCompletedRaid && (
              <div
                className={`flex items-center gap-2 rounded-lg p-3 ${(raidDetails.raidBossCurrentHealth ?? 0) <= 0 ? "border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"}`}
              >
                {(raidDetails.raidBossCurrentHealth ?? 0) <= 0 ? (
                  <>
                    <Skull className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="font-medium text-emerald-900 dark:text-emerald-100">
                        Raid Completed - Boss Defeated!
                      </p>
                      <p className="text-emerald-700 text-sm dark:text-emerald-300">
                        The raid boss was successfully defeated. Claim your rewards
                        below!
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <TimerOff className="h-5 w-5 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="font-medium text-red-900 dark:text-red-100">
                        Raid Ended - Time Expired
                      </p>
                      <p className="text-red-700 text-sm dark:text-red-300">
                        The raid timer ran out before the boss was defeated. You can
                        still claim any rewards you earned!
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Boss Health Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Boss Health</span>
                <span>
                  {raidDetails.raidBossCurrentHealth?.toLocaleString() ?? 0} /{" "}
                  {raidDetails.raidBossMaxHealth?.toLocaleString() ?? 0}
                </span>
              </div>
              <Progress
                value={calculatePercent(
                  raidDetails.raidBossCurrentHealth ?? 0,
                  raidDetails.raidBossMaxHealth ?? 0,
                )}
                className="h-3"
              />
            </div>

            {/* Raid Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {!isViewingCompletedRaid && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>
                    Active Teams: {activeTeams.length} / {maxTeams}
                  </span>
                </div>
              )}
              {raidDetails.raidEndsAt && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {isViewingCompletedRaid ? (
                    <span>
                      Ended: {new Date(raidDetails.raidEndsAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <Countdown
                      targetDate={new Date(raidDetails.raidEndsAt)}
                      timeDiff={0}
                      onEndShow="Ended"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Exclusive Raid Info - only show for active raids */}
            {raidDetails.raidType === "exclusive" && !isViewingCompletedRaid && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                <p className="mb-1 font-medium text-amber-900 dark:text-amber-100">
                  Exclusive Raid Stakes
                </p>
                <p className="text-amber-800 dark:text-amber-200">
                  Only your village can participate. Defeat the boss to{" "}
                  <strong>keep the sector shrine</strong>. If the boss is not defeated
                  before the deadline, the sector will become{" "}
                  <strong>neutral (Syndicate control)</strong>.
                </p>
              </div>
            )}

            {/* User participation stats */}
            {participation && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm">
                  <strong>Your stats:</strong>{" "}
                  {participation.damageDealt.toLocaleString()} damage dealt in{" "}
                  {participation.battleCount} battles
                </p>
              </div>
            )}

            {/* Raid Teams Display - Shows all active teams (only for active raids) */}
            {!isViewingCompletedRaid &&
              (viewOnly ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                  <div className="flex items-center gap-2 text-blue-900 dark:text-blue-100">
                    <MapPin className="h-5 w-5" />
                    <p className="text-sm">
                      {raidDetails.raidSector !== null
                        ? `Travel to sector ${raidDetails.raidSector} to join this raid.`
                        : "This raid requires you to be in a specific sector to join."}
                    </p>
                  </div>
                </div>
              ) : (
                <RaidTeamsDisplay
                  activeTeams={activeTeams}
                  maxTeams={maxTeams}
                  userId={userData.userId}
                  userInQueue={userInSelectedRaidQueue}
                  userTeamIsClaiming={userQueueIsClaiming}
                  onJoinTeam={handleJoinQueue}
                  onCreateTeam={() => handleJoinQueue()}
                  onLeave={handleLeaveQueue}
                  onStart={handleStartBattle}
                  isJoining={joinPending || queueFetching}
                  isLeaving={leavePending}
                  isStarting={startPending}
                />
              ))}

            {/* Reward Thresholds */}
            {thresholds.length > 0 && (
              <div className="rounded-lg border p-3">
                <h4 className="mb-2 flex items-center gap-2 font-medium">
                  <Gift className="h-4 w-4" />
                  Damage Thresholds
                </h4>
                <div className="space-y-2">
                  {thresholds.map((threshold, idx) => {
                    const userDamage = participation?.damageDealt ?? 0;
                    const hasMetThreshold = userDamage >= threshold.damageRequired;
                    const rewardsClaimed = participation?.rewardsClaimed ?? [];
                    const alreadyClaimed = rewardsClaimed.includes(threshold.id);
                    const rewardList = getRewardArray(threshold.rewards);

                    return (
                      <div
                        key={threshold.id}
                        className={`rounded border p-3 text-sm ${hasMetThreshold && !alreadyClaimed ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : "border-transparent"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span
                                className={`font-medium ${hasMetThreshold ? "text-green-600 dark:text-green-400" : ""}`}
                              >
                                Tier {idx + 1}:{" "}
                                {threshold.damageRequired.toLocaleString()} damage
                              </span>
                            </div>
                            {rewardList.length > 0 && (
                              <p className="text-muted-foreground text-xs">
                                {rewardList.join(" • ")}
                              </p>
                            )}
                          </div>
                          <div className="ml-2 flex items-center gap-2">
                            {alreadyClaimed ? (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Check className="h-4 w-4" />
                                Claimed
                              </span>
                            ) : hasMetThreshold ? (
                              <Button
                                size="sm"
                                onClick={() => handleClaimReward(threshold.id)}
                                disabled={claimPending}
                              >
                                <Gift className="mr-1 h-3 w-3" />
                                {claimPending ? "Claiming..." : "Claim"}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {Math.max(
                                  0,
                                  threshold.damageRequired - userDamage,
                                ).toLocaleString()}{" "}
                                more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Leaderboard */}
            {leaderboard.length > 0 && (
              <div className="rounded-lg border p-3">
                <h4 className="mb-2 flex items-center gap-2 font-medium">
                  <Trophy className="h-4 w-4" />
                  Damage Leaderboard
                </h4>
                <div className="space-y-2">
                  {leaderboard.map((entry) => {
                    const username = entry.user?.username ?? "Deleted User";
                    const avatar = entry.user?.avatar ?? null;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between rounded bg-muted/50 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 font-bold">{entry.rank}</span>
                          <AvatarImage
                            href={avatar}
                            alt={username}
                            size={24}
                            className="h-6 w-6"
                          />
                          <span className="text-sm">{username}</span>
                        </div>
                        <span className="font-medium text-sm">
                          {entry.damageDealt.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ContentBox>
      )}

      {/* Active Buffs */}
      {userBuffs.length > 0 && (
        <ContentBox title="Active Raid Buffs" subtitle="From raids" initialBreak={true}>
          <div className="grid gap-2">
            {userBuffs.map((buff) => {
              const genericBuff: GenericObject = {
                id: buff.id,
                name: buff.quest?.name ?? "Raid Buff",
                description: `Expires: ${new Date(buff.expiresAt).toLocaleString()}`,
                image: buff.quest?.image ?? undefined,
                effects: buff.effects,
                createdAt: buff.createdAt,
                updatedAt: buff.createdAt,
              };
              return (
                <ItemWithEffects
                  key={buff.id}
                  item={genericBuff}
                  hideDetails
                  hideDates
                  hideData
                />
              );
            })}
          </div>
        </ContentBox>
      )}
    </>
  );
};

// --- RaidTeamsDisplay Component ---

interface RaidTeamMember {
  slot: number;
  visibleId: string;
  username: string;
  avatar: string | null;
}

interface RaidTeam {
  id: string;
  createdAt: Date;
  members: RaidTeamMember[];
  canJoin: boolean;
  isClaiming?: boolean;
}

interface RaidTeamsDisplayProps {
  activeTeams: RaidTeam[];
  maxTeams: number;
  userId: string;
  userInQueue: boolean;
  userTeamIsClaiming: boolean;
  onJoinTeam: (teamId: string) => void;
  onCreateTeam: () => void;
  onLeave: () => void;
  onStart: () => void;
  isJoining: boolean;
  isLeaving: boolean;
  isStarting: boolean;
}

const RaidTeamsDisplay: React.FC<RaidTeamsDisplayProps> = ({
  activeTeams,
  maxTeams,
  userId,
  userInQueue,
  userTeamIsClaiming,
  onJoinTeam,
  onCreateTeam,
  onLeave,
  onStart,
  isJoining,
  isLeaving,
  isStarting,
}) => {
  // Check if user can create a new team
  const canCreateNewTeam = activeTeams.length < maxTeams && !userInQueue;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Users className="h-4 w-4 text-orange-500" />
          <span>
            Active Teams ({activeTeams.length}/{maxTeams})
          </span>
        </div>
        {canCreateNewTeam && (
          <Button size="sm" onClick={onCreateTeam} disabled={isJoining}>
            <Swords className="mr-2 h-4 w-4" />
            {isJoining ? "Creating..." : "Create Team"}
          </Button>
        )}
      </div>

      {/* Teams List */}
      {activeTeams.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-center">
          <p className="mb-3 text-muted-foreground text-sm">
            No active teams. Create a team to start fighting the raid boss!
          </p>
          {!userInQueue && (
            <Button onClick={onCreateTeam} disabled={isJoining}>
              <Swords className="mr-2 h-4 w-4" />
              {isJoining ? "Creating..." : "Create Team"}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {activeTeams.map((team) => {
            const isUserTeam = team.members.some((m) => m.visibleId === userId);
            const isUserLeader =
              team.members.find((m) => m.visibleId === userId)?.slot === 0;
            const startTime = secondsFromDate(
              RAID_BATTLE_LOBBY_SECONDS,
              team.createdAt,
            );
            const emptySlots = RAID_BATTLE_MAX_USERS_PER_TEAM - team.members.length;

            return (
              <div
                key={team.id}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-sm",
                  isUserTeam &&
                    "border-orange-500 bg-orange-50/50 dark:bg-orange-950/20",
                )}
              >
                {/* Team Header */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <span>
                      {isUserTeam ? "Your Team" : "Team"} ({team.members.length}/
                      {RAID_BATTLE_MAX_USERS_PER_TEAM})
                    </span>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    <Countdown targetDate={startTime} timeDiff={0} onEndShow="Ready!" />
                  </div>
                </div>

                {/* Team Slots */}
                <div className="mb-4 flex flex-wrap gap-2">
                  {team.members.map((member) => (
                    <RaidUserSlot
                      key={member.visibleId}
                      username={member.username}
                      avatar={member.avatar}
                      isLeader={member.slot === 0}
                    />
                  ))}
                  {Array.from({ length: emptySlots }).map((_, emptyIdx) => (
                    <RaidEmptySlot
                      key={`empty-slot-${team.id}-${emptyIdx}`}
                      canJoin={team.canJoin && !userInQueue}
                      onJoin={() => onJoinTeam(team.id)}
                      isJoining={isJoining}
                    />
                  ))}
                </div>

                {/* Action Buttons for user's team */}
                {isUserTeam && (
                  <div className="flex flex-col items-center gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    {/* Show claiming state message */}
                    {userTeamIsClaiming && (
                      <div className="mr-auto flex items-center gap-2 text-amber-600 text-sm dark:text-amber-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Starting battle...</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onLeave}
                        disabled={isLeaving}
                      >
                        <DoorOpen className="mr-1 h-4 w-4" />
                        {isLeaving ? "Leaving..." : "Leave"}
                      </Button>

                      {isUserLeader && !userTeamIsClaiming && (
                        <Button size="sm" onClick={onStart} disabled={isStarting}>
                          {isStarting ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <CirclePlay className="mr-1 h-4 w-4" />
                          )}
                          Start Battle
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Join button for other teams with space */}
                {!isUserTeam && team.canJoin && !userInQueue && (
                  <div className="flex justify-end border-t pt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onJoinTeam(team.id)}
                      disabled={isJoining}
                    >
                      <Users className="mr-1 h-4 w-4" />
                      {isJoining ? "Joining..." : "Join Team"}
                    </Button>
                  </div>
                )}

                {/* Info for non-leaders */}
                {isUserTeam && !isUserLeader && !userTeamIsClaiming && (
                  <p className="mt-2 text-center text-muted-foreground text-xs">
                    Waiting for team leader to start the battle
                  </p>
                )}
                {isUserTeam && !isUserLeader && userTeamIsClaiming && (
                  <p className="mt-2 text-center text-amber-600 text-xs dark:text-amber-400">
                    Battle is being initialized... If this persists, you can leave and
                    rejoin.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// --- RaidUserSlot Component ---

interface RaidUserSlotProps {
  username: string;
  avatar: string | null;
  isLeader: boolean;
}

const RaidUserSlot: React.FC<RaidUserSlotProps> = ({ username, avatar, isLeader }) => {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <div className="relative h-12 w-12 flex-shrink-0">
        <AvatarImage
          href={avatar}
          alt={username}
          size={48}
          hover_effect={true}
          priority
          className="h-full w-full rounded-md object-cover"
        />
        {isLeader && (
          <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-white text-xs">
            ★
          </div>
        )}
      </div>
      <span className="max-w-[60px] truncate text-muted-foreground text-xs">
        {username}
      </span>
    </div>
  );
};

// --- RaidEmptySlot Component ---

interface RaidEmptySlotProps {
  canJoin?: boolean;
  onJoin?: () => void;
  isJoining?: boolean;
}

const RaidEmptySlot: React.FC<RaidEmptySlotProps> = ({
  canJoin = false,
  onJoin,
  isJoining = false,
}) => {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <button
        type="button"
        className={cn(
          "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md border-2 border-gray-300 border-dashed bg-transparent text-gray-400 text-sm",
          canJoin &&
            !isJoining &&
            "cursor-pointer hover:border-orange-500 hover:bg-orange-50 hover:text-orange-500 dark:hover:bg-orange-950/30",
          (!canJoin || isJoining) && "cursor-default",
        )}
        onClick={canJoin && !isJoining ? onJoin : undefined}
        disabled={!canJoin || isJoining}
        title={canJoin ? "Click to join" : undefined}
        aria-label={canJoin ? "Join slot" : "Empty slot"}
      >
        {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : "?"}
      </button>
      <span className="text-muted-foreground text-xs">
        {canJoin ? "Join" : "Empty"}
      </span>
    </div>
  );
};

export default RaidBrowser;
