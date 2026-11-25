"use client";

import { DoorOpen, Swords } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";
import { describeQueuedActivity } from "@/libs/queuedActivity";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

/** Tell a queued player what holds them, with its exit, on every page of the game. */
export const QueueNotice: React.FC<{ className?: string }> = ({ className }) => {
  const { data: status } = useUserDataSelector((user) => user.status);
  return status === "QUEUED" ? <QueuedActivityNotice className={className} /> : null;
};

/** Mounted only while queued, so every queue entry reads its own activity. */
const QueuedActivityNotice: React.FC<{ className?: string }> = ({ className }) => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserDataSelector((user) => user.userId);
  const { data: activity } = api.raids.getQueuedActivity.useQuery(undefined, {
    staleTime: 0,
    gcTime: 0,
  });

  /** A refused exit means the queue moved on, so the notice reads it again. */
  const recover = (data: { success: boolean } | undefined, error: unknown) => {
    if (error) void utils.profile.getUser.invalidate();
    if (!data?.success) void utils.raids.getQueuedActivity.invalidate();
  };

  const { mutate: leaveRaid, isPending: isLeavingRaid } =
    api.raids.leaveRaidQueue.useMutation({
      onMutate: prepareUserUpdate,
      onSettled: recover,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        void updateUser(data, { revision, delta: data.userDelta });
        void utils.raids.getUserRaidQueue.invalidate();
        void utils.raids.getActiveRaidTeams.invalidate();
      },
    });
  const { mutate: leaveShrine, isPending: isLeavingShrine } =
    api.shrine.leaveShrineBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSettled: recover,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        void updateUser(data, { revision });
        void utils.shrine.getShrineBattles.invalidate();
        void utils.shrine.getUserQueuedShrineBattle.invalidate();
      },
    });
  const { mutate: leaveClan, isPending: isLeavingClan } =
    api.clan.leaveClanBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSettled: recover,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        void updateUser(data, { revision });
        void utils.clan.getClanBattles.invalidate();
      },
    });
  const { mutate: leaveTerritory, isPending: isLeavingTerritory } =
    api.territoryWar.leaveTeam.useMutation({
      onMutate: prepareUserUpdate,
      onSettled: recover,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        void updateUser(data, { revision });
        void utils.territoryWar.getCurrent.invalidate();
      },
    });
  const { mutate: leaveRanked, isPending: isLeavingRanked } =
    api.pvpRank.leaveRankedPvpQueue.useMutation({
      onMutate: prepareUserUpdate,
      onSettled: recover,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        void updateUser(undefined, { revision });
        void utils.pvpRank.getRankedPvpQueue.invalidate();
        void utils.pvpRank.getRankedQueueCount.invalidate();
      },
    });

  if (!activity) return null;
  const { text, href, linkLabel } = describeQueuedActivity(activity);
  const canLeave = !["DUNGEON", "CARAVAN", "UNKNOWN"].includes(activity.kind);
  const isLeaving =
    isLeavingRaid ||
    isLeavingShrine ||
    isLeavingClan ||
    isLeavingTerritory ||
    isLeavingRanked;
  const leave = () => {
    if (activity.kind === "RAID") leaveRaid();
    if (activity.kind === "SHRINE") leaveShrine({ shrineBattleId: activity.lobbyId });
    if (activity.kind === "CLAN") leaveClan({ clanBattleId: activity.lobbyId });
    if (activity.kind === "TERRITORY") leaveTerritory({ teamId: activity.lobbyId });
    if (activity.kind === "RANKED") leaveRanked();
  };

  return (
    <section
      aria-label="Queue status"
      className={cn(
        "bg-card text-card-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-orange-500 px-3 py-2 text-sm",
        className,
      )}
    >
      <p className="flex min-w-0 flex-1 basis-52 items-center gap-2 font-medium">
        <Swords className="h-5 w-5 shrink-0 text-orange-500" aria-hidden />
        <span>{text}</span>
      </p>
      {(href || canLeave) && (
        <div className="flex grow justify-end gap-2 sm:grow-0">
          {href && (
            <Button asChild variant="outline" className="grow sm:grow-0">
              <Link href={href}>{linkLabel}</Link>
            </Button>
          )}
          {canLeave && (
            <Button onClick={leave} disabled={isLeaving} className="grow sm:grow-0">
              <DoorOpen className="mr-2 h-4 w-4" aria-hidden />
              {isLeaving ? "Leaving..." : "Leave queue"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
