"use client";

import { Swords } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ELDER_KAGE_REMOVAL_VOTE_DAYS,
  ELDER_MIN_VOTING_COUNT,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  KAGE_ELDER_REMOVAL_LOCK_SECS,
  KAGE_MAX_ELDERS,
  KAGE_REMOVAL_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { UserAvatarTile } from "@/layout/UserAvatarTile";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useUserPicker } from "@/utils/search";
import { secondsFromDate } from "@/utils/time";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Serving council, public removal motions and vacancy-specific successor appointments. */
export const ElderHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  const { timeDiff, updateUser, prepareUserUpdate } = useRequiredUserInfo();
  const syncedTime = Date.now() - timeDiff;
  const [removalReason, setRemovalReason] = useState("");
  const { methods: nomineeForm, user: nominee } = useUserPicker();
  const nomineeId = nominee?.userId;
  const [governanceMessage, setGovernanceMessage] = useState("");
  const { data: removalHistory, refetch: refetchHistory } =
    api.kage.getRemovalHistory.useQuery(
      { villageId: user.villageId ?? "" },
      { enabled: !!user.villageId, refetchInterval: 15_000 },
    );
  const nominate = api.kage.nominateKage.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
      showMutationToast(data);
      setGovernanceMessage(data.message);
      if (data.success) {
        await Promise.all([
          refetchHistory(),
          refetchVotes(),
          apiUtils.kage.getElders.invalidate(),
          apiUtils.village.get.invalidate(),
        ]);
      }
    },
    onError: (e) => setGovernanceMessage(e.message),
  });
  const apiUtils = api.useUtils();
  // Fetch elders
  const { data: elders, isPending } = api.kage.getElders.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  // Fetch clans for activity ranking
  const { data: clans, isPending: isClansLoading } = api.clan.getAll.useQuery(
    { villageId: user.villageId ?? "", isOutlaw: false },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  // Fetch village for kage lock check
  const { data: villageData } = api.village.get.useQuery(
    { id: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId, refetchInterval: 15_000 },
  );

  // Fetch elder votes (war declarations and kage removal motions)
  const { data: elderVotes, refetch: refetchVotes } = api.war.getElderVotes.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 5000, enabled: !!user.villageId, refetchInterval: 15_000 },
  );

  const { mutate: voteWar, isPending: isVotingWar } =
    api.war.voteOnWarDeclaration.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) await refetchVotes();
      },
    });

  const { mutate: cancelWarDeclaration, isPending: isCancellingWar } =
    api.war.cancelWarDeclaration.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) await refetchVotes();
      },
    });

  const { mutate: initiateRemoval, isPending: isInitiatingRemoval } =
    api.kage.initiateKageRemovalVote.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        setGovernanceMessage(data.message);
        if (data.success) await Promise.all([refetchVotes(), refetchHistory()]);
      },
    });

  const { mutate: voteRemoval, isPending: isVotingRemoval } =
    api.kage.voteOnKageRemoval.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        // A rejected removal can resolve a stale motion; refresh it out of the council.
        setGovernanceMessage(data.message);
        await Promise.all([
          refetchVotes(),
          refetchHistory(),
          apiUtils.village.get.invalidate(),
        ]);
      },
    });

  // Derived
  const isElder = user.rank === "ELDER";
  const isKage = user.userId === villageData?.villageData.kageId;
  const pendingVotes = elderVotes?.filter((v) => v.status === "PENDING") ?? [];
  const pendingWarVotes = pendingVotes.filter((v) => v.type === "WAR_DECLARATION");
  const pendingKageVotes = pendingVotes.filter((v) => v.type === "KAGE_REMOVAL");
  const kageId = villageData?.villageData.kageId;
  const eldersExcludingKage = elders?.filter((e) => e.userId !== kageId);
  const removalQuorum =
    Math.floor((eldersExcludingKage?.length ?? ELDER_MIN_VOTING_COUNT) / 2) + 1;
  const hasMinimumRemovalElders =
    (eldersExcludingKage?.length ?? 0) >= ELDER_MIN_VOTING_COUNT;

  // Elders can only initiate removal after the current kage's protected tenure.
  const leaderUpdatedAt = villageData?.villageData.leaderUpdatedAt;
  const lockExpiry = leaderUpdatedAt
    ? new Date(leaderUpdatedAt.getTime() + KAGE_ELDER_REMOVAL_LOCK_SECS * 1000)
    : null;
  const kageIsProtected = lockExpiry ? syncedTime < lockExpiry.getTime() : true;
  const failedRemoval = removalHistory
    ?.filter((motion) => motion.status === "REJECTED")
    .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))[0];
  const removalCooldownExpiry =
    leaderUpdatedAt &&
    failedRemoval?.resolvedAt &&
    failedRemoval.targetId === kageId &&
    (!failedRemoval.tenure ||
      failedRemoval.tenure.getTime() === leaderUpdatedAt.getTime()) &&
    failedRemoval.resolvedAt >= leaderUpdatedAt
      ? secondsFromDate(KAGE_REMOVAL_COOLDOWN_DAYS * 86400, failedRemoval.resolvedAt)
      : null;

  // Sort clans by activity points, with all-time points as tie-breaker
  const rankedClans = clans
    ?.slice()
    .sort((a, b) => {
      const activityDiff = (b.activityPoints ?? 0) - (a.activityPoints ?? 0);
      if (activityDiff !== 0) return activityDiff;
      return (b.points ?? 0) - (a.points ?? 0);
    })
    .slice(0, 3);

  return (
    <>
      {/* MAIN INFORMATION */}
      <ContentBox
        title="Town Hall"
        subtitle="Elders Council"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <p className="pb-2">
          The Elder Council is composed of representatives from the village&apos;s most
          active clans. Each month, elders are automatically selected from the top{" "}
          {KAGE_MAX_ELDERS} clans by activity points. Clan rankings are locked on the{" "}
          {ELDER_NOMINATION_CUTOFF_DAY}th of each month, and clan leaders can nominate a
          member to become elder between the {ELDER_NOMINATION_CUTOFF_DAY}th and{" "}
          {ELDER_NOMINATION_DEADLINE_DAY}th if their clan qualifies.
        </p>
        <p className="text-muted-foreground text-sm">
          Activity points are earned through PvP combat, completing quests, and other
          clan activities. Points reset at the start of each month. All-time clan points
          are used as a tie-breaker when clans have equal activity points.
        </p>
      </ContentBox>
      {/* SHOW CURRENT ELDERS: while loading, a row of avatar placeholders holds the
          height of the loaded grid, and a village without elders keeps that height for
          its empty message, so the boxes below do not move when the query resolves */}
      {((isPending && !!user.villageId) || elders) && (
        <ContentBox
          title="Current Elders"
          initialBreak={true}
          subtitle={`Currently serving elders`}
        >
          <div className="grid grid-cols-3 pt-3">
            {isPending &&
              ["a", "b", "c"].map((slot) => (
                <div key={slot} aria-hidden>
                  <AvatarImage size={100} />
                  <div className="invisible">
                    <div className="font-bold">&nbsp;</div>
                    <div>&nbsp;</div>
                  </div>
                </div>
              ))}
            {elders?.length === 0 && (
              <div className="relative col-span-3">
                <div className="invisible w-1/3" aria-hidden>
                  <AvatarImage size={100} />
                  <div className="font-bold">&nbsp;</div>
                  <div>&nbsp;</div>
                </div>
                <p className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  No elders are serving right now
                </p>
              </div>
            )}
            {elders?.map((elder) => (
              <div key={elder.userId} className="relative">
                <UserAvatarTile user={elder} className="text-center" />
              </div>
            ))}
          </div>
        </ContentBox>
      )}
      {/* CLAN ACTIVITY RANKINGS */}
      <ContentBox
        title="Clan Activity Rankings"
        initialBreak={true}
        subtitle={`Top ${KAGE_MAX_ELDERS} clans will have their nominees become elders next month`}
      >
        {isClansLoading ? (
          <Loader explanation="Loading clan rankings" />
        ) : rankedClans && rankedClans.length > 0 ? (
          <div className="space-y-2">
            {rankedClans.map((clan, i) => (
              <div
                key={clan.id}
                className={`flex items-center justify-between rounded-lg p-3 ${i === 0 ? "border border-amber-500/40 bg-amber-500/20" : i === 1 ? "border border-border bg-muted" : "border border-orange-500/30 bg-orange-500/10"}`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-lg">#{i + 1}</span>
                  <Link href={`/clanhall/${clan.id}`}>
                    {/* Sized explicitly: in this shrink-wrapped row the avatar would
                        otherwise take the image's own width, growing the row on load */}
                    <AvatarImage
                      href={clan.image}
                      alt={clan.name}
                      size={50}
                      hover_effect={true}
                      className="w-[50px]"
                    />
                  </Link>
                  <div>
                    <Link
                      href={`/clanhall/${clan.id}`}
                      className="font-bold hover:text-orange-500"
                    >
                      {clan.name}
                    </Link>
                    <div className="text-muted-foreground text-sm">
                      {clan.members.length} members
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{clan.activityPoints ?? 0}</div>
                  <div className="text-muted-foreground text-sm">activity points</div>
                  <div className="text-muted-foreground text-xs">
                    {clan.points ?? 0} all-time pts
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No clans found in this village.</p>
        )}
      </ContentBox>
      {/* COUNCIL MOTIONS */}
      <ContentBox
        title="Council Motions"
        initialBreak={true}
        subtitle="Elder governance — war declarations and kage removal votes"
      >
        {isVotingWar || isInitiatingRemoval || isVotingRemoval || isCancellingWar ? (
          <Loader explanation="Processing vote..." />
        ) : (
          <div className="space-y-4">
            {/* Pending war declaration votes */}
            {pendingWarVotes.map((pendingWarVote) => (
              <div
                key={pendingWarVote.id}
                className="rounded-lg border border-red-500/40 bg-red-500/10 p-4"
              >
                <div className="mb-1 font-bold text-red-400">
                  ⚔️ War Declaration — vs {pendingWarVote.targetName}
                </div>
                <div className="mb-2 text-muted-foreground text-sm">
                  Submitted by {pendingWarVote.initiatedBy?.username}. Voting closes in{" "}
                  <Countdown targetDate={pendingWarVote.endsAt} />. If no blocking
                  majority votes NO, war starts automatically.
                </div>
                <div className="mb-3 text-sm">
                  YES: {pendingWarVote.entries.filter((e) => e.vote === "YES").length}{" "}
                  &nbsp;|&nbsp; NO:{" "}
                  {pendingWarVote.entries.filter((e) => e.vote === "NO").length}
                </div>
                {isElder &&
                  !pendingWarVote.entries.some((e) => e.userId === user.userId) && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() =>
                          voteWar({
                            voteId: pendingWarVote.id,
                            vote: "YES",
                            userVillageId: user.villageId ?? "",
                          })
                        }
                      >
                        Vote YES
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          voteWar({
                            voteId: pendingWarVote.id,
                            vote: "NO",
                            userVillageId: user.villageId ?? "",
                          })
                        }
                      >
                        Vote NO
                      </Button>
                    </div>
                  )}
                {isElder &&
                  pendingWarVote.entries.some((e) => e.userId === user.userId) && (
                    <p className="text-muted-foreground text-sm italic">
                      You have already voted.
                    </p>
                  )}
                {isKage && (
                  <div className="mt-2 border-red-500/20 border-t pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        cancelWarDeclaration({
                          voteId: pendingWarVote.id,
                          userVillageId: user.villageId ?? "",
                        })
                      }
                    >
                      Cancel Declaration
                    </Button>
                    <p className="mt-1 text-muted-foreground text-xs">
                      No tokens will be charged if cancelled.
                    </p>
                  </div>
                )}
              </div>
            ))}
            {/* Pending kage removal votes */}
            {pendingKageVotes.map((pendingKageVote) => (
              <div
                key={pendingKageVote.id}
                className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4"
              >
                <div className="mb-1 font-bold text-orange-400">
                  🗳️ Kage Removal — {pendingKageVote.targetName}
                </div>
                <div className="mb-2 text-muted-foreground text-sm">
                  Initiated by {pendingKageVote.initiatedBy?.username}. Voting closes in{" "}
                  <Countdown targetDate={pendingKageVote.endsAt} />.
                </div>
                <p className="mb-2 text-sm">Reason: {pendingKageVote.reason}</p>
                <div className="mb-3 text-sm">
                  YES: {pendingKageVote.entries.filter((e) => e.vote === "YES").length}{" "}
                  &nbsp;|&nbsp; NO:{" "}
                  {pendingKageVote.entries.filter((e) => e.vote === "NO").length}
                </div>
                {isElder &&
                  user.userId !== pendingKageVote.targetId &&
                  !pendingKageVote.entries.some((e) => e.userId === user.userId) && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() =>
                          voteRemoval({
                            voteId: pendingKageVote.id,
                            vote: "YES",
                          })
                        }
                      >
                        Vote YES (Remove)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          voteRemoval({
                            voteId: pendingKageVote.id,
                            vote: "NO",
                          })
                        }
                      >
                        Vote NO (Keep)
                      </Button>
                    </div>
                  )}
                {isElder &&
                  pendingKageVote.entries.some((e) => e.userId === user.userId) && (
                    <p className="text-muted-foreground text-sm italic">
                      You have already voted.
                    </p>
                  )}
                {isElder && user.userId === pendingKageVote.targetId && (
                  <p className="text-muted-foreground text-sm italic">
                    You cannot vote on your own removal.
                  </p>
                )}
              </div>
            ))}
            {/* Initiate kage removal */}
            {isElder && !isKage && !!kageId && pendingKageVotes.length === 0 && (
              <div className="rounded-lg border border-border p-4">
                <div className="mb-2 font-bold">Remove Current Kage</div>
                {kageIsProtected ? (
                  <p className="text-muted-foreground text-sm">
                    The kage is protected for{" "}
                    {lockExpiry
                      ? Math.ceil(
                          (lockExpiry.getTime() - syncedTime) / (1000 * 3600 * 24),
                        )
                      : KAGE_ELDER_REMOVAL_LOCK_SECS / (24 * 3600)}{" "}
                    more day(s). Elders cannot initiate a removal vote for{" "}
                    {KAGE_ELDER_REMOVAL_LOCK_SECS / (24 * 3600)} days after a new kage
                    takes power.
                  </p>
                ) : removalCooldownExpiry &&
                  syncedTime < removalCooldownExpiry.getTime() ? (
                  <p className="text-muted-foreground text-sm">
                    The village must wait until {removalCooldownExpiry.toLocaleString()}{" "}
                    to propose another removal after the failed vote. Time remaining:{" "}
                    <Countdown
                      targetDate={removalCooldownExpiry}
                      timeDiff={timeDiff}
                      onFinish={() => void refetchHistory()}
                    />
                    .
                  </p>
                ) : hasMinimumRemovalElders ? (
                  <>
                    <p className="mb-3 text-muted-foreground text-sm">
                      If {removalQuorum} elders vote YES within{" "}
                      {ELDER_KAGE_REMOVAL_VOTE_DAYS} days, the kage will be removed and
                      retain their village prestige. Elders may then nominate an
                      eligible villager.
                    </p>
                    <Label htmlFor="kage-removal-reason">Public reason</Label>
                    <Input
                      id="kage-removal-reason"
                      value={removalReason}
                      onChange={(e) => setRemovalReason(e.target.value)}
                      placeholder="Explain the proposal (at least 10 characters)"
                      maxLength={1000}
                    />
                    <Confirm
                      title="Initiate Kage Removal Vote"
                      disabled={removalReason.trim().length < 10}
                      button={
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={removalReason.trim().length < 10}
                        >
                          <Swords className="mr-2 h-4 w-4" />
                          Initiate Removal Vote
                        </Button>
                      }
                      onAccept={() =>
                        initiateRemoval({
                          villageId: user.villageId ?? "",
                          reason: removalReason,
                        })
                      }
                    >
                      Are you sure you want to initiate a kage removal vote? The vote
                      will be open for {ELDER_KAGE_REMOVAL_VOTE_DAYS} days. If a
                      majority of elders vote YES, the kage will be removed and their
                      village prestige preserved. Elders can nominate a successor.
                    </Confirm>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    At least {ELDER_MIN_VOTING_COUNT} eligible elders are required to
                    initiate a kage removal vote.
                  </p>
                )}
              </div>
            )}
            {governanceMessage && <p role="status">{governanceMessage}</p>}
            <p className="text-muted-foreground text-sm">
              Failed removal votes have a village-wide cooldown of{" "}
              {KAGE_REMOVAL_COOLDOWN_DAYS} days, reset when the Kage changes. Political
              removal preserves prestige.
            </p>
            {removalHistory
              ?.filter((motion) => motion.status !== "PENDING")
              .map((motion) => (
                <div key={motion.id} className="space-y-2 rounded border p-3">
                  <p className="font-semibold">Removal proposal · {motion.status}</p>
                  <p>
                    {motion.reason || "No reason recorded for this older proposal."}
                  </p>
                  <p className="text-sm">
                    YES: {motion.yes} · NO: {motion.no}
                    {motion.resolvedAt
                      ? ` · Resolved ${motion.resolvedAt.toLocaleString()}`
                      : ""}
                  </p>
                  {motion.successorId && (
                    <p>
                      Successor:{" "}
                      <Link href={`/userid/${motion.successorId}`}>
                        View appointed Kage
                      </Link>
                    </p>
                  )}
                  {isElder &&
                    !villageData?.villageData.kageId &&
                    motion.status === "APPROVED" &&
                    motion.resolvedAt &&
                    motion.resolvedAt.getTime() === leaderUpdatedAt?.getTime() &&
                    !motion.successorId && (
                      <div className="space-y-2">
                        <UserSearchSelect
                          useFormMethods={nomineeForm}
                          showYourself
                          showAi={false}
                          maxUsers={1}
                          label="Search eligible villager or elder"
                        />
                        <Button
                          disabled={nominate.isPending || !nomineeId}
                          onClick={() =>
                            nominate.mutate({
                              voteId: motion.id,
                              villageId: user.villageId ?? "",
                              userId: nomineeId ?? "",
                            })
                          }
                        >
                          Nominate and appoint successor
                        </Button>
                      </div>
                    )}
                </div>
              ))}
            {/* No motions */}
            {pendingWarVotes.length === 0 &&
              pendingKageVotes.length === 0 &&
              (!isElder || isKage) && (
                <p className="text-muted-foreground text-sm">
                  No active council motions.
                </p>
              )}
          </div>
        )}
      </ContentBox>
    </>
  );
};
