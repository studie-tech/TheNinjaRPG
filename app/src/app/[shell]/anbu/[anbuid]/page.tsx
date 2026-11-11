"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowBigUpDash,
  DoorOpen,
  Eye,
  FilePenLine,
  SendHorizontal,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserRank } from "@/drizzle/constants";
import {
  ANBU_ESPIONAGE_POINTS_COST,
  ANBU_ESPIONAGE_PRESTIGE_COST,
  ANBU_ESPIONAGE_UPGRADE_COST,
  ANBU_MAX_ESPIONAGE_LEVEL,
  ANBU_MAX_STEALTH_LEVEL,
  ANBU_MEMBER_RANK_REQUIREMENT,
  ANBU_STEALTH_UPGRADE_COST,
} from "@/drizzle/constants";
import type { UserNindo } from "@/drizzle/schema";
import { usePendingIds } from "@/hooks/usePendingIds";
import { AutoAttackToggle } from "@/layout/AutoAttackModal";
import AvatarImage from "@/layout/Avatar";
import BanInfo from "@/layout/BanInfo";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { GroupOrders } from "@/layout/GroupOrders";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import QuestPicker from "@/layout/QuestPicker";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { anbuEspionageChance, anbuStealthChance } from "@/libs/anbu";
import { hasRequiredRank } from "@/libs/rank";
import { showMutationToast } from "@/libs/toast";
import type { AnbuRouter } from "@/routers/anbu";
import type { UserWithRelations } from "@/routers/profile";
import type { BaseServerResponse } from "@/server/api/trpc";
import { canEditClans } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { readUploadResult, showUploadError, UploadButton } from "@/utils/uploadthing";
import type { AnbuRenameSchema } from "@/validators/anbu";
import { anbuRenameSchema } from "@/validators/anbu";

export default function ANBUDetails(props: { params: Promise<{ anbuid: string }> }) {
  const params = use(props.params);
  // Get ID
  const squadId = params.anbuid;

  // Must be in allied village
  const { userData, access } = useRequireInVillage("/anbu");

  // Queries
  const {
    data: squad,
    error: squadError,
    isFetching: isFetchingSquad,
    refetch: refetchSquad,
  } = api.anbu.get.useQuery({ id: squadId }, { enabled: !!squadId });

  // Loading states
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing ANBU" />;
  if (userData.isOutlaw)
    return (
      <ContentBox title="ANBU" defaultBackHref="/village">
        Unlikely to find outlaw ANBU.
      </ContentBox>
    );
  if (squad === null)
    return (
      <ContentBox title="ANBU" subtitle="Squad not found" defaultBackHref="/anbu">
        <p className="mb-3">
          This ANBU squad has been disbanded or does not belong to your village.
        </p>
        <Link href="/anbu" className="link-inline">
          Back to the ANBU headquarters
        </Link>
      </ContentBox>
    );
  if (!squad && squadError)
    return (
      <ContentBox title="ANBU" defaultBackHref="/anbu">
        <QueryError
          layout="stacked"
          message="Could not load this ANBU squad."
          messageClassName="mb-3"
          onRetry={() => void refetchSquad()}
          isRetrying={isFetchingSquad}
        />
      </ContentBox>
    );
  if (!squad) return <Loader explanation="Loading ANBU squad" />;
  if (userData.isBanned) return <BanInfo />;

  // Derived — village-gate kage/elder so cross-village staff (canStaffEdit) do not
  // inherit village-scoped moderation UI for a foreign squad.
  const sameVillage = userData.villageId === squad.villageId;
  const isKage = sameVillage && userData.userId === userData.village?.kageId;
  const isElder = sameVillage && userData.rank === "ELDER";
  const isLeader = userData.userId === squad.leaderId;
  const inSquad = userData.anbuId === squadId;
  const canStaffEdit = canEditClans(userData.role);

  return (
    <>
      {/* MEMBER OVERVIEW  */}
      <AnbuMembers
        isKage={isKage}
        isElder={isElder}
        isLeader={isLeader}
        inSquad={inSquad}
        canStaffEdit={canStaffEdit}
        userId={userData.userId}
        squadId={squadId}
        squad={squad}
        userData={userData}
      />
      {/* ANBU ORDERS */}
      <AnbuOrders
        squadId={squadId}
        title="Superior Orders"
        subtitle={`From kage or elders`}
        type="KAGE"
        order={squad.kageOrder}
        canPost={isKage || isElder}
      />
      <AnbuOrders
        squadId={squadId}
        title="Leader Orders"
        subtitle={`From leader ${squad.leader?.username}`}
        type="LEADER"
        order={squad.leaderOrder}
        canPost={isLeader}
      />
      {/* REQUESTS SYSTEM  */}
      <AnbuRequests
        squadId={squadId}
        isLeader={isLeader}
        isKage={isKage}
        isElder={isElder}
        userId={userData.userId}
        userRank={userData.rank}
        userAnbu={userData.anbuId}
        sameVillage={sameVillage}
        canStaffEdit={canStaffEdit}
      />
      {/* ANBU QUESTS - Only show if user is in the squad */}
      {inSquad && (
        <QuestPicker
          questType="anbu"
          title="ANBU Missions"
          subtitle="Empower the squad and help the village"
          initialBreak={true}
        />
      )}
    </>
  );
}

interface AnbuMembersProps {
  isKage: boolean;
  isElder: boolean;
  isLeader: boolean;
  inSquad: boolean;
  canStaffEdit: boolean;
  userId: string;
  squadId: string;
  squad: NonNullable<AnbuRouter["get"]>;
  userData: NonNullable<UserWithRelations>;
}

const AnbuMembers: React.FC<AnbuMembersProps> = (props) => {
  // Destructure
  const {
    userId,
    squad,
    squadId,
    isKage,
    isElder,
    isLeader,
    inSquad,
    canStaffEdit,
    userData,
  } = props;

  // Get router
  const router = useRouter();

  // Get react query utility
  const utils = api.useUtils();

  // Get villages for espionage
  const { data: villages } = api.village.getAll.useQuery();

  // State for espionage
  const [selectedVillage, setSelectedVillage] = useState<string>("");

  // Kicks and promotions are scoped to one member so other rows remain usable.
  const kicks = usePendingIds();
  const promotions = usePendingIds();

  // Leaving is independent from member management and only blocks its own control.
  // The ref closes the gap before the mutation pending state reaches the UI.
  const leavePendingRef = useRef(false);

  // Disbanding only conflicts with leaving the same squad. Keep a synchronous
  // guard alongside the rendered pending state to close the pre-render gap.
  const disbandPendingRef = useRef(false);

  // Mutations
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await Promise.all([
        utils.anbu.get.invalidate(),
        utils.anbu.getRequests.invalidate(),
      ]);
    }
  };

  // Request mutations
  const { mutate: edit, isPending: isEditing } = api.anbu.editSquad.useMutation({
    onSuccess,
  });
  const { mutate: kick } = api.anbu.kickMember.useMutation({
    onSuccess,
    onSettled: (_data, _error, variables) => kicks.end(variables.memberId),
  });
  const { mutate: promote } = api.anbu.promoteMember.useMutation({
    onSuccess,
    onSettled: (_data, _error, variables) => promotions.end(variables.memberId),
  });
  const { mutate: upgradeEspionage, isPending: isUpgradingEspionage } =
    api.anbu.purchaseEspionageUpgrade.useMutation({ onSuccess });
  const { mutate: upgradeStealth, isPending: isUpgradingStealth } =
    api.anbu.purchaseStealthUpgrade.useMutation({ onSuccess });
  const { mutate: performEspionage, isPending: isPerformingEspionage } =
    api.anbu.performEspionage.useMutation({ onSuccess });
  const { mutate: leave, isPending: isLeaving } = api.anbu.leaveSquad.useMutation({
    onSuccess: async (data) => {
      await onSuccess(data);
      router.push("/anbu");
    },
    onSettled: () => {
      leavePendingRef.current = false;
    },
  });
  const { mutate: disband, isPending: isDisbanding } =
    api.anbu.disbandSquad.useMutation({
      onSuccess: async (data) => {
        await onSuccess(data);
        router.push("/anbu");
      },
      onSettled: () => {
        disbandPendingRef.current = false;
      },
    });

  // Rename Form
  const renameForm = useForm<AnbuRenameSchema>({
    resolver: zodResolver(anbuRenameSchema),
    defaultValues: { name: squad.name, image: squad.image },
  });
  const onEdit = renameForm.handleSubmit((data) => edit({ ...data, squadId }));
  const currentImage = useWatch({ control: renameForm.control, name: "image" });

  const kickMember = (memberId: string) => {
    if (kicks.begin(memberId)) kick({ squadId, memberId });
  };

  const promoteMember = (memberId: string) => {
    if (promotions.begin(memberId)) promote({ squadId, memberId });
  };

  const leaveSquad = () => {
    if (leavePendingRef.current || disbandPendingRef.current) return;
    leavePendingRef.current = true;
    leave({ squadId });
  };

  const disbandSquad = () => {
    if (disbandPendingRef.current || leavePendingRef.current) return;
    disbandPendingRef.current = true;
    disband({ squadId });
  };

  const isSquadExitPending = isLeaving || isDisbanding;

  // Set squad name
  useEffect(() => {
    renameForm.setValue("name", squad.name);
  }, [renameForm, squad]);

  // Adjust members for table
  const members = squad.members.map((member) => {
    const isKickingMember = kicks.ids.has(member.userId);
    const isPromotingMember = promotions.ids.has(member.userId);
    const isMemberActionPending = isKickingMember || isPromotingMember;

    return {
      ...member,
      rank: member.userId === squad.leaderId ? "Leader" : member.rank,
      kickBtn: (
        <div className="flex flex-row gap-1">
          {member.userId !== userId && (
            <Confirm
              title="Kick Member"
              proceed_label="Submit"
              disabled={isMemberActionPending}
              confirmDisabled={isMemberActionPending}
              button={
                <Button
                  id={`kick-${member.userId}`}
                  hoverText={
                    isKickingMember
                      ? "Kicking"
                      : isPromotingMember
                        ? "Promoting"
                        : "Kick Member"
                  }
                  disabled={isMemberActionPending}
                  loading={isKickingMember}
                  aria-busy={isKickingMember}
                  aria-label={
                    isKickingMember
                      ? `Kicking ${member.username}`
                      : `Kick ${member.username}`
                  }
                >
                  {!isKickingMember && <DoorOpen className="mr-2 h-5 w-5" />}
                  <span role={isKickingMember ? "status" : undefined}>
                    {isKickingMember ? "Kicking" : "Kick"}
                  </span>
                </Button>
              }
              onAccept={() => kickMember(member.userId)}
            >
              Confirm that you want to kick this member from the squad.
            </Confirm>
          )}
          {(isKage || isElder || canStaffEdit) && (
            <Confirm
              title="Promote Member"
              proceed_label="Submit"
              disabled={isMemberActionPending}
              confirmDisabled={isMemberActionPending}
              button={
                <Button
                  id={`promote-${member.userId}`}
                  hoverText={
                    isPromotingMember
                      ? "Promoting"
                      : isKickingMember
                        ? "Kicking"
                        : "Promote Member"
                  }
                  disabled={isMemberActionPending}
                  loading={isPromotingMember}
                  aria-busy={isPromotingMember}
                  aria-label={
                    isPromotingMember
                      ? `Promoting ${member.username}`
                      : `Promote ${member.username}`
                  }
                >
                  {!isPromotingMember && <ArrowBigUpDash className="mr-2 h-5 w-5" />}
                  <span role={isPromotingMember ? "status" : undefined}>
                    {isPromotingMember ? "Promoting" : "Promote"}
                  </span>
                </Button>
              }
              onAccept={() => promoteMember(member.userId)}
            >
              Confirm that you want to promote this member to leader of the squad.
            </Confirm>
          )}
        </div>
      ),
    };
  });

  // Table
  type Member = ArrayElement<typeof members>;
  const columns: ColumnDefinitionType<Member, keyof Member>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "username", header: "Username", type: "string" },
    { key: "rank", header: "Rank", type: "capitalized" },
    { key: "pvpExperience", header: "PvP XP", type: "number" },
  ];
  if (isLeader || isKage || isElder || canStaffEdit) {
    columns.push({ key: "kickBtn", header: "Action", type: "jsx" });
  }

  return (
    <ContentBox
      title={`${squad.name}`}
      subtitle={`PVP Activity: ${squad.pvpActivity}`}
      defaultBackHref="/anbu"
      padding={false}
      topRightContent={
        <div className="flex flex-row items-center gap-1">
          {userData?.anbuId && <AutoAttackToggle iconClassName="h-5 w-5" />}
          {isLeader && (
            <Confirm
              title="Rename Squad"
              proceed_label="Submit"
              button={
                <Button
                  id="rename-anbu-squad"
                  hoverText={isEditing ? "Renaming" : "Rename Squad"}
                  disabled={isEditing}
                  loading={isEditing}
                  aria-busy={isEditing}
                  aria-label={isEditing ? "Renaming" : "Rename squad"}
                >
                  {!isEditing && <FilePenLine className="h-5 w-5" />}
                  <span className="sr-only" aria-live="polite">
                    {isEditing ? "Renaming" : "Rename squad"}
                  </span>
                </Button>
              }
              isValid={renameForm.formState.isValid}
              disabled={isEditing}
              confirmDisabled={isEditing}
              onAccept={onEdit}
            >
              <Form {...renameForm}>
                <form className="grid grid-cols-2 space-y-2" onSubmit={onEdit}>
                  <div>
                    <FormLabel>Squad Image</FormLabel>
                    <AvatarImage
                      href={currentImage}
                      alt={squad.id}
                      size={100}
                      hover_effect={true}
                      priority
                    />
                    <UploadButton
                      endpoint="anbuUploader"
                      onClientUploadComplete={(res) => {
                        const url = readUploadResult(res)?.fileUrl;
                        if (url) {
                          renameForm.setValue("image", url, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      onUploadError={showUploadError}
                    />
                  </div>
                  <FormField
                    control={renameForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Name of the new squad" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
            </Confirm>
          )}
          {isLeader && (
            <Dialog>
              <DialogTrigger asChild>
                <Button id="upgrade-anbu-squad" hoverText="Upgrade Squad">
                  <TrendingUp className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Squad Upgrades</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="text-muted-foreground text-sm">
                    Current Squad Points: {squad.points}
                  </div>

                  <SquadUpgradeCard
                    name="Espionage"
                    description="Improves intelligence gathering capabilities against enemy villages during wars."
                    level={squad.espionageLevel}
                    maxLevel={ANBU_MAX_ESPIONAGE_LEVEL}
                    chance={anbuEspionageChance}
                    cost={ANBU_ESPIONAGE_UPGRADE_COST}
                    points={squad.points}
                    isUpgrading={isUpgradingEspionage}
                    onUpgrade={() => upgradeEspionage({ squadId })}
                  />
                  <SquadUpgradeCard
                    name="Stealth"
                    description="Reduces the chance of being detected by guards when infiltrating enemy villages."
                    level={squad.stealthLevel}
                    maxLevel={ANBU_MAX_STEALTH_LEVEL}
                    chance={anbuStealthChance}
                    cost={ANBU_STEALTH_UPGRADE_COST}
                    points={squad.points}
                    isUpgrading={isUpgradingStealth}
                    onUpgrade={() => upgradeStealth({ squadId })}
                  />
                </div>
              </DialogContent>
            </Dialog>
          )}
          {inSquad && (
            <Dialog>
              <DialogTrigger asChild>
                <Button id="espionage-anbu-squad" hoverText="Perform Espionage">
                  <Eye className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Perform Espionage</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="text-muted-foreground text-sm">
                    Select a village to gather intelligence on.
                  </div>

                  <div className="text-muted-foreground text-sm">
                    Success Rate: {anbuEspionageChance(squad.espionageLevel)}%
                  </div>

                  {/* Cost Requirements */}
                  <div className="space-y-2 rounded-lg bg-muted p-3">
                    <div className="font-medium text-sm">Mission Requirements:</div>
                    <div className="space-y-1">
                      <div
                        className={`flex items-center justify-between text-sm ${userData.villagePrestige >= ANBU_ESPIONAGE_PRESTIGE_COST ? "text-green-600" : "text-red-600"}`}
                      >
                        <span>Village Prestige:</span>
                        <span>
                          {userData.villagePrestige.toLocaleString()} /{" "}
                          {ANBU_ESPIONAGE_PRESTIGE_COST.toLocaleString()}
                          {userData.villagePrestige >= ANBU_ESPIONAGE_PRESTIGE_COST
                            ? " ✓"
                            : " ✗"}
                        </span>
                      </div>
                      <div
                        className={`flex items-center justify-between text-sm ${squad.points >= ANBU_ESPIONAGE_POINTS_COST ? "text-green-600" : "text-red-600"}`}
                      >
                        <span>Squad Points:</span>
                        <span>
                          {squad.points} / {ANBU_ESPIONAGE_POINTS_COST}
                          {squad.points >= ANBU_ESPIONAGE_POINTS_COST ? " ✓" : " ✗"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="font-medium text-sm">Target Village:</span>
                    <Select value={selectedVillage} onValueChange={setSelectedVillage}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a village to spy on" />
                      </SelectTrigger>
                      <SelectContent>
                        {villages
                          ?.filter(
                            (village) =>
                              village.type === "VILLAGE" &&
                              village.id !== squad.villageId,
                          )
                          .map((village) => (
                            <SelectItem key={village.id} value={village.id}>
                              {village.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={() => {
                      if (selectedVillage) {
                        performEspionage({
                          villageId: selectedVillage,
                          anbuId: squadId,
                        });
                        setSelectedVillage("");
                      }
                    }}
                    disabled={
                      isPerformingEspionage ||
                      !selectedVillage ||
                      squad.points < ANBU_ESPIONAGE_POINTS_COST ||
                      userData.villagePrestige < ANBU_ESPIONAGE_PRESTIGE_COST
                    }
                    className="w-full"
                  >
                    {isPerformingEspionage ? "Performing" : "Conduct Espionage Mission"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {inSquad && (
            <Confirm
              id="leave-anbu-squad"
              title="Leave Squad"
              proceed_label="Leave"
              confirmClassName="bg-red-600 text-white hover:bg-red-700"
              disabled={isSquadExitPending}
              confirmDisabled={isSquadExitPending}
              button={
                <Button
                  id="leave-anbu-squad-trigger"
                  hoverText={isLeaving ? "Leaving" : "Leave Squad"}
                  variant="destructive"
                  disabled={isSquadExitPending}
                  loading={isLeaving}
                  aria-busy={isLeaving}
                  aria-label={isLeaving ? "Leaving" : "Leave squad"}
                >
                  {!isLeaving && <DoorOpen className="h-5 w-5" />}
                  <span role={isLeaving ? "status" : undefined}>
                    {isLeaving ? "Leaving" : "Leave"}
                  </span>
                </Button>
              }
              onAccept={leaveSquad}
            >
              Confirm that you want to leave this squad.
            </Confirm>
          )}
          {(isKage || isElder) && (
            <Confirm
              id="disband-anbu-squad"
              title="Disband Squad"
              proceed_label={isDisbanding ? "Disbanding" : "Disband"}
              confirmClassName="bg-red-600 text-white hover:bg-red-700"
              disabled={isSquadExitPending}
              confirmDisabled={isSquadExitPending}
              button={
                <Button
                  id="disband-anbu-squad-trigger"
                  hoverText={isDisbanding ? "Disbanding" : "Disband Squad"}
                  variant="destructive"
                  disabled={isSquadExitPending}
                  loading={isDisbanding}
                  aria-busy={isDisbanding}
                  aria-label={isDisbanding ? "Disbanding" : "Disband squad"}
                >
                  {!isDisbanding && <Trash2 className="mr-2 h-5 w-5" />}
                  <span role={isDisbanding ? "status" : undefined}>
                    {isDisbanding ? "Disbanding" : "Disband"}
                  </span>
                </Button>
              }
              onAccept={disbandSquad}
            >
              Confirm that you want to disband this entire squad. Everyone will be
              removed from the squad!
            </Confirm>
          )}
        </div>
      }
    >
      <Table
        data={members}
        columns={columns}
        linkPrefix="/username/"
        linkColumn={"username"}
      />
    </ContentBox>
  );
};

interface AnbuOrdersProps {
  squadId: string;
  title: string;
  subtitle: string;
  type: "KAGE" | "LEADER";
  order: UserNindo | null;
  canPost: boolean;
}

const AnbuOrders: React.FC<AnbuOrdersProps> = (props) => {
  // Destructure
  const { squadId, title, subtitle, type, canPost, order } = props;

  // utils
  const utils = api.useUtils();

  // Mutations are per card: leader and Kage orders must not block each other.
  const { mutateAsync: notice, isPending: isUpdatingNotice } =
    api.anbu.upsertNotice.useMutation({
      onSuccess: async (data: BaseServerResponse) => {
        showMutationToast(data);
        if (data.success) {
          await utils.anbu.get.invalidate();
        }
      },
    });

  return (
    <GroupOrders
      title={title}
      subtitle={subtitle}
      content={order?.content ?? "No current orders"}
      canPost={canPost}
      dialogId={`update-${type.toLowerCase()}-orders`}
      isPending={isUpdatingNotice}
      onSubmit={(data) => notice({ ...data, type, squadId })}
      renderTrigger={(open) => (
        <Button
          id={`edit-${type.toLowerCase()}-orders`}
          hoverText={isUpdatingNotice ? "Updating" : "Edit Orders"}
          disabled={isUpdatingNotice}
          loading={isUpdatingNotice}
          aria-busy={isUpdatingNotice}
          aria-label={isUpdatingNotice ? `Updating ${title}` : `Edit ${title}`}
          onClick={open}
        >
          {!isUpdatingNotice && <FilePenLine className="h-5 w-5" />}
          <span
            className={isUpdatingNotice ? undefined : "sr-only"}
            role={isUpdatingNotice ? "status" : undefined}
            aria-live="polite"
          >
            {isUpdatingNotice ? "Updating" : `Edit ${title}`}
          </span>
        </Button>
      )}
    />
  );
};

interface AnbuRequestsProps {
  squadId: string;
  isLeader: boolean;
  isKage: boolean;
  isElder: boolean;
  userId: string;
  userRank: UserRank;
  userAnbu: string | null;
  sameVillage: boolean;
  canStaffEdit: boolean;
}

/** ANBU join requests for a squad. */
const AnbuRequests: React.FC<AnbuRequestsProps> = (props) => {
  // Destructure
  const {
    squadId,
    isLeader,
    isKage,
    isElder,
    userId,
    userRank,
    userAnbu,
    sameVillage,
    canStaffEdit,
  } = props;

  // Get utils
  const utils = api.useUtils();

  const canManageRequests = isLeader || isKage || isElder || canStaffEdit;
  // Kage/elder cannot join (blocked server-side). Cross-village viewers cannot
  // join either, while leaderless squads remain joinable by eligible villagers.
  const canJoinSquad = !isKage && !isElder && sameVillage;
  const shouldFetch = canManageRequests || (!userAnbu && canJoinSquad);

  // Query
  const { data: requests } = api.anbu.getRequests.useQuery(
    { squadId },
    {
      enabled: !!squadId && shouldFetch,
      staleTime: 5000,
    },
  );

  // How to deal with success responses
  const onSuccess = (refreshSquad: boolean) => async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await Promise.all([
        utils.anbu.getRequests.invalidate(),
        ...(refreshSquad ? [utils.anbu.get.invalidate()] : []),
      ]);
    }
  };

  // Mutation
  const { mutate: create, isPending: isCreating } = api.anbu.createRequest.useMutation({
    onSuccess: onSuccess(false),
  });
  const { mutate: accept, isPending: isAccepting } = api.anbu.acceptRequest.useMutation(
    { onSuccess: onSuccess(true) },
  );
  const { mutate: reject, isPending: isRejecting } = api.anbu.rejectRequest.useMutation(
    { onSuccess: onSuccess(false) },
  );
  const { mutate: cancel, isPending: isCancelling } =
    api.anbu.cancelRequest.useMutation({ onSuccess: onSuccess(false) });

  // Loaders
  if (!shouldFetch) return null;
  if (!requests) return <Loader explanation="Loading requests" />;

  // Derived
  const hasPending = requests?.some((req) => req.status === "PENDING");
  const showRequestSystem =
    (canManageRequests && requests.length > 0) || (!userAnbu && canJoinSquad);
  const shownRequests = requests.filter(
    (r) => !canManageRequests || r.status === "PENDING",
  );
  const sufficientRank = hasRequiredRank(userRank, ANBU_MEMBER_RANK_REQUIREMENT);

  // Do not show?
  if (!showRequestSystem) return null;

  // Render
  return (
    <ContentBox
      title="Request"
      subtitle="Requests for ANBU squad"
      initialBreak={true}
      padding={false}
    >
      {/* FOR THOSE WHO CAN SEND REQUESTS */}
      {sufficientRank && !userAnbu && !hasPending && canJoinSquad && (
        <div className="p-2">
          <p>Send a request to join this squad</p>
          <Button id="send" className="mt-2 w-full" onClick={() => create({ squadId })}>
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
          userId={userId}
          onAccept={accept}
          onReject={reject}
          onCancel={cancel}
          isLoading={isCreating || isAccepting || isRejecting || isCancelling}
          canModerateRequests={canManageRequests}
        />
      )}
    </ContentBox>
  );
};

/** A purchasable squad stat: its level, the chance it yields and the upgrade button. */
const SquadUpgradeCard: React.FC<{
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  chance: (level: number) => number;
  cost: number;
  points: number;
  isUpgrading: boolean;
  onUpgrade: () => void;
}> = (props) => (
  <div className="rounded-lg border p-4">
    <h3 className="mb-2 font-semibold">{props.name} Level</h3>
    <p className="mb-2 text-muted-foreground text-sm">{props.description}</p>
    <p className="mb-2 text-muted-foreground text-sm">
      Current Level: {props.level} / {props.maxLevel}
    </p>
    <p className="mb-2 text-muted-foreground text-sm">
      Success Rate: {props.chance(props.level)}%
      {props.level < props.maxLevel && (
        <span className="text-green-600"> → {props.chance(props.level + 1)}%</span>
      )}
    </p>
    <p className="mb-4 text-muted-foreground text-sm">
      Upgrade Cost: {props.cost} points
    </p>
    <Button
      onClick={props.onUpgrade}
      disabled={
        props.isUpgrading || props.level >= props.maxLevel || props.points < props.cost
      }
      className="w-full"
    >
      {props.isUpgrading ? "Upgrading" : `Upgrade ${props.name}`}
    </Button>
  </div>
);
