"use client";

/**
 * WARNING: This page is loaded very frequently, so it is important to keep it as light as possible.
 * Do not casually introduce new queries without considering if if could be moved to a tab component loaded only on need.
 * Ensure that queries are only run when needed.
 */

import React, { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getSearchValidator } from "@/validators/register";
import { showUserRank } from "@/libs/profile";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import RichInput from "@/layout/RichInput";
import { zodResolver } from "@hookform/resolvers/zod";
import { Medal } from "lucide-react";
import { parseHtml } from "@/utils/parse";
import { awardSchema } from "@/validators/reputation";
import { publicUserText } from "@/layout/seoTexts";
import Link from "next/link";
import Image from "next/image";
import StatusBar from "@/layout/StatusBar";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Confirm2 from "@/layout/Confirm2";
import Modal2 from "@/layout/Modal2";
import Loader from "@/layout/Loader";
import ReportUser from "@/layout/Report";
import Post from "@/layout/Post";
import ActionLogs from "@/layout/ActionLog";
import GraphCombatLog from "@/layout/GraphCombatLog";
import DeleteUserButton from "@/layout/DeleteUserButton";
import { ActionSelector } from "@/layout/CombatActions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { TrainingSpeeds, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import GlowingBorder from "./GlowingBorder";
import { TransactionHistory } from "src/app/points/page";
import { EditContent } from "@/layout/EditContent";
import ItemWithEffects from "@/layout/ItemWithEffects";
import {
  Flag,
  CopyCheck,
  Settings,
  RefreshCcwDot,
  Trash2,
  Plus,
  PersonStanding,
  MessageCircle,
  IdCard,
  Award,
} from "lucide-react";
import { updateUserSchema } from "@/validators/user";
import { canSeeSecretData, canSeeIps } from "@/utils/permissions";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import { useUserEditForm } from "@/hooks/profile";
import { Chart as ChartJS } from "chart.js/auto";
import type { UpdateUserSchema } from "@/validators/user";
import { groupBy } from "@/utils/grouping";
import { Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import ActionLogFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/ActionLogFiltering";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canCloneUser } from "@/utils/permissions";
import type { Jutsu, UserBadge, Badge, UserRank } from "@/drizzle/schema";
import { NewConversationPrompt } from "@/app/inbox/page";
import Table from "@/layout/Table";
import {
  canModifyUserBadges,
  canUnstuckVillage,
  canAwardReputation,
  canSeeActivityEvents,
  canRestoreActivityStreak,
  canEditUsername,
  canEditCustomTitle,
  canEditBloodline,
  canEditVillage,
  canEditRank,
  canEditJutsus,
  canEditItems,
  canEditStaffAccountFlag,
  canClearUserNindo,
  canEditQuests,
  canDeleteReferral,
  canChangeUserRolesTo,
  canAwardExperience,
  canEditRankedLp,
} from "@/utils/permissions";

interface PublicUserComponentProps {
  userId: string;
  title: string;
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

const PublicUserComponent: React.FC<PublicUserComponentProps> = (props) => {
  const {
    userId,
    title,
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
  const [showActive, setShowActive] = useState("nindo");
  const [showForceAwakeModal, setShowForceAwakeModal] = useState(false);
  const [forceAwakeReason, setForceAwakeReason] = useState("");
  const { data: userData } = useUserData();

  const canSeeSecrets = userData && canSeeSecretData(userData.role);
  const enableReports = showReports && canSeeSecrets;
  const enablePaypal = showTransactions && canSeeSecrets;
  const enableLogs = showActionLogs && canSeeSecrets;
  const enableHistoricalIps = showHistoricalIps && userData && canSeeIps(userData.role);
  const enableActivityEvents =
    showActivityEvents && userData && canSeeActivityEvents(userData.role);
  const enableBloodlineHistory = showBloodlineHistory && canSeeSecrets;

  // Two-level filtering
  const state = useFiltering();

  // Queries
  const { data: profile, isPending: isPendingProfile } =
    api.profile.getPublicUser.useQuery({ userId: userId }, { enabled: !!userId });

  // Forms
  const form = useForm<z.infer<typeof awardSchema>>({
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
    defaultValues: { users: [] },
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });

  // Experience award form
  const experienceForm = useForm<{ amount: number }>({
    resolver: zodResolver(z.object({ amount: z.number().min(1).max(100000) })),
    defaultValues: { amount: 100 },
  });

  useEffect(() => {
    if (profile) {
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
  }, [profile, userSearchMethods]);

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
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  const clearNindo = api.reports.clearNindo.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  const cloneUser = api.staff.cloneUserForDebug.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  const updateUserId = api.staff.updateUserId.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  const unstuckUser = api.staff.forceAwake.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        setShowForceAwakeModal(false);
        setForceAwakeReason("");
      }
    },
  });

  // mutations related to badges and activity events were relocated to their tab components.
  const awardMutation = api.misc.awardReputation.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
      form.reset();
    },
  });

  const awardExperience = api.profile.awardExperience.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  const handleAwardSubmit = form.handleSubmit((data) => {
    awardMutation.mutate({
      userIds: data.userIds,
      reputationAmount: data.reputationAmount,
      moneyAmount: data.moneyAmount,
      reason: data.reason,
    });
  });

  const accountStatus = profile
    ? profile.isBanned
      ? "BANNED"
      : profile.isSilenced
        ? "SILENCED"
        : "GOOD STANDING"
    : "Loading...";

  // Derived
  const canChange = userData && canClearUserNindo(userData);

  // Loaders
  if (isPendingProfile) return <Loader explanation="Fetching Public User Data" />;

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
      {!userData && (
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
        defaultBackHref={userData ? defaultBackHref : undefined}
        subtitle={`Profile: ${profileName}`}
        initialBreak={userData ? initialBreak : true}
        topRightContent={
          <div className="flex flex-row gap-1">
            {userData && canCloneUser(userData.role) && (
              <>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CopyCheck
                        className="h-6 w-6 cursor-pointer hover:text-orange-500"
                        onClick={() => cloneUser.mutate({ userId: profile.userId })}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Clone User</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger>
                      <UpdateUserIdButton
                        userId={profile.userId}
                        username={profile.username}
                        updateUserIdMutation={updateUserId}
                      />
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

                <Modal2
                  title="Update User Data"
                  isOpen={showEditModal}
                  setIsOpen={setShowEditModal}
                  proceed_label="Done"
                >
                  {showEditModal && (
                    <EditUserComponent
                      userId={profile.userId}
                      profile={{
                        ...profile,
                        reason: "",
                        items: profile.items.map((ui) => ui.itemId),
                        jutsus: profile.jutsus.map((ui) => ui.jutsuId),
                      }}
                    />
                  )}
                </Modal2>
              </>
            )}
            {userData && canAwardReputation(userData.role) && (
              <Confirm2
                title="Award Reputation Points"
                proceed_label="Award Points"
                button={
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Medal className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                      </TooltipTrigger>
                      <TooltipContent>Award Reputation</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
                isValid={form.formState.isValid}
                onAccept={handleAwardSubmit}
              >
                <b>DO NOT</b> abuse this feature! All assignments are logged and visible
                to ALL users. Feature abuse for personal gain will result in severe
                consequences.
                <Form {...form}>
                  <form className="space-y-4">
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
                              {...field}
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
                              {...field}
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
                    />
                  </form>
                </Form>
              </Confirm2>
            )}

            {userData && canAwardExperience(userData) && (
              <Confirm2
                title="Award Experience Points"
                proceed_label="Award Experience"
                button={
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Award className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                      </TooltipTrigger>
                      <TooltipContent>Award Experience</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
                isValid={experienceForm.formState.isValid}
                onAccept={experienceForm.handleSubmit((data) => {
                  awardExperience.mutate({
                    targetUserId: profile.userId,
                    amount: data.amount,
                  });
                })}
              >
                Award unallocated experience points to {profile.username}. This will add
                to their earned experience pool that they can then distribute to their
                stats.
                <br />
                <br />
                <b>DO NOT</b> abuse this feature! All assignments are logged and visible
                to ALL users. Feature abuse for personal gain will result in severe
                consequences.
                <Form {...experienceForm}>
                  <form className="space-y-4 mt-4">
                    <FormField
                      control={experienceForm.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Experience Amount</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="Enter experience amount"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value) || 0)
                              }
                              min="1"
                              max="100000"
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
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PersonStanding 
                        className="h-6 w-6 cursor-pointer hover:text-orange-500" 
                        onClick={() => setShowForceAwakeModal(true)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Force Awake</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger>
                      <DeleteUserButton userData={profile} />
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
                    <span className="font-bold cursor-pointer hover:text-orange-500">
                      {profile.bloodline.name}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] max-w-[90vw] ">
                    <ItemWithEffects item={profile.bloodline} />
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
            {canSeeSecrets && <p>Unclaimed Exp: {profile.earnedExperience}</p>}
            <p>Experience for lvl: ---</p>
            <p>
              PVE Fights: {`${profile.pveFights} (+${profile.battleHistory.length})`}
            </p>
            <p>Yapper Rank: {profile.tavernMessages}</p>
            <br />
            <b>Special</b>
            <p>Reputation points: {profile.reputationPoints}</p>
            <p>Federal Support: {profile.federalStatus.toLowerCase()}</p>
            {userData && canSeeSecretData(userData.role) && (
              <div>
                <br />
                <b>Information</b>
                <p>Too fast infractions: {profile.movedTooFastCount}</p>
                {canSeeIps(userData.role) && (
                  <Link
                    href={`/users/ipsearch/${profile.lastIp}`}
                    className="hover:text-orange-500 hover:cursor-pointer"
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
                    userId={profile.userId}
                    hover_effect={false}
                    className="w-full"
                    priority={true}
                    size={100}
                  />
                </GlowingBorder>
                {canChange && !profile.isAi && (
                  <Confirm2
                    title="Confirm Deletion"
                    button={
                      <RefreshCcwDot className="absolute right-[13%] top-[3%] h-9 w-9 cursor-pointer z-10 rounded-full bg-slate-300 p-1 hover:text-orange-500" />
                    }
                    onAccept={(e) => {
                      e.preventDefault();
                      updateAvatar.mutate({ userId: profile.userId });
                    }}
                  >
                    You are about to delete an avatar and create a new one. Note that
                    abuse of this feature is forbidden, it is solely intended for
                    removing potentially inappropriate avatars. The action will be
                    logged. Are you sure?
                  </Confirm2>
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
        enableBloodlineHistory) && (
        <Tabs
          defaultValue={showActive}
          className="flex flex-col items-center justify-center mt-3"
          onValueChange={(value) => setShowActive(value)}
        >
          {userData && (
            <div className="flex flex-col gap-1">
              <TabsList className="text-center">
                {showNindo && <TabsTrigger value="nindo">Nindo</TabsTrigger>}
                {showCombatLogs && (
                  <TabsTrigger value="graph">Combat Graph</TabsTrigger>
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
                    {canChange && (
                      <Confirm2
                        title="Clear User Nindo"
                        proceed_label="Done"
                        button={
                          <Trash2 className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                        }
                        onAccept={() => clearNindo.mutate({ userId: profile.userId })}
                      >
                        Confirm that you wish to clear this nindo. The action will be
                        logged.
                      </Confirm2>
                    )}
                  </div>
                }
              >
                <div className="relative overflow-x-scroll">
                  {parseHtml(profile.nindo.content)}
                </div>
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
                <p className="italic pb-3">
                  The battle graph gives an overview of all users fought the last 60
                  days, as well as which users these opponents have faced.
                </p>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="submit" className="w-full">
                      <Waypoints className="h-5 w-5 mr-2" /> Show Battle Graph
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="min-w-[99%] min-h-[99%]">
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
                parentUsername={profile.username}
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
      {showForceAwakeModal && (
        <Modal2
          title="Force User Awake"
          isOpen={showForceAwakeModal}
          setIsOpen={setShowForceAwakeModal}
          proceed_label="Force Awake"
          confirmClassName="bg-orange-600 hover:bg-orange-700"
          onAccept={() => {
            if (forceAwakeReason.trim()) {
              unstuckUser.mutate({ 
                userId: profile.userId, 
                reason: forceAwakeReason.trim() 
              });
            }
          }}
          isValid={forceAwakeReason.trim().length > 0}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You are about to force <strong>{profile.username}</strong> to awake status.
              This action will be logged and should only be used to fix users stuck in a particular state.
            </p>
            
            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Input
                id="reason"
                value={forceAwakeReason}
                onChange={(e) => setForceAwakeReason(e.target.value)}
                placeholder="Enter reason for forcing awake status..."
              />
              <p className="text-xs text-muted-foreground">
                This reason will be logged in the action log.
              </p>
            </div>
          </div>
        </Modal2>
      )}
    </>
  );
};

export default PublicUserComponent;

interface EditUserComponentProps {
  userId: string;
  profile: UpdateUserSchema;
}

const EditUserComponent: React.FC<EditUserComponentProps> = ({ userId, profile }) => {
  // State
  const [jutsu, setJutsu] = useState<Jutsu | undefined>(undefined);
  const [showActive, setShowActive] = useState<string>("userData");
  const [selectedQuestType, setSelectedQuestType] = useState<string>("all");
  const now = new Date();

  // Logged-in user – determines editing permissions
  const { data: currentUser } = useUserData();
  const userRole = currentUser?.role || "USER";

  // Permission checks
  const perms = {
    canEditUsername: canEditUsername(userRole),
    canEditCustomTitle: canEditCustomTitle(userRole),
    canEditBloodline: canEditBloodline(userRole),
    canEditVillage: canEditVillage(userRole),
    canEditRank: canEditRank(userRole),
    canEditJutsus: canEditJutsus(userRole),
    canEditItems: canEditItems(userRole),
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
      selectedQuestType === "all" || quest.quest.questType === selectedQuestType,
  );

  // Mutations
  const deleteUserQuest = api.quests.deleteUserQuest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.quests.getUserQuests.invalidate();
      }
    },
  });

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
  const adjustJutsuLevel = api.jutsu.adjustUserJutsu.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
        await utils.jutsu.getPublicUserJutsus.invalidate();
      }
    },
  });

  // Query all reskins for selected jutsu
  const { data: jutsuReskins } = api.jutsu.getReskinsForJutsu.useQuery(
    { jutsuId: jutsu?.id || "" },
    { enabled: perms.canEditJutsus && !!jutsu?.id },
  );

  // Note: reskin is applied via adjustJutsuLevel to keep a single update action

  // Derived – only relevant if jutsu editing is permitted
  const userJutsu = userJutsus?.find((uj) => uj.jutsuId === jutsu?.id);
  const allJutsus = userJutsus?.map((uj) => uj.jutsu);
  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    return {
      id: userJutsu.jutsuId,
      quantity:
        userJutsu.finishTraining && userJutsu.finishTraining > now
          ? userJutsu.level - 1
          : userJutsu.level,
    };
  });
  const hasJutsus = perms.canEditJutsus && userJutsus && userJutsus.length > 0;

  // Update jutsu form default values when selected jutsu changes
  useEffect(() => {
    if (userJutsu) {
      jutsuLevelForm.reset({
        level: userJutsu.level,
        reskinId: userJutsu.activeReskin?.id || "none",
      });
    }
  }, [userJutsu, jutsuLevelForm]);

  // Cases where we don't render anything
  if (!currentUser) return null;
  if (!canEditSomething) return null;

  return (
    <Tabs
      defaultValue={showActive}
      className="flex flex-col items-center justify-center"
      onValueChange={(value) => setShowActive(value)}
    >
      <TabsList className="text-center mt-3">
        <TabsTrigger value="userData">Main Data</TabsTrigger>
        {hasJutsus && <TabsTrigger value="jutsus">Jutsus Specifics</TabsTrigger>}
        {perms.canEditQuests && <TabsTrigger value="quests">Quests</TabsTrigger>}
      </TabsList>
      <TabsContent value="userData">
        <EditContent
          schema={updateUserSchema}
          form={form}
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
          <div className="mt-5">
            <ActionSelector
              items={allJutsus}
              counts={userJutsuCounts}
              selectedId={jutsu?.id}
              labelSingles={true}
              emptyText="No jutsus assigned to this user"
              gridClassNameOverwrite="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12"
              onClick={(id) => {
                if (id == jutsu?.id) {
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
                    onSubmit={jutsuLevelForm.handleSubmit((data) => {
                      if (jutsu) {
                        adjustJutsuLevel.mutate({
                          userId: userId,
                          jutsuId: jutsu.id,
                          level: data.level,
                          reskinId: data.reskinId === "none" ? null : data.reskinId,
                        });
                      }
                    })}
                    className="flex items-center justify-between w-full gap-2"
                  >
                    <div className="flex items-end gap-2">
                      <FormField
                        control={jutsuLevelForm.control}
                        name="level"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Level</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                className="w-20"
                                min={0}
                                max={25}
                                {...field}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  field.onChange(value ? parseInt(value) : 0);
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
                      <Button type="submit">Update</Button>
                    </div>
                  </form>
                </Form>
              </div>
            </div>
          )}
        </TabsContent>
      )}
      {perms.canEditQuests && (
        <TabsContent value="quests">
          <div className="mt-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">User Quests</h3>
              {questTypes.length > 0 && (
                <select
                  className="bg-card text-foreground border border-border rounded-md px-3 py-1"
                  value={selectedQuestType}
                  onChange={(e) => setSelectedQuestType(e.target.value)}
                >
                  <option value="all">All Quest Types</option>
                  {questTypes.map((type) => (
                    <option key={type} value={type}>
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
                    className="flex items-center justify-between p-3 border-2 border-border rounded-lg bg-card"
                  >
                    <div>
                      <h4 className="font-semibold text-foreground">
                        {userQuest.quest.name}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Started: {userQuest.startedAt.toLocaleString()}
                        {userQuest.endAt &&
                          ` • Completed: ${userQuest.endAt.toLocaleString()}`}
                      </p>
                      {userQuest.quest.questType && (
                        <p className="text-sm text-muted-foreground">
                          Type: {userQuest.quest.questType}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (
                          confirm("Are you sure you want to delete this quest record?")
                        ) {
                          deleteUserQuest.mutate({
                            userId: userId,
                            questId: userQuest.quest.id,
                          });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
  // Create form with zod schema
  const userIdForm = useForm<{ newUserId: string }>({
    defaultValues: {
      newUserId: userId,
    },
  });

  // Handle form submission
  const handleUpdateUserId = userIdForm.handleSubmit((data) => {
    updateUserIdMutation.mutate({
      userId: userId,
      newUserId: data.newUserId,
    });
  });

  return (
    <Confirm2
      title="Update User ID"
      proceed_label="Update"
      button={<IdCard className="h-6 w-6 cursor-pointer hover:text-orange-500" />}
      onAccept={handleUpdateUserId}
      isValid={userIdForm.formState.isValid}
    >
      <Form {...userIdForm}>
        <form className="space-y-4">
          <p>
            This will update the user ID for {username}. This action cannot be undone
            and may affect database relationships.
          </p>
          <FormField
            control={userIdForm.control}
            name="newUserId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New User ID</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Confirm2>
  );
};

interface TrainingStatsComponentProps {
  userId: string;
  isActive: boolean;
}

const UserTrainingLog: React.FC<TrainingStatsComponentProps> = ({
  userId,
  isActive,
}) => {
  // State
  const chart = useRef<HTMLCanvasElement>(null);

  // Query
  const { data: logEntries } = api.train.getTrainingLog.useQuery(
    { userId },
    { enabled: isActive },
  );

  // Create dataset for each training speed
  const x = [...Array(24).keys()];
  const datasets =
    logEntries &&
    TrainingSpeeds.map((speed) => {
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
        data: x.map((i) => {
          const entries = hourlyEvents.get(i) || [];
          return {
            x: i,
            y: entries.length || 0,
            entries: entries,
          };
        }),
      };
    });

  // Create chart
  useEffect(() => {
    const ctx = chart?.current?.getContext("2d");
    if (ctx && datasets) {
      // Update stats chart
      const localTheme = localStorage.getItem("theme");
      ChartJS.defaults.color = localTheme === "dark" ? "#FFFFFF" : "#000000";
      const myChart = new ChartJS(ctx, {
        type: "bar",
        options: {
          maintainAspectRatio: false,
          responsive: true,
          aspectRatio: 1.1,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1,
              },
              title: {
                display: false,
                text: "#Events",
              },
              stacked: true,
            },
            x: {
              stacked: true,
              title: {
                display: true,
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
                title: function (tooltipItems) {
                  return `Training at hour ${tooltipItems?.[0]?.label || "unknown"}`;
                },
                label: function (tooltipItems) {
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
          labels: x,
          datasets: datasets,
        },
      });

      // Remove on unmount
      return () => {
        myChart.destroy();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets]);

  return (
    <ContentBox
      title="Training Log"
      subtitle="User activity last 7 days"
      initialBreak={true}
    >
      <div className="relative w-[99%] p-3">
        <canvas ref={chart} id="chart"></canvas>
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
              <div className="m-3 w-16 ">
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
          {historicalIps.map((ip, i) => (
            <div
              key={`ip-${i}`}
              className="flex items-center justify-between p-3 border-2 border-border rounded-lg bg-card"
            >
              <div>
                <h4 className="font-semibold text-foreground">
                  <Link
                    href={`/users/ipsearch/${ip.ip}`}
                    className="hover:text-orange-500 hover:cursor-pointer"
                  >
                    {ip.ip}
                  </Link>
                </h4>
                <p className="text-sm text-muted-foreground">
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
  const utils = api.useUtils();

  const { data: activityEvents, isPending } = api.staff.getUserActivityEvents.useQuery(
    { userId },
    { enabled: isActive && !!canSeeEvents },
  );

  const restoreActivityStreak = api.staff.restoreUserActivityStreak.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.staff.getUserActivityEvents.invalidate();
      }
    },
  });

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
          {activityEvents.map((event, i) => (
            <div
              key={`event-${i}`}
              className="flex items-center justify-between p-3 border-2 border-border rounded-lg bg-card"
            >
              <div>
                <h4 className="font-semibold text-foreground">
                  Activity Event #{event.id}
                </h4>
                <p className="text-sm text-muted-foreground">Streak: {event.streak}</p>
                <p className="text-sm text-muted-foreground">
                  Created: {event.createdAt.toLocaleString()}
                </p>
              </div>
              {currentUser && canRestoreActivityStreak(currentUser.role) && (
                <Confirm2
                  title="Restore Activity Streak"
                  proceed_label="Restore Streak"
                  button={
                    <Button variant="secondary" size="sm">
                      Restore Streak
                    </Button>
                  }
                  onAccept={() =>
                    restoreActivityStreak.mutate({ userId, activityEventId: event.id })
                  }
                >
                  Are you sure you want to restore the activity streak to{" "}
                  <strong>{event.streak}</strong>? This action will update the
                  user&apos;s current activity streak.
                </Confirm2>
              )}
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
          {students.map((user, i) => (
            <Link
              href={`/username/${user.username}`}
              className="text-center"
              key={`student-${i}`}
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
          {marriages.map((user, i) => (
            <Link
              href={`/username/${user.username}`}
              className="text-center"
              key={`marriage-${i}`}
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

const BadgesTab: React.FC<BadgesTabProps> = ({ userId, username, currentBadges }) => {
  const { data: currentUser } = useUserData();
  const canModify = currentUser && canModifyUserBadges(currentUser.role);

  // Only fetch the list of all badges when the add-badge popover is opened
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { data: allBadges } = api.badge.getAllNames.useQuery(undefined, {
    enabled: popoverOpen,
  });

  const utils = api.useUtils();

  const insertUserBadge = api.staff.insertUserBadge.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
        await utils.logs.getContentChanges.invalidate();
      }
    },
  });

  const removeUserBadge = api.staff.removeUserBadge.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
        await utils.logs.getContentChanges.invalidate();
      }
    },
  });

  return (
    <ContentBox
      title="Achieved Badges"
      subtitle={`Badges earned by ${username}`}
      initialBreak={true}
      topRightContent={
        <>
          {canModify && (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button className="w-full">
                  <Plus className="h-6 w-6 mr-2" /> New
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96">
                <ActionSelector
                  items={
                    allBadges
                      ? allBadges.filter(
                          (b) => !currentBadges.some((ub) => ub.badgeId === b.id),
                        )
                      : []
                  }
                  labelSingles={true}
                  onClick={(id) => insertUserBadge.mutate({ userId, badgeId: id })}
                  showBgColor={false}
                  roundFull={true}
                  hideBorder={true}
                  gridClassNameOverwrite="grid grid-cols-5 md:grid-cols-6"
                  showLabels={true}
                  emptyText="No badges exist yet."
                />
              </PopoverContent>
            </Popover>
          )}
        </>
      }
    >
      {currentBadges.length === 0 && <p>No badges found</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
        {currentBadges.map((userbadge, i) => (
          <div key={`badge-${i}`} className="text-center relative">
            <Image
              src={userbadge.badge.image}
              alt={userbadge.badge.name}
              width={128}
              height={128}
            />
            <div>
              <div className="font-bold">{userbadge.badge.name}</div>
            </div>
            {canModify && (
              <Trash2
                className="absolute right-[8%] top-0 h-9 w-9 border-2 border-black cursor-pointer rounded-full bg-amber-100 fill-slate-500 p-1 hover:fill-orange-500"
                onClick={() => removeUserBadge.mutate(userbadge)}
              />
            )}
          </div>
        ))}
      </div>
    </ContentBox>
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
  parentUsername: string;
}

const RecruitedUsersTab: React.FC<RecruitedUsersTabProps> = ({
  recruits,
  parentUsername,
}) => {
  const { data: currentUser } = useUserData();
  const canDelete = currentUser && canDeleteReferral(currentUser.role);

  const utils = api.useUtils();

  const deleteReferral = api.staff.deleteReferral.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  return (
    <ContentBox
      title="Recruited Users"
      subtitle={`${parentUsername} referred these users`}
      initialBreak={true}
    >
      {(!recruits || recruits.length === 0) && <p>No recruits found</p>}
      {recruits && recruits.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {recruits.map((user, i) => (
            <div key={`recruited-${i}`} className="text-center relative">
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
                <Confirm2
                  title="Delete Referral"
                  proceed_label="Delete"
                  button={
                    <Trash2 className="absolute right-[8%] top-0 h-9 w-9 border-2 border-black cursor-pointer rounded-full bg-red-100 fill-slate-500 p-1 hover:fill-red-500" />
                  }
                  onAccept={() => deleteReferral.mutate({ userId: user.userId })}
                >
                  Are you sure you want to delete the referral relationship between{" "}
                  <strong>{parentUsername}</strong> and <strong>{user.username}</strong>
                  ? This action will remove the referral and cannot be undone.
                </Confirm2>
              )}
            </div>
          ))}
        </div>
      )}
    </ContentBox>
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
