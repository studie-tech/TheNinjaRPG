import React, { useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { parseHtml } from "@/utils/parse";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import AvatarImage from "@/layout/Avatar";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import {
  Form,
  FormControl,
  FormField,
  FormLabel,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { DoorOpen, ArrowBigUpDash, ArrowBigDownDash } from "lucide-react";
import { SendHorizontal, Swords, DoorClosed, PiggyBank, Star } from "lucide-react";
import { FilePenLine, List, CirclePlay, ScanEye, Palette } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Medal, HeartCrack } from "lucide-react";
import ActionLogs from "@/layout/ActionLog";
import { useFiltering, getFilter } from "@/layout/ActionLogFiltering";
import { showUserRank } from "@/libs/profile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadButton } from "@/utils/uploadthing";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ClanSearchSelect from "@/layout/ClanSearchSelect";
import Countdown from "@/layout/Countdown";
import { ColorPicker } from "@/components/ui/color-picker";
import Confirm2 from "@/layout/Confirm2";
import RichInput from "@/layout/RichInput";
import UserRequestSystem from "@/layout/UserRequestSystem";
import Tournament from "@/layout/Tournament";
import { ObjectiveReward } from "@/validators/objectives";
import { mutateContentSchema } from "@/validators/comments";
import { api } from "@/app/_trpc/client";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { CLAN_RANK_REQUIREMENT } from "@/drizzle/constants";
import { CLAN_MAX_MEMBERS } from "@/drizzle/constants";
import { CLAN_LOBBY_SECONDS } from "@/drizzle/constants";
import { CLAN_MAX_TRAINING_BOOST, CLAN_TRAINING_BOOST_COST } from "@/drizzle/constants";
import { CLAN_MAX_RYO_BOOST, CLAN_RYO_BOOST_COST } from "@/drizzle/constants";
import { CLAN_MAX_REGEN_BOOST, CLAN_REGEN_BOOST_COST } from "@/drizzle/constants";
import { CLAN_MPVP_MAX_USERS_PER_SIDE } from "@/drizzle/constants";
import { HIDEOUT_COST, FACTION_MIN_POINTS_FOR_TOWN } from "@/drizzle/constants";
import {
  FACTION_MIN_MEMBERS_FOR_TOWN,
  HIDEOUT_TOWN_UPGRADE,
  CLAN_COLOR_CHANGE_REP_COST,
} from "@/drizzle/constants";
import { checkCoLeader, checkAssassin } from "@/validators/clan";
import { factionEditSchema } from "@/validators/clan";
import { factionColorEditSchema } from "@/validators/clan";
import { useRequireInVillage } from "@/utils/UserContext";
import { secondsFromDate } from "@/utils/time";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useLocalStorage } from "@/hooks/localstorage";
import { cn } from "src/libs/shadui";
import { WarRoom } from "@/layout/WarSystem";
import type { UserRank } from "@/drizzle/schema";
import type { FactionEditSchema } from "@/validators/clan";
import type { FactionColorEditSchema } from "@/validators/clan";
import type { BaseServerResponse } from "@/server/api/trpc";
import type { MutateContentSchema } from "@/validators/comments";
import type { UserNindo } from "@/drizzle/schema";
import type { ArrayElement } from "@/utils/typeutils";
import type { ClanRouter } from "@/routers/clan";
import { canEditClans } from "@/utils/permissions";

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

  // utils
  const utils = api.useUtils();

  // Mutations
  const { mutate: notice } = api.clan.upsertNotice.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
      }
    },
  });

  // Content
  const content = order?.content ?? `No current ${groupLabel} orders`;

  // Order form
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    defaultValues: { content },
    resolver: zodResolver(mutateContentSchema),
  });
  const onUpdateOrder = handleSubmit((data) => notice({ ...data, clanId }));

  return (
    <ContentBox
      title="Orders"
      subtitle={`From ${groupLabel} leader`}
      initialBreak={true}
      topRightContent={
        <div>
          {canPost && (
            <div className="flex flex-row items-center gap-1">
              <Confirm2
                title="Update Orders"
                proceed_label="Submit"
                button={
                  <Button id="create">
                    <FilePenLine className="h-5 w-5" />
                  </Button>
                }
                onAccept={onUpdateOrder}
              >
                <RichInput
                  id="content"
                  label="Contents of your orders"
                  height="300"
                  placeholder={content}
                  control={control}
                  error={errors.content?.message}
                />
              </Confirm2>
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

  // utils
  const utils = api.useUtils();

  // Get router
  const router = useRouter();

  // Mutations
  const { mutate: challenge } = api.clan.challengeClan.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.getClanBattles.invalidate();
      }
    },
  });

  const { mutate: join } = api.clan.joinClanBattle.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.getClanBattles.invalidate();
      }
    },
  });

  const { mutate: leave } = api.clan.leaveClanBattle.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.getClanBattles.invalidate();
      }
    },
  });

  const { mutate: kick } = api.clan.kickFromClanBattle.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.getClanBattles.invalidate();
      }
    },
  });

  const { mutate: initiate, isPending: isInitiating } =
    api.clan.initiateClanBattle.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.clan.getClanBattles.invalidate();
          router.push("/combat");
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
    const canJoin = clan.id === userClanId;
    const crewLength = Math.max(CLAN_MPVP_MAX_USERS_PER_SIDE, queue.length);
    const empties = Array(crewLength - queue.length).fill(null);
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
          {queue.map((q) => (
            <div key={q.userId} className="w-10 flex flex-row items-center">
              <Popover>
                <PopoverTrigger>
                  <AvatarImage
                    className={border}
                    href={q.user.avatar}
                    alt={q.user.username}
                    size={50}
                    hover_effect={!hasWinner}
                    priority
                  />
                </PopoverTrigger>
                <PopoverContent>
                  <div className="flex flex-col gap-2">
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
                          onClick={() =>
                            kick({
                              clanBattleId: battleId,
                              targetId: q.userId,
                              clanId: clan.id,
                            })
                          }
                        >
                          <DoorOpen className="mr-2 h-5 w-5" />
                          Kick
                        </Button>
                      )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ))}
          {empties.map((_, i) => (
            <div className="flex flex-row items-center w-10" key={i}>
              <div
                className={`rounded-2xl border-2 border-black aspect-square w-5/6 flex flex-row items-center justify-center font-bold bg-slate-100 opacity-50 ${canJoin && !hasWinner ? "hover:opacity-100 hover:cursor-pointer hover:border-orange-500 hover:bg-orange-100" : ""}`}
                onClick={() => canJoin && join({ clanBattleId: battleId })}
              >
                ?
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Query
  const { data } = api.clan.getClanBattles.useQuery(
    { clanId: clanId },
    { refetchInterval: 10000 },
  );

  // Clan search
  const maxClans = 1;
  const clanSearchSchema = z.object({
    name: z.string(),
    clans: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          image: z.string().url().optional().nullish(),
        }),
      )
      .min(1)
      .max(maxClans),
  });
  const clanSearchMethods = useForm<z.infer<typeof clanSearchSchema>>({
    resolver: zodResolver(clanSearchSchema),
    defaultValues: { name: "", clans: [] },
  });
  const targetClan = useWatch({
    control: clanSearchMethods.control,
    name: "clans",
    defaultValue: [],
  })?.[0];

  // Loaders
  if (!data) return <Loader explanation="Loading clan battles" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Prepare data for table
  const clanBattles = data.map((battle) => {
    const challengers = battle.queue.filter((q) => q.user.clanId === battle.clan1Id);
    const defenders = battle.queue.filter((q) => q.user.clanId === battle.clan2Id);
    const startTime = secondsFromDate(CLAN_LOBBY_SECONDS, battle.createdAt);
    const inBattle = battle.queue.some((q) => q.userId === userData.userId);
    const userClan = userData.clanId;
    const winnerId = battle.winnerId;
    const hasStarted = !!battle.battleId;
    const hasConcluded = !!battle.winnerId;
    return {
      ...battle,
      clan1name: showClanSide(battle.id, userClan, battle.clan1, winnerId, challengers),
      clan2name: showClanSide(battle.id, userClan, battle.clan2, winnerId, defenders),
      countdown: (
        <div className="flex flex-col gap-1">
          {isInitiating ? (
            <Loader explanation="Starting battle" />
          ) : (
            inBattle &&
            !hasStarted && (
              <>
                <Button
                  className="w-full"
                  onClick={() => initiate({ clanBattleId: battle.id })}
                >
                  <CirclePlay className="h-6 w-6 mr-2" /> Start
                </Button>
                <Button
                  className="w-full"
                  onClick={() => leave({ clanBattleId: battle.id })}
                >
                  <DoorOpen className="h-6 w-6 mr-2" /> Leave
                </Button>
              </>
            )
          )}
          {hasStarted && (
            <Link href={`/battlelog/${battle.battleId}`}>
              <Button className={cn(hasConcluded ? "grayscale" : "", "w-full")}>
                <ScanEye className="h-6 w-6 mr-2" />{" "}
                {hasConcluded ? "Review" : "Spectate"}
              </Button>
            </Link>
          )}
          {hasConcluded && (
            <div>
              {battle.winnerId === clanId ? (
                <Badge className="bg-green-600 w-full">
                  <Medal className="h-6 w-6 mr-2" /> Victory
                </Badge>
              ) : (
                <Badge className="bg-red-600 w-full">
                  <HeartCrack className="h-6 w-6 mr-2" /> Defeat
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
              <Confirm2
                title={`Challenge Other ${groupLabel}`}
                proceed_label="Submit"
                button={
                  <Button id="create">
                    <Swords className="h-5 w-5" />
                  </Button>
                }
                onAccept={() =>
                  challenge({
                    challengerClanId: clanId,
                    targetClanId: targetClan?.id ?? "",
                  })
                }
              >
                Challenge another {groupLabel.toLowerCase()} to a battle royale.{" "}
                {groupLabel} battles can be up to 5 vs. 5 users; it will always be an
                equal number of users battling each other, so if 5 join from one side
                and 3 from the other, it will be a 3 vs. 3 battle.
                <ClanSearchSelect
                  useFormMethods={clanSearchMethods}
                  label={`Search for ${groupLabel.toLowerCase()}`}
                  selectedClans={[]}
                  inline={true}
                  showOwn={false}
                  userClanId={clanId}
                  maxClans={1}
                />
              </Confirm2>
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
  isLeader: boolean;
}

export const ClanRequests: React.FC<ClanRequestsProps> = (props) => {
  // Destructure
  const { userData } = useRequireInVillage("/clanhall");
  const { clanId, isLeader } = props;
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // Get utils
  const utils = api.useUtils();

  // Query
  const { data: requests } = api.clan.getRequests.useQuery(undefined, {
    staleTime: 5000,
  });

  // How to deal with success responses
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await utils.clan.get.invalidate();
      await utils.clan.getRequests.invalidate();
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
  const showRequestSystem = (isLeader && requests.length > 0) || !userData.clanId;
  const shownRequests = requests.filter((r) => !isLeader || r.status === "PENDING");
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
            <SendHorizontal className="h-5 w-5 mr-2" />
            Send Request
          </Button>
        </div>
      )}
      {/* SHOW REQUESTS */}
      {shownRequests.length === 0 && <p className="p-2 italic">No current requests</p>}
      {shownRequests.length > 0 && (
        <UserRequestSystem
          requests={shownRequests}
          userId={userData.userId}
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
  const [donateReps, setDonateReps] = useState(0);

  // Get router
  const router = useRouter();

  // Get react query utility
  const utils = api.useUtils();

  // Deposit to bank
  const money = userData?.money ?? 0;
  const fromPocketSchema = z.object({
    amount: z.coerce.number().int().positive().max(money),
  });
  const toBankForm = useForm<z.infer<typeof fromPocketSchema>>({
    resolver: zodResolver(fromPocketSchema),
  });

  // Mutations
  const { mutate: edit } = api.clan.editClan.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
      }
    },
  });

  const { mutate: editColor } = api.clan.editClanColor.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.clan.get.invalidate(),
          utils.village.getSectorOwnerships.invalidate(),
        ]);
      }
    },
  });

  const { mutate: leave } = api.clan.leaveClan.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.get.invalidate();
        await utils.clan.getRequests.invalidate();
        router.push("/clanhall");
      }
    },
  });

  const { mutate: demote } = api.clan.demoteMember.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
        await utils.clan.getRequests.invalidate();
      }
    },
  });

  const { mutate: boostTraining } = api.clan.purchaseTrainingBoost.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
      }
    },
  });

  const { mutate: boostRyo } = api.clan.purchaseRyoBoost.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
      }
    },
  });

  const { mutate: purchaseRegenBoost } = api.clan.purchaseRegenBoost.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.clan.get.invalidate();
      }
    },
  });

  const { mutate: clanDonate } = api.clan.clanDonate.useMutation({
    onSuccess: async (data, variables) => {
      showMutationToast(data);
      if (data.success && userData) {
        await Promise.all([
          utils.clan.get.invalidate(),
          updateUser({
            reputationPoints: userData.reputationPoints - variables.reputationPoints,
          }),
        ]);
      }
    },
  });

  const { mutate: upgradeHideoutToTown } = api.clan.upgradeHideoutToTown.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && userData) {
        await utils.clan.get.invalidate();
      }
    },
  });

  const { mutate: toBank, isPending: isDepositing } = api.clan.toBank.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.get.invalidate();
        toBankForm.reset();
      }
    },
  });
  const onDeposit = toBankForm.handleSubmit((data) => toBank({ ...data, clanId }));

  const { mutate: instantJoinAndLead } = api.clan.instantJoinAndLead.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.clan.get.invalidate();
        router.push("/clanhall");
      }
    },
  });

  // Rename Form
  const editForm = useForm<FactionEditSchema>({
    resolver: zodResolver(factionEditSchema),
    defaultValues: { name: clanData.name, image: clanData.image, clanId },
  });
  const onEdit = editForm.handleSubmit((data) => edit(data));
  const currentImage = useWatch({ control: editForm.control, name: "image" });

  // Color Form
  const colorForm = useForm<FactionColorEditSchema>({
    resolver: zodResolver(factionColorEditSchema),
    defaultValues: { color: userData?.village?.hexColor ?? "#000000", clanId },
  });
  const onColorEdit = colorForm.handleSubmit((data) => editColor(data));

  // Loader
  if (!clanData) return <Loader explanation="Loading clan data" />;
  if (!userData) return <Loader explanation="Loading user data" />;
  if (isDepositing) return <Loader explanation="Depositing money" />;

  // Derived
  const village = clanData.village;
  const inClan = userData.clanId === clanData.id;
  const isLeader = userData.userId === clanData.leaderId;
  const isCoLeader = checkCoLeader(userData.userId, clanData);
  const leaderLike = isLeader || isCoLeader;
  const hadHideout = village?.type !== "OUTLAW" && userData.isOutlaw;
  const hadTown = village?.type === "TOWN" || village?.wasDowngraded || false;
  // Can we upgrade from hideout to town?
  const hasReps = clanData.repTreasury >= HIDEOUT_TOWN_UPGRADE;
  const hasMembers = clanData.members.length >= FACTION_MIN_MEMBERS_FOR_TOWN;
  const hasPoints = clanData.points >= FACTION_MIN_POINTS_FOR_TOWN;
  const canCreateTown = !hadTown && hadHideout && hasReps && hasMembers && hasPoints;

  // Render
  return (
    <ContentBox
      title={clanData.name}
      subtitle={`${groupLabel} Overview`}
      defaultBackHref={defaultBackHref}
      topRightContent={
        <div className="flex flex-row gap-1">
          {isLeader && hadHideout && (
            <Confirm2
              title={`Edit ${groupLabel} Color`}
              proceed_label="Submit"
              button={
                <Button id="rename-clan">
                  <Palette className="h-5 w-5" />
                </Button>
              }
              onAccept={onColorEdit}
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
                            />
                            <div className="text-xs text-muted-foreground">
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
            </Confirm2>
          )}
          {isLeader && (
            <Confirm2
              title={`Edit ${groupLabel}`}
              proceed_label="Submit"
              button={
                <Button id="rename-clan" hoverText={`Edit ${groupLabel}`}>
                  <FilePenLine className="h-5 w-5" />
                </Button>
              }
              isValid={editForm.formState.isValid}
              onAccept={onEdit}
            >
              <Form {...editForm}>
                <form className="space-y-2 grid grid-cols-2" onSubmit={onEdit}>
                  <div>
                    <FormLabel>{groupLabel} Image</FormLabel>
                    <AvatarImage
                      href={currentImage}
                      alt={clanId}
                      size={100}
                      hover_effect={true}
                      priority
                    />
                    <UploadButton
                      endpoint="clanUploader"
                      onClientUploadComplete={(res) => {
                        const url = res?.[0]?.serverData?.fileUrl;
                        if (url) {
                          editForm.setValue("image", url, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      onUploadError={(error: Error) => {
                        showMutationToast({ success: false, message: error.message });
                      }}
                    />
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
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
            </Confirm2>
          )}
          {inClan && (
            <Confirm2
              title={`Village ${groupLabel} Overview`}
              button={
                <Button id="send" hoverText={`${groupLabel} Overview`}>
                  <List className="h-5 w-5" />
                </Button>
              }
            >
              <ClansOverview />
            </Confirm2>
          )}
          {inClan && (
            <Confirm2
              title={`Leave ${groupLabel}`}
              proceed_label="Submit"
              button={
                <Button id="send" hoverText={`Leave ${groupLabel}`}>
                  <DoorOpen className="h-5 w-5" />
                </Button>
              }
              onAccept={() => leave({ clanId })}
            >
              Confirm leaving this {groupLabel.toLowerCase()}
            </Confirm2>
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
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2">
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
              <div className="flex flex-row items-center">
                <p>Training boost: {clanData.trainingBoost}%</p>
                {leaderLike && (
                  <Confirm2
                    title="Boost training gain for members"
                    proceed_label={
                      clanData.points >= CLAN_TRAINING_BOOST_COST
                        ? "Submit"
                        : "Cannot afford"
                    }
                    button={
                      <ArrowBigUpDash className="ml-2 h-6 w-6 hover:text-orange-500 hover:cursor-pointer" />
                    }
                    onAccept={() => boostTraining({ clanId })}
                  >
                    {clanData.trainingBoost < CLAN_MAX_TRAINING_BOOST ? (
                      <p>
                        Boost the training gain for members for{" "}
                        {CLAN_TRAINING_BOOST_COST} clan points. Note that this boost is
                        gradually reduced once per day. You currently have{" "}
                        {clanData.points} points.
                      </p>
                    ) : (
                      <p>Already maxed out the possible boost</p>
                    )}
                  </Confirm2>
                )}
              </div>
              {userData?.isOutlaw && (
                <div className="flex flex-row items-center">
                  <p>Regen boost: {clanData.regenBoost}%</p>
                  {leaderLike && (
                    <Confirm2
                      title="Boost regen for members"
                      proceed_label={
                        clanData.points >= CLAN_REGEN_BOOST_COST
                          ? "Submit"
                          : "Cannot afford"
                      }
                      button={
                        <ArrowBigUpDash className="ml-2 h-6 w-6 hover:text-orange-500 hover:cursor-pointer" />
                      }
                      onAccept={() => purchaseRegenBoost({ clanId: clanData.id })}
                    >
                      {clanData.regenBoost < CLAN_MAX_REGEN_BOOST ? (
                        <p>
                          Boost the regen for members for {CLAN_REGEN_BOOST_COST} clan
                          points. Note that this boost is gradually reduced once per
                          day. You currently have {clanData.points} points.
                        </p>
                      ) : (
                        <p>Already maxed out the possible boost</p>
                      )}
                    </Confirm2>
                  )}
                </div>
              )}
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
                <Confirm2
                  title="Donate to clan"
                  proceed_label="Submit"
                  button={
                    <PiggyBank className="ml-2 h-6 w-6 hover:text-orange-500 hover:cursor-pointer" />
                  }
                  onAccept={onDeposit}
                >
                  <p>
                    Confirm donating money from pocket to clan bank. You currently have{" "}
                    {userData.money} ryo in your pocket.
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
                          <FormItem className="w-full flex flex-col">
                            <FormControl>
                              <Input
                                id="amount"
                                className="mt-2"
                                placeholder="Transfer to bank"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </Confirm2>
              </div>
              <div className="flex flex-row items-center">
                <p>Ryo gain boost: {clanData.ryoBoost}%</p>{" "}
                {(isLeader || isCoLeader) && (
                  <Confirm2
                    title="Boost ryo gain for members"
                    proceed_label={
                      clanData.points >= CLAN_RYO_BOOST_COST
                        ? "Submit"
                        : "Cannot afford"
                    }
                    button={
                      <ArrowBigUpDash className="ml-2 h-6 w-6 hover:text-orange-500 hover:cursor-pointer" />
                    }
                    onAccept={() => boostRyo({ clanId })}
                  >
                    {clanData.ryoBoost < CLAN_MAX_RYO_BOOST ? (
                      <p>
                        Boost the ryo gain for members for {CLAN_RYO_BOOST_COST} clan
                        points. Note that this boost is gradually reduced once per day.
                        You currently have {clanData.points} points.
                      </p>
                    ) : (
                      <p>Already maxed out the possible boost</p>
                    )}
                  </Confirm2>
                )}
              </div>
              {!hadTown && hadHideout && userData?.isOutlaw && (
                <div className="flex flex-row items-center">
                  <p>Town Upgrade: {clanData.repTreasury} reps</p>
                  {leaderLike && (
                    <Confirm2
                      title="Donate reputation points"
                      proceed_label="Donate"
                      button={
                        <Star className="ml-2 h-5 w-5 hover:text-orange-500 hover:cursor-pointer" />
                      }
                      onAccept={() =>
                        clanDonate({
                          clanId: clanData.id,
                          reputationPoints: donateReps,
                        })
                      }
                    >
                      <p>
                        The hideout can be upgraded to a town, enabling the faction to
                        operate in a manner much similar to one of the great ninja
                        villages, with the exception of the establishments of new clans
                        and ANBU. This requires a total of {HIDEOUT_TOWN_UPGRADE}{" "}
                        reputation points, that the faction has{" "}
                        {FACTION_MIN_MEMBERS_FOR_TOWN} members, and a total of{" "}
                        {FACTION_MIN_POINTS_FOR_TOWN} faction points.
                      </p>
                      <Input
                        id="reps"
                        type="number"
                        className="mt-2"
                        placeholder="Reputation points to donate"
                        onChange={(e) => setDonateReps(Number(e.target.value))}
                      />
                    </Confirm2>
                  )}
                </div>
              )}
            </div>
          </div>
          {leaderLike && canCreateTown && (
            <Button
              id="upgradeHideout"
              className="my-2 w-full"
              onClick={() => upgradeHideoutToTown({ clanId })}
            >
              <Star className="h-6 w-6 mr-2" />
              Upgrade to Town
            </Button>
          )}
          {(isLeader || isCoLeader) && (
            <Button
              id="challenge"
              className="my-2 w-full"
              onClick={() => demote({ clanId, memberId: userData.userId })}
            >
              <DoorClosed className="h-6 w-6 mr-2" />
              Resign as Leader
            </Button>
          )}
          {!isLeader && canEditClans(userData.role) && (
            <Confirm2
              title="Instantly Join & Take Leadership"
              proceed_label="Confirm"
              button={
                <Button id={`instant-join-lead`} className="w-full my-2">
                  <Swords className="mr-2 h-5 w-5" />
                  Take Leadership
                </Button>
              }
              onAccept={() => instantJoinAndLead({ clanId })}
            >
              You have the permission to instantly join this clan and take leadership.
              Are you sure you want to proceed?
            </Confirm2>
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

  // Get react query utility
  const utils = api.useUtils();

  // Query
  const { data: clanData } = api.clan.get.useQuery({ clanId: clanId });

  // Success handler for reuse
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await utils.profile.getUser.invalidate();
      await utils.clan.get.invalidate();
      await utils.clan.getRequests.invalidate();
    }
  };

  // Mutations
  const { mutate: kick } = api.clan.kickMember.useMutation({ onSuccess });
  const { mutate: promote } = api.clan.promoteMember.useMutation({ onSuccess });
  const { mutate: demote } = api.clan.demoteMember.useMutation({ onSuccess });

  // Loader
  if (!clanData) return <Loader explanation="Loading clan data" />;

  // Derived
  const isColeader = checkCoLeader(userId, clanData);
  const isLeader = userId === clanData.leaderId;
  const canEdit = userData ? canEditClans(userData.role) : false;

  // Adjust members for table
  const members = clanData.members
    .map((member) => {
      const memberIsLeader = member.userId === clanData.leaderId;
      const memberIsColeader = checkCoLeader(member.userId, clanData);
      const memberIsAssassin = checkAssassin(member.userId, clanData);
      const canKick =
        canEdit || // canEdit role can kick anyone
        (isLeader && !memberIsLeader) || // Leader can kick anyone except other leaders
        (isColeader && !memberIsLeader && !memberIsColeader); // Co-leaders can kick normal members only
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
                  <Confirm2
                    title="Kick Member"
                    proceed_label="Submit"
                    button={
                      <Button id={`kick-${member.userId}`} hoverText="Kick Member">
                        <DoorOpen className="h-5 w-5" />
                      </Button>
                    }
                    onAccept={() => kick({ clanId, memberId: member.userId })}
                  >
                    {memberIsLeader
                      ? "You are about to kick the leader. Ensure leadership transition is planned."
                      : "Confirm that you want to kick this member from the clan."}
                  </Confirm2>
                )}

                {/* DEMOTE BUTTON */}
                {(isLeader || canEdit) &&
                  (memberIsAssassin || memberIsLeader || memberIsColeader) && (
                    <Confirm2
                      title="Demote Member"
                      button={
                        <Button
                          id={`demote-${member.userId}`}
                          hoverText="Demote Member"
                        >
                          <ArrowBigDownDash className="h-5 w-5" />
                        </Button>
                      }
                      onAccept={() => demote({ clanId, memberId: member.userId })}
                    >
                      Confirm that you want to demote this member.
                    </Confirm2>
                  )}

                {/* PROMOTE BUTTON */}
                {(isLeader ||
                  (isColeader && !memberIsLeader && !memberIsColeader) ||
                  canEdit) && (
                  <Confirm2
                    title="Promote Member"
                    button={
                      <Button
                        id={`promote-${member.userId}`}
                        hoverText="Promote Member"
                      >
                        <ArrowBigUpDash className="h-5 w-5" />
                      </Button>
                    }
                    onAccept={() => promote({ clanId, memberId: member.userId })}
                  >
                    Confirm that you want to promote this member.
                  </Confirm2>
                )}
              </>
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
  const { data: clanData } = api.clan.get.useQuery({ clanId: clanId });

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
            <ClanRequests clanId={clanData.id} isLeader={isLeader} />
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
