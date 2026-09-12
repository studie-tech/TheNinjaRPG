import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowBigDownDash,
  ArrowBigUpDash,
  CirclePlay,
  DoorClosed,
  DoorOpen,
  FilePenLine,
  HeartCrack,
  List,
  Loader2,
  Medal,
  Palette,
  PiggyBank,
  ScanEye,
  SendHorizontal,
  Star,
  Swords,
  UserRoundCog,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ASSASSIN_MAX_PER_FACTION,
  CLAN_ASSASSIN_SLOTS,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_COLOR_CHANGE_REP_COST,
  CLAN_CRAFTING_EXP_BOOST_BASE_COST,
  CLAN_CRAFTING_EXP_BOOST_PER_LEVEL_COST,
  CLAN_CRAFTING_TIME_BOOST_BASE_COST,
  CLAN_CRAFTING_TIME_BOOST_PER_LEVEL_COST,
  CLAN_GATHERER_EXP_BOOST_BASE_COST,
  CLAN_GATHERER_EXP_BOOST_PER_LEVEL_COST,
  CLAN_HUNTER_EXP_BOOST_BASE_COST,
  CLAN_HUNTER_EXP_BOOST_PER_LEVEL_COST,
  CLAN_LOBBY_SECONDS,
  CLAN_MAX_MEMBERS,
  CLAN_MISSION_BOOST_BASE_COST,
  CLAN_MISSION_BOOST_PER_LEVEL_COST,
  CLAN_MPVP_MAX_USERS_PER_SIDE,
  CLAN_RANK_REQUIREMENT,
  CLAN_REGEN_BOOST_BASE_COST,
  CLAN_REGEN_BOOST_PER_LEVEL_COST,
  CLAN_RYO_BOOST_BASE_COST,
  CLAN_RYO_BOOST_PER_LEVEL_COST,
  CLAN_TRAINING_BOOST_BASE_COST,
  CLAN_TRAINING_BOOST_PER_LEVEL_COST,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  FACTION_MIN_MEMBERS_FOR_TOWN,
  FACTION_MIN_POINTS_FOR_TOWN,
  HIDEOUT_COST,
  HIDEOUT_TOWN_UPGRADE,
  TOWN_MONTHLY_MAINTENANCE,
} from "@/drizzle/constants";
import type { UserNindo, UserRank } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import ActionLogs from "@/layout/ActionLog";
import { getFilter, useFiltering } from "@/layout/ActionLogFiltering";
import AvatarImage from "@/layout/Avatar";
import ClanSearchSelect from "@/layout/ClanSearchSelect";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import RichInput from "@/layout/RichInput";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import Tournament from "@/layout/Tournament";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { WarRoom } from "@/layout/WarSystem";
import { showUserRank } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import type { ClanRouter } from "@/routers/clan";
import type { BaseServerResponse } from "@/server/api/trpc";
import { parseHtml } from "@/utils/parse";
import { canEditClans } from "@/utils/permissions";
import { pushToCombat } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { secondsFromDate } from "@/utils/time";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { UploadButton } from "@/utils/uploadthing";
import {
  createMoneyTransferSchema,
  type MoneyTransferSchema,
  type MoneyTransferSchemaInput,
} from "@/validators/bank";
import type { FactionColorEditSchema, FactionEditSchema } from "@/validators/clan";
import {
  type ClanSearchSchema,
  checkAssassin,
  checkCoLeader,
  factionColorEditSchema,
  factionEditSchema,
  getClanSearchSchema,
} from "@/validators/clan";
import type { MutateContentSchema } from "@/validators/comments";
import { mutateContentSchema } from "@/validators/comments";
import { ObjectiveReward } from "@/validators/rewards";

export const ClansOverview: React.FC = () => {
  // Must be in allied village
  const { userData } = useRequireInVillage("/clanhall");
  const locationLabel = userData?.isOutlaw ? "syndicate" : "village";
  const groupLabel = userData?.isOutlaw ? "Faction" : "Clan";
  const groupLabelPlural = userData?.isOutlaw ? "Factions" : "Clans";

  // Queries
  const { data } = api.clan.getAll.useQuery(
    { villageId: userData?.villageId ?? "", isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData?.villageId },
  );
  const allClans = data?.map((clan) => ({
    ...clan,
    memberCount: clan.members.length,
    clanInfo: (
      <div className="w-20 text-center">
        <AvatarImage
          href={clan.image}
          alt={clan.name}
          size={100}
          hover_effect={true}
          priority
        />
        {clan.name}
      </div>
    ),
    leaderInfo: (
      <div className="w-20 text-center">
        {clan.leader && (
          <div>
            <AvatarImage
              href={clan.leader.avatar}
              alt={clan.name}
              size={100}
              hover_effect={true}
              priority
            />
            {clan.leader.username}
          </div>
        )}
      </div>
    ),
    villageType: clan.village?.type || "unknown",
  }));

  // Table
  type Clan = ArrayElement<typeof allClans>;
  const columns: ColumnDefinitionType<Clan, keyof Clan>[] = [
    { key: "clanInfo", header: groupLabel, type: "jsx" },
    { key: "leaderInfo", header: "Leader", type: "jsx" },
    { key: "memberCount", header: "# Members", type: "string" },
    { key: "pvpActivity", header: "PVP Activity", type: "string" },
  ];

  // If we're outlaw, then show village information
  if (userData?.isOutlaw) {
    columns.push({ key: "villageType", header: "FactionStage", type: "capitalized" });
  }

  // Loaders
  if (!userData) return <Loader explanation="Loading user data" />;

  // Render
  return (
    <>
      {allClans && allClans.length > 0 && (
        <Table
          data={allClans}
          columns={columns}
          linkPrefix="/clanhall/"
          linkColumn={"id"}
        />
      )}
      {allClans?.length === 0 && (
        <p className="p-3">
          No current {groupLabelPlural.toLowerCase()} in this {locationLabel}
        </p>
      )}
    </>
  );
};

/**
 * Renders the Clan Orders component.
 *
 * @param props - The component props.
 * @returns The rendered component.
 */
interface ClanOrdersProps {
  clanId: string;
  order: UserNindo | null;
  canPost: boolean;
}

export const ClanOrders: React.FC<ClanOrdersProps> = (props) => {
  // Destructure
  const { clanId, order, canPost } = props;
  const { userData } = useRequireInVillage("/clanhall");
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const orderSubmissionInFlight = useRef(false);

  // utils
  const utils = api.useUtils();

  // Mutations
  const { mutateAsync: notice, isPending: isUpdatingOrders } =
    api.clan.upsertNotice.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Content
  const content = order?.content ?? `No current ${groupLabel} orders`;

  // Order form
  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    defaultValues: { content },
    resolver: zodResolver(mutateContentSchema),
  });
  const onUpdateOrder = handleSubmit(async (data) => {
    if (orderSubmissionInFlight.current) return;

    orderSubmissionInFlight.current = true;
    try {
      const result = await notice({ ...data, clanId });
      if (!result.success) return;

      reset(data);
      setIsOrderModalOpen(false);
      // The update is already committed. A refresh failure should not turn the
      // successful mutation into a retryable submission.
      void utils.clan.get.invalidate().catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      orderSubmissionInFlight.current = false;
    }
  });

  return (
    <ContentBox
      title="Orders"
      subtitle={`From ${groupLabel} leader`}
      initialBreak={true}
      topRightContent={
        <div>
          {canPost && (
            <div className="flex flex-row items-center gap-1">
              <Button
                id="create"
                disabled={isUpdatingOrders}
                aria-busy={isUpdatingOrders}
                aria-label={isUpdatingOrders ? "Updating" : "Update orders"}
                onClick={() => setIsOrderModalOpen(true)}
              >
                {isUpdatingOrders ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <FilePenLine className="h-5 w-5" aria-hidden />
                )}
              </Button>
              <Modal
                id="update-clan-orders"
                title="Update Orders"
                isOpen={isOrderModalOpen}
                setIsOpen={setIsOrderModalOpen}
                proceed_label="Submit"
                proceed_loading_label="Updating"
                isLoading={isUpdatingOrders}
                keepOpenOnAccept
                onAccept={() => void onUpdateOrder()}
              >
                <RichInput
                  id="content"
                  label="Contents of your orders"
                  height="300"
                  placeholder={content}
                  control={control}
                  error={errors.content?.message}
                  disabled={isUpdatingOrders}
                />
              </Modal>
            </div>
          )}
        </div>
      }
    >
      {parseHtml(content)}
    </ContentBox>
  );
};

/**
 * Renders the Clan Orders component.
 *
 * @param props - The component props.
 * @returns The rendered component.
 */
interface ClanBattlesProps {
  clanId: string;
  canCreate: boolean;
}

export const ClanBattles: React.FC<ClanBattlesProps> = (props) => {
  // Data
  const { clanId, canCreate } = props;
  const { userData, timeDiff } = useRequireInVillage("/clanhall");
  const groupLabel = userData?.isOutlaw ? "Faction" : "Clan";
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [joiningSlotKey, setJoiningSlotKey] = useState<string | null>(null);
  const [joinedBattleId, setJoinedBattleId] = useState<string | null>(null);
  const [leavingBattleIds, setLeavingBattleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [leftBattleIds, setLeftBattleIds] = useState<Set<string>>(() => new Set());
  const [kickingTargetKeys, setKickingTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [kickedTargetKeys, setKickedTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [openKickTargetKeys, setOpenKickTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmingKickTargetKeys, setConfirmingKickTargetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const challengeSubmissionInFlight = useRef(false);
  const joinSubmissionInFlight = useRef(false);
  const leaveSubmissionsInFlight = useRef(new Set<string>());
  const kickSubmissionsInFlight = useRef(new Set<string>());
  const kickedTargets = useRef(new Set<string>());

  // utils
  const utils = api.useUtils();

  // Get router
  const router = useRouter();

  // Mutations
  const { mutateAsync: challenge, isPending: isChallenging } =
    api.clan.challengeClan.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const { mutateAsync: join } = api.clan.joinClanBattle.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  const onJoin = async (clanBattleId: string, slotKey: string) => {
    if (joinSubmissionInFlight.current || joinedBattleId) return;

    joinSubmissionInFlight.current = true;
    setJoiningSlotKey(slotKey);
    try {
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
      void Promise.all([
        utils.profile.getUser.invalidate(),
        utils.clan.getClanBattles.invalidate(),
      ]).catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      joinSubmissionInFlight.current = false;
      setJoiningSlotKey(null);
    }
  };

  const { mutateAsync: leave } = api.clan.leaveClanBattle.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  const onLeave = async (clanBattleId: string) => {
    if (leaveSubmissionsInFlight.current.has(clanBattleId)) return;

    leaveSubmissionsInFlight.current.add(clanBattleId);
    setLeavingBattleIds((current) => new Set(current).add(clanBattleId));
    try {
      const result = await leave({ clanBattleId });
      if (!result.success) return;

      // Remove the successful action path immediately. Cache refreshes are
      // best-effort so a transient refetch failure cannot expose a stale retry.
      setLeftBattleIds((current) => new Set(current).add(clanBattleId));
      setJoinedBattleId(null);
      void Promise.all([
        utils.profile.getUser.invalidate(),
        utils.clan.getClanBattles.invalidate(),
      ]).catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      leaveSubmissionsInFlight.current.delete(clanBattleId);
      setLeavingBattleIds((current) => {
        const next = new Set(current);
        next.delete(clanBattleId);
        return next;
      });
    }
  };

  const { mutateAsync: kick } = api.clan.kickFromClanBattle.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  const onKick = async (
    clanBattleId: string,
    targetId: string,
    targetClanId: string,
  ) => {
    const targetKey = `${clanBattleId}:${targetId}`;
    if (
      kickSubmissionsInFlight.current.has(targetKey) ||
      kickedTargets.current.has(targetKey)
    ) {
      return;
    }

    kickSubmissionsInFlight.current.add(targetKey);
    setKickingTargetKeys((current) => new Set(current).add(targetKey));
    try {
      const result = await kick({
        clanBattleId,
        targetId,
        clanId: targetClanId,
      });
      if (!result.success) return;

      // Hide the committed target before refreshing. If that refresh fails, the
      // stale queue cannot expose a second kick for the same member.
      kickedTargets.current.add(targetKey);
      setKickedTargetKeys((current) => new Set(current).add(targetKey));
      void Promise.all([
        utils.profile.getUser.invalidate(),
        utils.clan.getClanBattles.invalidate(),
      ])
        .then(() => {
          // The refreshed queue is now authoritative. Stop suppressing this key
          // so a legitimate later rejoin to the same battle becomes visible.
          kickedTargets.current.delete(targetKey);
          setKickedTargetKeys((current) => {
            const next = new Set(current);
            next.delete(targetKey);
            return next;
          });
        })
        .catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      kickSubmissionsInFlight.current.delete(targetKey);
      setKickingTargetKeys((current) => {
        const next = new Set(current);
        next.delete(targetKey);
        return next;
      });
    }
  };

  const setKickTargetOpen = (targetKey: string, open: boolean) => {
    if (!open && kickSubmissionsInFlight.current.has(targetKey)) return;

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
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.clan.getClanBattles.invalidate(),
          ]);
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
      (userData?.status === "AWAKE" || leftBattleIds.has(battleId)) &&
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
        <div className="w-20 text-center">
          <AvatarImage
            className={border}
            href={clan.image}
            alt={clan.name}
            size={100}
            hover_effect={!hasWinner}
            priority
          />
          {clan.name}
        </div>
        <div className="grid grid-cols-3">
          {queue.map((q) => {
            const targetKey = `${battleId}:${q.userId}`;
            const isKickingTarget = kickingTargetKeys.has(targetKey);
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
                      priority
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
  const targetClan = useWatch({
    control: clanSearchMethods.control,
    name: "clans",
    defaultValue: [],
  })?.[0];

  const onChallenge = async () => {
    if (!targetClan || challengeSubmissionInFlight.current) return;

    challengeSubmissionInFlight.current = true;
    try {
      const result = await challenge({
        challengerClanId: clanId,
        targetClanId: targetClan.id,
      });
      if (!result.success) return;

      // The challenge is committed, so close immediately and remove the stale
      // repeat path independently of the authoritative list refresh.
      setIsChallengeModalOpen(false);
      clanSearchMethods.reset({ name: "", clans: [] });
      void utils.clan.getClanBattles.invalidate().catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      challengeSubmissionInFlight.current = false;
    }
  };

  // Loaders
  if (!data) return <Loader explanation="Loading clan battles" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Prepare data for table
  const clanBattles = data
    .filter((b) => b.attackerClan && b.defenderClan)
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
      const isLeavingBattle = leavingBattleIds.has(battle.id);
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
                      if (leaveSubmissionsInFlight.current.has(battle.id)) return;
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
            <Countdown targetDate={startTime} timeDiff={timeDiff} onEndShow=" " />
          </div>
        ),
      };
    });

  // {
  //   !isInitiating && initiate({ clanBattleId: battle.id });
  // }

  return (
    <ContentBox
      title={`${groupLabel} Battles`}
      subtitle={`From ${groupLabel.toLowerCase()} leader`}
      initialBreak={true}
      padding={false}
      topRightContent={
        <div>
          {canCreate && clanId && (
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
                Challenge another {groupLabel.toLowerCase()} to a battle royale.{" "}
                {groupLabel} battles can be up to 5 vs. 5 users; it will always be an
                equal number of users battling each other, so if 5 join from one side
                and 3 from the other, it will be a 3 vs. 3 battle.
                <fieldset
                  disabled={isChallenging}
                  aria-disabled={isChallenging}
                  className={cn(isChallenging && "pointer-events-none opacity-70")}
                >
                  <ClanSearchSelect
                    useFormMethods={clanSearchMethods}
                    label={`Search for ${groupLabel.toLowerCase()}`}
                    selectedClans={[]}
                    inline={true}
                    showOwn={false}
                    userClanId={clanId}
                    maxClans={1}
                  />
                </fieldset>
              </Modal>
            </div>
          )}
        </div>
      }
    >
      {clanBattles?.length === 0 && (
        <p className="p-3 italic">No current {groupLabel.toLowerCase()} battles</p>
      )}
      {clanBattles?.length !== 0 && (
        <Table
          data={clanBattles}
          columns={[
            { key: "clan1name", header: "Attacker Clan", type: "jsx" },
            { key: "clan2name", header: "Defender Clan", type: "jsx" },
            { key: "countdown", header: "Start Time", type: "jsx" },
          ]}
        />
      )}
    </ContentBox>
  );
};

/**
 * Renders a component that displays clan requests for a clan.
 *
 * @component
 * @param {ClanRequestsProps} props - The component props.
 * @returns {React.ReactNode} The rendered component.
 */
interface ClanRequestsProps {
  clanId: string;
  clanLeaderId: string;
  isLeaderOrColeader: boolean;
}

export const ClanRequests: React.FC<ClanRequestsProps> = (props) => {
  // Destructure
  const { userData } = useRequireInVillage("/clanhall");
  const { clanId, clanLeaderId, isLeaderOrColeader } = props;
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // Get utils
  const utils = api.useUtils();

  // Query
  const { data: requests } = api.clan.getRequests.useQuery(
    { clanLeaderId: clanLeaderId },
    {
      staleTime: 5000,
    },
  );

  // How to deal with success responses
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await Promise.all([
        utils.clan.get.invalidate(),
        utils.clan.getRequests.invalidate(),
      ]);
    }
  };

  // Mutation
  const { mutate: create, isPending: isCreating } = api.clan.createRequest.useMutation({
    onSuccess,
  });
  const { mutate: accept, isPending: isAccepting } = api.clan.acceptRequest.useMutation(
    { onSuccess },
  );
  const { mutate: reject, isPending: isRejecting } = api.clan.rejectRequest.useMutation(
    { onSuccess },
  );
  const { mutate: cancel, isPending: isCancelling } =
    api.clan.cancelRequest.useMutation({ onSuccess });

  // Loaders
  if (!requests) return <Loader explanation="Loading requests" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Derived
  const hasPending = requests?.some((req) => req.status === "PENDING");
  const showRequestSystem =
    (isLeaderOrColeader && requests.length > 0) || !userData.clanId;
  const shownRequests = requests.filter(
    (r) => !isLeaderOrColeader || r.status === "PENDING",
  );
  const sufficientRank = hasRequiredRank(userData.rank, CLAN_RANK_REQUIREMENT);

  // Do not show?
  if (!showRequestSystem) return null;

  // Render
  return (
    <ContentBox
      title="Request"
      subtitle={`Requests for ${groupLabel}`}
      initialBreak={true}
      padding={false}
    >
      {/* FOR THOSE WHO CAN SEND REQUESTS */}
      {sufficientRank && !userData.clanId && !hasPending && (
        <div className="p-2">
          <p>Send a request to join this {groupLabel}</p>
          <Button id="send" className="mt-2 w-full" onClick={() => create({ clanId })}>
            <SendHorizontal className="mr-2 h-5 w-5" />
            Send Request
          </Button>
        </div>
      )}
      {/* SHOW REQUESTS */}
      {shownRequests.length === 0 && <p className="p-2 italic">No current requests</p>}
      {shownRequests.length > 0 && (
        <UserRequestSystem
          requests={shownRequests}
          userId={isLeaderOrColeader ? clanLeaderId : userData.userId}
          isLoading={isCreating || isAccepting || isRejecting || isCancelling}
          onAccept={accept}
          onReject={reject}
          onCancel={cancel}
        />
      )}
    </ContentBox>
  );
};

/**
 * Show the profile of the user's clan
 */
interface ClanInfoProps {
  clanData: NonNullable<ClanRouter["get"]>;
  defaultBackHref?: string;
}

export const ClanInfo: React.FC<ClanInfoProps> = (props) => {
  // Destructure
  const { userData, updateUser } = useRequireInVillage("/clanhall");
  const { clanData, defaultBackHref } = props;
  const clanId = clanData.id;
  const groupLabel = userData?.isOutlaw ? "Faction" : "Clan";

  // Local state
  const [donateReps, setDonateReps] = useState("");
  const [selectedNomineeId, setSelectedNomineeId] = useState<string>(
    clanData.elderNominee?.userId ?? "",
  );
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDonateModalOpen, setIsDonateModalOpen] = useState(false);
  const [isTownUpgradeModalOpen, setIsTownUpgradeModalOpen] = useState(false);
  const [isDonationSubmitting, setIsDonationSubmitting] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isResignModalOpen, setIsResignModalOpen] = useState(false);
  const [isInstantJoinModalOpen, setIsInstantJoinModalOpen] = useState(false);
  const [hasLeftGroup, setHasLeftGroup] = useState(false);
  const [hasResignedLeadership, setHasResignedLeadership] = useState(false);
  const [hasInstantlyTakenLeadership, setHasInstantlyTakenLeadership] = useState(false);
  const [hasClearedLeadership, setHasClearedLeadership] = useState(false);
  const [hasUpgradedToTown, setHasUpgradedToTown] = useState(false);
  const [isUploadingClanImage, setIsUploadingClanImage] = useState(false);
  const colorSubmissionInFlight = useRef(false);
  const editSubmissionInFlight = useRef(false);
  const donationSubmissionInFlight = useRef(false);
  const townUpgradeSubmissionInFlight = useRef(false);
  const leaveSubmissionInFlight = useRef(false);
  const resignSubmissionInFlight = useRef(false);
  const instantJoinSubmissionInFlight = useRef(false);
  const clearLeadershipSubmissionInFlight = useRef(false);
  const clanImageUploadInFlight = useRef(false);

  // Get router
  const router = useRouter();

  // Get react query utility
  const utils = api.useUtils();

  // Deposit to bank
  const money = userData?.money ?? 0;
  const fromPocketSchema = createMoneyTransferSchema(money);
  const toBankForm = useForm<MoneyTransferSchemaInput, unknown, MoneyTransferSchema>({
    defaultValues: { amount: 0 },
    resolver: zodResolver(fromPocketSchema),
  });

  // Mutations
  const { mutateAsync: edit, isPending: isEditingClan } = api.clan.editClan.useMutation(
    {
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    },
  );

  const { mutateAsync: editColor, isPending: isEditingColor } =
    api.clan.editClanColor.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const { mutateAsync: leave, isPending: isLeavingClan } =
    api.clan.leaveClan.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onLeaveClan = async () => {
    if (leaveSubmissionInFlight.current || hasLeftGroup) return;

    leaveSubmissionInFlight.current = true;
    try {
      const data = await leave({ clanId });
      if (!data.success) return;

      // Membership has been committed. Remove the stale retry path and leave
      // this profile immediately; cache refreshes must not keep the destructive
      // action open or make navigation depend on the network.
      setHasLeftGroup(true);
      setIsLeaveModalOpen(false);
      void updateUser({ clanId: null });
      router.push("/clanhall");
      void Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate(),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
      // Keep the confirmation open so the user can retry with full context.
    } finally {
      leaveSubmissionInFlight.current = false;
    }
  };

  const { mutateAsync: demote, isPending: isResigningLeadership } =
    api.clan.demoteMember.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onResignLeadership = async () => {
    if (resignSubmissionInFlight.current || hasResignedLeadership || !userData) {
      return;
    }

    resignSubmissionInFlight.current = true;
    try {
      const data = await demote({ clanId, memberId: userData.userId });
      if (!data.success) return;

      // A successful response proves this user was removed from every delegated
      // leadership slot. Hide the stale retry immediately and keep the local guard
      // if an authoritative refresh fails.
      setHasResignedLeadership(true);
      setIsResignModalOpen(false);
      void Promise.allSettled([
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
      // Keep the confirmation and its context open for a safe retry.
    } finally {
      resignSubmissionInFlight.current = false;
    }
  };

  const { mutate: purchaseBoost, isPending: isPurchasingBoost } =
    api.clan.purchaseBoost.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.clan.get.invalidate();
        }
      },
    });

  const { mutateAsync: clanDonate, isPending: isDonatingReputation } =
    api.clan.clanDonate.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onDonateReputation = async () => {
    const reputationPoints = Number(donateReps);
    if (
      donationSubmissionInFlight.current ||
      !Number.isSafeInteger(reputationPoints) ||
      reputationPoints <= 0
    ) {
      return;
    }

    donationSubmissionInFlight.current = true;
    setIsDonationSubmitting(true);
    try {
      const data = await clanDonate({ clanId, reputationPoints });
      if (!data.success) return;

      // The debit and treasury credit have committed. Close the stale repeat path
      // immediately and refresh both authoritative balances independently; a cache
      // failure must never recreate a costly action or require stale arithmetic.
      setDonateReps("");
      setIsDonateModalOpen(false);
      void Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
      // Keep the exact draft and confirmation open so the user can safely retry.
    } finally {
      donationSubmissionInFlight.current = false;
      setIsDonationSubmitting(false);
    }
  };

  const { mutateAsync: upgradeHideoutToTown, isPending: isUpgradingToTown } =
    api.clan.upgradeHideoutToTown.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onUpgradeHideoutToTown = async () => {
    if (townUpgradeSubmissionInFlight.current || hasUpgradedToTown) return;

    townUpgradeSubmissionInFlight.current = true;
    try {
      const data = await upgradeHideoutToTown({ clanId });
      if (!data.success) return;

      // The one-time upgrade and its costs are committed. Remove the stale action
      // immediately; dependent authoritative refreshes must not recreate it.
      setHasUpgradedToTown(true);
      setIsTownUpgradeModalOpen(false);
      void Promise.allSettled([
        utils.clan.get.invalidate(),
        utils.profile.getUser.invalidate(),
        utils.village.getSectorOwnerships.invalidate(),
      ]);
    } catch {
      // The mutation callback provides the user-facing error. Keep the complete
      // confirmation open so a failed request can be safely retried.
    } finally {
      townUpgradeSubmissionInFlight.current = false;
    }
  };

  const { mutate: nominateElder, isPending: isNominating } =
    api.clan.nominateElder.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.clan.get.invalidate();
        }
      },
    });

  const { mutate: toBank, isPending: isDepositing } = api.clan.toBank.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.clan.get.invalidate(),
        ]);
        toBankForm.reset();
      }
    },
  });
  const onDeposit = toBankForm.handleSubmit((data) => toBank({ ...data, clanId }));

  const { mutateAsync: instantJoinAndLead, isPending: isInstantlyJoiningAndLeading } =
    api.clan.instantJoinAndLead.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onInstantJoinAndLead = async () => {
    if (
      instantJoinSubmissionInFlight.current ||
      hasInstantlyTakenLeadership ||
      !userData ||
      (userData.clanId !== null && userData.clanId !== clanId)
    ) {
      return;
    }

    instantJoinSubmissionInFlight.current = true;
    try {
      const data = await instantJoinAndLead({ clanId });
      if (!data.success) return;

      // Membership and leadership are committed. Remove the privileged retry path
      // before navigation; authoritative refreshes must never recreate the action.
      setHasInstantlyTakenLeadership(true);
      setIsInstantJoinModalOpen(false);
      void updateUser({ clanId, villageId: clanData.village.id });
      router.push("/clanhall");
      void Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate(),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error. Keep the
      // complete consequence summary open so the privileged action can be retried.
    } finally {
      instantJoinSubmissionInFlight.current = false;
    }
  };

  const { mutateAsync: clearLeadership, isPending: isClearingLeadership } =
    api.clan.clearLeadership.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const onClearLeadership = async () => {
    if (clearLeadershipSubmissionInFlight.current || hasClearedLeadership) return;

    clearLeadershipSubmissionInFlight.current = true;
    try {
      const data = await clearLeadership({ clanId });
      if (!data.success) return;

      // The successful response proves every delegated leadership slot was cleared.
      // Remove the stale destructive retry path immediately; cache refresh failures
      // must not allow the committed bulk action to be repeated.
      setHasClearedLeadership(true);
      void Promise.allSettled([
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error. Keep the
      // complete confirmation open so the user can retry without losing context.
    } finally {
      clearLeadershipSubmissionInFlight.current = false;
    }
  };

  // Rename Form
  const editForm = useForm<FactionEditSchema>({
    resolver: zodResolver(factionEditSchema),
    defaultValues: { name: clanData.name, image: clanData.image, clanId },
  });
  const isEditBusy = isEditingClan || isUploadingClanImage;
  const onEdit = editForm.handleSubmit(async (data) => {
    if (editSubmissionInFlight.current || clanImageUploadInFlight.current) return;

    editSubmissionInFlight.current = true;
    try {
      const result = await edit(data);
      if (!result.success) return;

      // Once committed, close the retry path immediately. Refreshing the
      // authoritative clan data is best-effort and cannot resubmit the edit.
      editForm.reset(data);
      setIsEditModalOpen(false);
      void utils.clan.get.invalidate().catch(() => undefined);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
    } finally {
      editSubmissionInFlight.current = false;
    }
  });
  const currentImage = useWatch({ control: editForm.control, name: "image" });

  // Color Form
  const colorForm = useForm<FactionColorEditSchema>({
    resolver: zodResolver(factionColorEditSchema),
    defaultValues: { color: userData?.village?.hexColor ?? "#000000", clanId },
  });
  const onColorEdit = colorForm.handleSubmit(async (data) => {
    if (colorSubmissionInFlight.current) return;

    colorSubmissionInFlight.current = true;
    try {
      const result = await editColor(data);
      if (!result.success) return;

      // The reputation charge and color update are committed. Remove the costly
      // retry path before refreshing any dependent authoritative views.
      colorForm.reset(data);
      setIsColorModalOpen(false);
      void Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate(),
        utils.village.getSectorOwnerships.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback provides the user-facing error feedback.
      // Keep the selected color intact so the user can retry safely.
    } finally {
      colorSubmissionInFlight.current = false;
    }
  });

  // Loader
  if (!clanData) return <Loader explanation="Loading clan data" />;
  if (!userData) return <Loader explanation="Loading user data" />;
  if (isDepositing) return <Loader explanation="Depositing money" />;

  // Derived
  const village = clanData.village;
  const inClan = !hasLeftGroup && userData.clanId === clanData.id;
  const isInDifferentClan = userData.clanId !== null && userData.clanId !== clanData.id;
  const isLeader = userData.userId === clanData.leaderId;
  const isCoLeader = checkCoLeader(userData.userId, clanData);
  const leaderLike = isLeader || isCoLeader;
  const hasEligibleSuccessor = clanData.members.some(
    (member) =>
      member.userId !== userData.userId &&
      hasRequiredRank(member.rank, CLAN_RANK_REQUIREMENT),
  );
  const hadHideout = village?.type !== "OUTLAW" && userData.isOutlaw;
  const hadTown = village?.type === "TOWN" || village?.wasDowngraded || false;
  // Can we upgrade from hideout to town?
  const hasReps = clanData.repTreasury >= HIDEOUT_TOWN_UPGRADE;
  const hasMembers = clanData.members.length >= FACTION_MIN_MEMBERS_FOR_TOWN;
  const hasPoints = clanData.points >= FACTION_MIN_POINTS_FOR_TOWN;
  const canCreateTown =
    !hasUpgradedToTown && !hadTown && hadHideout && hasReps && hasMembers && hasPoints;
  const donationCapacity = Math.max(
    0,
    Math.min(userData.reputationPoints, HIDEOUT_TOWN_UPGRADE - clanData.repTreasury),
  );
  const donationAmount = Number(donateReps);
  const isDonationBusy = isDonatingReputation || isDonationSubmitting;
  const isDonationAmountValid =
    donateReps.trim() !== "" &&
    Number.isSafeInteger(donationAmount) &&
    donationAmount > 0 &&
    donationAmount <= donationCapacity;

  // Render
  return (
    <ContentBox
      title={clanData.name}
      subtitle={`${groupLabel} Overview`}
      defaultBackHref={defaultBackHref}
      topRightContent={
        <div className="flex flex-row gap-1">
          {isLeader && hadHideout && (
            <>
              <Button
                id="edit-clan-color"
                hoverText={`Edit ${groupLabel} Color`}
                disabled={isEditingColor}
                aria-busy={isEditingColor}
                aria-label={
                  isEditingColor ? "Updating" : `Edit ${groupLabel.toLowerCase()} color`
                }
                onClick={() => setIsColorModalOpen(true)}
              >
                {isEditingColor ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Palette className="h-5 w-5" aria-hidden />
                )}
              </Button>
              <Modal
                id="edit-clan-color"
                title={`Edit ${groupLabel} Color`}
                proceed_label="Submit"
                proceed_loading_label="Updating"
                isOpen={isColorModalOpen}
                setIsOpen={setIsColorModalOpen}
                isLoading={isEditingColor}
                keepOpenOnAccept
                onAccept={() => void onColorEdit()}
              >
                <p>Here you can change the color of the {groupLabel}</p>
                <Form {...colorForm}>
                  <form className="space-y-4" onSubmit={onColorEdit}>
                    <FormField
                      control={colorForm.control}
                      name="color"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Faction Color</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <ColorPicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isEditingColor}
                              />
                              <div className="text-muted-foreground text-xs">
                                Cost: {CLAN_COLOR_CHANGE_REP_COST} reputation points
                              </div>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </Modal>
            </>
          )}
          {isLeader && (
            <>
              <Button
                id="rename-clan"
                hoverText={`Edit ${groupLabel}`}
                disabled={isEditBusy}
                aria-busy={isEditBusy}
                aria-label={isEditingClan ? "Saving" : undefined}
                onClick={() => setIsEditModalOpen(true)}
              >
                {isEditingClan ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <FilePenLine className="h-5 w-5" aria-hidden />
                )}
              </Button>
              <Modal
                id="edit-clan"
                title={`Edit ${groupLabel}`}
                isOpen={isEditModalOpen}
                setIsOpen={setIsEditModalOpen}
                proceed_label="Submit"
                proceed_loading_label={isUploadingClanImage ? "Uploading" : "Saving"}
                isValid={editForm.formState.isValid}
                isLoading={isEditBusy}
                keepOpenOnAccept
                onAccept={() => void onEdit()}
              >
                <Form {...editForm}>
                  <form className="grid grid-cols-2 space-y-2" onSubmit={onEdit}>
                    <div>
                      <FormLabel>{groupLabel} Image</FormLabel>
                      <AvatarImage
                        href={currentImage}
                        alt={clanId}
                        size={100}
                        hover_effect={true}
                        priority
                      />
                      <fieldset disabled={isEditingClan}>
                        <UploadButton
                          endpoint="clanUploader"
                          onBeforeUploadBegin={(files) => {
                            clanImageUploadInFlight.current = true;
                            setIsUploadingClanImage(true);
                            return files;
                          }}
                          onUploadAborted={() => {
                            clanImageUploadInFlight.current = false;
                            setIsUploadingClanImage(false);
                          }}
                          onClientUploadComplete={(res) => {
                            clanImageUploadInFlight.current = false;
                            setIsUploadingClanImage(false);
                            const serverData = res?.[0]?.serverData;
                            if (serverData?.error) {
                              showMutationToast({
                                success: false,
                                message: serverData.error,
                              });
                              return;
                            }
                            const url = serverData?.fileUrl;
                            if (url) {
                              editForm.setValue("image", url, {
                                shouldDirty: true,
                              });
                            }
                          }}
                          onUploadError={(error: Error) => {
                            clanImageUploadInFlight.current = false;
                            setIsUploadingClanImage(false);
                            showMutationToast({
                              success: false,
                              message: error.message,
                            });
                          }}
                        />
                      </fieldset>
                    </div>
                    <FormField
                      control={editForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={`Name of the new ${groupLabel.toLowerCase()}`}
                              disabled={isEditBusy}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </Modal>
            </>
          )}
          {inClan && (
            <Confirm
              title={`Village ${groupLabel} Overview`}
              button={
                <Button id="send" hoverText={`${groupLabel} Overview`}>
                  <List className="h-5 w-5" />
                </Button>
              }
            >
              <ClansOverview />
            </Confirm>
          )}
          {inClan && (
            <>
              <Button
                id="leave-clan"
                hoverText={`Leave ${groupLabel}`}
                disabled={isLeavingClan}
                aria-busy={isLeavingClan}
                aria-label={
                  isLeavingClan ? "Leaving" : `Leave ${groupLabel.toLowerCase()}`
                }
                onClick={() => setIsLeaveModalOpen(true)}
              >
                {isLeavingClan ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <DoorOpen className="h-5 w-5" aria-hidden />
                )}
              </Button>
              <Modal
                id="leave-clan"
                title={`Leave ${groupLabel}`}
                isOpen={isLeaveModalOpen}
                setIsOpen={setIsLeaveModalOpen}
                proceed_label={`Leave ${groupLabel}`}
                proceed_loading_label="Leaving"
                confirmClassName="bg-red-600 text-white hover:bg-red-700"
                isLoading={isLeavingClan}
                keepOpenOnAccept
                onAccept={() => void onLeaveClan()}
              >
                <p>
                  Are you sure you want to leave <strong>{clanData.name}</strong>? This
                  removes your membership, active {groupLabel.toLowerCase()} battle
                  participation, and pending {groupLabel.toLowerCase()} requests.
                </p>
                {isLeader && hasEligibleSuccessor && (
                  <p>
                    You are the leader. Leadership will pass to an eligible member when
                    you leave.
                  </p>
                )}
                {isLeader && !hasEligibleSuccessor && (
                  <p className="font-semibold text-red-600 dark:text-red-400">
                    You are the only eligible leader. Leaving will permanently dissolve
                    this {groupLabel.toLowerCase()} and remove its remaining members.
                  </p>
                )}
                {isCoLeader && <p>You will also give up your co-leader role.</p>}
                {userData.isOutlaw && (
                  <p>You will be returned to the Syndicate after leaving.</p>
                )}
              </Modal>
            </>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-8">
        <div className="col-span-4 sm:col-span-2">
          <AvatarImage
            href={clanData.image}
            alt={clanData.id}
            size={100}
            hover_effect={true}
            priority
          />
        </div>
        <div className="col-span-4 sm:col-span-6">
          <div className="grid grid-cols-1 pt-2 sm:grid-cols-2">
            <div>
              {!userData?.isOutlaw && <p>Village: {clanData.village.name}</p>}
              <p>
                Founder:{" "}
                {clanData?.founder ? (
                  <Link
                    className="font-bold hover:text-orange-500"
                    href={`/userid/${clanData.founder.userId}`}
                  >
                    {clanData?.founder.username}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </p>
              <p>
                Leader:{" "}
                {clanData.leader ? (
                  <Link
                    className="font-bold hover:text-orange-500"
                    href={`/userid/${clanData.leader.userId}`}
                  >
                    {clanData.leader.username}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </p>
              {userData?.isOutlaw && hadHideout && (
                <div className="flex flex-row items-center">
                  <p>Hideout sector: {clanData?.village?.sector}</p>
                </div>
              )}
            </div>
            <div>
              <p>PvP Activity: {clanData.pvpActivity}</p>
              <p>Points: {clanData.points}</p>
              <div className="flex flex-row items-center">
                <p>Bank: {clanData.bank}</p>{" "}
                <Confirm
                  title="Donate to clan"
                  proceed_label="Submit"
                  button={
                    <PiggyBank className="ml-2 h-6 w-6 hover:cursor-pointer hover:text-orange-500" />
                  }
                  onAccept={onDeposit}
                >
                  <p>
                    Confirm donating money from pocket to clan bank. You currently have{" "}
                    {userData.money.toLocaleString()} ryo in your pocket.
                  </p>
                  {userData.isOutlaw && (
                    <p>
                      Once the faction has {HIDEOUT_COST} ryo, it becomes possible for
                      the leader to purchase its a hideout on the global map. At this
                      point the faction detaches from the Syndicate, and effectively
                      establishes their own base of operation.
                    </p>
                  )}
                  <Form {...toBankForm}>
                    <form onSubmit={onDeposit} className="relative">
                      <FormField
                        control={toBankForm.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem className="flex w-full flex-col">
                            <FormControl>
                              <Input
                                id="amount"
                                className="mt-2"
                                placeholder="Transfer to bank"
                                {...field}
                                value={field.value as number}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </Confirm>
              </div>
              {!hadTown && hadHideout && userData?.isOutlaw && (
                <div className="flex flex-row items-center">
                  <p>Town Upgrade: {clanData.repTreasury} reps</p>
                  {leaderLike && (
                    <>
                      <Button
                        id="donate-reputation"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-1 h-8 w-8"
                        hoverText="Donate reputation points"
                        disabled={isDonationBusy || donationCapacity === 0}
                        aria-busy={isDonationBusy}
                        aria-label={
                          isDonationBusy ? "Donating" : "Donate reputation points"
                        }
                        onClick={() => setIsDonateModalOpen(true)}
                      >
                        {isDonationBusy ? (
                          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        ) : (
                          <Star className="h-5 w-5" aria-hidden />
                        )}
                      </Button>
                      <Modal
                        id="donate-reputation"
                        title="Donate reputation points"
                        proceed_label="Donate"
                        proceed_loading_label="Donating"
                        isOpen={isDonateModalOpen}
                        setIsOpen={setIsDonateModalOpen}
                        isLoading={isDonationBusy}
                        proceedDisabled={!isDonationAmountValid}
                        keepOpenOnAccept
                        onAccept={() => void onDonateReputation()}
                      >
                        <p>
                          The hideout can be upgraded to a town, enabling the faction to
                          operate in a manner much similar to one of the great ninja
                          villages, with the exception of the establishments of new
                          clans and ANBU. This requires a total of{" "}
                          {HIDEOUT_TOWN_UPGRADE} reputation points, that the faction has{" "}
                          {FACTION_MIN_MEMBERS_FOR_TOWN} members, and a total of{" "}
                          {FACTION_MIN_POINTS_FOR_TOWN} faction points.
                        </p>
                        <p id="reputation-donation-balance" className="text-sm">
                          You have {userData.reputationPoints.toLocaleString()}{" "}
                          reputation points available. This faction still needs{" "}
                          {Math.max(
                            0,
                            HIDEOUT_TOWN_UPGRADE - clanData.repTreasury,
                          ).toLocaleString()}
                          .
                        </p>
                        <label className="font-medium text-sm" htmlFor="reps">
                          Reputation points to donate
                        </label>
                        <Input
                          id="reps"
                          type="number"
                          min={1}
                          max={donationCapacity}
                          step={1}
                          inputMode="numeric"
                          className="mt-2"
                          placeholder="Reputation points to donate"
                          value={donateReps}
                          disabled={isDonationBusy}
                          aria-describedby="reputation-donation-balance"
                          onChange={(e) => setDonateReps(e.target.value)}
                        />
                      </Modal>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Clan boosts - only available for real clans, not outlaw factions/towns */}
          {!userData?.isOutlaw && (
            <div className="mt-4 grid grid-cols-2 gap-x-4">
              <BoostRow
                label="Training boost"
                currentBoost={clanData.trainingBoost}
                baseCost={CLAN_TRAINING_BOOST_BASE_COST}
                perLevelCost={CLAN_TRAINING_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() => purchaseBoost({ clanId, boostType: "trainingBoost" })}
              />
              <BoostRow
                label="Ryo gain boost"
                currentBoost={clanData.ryoBoost}
                baseCost={CLAN_RYO_BOOST_BASE_COST}
                perLevelCost={CLAN_RYO_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() => purchaseBoost({ clanId, boostType: "ryoBoost" })}
              />
              <BoostRow
                label="Regen boost"
                currentBoost={clanData.regenBoost}
                baseCost={CLAN_REGEN_BOOST_BASE_COST}
                perLevelCost={CLAN_REGEN_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId: clanData.id, boostType: "regenBoost" })
                }
              />
              <BoostRow
                label="Mission reward boost"
                currentBoost={clanData.missionRewardBoost}
                baseCost={CLAN_MISSION_BOOST_BASE_COST}
                perLevelCost={CLAN_MISSION_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId, boostType: "missionRewardBoost" })
                }
              />
              <BoostRow
                label="Crafting time reduction"
                currentBoost={clanData.craftingTimeBoost}
                baseCost={CLAN_CRAFTING_TIME_BOOST_BASE_COST}
                perLevelCost={CLAN_CRAFTING_TIME_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId, boostType: "craftingTimeBoost" })
                }
              />
              <BoostRow
                label="Crafting exp boost"
                currentBoost={clanData.craftingExpBoost}
                baseCost={CLAN_CRAFTING_EXP_BOOST_BASE_COST}
                perLevelCost={CLAN_CRAFTING_EXP_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId, boostType: "craftingExpBoost" })
                }
              />
              <BoostRow
                label="Hunter exp boost"
                currentBoost={clanData.hunterExpBoost}
                baseCost={CLAN_HUNTER_EXP_BOOST_BASE_COST}
                perLevelCost={CLAN_HUNTER_EXP_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId, boostType: "hunterExpBoost" })
                }
              />
              <BoostRow
                label="Gatherer exp boost"
                currentBoost={clanData.gathererExpBoost}
                baseCost={CLAN_GATHERER_EXP_BOOST_BASE_COST}
                perLevelCost={CLAN_GATHERER_EXP_BOOST_PER_LEVEL_COST}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() =>
                  purchaseBoost({ clanId, boostType: "gathererExpBoost" })
                }
              />
            </div>
          )}
          {/* Elder Nomination - only for non-outlaw clans */}
          {!userData?.isOutlaw &&
            leaderLike &&
            (() => {
              const now = new Date();
              const dayOfMonth = now.getUTCDate();
              const currentMonth = now.getUTCMonth() + 1;
              const currentYear = now.getUTCFullYear();
              const isWithinWindow =
                dayOfMonth >= ELDER_NOMINATION_CUTOFF_DAY &&
                dayOfMonth <= ELDER_NOMINATION_DEADLINE_DAY;
              const isEligible =
                clanData.elderCutoffMonth === currentMonth &&
                clanData.elderCutoffYear === currentYear;
              const canNominate = isWithinWindow && isEligible && selectedNomineeId;

              return (
                <div className="mt-4 rounded-lg border bg-muted p-3">
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <UserRoundCog className="h-5 w-5" />
                    <span className="font-bold">Village Elder Nomination</span>
                  </div>
                  <p className="mb-2 text-muted-foreground text-sm">
                    Nominations are open from the {ELDER_NOMINATION_CUTOFF_DAY}th to the{" "}
                    {ELDER_NOMINATION_DEADLINE_DAY}th of each month. Top 3 clans by
                    activity points (determined on the {ELDER_NOMINATION_CUTOFF_DAY}th)
                    can nominate a member to become elder. Nominees must be at least
                    Jonin rank and cannot be ANBU members.
                  </p>
                  {!isWithinWindow && (
                    <p className="mb-2 text-amber-600 text-sm">
                      Nomination window is closed. Opens on the{" "}
                      {ELDER_NOMINATION_CUTOFF_DAY}th of the month.
                    </p>
                  )}
                  {isWithinWindow && !isEligible && (
                    <p className="mb-2 text-red-600 text-sm">
                      Your clan is not eligible for elder nomination this month (not in
                      top 3 by activity points on the {ELDER_NOMINATION_CUTOFF_DAY}th).
                    </p>
                  )}
                  {isWithinWindow && isEligible && clanData.elderCutoffRank && (
                    <p className="mb-2 text-green-600 text-sm">
                      Your clan ranked #{clanData.elderCutoffRank} in activity points
                      and is eligible to nominate!
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Select
                      value={selectedNomineeId}
                      onValueChange={setSelectedNomineeId}
                      disabled={!isWithinWindow || !isEligible}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a member to nominate" />
                      </SelectTrigger>
                      <SelectContent>
                        {clanData.members
                          .filter((m) => !m.anbuId && hasRequiredRank(m.rank, "JONIN"))
                          .map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {member.username} (Lvl. {member.level})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() =>
                        nominateElder({ clanId, nomineeId: selectedNomineeId })
                      }
                      disabled={!canNominate || isNominating}
                      loading={isNominating}
                    >
                      Nominate
                    </Button>
                  </div>
                  {clanData.elderNominee && (
                    <p className="mt-2 text-sm">
                      Current nominee:{" "}
                      <span className="font-bold">
                        {clanData.elderNominee.username}
                      </span>
                    </p>
                  )}
                </div>
              );
            })()}
          {leaderLike && canCreateTown && (
            <>
              <Button
                id="upgradeHideout"
                className="my-2 w-full"
                disabled={isUpgradingToTown}
                aria-busy={isUpgradingToTown}
                aria-label={isUpgradingToTown ? "Upgrading" : undefined}
                onClick={() => setIsTownUpgradeModalOpen(true)}
              >
                {isUpgradingToTown ? (
                  <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
                ) : (
                  <Star className="mr-2 h-6 w-6" aria-hidden />
                )}
                {isUpgradingToTown ? "Upgrading" : "Upgrade to Town"}
              </Button>
              <Modal
                id="upgrade-hideout-to-town"
                title="Upgrade Hideout to Town"
                proceed_label="Upgrade to Town"
                proceed_loading_label="Upgrading"
                confirmClassName="bg-amber-600 text-white hover:bg-amber-700"
                isOpen={isTownUpgradeModalOpen}
                setIsOpen={setIsTownUpgradeModalOpen}
                isLoading={isUpgradingToTown}
                keepOpenOnAccept
                onAccept={() => void onUpgradeHideoutToTown()}
              >
                <div className="space-y-3">
                  <p>
                    This one-time upgrade turns the faction hideout into a town and
                    cannot be undone from here.
                  </p>
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                    <p className="font-semibold">The upgrade immediately consumes:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      <li>
                        {HIDEOUT_TOWN_UPGRADE.toLocaleString()} faction reputation
                        points
                      </li>
                      <li>
                        {FACTION_MIN_POINTS_FOR_TOWN.toLocaleString()} faction points
                      </li>
                    </ul>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Requirements: at least {FACTION_MIN_MEMBERS_FOR_TOWN} faction
                    members and {FACTION_MIN_POINTS_FOR_TOWN.toLocaleString()} faction
                    points. Towns also require a monthly maintenance payment of{" "}
                    {TOWN_MONTHLY_MAINTENANCE.toLocaleString()} faction points or may be
                    downgraded.
                  </p>
                </div>
              </Modal>
            </>
          )}
          {!hasResignedLeadership && (isLeader || isCoLeader) && (
            <>
              <Button
                id="resign-clan-leadership"
                className="my-2 w-full"
                disabled={isResigningLeadership}
                aria-busy={isResigningLeadership}
                aria-label={
                  isResigningLeadership
                    ? "Demoting"
                    : `Resign as ${isLeader ? "leader" : "co-leader"}`
                }
                onClick={() => setIsResignModalOpen(true)}
              >
                {isResigningLeadership ? (
                  <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
                ) : (
                  <DoorClosed className="mr-2 h-6 w-6" aria-hidden />
                )}
                {isResigningLeadership
                  ? "Demoting"
                  : `Resign as ${isLeader ? "Leader" : "Co-Leader"}`}
              </Button>
              <Modal
                id="resign-clan-leadership"
                title={`Resign as ${isLeader ? "Leader" : "Co-Leader"}`}
                isOpen={isResignModalOpen}
                setIsOpen={setIsResignModalOpen}
                proceed_label="Resign"
                proceed_loading_label="Demoting"
                confirmClassName="bg-red-600 text-white hover:bg-red-700"
                isLoading={isResigningLeadership}
                keepOpenOnAccept
                onAccept={() => void onResignLeadership()}
              >
                {isLeader ? (
                  <>
                    <p>
                      You are the {groupLabel.toLowerCase()} leader. A replacement must
                      be promoted to leader before you can step down; otherwise this
                      request will be rejected.
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Your role and permissions will not change if the request is
                      rejected.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Resign as co-leader of <strong>{clanData.name}</strong>? You will
                      remain a member of the {groupLabel.toLowerCase()}.
                    </p>
                    <p className="text-muted-foreground text-sm">
                      You will immediately lose co-leader management permissions until a
                      leader promotes you again.
                    </p>
                  </>
                )}
              </Modal>
            </>
          )}
          {isLeader && !hasClearedLeadership && (
            <Confirm
              id="clear-clan-leadership"
              title="Clear Leadership"
              proceed_label="Clear All"
              proceed_loading_label="Clearing"
              confirmClassName="bg-red-600 text-white hover:bg-red-700"
              disabled={isClearingLeadership}
              isLoading={isClearingLeadership}
              keepOpenOnAccept
              button={
                <Button
                  id="clear-leadership"
                  className="my-2 w-full"
                  disabled={isClearingLeadership}
                  aria-busy={isClearingLeadership}
                  aria-label={
                    isClearingLeadership
                      ? "Clearing"
                      : "Clear all delegated leadership roles"
                  }
                >
                  {isClearingLeadership ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <XCircle className="mr-2 h-5 w-5" aria-hidden />
                  )}
                  {isClearingLeadership ? "Clearing" : "Clear Leadership"}
                </Button>
              }
              onAccept={() => void onClearLeadership()}
            >
              <div className="space-y-3">
                <p>
                  Clear every delegated leadership role in{" "}
                  <strong>{clanData.name}</strong>?
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>All three co-leader slots will be cleared.</li>
                  <li>All ten assassin slots will be cleared.</li>
                </ul>
                <p className="text-muted-foreground text-sm">
                  The leader will remain in place. Everyone will remain a member of the{" "}
                  {groupLabel.toLowerCase()}, and unrelated clan details will not
                  change. These roles can be assigned again later.
                </p>
              </div>
            </Confirm>
          )}
          {!hasInstantlyTakenLeadership && !isLeader && canEditClans(userData.role) && (
            <>
              <Button
                id="instant-join-lead"
                className="my-2 w-full"
                disabled={isInstantlyJoiningAndLeading}
                aria-busy={isInstantlyJoiningAndLeading}
                aria-label={
                  isInstantlyJoiningAndLeading
                    ? "Promoting"
                    : `Take leadership of ${clanData.name}`
                }
                onClick={() => setIsInstantJoinModalOpen(true)}
              >
                {isInstantlyJoiningAndLeading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Swords className="mr-2 h-5 w-5" aria-hidden />
                )}
                {isInstantlyJoiningAndLeading ? "Promoting" : "Take Leadership"}
              </Button>
              <Modal
                id="instant-join-lead"
                title={`Take Leadership of ${clanData.name}`}
                proceed_label={
                  userData.clanId === clanId
                    ? "Take Leadership"
                    : "Join & Take Leadership"
                }
                proceed_loading_label="Promoting"
                confirmClassName="bg-amber-600 text-white hover:bg-amber-700"
                isOpen={isInstantJoinModalOpen}
                setIsOpen={setIsInstantJoinModalOpen}
                isLoading={isInstantlyJoiningAndLeading}
                keepOpenOnAccept
                proceedDisabled={isInDifferentClan}
                onAccept={() => void onInstantJoinAndLead()}
              >
                <div className="space-y-3">
                  <p>
                    This is a privileged override for <strong>{clanData.name}</strong>.
                  </p>
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                    <p className="font-semibold">This immediately:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {!userData.clanId && (
                        <li>
                          joins you to this {groupLabel.toLowerCase()} and moves you to{" "}
                          {clanData.village.name}
                        </li>
                      )}
                      {userData.clanId === clanId && (
                        <li>
                          keeps your existing membership in this{" "}
                          {groupLabel.toLowerCase()}
                        </li>
                      )}
                      {userData.clanId && userData.clanId !== clanId && (
                        <li className="font-semibold text-red-600 dark:text-red-400">
                          cannot proceed while you belong to another{" "}
                          {groupLabel.toLowerCase()}; leave it first
                        </li>
                      )}
                      <li>replaces the current leader with you</li>
                      <li>removes every current co-leader from their position</li>
                      {(clanData.village.type === "HIDEOUT" ||
                        clanData.village.type === "TOWN") && (
                        <li>
                          makes you the settlement leader of {clanData.village.name}
                        </li>
                      )}
                    </ul>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    The previous leader remains a regular member. This administrative
                    action does not require approval from existing leadership.
                  </p>
                </div>
              </Modal>
            </>
          )}
        </div>
      </div>
    </ContentBox>
  );
};

/**
 * Members in a clan
 */
interface ClanMembersProps {
  userId: string;
  clanId: string;
}

export const ClanMembers: React.FC<ClanMembersProps> = (props) => {
  // Destructure
  const { userId, clanId } = props;
  const { userData } = useRequireInVillage("/clanhall");
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // State
  const [kickTargetId, setKickTargetId] = useState<string | null>(null);
  const [pendingKickMemberId, setPendingKickMemberId] = useState<string | null>(null);
  const [successfulKick, setSuccessfulKick] = useState<{
    memberId: string;
    dataUpdatedAt: number;
  } | null>(null);
  const kickSubmissionsInFlight = useRef(new Set<string>());
  const [promoteTargetId, setPromoteTargetId] = useState<string | null>(null);
  const [pendingPromoteMemberId, setPendingPromoteMemberId] = useState<string | null>(
    null,
  );
  const [successfulPromotions, setSuccessfulPromotions] = useState<
    Array<{
      memberId: string;
      expectedRole: "leader" | "coleader" | "assassin";
      dataUpdatedAt: number;
    }>
  >([]);
  const promoteSubmissionsInFlight = useRef(new Set<string>());
  const [demoteTargetId, setDemoteTargetId] = useState<string | null>(null);
  const [pendingDemoteMemberId, setPendingDemoteMemberId] = useState<string | null>(
    null,
  );
  const [successfulDemotions, setSuccessfulDemotions] = useState<
    Array<{
      memberId: string;
      clearedColeaderRole: boolean;
      clearedAssassinRole: boolean;
      dataUpdatedAt: number;
    }>
  >([]);
  const demoteSubmissionsInFlight = useRef(new Set<string>());

  // Get react query utility
  const utils = api.useUtils();

  // Query
  const { data: clanData, dataUpdatedAt: clanDataUpdatedAt } = api.clan.get.useQuery(
    { clanId: clanId },
    { enabled: !!userData },
  );

  // Mutations
  const { mutateAsync: kick } = api.clan.kickMember.useMutation({
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });
  const { mutateAsync: promote } = api.clan.promoteMember.useMutation({
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });
  const { mutateAsync: demote } = api.clan.demoteMember.useMutation({
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  // A later clan read is authoritative only once it actually omits the removed
  // member. Failed or stale refetches must not expose the destructive action again.
  useEffect(() => {
    if (
      successfulKick &&
      clanData &&
      clanDataUpdatedAt > successfulKick.dataUpdatedAt &&
      !clanData.members.some((member) => member.userId === successfulKick.memberId)
    ) {
      setSuccessfulKick(null);
    }
  }, [clanData, clanDataUpdatedAt, successfulKick]);

  // Keep a successful promotion's old action suppressed until a later clan read
  // actually proves that exact member reached the server-selected next role. A
  // failed refetch, or a newer response that still contains the old role, must
  // not expose a duplicate promotion path.
  useEffect(() => {
    if (!clanData || successfulPromotions.length === 0) return;

    setSuccessfulPromotions((current) => {
      let changed = false;
      const next = current.filter((promotion) => {
        if (clanDataUpdatedAt <= promotion.dataUpdatedAt) return true;

        const member = clanData.members.find(
          (candidate) => candidate.userId === promotion.memberId,
        );
        if (!member) {
          changed = true;
          return false;
        }

        const authoritativeRole =
          member.userId === clanData.leaderId
            ? "leader"
            : checkCoLeader(member.userId, clanData)
              ? "coleader"
              : checkAssassin(member.userId, clanData)
                ? "assassin"
                : "member";
        if (authoritativeRole === promotion.expectedRole) {
          changed = true;
          return false;
        }
        return true;
      });

      return changed ? next : current;
    });
  }, [clanData, clanDataUpdatedAt, successfulPromotions.length]);

  // A successful response proves that the role assignment(s) present when the
  // action was submitted were cleared. Do not expose a stale repeat action until
  // a later authoritative read independently confirms every relevant slot is
  // empty. Once that absence has been observed, a future reappointment is shown
  // normally rather than being masked by old client state.
  useEffect(() => {
    if (!clanData || successfulDemotions.length === 0) return;

    setSuccessfulDemotions((current) => {
      let changed = false;
      const next = current.filter((demotion) => {
        if (clanDataUpdatedAt <= demotion.dataUpdatedAt) return true;

        const coleaderStillAssigned =
          demotion.clearedColeaderRole && checkCoLeader(demotion.memberId, clanData);
        const assassinStillAssigned =
          demotion.clearedAssassinRole && checkAssassin(demotion.memberId, clanData);
        if (!coleaderStillAssigned && !assassinStillAssigned) {
          changed = true;
          return false;
        }
        return true;
      });

      return changed ? next : current;
    });
  }, [clanData, clanDataUpdatedAt, successfulDemotions.length]);

  // Loader
  if (!clanData) return <Loader explanation="Loading clan data" />;

  // Derived
  const isColeader = checkCoLeader(userId, clanData);
  const isLeader = userId === clanData.leaderId;
  const canEdit = userData ? canEditClans(userData.role) : false;
  const kickTarget = clanData.members.find((member) => member.userId === kickTargetId);
  const promoteTarget = clanData.members.find(
    (member) => member.userId === promoteTargetId,
  );
  const demoteTarget = clanData.members.find(
    (member) => member.userId === demoteTargetId,
  );
  const promoteTargetIsLeader = promoteTarget?.userId === clanData.leaderId;
  const promoteTargetIsColeader = promoteTarget
    ? checkCoLeader(promoteTarget.userId, clanData)
    : false;
  const promoteTargetIsAssassin = promoteTarget
    ? checkAssassin(promoteTarget.userId, clanData)
    : false;
  const demoteTargetIsLeader = demoteTarget?.userId === clanData.leaderId;
  const demoteTargetIsColeader = demoteTarget
    ? checkCoLeader(demoteTarget.userId, clanData)
    : false;
  const demoteTargetIsAssassin = demoteTarget
    ? checkAssassin(demoteTarget.userId, clanData)
    : false;
  const currentLeader = clanData.members.find(
    (member) => member.userId === clanData.leaderId,
  );
  const currentAssassinCount = CLAN_ASSASSIN_SLOTS.filter(
    (slot) => clanData[slot],
  ).length;
  const hasOpenColeaderSlot = Boolean(
    !clanData.coLeader1 || !clanData.coLeader2 || !clanData.coLeader3,
  );

  const getExpectedPromotionRole = (
    member: NonNullable<typeof promoteTarget>,
  ): "leader" | "coleader" | "assassin" => {
    if (checkCoLeader(member.userId, clanData)) return "leader";
    if (member.isOutlaw && !checkAssassin(member.userId, clanData)) {
      return "assassin";
    }
    return "coleader";
  };

  const onKick = async () => {
    if (!kickTarget || kickSubmissionsInFlight.current.has(kickTarget.userId)) return;

    const memberId = kickTarget.userId;
    kickSubmissionsInFlight.current.add(memberId);
    setPendingKickMemberId(memberId);
    try {
      const data = await kick({ clanId, memberId });
      showMutationToast(data);
      if (!data.success) return;

      // The successful response proves this exact member was removed. Hide only
      // their stale row immediately; cache refreshes must never expose a duplicate
      // destructive retry path.
      setSuccessfulKick({ memberId, dataUpdatedAt: clanDataUpdatedAt });
      setKickTargetId(null);

      await Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Preserve the target
      // confirmation and consequence summary so the user can retry safely.
    } finally {
      kickSubmissionsInFlight.current.delete(memberId);
      setPendingKickMemberId((current) => (current === memberId ? null : current));
    }
  };

  const onPromote = async () => {
    if (
      !promoteTarget ||
      promoteTargetIsLeader ||
      promoteSubmissionsInFlight.current.has(promoteTarget.userId)
    ) {
      return;
    }

    const memberId = promoteTarget.userId;
    const expectedRole = getExpectedPromotionRole(promoteTarget);
    promoteSubmissionsInFlight.current.add(memberId);
    setPendingPromoteMemberId(memberId);
    try {
      const data = await promote({ clanId, memberId });
      showMutationToast(data);
      if (!data.success) return;

      // The response proves this exact role transition committed. Close at once
      // and suppress only its stale promotion action while refresh is best-effort.
      setSuccessfulPromotions((current) => [
        ...current.filter((promotion) => promotion.memberId !== memberId),
        { memberId, expectedRole, dataUpdatedAt: clanDataUpdatedAt },
      ]);
      setPromoteTargetId(null);

      await Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Keep the target and
      // its exact consequence visible so the same dialog can be retried.
    } finally {
      promoteSubmissionsInFlight.current.delete(memberId);
      setPendingPromoteMemberId((current) => (current === memberId ? null : current));
    }
  };

  const onDemote = async () => {
    if (
      !demoteTarget ||
      demoteTargetIsLeader ||
      demoteSubmissionsInFlight.current.has(demoteTarget.userId)
    ) {
      return;
    }

    const memberId = demoteTarget.userId;
    const clearedColeaderRole = demoteTargetIsColeader;
    const clearedAssassinRole = demoteTargetIsAssassin;
    demoteSubmissionsInFlight.current.add(memberId);
    setPendingDemoteMemberId(memberId);
    try {
      const data = await demote({ clanId, memberId });
      showMutationToast(data);
      if (!data.success) return;

      // The mutation committed both relevant role removals. Close immediately,
      // but suppress a destructive retry while clan refreshes are best-effort.
      setSuccessfulDemotions((current) => [
        ...current.filter((demotion) => demotion.memberId !== memberId),
        {
          memberId,
          clearedColeaderRole,
          clearedAssassinRole,
          dataUpdatedAt: clanDataUpdatedAt,
        },
      ]);
      setDemoteTargetId(null);

      void Promise.allSettled([
        utils.profile.getUser.invalidate(),
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Preserve the target
      // and exact role consequences in the dialog so the user can retry.
    } finally {
      demoteSubmissionsInFlight.current.delete(memberId);
      setPendingDemoteMemberId((current) => (current === memberId ? null : current));
    }
  };

  // Adjust members for table
  const members = clanData.members
    .filter((member) => member.userId !== successfulKick?.memberId)
    .map((member) => {
      const memberIsLeader = member.userId === clanData.leaderId;
      const memberIsColeader = checkCoLeader(member.userId, clanData);
      const memberIsAssassin = checkAssassin(member.userId, clanData);
      const canKick =
        canEdit || // canEdit role can kick anyone
        (isLeader && !memberIsLeader) || // Leader can kick anyone except other leaders
        (isColeader && !memberIsLeader && !memberIsColeader); // Co-leaders can kick normal members only
      const isThisMemberBeingKicked = pendingKickMemberId === member.userId;
      const isThisMemberBeingPromoted = pendingPromoteMemberId === member.userId;
      const isThisMemberBeingDemoted = pendingDemoteMemberId === member.userId;
      const isThisMemberBusy =
        isThisMemberBeingKicked ||
        isThisMemberBeingPromoted ||
        isThisMemberBeingDemoted;
      const hasCommittedPromotion = successfulPromotions.some(
        (promotion) => promotion.memberId === member.userId,
      );
      const hasCommittedDemotion = successfulDemotions.some(
        (demotion) => demotion.memberId === member.userId,
      );
      const canAttemptDemotion =
        (memberIsLeader
          ? canEdit && member.userId !== userId
          : isLeader ||
            canEdit ||
            (isColeader &&
              ((memberIsAssassin && !memberIsColeader) ||
                (memberIsColeader && member.userId === userId)))) &&
        (memberIsAssassin || memberIsLeader || memberIsColeader);
      return {
        ...member,
        rank: memberIsLeader
          ? "Leader"
          : memberIsColeader
            ? "Coleader"
            : memberIsAssassin
              ? "Assassin"
              : showUserRank(member),
        actions: (
          <div className="flex flex-row gap-1">
            {member.userId !== userId && (
              <>
                {/* KICK BUTTON (Now allows kicking leaders if canEdit is true) */}
                {canKick && (
                  <Button
                    id={`kick-${member.userId}`}
                    hoverText="Kick Member"
                    disabled={isThisMemberBusy}
                    aria-busy={isThisMemberBeingKicked}
                    aria-label={
                      isThisMemberBeingKicked
                        ? "Kicking"
                        : isThisMemberBeingPromoted
                          ? "Promoting"
                          : `Kick ${member.username}`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setKickTargetId(member.userId);
                    }}
                  >
                    {isThisMemberBeingKicked ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <DoorOpen className="h-5 w-5" aria-hidden />
                    )}
                  </Button>
                )}

                {/* PROMOTE BUTTON */}
                {(isLeader ||
                  (isColeader && !memberIsLeader && !memberIsColeader) ||
                  canEdit) &&
                  !memberIsLeader &&
                  !hasCommittedPromotion && (
                    <Button
                      id={`promote-${member.userId}`}
                      hoverText="Promote Member"
                      disabled={isThisMemberBusy}
                      aria-busy={isThisMemberBeingPromoted}
                      aria-label={
                        isThisMemberBeingPromoted
                          ? "Promoting"
                          : `Promote ${member.username}`
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setPromoteTargetId(member.userId);
                      }}
                    >
                      {isThisMemberBeingPromoted ? (
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      ) : (
                        <ArrowBigUpDash className="h-5 w-5" aria-hidden />
                      )}
                    </Button>
                  )}
              </>
            )}

            {/* DEMOTE BUTTON */}
            {canAttemptDemotion && !hasCommittedDemotion && (
              <Button
                id={`demote-${member.userId}`}
                hoverText={member.userId === userId ? "Step Down" : "Demote Member"}
                disabled={isThisMemberBusy}
                aria-busy={isThisMemberBeingDemoted}
                aria-label={
                  isThisMemberBeingDemoted
                    ? "Demoting"
                    : member.userId === userId
                      ? `Step down ${member.username}`
                      : `Demote ${member.username}`
                }
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDemoteTargetId(member.userId);
                }}
              >
                {isThisMemberBeingDemoted ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <ArrowBigDownDash className="h-5 w-5" aria-hidden />
                )}
              </Button>
            )}
          </div>
        ),
      };
    })
    .sort((a, b) => {
      if (a.rank === "Leader") return -1;
      if (b.rank === "Leader") return 1;
      if (a.rank === "Coleader") return -1;
      if (b.rank === "Coleader") return 1;
      if (a.rank === "Assassin") return -1;
      if (b.rank === "Assassin") return 1;
      return 0;
    });

  // Render
  return (
    <>
      <ContentBox
        title="Members"
        subtitle={`In the ${groupLabel} [${members.length} / ${CLAN_MAX_MEMBERS}]`}
        initialBreak={true}
        padding={false}
      >
        {members.length === 0 && <p className="p-2 italic">No current members</p>}
        {members.length > 0 && (
          <Table
            data={members}
            columns={[
              { key: "avatar", header: "", type: "avatar" },
              { key: "username", header: "Username", type: "string" },
              { key: "rank", header: "Rank", type: "capitalized" },
              { key: "pvpActivity", header: "PVP Activity", type: "string" },
              { key: "actions", header: "Actions", type: "jsx" },
            ]}
            linkPrefix="/username/"
            linkColumn={"username"}
          />
        )}
      </ContentBox>

      <Modal
        id={
          demoteTarget
            ? `demote-${demoteTarget.userId}-confirm`
            : "demote-member-confirm"
        }
        title={
          demoteTargetIsLeader
            ? `Cannot demote ${demoteTarget?.username ?? "leader"}`
            : demoteTarget?.userId === userId
              ? "Step down from your role?"
              : `Demote ${demoteTarget?.username ?? "member"}?`
        }
        proceed_label="Demote member"
        proceed_loading_label="Demoting"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isOpen={demoteTarget !== undefined}
        setIsOpen={(nextOpen) => {
          const shouldOpen =
            typeof nextOpen === "function"
              ? nextOpen(demoteTarget !== undefined)
              : nextOpen;
          if (!shouldOpen) setDemoteTargetId(null);
        }}
        isLoading={
          demoteTarget !== undefined && pendingDemoteMemberId === demoteTarget.userId
        }
        keepOpenOnAccept
        proceedDisabled={demoteTargetIsLeader}
        onAccept={() => void onDemote()}
      >
        {demoteTarget && (
          <div className="space-y-3">
            {demoteTargetIsLeader ? (
              <>
                <p>
                  <strong>{demoteTarget.username}</strong> is the current {groupLabel}
                  leader and cannot be demoted directly.
                </p>
                <p className="font-medium text-amber-600 text-sm">
                  Promote a co-leader to leader first. The previous leader will then
                  remain in the {groupLabel} as a regular member.
                </p>
              </>
            ) : (
              <>
                <p>
                  {demoteTarget.userId === userId ? "Step down" : "Demote"}{" "}
                  <strong>{demoteTarget.username}</strong> in this {groupLabel}?
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {demoteTargetIsColeader && (
                    <li>Every co-leader position assigned to them is cleared.</li>
                  )}
                  {demoteTargetIsAssassin && (
                    <li>Their assassin assignment is cleared.</li>
                  )}
                  <li>
                    Their {groupLabel} membership and member progress remain intact.
                  </li>
                  <li>The current leader and every other member are unaffected.</li>
                </ul>
                {demoteTarget.userId === userId && (
                  <p className="text-muted-foreground text-sm">
                    You will remain in the {groupLabel} as a regular member.
                  </p>
                )}
                {canEdit && !isLeader && !isColeader && (
                  <p className="text-muted-foreground text-sm">
                    This demotion uses your staff clan-management override.
                  </p>
                )}
                <p className="text-muted-foreground text-sm">
                  The role change takes effect immediately after confirmation.
                </p>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        id={
          promoteTarget
            ? `promote-${promoteTarget.userId}-confirm`
            : "promote-member-confirm"
        }
        title={promoteTarget ? `Promote ${promoteTarget.username}?` : "Promote member?"}
        proceed_label="Promote member"
        proceed_loading_label="Promoting"
        isOpen={promoteTarget !== undefined}
        setIsOpen={(nextOpen) => {
          const shouldOpen =
            typeof nextOpen === "function"
              ? nextOpen(promoteTarget !== undefined)
              : nextOpen;
          if (!shouldOpen) setPromoteTargetId(null);
        }}
        isLoading={
          promoteTarget !== undefined && pendingPromoteMemberId === promoteTarget.userId
        }
        keepOpenOnAccept
        proceedDisabled={promoteTargetIsLeader}
        onAccept={() => void onPromote()}
      >
        {promoteTarget && (
          <div className="space-y-3">
            <p>
              Promote <strong>{promoteTarget.username}</strong> in this {groupLabel}?
            </p>

            {promoteTargetIsColeader ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  {promoteTarget.username} becomes the {groupLabel} leader.
                </li>
                {currentLeader && (
                  <li>
                    {currentLeader.username}{" "}
                    {clanData.coLeader1 === promoteTarget.userId
                      ? "moves into this co-leader position."
                      : "becomes a regular member under the current leadership-slot ordering."}
                  </li>
                )}
                {(clanData.village.type === "HIDEOUT" ||
                  clanData.village.type === "TOWN") && (
                  <li>
                    Settlement leadership of {clanData.village.name} also transfers to{" "}
                    {promoteTarget.username}.
                  </li>
                )}
                {promoteTargetIsAssassin && (
                  <li>Their existing assassin assignment remains recorded.</li>
                )}
              </ul>
            ) : promoteTarget.isOutlaw && !promoteTargetIsAssassin ? (
              <div className="space-y-2 text-sm">
                <p>
                  {promoteTarget.username} will be assigned the next open assassin
                  position.
                </p>
                {currentAssassinCount >= ASSASSIN_MAX_PER_FACTION && (
                  <p className="font-medium text-amber-600">
                    All {ASSASSIN_MAX_PER_FACTION} assassin positions are occupied, so
                    the server is expected to refuse this promotion.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  {promoteTarget.username} will be assigned the next open co-leader
                  position.
                </p>
                {promoteTargetIsAssassin && (
                  <p>Their existing assassin assignment remains recorded.</p>
                )}
                {!hasOpenColeaderSlot && (
                  <p className="font-medium text-amber-600">
                    All three co-leader positions are occupied, so the server is
                    expected to refuse this promotion.
                  </p>
                )}
              </div>
            )}

            {canEdit && !isLeader && !isColeader && (
              <p className="text-muted-foreground text-sm">
                This promotion uses your staff clan-management override.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              The role changes immediately after confirmation.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        id={kickTarget ? `kick-${kickTarget.userId}-confirm` : "kick-member-confirm"}
        title={kickTarget ? `Kick ${kickTarget.username}?` : "Kick member?"}
        proceed_label="Kick member"
        proceed_loading_label="Kicking"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isOpen={kickTarget !== undefined}
        setIsOpen={(nextOpen) => {
          const shouldOpen =
            typeof nextOpen === "function"
              ? nextOpen(kickTarget !== undefined)
              : nextOpen;
          if (!shouldOpen) setKickTargetId(null);
        }}
        isLoading={
          kickTarget !== undefined && pendingKickMemberId === kickTarget.userId
        }
        keepOpenOnAccept
        onAccept={() => void onKick()}
      >
        {kickTarget && (
          <div className="space-y-3">
            <p>
              Remove <strong>{kickTarget.username}</strong> from this {groupLabel}?
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Their {groupLabel} membership is removed immediately.</li>
              <li>Any assigned leadership or assassin role is cleared.</li>
              <li>Clan requests involving them are deleted.</li>
              <li>
                They are removed from queued clan battles and returned to Awake if
                currently queued.
              </li>
              {kickTarget.isOutlaw && <li>They are returned to the Syndicate.</li>}
            </ul>
            {kickTarget.userId === clanData.leaderId && (
              <p className="font-medium text-amber-600 text-sm">
                This member is the current leader. Confirm the leadership transition
                before continuing.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              This cannot be undone here; the member would need to join again.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
};

/**
 * Show the profile of the user's clan
 */
interface ClanProfileProps {
  clanId: string;
  defaultBackHref?: string;
}

export const ClanProfile: React.FC<ClanProfileProps> = (props) => {
  // Destructure & state
  const [showActive, setShowActive] = useLocalStorage<string>("clanPageTab", "orders");
  const { userData } = useRequireInVillage("/clanhall");
  const { clanId, defaultBackHref } = props;

  // Queries
  const { data: clanData } = api.clan.get.useQuery(
    { clanId: clanId },
    { enabled: !!userData },
  );

  // Two-level filtering
  const state = useFiltering("clan");

  // Loaders
  if (!clanId) return <Loader explanation="Which clan?" />;
  if (!clanData) return <Loader explanation="Loading clan data" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Derived
  const isLeader = userData.userId === clanData.leaderId;
  const isColeader = checkCoLeader(userData.userId, clanData);

  // Render
  return (
    <>
      {/** OVERVIEW */}
      <ClanInfo defaultBackHref={defaultBackHref} clanData={clanData} />
      <div className="w-full pt-2">
        <Tabs
          defaultValue={showActive}
          className="flex flex-col items-center justify-center"
          onValueChange={(value) => setShowActive(value)}
        >
          <TabsList className="text-center">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="battles">Battles</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="war">War</TabsTrigger>
            {userData.isOutlaw && <TabsTrigger value="logs">Logs</TabsTrigger>}
          </TabsList>
          <TabsContent value="orders">
            <ClanOrders
              clanId={clanData.id}
              order={clanData.leaderOrder}
              canPost={isLeader || isColeader}
            />
          </TabsContent>
          <TabsContent value="battles">
            <ClanBattles clanId={clanData.id} canCreate={isLeader || isColeader} />
          </TabsContent>
          <TabsContent value="requests">
            <ClanRequests
              clanId={clanData.id}
              clanLeaderId={clanData.leaderId}
              isLeaderOrColeader={isLeader || isColeader}
            />
          </TabsContent>
          <TabsContent value="tournaments">
            <Tournament
              userData={userData}
              tournamentId={clanData.id}
              rewards={ObjectiveReward.parse({ reward_money: clanData.bank })}
              title={`Tournaments`}
              subtitle="Initiated by leader"
              type="CLAN"
              canCreate={(isLeader || isColeader) && clanData.bank > 0}
              canJoin={userData.clanId === clanData.id}
            />
          </TabsContent>
          <TabsContent value="members">
            <ClanMembers userId={userData.userId} clanId={clanData.id} />
          </TabsContent>
          <TabsContent value="war">
            <WarRoom user={userData} initialBreak={true} />
          </TabsContent>
          {userData.isOutlaw && (
            <TabsContent value="logs">
              <ActionLogs
                state={getFilter(state)}
                relatedId={clanData.id}
                initialBreak={true}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
};

// Helper component for displaying boost rows with Ryo-based costs
interface BoostRowProps {
  label: string;
  currentBoost: number;
  baseCost: number;
  perLevelCost: number;
  clanBank: number;
  canPurchase: boolean;
  isPending?: boolean;
  onPurchase: () => void;
}

const BoostRow: React.FC<BoostRowProps> = ({
  label,
  currentBoost,
  baseCost,
  perLevelCost,
  clanBank,
  canPurchase,
  isPending,
  onPurchase,
}) => {
  const currentLevel = currentBoost / CLAN_BOOST_PERCENT_PER_LEVEL;
  const cost = baseCost + currentLevel * perLevelCost;
  const canAfford = clanBank >= cost;
  const isMaxed = currentLevel >= CLAN_BOOST_MAX_LEVEL;

  return (
    <div className="flex flex-row items-center">
      <p>
        {label}: {currentBoost}%
      </p>
      {canPurchase && (
        <Confirm
          title={`Purchase ${label}`}
          proceed_label={!isMaxed && canAfford ? "Purchase" : "Cannot purchase"}
          button={
            <ArrowBigUpDash className="ml-2 h-6 w-6 hover:cursor-pointer hover:text-orange-500" />
          }
          disabled={isPending}
          onAccept={onPurchase}
        >
          {isMaxed ? (
            <p>
              Maximum level reached (
              {CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL}%)
            </p>
          ) : (
            <div>
              <p>
                Purchase {CLAN_BOOST_PERCENT_PER_LEVEL}% {label.toLowerCase()} for{" "}
                <span className={canAfford ? "text-green-600" : "text-red-600"}>
                  {cost.toLocaleString()} Ryo
                </span>{" "}
                from clan bank.
              </p>
              <p className="mt-2">
                Current bank balance: {clanBank.toLocaleString()} Ryo
              </p>
              <p className="mt-2 text-gray-500 text-sm">
                Note: Boosts decay by {CLAN_BOOST_PERCENT_PER_LEVEL}% per day.
              </p>
            </div>
          )}
        </Confirm>
      )}
    </div>
  );
};
