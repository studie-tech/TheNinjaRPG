"use client";

/**
 * WARNING: This page is loaded very frequently, so it is important to keep it as light as possible.
 * Do not casually introduce new queries without considering if if could be moved to a tab component loaded only on need.
 * Ensure that queries are only run when needed.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Award,
  BarChart2,
  Coins,
  CopyCheck,
  Droplets,
  Flag,
  IdCard,
  Medal,
  MessageCircle,
  PersonStanding,
  Plus,
  RefreshCcwDot,
  Settings,
  Trash2,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { NewConversationPrompt } from "@/app/inbox/page";
import { TransactionHistory } from "@/app/points/page";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type BattleType,
  BattleTypes,
  IMG_AVATAR_DEFAULT,
  ITEM_LEVEL_CAP,
  RANKS_RESTRICTED_FROM_PVP,
  SEICHI_SILVER_ADJUST_LIMIT,
  TrainingSpeeds,
  type UserStatus,
  XP_BRACKETS,
} from "@/drizzle/constants";
import type { Badge, Jutsu, UserBadge, UserRank } from "@/drizzle/schema";
import { useUserEditForm } from "@/hooks/profile";
import ActionLogs from "@/layout/ActionLog";
import ActionLogFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/ActionLogFiltering";
import AvatarImage from "@/layout/Avatar";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import DeleteUserButton from "@/layout/DeleteUserButton";
import { EditContent } from "@/layout/EditContent";
import GraphCombatLog from "@/layout/GraphCombatLog";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { ModerationSummary } from "@/layout/ModerationSummary";
import Post from "@/layout/Post";
import ReportUser from "@/layout/Report";
import RichInput from "@/layout/RichInput";
import StatusBar from "@/layout/StatusBar";
import { publicUserText } from "@/layout/seoTexts";
import Table from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { canAttackBracket, getExpBracket, showUserRank } from "@/libs/profile";
import { getEffectiveThemeTextColor } from "@/libs/themePreference";
import { showMutationToast } from "@/libs/toast";
import { isRetryableTrpcError } from "@/utils/error";
import { groupBy } from "@/utils/grouping";
import { useActiveLayout } from "@/utils/LayoutContext";
import { parseHtml } from "@/utils/parse";
import {
  canAwardExperience,
  canAwardReputation,
  canChangeUserRolesTo,
  canClearUserNindo,
  canCloneUser,
  canDeleteReferral,
  canEditBloodline,
  canEditCustomTitle,
  canEditItems,
  canEditJutsus,
  canEditQuests,
  canEditRank,
  canEditRankedLp,
  canEditSeichiSilver,
  canEditStaffAccountFlag,
  canEditUsername,
  canEditVillage,
  canModifyUserBadges,
  canOnlyEditSelf,
  canRemoveBloodlineFromPool,
  canSeeActivityEvents,
  canSeeIps,
  canSeeSecretData,
  canUnstuckVillage,
  canViewOtherUsersBattleLogs,
} from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import { type ExperienceAwardSchema, experienceAwardSchema } from "@/validators/misc";
import { getSearchValidator } from "@/validators/register";
import { awardSchema } from "@/validators/reputation";
import type { UpdateUserSchema } from "@/validators/user";
import { updateUserSchema } from "@/validators/user";
import GlowingBorder from "./GlowingBorder";

/**
 * The handful of profile fields a server component can resolve before this one mounts.
 *
 * The full profile is fetched client-side, so without a seed the server render of every
 * /username/* URL is the same skeleton -- which Search Console read as a soft 404, and
 * where it saw several of them, folded together as duplicates. Routes that already load
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
  customTitle?: string | null;
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
  requestId: string;
  users: Array<{ userId: string; username: string }>;
  reputationAmount: number;
  moneyAmount: number;
  reason: string;
  profileReputationBefore: number | null;
};

type ExperienceAwardTarget = {
  requestId: string;
  userId: string;
  username: string;
  earnedExperienceBefore: number;
  amount: number;
};

type CommittedExperienceAward = ExperienceAwardTarget & {
  earnedExperienceAfter: number;
};

type DebugCloneSource = {
  userId: string;
  username: string;
};

/**
 * Keep the confirmation and in-flight request bound to the exact profile that opened it. A
 * profile-route refresh can reuse PublicUser's surrounding layout, but it must never retarget an
 * already-open destructive confirmation to the newly rendered profile.
 */
const DebugUserCloneControl: React.FC<{
  source: DebugCloneSource;
  cloneUserId: string;
}> = ({ source, cloneUserId }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const [confirmedSource, setConfirmedSource] = useState<DebugCloneSource | null>(null);
  const sourceInFlight = useRef<string | null>(null);
  const { mutateAsync: cloneUser, isPending } =
    api.staff.cloneUserForDebug.useMutation();

  const cloneConfirmedSource = async (target: DebugCloneSource) => {
    // Mutation state reaches React on the next render. Claim this source synchronously so a
    // click/Enter race cannot submit the same destructive replacement twice.
    if (sourceInFlight.current !== null) return;
    sourceInFlight.current = target.userId;

    try {
      const result = await cloneUser({
        userId: target.userId,
      });
      if (result.success) {
        showMutationToast(result);

        // The copy is committed. Close the stale destructive action before best-effort cache
        // refresh/navigation so another copy always requires a new explicit confirmation.
        setConfirmedSource(null);
        void Promise.allSettled([
          utils.profile.getUser.invalidate(),
          utils.profile.getPublicUser.invalidate({ userId: cloneUserId }),
        ]);
        router.push("/profile");
      } else {
        showMutationToast(result);
      }
    } catch {
      // The shared tRPC handler owns transport-error reporting. Keep the exact source snapshot
      // open so the staff member can deliberately retry without silently changing targets.
    } finally {
      if (sourceInFlight.current === target.userId) sourceInFlight.current = null;
    }
  };

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Clone ${source.username} into your debug account`}
              className="inline-flex items-center disabled:cursor-wait disabled:opacity-50"
              disabled={isPending}
              onClick={() => setConfirmedSource({ ...source })}
            >
              <CopyCheck className="h-6 w-6 hover:text-orange-500" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Clone User</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {confirmedSource && (
        <Modal
          id={`clone-user-${confirmedSource.userId}`}
          title={`Clone user: ${confirmedSource.username}`}
          isOpen
          setIsOpen={(isOpen) => {
            if (!isOpen) setConfirmedSource(null);
          }}
          proceed_label="Clone user"
          proceed_loading_label="Cloning"
          isLoading={isPending}
          keepOpenOnAccept
          onAccept={(event) => {
            event.preventDefault();
            void cloneConfirmedSource(confirmedSource);
          }}
        >
          <p>
            This copies <b>{confirmedSource.username}</b>&apos;s current gameplay state
            into your separate staff/debug account. The source user will not be changed.
          </p>
          <p>
            Your debug account&apos;s stats, location, inventory, jutsu, quest history,
            attributes, ranked rewards, clan, and ANBU membership will be replaced. Your
            identity, username, staff role, moderation state, purchases, messages, and
            other private account data stay unchanged.
          </p>
          <p>
            Source ID: <code>{confirmedSource.userId}</code>. After cloning, you will be
            taken to your updated profile.
          </p>
        </Modal>
      )}
    </>
  );
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
    expectedBattleId: string | null;
    requestId: string;
  } | null>(null);
  const [forceAwakePending, setForceAwakePending] = useState(false);
  const [committedForceAwake, setCommittedForceAwake] = useState<{
    userId: string;
    requestId: string;
  } | null>(null);
  const forceAwakeRequestRef = useRef<typeof forceAwakeTarget>(null);
  const [avatarUpdateTarget, setAvatarUpdateTarget] = useState<{
    userId: string;
    username: string;
    expectedAvatar: string | null;
  } | null>(null);
  const [avatarUpdatePending, setAvatarUpdatePending] = useState(false);
  const [committedAvatarUpdate, setCommittedAvatarUpdate] = useState<{
    userId: string;
    sourceAvatar: string | null;
    avatar: string;
  } | null>(null);
  const avatarUpdateRequestRef = useRef<typeof avatarUpdateTarget>(null);
  const [clearNindoTarget, setClearNindoTarget] = useState<{
    userId: string;
    username: string;
    nindoId: string;
    expectedContent: string;
  } | null>(null);
  const [clearNindoPending, setClearNindoPending] = useState(false);
  const [committedNindoClear, setCommittedNindoClear] = useState<{
    userId: string;
    nindoId: string;
    expectedContent: string;
  } | null>(null);
  const clearNindoRequestRef = useRef<typeof clearNindoTarget>(null);
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
  const { data: userData, isSignedIn } = useUserData();
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
    defaultValues: {
      reputationAmount: 0,
      moneyAmount: 0,
      reason: "",
      userIds: [userId],
    },
  });

  const userSearchSchema = getSearchValidator({ max: 10 });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
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
      userSearchMethods.setValue("users", [
        {
          userId: profile.userId,
          username: profile.username,
          rank: profile.rank,
          level: profile.level,
          avatar: profile.avatar,
          federalStatus: profile.federalStatus,
        },
      ]);
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
  const updateAvatar = api.reports.updateUserAvatar.useMutation();

  const handleAvatarUpdate = async () => {
    const target = avatarUpdateTarget;
    if (!target || avatarUpdateRequestRef.current) return;

    // This ref closes the same-tick gap before React can render the pending state.
    avatarUpdateRequestRef.current = target;
    setAvatarUpdatePending(true);
    try {
      const data = await updateAvatar.mutateAsync({
        userId: target.userId,
      });
      if (avatarUpdateRequestRef.current !== target) return;

      showMutationToast(data);
      if (!data.success) return;

      // Hide the action and render the committed image before cache work, so a stale
      // profile response cannot expose a second moderation request for the old avatar.
      setAvatarUpdateTarget(null);
      void utils.profile.getPublicUser.invalidate();
    } catch (error) {
      // Non-transient tRPC errors are already shown by the global mutation handler.
      if (
        avatarUpdateRequestRef.current === target &&
        error instanceof Error &&
        isRetryableTrpcError(error)
      ) {
        showMutationToast({
          success: false,
          message: "Could not update this avatar. Check your connection and try again.",
        });
      }
    } finally {
      if (avatarUpdateRequestRef.current === target) {
        avatarUpdateRequestRef.current = null;
        setAvatarUpdatePending(false);
      }
    }
  };

  const clearNindo = api.reports.clearNindo.useMutation();

  const handleClearNindo = async () => {
    const target = clearNindoTarget;
    if (!target || clearNindoRequestRef.current) return;

    // React has not rendered the pending state yet during a same-tick second click.
    clearNindoRequestRef.current = target;
    setClearNindoPending(true);
    try {
      const data = await clearNindo.mutateAsync({
        userId: target.userId,
      });
      if (clearNindoRequestRef.current !== target) return;

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
      // Other tRPC errors are already displayed once by the global mutation handler.
      if (
        clearNindoRequestRef.current === target &&
        error instanceof Error &&
        isRetryableTrpcError(error)
      ) {
        showMutationToast({
          success: false,
          message: "Could not clear this nindo. Check your connection and try again.",
        });
      }
    } finally {
      if (clearNindoRequestRef.current === target) {
        clearNindoRequestRef.current = null;
        setClearNindoPending(false);
      }
    }
  };

  const updateUserId = api.staff.updateUserId.useMutation();

  const unstuckUser = api.staff.forceAwake.useMutation();

  const handleForceAwake = async () => {
    const target = forceAwakeTarget;
    const reason = forceAwakeReason.trim();
    if (!target || forceAwakeRequestRef.current || reason.length < 10) return;

    // Close the same-tick gap before React can commit the mutation's pending state.
    forceAwakeRequestRef.current = target;
    setForceAwakePending(true);
    try {
      const data = await unstuckUser.mutateAsync({
        userId: target.userId,
        reason,
      });
      if (forceAwakeRequestRef.current !== target) return;

      showMutationToast(data);
      if (!data.success) return;

      // Suppress a second intervention before any cache refresh can return stale profile data.
      setCommittedForceAwake({ userId: target.userId, requestId: target.requestId });
      setShowForceAwakeModal(false);
      setForceAwakeTarget(null);
      setForceAwakeReason("");
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: target.userId }),
        utils.profile.getUser.invalidate(),
      ]);
    } catch (error) {
      // Non-network tRPC failures are already rendered exactly once by the global handler.
      if (
        forceAwakeRequestRef.current === target &&
        error instanceof Error &&
        isRetryableTrpcError(error)
      ) {
        showMutationToast({
          success: false,
          message:
            "Could not force this user awake. Check your connection and try again.",
        });
      }
    } finally {
      if (forceAwakeRequestRef.current === target) {
        forceAwakeRequestRef.current = null;
        setForceAwakePending(false);
      }
    }
  };

  // mutations related to badges and activity events were relocated to their tab components.
  const awardMutation = api.misc.awardReputation.useMutation();

  const awardExperience = api.profile.awardExperience.useMutation();

  const handleExperienceAwardSubmit = experienceForm.handleSubmit(async (data) => {
    if (
      !experienceAwardSource ||
      experienceAwardRequestRef.current ||
      experienceAwardPending
    ) {
      return;
    }

    // Capture the exact target and amount, and block another award if the outcome is unknown.
    const target =
      experienceAwardTarget ??
      ({
        requestId: crypto.randomUUID(),
        userId: experienceAwardSource.userId,
        username: experienceAwardSource.username,
        earnedExperienceBefore: experienceAwardSource.earnedExperience,
        amount: data.amount,
      } satisfies ExperienceAwardTarget);

    experienceAwardRequestRef.current = target;
    setExperienceAwardTarget(target);
    setExperienceAwardPending(true);
    if (!experienceAwardTarget) setExperienceAwardNeedsRetry(false);

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
        utils.profile.getUser.invalidate(),
      ]);
    } catch {
      // The global mutation handler emits the transport toast once. Preserve the immutable
      // request so the UI can block another award until the outcome is verified.
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

    // A transport failure retries this exact immutable request. Changing its recipients or value
    // and minting another key could double an award whose successful response was lost.
    const target =
      awardTarget ??
      ({
        requestId: crypto.randomUUID(),
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
      } satisfies ReputationAwardTarget);

    if (!awardTarget) setAwardNeedsRetry(false);

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
        utils.profile.getUser.invalidate(),
        utils.misc.getAllAwards.invalidate(),
      ]);
    } catch {
      // The shared tRPC handler owns the single error toast. Regardless of the exact transport
      // shape, preserve this key and snapshot: the response may have been lost after commit.
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
      form.reset({
        reputationAmount: 0,
        moneyAmount: 0,
        reason: "",
        userIds: [userId],
      });
      userSearchMethods.reset({
        username: "",
        users: profile
          ? [
              {
                userId: profile.userId,
                username: profile.username,
                rank: profile.rank,
                level: profile.level,
                avatar: profile.avatar,
                federalStatus: profile.federalStatus,
              },
            ]
          : [],
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

  let visibleAvatar = profile?.avatar;
  let suppressStaleAvatarAction = false;
  if (
    committedAvatarUpdate &&
    profile &&
    committedAvatarUpdate.userId === profile.userId &&
    committedAvatarUpdate.sourceAvatar === profile.avatar
  ) {
    visibleAvatar = committedAvatarUpdate.avatar;
    suppressStaleAvatarAction = true;
  }

  const suppressStaleClearedNindo = Boolean(
    committedNindoClear &&
      profile?.nindo &&
      committedNindoClear.userId === profile.userId &&
      committedNindoClear.nindoId === profile.nindo.id &&
      committedNindoClear.expectedContent === profile.nindo.content,
  );

  useEffect(() => {
    if (
      committedAvatarUpdate &&
      profile &&
      committedAvatarUpdate.userId === profile.userId &&
      profile.avatar === committedAvatarUpdate.avatar
    ) {
      setCommittedAvatarUpdate(null);
    }
  }, [committedAvatarUpdate, profile?.avatar, profile?.userId]);

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
  if (profile.customTitle) profileName += ` [${profile.customTitle}]`;

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
          {publicUserText(profile.username)}
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
                preSelectedUser={{
                  userId: profile.userId,
                  username: profile.username,
                  rank: profile.rank,
                  level: profile.level,
                  avatar: profile.avatar,
                  federalStatus: profile.federalStatus,
                }}
              />
            )}
            {userData && userData.role !== "USER" && (
              <>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Settings
                        className="h-6 w-6 cursor-pointer hover:text-orange-500"
                        onClick={() => setShowEditModal(true)}
                      />
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
                              <Input
                                type="number"
                                step="any"
                                placeholder="Enter reputation amount"
                                disabled={awardPending || Boolean(awardTarget)}
                                {...field}
                                value={field.value as number}
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
                              <Input
                                type="number"
                                step="1"
                                placeholder="Enter money amount"
                                disabled={awardPending || Boolean(awardTarget)}
                                {...field}
                                value={field.value as number}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <RichInput
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
                                  <Input
                                    type="number"
                                    step="1"
                                    placeholder="Enter experience amount"
                                    {...field}
                                    onChange={(event) =>
                                      field.onChange(
                                        Number.parseInt(event.target.value, 10) || 0,
                                      )
                                    }
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
                {committedForceAwake?.userId !== profile.userId && (
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
                              expectedBattleId: null,
                              requestId: crypto.randomUUID(),
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
              {profile.bloodline ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer font-bold hover:text-orange-500"
                    >
                      {profile.bloodline.name}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] max-w-[90vw]">
                    <ItemWithEffects item={profile.bloodline} />
                  </PopoverContent>
                </Popover>
              ) : (
                "None"
              )}
            </p>
            <p>
              Sage Mode:{" "}
              {profile.sageMode ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer font-bold hover:text-orange-500"
                    >
                      {profile.sageMode.name}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] max-w-[90vw]">
                    <ItemWithEffects item={profile.sageMode} />
                  </PopoverContent>
                </Popover>
              ) : (
                "None"
              )}
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
              {XP_BRACKETS.length}
            </p>
            {canSeeSecrets && <p>Unclaimed Exp: {visibleEarnedExperience}</p>}
            <p>Experience for lvl: ---</p>
            <p>
              PVE Fights: {`${profile.pveFights} (+${profile.battleHistory.length})`}
            </p>
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
                    href={visibleAvatar}
                    alt={profile.username}
                    userId={profile.userId}
                    hover_effect={false}
                    className="w-full"
                    priority={true}
                    size={100}
                  />
                </GlowingBorder>
                {canChange && !profile.isAi && !suppressStaleAvatarAction && (
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
                              expectedAvatar: profile.avatar,
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
                <StatusBar
                  title="HP"
                  tooltip="Health"
                  color="bg-red-500"
                  showText={true}
                  status={profile.status}
                  current={profile.curHealth}
                  total={profile.maxHealth}
                />
                <StatusBar
                  title="CP"
                  tooltip="Chakra"
                  color="bg-blue-500"
                  showText={true}
                  status={profile.status}
                  current={profile.curChakra}
                  total={profile.maxChakra}
                />
                <StatusBar
                  title="SP"
                  tooltip="Stamina"
                  color="bg-green-500"
                  showText={true}
                  status={profile.status}
                  current={profile.curStamina}
                  total={profile.maxStamina}
                />
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
      {/* Badges are now displayed directly below the profile */}
      {showBadges && (
        <BadgesTab
          userId={profile.userId}
          username={profile.username}
          currentBadges={profile.badges}
        />
      )}
      {/* Marriages, Students, and Badges sections are now rendered inside tabs below */}
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
              <p>Battle: {forceAwakeTarget.expectedBattleId ?? "none"}</p>
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

interface PublicUserSkeletonProps {
  title: string;
  defaultBackHref?: string;
  initialBreak?: boolean;
  /** Mirrors the stable signed-in state used by the loaded render. */
  isGuest: boolean;
  /** Profile fields the route already resolved server-side, when it has them. */
  seed?: PublicUserSeed;
}

/**
 * Placeholder shown while the profile query is in flight.
 *
 * The profile is fetched client-side, so the server render carries none of it. A bare
 * spinner is a few dozen pixels tall and the loaded profile is several hundred, which
 * moved everything below it on arrival and put the /username/* template over the poor
 * Cumulative Layout Shift threshold in Search Console.
 *
 * The structure below deliberately mirrors the loaded render rather than approximating
 * it: the same guest-only intro box, the same two-column grid, and an avatar reserved at
 * the same `w-full` the loaded one is given. A placeholder that reserves the wrong shape
 * still shifts the page, just by less.
 */
const PublicUserSkeleton: React.FC<PublicUserSkeletonProps> = ({
  title,
  defaultBackHref,
  initialBreak,
  isGuest,
  seed,
}) => {
  const seedName = seed
    ? `${seed.username}${seed.customTitle ? ` [${seed.customTitle}]` : ""}`
    : null;
  return (
    <>
      {isGuest && (
        <ContentBox
          title="Public Profile"
          subtitle={seedName ? `Profile: ${seedName}` : "Loading profile"}
          defaultBackHref={defaultBackHref}
          initialBreak={initialBreak}
        >
          {/* With a seed this is the same copy the loaded render shows, so the panel needs
            no placeholder at all and never resizes. Without one, publicUserText is four
            fixed paragraphs whose rendered height is deterministic -- only the username
            varies -- so it is reserved to measured size rather than approximated: at 24
            rows the panel matches the loaded one to within a few pixels at desktop
            width. */}
          {seed ? (
            publicUserText(seed.username)
          ) : (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 24 }, (_, i) => (
                <Skeleton
                  key={i}
                  className={i % 7 === 6 ? "h-4 w-2/3" : "h-4 w-full"}
                />
              ))}
            </div>
          )}
        </ContentBox>
      )}
      <ContentBox
        title={title}
        subtitle={seedName ? `Profile: ${seedName}` : "Loading profile"}
        defaultBackHref={isGuest ? undefined : defaultBackHref}
        initialBreak={isGuest ? true : initialBreak}
      >
        <div className="grid grid-cols-2">
          <div className="flex flex-col gap-2">
            {seed && (
              // The three lines the seed can fill are the first three of the loaded
              // "General" block, in the same order, so nothing below them moves. The
              // village row is rendered even when the seed has no village, because the
              // loaded panel always renders it -- omitting it would leave the
              // placeholder a row short and shift everything below it on load.
              <div>
                <b>General</b>
                <p>
                  Lvl. {seed.level} {showUserRank(seed)}
                </p>
                <p>Village: {seed.villageName}</p>
              </div>
            )}
            {Array.from({ length: seed ? 20 : 23 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-11/12" />
            ))}
          </div>
          <div>
            <div className="basis-1/3">
              <div className="relative flex justify-center">
                {seed ? (
                  <AvatarImage
                    href={seed.avatar}
                    alt={seed.username}
                    size={100}
                    priority
                  />
                ) : (
                  <Skeleton className="aspect-square w-full max-w-80 rounded-2xl" />
                )}
              </div>
              <div className="mt-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="group relative flex-row">
                    <Skeleton className="h-4 w-1/3 rounded-none" />
                    <Skeleton className="h-3 w-full rounded-none border-2 border-black" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <Loader explanation="Fetching Public User Data" />
      </ContentBox>
    </>
  );
};

interface EditUserComponentProps {
  userId: string;
  targetIsAi: boolean;
  profile: UpdateUserSchema;
  onUserQuestDeletionPendingChange?: (isPending: boolean) => void;
}

type EditableUserQuest = RouterOutputs["quests"]["getUserQuests"][number];

type JutsuAdjustmentSnapshot = {
  userId: string;
  username: string;
  isAi: boolean;
  userJutsuId: string;
  jutsuId: string;
  jutsuName: string;
  previousLevel: number;
  newLevel: number;
  previousReskinId: string | null;
  previousReskinName: string | null;
  newReskinId: string | null;
  newReskinName: string | null;
  equipped: boolean;
  finishTraining: Date | null;
  requestId: string;
};

type CommittedJutsuAdjustment = {
  level: number;
  reskinId: string | null;
  reskinName: string | null;
};

type EditableUserItem = RouterOutputs["item"]["getPublicUserItems"][number];

type ItemAdjustmentSnapshot = {
  userId: string;
  username: string;
  isAi: boolean;
  userItemId: string;
  itemId: string;
  itemName: string;
  previousLevel: number;
  newLevel: number;
  quantity: number;
  experience: number;
  equipped: EditableUserItem["equipped"];
  durability: number;
  dropChancePerc: number;
  storedAtHome: boolean;
  isInAuction: boolean;
  activeVariantId: string | null;
  craftingFinishedAt: Date | null;
  imbuements: Array<{
    id: string;
    itemId: string;
    itemName: string;
    craftingFinishedAt: Date;
  }>;
  requestId: string;
};

type UserQuestDeletionSnapshot = {
  userId: string;
  username: string;
  userQuestId: string;
  questId: string;
  questName: string;
  questType: EditableUserQuest["quest"]["questType"];
  startedAt: Date;
  endAt: Date | null;
  completed: number;
  requestId: string;
};

const questRecordStatus = (quest: Pick<EditableUserQuest, "completed" | "endAt">) => {
  if (!quest.endAt && quest.completed === 0) return "Active";
  if (quest.completed > 0) return "Completed";
  return "Ended without completion";
};

const DeleteUserQuestControl: React.FC<{
  userId: string;
  username: string;
  userQuest: EditableUserQuest;
  onDeleted: (userQuestId: string) => void;
  onPendingChange?: (isPending: boolean) => void;
}> = ({ userId, username, userQuest, onDeleted, onPendingChange }) => {
  const utils = api.useUtils();
  const [confirmedQuest, setConfirmedQuest] =
    useState<UserQuestDeletionSnapshot | null>(null);
  const [isPending, setIsPending] = useState(false);
  const requestRef = useRef<UserQuestDeletionSnapshot | null>(null);
  const deleteUserQuest = api.quests.deleteUserQuest.useMutation();

  const openConfirmation = () => {
    if (isPending || requestRef.current) return;
    setConfirmedQuest({
      userId,
      username,
      userQuestId: userQuest.id,
      questId: userQuest.quest.id,
      questName: userQuest.quest.name,
      questType: userQuest.quest.questType,
      startedAt: new Date(userQuest.startedAt),
      endAt: userQuest.endAt ? new Date(userQuest.endAt) : null,
      completed: userQuest.completed,
      requestId: crypto.randomUUID(),
    });
  };

  const confirmDeletion = async (snapshot: UserQuestDeletionSnapshot) => {
    // React exposes mutation state on the next render. Claim this exact history record
    // synchronously so click/Enter cannot dispatch a second destructive request.
    if (requestRef.current) return;
    requestRef.current = snapshot;
    setIsPending(true);
    onPendingChange?.(true);

    try {
      const result = await deleteUserQuest.mutateAsync({
        userId: snapshot.userId,
        questId: snapshot.questId,
      });
      if (requestRef.current !== snapshot) return;
      if (!result.success) return showMutationToast(result);

      showMutationToast(result);
      // Suppress the committed record before cache work. A stale refetch cannot resurrect its
      // delete action while the authoritative query is catching up.
      onDeleted(snapshot.userQuestId);
      setConfirmedQuest(null);
      void utils.quests.getUserQuests.invalidate({ userId: snapshot.userId });
    } catch (error) {
      // The global handler owns ordinary tRPC errors. A transient failure remains locally
      // actionable. Close and refresh because this endpoint has no replay key.
      if (error instanceof Error && isRetryableTrpcError(error)) {
        showMutationToast({
          success: false,
          message: "The deletion outcome is unknown. Refresh before trying again.",
        });
      }
      setConfirmedQuest(null);
      void utils.quests.getUserQuests.invalidate({ userId: snapshot.userId });
    } finally {
      if (requestRef.current === snapshot) {
        requestRef.current = null;
        setIsPending(false);
        onPendingChange?.(false);
      }
    }
  };

  const status = confirmedQuest ? questRecordStatus(confirmedQuest) : null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        aria-label={`Delete ${userQuest.quest.name} quest record from ${username}`}
        disabled={isPending}
        onClick={openConfirmation}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {confirmedQuest && (
        <Modal
          id={`delete-user-quest-${confirmedQuest.userQuestId}`}
          title="Permanently delete quest record?"
          isOpen
          setIsOpen={(open) => {
            if (!open) setConfirmedQuest(null);
          }}
          proceed_label="Delete quest record"
          proceed_loading_label="Deleting"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          isLoading={isPending}
          keepOpenOnAccept
          onAccept={(event) => {
            event.preventDefault();
            void confirmDeletion(confirmedQuest);
          }}
        >
          <div className="space-y-3" aria-busy={isPending}>
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
              <p className="font-semibold text-red-700 dark:text-red-300">
                This permanently removes {confirmedQuest.questName} from
                {` ${confirmedQuest.username}`}&apos;s quest history.
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="font-medium">Type</dt>
                <dd>{confirmedQuest.questType}</dd>
                <dt className="font-medium">Status</dt>
                <dd>{status}</dd>
                <dt className="font-medium">Started</dt>
                <dd>{confirmedQuest.startedAt.toLocaleString()}</dd>
                <dt className="font-medium">History ID</dt>
                <dd>
                  <code className="break-all">{confirmedQuest.userQuestId}</code>
                </dd>
              </dl>
            </div>
            <p className="text-sm">
              The stored attempt/completion history and retry-period state for this
              quest will be reset. Any active tracker is removed, and this quest&apos;s
              active NPC slot is released. The quest may become available to start
              again.
            </p>
            <p className="text-muted-foreground text-sm">
              Rewards already granted, aggregate mission counters, and the user&apos;s
              global quest-finish time are not rolled back. Other quest records are
              unaffected.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
};

const EditUserComponent: React.FC<EditUserComponentProps> = ({
  userId,
  targetIsAi,
  profile,
  onUserQuestDeletionPendingChange,
}) => {
  // State
  const [jutsu, setJutsu] = useState<Jutsu | undefined>(undefined);
  const [selectedUserItemId, setSelectedUserItemId] = useState<string | undefined>(
    undefined,
  );
  const [showActive, setShowActive] = useState<string>("userData");
  const [selectedQuestType, setSelectedQuestType] = useState<string>("all");
  const [deletedUserQuestIds, setDeletedUserQuestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmedJutsuAdjustment, setConfirmedJutsuAdjustment] =
    useState<JutsuAdjustmentSnapshot | null>(null);
  const [isJutsuAdjustmentPending, setIsJutsuAdjustmentPending] = useState(false);
  const [committedJutsuAdjustments, setCommittedJutsuAdjustments] = useState<
    Map<string, CommittedJutsuAdjustment>
  >(() => new Map());
  const [confirmedItemAdjustment, setConfirmedItemAdjustment] =
    useState<ItemAdjustmentSnapshot | null>(null);
  const [isItemAdjustmentPending, setIsItemAdjustmentPending] = useState(false);
  const [committedItemLevels, setCommittedItemLevels] = useState<Map<string, number>>(
    () => new Map(),
  );
  const jutsuAdjustmentRequestRef = useRef<JutsuAdjustmentSnapshot | null>(null);
  const itemAdjustmentRequestRef = useRef<ItemAdjustmentSnapshot | null>(null);
  const currentTargetRef = useRef({
    userId,
    username: profile.username,
    isAi: targetIsAi,
  });
  const jutsuEditorTargetIdentityRef = useRef(`${userId}\u0000${profile.username}`);
  const itemEditorTargetIdentityRef = useRef(
    `${userId}\u0000${profile.username}\u0000${targetIsAi}`,
  );
  currentTargetRef.current = {
    userId,
    username: profile.username,
    isAi: targetIsAi,
  };
  const now = new Date();

  // Logged-in user – determines editing permissions
  const { data: currentUser } = useUserData();
  const userRole = currentUser?.role || "USER";
  // Roles limited to self-editing may not read another user's items
  const restrictedToSelf = canOnlyEditSelf(userRole) && currentUser?.userId !== userId;

  // Permission checks
  const perms = {
    canEditUsername: canEditUsername(userRole),
    canEditCustomTitle: canEditCustomTitle(userRole),
    canEditBloodline: canEditBloodline(userRole),
    canEditVillage: canEditVillage(userRole),
    canEditRank: canEditRank(userRole),
    canEditJutsus: canEditJutsus(userRole),
    canEditItems: canEditItems(userRole) && !restrictedToSelf,
    canEditStaffAccountFlag: canEditStaffAccountFlag(userRole),
    canEditQuests: canEditQuests(userRole),
    canEditUserRoles: canChangeUserRolesTo(userRole),
    canEditRankedLp: canEditRankedLp(userRole),
  } as const;

  const canEditSomething = Object.values(perms).some(Boolean);

  // tRPC utility
  const utils = api.useUtils();

  const { data: userQuests } = api.quests.getUserQuests.useQuery(
    { userId: userId },
    { enabled: perms.canEditQuests && !!userId },
  );

  // Get unique quest types
  const questTypes = userQuests
    ? Array.from(new Set(userQuests.map((q) => q.quest.questType).filter(Boolean)))
    : [];

  // Filter quests by type
  const filteredQuests = userQuests?.filter(
    (quest) =>
      !deletedUserQuestIds.has(quest.id) &&
      (selectedQuestType === "all" || quest.quest.questType === selectedQuestType),
  );

  // Mutations
  // Form handling – pass permissions so queries are conditionally executed inside hook
  const { form, formData, userJutsus, handleUserSubmit } = useUserEditForm(
    userId,
    profile,
    {
      canEditUsername: perms.canEditUsername,
      canEditCustomTitle: perms.canEditCustomTitle,
      canEditBloodline: perms.canEditBloodline,
      canEditVillage: perms.canEditVillage,
      canEditRank: perms.canEditRank,
      canEditJutsus: perms.canEditJutsus,
      canEditItems: perms.canEditItems,
      canEditStaffAccountFlag: perms.canEditStaffAccountFlag,
      canEditUserRoles: perms.canEditUserRoles,
      canEditRankedLp: perms.canEditRankedLp,
    },
  );

  // Jutsu-specific helpers
  const jutsuLevelForm = useForm<{ level: number; reskinId: string }>({
    defaultValues: {
      level: userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.level || 0,
      reskinId:
        userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.activeReskin?.id || "none",
    },
  });

  // Mutation for adjusting jutsu level
  const adjustJutsuLevel = api.jutsu.adjustUserJutsu.useMutation();

  // Staff item level editing
  const { data: userItems } = api.item.getPublicUserItems.useQuery(
    { userId },
    { enabled: perms.canEditItems && !!userId },
  );
  const itemLevelForm = useForm<{ level: number }>({
    defaultValues: { level: 1 },
  });
  const adjustItemLevel = api.item.adjustUserItem.useMutation();

  // Query all reskins for selected jutsu
  const { data: jutsuReskins } = api.jutsu.getReskinsForJutsu.useQuery(
    { jutsuId: jutsu?.id || "" },
    { enabled: perms.canEditJutsus && !!jutsu?.id },
  );

  // Note: reskin is applied via adjustJutsuLevel to keep a single update action

  // Derived – only relevant if jutsu editing is permitted
  const userJutsu = userJutsus?.find((uj) => uj.jutsuId === jutsu?.id);
  const committedJutsuAdjustment = userJutsu
    ? committedJutsuAdjustments.get(userJutsu.id)
    : undefined;
  const displayedJutsuLevel = committedJutsuAdjustment?.level ?? userJutsu?.level ?? 0;
  const displayedJutsuReskinId = committedJutsuAdjustment
    ? committedJutsuAdjustment.reskinId
    : (userJutsu?.activeReskin?.id ?? null);
  const displayedJutsuReskinName = committedJutsuAdjustment
    ? committedJutsuAdjustment.reskinName
    : (userJutsu?.activeReskin?.name ?? null);
  const allJutsus = userJutsus?.map((uj) => uj.jutsu);
  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    const displayedLevel =
      committedJutsuAdjustments.get(userJutsu.id)?.level ?? userJutsu.level;
    return {
      id: userJutsu.jutsuId,
      quantity:
        userJutsu.finishTraining && userJutsu.finishTraining > now
          ? displayedLevel - 1
          : displayedLevel,
    };
  });
  const hasJutsus = perms.canEditJutsus && userJutsus && userJutsus.length > 0;

  const displayedUserItems = useMemo(
    () =>
      userItems?.map((ui) => ({
        ...ui,
        level: committedItemLevels.get(ui.id) ?? ui.level,
      })),
    [userItems, committedItemLevels],
  );
  const selectedUserItem = displayedUserItems?.find(
    (ui) => ui.id === selectedUserItemId,
  );
  const allOwnedItems = displayedUserItems?.map((ui) => ({
    ...ui.item,
    id: ui.id,
    name:
      ui.quantity > 1
        ? `${ui.item.name} x${ui.quantity}`
        : ui.equipped !== "NONE"
          ? `${ui.item.name} [${ui.equipped}]`
          : ui.item.name,
  }));
  const userItemLevels = displayedUserItems?.map((ui) => ({
    id: ui.id,
    level: ui.level,
  }));
  const hasItems = perms.canEditItems && userItems && userItems.length > 0;

  // Update jutsu form default values when selected jutsu changes
  useEffect(() => {
    if (userJutsu) {
      jutsuLevelForm.reset({
        level: displayedJutsuLevel,
        reskinId: displayedJutsuReskinId || "none",
      });
    }
  }, [userJutsu, displayedJutsuLevel, displayedJutsuReskinId, jutsuLevelForm]);

  useEffect(() => {
    if (!userJutsus || committedJutsuAdjustments.size === 0) return;
    setCommittedJutsuAdjustments((current) => {
      let next: Map<string, CommittedJutsuAdjustment> | undefined;
      for (const [rowId, committed] of current) {
        const refreshed = userJutsus.find((row) => row.id === rowId);
        if (
          refreshed?.level === committed.level &&
          (refreshed.activeReskin?.id ?? null) === committed.reskinId
        ) {
          next ??= new Map(current);
          next.delete(rowId);
        }
      }
      return next ?? current;
    });
  }, [userJutsus, committedJutsuAdjustments.size]);

  useEffect(() => {
    const targetIdentity = `${userId}\u0000${profile.username}`;
    if (jutsuEditorTargetIdentityRef.current === targetIdentity) return;
    if (isJutsuAdjustmentPending) return;
    jutsuEditorTargetIdentityRef.current = targetIdentity;
    setConfirmedJutsuAdjustment(null);
    setJutsu(undefined);
    setCommittedJutsuAdjustments(new Map());
  }, [userId, profile.username, isJutsuAdjustmentPending]);

  useEffect(() => {
    if (!userItems || committedItemLevels.size === 0) return;
    setCommittedItemLevels((current) => {
      let next: Map<string, number> | undefined;
      for (const [rowId, committedLevel] of current) {
        if (userItems.find((row) => row.id === rowId)?.level === committedLevel) {
          next ??= new Map(current);
          next.delete(rowId);
        }
      }
      return next ?? current;
    });
  }, [userItems, committedItemLevels.size]);

  useEffect(() => {
    const targetIdentity = `${userId}\u0000${profile.username}\u0000${targetIsAi}`;
    if (itemEditorTargetIdentityRef.current === targetIdentity) return;
    if (isItemAdjustmentPending) return;
    itemEditorTargetIdentityRef.current = targetIdentity;
    setConfirmedItemAdjustment(null);
    setSelectedUserItemId(undefined);
    setCommittedItemLevels(new Map());
  }, [userId, profile.username, targetIsAi, isItemAdjustmentPending]);

  const reviewJutsuAdjustment = jutsuLevelForm.handleSubmit((data) => {
    if (!userJutsu || !jutsu || isJutsuAdjustmentPending) return;
    const newReskinId = data.reskinId === "none" ? null : data.reskinId;
    const newReskinName = newReskinId
      ? (jutsuReskins?.find((reskin) => reskin.id === newReskinId)?.name ?? null)
      : null;
    if (newReskinId && !newReskinName) {
      jutsuLevelForm.setError("reskinId", {
        message: "The selected reskin is no longer available",
      });
      return;
    }
    if (data.level === displayedJutsuLevel && newReskinId === displayedJutsuReskinId) {
      jutsuLevelForm.setError("level", {
        message: "Change the level or reskin before reviewing",
      });
      return;
    }

    setConfirmedJutsuAdjustment({
      userId,
      username: profile.username,
      isAi: targetIsAi,
      userJutsuId: userJutsu.id,
      jutsuId: jutsu.id,
      jutsuName: jutsu.name,
      previousLevel: displayedJutsuLevel,
      newLevel: data.level,
      previousReskinId: displayedJutsuReskinId,
      previousReskinName: displayedJutsuReskinName,
      newReskinId,
      newReskinName,
      equipped: userJutsu.equipped,
      finishTraining: userJutsu.finishTraining
        ? new Date(userJutsu.finishTraining)
        : null,
      requestId: crypto.randomUUID(),
    });
  });

  const confirmJutsuAdjustment = async (snapshot: JutsuAdjustmentSnapshot) => {
    if (jutsuAdjustmentRequestRef.current) return;
    // Claim this exact target, owned row and requested state before React exposes pending state.
    jutsuAdjustmentRequestRef.current = snapshot;
    setIsJutsuAdjustmentPending(true);
    try {
      const result = await adjustJutsuLevel.mutateAsync({
        userId: snapshot.userId,
        jutsuId: snapshot.jutsuId,
        level: snapshot.newLevel,
        reskinId: snapshot.newReskinId,
      });
      if (
        jutsuAdjustmentRequestRef.current !== snapshot ||
        currentTargetRef.current.userId !== snapshot.userId ||
        currentTargetRef.current.username !== snapshot.username
      ) {
        return;
      }

      if (!result.success) return showMutationToast(result);

      showMutationToast(result);
      // Overlay the exact committed row before refreshing. A stale query cannot put the old
      // level/reskin back into the form or count badge while the authoritative cache catches up.
      setCommittedJutsuAdjustments((current) => {
        const next = new Map(current);
        next.set(snapshot.userJutsuId, {
          level: snapshot.newLevel,
          reskinId: snapshot.newReskinId,
          reskinName: snapshot.newReskinName,
        });
        return next;
      });
      setConfirmedJutsuAdjustment(null);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: snapshot.userId }),
        utils.jutsu.getPublicUserJutsus.invalidate({ userId: snapshot.userId }),
      ]);
    } catch (error) {
      // Ordinary tRPC errors are shown by the global handler. Only suppressed transient errors
      // need a local message. Close and refresh because this endpoint has no replay key.
      if (error instanceof Error && isRetryableTrpcError(error)) {
        showMutationToast({
          success: false,
          message: "The adjustment outcome is unknown. Refresh before trying again.",
        });
      }
      setConfirmedJutsuAdjustment(null);
      void utils.jutsu.getPublicUserJutsus.invalidate({ userId: snapshot.userId });
    } finally {
      if (jutsuAdjustmentRequestRef.current === snapshot) {
        jutsuAdjustmentRequestRef.current = null;
        setIsJutsuAdjustmentPending(false);
      }
    }
  };

  const reviewItemAdjustment = itemLevelForm.handleSubmit((data) => {
    if (
      !selectedUserItem ||
      isItemAdjustmentPending ||
      itemAdjustmentRequestRef.current
    ) {
      return;
    }
    if (data.level === selectedUserItem.level) {
      itemLevelForm.setError("level", {
        message: "Change the level before reviewing",
      });
      return;
    }

    setConfirmedItemAdjustment({
      userId,
      username: profile.username,
      isAi: targetIsAi,
      userItemId: selectedUserItem.id,
      itemId: selectedUserItem.itemId,
      itemName: selectedUserItem.item.name,
      previousLevel: selectedUserItem.level,
      newLevel: data.level,
      quantity: selectedUserItem.quantity,
      experience: selectedUserItem.experience,
      equipped: selectedUserItem.equipped,
      durability: selectedUserItem.durability,
      dropChancePerc: selectedUserItem.dropChancePerc,
      storedAtHome: selectedUserItem.storedAtHome,
      isInAuction: selectedUserItem.isInAuction,
      activeVariantId: selectedUserItem.activeVariantId,
      craftingFinishedAt: selectedUserItem.craftingFinishedAt
        ? new Date(selectedUserItem.craftingFinishedAt)
        : null,
      imbuements: selectedUserItem.imbuements
        .map((imbuement) => ({
          id: imbuement.id,
          itemId: imbuement.imbuementItemId,
          itemName: imbuement.item.name,
          craftingFinishedAt: new Date(imbuement.craftingFinishedAt),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      requestId: crypto.randomUUID(),
    });
  });

  const confirmItemAdjustment = async (snapshot: ItemAdjustmentSnapshot) => {
    // Claim the exact target, row and absolute value synchronously. React's mutation state is
    // not visible until the next render, so this closes the double-click/Enter race.
    if (itemAdjustmentRequestRef.current) return;
    itemAdjustmentRequestRef.current = snapshot;
    setIsItemAdjustmentPending(true);
    try {
      const result = await adjustItemLevel.mutateAsync({
        userId: snapshot.userId,
        userItemId: snapshot.userItemId,
        level: snapshot.newLevel,
      });
      if (
        itemAdjustmentRequestRef.current !== snapshot ||
        currentTargetRef.current.userId !== snapshot.userId ||
        currentTargetRef.current.username !== snapshot.username ||
        currentTargetRef.current.isAi !== snapshot.isAi
      ) {
        return;
      }

      if (!result.success) return showMutationToast(result);

      showMutationToast(result);
      // Publish the authoritative level immediately. A stale refetch cannot put the old level
      // back on the tile/form while the item query catches up.
      setCommittedItemLevels((current) => {
        const next = new Map(current);
        next.set(snapshot.userItemId, snapshot.newLevel);
        return next;
      });
      setConfirmedItemAdjustment(null);
      void utils.item.getPublicUserItems.invalidate({ userId: snapshot.userId });
    } catch (error) {
      // Ordinary tRPC errors are shown globally. Suppressed transient failures get one local,
      // actionable message. Close and refresh because this endpoint has no replay key.
      if (error instanceof Error && isRetryableTrpcError(error)) {
        showMutationToast({
          success: false,
          message: "The adjustment outcome is unknown. Refresh before trying again.",
        });
      }
      setConfirmedItemAdjustment(null);
      void utils.item.getPublicUserItems.invalidate({ userId: snapshot.userId });
    } finally {
      if (itemAdjustmentRequestRef.current === snapshot) {
        itemAdjustmentRequestRef.current = null;
        setIsItemAdjustmentPending(false);
      }
    }
  };

  useEffect(() => {
    if (selectedUserItem) {
      itemLevelForm.reset({ level: selectedUserItem.level });
    }
  }, [selectedUserItem, itemLevelForm]);

  // Cases where we don't render anything
  if (!currentUser) return null;
  if (!canEditSomething) return null;

  return (
    <Tabs
      defaultValue={showActive}
      className="flex flex-col items-center justify-center"
      onValueChange={(value) => setShowActive(value)}
    >
      <TabsList className="mt-3 text-center">
        <TabsTrigger value="userData">Main Data</TabsTrigger>
        {hasJutsus && <TabsTrigger value="jutsus">Jutsus Specifics</TabsTrigger>}
        {hasItems && <TabsTrigger value="items">Items Specifics</TabsTrigger>}
        {perms.canEditQuests && <TabsTrigger value="quests">Quests</TabsTrigger>}
      </TabsList>
      <TabsContent value="userData">
        <EditContent
          schema={updateUserSchema}
          form={form as unknown as UseFormReturn<UpdateUserSchema>}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save to Database"
          type="ai"
          relationId={userId}
          allowImageUpload={true}
          onAccept={handleUserSubmit}
        />
      </TabsContent>
      {hasJutsus && (
        <TabsContent value="jutsus">
          <div
            className={isJutsuAdjustmentPending ? "pointer-events-none opacity-60" : ""}
            aria-busy={isJutsuAdjustmentPending}
          >
            <div className="mt-5">
              <ActionSelector
                items={allJutsus}
                counts={userJutsuCounts}
                selectedId={jutsu?.id}
                labelSingles={true}
                emptyText="No jutsus assigned to this user"
                gridClassNameOverwrite="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12"
                onClick={(id) => {
                  if (isJutsuAdjustmentPending || jutsuAdjustmentRequestRef.current)
                    return;
                  if (id === jutsu?.id) {
                    setJutsu(undefined);
                  } else {
                    setJutsu(allJutsus?.find((jutsu) => jutsu.id === id));
                  }
                }}
                showBgColor={false}
                showLabels={true}
              />
            </div>
            {jutsu && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <Form {...jutsuLevelForm}>
                    <form
                      onSubmit={reviewJutsuAdjustment}
                      className="flex w-full items-center justify-between gap-2"
                    >
                      <fieldset
                        disabled={isJutsuAdjustmentPending}
                        className="flex items-end gap-2"
                      >
                        <FormField
                          control={jutsuLevelForm.control}
                          name="level"
                          rules={{
                            required: "A jutsu level is required",
                            min: { value: 0, message: "Level cannot be below 0" },
                            max: { value: 25, message: "Level cannot exceed 25" },
                            validate: (value) =>
                              Number.isInteger(value) || "Level must be a whole number",
                          }}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Level</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  className="w-20"
                                  min={0}
                                  max={25}
                                  step={1}
                                  disabled={isJutsuAdjustmentPending}
                                  {...field}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value ? Number(value) : 0);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {perms.canEditJutsus && (
                          <FormField
                            control={jutsuLevelForm.control}
                            name="reskinId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Reskin</FormLabel>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  disabled={isJutsuAdjustmentPending}
                                >
                                  <SelectTrigger className="w-56">
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {jutsuReskins?.map((r) => (
                                      <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <Button type="submit" disabled={isJutsuAdjustmentPending}>
                          Review adjustment
                        </Button>
                      </fieldset>
                    </form>
                  </Form>
                </div>
              </div>
            )}
          </div>

          {confirmedJutsuAdjustment && (
            <Modal
              id={`adjust-user-jutsu-${confirmedJutsuAdjustment.userJutsuId}`}
              title="Review jutsu adjustment"
              isOpen
              setIsOpen={(open) => {
                if (!open && !isJutsuAdjustmentPending) {
                  setConfirmedJutsuAdjustment(null);
                }
              }}
              proceed_label="Adjust jutsu"
              proceed_loading_label="Adjusting"
              isLoading={isJutsuAdjustmentPending}
              keepOpenOnAccept
              onAccept={(event) => {
                event.preventDefault();
                void confirmJutsuAdjustment(confirmedJutsuAdjustment);
              }}
            >
              <div className="space-y-3" aria-busy={isJutsuAdjustmentPending}>
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
                  <p className="font-semibold">
                    {confirmedJutsuAdjustment.jutsuName} for{" "}
                    {confirmedJutsuAdjustment.username}
                    {confirmedJutsuAdjustment.isAi ? " (AI)" : ""}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Target user ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.userId}
                      </code>
                    </dd>
                    <dt className="font-medium">Owned row ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.userJutsuId}
                      </code>
                    </dd>
                    <dt className="font-medium">Jutsu ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.jutsuId}
                      </code>
                    </dd>
                    <dt className="font-medium">Level</dt>
                    <dd>
                      {confirmedJutsuAdjustment.previousLevel} →{" "}
                      {confirmedJutsuAdjustment.newLevel}
                    </dd>
                    <dt className="font-medium">Reskin</dt>
                    <dd>
                      {confirmedJutsuAdjustment.previousReskinName ?? "None"} →{" "}
                      {confirmedJutsuAdjustment.newReskinName ?? "None"}
                    </dd>
                  </dl>
                </div>
                <p className="text-sm">
                  This sets the stored level and reskin to the values above. It does not
                  add a relative level increment.
                </p>
                <p className="text-muted-foreground text-sm">
                  Equipped/loadout assignments, experience, and training progress are
                  not changed.
                </p>
                {confirmedJutsuAdjustment.finishTraining &&
                  confirmedJutsuAdjustment.finishTraining > now && (
                    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                      This jutsu is training until{" "}
                      {confirmedJutsuAdjustment.finishTraining.toLocaleString()}. The
                      adjustment will not finish or cancel that training.
                    </p>
                  )}
                {confirmedJutsuAdjustment.equipped && (
                  <p className="text-muted-foreground text-sm">
                    This jutsu is currently equipped; its equipped state remains
                    unchanged.
                  </p>
                )}
              </div>
            </Modal>
          )}
        </TabsContent>
      )}
      {hasItems && (
        <TabsContent value="items">
          <div
            className={isItemAdjustmentPending ? "pointer-events-none opacity-60" : ""}
            aria-busy={isItemAdjustmentPending}
          >
            <div className="mt-5">
              <ActionSelector
                items={allOwnedItems}
                levels={userItemLevels}
                selectedId={selectedUserItemId}
                emptyText="No items assigned to this user"
                gridClassNameOverwrite="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12"
                onClick={(id) => {
                  if (isItemAdjustmentPending || itemAdjustmentRequestRef.current)
                    return;
                  setSelectedUserItemId(id === selectedUserItemId ? undefined : id);
                }}
                showBgColor={false}
                showLabels={true}
              />
            </div>
            {selectedUserItem && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <Form {...itemLevelForm}>
                    <form
                      onSubmit={reviewItemAdjustment}
                      className="flex w-full items-center justify-between gap-2"
                    >
                      <fieldset
                        disabled={isItemAdjustmentPending}
                        className="flex items-end gap-2"
                      >
                        <FormField
                          control={itemLevelForm.control}
                          name="level"
                          rules={{
                            required: "An item level is required",
                            min: { value: 1, message: "Level cannot be below 1" },
                            max: {
                              value: ITEM_LEVEL_CAP,
                              message: `Level cannot exceed ${ITEM_LEVEL_CAP}`,
                            },
                            validate: (value) =>
                              Number.isInteger(value) || "Level must be a whole number",
                          }}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Level</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  className="w-20"
                                  min={1}
                                  max={ITEM_LEVEL_CAP}
                                  step={1}
                                  disabled={isItemAdjustmentPending}
                                  {...field}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value ? Number(value) : 1);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" disabled={isItemAdjustmentPending}>
                          Review adjustment
                        </Button>
                      </fieldset>
                    </form>
                  </Form>
                </div>
              </div>
            )}
          </div>

          {confirmedItemAdjustment && (
            <Modal
              id={`adjust-user-item-${confirmedItemAdjustment.userItemId}`}
              title="Review item adjustment"
              isOpen
              setIsOpen={(open) => {
                if (!open && !isItemAdjustmentPending) {
                  setConfirmedItemAdjustment(null);
                }
              }}
              proceed_label="Adjust item"
              proceed_loading_label="Adjusting"
              isLoading={isItemAdjustmentPending}
              keepOpenOnAccept
              onAccept={(event) => {
                event.preventDefault();
                void confirmItemAdjustment(confirmedItemAdjustment);
              }}
            >
              <div className="space-y-3" aria-busy={isItemAdjustmentPending}>
                <p className="sr-only" aria-live="polite">
                  {isItemAdjustmentPending ? "Adjusting" : ""}
                </p>
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
                  <p className="font-semibold">
                    {confirmedItemAdjustment.itemName} for{" "}
                    {confirmedItemAdjustment.username}
                    {confirmedItemAdjustment.isAi ? " (AI)" : ""}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Target user ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.userId}
                      </code>
                    </dd>
                    <dt className="font-medium">Owned row ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.userItemId}
                      </code>
                    </dd>
                    <dt className="font-medium">Base item ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.itemId}
                      </code>
                    </dd>
                    <dt className="font-medium">Level</dt>
                    <dd>
                      {confirmedItemAdjustment.previousLevel} →{" "}
                      {confirmedItemAdjustment.newLevel}
                    </dd>
                    <dt className="font-medium">Quantity</dt>
                    <dd>{confirmedItemAdjustment.quantity}</dd>
                    <dt className="font-medium">Experience</dt>
                    <dd>{confirmedItemAdjustment.experience}</dd>
                    <dt className="font-medium">Equipped</dt>
                    <dd>{confirmedItemAdjustment.equipped}</dd>
                    <dt className="font-medium">Durability</dt>
                    <dd>{confirmedItemAdjustment.durability}</dd>
                    <dt className="font-medium">Drop chance</dt>
                    <dd>{confirmedItemAdjustment.dropChancePerc}%</dd>
                    <dt className="font-medium">Variant</dt>
                    <dd>{confirmedItemAdjustment.activeVariantId ?? "None"}</dd>
                    <dt className="font-medium">Storage</dt>
                    <dd>
                      {confirmedItemAdjustment.storedAtHome ? "At home" : "Carried"}
                    </dd>
                  </dl>
                </div>
                <p className="text-sm">
                  This sets the level on this exact owned row to the value above. It is
                  an absolute value, not a relative increment.
                </p>
                <p className="text-muted-foreground text-sm">
                  Quantity, experience, equipment/loadout assignment, durability, drop
                  chance, storage, variant, crafting state, auction state, and
                  imbuements are preserved.
                </p>
                {confirmedItemAdjustment.quantity > 1 && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This row is a stack of {confirmedItemAdjustment.quantity}. The level
                    applies to the entire owned stack row.
                  </p>
                )}
                {confirmedItemAdjustment.equipped !== "NONE" && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This item is currently equipped in{" "}
                    {confirmedItemAdjustment.equipped}; its assignment is unchanged.
                  </p>
                )}
                {confirmedItemAdjustment.isInAuction && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This exact row is currently listed for sale. The listing remains
                    active and will reflect the adjusted level.
                  </p>
                )}
                {confirmedItemAdjustment.craftingFinishedAt && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This item has crafting state ending{" "}
                    {confirmedItemAdjustment.craftingFinishedAt.toLocaleString()}; the
                    timer is unchanged.
                  </p>
                )}
                {confirmedItemAdjustment.imbuements.length > 0 && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    <p>
                      Imbuements remain unchanged (
                      {confirmedItemAdjustment.imbuements.length}):
                    </p>
                    <ul className="list-disc pl-5">
                      {confirmedItemAdjustment.imbuements.map((imbuement) => (
                        <li key={imbuement.id}>
                          {imbuement.itemName} ({imbuement.id})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Modal>
          )}
        </TabsContent>
      )}
      {perms.canEditQuests && (
        <TabsContent value="quests">
          <div className="mt-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">User Quests</h3>
              {questTypes.length > 0 && (
                <select
                  className="rounded-md border border-border bg-card px-3 py-1 text-foreground"
                  value={selectedQuestType}
                  onChange={(e) => setSelectedQuestType(e.target.value)}
                >
                  <option value="all">All Quest Types</option>
                  {questTypes.map((type, i) => (
                    <option key={`${type}-${i}`} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {filteredQuests && filteredQuests.length > 0 ? (
              <div className="space-y-2">
                {filteredQuests.map((userQuest) => (
                  <div
                    key={userQuest.id}
                    className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-3"
                  >
                    <div>
                      <h4 className="font-semibold text-foreground">
                        {userQuest.quest.name}
                      </h4>
                      <p className="text-muted-foreground text-sm">
                        Started: {userQuest.startedAt.toLocaleString()}
                        {userQuest.endAt &&
                          ` • Completed: ${userQuest.endAt.toLocaleString()}`}
                      </p>
                      {userQuest.quest.questType && (
                        <p className="text-muted-foreground text-sm">
                          Type: {userQuest.quest.questType}
                        </p>
                      )}
                    </div>
                    <DeleteUserQuestControl
                      userId={userId}
                      username={profile.username}
                      userQuest={userQuest}
                      onPendingChange={onUserQuestDeletionPendingChange}
                      onDeleted={(userQuestId) =>
                        setDeletedUserQuestIds((current) => {
                          const next = new Set(current);
                          next.add(userQuestId);
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                No quests found for this user.
              </p>
            )}
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
};

interface UpdateUserIdButtonProps {
  userId: string;
  username: string;
  updateUserIdMutation: ReturnType<typeof api.staff.updateUserId.useMutation>;
}

const UpdateUserIdButton: React.FC<UpdateUserIdButtonProps> = ({
  userId,
  username,
  updateUserIdMutation,
}) => {
  const router = useRouter();
  const utils = api.useUtils();
  const requestRef = useRef<{
    userId: string;
    username: string;
    newUserId: string;
  } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [modalVersion, setModalVersion] = useState(0);
  const [committedSourceId, setCommittedSourceId] = useState<string | null>(null);

  const userIdForm = useForm<{ newUserId: string }>({
    mode: "onChange",
    defaultValues: {
      newUserId: userId,
    },
  });
  const requestedId = userIdForm.watch("newUserId").trim();

  const handleUpdateUserId = userIdForm.handleSubmit(async (data) => {
    if (requestRef.current || committedSourceId === userId) return;
    const request = {
      userId,
      username,
      newUserId: data.newUserId.trim(),
    };

    // Mutation state reaches React after this event. Claim the exact old/new pair synchronously
    // so click + Enter cannot launch two identity migrations in the same tick.
    requestRef.current = request;
    setIsPending(true);
    try {
      const result = await updateUserIdMutation.mutateAsync({
        userId: request.userId,
        newUserId: request.newUserId,
      });
      if (requestRef.current !== request) return;

      showMutationToast(result);
      if (!result.success) return;

      // The old identity no longer exists. Suppress this stale action and close the confirmation
      // before cache/network work; every later move requires a fresh profile and confirmation.
      setCommittedSourceId(request.userId);
      setModalVersion((version) => version + 1);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: request.userId }),
        utils.profile.getPublicUser.invalidate({ userId: request.newUserId }),
        utils.profile.getPublicUsers.invalidate(),
        utils.profile.getUser.invalidate(),
      ]);
      router.replace(`/userid/${encodeURIComponent(request.newUserId)}`);
    } catch (error) {
      // Non-transient tRPC errors are reported by the global mutation handler. Transient errors
      // are locally actionable and retain the exact old/new pair in the open form for retry.
      if (error instanceof Error && isRetryableTrpcError(error)) {
        showMutationToast({
          success: false,
          message: "Could not update the user ID. Check your connection and try again.",
        });
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setIsPending(false);
      }
    }
  });

  if (committedSourceId === userId) return null;

  return (
    <Confirm
      key={modalVersion}
      id="update-user-id"
      title="Update User ID"
      proceed_label="Update user ID"
      proceed_loading_label="Updating"
      button={<IdCard className="h-6 w-6 cursor-pointer hover:text-orange-500" />}
      onAccept={handleUpdateUserId}
      isValid={
        userIdForm.formState.isValid && requestedId.length > 0 && requestedId !== userId
      }
      isLoading={isPending}
      keepOpenOnAccept
      disabled={isPending}
      confirmClassName="bg-red-600 text-white hover:bg-red-700"
    >
      <Form {...userIdForm}>
        <form className="space-y-4" aria-busy={isPending}>
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
            <p className="font-semibold text-red-700 dark:text-red-300">
              This changes the application identity for {username}.
            </p>
            <p className="text-sm">
              Current user ID: <code className="break-all">{userId}</code>
            </p>
            <p className="text-muted-foreground text-sm">
              All application records will move to the new ID. The old Clerk account
              will stop opening this character, and the server cannot verify that the
              new Clerk account exists or belongs to the intended person. This action
              cannot be undone from this screen.
            </p>
          </div>
          <FormField
            control={userIdForm.control}
            name="newUserId"
            rules={{
              required: "A new user ID is required",
              maxLength: { value: 191, message: "User ID is too long" },
              pattern: {
                value: /^[A-Za-z0-9_-]+$/,
                message: "Use only letters, numbers, underscores, and hyphens",
              },
              validate: (value) =>
                value.trim() !== userId || "The new user ID must be different",
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>New Clerk user ID</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    disabled={isPending}
                    aria-describedby="update-user-id-consequence"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p id="update-user-id-consequence" className="text-muted-foreground text-xs">
            Confirm that the destination ID was copied from the intended Clerk account.
          </p>
        </form>
      </Form>
    </Confirm>
  );
};

interface TrainingStatsComponentProps {
  userId: string;
  isActive: boolean;
}

/** The x axis of the training log: one point per hour of the day. */
const HOURS_OF_DAY = [...Array(24).keys()];

const UserTrainingLog: React.FC<TrainingStatsComponentProps> = ({
  userId,
  isActive,
}) => {
  // State
  const chartRef = useRef<HTMLCanvasElement>(null);
  const activeLayout = useActiveLayout();
  /** A deferred chunk can 404 after a deploy, and an empty box explains nothing. */
  const [chartFailed, setChartFailed] = useState(false);

  // Query
  const { data: logEntries } = api.train.getTrainingLog.useQuery(
    { userId },
    { enabled: isActive },
  );

  /**
   * Create dataset for each training speed. Memoized because the draw effect below depends on
   * it: rebuilt on every render it would destroy the chart and start a fresh async draw each
   * time, and the canvas is left blank whenever a cleanup lands after the draw it preceded.
   */
  const datasets = useMemo(() => {
    if (!logEntries) return undefined;
    return TrainingSpeeds.map((speed) => {
      const hourlyEvents = groupBy(
        logEntries
          .filter((e) => e.speed === speed)
          .map((e) => ({
            ...e,
            hourAtDay: e.trainingFinishedAt.getHours(),
          })),
        "hourAtDay",
      );
      return {
        label: speed,
        data: HOURS_OF_DAY.map((i) => {
          const entries = hourlyEvents.get(i) || [];
          return {
            x: i,
            y: entries.length || 0,
            entries: entries,
          };
        }),
      };
    });
  }, [logEntries]);

  // Create chart
  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && datasets) {
      // chart.js/auto registers every controller so nothing tree-shakes it, and this is one
      // tab among several on a page most visitors land on. Fetched when the log is actually
      // drawn instead of with the page.
      // Only destroy() is ever called on it, and chart.js's own generics do not accept the
      // custom {x, y, entries} points this dataset uses
      let chart: { destroy: () => void } | undefined;
      let cancelled = false;
      void (async () => {
        let Chart: typeof import("chart.js/auto").Chart;
        try {
          Chart = (await import("chart.js/auto")).Chart;
        } catch (error) {
          console.error("Could not load the charting library", error);
          if (!cancelled) setChartFailed(true);
          return;
        }
        // The tab can close, or the theme change, while the import is in flight
        if (cancelled) return;
        // Update stats chart
        const chartTextColor = getEffectiveThemeTextColor(activeLayout);
        Chart.defaults.color = chartTextColor;
        try {
          chart = new Chart(ctx, {
            type: "bar",
            options: {
              maintainAspectRatio: false,
              responsive: true,
              aspectRatio: 1.1,
              scales: {
                y: {
                  beginAtZero: true,
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                  ticks: {
                    color: chartTextColor,
                    stepSize: 1,
                  },
                  title: {
                    display: false,
                    text: "#Events",
                  },
                  stacked: true,
                },
                x: {
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                  stacked: true,
                  ticks: { color: chartTextColor },
                  title: {
                    display: true,
                    color: chartTextColor,
                    text: "Hour of Day",
                  },
                },
              },
              plugins: {
                legend: {
                  position: "bottom",
                  display: true,
                },
                tooltip: {
                  callbacks: {
                    title: (tooltipItems) =>
                      `Training at hour ${tooltipItems?.[0]?.label || "unknown"}`,
                    label: (tooltipItems) => {
                      const raw = tooltipItems?.raw as {
                        entries: { trainingFinishedAt: string }[];
                      };
                      return (
                        raw.entries?.map((e) =>
                          new Date(e.trainingFinishedAt).toLocaleString(),
                        ) || []
                      );
                    },
                  },
                },
              },
            },
            data: {
              labels: HOURS_OF_DAY,
              datasets: datasets,
            },
          });
        } catch (error) {
          console.error("Could not draw the training chart", error);
          if (!cancelled) setChartFailed(true);
        }
      })();

      // Remove on unmount
      return () => {
        cancelled = true;
        chart?.destroy();
      };
    }
  }, [activeLayout, datasets]);

  return (
    <ContentBox
      title="Training Log"
      subtitle="User activity last 7 days"
      initialBreak={true}
    >
      <div className="relative w-[99%] p-3">
        {chartFailed ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            The training chart could not be loaded.
          </p>
        ) : (
          <canvas ref={chartRef} id="chart"></canvas>
        )}
      </div>
    </ContentBox>
  );
};

// ---------------- TAB COMPONENTS: Lazy-loaded queries ----------------

interface TabComponentProps {
  userId: string;
  isActive: boolean;
}

const ReportsTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: currentUser } = useUserData();
  const canSeeSecrets = currentUser && canSeeSecretData(currentUser.role);

  const { data: reports, isPending } = api.reports.getUserReports.useQuery(
    { userId },
    { enabled: isActive && !!canSeeSecrets },
  );

  if (!canSeeSecrets) return null;

  return (
    <ContentBox
      title="Reports"
      subtitle="Reports against this user"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching User Reports" />}
      {reports?.length === 0 && <p>No reports found</p>}
      {reports?.map((report) => (
        <Link key={`report-${report.id}`} href={`/reports/${report.id}`}>
          <Post
            title={`${report.reporterUser?.username} on ${report.system}`}
            hover_effect={true}
            align_middle={true}
            image={
              <div className="m-3 w-16">
                {report.reporterUser?.avatar && (
                  <Image
                    src={report.reporterUser.avatar}
                    width={100}
                    height={100}
                    alt="Reporter Avatar"
                  />
                )}
              </div>
            }
          >
            {parseHtml(report.reason)}
            <b>Status:</b> {report.status.toLowerCase()}
          </Post>
        </Link>
      ))}
    </ContentBox>
  );
};

const HistoricalIpsTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: currentUser } = useUserData();
  const canSeeIpsPerm = currentUser && canSeeIps(currentUser.role);

  const { data: historicalIps, isPending } = api.staff.getUserHistoricalIps.useQuery(
    { userId },
    { enabled: isActive && !!canSeeIpsPerm },
  );

  if (!canSeeIpsPerm) return null;

  return (
    <ContentBox
      title="Historical IPs"
      subtitle="IP addresses used the last 90 days"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching Historical IPs" />}
      {historicalIps?.length === 0 && <p>No historical IP records found</p>}
      {historicalIps && historicalIps.length > 0 && (
        <div className="space-y-2">
          {historicalIps.map((ip) => (
            <div
              key={ip.ip}
              className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-3"
            >
              <div>
                <h4 className="font-semibold text-foreground">
                  <Link
                    href={`/users/ipsearch/${ip.ip}`}
                    className="hover:cursor-pointer hover:text-orange-500"
                  >
                    {ip.ip}
                  </Link>
                </h4>
                <p className="text-muted-foreground text-sm">
                  Last used: {ip.usedAt.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

const ActivityEventsTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: currentUser } = useUserData();
  const canSeeEvents = currentUser && canSeeActivityEvents(currentUser.role);

  const { data: activityEvents, isPending } = api.staff.getUserActivityEvents.useQuery(
    { userId },
    { enabled: isActive && !!canSeeEvents },
  );

  if (!canSeeEvents) return null;

  return (
    <ContentBox
      title="Activity Events"
      subtitle="Latest claimed activity events"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching Activity Events" />}
      {activityEvents?.length === 0 && <p>No activity events found</p>}
      {activityEvents && activityEvents.length > 0 && (
        <div className="space-y-2">
          {activityEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border-2 border-border bg-card p-3"
            >
              <h4 className="font-semibold text-foreground">
                Activity Event #{event.id}
              </h4>
              <p className="text-muted-foreground text-sm">Streak: {event.streak}</p>
              <p className="text-muted-foreground text-sm">
                Created: {event.createdAt.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

const BloodlineHistoryTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: currentUser } = useUserData();
  const canSeeSecrets = currentUser && canSeeSecretData(currentUser.role);

  const { data: bloodlineHistory, isPending } = api.logs.getBloodlineHistory.useQuery(
    { userId },
    { enabled: isActive && !!canSeeSecrets },
  );

  if (!canSeeSecrets) return null;

  return (
    <ContentBox
      title="Bloodline History"
      subtitle="All bloodlines this user has had"
      initialBreak={true}
      padding={false}
    >
      {isPending && <Loader explanation="Fetching Bloodline History" />}
      {bloodlineHistory?.length === 0 && (
        <p className="p-3">No bloodline history found</p>
      )}
      {bloodlineHistory && bloodlineHistory.length > 0 && (
        <Table
          data={bloodlineHistory}
          columns={[
            { key: "image", header: "Image", type: "avatar" },
            { key: "name", header: "Name", type: "string" },
            { key: "rank", header: "Rank", type: "capitalized" },
            { key: "type", header: "Roll Type", type: "capitalized" },
            { key: "createdAt", header: "Date", type: "date" },
          ]}
        />
      )}
    </ContentBox>
  );
};

// ---------------- Additional Tab Components ----------------

interface StudentsTabProps {
  students: Array<{
    userId: string;
    username: string;
    rank: UserRank;
    level: number;
    avatar: string | null;
    isOutlaw: boolean;
  }>;
}

const StudentsTab: React.FC<StudentsTabProps> = ({ students }) => {
  return (
    <ContentBox title="Students" subtitle="Past and present" initialBreak={true}>
      {(!students || students.length === 0) && <p>No students found</p>}
      {students && students.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {students.map((user) => (
            <Link
              href={`/username/${user.username}`}
              className="text-center"
              key={user.userId}
            >
              <AvatarImage
                href={user.avatar || ""}
                alt={user.username}
                userId={user.userId}
                hover_effect={true}
                priority={true}
                size={100}
              />
              <div>
                <div className="font-bold">{user.username}</div>
                <div>
                  Lvl. {user.level} {showUserRank(user)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

interface MarriagesTabProps extends TabComponentProps {
  username: string;
}

const MarriagesTab: React.FC<MarriagesTabProps> = ({ userId, username, isActive }) => {
  const { data: marriages, isPending } = api.marriage.getMarriedUsers.useQuery(
    { id: userId },
    { staleTime: 300000, enabled: isActive },
  );

  if (isPending) return <Loader explanation="Fetching Married Users" />;

  return (
    <ContentBox
      title="Married Users"
      subtitle={`${username} is married to these users`}
      initialBreak={true}
    >
      {(!marriages || marriages.length === 0) && <p>No married users found</p>}
      {marriages && marriages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {marriages.map((user) => (
            <Link
              href={`/username/${user.username}`}
              className="text-center"
              key={user.userId}
            >
              <AvatarImage
                href={user.avatar}
                alt={user.username}
                userId={user.userId}
                hover_effect={true}
                priority={true}
                size={100}
              />
              <div>
                <div className="font-bold">{user.username}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

interface BadgesTabProps {
  userId: string;
  username: string;
  currentBadges: (UserBadge & { badge: Badge })[];
}

type BadgeAssignmentSnapshot = {
  requestId: string;
  userId: string;
  username: string;
  badgeId: string;
  badgeName: string;
  badgeImage: string;
};

type BadgeRemovalSnapshot = {
  requestId: string;
  userId: string;
  username: string;
  badgeId: string;
  badgeName: string;
  badgeImage: string;
  assignmentCreatedAt: Date;
  assignmentKey: string;
};

const badgeAssignmentKey = (badgeId: string, createdAt: Date) =>
  `${badgeId}:${createdAt.toISOString()}`;

const BadgesTab: React.FC<BadgesTabProps> = ({ userId, username, currentBadges }) => {
  const { data: currentUser } = useUserData();
  const canModify = currentUser && canModifyUserBadges(currentUser.role);
  const canAssign =
    canModify && (!canOnlyEditSelf(currentUser.role) || currentUser.userId === userId);

  // Only fetch the list of all badges when the add-badge popover is opened
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [assignment, setAssignment] = useState<BadgeAssignmentSnapshot | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentPending, setAssignmentPending] = useState(false);
  const [assignmentNeedsRetry, setAssignmentNeedsRetry] = useState(false);
  const [removal, setRemoval] = useState<BadgeRemovalSnapshot | null>(null);
  const [removalOpen, setRemovalOpen] = useState(false);
  const [removalPending, setRemovalPending] = useState(false);
  const [removalNeedsRetry, setRemovalNeedsRetry] = useState(false);
  const [removedAssignments, setRemovedAssignments] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticBadges, setOptimisticBadges] = useState<
    Map<string, Pick<Badge, "id" | "name" | "image">>
  >(() => new Map());
  const assignmentRef = useRef<BadgeAssignmentSnapshot | null>(null);
  const removalRef = useRef<BadgeRemovalSnapshot | null>(null);
  const profileIdentityRef = useRef({ userId, username });
  profileIdentityRef.current = { userId, username };

  const { data: allBadges } = api.badge.getAllNames.useQuery(undefined, {
    enabled: popoverOpen,
  });

  const utils = api.useUtils();
  const insertUserBadge = api.staff.insertUserBadge.useMutation();

  const removeUserBadge = api.staff.removeUserBadge.useMutation();

  // Once an authoritative profile response contains an optimistic assignment, it no longer
  // needs a client overlay. Other optimistic badges remain independent.
  useEffect(() => {
    const currentIds = new Set(currentBadges.map((entry) => entry.badgeId));
    setOptimisticBadges((previous) => {
      const next = new Map(previous);
      for (const badgeId of currentIds) next.delete(badgeId);
      return next.size === previous.size ? previous : next;
    });
  }, [currentBadges]);

  // Keep a successful removal hidden while an invalidation can still return the old profile.
  // The tombstone is assignment-specific, so a newly re-awarded copy remains visible.
  useEffect(() => {
    const currentKeys = new Set(
      currentBadges.map((entry) => badgeAssignmentKey(entry.badgeId, entry.createdAt)),
    );
    setRemovedAssignments((previous) => {
      const next = new Set([...previous].filter((key) => currentKeys.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [currentBadges]);

  useEffect(() => {
    // A tab instance can be reused while navigating between profiles. Never let an unsubmitted
    // choice from the old profile become an assignment to the new one.
    if (!assignmentRef.current) {
      setAssignment(null);
      setAssignmentOpen(false);
      setAssignmentNeedsRetry(false);
    }
    setPopoverOpen(false);
    setOptimisticBadges(new Map());
    if (!removalRef.current) {
      setRemoval(null);
      setRemovalOpen(false);
      setRemovalNeedsRetry(false);
    }
    setRemovedAssignments(new Set());
  }, [userId, username]);

  const openBadgeAssignment = (badgeId: string) => {
    if (
      assignmentPending ||
      assignmentRef.current ||
      removalPending ||
      removalRef.current
    )
      return;
    const selectedBadge = allBadges?.find((entry) => entry.id === badgeId);
    if (!selectedBadge) return;

    setAssignment({
      requestId: crypto.randomUUID(),
      userId,
      username,
      badgeId: selectedBadge.id,
      badgeName: selectedBadge.name,
      badgeImage: selectedBadge.image,
    });
    setAssignmentNeedsRetry(false);
    setPopoverOpen(false);
    setAssignmentOpen(true);
  };

  const closeBadgeAssignment = () => {
    if (assignmentPending || assignmentRef.current) return;
    setAssignmentOpen(false);
    setAssignment(null);
    setAssignmentNeedsRetry(false);
  };

  const confirmBadgeAssignment = async () => {
    const target = assignment;
    // Mutation state updates on the next render; this ref closes the click/Enter same-tick gap.
    if (!target || assignmentRef.current || assignmentPending) return;

    assignmentRef.current = target;
    setAssignmentPending(true);
    try {
      const result = await insertUserBadge.mutateAsync({
        userId: target.userId,
        badgeId: target.badgeId,
      });
      if (assignmentRef.current !== target) return;

      if (!result.success) return showMutationToast(result);

      showMutationToast(result);
      if (
        profileIdentityRef.current.userId === target.userId &&
        profileIdentityRef.current.username === target.username
      ) {
        setOptimisticBadges((previous) => {
          const next = new Map(previous);
          next.set(target.badgeId, {
            id: target.badgeId,
            name: target.badgeName,
            image: target.badgeImage,
          });
          return next;
        });
      }
      setAssignmentOpen(false);
      setAssignment(null);
      setAssignmentNeedsRetry(false);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: target.userId }),
        utils.logs.getContentChanges.invalidate(),
      ]);
    } catch (error) {
      // The endpoint has no replay key, so block another assignment until the profile is checked.
      if (assignmentRef.current === target) {
        setAssignmentNeedsRetry(true);
        if (error instanceof Error && isRetryableTrpcError(error)) {
          showMutationToast({
            success: false,
            message:
              "The assignment outcome is unknown. Refresh the profile before trying again.",
          });
        }
      }
    } finally {
      if (assignmentRef.current === target) {
        assignmentRef.current = null;
        setAssignmentPending(false);
      }
    }
  };

  const openBadgeRemoval = (entry: UserBadge & { badge: Badge }) => {
    if (
      removalPending ||
      removalRef.current ||
      assignmentPending ||
      assignmentRef.current
    )
      return;

    setRemoval({
      requestId: crypto.randomUUID(),
      userId,
      username,
      badgeId: entry.badgeId,
      badgeName: entry.badge.name,
      badgeImage: entry.badge.image,
      assignmentCreatedAt: entry.createdAt,
      assignmentKey: badgeAssignmentKey(entry.badgeId, entry.createdAt),
    });
    setRemovalNeedsRetry(false);
    setPopoverOpen(false);
    setRemovalOpen(true);
  };

  const closeBadgeRemoval = () => {
    if (removalPending || removalRef.current) return;
    setRemovalOpen(false);
    setRemoval(null);
    setRemovalNeedsRetry(false);
  };

  const confirmBadgeRemoval = async () => {
    const target = removal;
    // React mutation state is not synchronous. The ref prevents a click and Enter in the same
    // event turn from issuing the same destructive request twice.
    if (!target || removalRef.current || removalPending) return;

    removalRef.current = target;
    setRemovalPending(true);
    try {
      const result = await removeUserBadge.mutateAsync({
        userId: target.userId,
        badgeId: target.badgeId,
      });
      if (removalRef.current !== target) return;

      if (!result.success) {
        setRemovalNeedsRetry(true);
        return showMutationToast(result);
      }

      showMutationToast(result);
      if (
        profileIdentityRef.current.userId === target.userId &&
        profileIdentityRef.current.username === target.username
      ) {
        setRemovedAssignments((previous) => {
          const next = new Set(previous);
          next.add(target.assignmentKey);
          return next;
        });
      }
      setRemovalOpen(false);
      setRemoval(null);
      setRemovalNeedsRetry(false);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({ userId: target.userId }),
        utils.logs.getContentChanges.invalidate(),
      ]);
    } catch (error) {
      if (removalRef.current === target) {
        setRemovalNeedsRetry(true);
        if (error instanceof Error && isRetryableTrpcError(error)) {
          showMutationToast({
            success: false,
            message:
              "The removal outcome is unknown. Refresh the profile before trying again.",
          });
        }
      }
    } finally {
      if (removalRef.current === target) {
        removalRef.current = null;
        setRemovalPending(false);
      }
    }
  };

  const currentBadgeIds = new Set(currentBadges.map((entry) => entry.badgeId));
  const displayedBadges = [
    ...currentBadges
      .filter(
        (entry) =>
          !removedAssignments.has(badgeAssignmentKey(entry.badgeId, entry.createdAt)),
      )
      .map((entry) => ({ badge: entry.badge, userBadge: entry })),
    ...[...optimisticBadges.values()]
      .filter((entry) => !currentBadgeIds.has(entry.id))
      .map((entry) => ({ badge: entry, userBadge: null })),
  ];
  const unavailableBadgeIds = new Set([...currentBadgeIds, ...optimisticBadges.keys()]);

  return (
    <>
      <ContentBox
        title="Achieved Badges"
        subtitle={`Badges earned by ${username}`}
        initialBreak={true}
        topRightContent={
          canAssign && (
            <Popover
              open={popoverOpen}
              onOpenChange={(open) => {
                if (
                  !assignmentPending &&
                  !assignmentRef.current &&
                  !removalPending &&
                  !removalRef.current
                )
                  setPopoverOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  className="w-full"
                  disabled={assignmentPending || removalPending}
                >
                  <Plus className="mr-2 h-6 w-6" /> New
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-[min(70vh,32rem)] w-96 overflow-y-auto">
                <div
                  aria-busy={assignmentPending}
                  className={
                    assignmentPending ? "pointer-events-none opacity-60" : undefined
                  }
                >
                  <ActionSelector
                    items={
                      allBadges
                        ? allBadges.filter(
                            (entry) => !unavailableBadgeIds.has(entry.id),
                          )
                        : []
                    }
                    labelSingles={true}
                    onClick={openBadgeAssignment}
                    showBgColor={false}
                    roundFull={true}
                    hideBorder={true}
                    gridClassNameOverwrite="grid grid-cols-5 md:grid-cols-6"
                    showLabels={true}
                    emptyText="No badges are available to add."
                  />
                </div>
              </PopoverContent>
            </Popover>
          )
        }
      >
        {displayedBadges.length === 0 && <p>No badges found</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {displayedBadges.map(({ badge: displayedBadge, userBadge }) => (
            <div key={displayedBadge.id} className="relative text-center">
              <Image
                src={displayedBadge.image}
                alt={displayedBadge.name}
                width={128}
                height={128}
              />
              <div>
                <div className="font-bold">{displayedBadge.name}</div>
              </div>
              {canAssign && userBadge && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${displayedBadge.name} from ${username}`}
                  disabled={
                    removalPending &&
                    removal?.assignmentKey ===
                      badgeAssignmentKey(userBadge.badgeId, userBadge.createdAt)
                  }
                  className="absolute top-0 right-[8%] h-9 w-9 rounded-full border-2 border-black bg-amber-100 p-0 hover:bg-amber-100"
                  onClick={() => openBadgeRemoval(userBadge)}
                >
                  <Trash2 className="h-7 w-7 fill-slate-500 p-1 hover:fill-orange-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </ContentBox>

      <Modal
        id="insert-user-badge"
        title="Add badge"
        isOpen={assignmentOpen}
        setIsOpen={(open) => {
          if (open) setAssignmentOpen(true);
          else closeBadgeAssignment();
        }}
        proceed_label="Add badge"
        proceed_loading_label="Adding"
        isLoading={assignmentPending}
        proceedDisabled={!assignment || assignmentNeedsRetry}
        keepOpenOnAccept
        onAccept={() => void confirmBadgeAssignment()}
        onClose={closeBadgeAssignment}
      >
        {assignment && (
          <div className="space-y-4" aria-busy={assignmentPending}>
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              <Image
                src={assignment.badgeImage}
                alt={assignment.badgeName}
                width={64}
                height={64}
              />
              <div>
                <p className="font-semibold">{assignment.badgeName}</p>
                <p className="text-muted-foreground text-sm">
                  Badge ID: <code className="break-all">{assignment.badgeId}</code>
                </p>
              </div>
            </div>
            <p>
              Add <strong>{assignment.badgeName}</strong> to{" "}
              <strong>{assignment.username}</strong>?
            </p>
            <p className="text-muted-foreground text-sm">
              Target user ID: <code className="break-all">{assignment.userId}</code>
            </p>
            {assignmentNeedsRetry && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                The previous response was not confirmed. Close this dialog and refresh
                the profile before attempting another assignment.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        id="remove-user-badge"
        title="Remove badge"
        isOpen={removalOpen}
        setIsOpen={(open) => {
          if (open) setRemovalOpen(true);
          else closeBadgeRemoval();
        }}
        proceed_label="Remove badge"
        proceed_loading_label="Removing"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={removalPending}
        proceedDisabled={!removal || removalNeedsRetry}
        keepOpenOnAccept
        onAccept={() => void confirmBadgeRemoval()}
        onClose={closeBadgeRemoval}
      >
        {removal && (
          <div className="space-y-4" aria-busy={removalPending}>
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              <Image
                src={removal.badgeImage}
                alt={removal.badgeName}
                width={64}
                height={64}
              />
              <div>
                <p className="font-semibold">{removal.badgeName}</p>
                <p className="text-muted-foreground text-sm">
                  Badge ID: <code className="break-all">{removal.badgeId}</code>
                </p>
              </div>
            </div>
            <p>
              Permanently remove <strong>{removal.badgeName}</strong> from{" "}
              <strong>{removal.username}</strong>?
            </p>
            <p className="text-muted-foreground text-sm">
              Target user ID: <code className="break-all">{removal.userId}</code>
            </p>
            <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              This removes the selected badge assignment immediately. It can only be
              restored by assigning the badge again.
            </p>
            {removalNeedsRetry && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                The previous response was not confirmed. Close this dialog and refresh
                the profile before attempting another removal.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

// ---------------- Recruited Users Tab ----------------

interface RecruitedUsersTabProps {
  recruits: Array<{
    userId: string;
    username: string;
    rank: UserRank;
    isOutlaw: boolean;
    level: number;
    avatar: string | null;
  }>;
  parentUserId: string;
  parentUsername: string;
  parentRecruitedCount: number;
}

const RecruitedUsersTab: React.FC<RecruitedUsersTabProps> = ({
  recruits,
  parentUserId,
  parentUsername,
  parentRecruitedCount,
}) => {
  const { data: currentUser } = useUserData();
  const canDelete = currentUser && canDeleteReferral(currentUser.role);
  const [removedRecruitIds, setRemovedRecruitIds] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleRecruits = recruits.filter(
    (recruit) => !removedRecruitIds.has(recruit.userId),
  );
  const displayedRecruiterCount = Math.max(
    parentRecruitedCount - removedRecruitIds.size,
    0,
  );

  return (
    <ContentBox
      title="Recruited Users"
      subtitle={`${parentUsername} referred these users`}
      initialBreak={true}
    >
      {visibleRecruits.length === 0 && <p>No recruits found</p>}
      {visibleRecruits.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {visibleRecruits.map((user) => (
            <div key={user.userId} className="relative text-center">
              <Link href={`/username/${user.username}`} className="block">
                <AvatarImage
                  href={user.avatar || ""}
                  alt={user.username}
                  userId={user.userId}
                  hover_effect={true}
                  priority={true}
                  size={100}
                />
                <div>
                  <div className="font-bold">{user.username}</div>
                  <div>
                    Lvl. {user.level} {showUserRank(user)}
                  </div>
                </div>
              </Link>
              {canDelete && (
                <RemoveReferralButton
                  recruit={user}
                  recruiterId={parentUserId}
                  recruiterUsername={parentUsername}
                  recruiterCount={displayedRecruiterCount}
                  onRemoved={(userId) =>
                    setRemovedRecruitIds((current) => {
                      if (current.has(userId)) return current;
                      return new Set(current).add(userId);
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

interface RemoveReferralButtonProps {
  recruit: RecruitedUsersTabProps["recruits"][number];
  recruiterId: string;
  recruiterUsername: string;
  recruiterCount: number;
  onRemoved: (userId: string) => void;
}

interface ReferralRemovalRequest {
  userId: string;
  expectedUsername: string;
  expectedRecruiterId: string;
  expectedRecruiterUsername: string;
  expectedRecruiterCount: number;
  requestId: string;
}

const RemoveReferralButton: React.FC<RemoveReferralButtonProps> = ({
  recruit,
  recruiterId,
  recruiterUsername,
  recruiterCount,
  onRemoved,
}) => {
  const utils = api.useUtils();
  const inFlightRef = useRef<ReferralRemovalRequest | null>(null);
  const [retryRequest, setRetryRequest] = useState<ReferralRemovalRequest | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [modalVersion, setModalVersion] = useState(0);
  const deleteReferral = api.staff.deleteReferral.useMutation();

  const handleRemove = async () => {
    if (inFlightRef.current) return;
    const request =
      retryRequest ??
      ({
        userId: recruit.userId,
        expectedUsername: recruit.username,
        expectedRecruiterId: recruiterId,
        expectedRecruiterUsername: recruiterUsername,
        expectedRecruiterCount: recruiterCount,
        requestId: crypto.randomUUID(),
      } satisfies ReferralRemovalRequest);

    // Mutation state updates after this event. Claim the exact relationship synchronously so a
    // double click cannot submit two destructive requests in the same tick.
    inFlightRef.current = request;
    setIsRemoving(true);
    try {
      const result = await deleteReferral.mutateAsync({ userId: request.userId });
      if (inFlightRef.current !== request) return;
      if (!result.success) {
        showMutationToast(result);
        setRetryRequest(request);
        return;
      }
      // The commit is authoritative. Remove only this captured row before cache/network work so
      // a slow or stale refresh cannot expose the destructive action for a second click.
      showMutationToast(result);
      setRetryRequest(null);
      onRemoved(request.userId);
      setModalVersion((version) => version + 1);
      void Promise.allSettled([
        utils.profile.getPublicUser.invalidate({
          userId: request.expectedRecruiterId,
        }),
        utils.profile.getPublicUsers.invalidate(),
      ]);
    } catch (error) {
      setRetryRequest(request);
      if (error instanceof Error && isRetryableTrpcError(error)) {
        showMutationToast({
          success: false,
          message:
            "The referral response was not confirmed. Refresh before trying again.",
        });
      }
    } finally {
      if (inFlightRef.current === request) {
        inFlightRef.current = null;
        setIsRemoving(false);
      }
    }
  };

  return (
    <Confirm
      key={modalVersion}
      id={`remove-referral-${recruit.userId}`}
      title="Remove referral relationship?"
      proceed_label="Remove referral"
      proceed_loading_label="Removing"
      button={
        <Trash2
          aria-label={`Remove ${recruit.username} as a referral`}
          className="absolute top-0 right-[8%] h-9 w-9 rounded-full border-2 border-black bg-red-100 fill-slate-500 p-1 hover:fill-red-500"
        />
      }
      onAccept={() => void handleRemove()}
      isLoading={isRemoving}
      keepOpenOnAccept
      disabled={isRemoving}
      confirmDisabled={Boolean(retryRequest)}
      confirmClassName="bg-red-600 text-white hover:bg-red-700"
    >
      <div className="space-y-3" aria-busy={isRemoving}>
        <p>
          Remove the referral relationship between <strong>{recruiterUsername}</strong>
          {" and "}
          <strong>{recruit.username}</strong>?
        </p>
        <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
          This permanently unlinks {recruit.username} from {recruiterUsername} and
          reduces {recruiterUsername}&apos;s recruited-user count from {recruiterCount}
          {" to "}
          {Math.max(recruiterCount - 1, 0)}. It does not delete either user.
        </p>
        {retryRequest && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            The previous response was not confirmed. Refresh the profile before trying
            again.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {isRemoving ? "Removing" : ""}
        </span>
      </div>
    </Confirm>
  );
};

// ---------------- Ranked Matches Tab ----------------

const RankedMatchesTab: React.FC<TabComponentProps> = ({
  userId,
  isActive: _isActive,
}) => {
  const { data: history, isPending } = api.combat.getBattleHistory.useQuery(
    {
      userId,
      combatTypes: ["RANKED_PVP"],
    },
    { enabled: _isActive },
  );

  const rankedMatches = history?.map((e) => ({
    attackerUsername: e.attacker?.username || "Deleted User",
    attackerUserId: e.attacker?.userId || "Deleted User",
    attackerAvatar: e.attacker?.avatar || IMG_AVATAR_DEFAULT,
    defenderUsername: e.defender?.username || "Deleted User",
    defenderUserId: e.defender?.userId || "Deleted User",
    defenderAvatar: e.defender?.avatar || IMG_AVATAR_DEFAULT,
    battleId: e.battleId,
    createdAt: e.createdAt,
  }));

  return (
    <ContentBox
      title="Ranked Match History"
      subtitle="All ranked PvP matches for this user"
      initialBreak={true}
      padding={false}
    >
      {isPending && <Loader explanation="Loading ranked matches..." />}
      {(!rankedMatches || rankedMatches.length === 0) && (
        <p className="p-3">No ranked matches found</p>
      )}
      {rankedMatches && rankedMatches.length > 0 && (
        <Table
          data={rankedMatches}
          columns={[
            { key: "attackerAvatar", header: "Attacker", type: "avatar" },
            { key: "defenderAvatar", header: "Defender", type: "avatar" },
            { key: "battleId", header: "Battle ID", type: "string" },
            { key: "createdAt", header: "Date", type: "date" },
          ]}
          linkPrefix="/battlelog/"
          linkColumn={"battleId"}
        />
      )}
    </ContentBox>
  );
};

// ---------------- Combat History Tab ----------------

const CombatHistoryTab: React.FC<TabComponentProps> = ({
  userId,
  isActive: _isActive,
}) => {
  const [selectedType, setSelectedType] = useState<string>("all");

  const { data: history, isPending } = api.combat.getBattleHistory.useQuery(
    {
      userId,
      combatTypes: selectedType === "all" ? undefined : [selectedType as BattleType],
    },
    { enabled: _isActive },
  );

  const combatHistory = history?.map((e) => ({
    attackerUsername: e.attacker?.username || "Deleted User",
    attackerUserId: e.attacker?.userId || "Deleted User",
    attackerAvatar: e.attacker?.avatar || IMG_AVATAR_DEFAULT,
    defenderUsername: e.defender?.username || "Deleted User",
    defenderUserId: e.defender?.userId || "Deleted User",
    defenderAvatar: e.defender?.avatar || IMG_AVATAR_DEFAULT,
    battleId: e.battleId,
    battleType: e.battleType || "Unknown",
    createdAt: e.createdAt,
  }));

  return (
    <ContentBox
      title="Combat History"
      subtitle="All combat encounters for this user"
      initialBreak={true}
      padding={false}
      topRightContent={
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {BattleTypes.map((type, i) => (
              <SelectItem key={`${type}-${i}`} value={type}>
                {type.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {isPending && <Loader explanation="Loading combat history..." />}
      {!isPending && (!combatHistory || combatHistory.length === 0) && (
        <p className="p-3">No combat history found</p>
      )}
      {combatHistory && combatHistory.length > 0 && (
        <Table
          data={combatHistory}
          columns={[
            { key: "attackerAvatar", header: "Attacker", type: "avatar" },
            { key: "defenderAvatar", header: "Defender", type: "avatar" },
            { key: "battleType", header: "Type", type: "capitalized" },
            { key: "createdAt", header: "Date", type: "date" },
          ]}
          linkPrefix="/battlelog/"
          linkColumn={"battleId"}
        />
      )}
    </ContentBox>
  );
};

interface BracketEligibilityBadgeProps {
  viewerExperience: number;
  viewerRank: UserRank;
  viewerWarParticipantUntil: Date;
  targetExperience: number;
  targetRank: UserRank;
  targetBracketImmunityLiftedUntil: Date;
  targetWarParticipantUntil: Date;
}

const BracketEligibilityBadge: React.FC<BracketEligibilityBadgeProps> = ({
  viewerExperience,
  viewerRank,
  viewerWarParticipantUntil,
  targetExperience,
  targetRank,
  targetBracketImmunityLiftedUntil,
  targetWarParticipantUntil,
}) => {
  const now = Date.now();
  const attackerBracket = getExpBracket(viewerExperience, viewerRank);
  const targetBracket = getExpBracket(targetExperience, targetRank);
  const immunityLifted = targetBracketImmunityLiftedUntil.getTime() > now;
  const bothWarParticipants =
    viewerWarParticipantUntil.getTime() > now &&
    targetWarParticipantUntil.getTime() > now;
  const viewerIsPvpRestricted = RANKS_RESTRICTED_FROM_PVP.includes(viewerRank);
  const targetIsPvpRestricted = RANKS_RESTRICTED_FROM_PVP.includes(targetRank);

  // Re-render when the next time window (immunity lift or war participation) elapses, so the badge
  // does not keep showing stale eligibility while the profile stays open past an expiry.
  const [, forceBadgeRefresh] = useState(0);
  const nextExpiry = Math.min(
    ...[
      targetBracketImmunityLiftedUntil.getTime(),
      viewerWarParticipantUntil.getTime(),
      targetWarParticipantUntil.getTime(),
    ].filter((t) => t > now),
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const id = setTimeout(
      () => forceBadgeRefresh((n) => n + 1),
      Math.max(0, nextExpiry - Date.now()),
    );
    return () => clearTimeout(id);
  }, [nextExpiry]);

  if (viewerIsPvpRestricted) {
    return (
      <p className="font-medium text-red-500 text-sm">
        ✗ Cannot attack (Academy students &amp; Genin cannot do PvP)
      </p>
    );
  }
  if (targetIsPvpRestricted) {
    return (
      <p className="font-medium text-red-500 text-sm">
        ✗ Protected (Academy students &amp; Genin cannot be attacked)
      </p>
    );
  }

  if (canAttackBracket(attackerBracket, targetBracket)) {
    return (
      <p className="font-medium text-green-600 text-sm">
        ✓ Bracket-eligible (they are in your bracket, one below, or higher — server-side
        checks still apply)
      </p>
    );
  }
  if (immunityLifted) {
    return (
      <p className="font-medium text-orange-500 text-sm">
        ✓ Bracket-eligible (their immunity is lifted — server-side checks still apply)
      </p>
    );
  }
  if (bothWarParticipants) {
    return (
      <p className="font-medium text-sm text-yellow-600">
        ~ May be attackable (both war participants — requires active village war, server
        decides)
      </p>
    );
  }
  return (
    <p className="font-medium text-red-500 text-sm">
      ✗ Protected (lower bracket — {targetBracket} vs your {attackerBracket})
    </p>
  );
};

interface AdjustSeichiSilverProps {
  userId: string;
  username: string;
}

const AdjustSeichiSilver: React.FC<AdjustSeichiSilverProps> = ({
  userId,
  username,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const utils = api.useUtils();
  const { data: currentSilver, isPending: silverLoading } =
    api.profile.getSeichiSilverForStaff.useQuery({ userId }, { enabled: isOpen });
  const trimmedDelta = delta.trim();
  const parsedDelta = Number(trimmedDelta);
  const isValid =
    // Plain signed integer only — rejects "1.5", "1e3", "", and whitespace so the
    // submitted value always matches what staff typed.
    /^-?\d+$/.test(trimmedDelta) &&
    Number.isSafeInteger(parsedDelta) &&
    parsedDelta !== 0 &&
    Math.abs(parsedDelta) <= SEICHI_SILVER_ADJUST_LIMIT &&
    reason.trim().length >= 10;

  const { mutate, isPending } = api.profile.adjustSeichiSilver.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        setIsOpen(false);
        setDelta("");
        setReason("");
        await utils.profile.getSeichiSilverForStaff.invalidate({ userId });
      }
    },
  });

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Coins
              className="h-6 w-6 cursor-pointer hover:text-orange-500"
              aria-label="Adjust Seichi Silver"
              onClick={() => setIsOpen(true)}
            />
          </TooltipTrigger>
          <TooltipContent>Adjust Seichi Silver</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Modal
        title="Adjust Seichi Silver"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label={isPending ? "Saving" : "Apply"}
        // Modal auto-closes on Apply when isValid is true/undefined. Pass false so a
        // failed mutation (AI rejection / insufficient balance) keeps the form open
        // with the entered amount + reason; we close in onSuccess instead. The accept
        // button stays gated via proceedDisabled below.
        isValid={false}
        proceedDisabled={!isValid || isPending}
        onAccept={(e) => {
          e.preventDefault();
          if (!isValid) return;
          mutate({ userId, delta: parsedDelta, reason: reason.trim() });
        }}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Adjust <strong>{username}</strong>&apos;s Seichi Silver (current:{" "}
            {silverLoading ? "…" : (currentSilver ?? 0)}). Use a negative number to
            subtract. This action is logged.
          </p>
          <div className="space-y-2">
            <Label htmlFor="silver-delta">Amount (+/-)</Label>
            <Input
              id="silver-delta"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 500 or -250"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="silver-reason">Reason *</Label>
            <Input
              id="silver-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (minimum 10 characters)..."
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

interface BloodlinePoolManagerProps {
  userId: string;
  username: string;
  equippedBloodlineId: string | null;
}

const BloodlinePoolManager: React.FC<BloodlinePoolManagerProps> = ({
  userId,
  username,
  equippedBloodlineId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const utils = api.useUtils();

  const { data: pool, isPending: poolLoading } =
    api.bloodline.getUserHistoricBloodlinesForStaff.useQuery(
      { userId },
      { enabled: isOpen },
    );

  const { mutate, isPending } = api.bloodline.removeBloodlineFromPool.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        // getPublicUser + the staff pool query refresh the admin's view of the
        // target. The two self-scoped queries below only matter when an admin
        // manages their OWN pool (userId === ctx.userId); a *different* player's
        // open tab is a separate client we cannot invalidate from here — that
        // staleness is harmless (a stale swap is rejected server-side).
        await Promise.all([
          utils.profile.getPublicUser.invalidate(),
          utils.bloodline.getUserHistoricBloodlinesForStaff.invalidate({ userId }),
          utils.bloodline.getUserHistoricBloodlines.invalidate(),
          utils.bloodline.getSwapInfo.invalidate(),
        ]);
      }
    },
  });

  const reasonValid = reason.trim().length >= 10;

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Droplets
              className="h-6 w-6 cursor-pointer hover:text-orange-500"
              aria-label="Manage Bloodline Pool"
              onClick={() => setIsOpen(true)}
            />
          </TooltipTrigger>
          <TooltipContent>Manage Bloodline Pool</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Modal
        title={`Manage Bloodline Pool — ${username}`}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label={null}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Remove a bloodline from this player&apos;s swappable pool. The equipped
            bloodline cannot be removed — change it first. All removals are logged.
          </p>
          <div className="space-y-2">
            <Label htmlFor="pool-reason">Reason * (applies to the removal)</Label>
            <Input
              id="pool-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (minimum 10 characters)..."
            />
          </div>
          {poolLoading && <p className="text-sm">Loading pool...</p>}
          {!poolLoading && (pool?.length ?? 0) === 0 && (
            <p className="text-sm">No bloodlines in this player&apos;s pool.</p>
          )}
          <div className="space-y-2">
            {pool?.map((bloodline) => {
              const isEquipped = bloodline.id === equippedBloodlineId;
              return (
                <div
                  key={bloodline.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <span className="text-sm">
                    {bloodline.name}
                    {isEquipped ? " (equipped)" : ""}
                  </span>
                  <Button
                    variant="destructive"
                    disabled={isEquipped || !reasonValid || isPending}
                    title={
                      isEquipped
                        ? "Change the equipped bloodline first"
                        : !reasonValid
                          ? "Enter a reason (10+ characters)"
                          : undefined
                    }
                    onClick={() =>
                      mutate({
                        userId,
                        bloodlineId: bloodline.id,
                        reason: reason.trim(),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
};
