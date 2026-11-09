"use client";

import { NumberInput } from "@/components/ui/number-input";

/**
 * WARNING: This page is loaded very frequently, so it is important to keep it as light as possible.
 * Do not casually introduce new queries without considering if if could be moved to a tab component loaded only on need.
 * Ensure that queries are only run when needed.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Award,
  BarChart2,
  Flag,
  House,
  Medal,
  MessageCircle,
  PersonStanding,
  RefreshCcwDot,
  Settings,
  Trash2,
  Waypoints,
} from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MAX_PVP_BRACKET, type UserStatus } from "@/drizzle/constants";
import type { UserData, UserRank } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import ActionLogs from "@/layout/ActionLog";
import ActionLogFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/ActionLogFiltering";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import DeleteUserButton from "@/layout/DeleteUserButton";
import GlowingBorder from "@/layout/GlowingBorder";
import GraphCombatLog from "@/layout/GraphCombatLog";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { ModerationSummary } from "@/layout/ModerationSummary";
import { NewConversationPrompt } from "@/layout/NewConversationPrompt";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import { EffectsPopover, PvpRecord } from "@/layout/ProfileStats";
import { AdjustSeichiSilver } from "@/layout/publicUser/AdjustSeichiSilver";
import { BadgesTab } from "@/layout/publicUser/BadgesTab";
import { BloodlinePoolManager } from "@/layout/publicUser/BloodlinePoolManager";
import { BracketEligibilityBadge } from "@/layout/publicUser/BracketEligibilityBadge";
import { DebugUserCloneControl } from "@/layout/publicUser/DebugUserCloneControl";
import { PublicUserSkeleton } from "@/layout/publicUser/PublicUserSkeleton";
import {
  ActivityEventsTab,
  BloodlineHistoryTab,
  CombatHistoryTab,
  HistoricalIpsTab,
  MarriagesTab,
  RankedMatchesTab,
  ReportsTab,
  StudentsTab,
} from "@/layout/publicUser/PublicUserTabs";
import { RecruitedUsersTab } from "@/layout/publicUser/RecruitedUsersTab";
import { ResetPetImageGeneration } from "@/layout/publicUser/ResetPetImageGeneration";
import { TOOLBAR_BUTTON_CLASS } from "@/layout/publicUser/toolbarButtonClass";
import { UpdateUserIdButton } from "@/layout/publicUser/UpdateUserIdButton";
import { UserTrainingLog } from "@/layout/publicUser/UserTrainingLog";
import ReportUser from "@/layout/Report";
import RichInput from "@/layout/RichInput";
import { publicUserIntro } from "@/layout/seoTexts";
import { TransactionHistory } from "@/layout/TransactionHistory";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getExpBracket, showUserRank } from "@/libs/profile";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import {
  canAwardExperience,
  canAwardReputation,
  canClearUserNindo,
  canCloneUser,
  canEditSeichiSilver,
  canRemoveBloodlineFromPool,
  canResetPetImageGeneration,
  canSeeActivityEvents,
  canSeeIps,
  canSeeSecretData,
  canUnstuckVillage,
  canViewOtherUsersBattleLogs,
} from "@/utils/permissions";
import { useUserPicker } from "@/utils/search";
import { useUserData } from "@/utils/UserContext";
import { type ExperienceAwardSchema, experienceAwardSchema } from "@/validators/misc";
import { awardSchema } from "@/validators/reputation";
import type { UserDeltaResponse } from "@/validators/userCache";

// The staff editor includes content and 3D previews; load it only when its modal opens.
const EditUserComponent = dynamic(
  () => import("@/layout/PublicUserEdit").then((module) => module.EditUserComponent),
  { loading: () => <Loader explanation="Loading user editor" /> },
);

/**
 * The handful of profile fields a server component can resolve before this one mounts.
 *
 * The full profile is fetched client-side, so without a seed the server render of every
 * /username/* URL is the same skeleton, which search engines treat as a soft 404 and
 * fold together as duplicates. Routes that already load
 * a profile for their metadata pass what they have so the first paint carries the
 * player's own name, rank and village.
 */
export interface PublicUserSeed {
  username: string;
  level: number;
  rank: UserRank;
  isOutlaw: boolean;
  avatar: string | null;
  /** Appended in brackets by the loaded render, so the seeded subtitle must match. */
  displayTitle?: string | null;
  villageName?: string | null;
}

interface PublicUserComponentProps {
  userId: string;
  title: string;
  initialProfile?: PublicUserSeed;
  defaultBackHref?: string;
  initialBreak?: boolean;
  showRecruited?: boolean;
  showStudents?: boolean;
  showBadges?: boolean;
  showNindo?: boolean;
  showReports?: boolean;
  showTransactions?: boolean;
  showActionLogs?: boolean;
  showTrainingLogs?: boolean;
  showCombatLogs?: boolean;
  showMarriages?: boolean;
  showHistoricalIps?: boolean;
  showActivityEvents?: boolean;
  showBloodlineHistory?: boolean;
}

type ReputationAwardTarget = {
  users: Array<{ userId: string; username: string }>;
  reputationAmount: number;
  moneyAmount: number;
  reason: string;
  profileReputationBefore: number | null;
};

type ExperienceAwardTarget = {
  userId: string;
  username: string;
  earnedExperienceBefore: number;
  amount: number;
};

type CommittedExperienceAward = ExperienceAwardTarget & {
  earnedExperienceAfter: number;
};

const PublicUserComponent: React.FC<PublicUserComponentProps> = (props) => {
  const {
    userId,
    title,
    initialProfile,
    defaultBackHref,
    initialBreak,
    showRecruited,
    showStudents,
    showBadges,
    showNindo,
    showReports,
    showTransactions,
    showActionLogs,
    showTrainingLogs,
    showCombatLogs,
    showMarriages,
    showHistoricalIps,
    showActivityEvents,
    showBloodlineHistory,
  } = props;
  // Get state
  const [showEditModal, setShowEditModal] = useState(false);
  const [isUserQuestDeletionPending, setIsUserQuestDeletionPending] = useState(false);
  const [showActive, setShowActive] = useState("nindo");
  const [showForceAwakeModal, setShowForceAwakeModal] = useState(false);
  const [forceAwakeReason, setForceAwakeReason] = useState("");
  const [forceAwakeTarget, setForceAwakeTarget] = useState<{
    userId: string;
    username: string;
    expectedStatus: UserStatus;
  } | null>(null);
  const [committedForceAwakeUserId, setCommittedForceAwakeUserId] = useState<
    string | null
  >(null);
  const forceAwakeFlight = useSingleFlight<NonNullable<typeof forceAwakeTarget>>();
  const forceAwakePending = forceAwakeFlight.isPending;
  const [avatarUpdateTarget, setAvatarUpdateTarget] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  const avatarUpdateFlight = useSingleFlight<NonNullable<typeof avatarUpdateTarget>>();
  const avatarUpdatePending = avatarUpdateFlight.isPending;
  const [clearNindoTarget, setClearNindoTarget] = useState<{
    userId: string;
    username: string;
    nindoId: string;
    expectedContent: string;
  } | null>(null);
  const [committedNindoClear, setCommittedNindoClear] = useState<{
    userId: string;
    nindoId: string;
    expectedContent: string;
  } | null>(null);
  const clearNindoFlight = useSingleFlight<NonNullable<typeof clearNindoTarget>>();
  const clearNindoPending = clearNindoFlight.isPending;
  const [awardTarget, setAwardTarget] = useState<ReputationAwardTarget | null>(null);
  const [awardPending, setAwardPending] = useState(false);
  const [awardNeedsRetry, setAwardNeedsRetry] = useState(false);
  const [completedAward, setCompletedAward] = useState<ReputationAwardTarget | null>(
    null,
  );
  const [committedAward, setCommittedAward] = useState<ReputationAwardTarget | null>(
    null,
  );
  const awardRequestRef = useRef<ReputationAwardTarget | null>(null);
  const [showExperienceAwardModal, setShowExperienceAwardModal] = useState(false);
  const [experienceAwardSource, setExperienceAwardSource] = useState<{
    userId: string;
    username: string;
    earnedExperience: number;
  } | null>(null);
  const [experienceAwardTarget, setExperienceAwardTarget] =
    useState<ExperienceAwardTarget | null>(null);
  const [experienceAwardPending, setExperienceAwardPending] = useState(false);
  const [experienceAwardNeedsRetry, setExperienceAwardNeedsRetry] = useState(false);
  const [committedExperienceAward, setCommittedExperienceAward] =
    useState<CommittedExperienceAward | null>(null);
  const experienceAwardRequestRef = useRef<ExperienceAwardTarget | null>(null);
  const { data: userData, isSignedIn, prepareUserUpdate, updateUser } = useUserData();
  const isGuest = !isSignedIn;

  const canSeeSecrets = userData && canSeeSecretData(userData.role);
  const enableReports = showReports && canSeeSecrets;
  const enablePaypal = showTransactions && canSeeSecrets;
  const enableLogs = showActionLogs && canSeeSecrets;
  const enableHistoricalIps = showHistoricalIps && userData && canSeeIps(userData.role);
  const enableActivityEvents =
    showActivityEvents && userData && canSeeActivityEvents(userData.role);
  const enableBloodlineHistory = showBloodlineHistory && canSeeSecrets;
  const enableCombatHistory =
    showCombatLogs &&
    userData &&
    (userData.userId === userId || canViewOtherUsersBattleLogs(userData.role));

  // Two-level filtering
  const state = useFiltering();

  // Queries
  const { data: profile, isPending: isPendingProfile } =
    api.profile.getPublicUser.useQuery({ userId: userId }, { enabled: !!userId });

  // Forms
  const form = useForm<
    z.input<typeof awardSchema>,
    unknown,
    z.output<typeof awardSchema>
  >({
    resolver: zodResolver(awardSchema),
    defaultValues: awardDefaults(userId),
  });

  const { methods: userSearchMethods, users: watchedUsers } = useUserPicker(10);
  const watchedReputationAmount = useWatch({
    control: form.control,
    name: "reputationAmount",
    defaultValue: 0,
  });
  const watchedMoneyAmount = useWatch({
    control: form.control,
    name: "moneyAmount",
    defaultValue: 0,
  });
  const watchedAwardReason = useWatch({
    control: form.control,
    name: "reason",
    defaultValue: "",
  });

  // Experience award form
  const experienceForm = useForm<ExperienceAwardSchema>({
    resolver: zodResolver(experienceAwardSchema),
    defaultValues: { amount: 100 },
  });

  useEffect(() => {
    if (profile && !awardTarget) {
      userSearchMethods.setValue("users", [toSearchUser(profile)]);
    }
  }, [awardTarget, profile, userSearchMethods]);

  useEffect(() => {
    if (watchedUsers && watchedUsers.length > 0) {
      form.setValue(
        "userIds",
        watchedUsers.map((u) => u.userId),
      );
    }
  }, [watchedUsers, form]);

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const updateAvatar = api.reports.updateUserAvatar.useMutation({
    meta: { handlesTransportError: true },
  });

  const handleAvatarUpdate = async () => {
    const target = avatarUpdateTarget;
    if (!target) return;

    await avatarUpdateFlight.run(target, async () => {
      try {
        const data = await updateAvatar.mutateAsync({
          userId: target.userId,
        });
        showMutationToast(data);
        if (!data.success) return;

        // The modal closes before the profile refresh.
        setAvatarUpdateTarget(null);
        void utils.profile.getPublicUser.invalidate();
      } catch (error) {
        showRetryableErrorToast(
          error,
          "Could not update this avatar. Check your connection and try again.",
        );
      }
    });
  };

  const clearNindo = api.reports.clearNindo.useMutation({
    meta: { handlesTransportError: true },
  });

  const handleClearNindo = async () => {
    const target = clearNindoTarget;
    if (!target) return;

    await clearNindoFlight.run(target, async () => {
      try {
        const data = await clearNindo.mutateAsync({
          userId: target.userId,
        });
        showMutationToast(data);
        if (!data.success) return;

        // Immediately suppress the exact committed nindo. A stale profile response
        // must not briefly expose a second clear action for content that is gone.
        setCommittedNindoClear({
          userId: target.userId,
          nindoId: target.nindoId,
          expectedContent: target.expectedContent,
        });
        setClearNindoTarget(null);
        void utils.profile.getPublicUser.invalidate();
      } catch (error) {
        showRetryableErrorToast(
          error,
          "Could not clear this nindo. Check your connection and try again.",
        );
      }
    });
  };

  const updateUserId = api.staff.updateUserId.useMutation({
    meta: { handlesTransportError: true },
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      const response: UserDeltaResponse = result;
      if (response.success || response.userPatch)
        await updateUser(response, { revision });
    },
  });

  const unstuckUser = api.staff.forceAwake.useMutation({
    meta: { handlesTransportError: true },
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      if (result.success || result.userPatch) await updateUser(result, { revision });
    },
  });

  const handleForceAwake = async () => {
    const target = forceAwakeTarget;
    const reason = forceAwakeReason.trim();
    if (!target || reason.length < 10) return;

    await forceAwakeFlight.run(target, async () => {
      try {
        const data = await unstuckUser.mutateAsync({
          userId: target.userId,
          reason,
        });
        showMutationToast(data);
        if (!data.success) return;

        // Suppress a second intervention before any cache refresh can return stale profile data.
        setCommittedForceAwakeUserId(target.userId);
        setShowForceAwakeModal(false);
        setForceAwakeTarget(null);
        setForceAwakeReason("");
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({ userId: target.userId }),
        ]);
      } catch (error) {
        showRetryableErrorToast(
          error,
          "Could not force this user awake. Check your connection and try again.",
        );
      }
    });
  };

  const awardMutation = api.misc.awardReputation.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, input, revision) => {
      if (result.success && input.userIds.includes(userData?.userId ?? ""))
        await updateUser(undefined, { revision, delta: result.userDelta }).catch(
          () => undefined,
        );
    },
  });

  const awardExperience = api.profile.awardExperience.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, input, revision) => {
      if (result.success && input.targetUserId === userData?.userId)
        await updateUser(undefined, { revision, delta: result.userDelta }).catch(
          () => undefined,
        );
    },
  });

  const handleExperienceAwardSubmit = experienceForm.handleSubmit(async (data) => {
    if (
      !experienceAwardSource ||
      experienceAwardRequestRef.current ||
      experienceAwardPending
    ) {
      return;
    }

    // Capture the exact target and amount, and block another award if the outcome is unknown.
    const target: ExperienceAwardTarget = {
      userId: experienceAwardSource.userId,
      username: experienceAwardSource.username,
      earnedExperienceBefore: experienceAwardSource.earnedExperience,
      amount: data.amount,
    };

    experienceAwardRequestRef.current = target;
    setExperienceAwardTarget(target);
    setExperienceAwardPending(true);

    try {
      const result = await awardExperience.mutateAsync({
        targetUserId: target.userId,
        amount: target.amount,
      });
      if (experienceAwardRequestRef.current !== target) return;

      if (!result.success) {
        showMutationToast(result);
        // Structured failures are known not to have committed, so the draft can be corrected.
        setExperienceAwardTarget(null);
        setExperienceAwardNeedsRetry(false);
        return;
      }

      showMutationToast(result);
      setCommittedExperienceAward({
        ...target,
        earnedExperienceAfter: target.earnedExperienceBefore + target.amount,
      });
      setExperienceAwardTarget(null);
      setExperienceAwardNeedsRetry(false);
      setShowExperienceAwardModal(false);
      setExperienceAwardSource(null);
      experienceForm.reset({ amount: 100 });
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: target.userId }),
      ]);
    } catch {
      // The global mutation handler emits the transport toast once. An unconfirmed response
      // blocks further awards until the profile is refreshed.
      if (experienceAwardRequestRef.current === target) {
        setExperienceAwardNeedsRetry(true);
      }
    } finally {
      if (experienceAwardRequestRef.current === target) {
        experienceAwardRequestRef.current = null;
        setExperienceAwardPending(false);
      }
    }
  });

  const openExperienceAward = () => {
    if (!profile || experienceAwardPending) return;
    if (!experienceAwardTarget) {
      setExperienceAwardSource({
        userId: profile.userId,
        username: profile.username,
        earnedExperience: profile.earnedExperience,
      });
    }
    setShowExperienceAwardModal(true);
  };

  const handleAwardSubmit = form.handleSubmit(async (data) => {
    if (awardRequestRef.current || completedAward) return;

    const target: ReputationAwardTarget = {
      users: watchedUsers.map((user) => ({
        userId: user.userId,
        username: user.username,
      })),
      reputationAmount: data.reputationAmount ?? 0,
      moneyAmount: data.moneyAmount ?? 0,
      reason: data.reason,
      profileReputationBefore:
        watchedUsers.some((user) => user.userId === profile?.userId) && profile
          ? profile.reputationPoints
          : null,
    };

    if (
      target.users.length === 0 ||
      target.users.some((user) => !data.userIds.includes(user.userId))
    ) {
      showMutationToast({
        success: false,
        message: "The selected recipients changed. Review the award and try again.",
      });
      return;
    }

    awardRequestRef.current = target;
    setAwardTarget(target);
    setAwardPending(true);
    try {
      const result = await awardMutation.mutateAsync({
        userIds: target.users.map((user) => user.userId),
        reputationAmount: target.reputationAmount,
        moneyAmount: target.moneyAmount,
        reason: target.reason,
      });
      if (awardRequestRef.current !== target) return;

      if (!result.success) {
        showMutationToast(result);
        // A structured rejection did not commit, so the staff member may correct the draft.
        setAwardTarget(null);
        setAwardNeedsRetry(false);
        return;
      }

      showMutationToast(result);
      setCommittedAward(target);
      setCompletedAward(target);
      setAwardTarget(null);
      setAwardNeedsRetry(false);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate(),
        utils.misc.getAllAwards.invalidate(),
      ]);
    } catch {
      // The shared tRPC handler owns the single error toast. The response may have been lost
      // after commit, so an unconfirmed award blocks further awards until the profile is refreshed.
      if (awardRequestRef.current === target) setAwardNeedsRetry(true);
    } finally {
      if (awardRequestRef.current === target) {
        awardRequestRef.current = null;
        setAwardPending(false);
      }
    }
  });

  const closeAward = () => {
    if (awardPending) return;
    if (completedAward) {
      form.reset(awardDefaults(userId));
      userSearchMethods.reset({
        username: "",
        users: profile ? [toSearchUser(profile)] : [],
      });
      setCompletedAward(null);
      setAwardNeedsRetry(false);
    }
  };

  const accountStatus = profile
    ? profile.isBanned
      ? "BANNED"
      : profile.isSilenced
        ? "SILENCED"
        : "GOOD STANDING"
    : "Loading...";

  const visibleReputationPoints =
    committedAward &&
    profile &&
    committedAward.profileReputationBefore === profile.reputationPoints &&
    committedAward.users.some((user) => user.userId === profile.userId)
      ? profile.reputationPoints + committedAward.reputationAmount
      : profile?.reputationPoints;

  const visibleEarnedExperience =
    committedExperienceAward &&
    profile &&
    committedExperienceAward.userId === profile.userId &&
    profile.earnedExperience === committedExperienceAward.earnedExperienceBefore
      ? committedExperienceAward.earnedExperienceAfter
      : profile?.earnedExperience;

  // Derived
  const canChange = userData && canClearUserNindo(userData);

  const suppressStaleClearedNindo = Boolean(
    committedNindoClear &&
      profile?.nindo &&
      committedNindoClear.userId === profile.userId &&
      committedNindoClear.nindoId === profile.nindo.id &&
      committedNindoClear.expectedContent === profile.nindo.content,
  );

  useEffect(() => {
    if (
      committedExperienceAward &&
      profile &&
      (committedExperienceAward.userId !== profile.userId ||
        profile.earnedExperience !== committedExperienceAward.earnedExperienceBefore)
    ) {
      // A refreshed (or otherwise newer) profile has superseded the local committed overlay.
      setCommittedExperienceAward(null);
    }
  }, [committedExperienceAward, profile]);

  useEffect(() => {
    if (
      avatarUpdateTarget &&
      !avatarUpdatePending &&
      avatarUpdateTarget.userId !== profile?.userId
    ) {
      setAvatarUpdateTarget(null);
    }
  }, [avatarUpdatePending, avatarUpdateTarget, profile?.userId]);

  useEffect(() => {
    if (!committedNindoClear || !profile) return;
    const currentNindo = profile.nindo;
    if (
      committedNindoClear.userId !== profile.userId ||
      !currentNindo ||
      currentNindo.id !== committedNindoClear.nindoId ||
      currentNindo.content !== committedNindoClear.expectedContent
    ) {
      setCommittedNindoClear(null);
    }
  }, [committedNindoClear, profile]);

  useEffect(() => {
    if (!clearNindoTarget || clearNindoPending || !profile) return;
    if (
      clearNindoTarget.userId !== profile.userId ||
      clearNindoTarget.nindoId !== profile.nindo?.id ||
      clearNindoTarget.expectedContent !== profile.nindo?.content
    ) {
      setClearNindoTarget(null);
    }
  }, [clearNindoPending, clearNindoTarget, profile]);

  // Loaders
  if (isPendingProfile) {
    return (
      <PublicUserSkeleton
        title={title}
        defaultBackHref={defaultBackHref}
        initialBreak={initialBreak}
        isGuest={isGuest}
        seed={initialProfile}
      />
    );
  }

  // Show profile
  if (!profile) {
    return (
      <ContentBox
        title="Users"
        subtitle="Search Unsuccessful"
        initialBreak={initialBreak}
      >
        User with id <b>{userId}</b> does not exist.
      </ContentBox>
    );
  }

  // Profile name
  let profileName = `${profile.username}`;
  if (profile.displayTitle) profileName += ` [${profile.displayTitle}]`;

  // Render
  return (
    <>
      {isGuest && (
        <ContentBox
          title="Public Profile"
          subtitle={`Profile: ${profileName}`}
          defaultBackHref={defaultBackHref}
          initialBreak={initialBreak}
        >
          {publicUserIntro(profile.username)}
        </ContentBox>
      )}
      {/* USER STATISTICS */}
      <ContentBox
        title={title}
        defaultBackHref={isGuest ? undefined : defaultBackHref}
        subtitle={`Profile: ${profileName}`}
        initialBreak={isGuest ? true : initialBreak}
        topRightContent={
          <div className="flex flex-row items-center gap-1 [&_svg]:block">
            {userData && canCloneUser(userData.role) && (
              <>
                <DebugUserCloneControl
                  key={profile.userId}
                  source={{ userId: profile.userId, username: profile.username }}
                  cloneUserId={userData.userId}
                />
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <UpdateUserIdButton
                          key={profile.userId}
                          userId={profile.userId}
                          username={profile.username}
                          updateUserIdMutation={updateUserId}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Update User ID</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
            {userData && !profile.isAi && (
              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/home/visit/${encodeURIComponent(profile.userId)}`}
                      aria-label="View home"
                      className="rounded-sm hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <House className="h-6 w-6" aria-hidden="true" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>View home</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {userData && !userData.isBanned && !userData.isSilenced && (
              <NewConversationPrompt
                newButton={
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <MessageCircle className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                      </TooltipTrigger>
                      <TooltipContent>Message User</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
                preSelectedUser={toSearchUser(profile)}
              />
            )}
            {userData && userData.role !== "USER" && (
              <>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={TOOLBAR_BUTTON_CLASS}
                        aria-label="Edit User"
                        onClick={() => setShowEditModal(true)}
                      >
                        <Settings className="h-6 w-6" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Edit User</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <Modal
                  title="Update User Data"
                  isOpen={showEditModal}
                  setIsOpen={setShowEditModal}
                  proceed_label="Done"
                  proceed_loading_label="Deleting"
                  isLoading={isUserQuestDeletionPending}
                >
                  {showEditModal && (
                    <EditUserComponent
                      userId={profile.userId}
                      targetIsAi={profile.isAi}
                      onUserQuestDeletionPendingChange={setIsUserQuestDeletionPending}
                      profile={{
                        ...profile,
                        reason: "",
                        items: profile.items.map((ui) => ui.itemId),
                        jutsus: profile.jutsus.map((ui) => ui.jutsuId),
                      }}
                    />
                  )}
                </Modal>
              </>
            )}
            {userData && canAwardReputation(userData.role) && (
              <Confirm
                id="award-reputation"
                title="Award Reputation Points"
                proceed_label="Award points"
                proceed_loading_label="Awarding"
                button={
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="img"
                          aria-label={`Award reputation to ${profile.username}`}
                          className="inline-flex"
                        >
                          <Medal className="h-6 w-6 hover:text-orange-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Award Reputation</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
                isValid={form.formState.isValid && !completedAward}
                isLoading={awardPending}
                keepOpenOnAccept
                disabled={awardPending}
                confirmDisabled={Boolean(completedAward) || awardNeedsRetry}
                onAccept={handleAwardSubmit}
                onClose={closeAward}
              >
                {completedAward ? (
                  <div className="space-y-2" role="status" aria-live="polite">
                    <p className="font-semibold text-green-400">Award completed.</p>
                    <p>
                      Applied {completedAward.reputationAmount} reputation and{" "}
                      {completedAward.moneyAmount.toLocaleString()} money to{" "}
                      {completedAward.users.map((user) => user.username).join(", ")}.
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Reason: {completedAward.reason}
                    </p>
                  </div>
                ) : (
                  <>
                    <p>
                      You are about to add{" "}
                      <b>{Number(watchedReputationAmount ?? 0)} reputation</b> and{" "}
                      <b>{Number(watchedMoneyAmount ?? 0).toLocaleString()} money</b> to{" "}
                      <b>
                        {watchedUsers.map((user) => user.username).join(", ") ||
                          "no selected users"}
                      </b>
                      .
                    </p>
                    <p className="text-sm">
                      Reason: {watchedAwardReason?.trim() || "No reason entered"}
                    </p>
                    {awardNeedsRetry && (
                      <p className="rounded-md border border-amber-500/60 bg-amber-950/30 p-2 text-amber-100 text-sm">
                        The previous response was not confirmed. Refresh the profile and
                        verify the action log before attempting another award.
                      </p>
                    )}
                    <p>
                      <b>DO NOT</b> abuse this feature! All assignments are logged and
                      visible to ALL users. Feature abuse for personal gain will result
                      in severe consequences.
                    </p>
                  </>
                )}
                <Form {...form}>
                  <form
                    className={`space-y-4 ${awardTarget || completedAward ? "pointer-events-none opacity-60" : ""}`}
                    aria-busy={awardPending}
                  >
                    <fieldset
                      disabled={awardPending || Boolean(awardTarget || completedAward)}
                    >
                      <UserSearchSelect
                        useFormMethods={userSearchMethods}
                        label="Users to award"
                        showAi={false}
                        showYourself={false}
                        maxUsers={10}
                      />

                      <FormField
                        control={form.control}
                        name="reputationAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reputation Amount</FormLabel>
                            <FormControl>
                              <NumberInput
                                step="any"
                                placeholder="Enter reputation amount"
                                disabled={awardPending || Boolean(awardTarget)}
                                {...field}
                                value={field.value as number}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="moneyAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Money Amount</FormLabel>
                            <FormControl>
                              <NumberInput
                                step="1"
                                placeholder="Enter money amount"
                                disabled={awardPending || Boolean(awardTarget)}
                                {...field}
                                value={field.value as number}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <RichInput
                        plainText
                        id="reason"
                        height="100px"
                        placeholder="Enter reason for awarding"
                        control={form.control}
                        error={form.formState.errors.reason?.message}
                        disabled={awardPending || Boolean(awardTarget)}
                      />
                    </fieldset>
                  </form>
                </Form>
              </Confirm>
            )}

            {userData && canEditSeichiSilver(userData.role) && !profile.isAi && (
              <AdjustSeichiSilver userId={profile.userId} username={profile.username} />
            )}

            {userData && canResetPetImageGeneration(userData.role) && !profile.isAi && (
              <ResetPetImageGeneration
                key={profile.userId}
                userId={profile.userId}
                username={profile.username}
              />
            )}

            {userData && canRemoveBloodlineFromPool(userData.role) && !profile.isAi && (
              <BloodlinePoolManager
                userId={profile.userId}
                username={profile.username}
                equippedBloodlineId={profile.bloodlineId ?? null}
              />
            )}

            {userData && canAwardExperience(userData) && (
              <>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-sm hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                        aria-label={`Award experience to ${profile.username}`}
                        disabled={experienceAwardPending}
                        onClick={openExperienceAward}
                      >
                        <Award className="h-6 w-6" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Award Experience</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {experienceAwardSource && (
                  <Modal
                    id={`award-experience-${experienceAwardSource.userId}`}
                    title={`Award experience: ${experienceAwardSource.username}`}
                    isOpen={showExperienceAwardModal}
                    setIsOpen={(isOpen) => {
                      setShowExperienceAwardModal(isOpen);
                      if (!isOpen && !experienceAwardTarget) {
                        setExperienceAwardSource(null);
                      }
                    }}
                    proceed_label="Award experience"
                    proceed_loading_label="Awarding"
                    isLoading={experienceAwardPending}
                    keepOpenOnAccept
                    proceedDisabled={
                      !experienceForm.formState.isValid || experienceAwardNeedsRetry
                    }
                    onAccept={() => void handleExperienceAwardSubmit()}
                  >
                    <p>
                      Add unallocated experience to{" "}
                      <b>{experienceAwardSource.username}</b>. They can distribute it to
                      their stats later; this does not directly change their level,
                      rank, or allocated stats.
                    </p>
                    <p className="break-all text-muted-foreground text-sm">
                      Target ID: <code>{experienceAwardSource.userId}</code>
                    </p>
                    {experienceAwardNeedsRetry && experienceAwardTarget && (
                      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                        The result of the {experienceAwardTarget.amount} XP award could
                        not be confirmed. Refresh the profile and verify the action log
                        before attempting another award.
                      </p>
                    )}
                    <p>
                      <b>DO NOT</b> abuse this feature. The amount, recipient, and staff
                      member are recorded in the public action log.
                    </p>
                    <Form {...experienceForm}>
                      <form className="mt-4 space-y-4">
                        <fieldset
                          className="space-y-4 disabled:cursor-wait disabled:opacity-70"
                          disabled={
                            experienceAwardPending || Boolean(experienceAwardTarget)
                          }
                        >
                          <FormField
                            control={experienceForm.control}
                            name="amount"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Experience Amount</FormLabel>
                                <FormControl>
                                  <NumberInput
                                    step="1"
                                    placeholder="Enter experience amount"
                                    {...field}
                                    onValueChange={field.onChange}
                                    min="1"
                                    max="100000"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </fieldset>
                      </form>
                    </Form>
                  </Modal>
                )}
              </>
            )}

            {userData && (userData.userId === profile.userId || canSeeSecrets) && (
              <ModerationSummary
                userId={profile.userId}
                username={profile.username}
                trigger={
                  <BarChart2
                    className="h-6 w-6 cursor-pointer hover:text-orange-500"
                    aria-label="Moderation Summary"
                  />
                }
              />
            )}
            {userData && (
              <ReportUser
                user={profile}
                content={{
                  id: profile.userId,
                  title: profile.username,
                  content:
                    "General user behavior, justification must be provided in comments",
                }}
                system="user_profile"
                button={
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Flag className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                      </TooltipTrigger>
                      <TooltipContent>Report User</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
              />
            )}
            {userData && canUnstuckVillage(userData.role) ? (
              <>
                {committedForceAwakeUserId !== profile.userId && (
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded-sm hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                          aria-label={`Force ${profile.username} awake`}
                          disabled={forceAwakePending}
                          onClick={() => {
                            setForceAwakeTarget({
                              userId: profile.userId,
                              username: profile.username,
                              expectedStatus: profile.status,
                            });
                            setForceAwakeReason("");
                            setShowForceAwakeModal(true);
                          }}
                        >
                          <PersonStanding className="h-6 w-6" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Force Awake</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <DeleteUserButton userData={profile} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Delete User</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            ) : (
              ""
            )}
          </div>
        }
      >
        <div className="grid grid-cols-2">
          <div>
            <b>General</b>
            <p>
              Lvl. {profile.level} {showUserRank(profile)}
            </p>
            <p>Village: {profile.village?.name}</p>
            <p>Status: {profile.status}</p>
            <p>Account Status: {accountStatus}</p>
            <p>Gender: {profile.gender}</p>
            <br />
            <b>Associations</b>
            <p>Clan: {profile.clan?.name || "None"}</p>
            <p>ANBU: {profile.anbuSquad?.name || "None"}</p>
            <p>
              Bloodline:{" "}
              {profile.bloodline ? <EffectsPopover item={profile.bloodline} /> : "None"}
            </p>
            <p>
              Sage Mode:{" "}
              {profile.sageMode ? <EffectsPopover item={profile.sageMode} /> : "None"}
            </p>
            <p>
              Sensei:{" "}
              {profile.rank === "GENIN" && profile.senseiId && profile.sensei ? (
                <Link
                  href={`/username/${profile.sensei.username}`}
                  className="font-bold"
                >
                  {profile.sensei.username}
                </Link>
              ) : (
                "None"
              )}
            </p>
            <br />
            <b>Experience</b>
            <p>Experience: {profile.experience}</p>
            <p>
              PvP Bracket: {getExpBracket(profile.experience, profile.rank)}/
              {MAX_PVP_BRACKET}
            </p>
            {canSeeSecrets && <p>Unclaimed Exp: {visibleEarnedExperience}</p>}
            <p>
              PVE Fights: {`${profile.pveFights} (+${profile.battleHistory.length})`}
            </p>
            {/* Self-view honors the display preference; staff can still inspect private records. */}
            {(profile.showPvpRecord || canSeeSecrets) &&
              profile.pvpWins != null &&
              profile.pvpLosses != null && (
                <PvpRecord wins={profile.pvpWins} losses={profile.pvpLosses} />
              )}
            <p>Yapper Rank: {profile.tavernMessages}</p>
            {userData && userData.userId !== profile.userId && !profile.isAi && (
              <BracketEligibilityBadge
                viewerExperience={userData.experience}
                viewerRank={userData.rank}
                viewerWarParticipantUntil={userData.warParticipantUntil}
                targetExperience={profile.experience}
                targetRank={profile.rank}
                targetBracketImmunityLiftedUntil={profile.bracketImmunityLiftedUntil}
                targetWarParticipantUntil={profile.warParticipantUntil}
              />
            )}
            <br />
            <b>Special</b>
            <p>Reputation points: {visibleReputationPoints}</p>
            <p>Federal Support: {profile.federalStatus.toLowerCase()}</p>
            {userData && canSeeSecretData(userData.role) && (
              <div>
                <br />
                <b>Information</b>
                <p>Too fast infractions: {profile.movedTooFastCount}</p>
                {canSeeIps(userData.role) && (
                  <Link
                    href={`/users/ipsearch/${profile.lastIp}`}
                    className="hover:cursor-pointer hover:text-orange-500"
                  >
                    Last IP: {profile.lastIp}
                  </Link>
                )}
                <div>
                  {profile.deletionAt
                    ? `To be deleted on: ${profile.deletionAt.toLocaleString()}`
                    : ""}
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="basis-1/3">
              <div className="relative flex justify-center">
                <GlowingBorder
                  messageCount={profile.tavernMessages}
                  className="rounded-2xl"
                >
                  <AvatarImage
                    href={profile.avatar}
                    alt={profile.username}
                    hover_effect={false}
                    className="w-full"
                    priority={true}
                    size={100}
                  />
                </GlowingBorder>
                {canChange && !profile.isAi && (
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Replace ${profile.username}'s avatar`}
                          className="absolute top-[3%] right-[13%] z-10 rounded-full bg-slate-300 p-1 hover:text-orange-500"
                          onClick={() =>
                            setAvatarUpdateTarget({
                              userId: profile.userId,
                              username: profile.username,
                            })
                          }
                        >
                          <RefreshCcwDot className="h-7 w-7" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Replace Avatar</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="mt-2">
                <PoolStatusBars pools={profile} status={profile.status} />
              </div>
            </div>
          </div>
        </div>
      </ContentBox>
      <Modal
        id="moderate-user-avatar"
        title="Replace User Avatar"
        isOpen={avatarUpdateTarget !== null}
        setIsOpen={(open) => {
          if (!open && !avatarUpdatePending) setAvatarUpdateTarget(null);
        }}
        proceed_label="Replace avatar"
        proceed_loading_label="Updating"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={avatarUpdatePending}
        keepOpenOnAccept={true}
        onAccept={() => void handleAvatarUpdate()}
      >
        <p>
          This permanently replaces the current avatar for{" "}
          {avatarUpdateTarget?.username ?? "this user"} with a newly generated one. Use
          this only to remove inappropriate content.
        </p>
        <p className="font-semibold">The moderation action will be logged.</p>
      </Modal>
      <Modal
        id="clear-user-nindo"
        title="Clear User Nindo"
        isOpen={clearNindoTarget !== null}
        setIsOpen={(open) => {
          if (!open && !clearNindoPending) setClearNindoTarget(null);
        }}
        proceed_label="Clear nindo"
        proceed_loading_label="Clearing"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={clearNindoPending}
        keepOpenOnAccept={true}
        onAccept={() => void handleClearNindo()}
      >
        <p>
          This permanently removes{" "}
          <span className="font-semibold">
            {clearNindoTarget?.username ?? "this user"}&apos;s
          </span>{" "}
          current Ninja Way from their public profile. The cleared text cannot be
          recovered here.
        </p>
        <p className="font-semibold">This moderation action will be logged.</p>
      </Modal>
      {canSeeSecrets && (
        <div className="text-center text-sm italic">Unique ID: {profile.userId}</div>
      )}
      {/* Badges */}
      {showBadges && (
        <BadgesTab
          userId={profile.userId}
          username={profile.username}
          currentBadges={profile.badges}
        />
      )}
      {/* Detail tabs */}
      {(showNindo ||
        showCombatLogs ||
        showTransactions ||
        showReports ||
        showTrainingLogs ||
        enableLogs ||
        enableHistoricalIps ||
        enableActivityEvents ||
        enableBloodlineHistory ||
        enableCombatHistory) && (
        <Tabs
          defaultValue={showActive}
          className="mt-3 flex flex-col items-center justify-center"
          onValueChange={(value) => setShowActive(value)}
        >
          {userData && (
            <div className="flex flex-col gap-1">
              <TabsList className="text-center">
                {showNindo && <TabsTrigger value="nindo">Nindo</TabsTrigger>}
                {showCombatLogs && (
                  <TabsTrigger value="graph">Combat Graph</TabsTrigger>
                )}
                {enableCombatHistory && (
                  <TabsTrigger value="combatHistory">Combat History</TabsTrigger>
                )}
                {showTransactions && enablePaypal && (
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                )}
                {showReports && enableReports && (
                  <TabsTrigger value="reports">Reports</TabsTrigger>
                )}

                {showMarriages && (
                  <TabsTrigger value="marriages">Marriages</TabsTrigger>
                )}
                {showStudents && <TabsTrigger value="students">Students</TabsTrigger>}
                {showRecruited && <TabsTrigger value="recruits">Recruits</TabsTrigger>}
                {showTrainingLogs && enableLogs && (
                  <TabsTrigger value="training">Training Log</TabsTrigger>
                )}
                {enableLogs && <TabsTrigger value="content">Content Log</TabsTrigger>}
                {enableHistoricalIps && (
                  <TabsTrigger value="historicalIps">IP log</TabsTrigger>
                )}
                {enableActivityEvents && (
                  <TabsTrigger value="activityEvents">Activity</TabsTrigger>
                )}
                {enableBloodlineHistory && (
                  <TabsTrigger value="bloodlineHistory">Bloodlines</TabsTrigger>
                )}
                <TabsTrigger value="ranked">Ranked</TabsTrigger>
              </TabsList>
            </div>
          )}

          {/* USER NINDO */}
          {showNindo && profile.nindo && (
            <TabsContent value="nindo">
              <ContentBox
                title="Nindo"
                subtitle={`${profile.username}'s Ninja Way`}
                initialBreak={true}
                topRightContent={
                  <div className="flex flex-row gap-1">
                    {canChange && !suppressStaleClearedNindo && (
                      <TooltipProvider delayDuration={50}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Clear ${profile.username}'s nindo`}
                              disabled={clearNindoPending}
                              className="rounded-sm disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() =>
                                setClearNindoTarget({
                                  userId: profile.userId,
                                  username: profile.username,
                                  nindoId: profile.nindo.id,
                                  expectedContent: profile.nindo.content,
                                })
                              }
                            >
                              <Trash2 className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Clear Nindo</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                }
              >
                {suppressStaleClearedNindo ? (
                  <p role="status" aria-live="polite" className="text-center italic">
                    Nindo cleared.
                  </p>
                ) : (
                  <div className="relative overflow-x-scroll">
                    {parseHtml(profile.nindo.content)}
                  </div>
                )}
              </ContentBox>
            </TabsContent>
          )}
          {/* USER COMBAT GRAPH */}
          {showCombatLogs && (
            <TabsContent value="graph">
              <ContentBox
                title="Combat Graph"
                subtitle={`PvP Activity`}
                initialBreak={true}
              >
                <p className="pb-3 italic">
                  The battle graph gives an overview of all users fought the last 60
                  days, as well as which users these opponents have faced.
                </p>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="submit" className="w-full">
                      <Waypoints className="mr-2 h-5 w-5" /> Show Battle Graph
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    className="min-h-[99%] min-w-[99%]"
                    aria-describedby="pvp-overview"
                  >
                    <DialogHeader>
                      <DialogTitle>
                        PvP Overview (Top Sampled Fights, Not all included)
                      </DialogTitle>
                      <DialogDescription asChild>
                        <GraphCombatLog userId={profile.userId} />
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              </ContentBox>
            </TabsContent>
          )}
          {/* USER COMBAT HISTORY */}
          {enableCombatHistory && (
            <TabsContent value="combatHistory">
              <CombatHistoryTab
                userId={profile.userId}
                isActive={showActive === "combatHistory"}
              />
            </TabsContent>
          )}
          {/* USER TRANSACTIONS */}
          {showTransactions && enablePaypal && (
            <TabsContent value="transactions">
              <TransactionHistory userId={profile.userId} />
            </TabsContent>
          )}
          {/* USER REPORTS */}
          {showReports && enableReports && (
            <TabsContent value="reports">
              <ReportsTab userId={profile.userId} isActive={showActive === "reports"} />
            </TabsContent>
          )}
          {/* USER MARRIAGES */}
          {showMarriages && (
            <TabsContent value="marriages">
              <MarriagesTab
                userId={profile.userId}
                username={profile.username}
                isActive={showActive === "marriages"}
              />
            </TabsContent>
          )}
          {/* USER STUDENTS */}
          {showStudents && (
            <TabsContent value="students">
              <StudentsTab students={profile.students} />
            </TabsContent>
          )}
          {/* USER RECRUITS */}
          {showRecruited && (
            <TabsContent value="recruits">
              <RecruitedUsersTab
                recruits={profile.recruitedUsers}
                parentUserId={profile.userId}
                parentUsername={profile.username}
                parentRecruitedCount={profile.recruitedUsers.length}
              />
            </TabsContent>
          )}
          {/* USER TRAINING LOG */}
          {showTrainingLogs && (
            <TabsContent value="training">
              <UserTrainingLog
                userId={profile.userId}
                isActive={showActive === "training"}
              />
            </TabsContent>
          )}
          {/* USER ACTION LOG */}
          {enableLogs && (
            <TabsContent value="content">
              <ActionLogs
                state={getFilter(state)}
                relatedId={userId}
                initialBreak={true}
                topRightContent={<ActionLogFiltering state={state} />}
              />
            </TabsContent>
          )}
          {/* USER HISTORICAL IPS */}
          {enableHistoricalIps && (
            <TabsContent value="historicalIps">
              <HistoricalIpsTab
                userId={profile.userId}
                isActive={showActive === "historicalIps"}
              />
            </TabsContent>
          )}
          {/* USER ACTIVITY EVENTS */}
          {enableActivityEvents && (
            <TabsContent value="activityEvents">
              <ActivityEventsTab
                userId={profile.userId}
                isActive={showActive === "activityEvents"}
              />
            </TabsContent>
          )}
          {/* USER BLOODLINE HISTORY */}
          {enableBloodlineHistory && (
            <TabsContent value="bloodlineHistory">
              <BloodlineHistoryTab
                userId={profile.userId}
                isActive={showActive === "bloodlineHistory"}
              />
            </TabsContent>
          )}
          {/* USER RANKED MATCHES */}
          {userData && (
            <TabsContent value="ranked">
              <RankedMatchesTab
                userId={profile.userId}
                isActive={showActive === "ranked"}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Force Awake Modal */}
      {showForceAwakeModal && forceAwakeTarget && (
        <Modal
          id="force-awake"
          title="Force User Awake"
          isOpen={showForceAwakeModal}
          setIsOpen={(open) => {
            if (forceAwakePending) return;
            setShowForceAwakeModal(open);
            if (!open) {
              setForceAwakeTarget(null);
              setForceAwakeReason("");
            }
          }}
          proceed_label="Force Awake"
          proceed_loading_label="Waking"
          confirmClassName="bg-orange-600 hover:bg-orange-700"
          onAccept={() => void handleForceAwake()}
          isValid={forceAwakeReason.trim().length >= 10}
          isLoading={forceAwakePending}
          keepOpenOnAccept
        >
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              You are about to force <strong>{forceAwakeTarget.username}</strong> to
              awake from <strong>{forceAwakeTarget.expectedStatus}</strong>. This clears
              their travel timer and battle link, removes them from multiplayer and
              ranked queues, and cancels a pending Kage challenge they sent. Other
              battle participants are not changed.
            </p>

            <div className="rounded-md border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
              <p>
                Target ID: <code>{forceAwakeTarget.userId}</code>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="force-awake-reason">Reason *</Label>
              <Input
                id="force-awake-reason"
                value={forceAwakeReason}
                onChange={(e) => setForceAwakeReason(e.target.value)}
                disabled={forceAwakePending}
                placeholder="Enter reason for forcing awake status (minimum 10 characters)..."
              />
              <p className="text-muted-foreground text-xs">
                This reason will be logged in the action log. Minimum 10 characters
                required.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default PublicUserComponent;

/** Start a staff award draft for this profile with zero currency and an empty reason. */
const awardDefaults = (userId: string) => ({
  reputationAmount: 0,
  moneyAmount: 0,
  reason: "",
  userIds: [userId],
});

/** The user-picker entry for a loaded profile. */
const toSearchUser = (
  profile: Pick<
    UserData,
    "userId" | "username" | "rank" | "level" | "avatar" | "federalStatus"
  >,
) => ({
  userId: profile.userId,
  username: profile.username,
  rank: profile.rank,
  level: profile.level,
  avatar: profile.avatar,
  federalStatus: profile.federalStatus,
});
