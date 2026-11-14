import { zodResolver } from "@hookform/resolvers/zod";
import {
  CirclePlay,
  DoorOpen,
  HeartCrack,
  Loader2,
  Medal,
  ScanEye,
  Swords,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CLAN_BATTLE_REWARD_POINTS,
  CLAN_BATTLE_REWARD_RYO,
  CLAN_LOBBY_SECONDS,
  CLAN_MPVP_MAX_USERS_PER_SIDE,
} from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { usePendingIds } from "@/hooks/usePendingIds";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import AvatarImage from "@/layout/Avatar";
import { AvatarNameCell } from "@/layout/AvatarNameCell";
import ClanSearchSelect from "@/layout/ClanSearchSelect";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { ignoreToastedError } from "@/layout/clan/ignoreToastedError";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import Table from "@/layout/Table";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { showUserRank } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canEditClans } from "@/utils/permissions";
import { pushToCombat } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsFromDate } from "@/utils/time";
import { useRequiredUserDataSelector, useUserInfo } from "@/utils/UserContext";
import { type ClanSearchSchema, getClanSearchSchema } from "@/validators/clan";

interface ClanBattlesProps {
  clanId: string;
  canCreate: boolean;
}

/** Clan battle lobbies: challenge, join, leave, kick, start and delete. */
export const ClanBattles: React.FC<ClanBattlesProps> = (props) => {
  // Data
  const { clanId, canCreate } = props;
  const {
    data: userData,
    timeDiff,
    updateUser,
    prepareUserUpdate,
  } = useRequiredUserDataSelector((u) => ({
    clanId: u.clanId,
    isOutlaw: u.isOutlaw,
    role: u.role,
    userId: u.userId,
    status: u.status,
    autoWakeUp: u.autoWakeUp,
  }));
  const { pusher } = useUserInfo();
  const groupLabel = userData?.isOutlaw ? "Faction" : "Clan";
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [deletingBattleId, setDeletingBattleId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  // Hide successful deletions while a refetch can still expose its cached rows.
  const [deletedBattleIds, setDeletedBattleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const deleteFlight = useSingleFlight();
  const joinFlight = useSingleFlight<string>();
  const joiningSlotKey = joinFlight.pending;
  const [joinedBattleId, setJoinedBattleId] = useState<string | null>(null);
  const leavingBattles = usePendingIds();
  const [leftBattleIds, setLeftBattleIds] = useState<Set<string>>(() => new Set());
  const kickingTargets = usePendingIds();
  const [kickedTargetKeys, setKickedTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [openKickTargetKeys, setOpenKickTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmingKickTargetKeys, setConfirmingKickTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const challengeFlight = useSingleFlight();
  const kickedTargets = useRef(new Set<string>());

  // utils
  const utils = api.useUtils();

  // Get router
  const router = useRouter();

  const { mutateAsync: removeBattle, isPending: isDeletingBattle } =
    api.clan.deleteClanBattle.useMutation({
      // A lost response may have committed deletion while its socket echo was suppressed.
      onSettled: (_data, error) => {
        if (error)
          return Promise.all([
            utils.profile.getUser.invalidate(),
            utils.clan.getClanBattles.invalidate(),
            utils.combat.getBattle.invalidate(),
          ]);
      },
      onSuccess: async (data) => {
        if (data.success) await utils.profile.getUser.invalidate();
      },
    });
  /** Keep rejection feedback in the dialog and refresh combat/profile after deletion. */
  const onDeleteBattle = async () => {
    if (!deletingBattleId) return;
    await deleteFlight.run(true, async () => {
      setDeleteError("");
      try {
        const result = await removeBattle({
          clanBattleId: deletingBattleId,
          originSocketId: pusher?.connection.socket_id,
        });
        showMutationToast(result);
        if (!result.success) {
          setDeleteError(result.message);
          return;
        }
        setDeletedBattleIds((current) => new Set(current).add(deletingBattleId));
        setDeletingBattleId(null);
        if (joinedBattleId === deletingBattleId) setJoinedBattleId(null);
        await Promise.all([
          utils.clan.getClanBattles.invalidate(),
          utils.combat.getBattle.invalidate(),
        ]);
      } catch (error) {
        setDeleteError(
          error instanceof Error ? error.message : "Could not delete battle",
        );
      }
    });
  };

  // Mutations
  const { mutateAsync: challenge, isPending: isChallenging } =
    api.clan.challengeClan.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => {
        if (data.success || data.userRecovery)
          void updateUser(data, { revision, refetch: false });
        showMutationToast(data);
      },
    });

  const { mutateAsync: join } = api.clan.joinClanBattle.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch || data.userRecovery)
        await updateUser(data, { revision });
      showMutationToast(data);
    },
  });

  const onJoin = async (clanBattleId: string, slotKey: string) => {
    if (joinedBattleId) return;

    await joinFlight
      .run(slotKey, async () => {
        const result = await join({ clanBattleId });
        if (!result.success) return;

        // Joining one battle prevents joining another. Record that intent before
        // refreshing so stale caches cannot briefly expose a second join path.
        setJoinedBattleId(clanBattleId);
        setLeftBattleIds((current) => {
          const next = new Set(current);
          next.delete(clanBattleId);
          return next;
        });
        void utils.clan.getClanBattles.invalidate();
      })
      .catch(ignoreToastedError);
  };

  const { mutateAsync: leave } = api.clan.leaveClanBattle.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
      showMutationToast(data);
    },
  });

  const onLeave = async (clanBattleId: string) => {
    if (!leavingBattles.begin(clanBattleId)) return;
    try {
      const result = await leave({ clanBattleId });
      if (!result.success) return;

      // Remove the successful action path immediately. Cache refreshes are
      // best-effort so a transient refetch failure cannot expose a stale retry.
      setLeftBattleIds((current) => new Set(current).add(clanBattleId));
      setJoinedBattleId(null);
      void utils.clan.getClanBattles.invalidate();
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      leavingBattles.end(clanBattleId);
    }
  };

  const { mutateAsync: kick } = api.clan.kickFromClanBattle.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
      showMutationToast(data);
    },
  });

  const onKick = async (
    clanBattleId: string,
    targetId: string,
    targetClanId: string,
  ) => {
    const targetKey = `${clanBattleId}:${targetId}`;
    if (kickedTargets.current.has(targetKey) || !kickingTargets.begin(targetKey)) {
      return;
    }
    try {
      const result = await kick({
        clanBattleId,
        targetId,
        clanId: targetClanId,
      });
      if (!result.success) return;

      // Hide the committed target until the refetch settles, so the stale queue
      // cannot offer a second kick for the same member in the meantime.
      kickedTargets.current.add(targetKey);
      setKickedTargetKeys((current) => new Set(current).add(targetKey));
      void utils.clan.getClanBattles.invalidate().then(() => {
        // Stop suppressing this key so a legitimate later rejoin to the same
        // battle becomes visible.
        kickedTargets.current.delete(targetKey);
        setKickedTargetKeys((current) => {
          const next = new Set(current);
          next.delete(targetKey);
          return next;
        });
      });
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      kickingTargets.end(targetKey);
    }
  };

  const setKickTargetOpen = (targetKey: string, open: boolean) => {
    if (!open && kickingTargets.has(targetKey)) return;

    setOpenKickTargetKeys((current) => {
      const next = new Set(current);
      if (open) next.add(targetKey);
      else next.delete(targetKey);
      return next;
    });
    if (!open) {
      setConfirmingKickTargetKeys((current) => {
        const next = new Set(current);
        next.delete(targetKey);
        return next;
      });
    }
  };

  const { mutate: initiate, isPending: isInitiating } =
    api.clan.initiateClanBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success || data.userPatch) await updateUser(data, { revision });
        showMutationToast(data);
        if (data.success) {
          await utils.clan.getClanBattles.invalidate();
          if (data.battleId) pushToCombat(router, data.battleId);
        }
      },
    });

  // Showing the clan battle side
  const showClanSide = (
    battleId: string,
    userClanId: string | null,
    clan: { id: string; image: string; name: string },
    winnerId: string | null,
    queue: {
      userId: string;
      user: {
        username: string;
        avatar: string | null;
        clanId: string | null;
        level: number;
        rank: UserRank;
        isOutlaw: boolean;
      };
    }[],
  ) => {
    const canJoin =
      clan.id === userClanId &&
      (canAttemptAwakeAction(userData) || leftBattleIds.has(battleId)) &&
      !joinedBattleId;
    const crewLength = Math.max(CLAN_MPVP_MAX_USERS_PER_SIDE, queue.length);
    const empties = Array.from(
      { length: crewLength - queue.length },
      (_, idx) => `clan-empty-slot-${idx}`,
    );
    const hasWinner = !!winnerId;
    const border = hasWinner ? "grayscale border-2" : "";
    return (
      <div className="flex flex-row">
        <AvatarNameCell
          avatarClassName={border}
          avatar={clan.image}
          name={clan.name}
          hoverEffect={!hasWinner}
        />
        <div className="grid grid-cols-3">
          {queue.map((q) => {
            const targetKey = `${battleId}:${q.userId}`;
            const isKickingTarget = kickingTargets.ids.has(targetKey);
            const isConfirmingKick = confirmingKickTargetKeys.has(targetKey);
            return (
              <div
                key={q.userId}
                className="relative flex w-10 flex-row items-center"
                aria-busy={isKickingTarget}
              >
                <Popover
                  open={openKickTargetKeys.has(targetKey)}
                  onOpenChange={(open) => setKickTargetOpen(targetKey, open)}
                >
                  <PopoverTrigger
                    disabled={isKickingTarget}
                    aria-label={isKickingTarget ? "Kicking" : `View ${q.user.username}`}
                  >
                    <AvatarImage
                      className={cn(border, isKickingTarget && "opacity-40")}
                      href={q.user.avatar}
                      alt={q.user.username}
                      size={50}
                      hover_effect={!hasWinner}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    aria-busy={isKickingTarget}
                    onEscapeKeyDown={(event) => {
                      if (isKickingTarget) event.preventDefault();
                    }}
                    onInteractOutside={(event) => {
                      if (isKickingTarget) event.preventDefault();
                    }}
                  >
                    <div className="flex flex-col gap-2">
                      {isConfirmingKick ? (
                        <>
                          <p className="font-bold">
                            Kick {q.user.username} from battle?
                          </p>
                          <div className="space-y-2 text-sm">
                            <p>
                              Remove <strong>{q.user.username}</strong> from the{" "}
                              {groupLabel.toLowerCase()} battle queue?
                            </p>
                            <p className="text-muted-foreground">
                              They will no longer participate in this battle and must
                              join the queue again to return.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              id={`kick-clan-battle-member-${targetKey}-proceed`}
                              className="flex-1 bg-red-600 text-white hover:bg-red-700"
                              disabled={isKickingTarget}
                              aria-busy={isKickingTarget}
                              onClick={() => void onKick(battleId, q.userId, clan.id)}
                            >
                              {isKickingTarget ? (
                                <Loader2
                                  className="mr-2 h-4 w-4 animate-spin"
                                  aria-hidden
                                />
                              ) : (
                                <DoorOpen className="mr-2 h-4 w-4" aria-hidden />
                              )}
                              {isKickingTarget ? "Kicking" : "Proceed"}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={isKickingTarget}
                              onClick={() => setKickTargetOpen(targetKey, false)}
                            >
                              Close
                            </Button>
                          </div>
                          {isKickingTarget && (
                            <span className="sr-only" role="status" aria-live="polite">
                              Kicking
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="font-bold">{q.user.username}</p>
                            <p>
                              Lvl. {q.user.level}{" "}
                              {capitalizeFirstLetter(showUserRank(q.user))}
                            </p>
                          </div>
                          {userData &&
                            canCreate &&
                            !hasWinner &&
                            userData.clanId === clan.id && (
                              <Button
                                className="w-full"
                                disabled={isKickingTarget}
                                onClick={() =>
                                  setConfirmingKickTargetKeys((current) =>
                                    new Set(current).add(targetKey),
                                  )
                                }
                              >
                                <DoorOpen className="mr-2 h-5 w-5" aria-hidden />
                                Kick
                              </Button>
                            )}
                        </>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {isKickingTarget && (
                  <span
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span className="sr-only">Kicking</span>
                  </span>
                )}
              </div>
            );
          })}
          {empties.map((emptyKey) => {
            const slotKey = `${battleId}:${clan.id}:${emptyKey}`;
            const isJoiningThisSlot = joiningSlotKey === slotKey;
            const joinDisabled = !canJoin || hasWinner || joiningSlotKey !== null;
            return (
              <div className="flex w-10 flex-row items-center" key={emptyKey}>
                <button
                  type="button"
                  className={`flex aspect-square w-5/6 flex-row items-center justify-center rounded-2xl border-2 border-black bg-slate-100 font-bold opacity-50 ${isJoiningThisSlot ? "border-orange-500 bg-orange-100 opacity-100" : canJoin && !hasWinner && !joiningSlotKey ? "hover:cursor-pointer hover:border-orange-500 hover:bg-orange-100 hover:opacity-100" : ""}`}
                  onClick={() => void onJoin(battleId, slotKey)}
                  disabled={joinDisabled}
                  aria-busy={isJoiningThisSlot}
                  aria-label={
                    isJoiningThisSlot ? "Joining" : `Join ${clan.name} battle`
                  }
                >
                  {isJoiningThisSlot ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    "?"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Query
  const { data } = api.clan.getClanBattles.useQuery(
    { clanId: clanId },
    { refetchInterval: 10000, refetchIntervalInBackground: false },
  );

  // Clan search
  const maxClans = 1;
  const clanSearchSchema = getClanSearchSchema(maxClans);
  const clanSearchMethods = useForm<ClanSearchSchema>({
    resolver: zodResolver(clanSearchSchema),
    defaultValues: { name: "", clans: [] },
  });
  useEffect(() => {
    if (data && joinedBattleId && !data.some((entry) => entry.id === joinedBattleId)) {
      setJoinedBattleId(null);
    }
  }, [data, joinedBattleId]);

  const targetClan = useWatch({
    control: clanSearchMethods.control,
    name: "clans",
    defaultValue: [],
  })?.[0];

  const onChallenge = async () => {
    if (!targetClan) return;

    await challengeFlight
      .run(true, async () => {
        const result = await challenge({
          challengerClanId: clanId,
          targetClanId: targetClan.id,
        });
        if (!result.success) return;

        // The challenge is committed, so close immediately and remove the stale
        // repeat path independently of the authoritative list refresh.
        setIsChallengeModalOpen(false);
        clanSearchMethods.reset({ name: "", clans: [] });
        void utils.clan.getClanBattles.invalidate();
      })
      .catch(ignoreToastedError);
  };

  // Loaders
  if (!data) return <Loader explanation="Loading clan battles" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Prepare data for table
  const clanBattles = data
    .filter((b) => b.attackerClan && b.defenderClan && !deletedBattleIds.has(b.id))
    .map((battle) => {
      // Use side field to determine attackers/defenders
      const visibleQueue = battle.queue.filter(
        (q) =>
          !(leftBattleIds.has(battle.id) && q.userId === userData.userId) &&
          !kickedTargetKeys.has(`${battle.id}:${q.userId}`),
      );
      const challengers = visibleQueue.filter((q) => q.side === "ATTACKER");
      const defenders = visibleQueue.filter((q) => q.side === "DEFENDER");
      const startTime = secondsFromDate(CLAN_LOBBY_SECONDS, battle.createdAt);
      const inBattle = visibleQueue.some((q) => q.userId === userData.userId);
      const userClan = userData.clanId;
      const winnerId = battle.winnerId;
      const hasStarted = !!battle.battleId;
      const hasConcluded = !!battle.winnerId;
      const isLeavingBattle = leavingBattles.ids.has(battle.id);
      return {
        ...battle,
        clan1name: battle.attackerClan
          ? showClanSide(
              battle.id,
              userClan,
              battle.attackerClan,
              winnerId,
              challengers,
            )
          : "Unknown",
        clan2name: battle.defenderClan
          ? showClanSide(battle.id, userClan, battle.defenderClan, winnerId, defenders)
          : "Unknown",
        countdown: (
          <div className="flex flex-col gap-1">
            {isInitiating ? (
              <Loader explanation="Starting" />
            ) : (
              inBattle &&
              !hasStarted && (
                <>
                  <Button
                    className="w-full"
                    disabled={isLeavingBattle}
                    onClick={() => {
                      if (leavingBattles.has(battle.id)) return;
                      initiate({ clanBattleId: battle.id });
                    }}
                  >
                    <CirclePlay className="mr-2 h-6 w-6" /> Start
                  </Button>
                  <Button
                    className="w-full"
                    disabled={isLeavingBattle}
                    aria-busy={isLeavingBattle}
                    aria-label={isLeavingBattle ? "Leaving" : undefined}
                    onClick={() => void onLeave(battle.id)}
                  >
                    {isLeavingBattle ? (
                      <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
                    ) : (
                      <DoorOpen className="mr-2 h-6 w-6" aria-hidden />
                    )}
                    {isLeavingBattle ? "Leaving" : "Leave"}
                  </Button>
                </>
              )
            )}
            {hasStarted && (
              <Link href={`/battlelog/${battle.battleId}`}>
                <Button className={cn(hasConcluded ? "grayscale" : "", "w-full")}>
                  <ScanEye className="mr-2 h-6 w-6" />{" "}
                  {hasConcluded ? "Review" : "Spectate"}
                </Button>
              </Link>
            )}
            {hasConcluded && (
              <div>
                {battle.winnerId === clanId ? (
                  <Badge className="w-full bg-green-600">
                    <Medal className="mr-2 h-6 w-6" /> Victory
                  </Badge>
                ) : (
                  <Badge className="w-full bg-red-600">
                    <HeartCrack className="mr-2 h-6 w-6" /> Defeat
                  </Badge>
                )}
              </div>
            )}
            {(canCreate || canEditClans(userData.role)) && (
              <Button
                variant="destructive"
                disabled={isDeletingBattle}
                onClick={() => {
                  setDeleteError("");
                  setDeletingBattleId(battle.id);
                }}
              >
                Delete battle
              </Button>
            )}
            <Countdown targetDate={startTime} timeDiff={timeDiff} onEndShow=" " />
          </div>
        ),
      };
    });

  return (
    <ContentBox
      title={`${groupLabel} Battles`}
      subtitle={`From ${groupLabel.toLowerCase()} leader`}
      initialBreak={true}
      padding={false}
      topRightContent={
        <div>
          {canCreate && (
            <div className="flex flex-row items-center gap-1">
              <Button
                id="create"
                disabled={isChallenging}
                aria-busy={isChallenging}
                aria-label={isChallenging ? "Sending" : `Challenge ${groupLabel}`}
                onClick={() => setIsChallengeModalOpen(true)}
              >
                {isChallenging ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Swords className="h-5 w-5" aria-hidden />
                )}
              </Button>
              <Modal
                id="challenge-clan"
                title={`Challenge Other ${groupLabel}`}
                isOpen={isChallengeModalOpen}
                setIsOpen={setIsChallengeModalOpen}
                proceed_label="Proceed"
                proceed_loading_label="Sending"
                proceedDisabled={!targetClan}
                isLoading={isChallenging}
                keepOpenOnAccept
                onAccept={() => void onChallenge()}
              >
                Challenge another {groupLabel.toLowerCase()} to a battle royale. Both
                sides field an equal number of participants. A victory awards the
                winning {groupLabel.toLowerCase()}{" "}
                {CLAN_BATTLE_REWARD_POINTS.toLocaleString()} points and{" "}
                {CLAN_BATTLE_REWARD_RYO.toLocaleString()} ryo in its bank.
                <fieldset
                  disabled={isChallenging}
                  aria-disabled={isChallenging}
                  className={cn(isChallenging && "pointer-events-none opacity-70")}
                >
                  <ClanSearchSelect
                    useFormMethods={clanSearchMethods}
                    label={`Search for ${groupLabel.toLowerCase()}`}
                    userClanId={clanId}
                  />
                </fieldset>
              </Modal>
            </div>
          )}
        </div>
      }
    >
      <Modal
        id="delete-clan-battle"
        title="Delete clan battle"
        isOpen={!!deletingBattleId}
        setIsOpen={(open) => {
          if (!open) setDeletingBattleId(null);
        }}
        proceed_label="Delete battle"
        proceed_loading_label="Deleting"
        isLoading={isDeletingBattle}
        keepOpenOnAccept
        onAccept={() => void onDeleteBattle()}
      >
        <p>
          Delete this battle and its combat record? All participants still queued or
          fighting in this battle will be released. Completed rewards are kept.
        </p>
        {deleteError && (
          <p role="alert" className="mt-2 text-red-600">
            {deleteError}
          </p>
        )}
      </Modal>
      {clanBattles?.length === 0 && (
        <p className="p-3 italic">No current {groupLabel.toLowerCase()} battles</p>
      )}
      {clanBattles?.length !== 0 && (
        <Table
          data={clanBattles}
          columns={[
            { key: "clan1name", header: `Attacker ${groupLabel}`, type: "jsx" },
            { key: "clan2name", header: `Defender ${groupLabel}`, type: "jsx" },
            { key: "countdown", header: "Start Time", type: "jsx" },
          ]}
        />
      )}
    </ContentBox>
  );
};
