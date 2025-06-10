"use client";

import React, { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getSearchValidator } from "@/validators/register";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import Loader from "@/layout/Loader";
import ReportUser from "@/layout/Report";
import Post from "@/layout/Post";
import ActionLogs from "@/layout/ActionLog";
import GraphCombatLog from "@/layout/GraphCombatLog";
import DeleteUserButton from "@/layout/DeleteUserButton";
import { ActionSelector } from "@/layout/CombatActions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocalStorage } from "@/hooks/localstorage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrainingSpeeds } from "@/drizzle/constants";
import GlowingBorder from "./GlowingBorder";
import { TransactionHistory } from "src/app/points/page";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { EditContent } from "@/layout/EditContent";
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
} from "lucide-react";
import { updateUserSchema } from "@/validators/user";
import { canChangeUserRole } from "@/utils/permissions";
import { canSeeSecretData, canSeeIps } from "@/utils/permissions";
import {
  canModifyUserBadges,
  canUnstuckVillage,
  canAwardReputation,
  canSeeActivityEvents,
  canRestoreActivityStreak,
} from "@/utils/permissions";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { canClearUserNindo, canEditPublicUser } from "@/utils/permissions";
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
import { canCloneUser } from "@/utils/permissions";
import type { Jutsu } from "@/drizzle/schema";
import { NewConversationPrompt } from "@/app/inbox/page";

interface PublicUserComponentProps {
  userId: string;
  title: string;
  back_href?: string;
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
}

const PublicUserComponent: React.FC<PublicUserComponentProps> = (props) => {
  const {
    userId,
    title,
    back_href,
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
  } = props;
  // Get state
  const [showActive, setShowActive] = useLocalStorage<string>("pDetails", "nindo");
  const { data: userData } = useUserData();

  const canSeeSecrets = userData && canSeeSecretData(userData.role);
  const enableReports = showReports && canSeeSecrets;
  const enablePaypal = showTransactions && canSeeSecrets;
  const enableLogs = showActionLogs && canSeeSecrets;
  const enableHistoricalIps = showHistoricalIps && userData && canSeeIps(userData.role);
  const enableActivityEvents =
    showActivityEvents && userData && canSeeActivityEvents(userData.role);

  // Two-level filtering
  const state = useFiltering();

  // Queries
  const { data: profile, isPending: isPendingProfile } =
    api.profile.getPublicUser.useQuery({ userId: userId }, { enabled: !!userId });

  const { data: reports, isPending: isPendingReports } =
    api.reports.getUserReports.useQuery(
      { userId: userId },
      { enabled: !!enableReports },
    );

  const { data: historicalIps, isPending: isPendingHistoricalIps } =
    api.staff.getUserHistoricalIps.useQuery(
      { userId: userId },
      { enabled: !!enableHistoricalIps },
    );

  const { data: activityEvents, isPending: isPendingActivityEvents } =
    api.staff.getUserActivityEvents.useQuery(
      { userId: userId },
      { enabled: !!enableActivityEvents },
    );

  const { data: marriages } = api.marriage.getMarriedUsers.useQuery(
    { id: userId },
    { staleTime: 300000 },
  );

  const { data: badges } = api.badge.getAllNames.useQuery(undefined);

  const { data: todayPveCount } = api.profile.getUserDailyPveBattleCount.useQuery(
    { userId: userId },
    {},
  );

  const { data: pvpRank, isPending: isPendingPvpRank } = api.rankedpvp.getPvpRank.useQuery(
    { 
      userId: userId,
      rankedLp: profile?.rankedLp ?? 0
    },
    { 
      enabled: !!profile?.rankedLp
    }
  );

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
      }
    },
  });

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

  const restoreActivityStreak = api.staff.restoreUserActivityStreak.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
        await utils.staff.getUserActivityEvents.invalidate();
      }
    },
  });

  const awardMutation = api.misc.awardReputation.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
      }
      form.reset();
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
  const availableRoles = userData && canChangeUserRole(userData.role);

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
          back_href={back_href}
          initialBreak={initialBreak}
        >
          {publicUserText(profile.username)}
        </ContentBox>
      )}
      {/* USER STATISTICS */}
      <ContentBox
        title={title}
        back_href={userData ? back_href : undefined}
        subtitle={`Profile: ${profileName}`}
        initialBreak={userData ? initialBreak : true}
        topRightContent={
          <div className="flex flex-row gap-1">
            {userData && canCloneUser(userData.role) && (
              <>
                <CopyCheck
                  className="h-6 w-6 cursor-pointer hover:text-orange-500"
                  onClick={() => cloneUser.mutate({ userId: profile.userId })}
                />
                <UpdateUserIdButton
                  userId={profile.userId}
                  username={profile.username}
                  updateUserIdMutation={updateUserId}
                />
              </>
            )}
            {userData && !userData.isBanned && !userData.isSilenced && (
              <NewConversationPrompt
                newButton={
                  <MessageCircle className="h-6 w-6 cursor-pointer hover:text-orange-500" />
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
            {availableRoles &&
              availableRoles.length > 0 &&
              canEditPublicUser(userData) && (
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
            {userData && canAwardReputation(userData.role) && (
              <Confirm2
                title="Award Reputation Points"
                proceed_label="Award Points"
                button={
                  <Medal className="h-6 w-6 cursor-pointer hover:text-orange-500" />
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
                  <Flag className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                }
              />
            )}
            {userData && canUnstuckVillage(userData.role) ? (
              <>
                <Confirm2
                  title="Confirm force change user state to awake"
                  button={
                    <PersonStanding className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                  }
                  onAccept={(e) => {
                    e.preventDefault();
                    unstuckUser.mutate({ userId: profile.userId });
                  }}
                >
                  Note that abuse of this feature is forbidden, it is solely intended
                  for fixing users stuck in a particular state. I.E Battle. The action
                  will be logged. Are you sure?
                </Confirm2>
                <DeleteUserButton userData={profile} />
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
              Lvl. {profile.level} {capitalizeFirstLetter(profile.rank)}
            </p>
            <p>
              PvP Rank: {isPendingPvpRank ? "Loading..." : (pvpRank ?? "Not ranked")}
            </p>
            <p>Village: {profile.village?.name}</p>
            <p>Status: {profile.status === "QUEUED" ? "ASLEEP" : profile.status}</p>
            <p>Account Status: {accountStatus}</p>
            <p>Gender: {profile.gender}</p>
            <br />
            <b>Associations</b>
            <p>Clan: {profile.clan?.name || "None"}</p>
            <p>ANBU: {profile.anbuSquad?.name || "None"}</p>
            <p>Bloodline: {profile.bloodline?.name || "None"}</p>
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
            <p>PVE Fights: {`${profile.pveFights} (+${todayPveCount})`}</p>
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
      <div className="text-center text-sm italic">Unique ID: {profile.userId}</div>
      {/* MARRIED USERS */}
      {showMarriages && marriages !== undefined && marriages.length > 0 && (
        <ContentBox
          title="Married Users"
          subtitle={`${profile.username} is married to these users`}
          initialBreak={true}
        >
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
        </ContentBox>
      )}
      {/* RECRUITED USERS */}
      {showRecruited && profile.recruitedUsers.length > 0 && (
        <ContentBox
          title="Recruited Users"
          subtitle={`${profile.username} referred these users`}
          initialBreak={true}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
            {profile.recruitedUsers.map((user, i) => (
              <Link
                href={`/username/${user.username}`}
                className="text-center"
                key={`recruited-${i}`}
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
                  <div>
                    Lvl. {user.level} {capitalizeFirstLetter(user.rank)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </ContentBox>
      )}
      {/* STUDENTS */}
      {showStudents && profile.students.length > 0 && (
        <ContentBox title="Students" subtitle={`Past and present`} initialBreak={true}>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
            {profile.students.map((user, i) => (
              <Link
                href={`/username/${user.username}`}
                className="text-center"
                key={`student-${i}`}
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
                  <div>
                    Lvl. {user.level} {capitalizeFirstLetter(user.rank)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </ContentBox>
      )}
      {/* USER BADGES */}
      {showBadges && (
        <ContentBox
          title="Achieved Badges"
          subtitle={`Achieved through quests & help`}
          initialBreak={true}
          topRightContent={
            <>
              {badges && userData && canModifyUserBadges(userData.role) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button className="w-full">
                      <Plus className="h-6 w-6 mr-2" /> New
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <ActionSelector
                      items={badges.filter(
                        (b) => !profile.badges.some((ub) => ub.badgeId === b.id),
                      )}
                      labelSingles={true}
                      onClick={(id) => {
                        insertUserBadge.mutate({ userId: profile.userId, badgeId: id });
                      }}
                      showBgColor={false}
                      roundFull={true}
                      hideBorder={true}
                      showLabels={true}
                      emptyText="No badges exist yet."
                    />
                  </PopoverContent>
                </Popover>
              )}
            </>
          }
        >
          {profile.badges.length === 0 && <p>No badges found</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
            {profile.badges.map((userbadge, i) => (
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
                {userData && canModifyUserBadges(userData.role) && (
                  <Trash2
                    className="absolute right-[8%] top-0 h-9 w-9 border-2 border-black cursor-pointer rounded-full bg-amber-100 fill-slate-500 p-1 hover:fill-orange-500"
                    onClick={() => removeUserBadge.mutate(userbadge)}
                  />
                )}
              </div>
            ))}
          </div>
        </ContentBox>
      )}
      {(showNindo ||
        showCombatLogs ||
        showTransactions ||
        showReports ||
        showTrainingLogs ||
        enableLogs ||
        enableHistoricalIps ||
        enableActivityEvents) && (
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
              </TabsList>
              <TabsList className="text-center">
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
              <ContentBox
                title="Reports"
                subtitle={`Reports against ${profile.username}`}
                initialBreak={true}
              >
                {isPendingReports && <Loader explanation="Fetching User Reports" />}
                {reports?.length === 0 && <p>No reports found</p>}
                {reports?.map((report) => {
                  return (
                    <Link key={`report-${report.id}`} href={"/reports/" + report.id}>
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
                                alt="Forum Icon"
                              ></Image>
                            )}
                          </div>
                        }
                      >
                        {parseHtml(report.reason)}
                        <b>Status:</b> {report.status.toLowerCase()}
                      </Post>
                    </Link>
                  );
                })}
              </ContentBox>
            </TabsContent>
          )}
          {/* USER TRAINING LOG */}
          {showTrainingLogs && (
            <TabsContent value="training">
              <UserTrainingLog userId={profile.userId} />
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
              <ContentBox
                title="Historical IPs"
                subtitle={`IP addresses used the last 90 days`}
                initialBreak={true}
              >
                {isPendingHistoricalIps && (
                  <Loader explanation="Fetching Historical IPs" />
                )}
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
            </TabsContent>
          )}
          {/* USER ACTIVITY EVENTS */}
          {enableActivityEvents && (
            <TabsContent value="activityEvents">
              <ContentBox
                title="Activity Events"
                subtitle={`Latest claimed activity events`}
                initialBreak={true}
              >
                {isPendingActivityEvents && (
                  <Loader explanation="Fetching Activity Events" />
                )}
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
                          <p className="text-sm text-muted-foreground">
                            Streak: {event.streak}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Created: {event.createdAt.toLocaleString()}
                          </p>
                        </div>
                        {userData && canRestoreActivityStreak(userData.role) && (
                          <Confirm2
                            title="Restore Activity Streak"
                            proceed_label="Restore Streak"
                            button={
                              <Button variant="secondary" size="sm">
                                Restore Streak
                              </Button>
                            }
                            onAccept={() => {
                              restoreActivityStreak.mutate({
                                userId: profile.userId,
                                activityEventId: event.id,
                              });
                            }}
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
            </TabsContent>
          )}
        </Tabs>
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

  // tRPC utility
  const utils = api.useUtils();

  // Queries
  const { data: userQuests } = api.quests.getUserQuests.useQuery(
    { userId: userId },
    { enabled: !!userId },
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

  // Form handling
  const { form, formData, userJutsus, handleUserSubmit } = useUserEditForm(
    userId,
    profile,
  );

  // Form for jutsu level
  const jutsuLevelForm = useForm<{ level: number }>({
    defaultValues: {
      level: userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.level || 0,
    },
  });

  // Mutation for adjusting jutsu level
  const adjustJutsuLevel = api.jutsu.adjustJutsuLevel.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getPublicUser.invalidate();
        await utils.jutsu.getPublicUserJutsus.invalidate();
      }
    },
  });

  // Derived
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
  const hasJutsus = userJutsus && userJutsus.length > 0;

  // Update jutsu level form default value when jutsu changes
  useEffect(() => {
    if (userJutsu) {
      jutsuLevelForm.reset({ level: userJutsu.level });
    }
  }, [userJutsu, jutsuLevelForm]);

  return (
    <Confirm2
      title="Update User Data"
      proceed_label="Done"
      button={<Settings className="h-6 w-6 cursor-pointer hover:text-orange-500" />}
    >
      <Tabs
        defaultValue={showActive}
        className="flex flex-col items-center justify-center"
        onValueChange={(value) => setShowActive(value)}
      >
        <TabsList className="text-center mt-3">
          <TabsTrigger value="userData">Main Data</TabsTrigger>
          {hasJutsus && <TabsTrigger value="jutsus">Jutsus Specifics</TabsTrigger>}
          <TabsTrigger value="quests">Quests</TabsTrigger>
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
                          });
                        }
                      })}
                      className="flex items-center justify-between w-full gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <FormField
                          control={jutsuLevelForm.control}
                          name="level"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Level</FormLabel>
                              <div className="relative flex flex-row gap-2">
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
                                <Button type="submit">Update</Button>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </form>
                  </Form>
                </div>
              </div>
            )}
          </TabsContent>
        )}
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
      </Tabs>
    </Confirm2>
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
}

const UserTrainingLog: React.FC<TrainingStatsComponentProps> = ({ userId }) => {
  // State
  const chart = useRef<HTMLCanvasElement>(null);

  // Query
  const { data: logEntries } = api.train.getTrainingLog.useQuery(
    { userId: userId },
    {},
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
