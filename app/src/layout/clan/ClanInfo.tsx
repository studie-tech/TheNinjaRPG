import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ArrowBigUpDash,
  DoorClosed,
  DoorOpen,
  FilePenLine,
  List,
  Loader2,
  Palette,
  PiggyBank,
  Star,
  Swords,
  UserRoundCog,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
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
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSASSIN_MAX_PER_FACTION,
  CLAN_BOOST_CONFIG,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_COLOR_CHANGE_REP_COST,
  CLAN_POINT_RYO_RATE,
  CLAN_RANK_REQUIREMENT,
  type ClanBoostType,
  ClanBoostTypes,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  FACTION_MIN_MEMBERS_FOR_STRONGHOLD,
  FACTION_REPUTATION_TREASURY_LIMIT,
  HIDEOUT_COST,
  KAGE_MAX_ELDERS,
  STRONGHOLD_MEMBER_GRACE_HOURS,
  STRONGHOLD_MONTHLY_MAINTENANCE,
  STRONGHOLD_REESTABLISH_COST,
} from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { ClansOverview } from "@/layout/clan/ClansOverview";
import { ignoreToastedError } from "@/layout/clan/ignoreToastedError";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { getClanBoostCost, getClanBoostLevel } from "@/libs/clanBoost";
import { hasRequiredRank } from "@/libs/rank";
import { showMutationToast } from "@/libs/toast";
import type { ClanRouter } from "@/routers/clan";
import { canEditClans } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { readUploadResult, showUploadError, UploadButton } from "@/utils/uploadthing";
import {
  createMoneyTransferSchema,
  type MoneyTransferSchema,
  type MoneyTransferSchemaInput,
} from "@/validators/bank";
import type { FactionColorEditSchema, FactionEditSchema } from "@/validators/clan";
import {
  checkCoLeader,
  factionColorEditSchema,
  factionEditSchema,
} from "@/validators/clan";

interface ClanInfoProps {
  clanData: NonNullable<ClanRouter["get"]>;
  defaultBackHref?: string;
}

/** Clan overview card with leadership actions. */
export const ClanInfo: React.FC<ClanInfoProps> = (props) => {
  // Destructure
  const { data: userData, updateUser, prepareUserUpdate } = useRequiredUserData();
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
  const [isStrongholdUpgradeModalOpen, setIsStrongholdUpgradeModalOpen] =
    useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isResignModalOpen, setIsResignModalOpen] = useState(false);
  const [isInstantJoinModalOpen, setIsInstantJoinModalOpen] = useState(false);
  const [hasLeftGroup, setHasLeftGroup] = useState(false);
  const [hasResignedLeadership, setHasResignedLeadership] = useState(false);
  const [hasInstantlyTakenLeadership, setHasInstantlyTakenLeadership] = useState(false);
  const [hasClearedLeadership, setHasClearedLeadership] = useState(false);
  const [hasUpgradedToStronghold, setHasUpgradedToStronghold] = useState(false);
  const colorFlight = useSingleFlight();
  const editFlight = useSingleFlight();
  const donationFlight = useSingleFlight();
  const strongholdUpgradeFlight = useSingleFlight();
  const leaveFlight = useSingleFlight();
  const resignFlight = useSingleFlight();
  const instantJoinFlight = useSingleFlight();
  const clearLeadershipFlight = useSingleFlight();
  const imageUploadFlight = useSingleFlight();
  const isUploadingClanImage = imageUploadFlight.isPending;

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
    },
  );

  const { mutateAsync: editColor, isPending: isEditingColor } =
    api.clan.editClanColor.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success)
          await updateUser(data, { revision, delta: data.userDelta }).catch(
            () => undefined,
          );
      },
    });

  const { mutateAsync: leave, isPending: isLeavingClan } =
    api.clan.leaveClan.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success || data.userPatch || data.userRecovery)
          await updateUser(data, { revision });
      },
    });

  const onLeaveClan = async () => {
    if (hasLeftGroup) return;

    await leaveFlight
      .run(true, async () => {
        const data = await leave({ clanId });
        if (!data.success) return;

        // Membership has been committed. Remove the stale retry path and leave
        // this profile immediately; cache refreshes must not keep the destructive
        // action open or make navigation depend on the network.
        setHasLeftGroup(true);
        setIsLeaveModalOpen(false);
        router.push("/clanhall");
        void Promise.all([
          utils.clan.get.invalidate(),
          utils.clan.getRequests.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
  };

  const { mutateAsync: demote, isPending: isResigningLeadership } =
    api.clan.demoteMember.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success || data.userPatch) await updateUser(data, { revision });
        showMutationToast(data);
      },
    });

  const onResignLeadership = async () => {
    if (hasResignedLeadership || !userData) return;

    await resignFlight
      .run(true, async () => {
        const data = await demote({ clanId, memberId: userData.userId });
        if (!data.success) return;

        // A successful response proves this user was removed from every delegated
        // leadership slot. Hide the stale retry immediately and keep the local guard
        // if an authoritative refresh fails.
        setHasResignedLeadership(true);
        setIsResignModalOpen(false);
        void Promise.all([
          utils.clan.get.invalidate({ clanId }),
          utils.clan.getRequests.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
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
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) void updateUser(data, { revision, delta: data.userDelta });
      },
    });

  const onDonateReputation = async () => {
    const reputationPoints = Number(donateReps);
    if (!Number.isSafeInteger(reputationPoints) || reputationPoints <= 0) {
      return;
    }

    await donationFlight
      .run(true, async () => {
        const data = await clanDonate({ clanId, reputationPoints });
        if (!data.success) return;

        // The debit and treasury credit have committed. Close the stale repeat path
        // immediately; a cache failure must never recreate a costly action.
        setDonateReps("");
        setIsDonateModalOpen(false);
        void utils.clan.get.invalidate();
      })
      .catch(ignoreToastedError);
  };

  const {
    mutateAsync: upgradeHideoutToStronghold,
    isPending: isUpgradingToStronghold,
  } = api.clan.upgradeHideoutToStronghold.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
      showMutationToast(data);
    },
  });

  const onUpgradeHideoutToStronghold = async () => {
    if (hasUpgradedToStronghold) return;

    await strongholdUpgradeFlight
      .run(true, async () => {
        const data = await upgradeHideoutToStronghold({ clanId });
        if (!data.success) return;

        // The one-time upgrade and its costs are committed. Remove the stale action
        // immediately; dependent authoritative refreshes must not recreate it.
        setHasUpgradedToStronghold(true);
        setIsStrongholdUpgradeModalOpen(false);
        void Promise.all([
          utils.clan.get.invalidate(),
          utils.village.getSectorOwnerships.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
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
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser(data, { revision, delta: data.userDelta }),
          utils.clan.get.invalidate(),
        ]);
        toBankForm.reset();
      }
    },
  });
  const onDeposit = toBankForm.handleSubmit((data) => toBank({ ...data, clanId }));

  const { mutateAsync: instantJoinAndLead, isPending: isInstantlyJoiningAndLeading } =
    api.clan.instantJoinAndLead.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success || data.userPatch) await updateUser(data, { revision });
      },
    });

  const onInstantJoinAndLead = async () => {
    if (
      hasInstantlyTakenLeadership ||
      !userData ||
      (userData.clanId !== null && userData.clanId !== clanId)
    ) {
      return;
    }

    await instantJoinFlight
      .run(true, async () => {
        const data = await instantJoinAndLead({ clanId });
        if (!data.success) return;

        // Membership and leadership are committed. Remove the privileged retry path
        // before navigation; authoritative refreshes must never recreate the action.
        setHasInstantlyTakenLeadership(true);
        setIsInstantJoinModalOpen(false);
        router.push("/clanhall");
        void Promise.all([
          utils.clan.get.invalidate(),
          utils.clan.getRequests.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
  };

  const { mutateAsync: clearLeadership, isPending: isClearingLeadership } =
    api.clan.clearLeadership.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
      },
    });

  const onClearLeadership = async (close: () => void) => {
    if (hasClearedLeadership) return;

    await clearLeadershipFlight
      .run(true, async () => {
        const data = await clearLeadership({ clanId });
        if (!data.success) return;

        // The successful response proves every delegated leadership slot was cleared.
        // Remove the stale destructive retry path immediately; cache refresh failures
        // must not allow the committed bulk action to be repeated.
        setHasClearedLeadership(true);
        close();
        void Promise.all([
          utils.clan.get.invalidate({ clanId }),
          utils.clan.getRequests.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
  };

  // Rename Form
  const editForm = useForm<FactionEditSchema>({
    resolver: zodResolver(factionEditSchema),
    defaultValues: { name: clanData.name, image: clanData.image, clanId },
  });
  const isEditBusy = isEditingClan || isUploadingClanImage;
  const onEdit = editForm.handleSubmit(async (data) => {
    if (imageUploadFlight.current()) return;

    await editFlight
      .run(true, async () => {
        const result = await edit(data);
        if (!result.success) return;

        // Once committed, close the retry path immediately. Refreshing the
        // authoritative clan data is best-effort and cannot resubmit the edit.
        editForm.reset(data);
        setIsEditModalOpen(false);
        void utils.clan.get.invalidate();
      })
      .catch(ignoreToastedError);
  });
  const currentImage = useWatch({ control: editForm.control, name: "image" });

  // Color Form
  const colorForm = useForm<FactionColorEditSchema>({
    resolver: zodResolver(factionColorEditSchema),
    defaultValues: { color: userData?.village?.hexColor ?? "#000000", clanId },
  });
  const onColorEdit = colorForm.handleSubmit(async (data) => {
    await colorFlight
      .run(true, async () => {
        const result = await editColor(data);
        if (!result.success) return;

        // The reputation charge and color update are committed. Remove the costly
        // retry path before refreshing any dependent authoritative views.
        colorForm.reset(data);
        setIsColorModalOpen(false);
        void Promise.all([
          utils.clan.get.invalidate(),
          utils.village.getSectorOwnerships.invalidate(),
        ]);
      })
      .catch(ignoreToastedError);
  });

  // Loader
  if (!userData) return <Loader explanation="Loading user data" />;

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
  const hadHideout = village.type !== "OUTLAW" && userData.isOutlaw;
  const hadStronghold = village.type === "STRONGHOLD" || village.wasDowngraded || false;
  // Can we upgrade from hideout to stronghold?
  const hasMembers = clanData.members.length >= FACTION_MIN_MEMBERS_FOR_STRONGHOLD;
  const canCreateStronghold =
    !hasUpgradedToStronghold &&
    village.type === "HIDEOUT" &&
    !!village.wasDowngraded &&
    hasMembers &&
    clanData.bank >= STRONGHOLD_REESTABLISH_COST;
  const donationCapacity = Math.max(
    0,
    Math.min(
      userData.reputationPoints,
      FACTION_REPUTATION_TREASURY_LIMIT - clanData.repTreasury,
    ),
  );
  const donationAmount = Number(donateReps);
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
                      />
                      <fieldset disabled={isEditingClan}>
                        <UploadButton
                          endpoint="clanUploader"
                          onBeforeUploadBegin={(files) => {
                            imageUploadFlight.claim();
                            return files;
                          }}
                          onUploadAborted={() => {
                            imageUploadFlight.release();
                          }}
                          onClientUploadComplete={(res) => {
                            imageUploadFlight.release();
                            const url = readUploadResult(res)?.fileUrl;
                            if (url) {
                              editForm.setValue("image", url, {
                                shouldDirty: true,
                              });
                            }
                          }}
                          onUploadError={(error: Error) => {
                            imageUploadFlight.release();
                            showUploadError(error);
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
                {clanData.founder ? (
                  <Link
                    className="font-bold hover:text-orange-500"
                    href={`/userid/${clanData.founder.userId}`}
                  >
                    {clanData.founder.username}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </p>
              {village.belowMemberMinimumSince && village.type === "STRONGHOLD" && (
                <p role="status">
                  <Popover>
                    <PopoverTrigger
                      aria-label="Membership grace period"
                      className="inline-flex items-center gap-1 whitespace-nowrap text-amber-700 text-sm hover:text-orange-500"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                      Membership grace
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      aria-label="Membership grace period details"
                      className="max-w-[calc(100vw-2rem)] text-sm"
                    >
                      Restore {FACTION_MIN_MEMBERS_FOR_STRONGHOLD} members within{" "}
                      {STRONGHOLD_MEMBER_GRACE_HOURS} hours of{" "}
                      {new Date(village.belowMemberMinimumSince).toLocaleString()} to
                      retain this Stronghold.
                    </PopoverContent>
                  </Popover>
                </p>
              )}
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
                  <p>
                    {clanData.village.type === "STRONGHOLD" ? "Stronghold" : "Hideout"}{" "}
                    sector: {clanData.village.sector}
                  </p>
                </div>
              )}
            </div>
            <div>
              <p>PvP Activity: {clanData.pvpActivity}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p>Points: {clanData.points.toLocaleString()}</p>
                {leaderLike && userData.clanId === clanId && (
                  <ClanPointConversion clanId={clanId} points={clanData.points} />
                )}
              </div>
              <div className="flex flex-row items-center">
                <p>Bank: {clanData.bank}</p>{" "}
                <Confirm
                  title={`Donate to ${groupLabel.toLowerCase()}`}
                  proceed_label="Donate"
                  button={
                    <PiggyBank className="ml-2 h-6 w-6 hover:cursor-pointer hover:text-orange-500" />
                  }
                  triggerLabel={`Donate to ${groupLabel.toLowerCase()} bank`}
                  disabled={isDepositing}
                  isLoading={isDepositing}
                  onAccept={onDeposit}
                >
                  <p>
                    Confirm donating money from pocket to {groupLabel.toLowerCase()}{" "}
                    bank. You currently have {userData.money.toLocaleString()} ryo in
                    your pocket.
                  </p>
                  {userData.isOutlaw && (
                    <p>
                      Once the faction has {HIDEOUT_COST} ryo, it becomes possible for
                      the leader to purchase a hideout on the global map. At this point
                      the faction detaches from the Syndicate, and effectively
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
              {!hadStronghold && hadHideout && userData?.isOutlaw && (
                <div className="flex flex-row items-center">
                  <p>Faction treasury: {clanData.repTreasury} reps</p>
                  {leaderLike && (
                    <>
                      <Button
                        id="donate-reputation"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-1 h-8 w-8"
                        hoverText="Donate reputation points"
                        disabled={isDonatingReputation || donationCapacity === 0}
                        aria-busy={isDonatingReputation}
                        aria-label={
                          isDonatingReputation ? "Donating" : "Donate reputation points"
                        }
                        onClick={() => setIsDonateModalOpen(true)}
                      >
                        {isDonatingReputation ? (
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
                        isLoading={isDonatingReputation}
                        proceedDisabled={!isDonationAmountValid}
                        keepOpenOnAccept
                        onAccept={() => void onDonateReputation()}
                      >
                        <p>
                          Donate reputation points to the faction treasury for faction
                          customization.
                        </p>
                        <p id="reputation-donation-balance" className="text-sm">
                          You have {userData.reputationPoints.toLocaleString()}{" "}
                          reputation points available. This faction still needs{" "}
                          {Math.max(
                            0,
                            FACTION_REPUTATION_TREASURY_LIMIT - clanData.repTreasury,
                          ).toLocaleString()}
                          .
                        </p>
                        <label className="font-medium text-sm" htmlFor="reps">
                          Reputation points to donate
                        </label>
                        <NumberInput
                          id="reps"
                          min={1}
                          max={donationCapacity}
                          step={1}
                          inputMode="numeric"
                          className="mt-2"
                          placeholder="Reputation points to donate"
                          value={donateReps}
                          disabled={isDonatingReputation}
                          aria-describedby="reputation-donation-balance"
                          onTextChange={setDonateReps}
                        />
                      </Modal>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Clans and factions share training, Ryo and crafting speed boosts. */}
          <div className="mt-4 grid grid-cols-2 gap-x-4">
            {ClanBoostTypes.filter(
              (boostType) =>
                !userData.isOutlaw || !CLAN_BOOST_CONFIG[boostType].villageOnly,
            ).map((boostType) => (
              <BoostRow
                key={boostType}
                boostType={boostType}
                currentBoost={clanData[boostType]}
                clanBank={clanData.bank}
                canPurchase={leaderLike}
                isPending={isPurchasingBoost}
                onPurchase={() => purchaseBoost({ clanId, boostType })}
              />
            ))}
          </div>
          {/* Elder Nomination - only for non-outlaw clans */}
          {!userData?.isOutlaw && leaderLike && (
            <ElderNomination
              now={new Date()}
              clanData={clanData}
              selectedNomineeId={selectedNomineeId}
              onSelectNominee={setSelectedNomineeId}
              isNominating={isNominating}
              onNominate={() => nominateElder({ clanId, nomineeId: selectedNomineeId })}
            />
          )}
          {leaderLike && canCreateStronghold && (
            <>
              <Button
                id="upgradeHideout"
                className="my-2 w-full"
                disabled={isUpgradingToStronghold}
                aria-busy={isUpgradingToStronghold}
                aria-label={isUpgradingToStronghold ? "Upgrading" : undefined}
                onClick={() => setIsStrongholdUpgradeModalOpen(true)}
              >
                {isUpgradingToStronghold ? (
                  <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
                ) : (
                  <Star className="mr-2 h-6 w-6" aria-hidden />
                )}
                {isUpgradingToStronghold ? "Upgrading" : "Restore Stronghold"}
              </Button>
              <Modal
                id="upgrade-hideout-to-stronghold"
                title="Restore Stronghold"
                proceed_label="Restore Stronghold"
                proceed_loading_label="Upgrading"
                confirmClassName="bg-amber-600 text-white hover:bg-amber-700"
                isOpen={isStrongholdUpgradeModalOpen}
                setIsOpen={setIsStrongholdUpgradeModalOpen}
                isLoading={isUpgradingToStronghold}
                keepOpenOnAccept
                onAccept={() => void onUpgradeHideoutToStronghold()}
              >
                <div className="space-y-3">
                  <p>
                    Restore this former Stronghold for{" "}
                    {STRONGHOLD_REESTABLISH_COST.toLocaleString()} Ryo from the faction
                    bank.
                  </p>
                  <p>
                    Requires at least {FACTION_MIN_MEMBERS_FOR_STRONGHOLD} members. If
                    membership falls below this minimum for{" "}
                    {STRONGHOLD_MEMBER_GRACE_HOURS} hours, the Stronghold becomes a
                    Hideout. Returning to the minimum resets the grace period.
                  </p>
                  <p>
                    Monthly maintenance costs{" "}
                    {STRONGHOLD_MONTHLY_MAINTENANCE.toLocaleString()} faction points.
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
              onAccept={(_event, { close }) => void onClearLeadership(close)}
            >
              <div className="space-y-3">
                <p>
                  Clear every delegated leadership role in{" "}
                  <strong>{clanData.name}</strong>?
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>All three co-leader slots will be cleared.</li>
                  <li>
                    All {ASSASSIN_MAX_PER_FACTION} assassin slots will be cleared.
                  </li>
                </ul>
                <p className="text-muted-foreground text-sm">
                  The leader will remain in place. Everyone will remain a member of the{" "}
                  {groupLabel.toLowerCase()}, and unrelated {groupLabel.toLowerCase()}{" "}
                  details will not change. These roles can be assigned again later.
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
                        clanData.village.type === "STRONGHOLD") && (
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

interface ElderNominationProps {
  /** Read by the parent so the window follows the clan hall's own re-renders. */
  now: Date;
  clanData: NonNullable<ClanRouter["get"]>;
  selectedNomineeId: string;
  onSelectNominee: (userId: string) => void;
  isNominating: boolean;
  onNominate: () => void;
}

/** Monthly elder nomination for a top clan, judged against the date the parent passes. */
const ElderNomination: React.FC<ElderNominationProps> = ({
  now,
  clanData,
  selectedNomineeId,
  onSelectNominee,
  isNominating,
  onNominate,
}) => {
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
        {ELDER_NOMINATION_DEADLINE_DAY}th of each month. Top {KAGE_MAX_ELDERS} clans by
        activity points (determined on the {ELDER_NOMINATION_CUTOFF_DAY}th) can nominate
        a member to become elder. Nominees must be at least Jonin rank and cannot be
        ANBU members.
      </p>
      {!isWithinWindow && (
        <p className="mb-2 text-amber-600 text-sm">
          Nomination window is closed. Opens on the {ELDER_NOMINATION_CUTOFF_DAY}th of
          the month.
        </p>
      )}
      {isWithinWindow && !isEligible && (
        <p className="mb-2 text-red-600 text-sm">
          Your clan is not eligible for elder nomination this month (not in top{" "}
          {KAGE_MAX_ELDERS} by activity points on the {ELDER_NOMINATION_CUTOFF_DAY}th).
        </p>
      )}
      {isWithinWindow && isEligible && clanData.elderCutoffRank && (
        <p className="mb-2 text-green-600 text-sm">
          Your clan ranked #{clanData.elderCutoffRank} in activity points and is
          eligible to nominate!
        </p>
      )}
      <div className="flex gap-2">
        <Select
          value={selectedNomineeId}
          onValueChange={onSelectNominee}
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
          onClick={onNominate}
          disabled={!canNominate || isNominating}
          loading={isNominating}
        >
          Nominate
        </Button>
      </div>
      {clanData.elderNominee && (
        <p className="mt-2 text-sm">
          Current nominee:{" "}
          <span className="font-bold">{clanData.elderNominee.username}</span>
        </p>
      )}
    </div>
  );
};

// Helper component for displaying boost rows with Ryo-based costs
interface BoostRowProps {
  boostType: ClanBoostType;
  currentBoost: number;
  clanBank: number;
  canPurchase: boolean;
  isPending?: boolean;
  onPurchase: () => void;
}

const BoostRow: React.FC<BoostRowProps> = ({
  boostType,
  currentBoost,
  clanBank,
  canPurchase,
  isPending,
  onPurchase,
}) => {
  const { label } = CLAN_BOOST_CONFIG[boostType];
  const currentLevel = getClanBoostLevel(currentBoost);
  const cost = getClanBoostCost(boostType, currentBoost);
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
          confirmDisabled={isMaxed || !canAfford}
          button={
            <>
              <span className="sr-only">Purchase {label}</span>
              <ArrowBigUpDash className="ml-2 h-6 w-6 hover:cursor-pointer hover:text-orange-500" />
            </>
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
                from the bank.
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

/** Confirm a clan-bank conversion and keep expected rejections visible for retry. */
function ClanPointConversion({ clanId, points }: { clanId: string; points: number }) {
  const { updateUser, prepareUserUpdate } = useRequiredUserData();
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState(1);
  const [error, setError] = useState("");
  // Modal callbacks can repeat before React renders the mutation's pending state.
  const submission = useSingleFlight();
  const utils = api.useUtils();
  const { mutateAsync: convert, isPending } = api.clan.convertPointsToRyo.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
    },
  });
  const isValid = Number.isSafeInteger(amount) && amount > 0 && amount <= points;
  const onConvert = async () => {
    if (!isValid) return;
    await submission.run(true, async () => {
      setError("");
      try {
        const result = await convert({ clanId, points: amount });
        showMutationToast(result);
        if (!result.success) {
          setError(result.message);
          return;
        }
        setIsOpen(false);
        setAmount(1);
        // Profile data also embeds clan balances used outside the clan hall.
        await utils.clan.get.invalidate();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not convert points");
      }
    });
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={points < 1}
        onClick={() => {
          setError("");
          setIsOpen(true);
        }}
      >
        Convert points to ryo
      </Button>
      <Modal
        id="convert-clan-points"
        title="Convert clan points to ryo"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label="Convert"
        proceed_loading_label="Converting"
        isLoading={isPending}
        proceedDisabled={!isValid}
        keepOpenOnAccept
        onAccept={() => void onConvert()}
      >
        <p>
          Each clan point adds {CLAN_POINT_RYO_RATE.toLocaleString()} ryo to the clan
          bank. Banked ryo cannot be withdrawn.
        </p>
        <p className="my-2">Available: {points.toLocaleString()} clan points</p>
        <label htmlFor="clan-points-to-convert">Clan points to convert</label>
        <NumberInput
          id="clan-points-to-convert"
          value={amount}
          onValueChange={setAmount}
          min={1}
          max={points}
          disabled={isPending}
        />
        <p className="mt-2">
          Clan bank receives:{" "}
          {isValid ? (amount * CLAN_POINT_RYO_RATE).toLocaleString() : "0"} ryo
        </p>
        {error && (
          <p role="alert" className="mt-2 text-red-600">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
