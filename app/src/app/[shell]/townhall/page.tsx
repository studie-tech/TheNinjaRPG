"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleArrowUp,
  Crown,
  DoorClosed,
  DoorOpen,
  Handshake,
  Landmark,
  LandPlot,
  ScrollText,
  ShieldPlus,
  Swords,
  UsersRound,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ELDER_KAGE_REMOVAL_VOTE_DAYS,
  ELDER_MIN_VOTING_COUNT,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  KAGE_ELDER_REMOVAL_LOCK_SECS,
  KAGE_REMOVAL_COOLDOWN_DAYS,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { VillageAlliance } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import AvatarImage from "@/layout/Avatar";
import BanInfo from "@/layout/BanInfo";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import { KageDefense } from "@/layout/KageDefense";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import PublicUserComponent from "@/layout/PublicUser";
import { ShrineHall } from "@/layout/ShrineHall";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { VillageMission, VillageStructureMaintenance } from "@/layout/VillageMission";
import { WarRoom } from "@/layout/WarSystem";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { calculateEnemyConsequences, findRelationship } from "@/utils/alliance";
import { canTakeKage } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsFromDate } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  createPrestigeTransferSchema,
  type PrestigeTransferSchema,
  type PrestigeTransferSchemaInput,
} from "@/validators/misc";
import type { UserSearchResult } from "@/validators/register";

/** Route village governance and diplomacy to the panels available to the current character. */
export default function TownHall() {
  const { data: userData } = useRequiredUserData();
  const availableTabs = userData?.isOutlaw
    ? ["Alliance", "Wars", "Shrines"]
    : ["Alliance", "Kage", "Elders", "Wars", "Shrines", "Village Mission"];
  const [tab, setTab] = useLocalStorage<(typeof availableTabs)[number] | null>(
    "townhallTab",
    null,
    true,
  );

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (userData.isBanned) return <BanInfo />;

  const NavBarBlock = (
    <NavTabs
      id={`townhallSelection-${userData.villageId}`}
      current={tab}
      options={availableTabs}
      setValue={setTab}
      icons={{
        Alliance: (
          <Handshake
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
        Kage: (
          <Crown
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
        Elders: (
          <UsersRound
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
        Wars: (
          <Swords
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
        Shrines: (
          <Landmark
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
        "Village Mission": (
          <ScrollText
            className="@min-[640px]/townhall:hidden size-4 shrink-0"
            aria-hidden="true"
          />
        ),
      }}
      iconOnlyOptions={availableTabs}
      labelClassName={(option) =>
        option === (tab ?? "Alliance")
          ? "not-sr-only"
          : "@min-[640px]/townhall:not-sr-only"
      }
      fontSize="text-xs"
      listClassName="flex-nowrap gap-0.5"
      itemClassName={() => "mr-0 shrink-0"}
      className="min-h-11 min-w-8 @min-[640px]/townhall:px-2 px-1.5"
    />
  );

  let content: React.ReactNode;
  if (tab === "Alliance" || !tab) {
    content = <AllianceHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Kage") {
    content = <KageHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Elders") {
    content = <ElderHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Wars") {
    content = <WarRoom user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Shrines") {
    content = <ShrineHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Village Mission") {
    content = (
      <>
        <VillageMission villageId={userData.villageId ?? ""} navTabs={NavBarBlock} />
        {userData.userId === userData.village?.kageId && (
          <VillageStructureMaintenance villageId={userData.villageId ?? ""} />
        )}
      </>
    );
  }
  return <div className="@container/townhall min-w-0">{content}</div>;
}

/** Serving council, public removal motions and vacancy-specific successor appointments. */
const ElderHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  const { timeDiff, updateUser, prepareUserUpdate } = useRequiredUserData();
  const syncedTime = Date.now() - timeDiff;
  const [removalReason, setRemovalReason] = useState("");
  const nomineeForm = useForm<{ username: string; users: UserSearchResult[] }>({
    defaultValues: { username: "", users: [] },
  });
  const nomineeId = useWatch({ control: nomineeForm.control, name: "users" })[0]
    ?.userId;
  const [governanceMessage, setGovernanceMessage] = useState("");
  const { data: removalHistory, refetch: refetchHistory } =
    api.kage.getRemovalHistory.useQuery(
      { villageId: user.villageId ?? "" },
      { enabled: !!user.villageId, refetchInterval: 15_000 },
    );
  const nominate = api.kage.nominateKage.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch)
        await updateUser(data.userPatch, {
          revision,
          ...(data.userDelta ? { delta: data.userDelta } : {}),
        });
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
  const kageIsProtected = lockExpiry ? new Date() < lockExpiry : true;
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
        topRightCorntentBreakpoint="sm"
      >
        <p className="pb-2">
          The Elder Council is composed of representatives from the village&apos;s most
          active clans. Each month, elders are automatically selected from the top 3
          clans by activity points. Clan rankings are locked on the{" "}
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
                <Link href={`/userid/${elder.userId}`} className="text-center">
                  <AvatarImage
                    href={elder.avatar}
                    alt={elder.username}
                    userId={elder.userId}
                    hover_effect={true}
                    size={100}
                  />
                  <div>
                    <div className="font-bold">{elder.username}</div>
                    <div>
                      Lvl. {elder.level} {capitalizeFirstLetter(elder.rank)}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
      {/* CLAN ACTIVITY RANKINGS */}
      <ContentBox
        title="Clan Activity Rankings"
        initialBreak={true}
        subtitle="Top 3 clans will have their nominees become elders next month"
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
                          (lockExpiry.getTime() - Date.now()) / (1000 * 3600 * 24),
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

/** Incumbent controls for village structures, diplomacy and prestige transfers. */
const KageHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Ability to update user
  const { updateUser } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Query
  const { data: village, isPending } = api.village.get.useQuery(
    { id: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  const { mutate: resign, isPending: isResigning } = api.kage.resignKage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.village.get.invalidate();
      }
    },
  });

  const { mutate: sendKagePrestige, isPending: isSendingPrestige } =
    api.kage.sendKagePrestige.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({
            villagePrestige: user.villagePrestige - variables.amount,
          });
        }
      },
    });

  // Derived
  const isKage = user.userId === village?.villageData.kageId;
  const isElder = user.rank === "ELDER";

  // Schema for prestige sending
  const prestigeSchema = createPrestigeTransferSchema(user.villagePrestige ?? 0);

  // Form for prestige sending
  const prestigeForm = useForm<
    PrestigeTransferSchemaInput,
    unknown,
    PrestigeTransferSchema
  >({
    resolver: zodResolver(prestigeSchema),
  });

  // Submit handler for prestige
  const onSendPrestige = prestigeForm.handleSubmit((data) => {
    sendKagePrestige({
      kageId: village?.villageData.kageId ?? "",
      amount: data.amount ?? 0,
    });
    prestigeForm.reset();
  });

  // Checks
  if (!user.villageId) return <Loader explanation="Join a village first" />;
  if (isPending || !village) return <Loader explanation="Loading village" />;
  if (isResigning) return <Loader explanation="Resigning as Kage" />;
  if (isSendingPrestige) return <Loader explanation="Sending prestige" />;

  // Render
  return (
    <>
      <ContentBox
        title="Town Hall"
        subtitle="Kage Challenge"
        defaultBackHref="/village"
        topRightContent={navTabs}
        topRightCorntentBreakpoint="sm"
      >
        <p>
          The &quot;Kage&quot; is the village&apos;s most potent and skilled ninja,
          given the esteemed responsibility of safeguarding its people. As the
          highest-ranking authority in the village, the Kage carries the burden of
          making critical decisions and ensures the village&apos;s prosperity. Their
          duty includes defending the village from external threats, maintaining order
          within, deciding missions for their fellow ninjas, and training the next
          generation of warriors. The Kage is a symbol of strength, wisdom, and dignity,
          known to have the power to shape the destiny of the village.
        </p>
        {isKage && (
          <Button
            id="challenge"
            className="my-2 w-full"
            onClick={() => resign({ villageId: village.villageData.id })}
          >
            <DoorClosed className="mr-2 h-6 w-6" />
            Resign as Kage
          </Button>
        )}

        {isElder && (
          <Form {...prestigeForm}>
            <form onSubmit={onSendPrestige} className="relative my-2">
              <FormField
                control={prestigeForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="flex w-full flex-col">
                    <FormControl>
                      <Input
                        id="amount"
                        placeholder={`Send prestige (max ${user.villagePrestige})`}
                        {...field}
                        value={field.value as number | undefined}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className="absolute top-0 right-0" type="submit">
                <CircleArrowUp className="h-5 w-5" />
              </Button>
            </form>
          </Form>
        )}
      </ContentBox>
      {village.villageData.kageId ? (
        <PublicUserComponent
          userId={village.villageData.kageId}
          title={user.isOutlaw ? "Faction Kage" : "Village Kage"}
          initialBreak
        />
      ) : (
        <ContentBox title="Kage succession" initialBreak>
          The village has no Kage. Following a successful removal vote, elders can
          nominate an eligible successor in the Elders tab.
        </ContentBox>
      )}
      <KageChallenge user={user} />
      {village.defendedChallenges && village.defendedChallenges.length > 0 && (
        <ContentBox
          title="Challenge Record"
          subtitle="Kage Challenges & Outcomes"
          initialBreak={true}
        >
          <div className="lggrid-cols-5 grid grid-cols-4">
            {village.defendedChallenges.map((challenge) => (
              <div key={challenge.id} className="p-2 text-center">
                <Link href={`/userid/${challenge.userId}`}>
                  <AvatarImage
                    href={challenge.user.avatar}
                    alt={challenge.user.username}
                    hover_effect={true}
                    size={200}
                  />
                  {(challenge.didWin ?? 0) > 0 ? (
                    <p className="font-bold text-green-500 text-sm">
                      Won, {challenge.rounds} rounds
                    </p>
                  ) : (
                    <p className="font-bold text-red-500 text-sm">
                      Lost, {challenge.rounds} rounds
                    </p>
                  )}
                  <p className="text-xs italic">
                    {(challenge.resolvedAt ?? challenge.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs italic">
                    {(challenge.resolvedAt ?? challenge.createdAt).toLocaleTimeString()}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
    </>
  );
};

/** Show the incumbent and public defenses, with reasoned staff takeover when permitted. */
const KageChallenge = ({ user }: { user: NonNullable<UserWithRelations> }) => {
  const utils = api.useUtils();
  const [showTakeKageModal, setShowTakeKageModal] = useState(false);
  const [takeKageReason, setTakeKageReason] = useState("");
  const isKage = user.userId === user.village?.kageId;
  const { mutate: take, isPending: isTaking } = api.kage.takeKage.useMutation({
    onSuccess: async (data) => {
      if (data.success) await utils.profile.getUser.invalidate();
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.village.get.invalidate(),

          utils.kage.getDefenses.invalidate(),
        ]);
        setShowTakeKageModal(false);
        setTakeKageReason("");
      }
    },
  });
  return (
    <>
      <KageDefense user={user} />
      {canTakeKage(user.role) && (
        <ContentBox title="Staff leadership" initialBreak>
          {!isKage && canTakeKage(user.role) && (
            <div className="p-3">
              <Button
                id="challenge"
                variant="destructive"
                className="my-2 w-full"
                onClick={() => setShowTakeKageModal(true)}
                loading={isTaking}
              >
                <ShieldPlus className="mr-2 h-6 w-6" />
                Take kage as Staff
              </Button>
            </div>
          )}

          {/* Take Kage Modal */}
          {showTakeKageModal && (
            <Modal
              title="Take Kage as Staff"
              isOpen={showTakeKageModal}
              setIsOpen={setShowTakeKageModal}
              proceed_label="Take Kage"
              confirmClassName="bg-red-600 hover:bg-red-700"
              onAccept={() => {
                if (takeKageReason.trim().length >= 10) {
                  take({ reason: takeKageReason.trim() });
                } else {
                  showMutationToast({
                    success: false,
                    message: "Reason must be at least 10 characters long",
                  });
                }
              }}
              isValid={takeKageReason.trim().length >= 10}
            >
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  You are about to take the kage position as staff. This action will be
                  logged and should only be used for administrative purposes.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="reason">Reason *</Label>
                  <Input
                    id="reason"
                    value={takeKageReason}
                    onChange={(e) => setTakeKageReason(e.target.value)}
                    placeholder="Enter reason for taking kage position (minimum 10 characters)..."
                  />
                  <p className="text-muted-foreground text-xs">
                    This reason will be logged in the action log. Minimum 10 characters
                    required.
                  </p>
                </div>
              </div>
            </Modal>
          )}
        </ContentBox>
      )}
    </>
  );
};

/**
 * Alliance Overview Component
 */
const AllianceHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Queries
  const { data, isPending } = api.village.getAlliances.useQuery(undefined, {
    staleTime: 10000,
  });

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: accept, isPending: isAccepting } =
    api.village.acceptRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.village.rejectRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.village.cancelRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  if (isPending || !data) return <Loader explanation="Loading alliances" />;

  // All villages and factions with alliance system enabled
  const allVillages = data.villages.filter((v) => v.allianceSystem);
  const relationships = data.relationships;
  const requests = data.requests;

  return (
    <>
      <ContentBox
        id="tutorial-townhall-alliance"
        title={user.isOutlaw ? "Rumours" : "Town Hall"}
        subtitle="Alliances & Relations"
        defaultBackHref="/village"
        topRightContent={navTabs}
        topRightCorntentBreakpoint="sm"
      >
        <AllianceList
          user={user}
          villages={allVillages}
          relationships={relationships}
        />
      </ContentBox>
      {requests && requests.length > 0 && (
        <ContentBox
          title="Current Requests"
          subtitle="Sent to or from you"
          initialBreak={true}
          padding={false}
        >
          <UserRequestSystem
            isLoading={isAccepting || isRejecting || isCancelling}
            requests={requests}
            userId={user.userId}
            onAccept={accept}
            onReject={reject}
            onCancel={cancel}
          />
        </ContentBox>
      )}
    </>
  );
};

type VillageWithKage = RouterOutputs["village"]["getAlliances"]["villages"][number];

/**
 * Alliance List Component
 * Displays a searchable/filterable list of all villages and factions with alliance actions
 */
const AllianceList: React.FC<{
  user: NonNullable<UserWithRelations>;
  villages: VillageWithKage[];
  relationships: VillageAlliance[];
}> = ({ user, villages, relationships }) => {
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ALLY" | "ENEMY" | "NEUTRAL"
  >("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "VILLAGE" | "FACTION">("ALL");

  // Filter all villages/factions (exclude user's own)
  const allEntities = villages.filter(
    (v) => v.allianceSystem && v.id !== user.villageId,
  );

  // Apply search, status, and type filters
  const filteredEntities = allEntities
    .filter((entity) => {
      // Search filter
      const matchesSearch = entity.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      // Type filter
      if (typeFilter === "VILLAGE" && !["VILLAGE", "OUTLAW"].includes(entity.type)) {
        return false;
      }
      if (
        typeFilter === "FACTION" &&
        !["HIDEOUT", "STRONGHOLD"].includes(entity.type)
      ) {
        return false;
      }

      // Status filter
      if (statusFilter === "ALL") return true;
      const relationship = findRelationship(relationships, user.villageId, entity.id);
      const status = relationship?.status || "NEUTRAL";
      return status === statusFilter;
    })
    // Sort: villages first, then factions, alphabetically within each group
    .sort((a, b) => {
      const aIsVillage = ["VILLAGE", "OUTLAW"].includes(a.type);
      const bIsVillage = ["VILLAGE", "OUTLAW"].includes(b.type);
      if (aIsVillage && !bIsVillage) return -1;
      if (!aIsVillage && bIsVillage) return 1;
      return a.name.localeCompare(b.name);
    });

  // Mutations
  const { mutate: create, isPending: isCreating } =
    api.village.createRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: leave, isPending: isLeaving } = api.village.leaveAlliance.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    },
  );

  const { mutate: attack, isPending: isAttacking } =
    api.village.declareEnemy.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const isKage = user.userId === user.village?.kageId;
  const isLoading = isCreating || isLeaving || isAttacking;

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search villages & factions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[150px] flex-1"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as "ALL" | "VILLAGE" | "FACTION")}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="VILLAGE">Villages</SelectItem>
            <SelectItem value="FACTION">Factions</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter(v as "ALL" | "ALLY" | "ENEMY" | "NEUTRAL")
          }
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ALLY">Allies</SelectItem>
            <SelectItem value="ENEMY">Enemies</SelectItem>
            <SelectItem value="NEUTRAL">Neutral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Entity Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {filteredEntities.map((entity) => (
          <AllianceCard
            key={entity.id}
            entity={entity}
            user={user}
            relationships={relationships}
            villages={villages}
            isKage={isKage}
            onCreate={create}
            onLeave={leave}
            onAttack={attack}
            isLoading={isLoading}
          />
        ))}
        {filteredEntities.length === 0 && (
          <p className="col-span-full py-4 text-center text-muted-foreground">
            No villages or factions found
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Alliance Card Component
 * Displays a single village or faction with its alliance status and actions
 */
const AllianceCard: React.FC<{
  entity: VillageWithKage;
  user: NonNullable<UserWithRelations>;
  relationships: VillageAlliance[];
  villages: VillageWithKage[];
  isKage: boolean;
  onCreate: (params: { targetId: string; type: "ALLIANCE" | "SURRENDER" }) => void;
  onLeave: (params: { allianceId: string }) => void;
  onAttack: (params: { villageId: string }) => void;
  isLoading: boolean;
}> = ({
  entity,
  user,
  relationships,
  villages,
  isKage,
  onCreate,
  onLeave,
  onAttack,
  isLoading,
}) => {
  const relationship = findRelationship(relationships, user.villageId, entity.id);
  const status = relationship?.status || "NEUTRAL";
  const { ally, enemy, newEnemies, newNeutrals } = calculateEnemyConsequences(
    relationships,
    villages,
    user.villageId ?? "",
    entity.id,
  );

  // Determine entity type display
  const isVillage = ["VILLAGE", "OUTLAW"].includes(entity.type);
  const typeLabel = isVillage ? "Village" : "Faction";
  const typeColors = isVillage
    ? "text-blue-600 bg-blue-100"
    : "text-purple-600 bg-purple-100";

  const statusColors: Record<string, string> = {
    ALLY: "text-green-600 bg-green-100",
    ENEMY: "text-red-600 bg-red-100",
    NEUTRAL: "text-slate-600 bg-slate-100",
  };

  return (
    <div className="flex flex-col rounded-lg border p-3">
      <div className="grid grid-cols-[2fr_3fr_3fr] items-center gap-2">
        <Image
          src={entity.villageGraphic}
          alt={entity.name}
          width={80}
          height={80}
          className="aspect-square w-full rounded object-cover"
        />
        <div className="min-w-0">
          <p className="truncate font-bold text-sm">{entity.name}</p>
          <div className="flex flex-wrap gap-1">
            <span className={`rounded px-1.5 py-0.5 text-xs ${typeColors}`}>
              {typeLabel}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${statusColors[status]}`}>
              {capitalizeFirstLetter(status)}
            </span>
          </div>
          {entity.kage && (
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {isVillage ? "Kage" : "Leader"}: {entity.kage.username}
            </p>
          )}
        </div>
        {entity.kage ? (
          <Link href={`/userid/${entity.kage.userId}`}>
            <AvatarImage
              href={entity.kage.avatar}
              alt={entity.kage.username}
              userId={entity.kage.userId}
              size={120}
              hover_effect={true}
              priority={false}
              className="!m-0 !w-full !max-w-full !rounded-md"
            />
          </Link>
        ) : (
          <div />
        )}
      </div>

      {isKage && !isLoading && (
        <div className="mt-2 flex gap-2 border-t pt-2">
          {ally.success && status === "NEUTRAL" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "ALLIANCE" })}
              title="Request Alliance"
            >
              <Handshake className="h-4 w-4" />
            </Button>
          )}
          {status === "ALLY" && relationship && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLeave({ allianceId: relationship.id })}
              title="Leave Alliance"
            >
              <DoorOpen className="h-4 w-4" />
            </Button>
          )}
          {enemy.success && status !== "ENEMY" && (
            <Confirm
              title="Declare Enemy"
              onAccept={(e) => {
                e.preventDefault();
                onAttack({ villageId: entity.id });
              }}
              button={
                <Button size="sm" variant="outline" title="Declare Enemy">
                  <Swords className="h-4 w-4" />
                </Button>
              }
            >
              <p>
                Declare {entity.name} as enemy? Cost: {WAR_FUNDS_COST.toLocaleString()}{" "}
                tokens.
              </p>
              {newEnemies.length > 0 && (
                <p className="text-red-500">
                  Additional enemies: {newEnemies.map((v) => v.name).join(", ")}
                </p>
              )}
              {newNeutrals.length > 0 && (
                <p className="text-yellow-500">
                  Broken alliances: {newNeutrals.map((v) => v.name).join(", ")}
                </p>
              )}
            </Confirm>
          )}
          {status === "ENEMY" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "SURRENDER" })}
              title="Request Surrender"
            >
              <LandPlot className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {isLoading && <Loader explanation="" />}
    </div>
  );
};
