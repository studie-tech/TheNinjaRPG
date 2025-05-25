"use client";

import { z } from "zod";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Accordion from "@/layout/Accordion";
import AvatarImage from "@/layout/Avatar";
import Modal from "@/layout/Modal";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import ItemWithEffects from "@/layout/ItemWithEffects";
import NindoChange from "@/layout/NindoChange";
import AiProfileEdit from "@/layout/AiProfileEdit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getUserFederalStatus } from "@/utils/paypal";
import { ActionSelector } from "@/layout/CombatActions";
import {
  ChevronsRight,
  ChevronsLeft,
  SwitchCamera,
  Trash2,
  SendHorizontal,
  Ban,
} from "lucide-react";
import { attributes, getSearchValidator } from "@/validators/register";
import { colors, skin_colors } from "@/validators/register";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { useUserSearch } from "@/utils/search";
import { showMutationToast } from "@/libs/toast";
import { COST_CHANGE_USERNAME } from "@/drizzle/constants";
import { COST_CUSTOM_TITLE } from "@/drizzle/constants";
import { COST_RESET_STATS } from "@/drizzle/constants";
import { COST_SWAP_BLOODLINE } from "@/drizzle/constants";
import { COST_SWAP_VILLAGE } from "@/drizzle/constants";
import { COST_REROLL_ELEMENT } from "@/drizzle/constants";
import { COST_CHANGE_GENDER } from "@/drizzle/constants";
import { round } from "@/utils/math";
import { genders } from "@/validators/register";
import { updateUserPreferencesSchema } from "@/validators/user";
import { UploadButton } from "@/utils/uploadthing";
import { capUserStats } from "@/libs/profile";
import { getUserElements } from "@/validators/user";
import { canSwapVillage } from "@/utils/permissions";
import { canSwapBloodline } from "@/utils/permissions";
import { useInfinitePagination } from "@/libs/pagination";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { canEditPublicUser } from "@/utils/permissions";
import UserSearchSelect from "@/layout/UserSearchSelect";
import UserRequestSystem from "@/layout/UserRequestSystem";
import type { Gender } from "@/validators/register";
import type { BaseServerResponse } from "@/server/api/trpc";
import type { Bloodline, Village } from "@/drizzle/schema";
import {
  AiRule,
  ConditionDistanceHigherThan,
  ActionMoveTowardsOpponent,
} from "@/validators/ai";

export default function EditProfile() {
  // State
  const { data: userData } = useRequiredUserData();
  const [activeElement, setActiveElement] = useState("AI Avatar");
  const { data: emailReminder } = api.misc.getPersonalEmailReminder.useQuery();

  // Loaders
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived
  const activeElements = getUserElements(userData);

  return (
    <ContentBox
      title="Edit Profile"
      subtitle="Customize Character"
      back_href="/profile"
      padding={false}
    >
      <div className="grid grid-cols-1">
        <Accordion
          title="AI Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Generate a new avatar"
          onClick={setActiveElement}
        >
          <NewAiAvatar />
        </Accordion>
        <Accordion
          title="Previous Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Choose an old avatar"
          onClick={setActiveElement}
        >
          <HistoricalAiAvatar />
        </Accordion>
        <Accordion
          title="Custom Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Upload a custom avatar"
          selectedSubtitle={`Avatar size is limited based on federal support status`}
          onClick={setActiveElement}
        >
          <AvatarChange />
        </Accordion>
        <Accordion
          title="User Blacklist"
          selectedTitle={activeElement}
          unselectedSubtitle="Filter away toxic profiles from your feeds"
          onClick={setActiveElement}
        >
          <UserBlacklistControl />
        </Accordion>
        <Accordion
          title="Nindo"
          selectedTitle={activeElement}
          unselectedSubtitle="Your personal way of the ninja"
          onClick={setActiveElement}
        >
          <OwnNindoChange />
        </Accordion>
        <Accordion
          title="Marriage"
          selectedTitle={activeElement}
          unselectedSubtitle="Manage Marriage"
          onClick={setActiveElement}
        >
          <Marriage />
        </Accordion>
        <Accordion
          title="Name Change"
          selectedTitle={activeElement}
          unselectedSubtitle="Change your username"
          selectedSubtitle={`You can change your username for ${COST_CHANGE_USERNAME} reputation points. You
          have ${userData.reputationPoints} reputation points.`}
          onClick={setActiveElement}
        >
          <NameChange />
        </Accordion>
        <Accordion
          title="Custom Title"
          selectedTitle={activeElement}
          unselectedSubtitle="Set a custom title shown next to username"
          selectedSubtitle={`You can set your custom title for ${COST_CUSTOM_TITLE} reputation points. You
          have ${userData.reputationPoints} reputation points.`}
          onClick={setActiveElement}
        >
          <CustomTitle />
        </Accordion>
        <Accordion
          title="Change Gender"
          selectedTitle={activeElement}
          unselectedSubtitle="Change the gender of your character"
          selectedSubtitle={`Change your gender for ${COST_CHANGE_GENDER} reputation points. You
          have ${userData.reputationPoints} reputation points.`}
          onClick={setActiveElement}
        >
          <ChangeGender />
        </Accordion>
        <Accordion
          title="Attribute Management"
          selectedTitle={activeElement}
          unselectedSubtitle="Change character attributes"
          selectedSubtitle={`You can select a total of 5 attributes!`}
          onClick={setActiveElement}
        >
          <AttributeChange />
        </Accordion>
        <Accordion
          title="Reset Stats"
          selectedTitle={activeElement}
          unselectedSubtitle="Redistribute your experience points"
          selectedSubtitle={`You can redistribute your stats for ${COST_RESET_STATS} reputation points. You
          have ${userData.reputationPoints} reputation points. You have ${
            userData.experience + 120
          } experience points to distribute.`}
          onClick={setActiveElement}
        >
          <ResetStats />
        </Accordion>
        {emailReminder && (
          <Accordion
            title="Email Reminder Settings"
            selectedTitle={activeElement}
            unselectedSubtitle="Manage your email notification preferences"
            onClick={setActiveElement}
          >
            <EmailReminderSettings emailReminder={emailReminder} />
          </Accordion>
        )}
        <Accordion
          title="Re-Roll Elements"
          selectedTitle={activeElement}
          unselectedSubtitle="Re-roll your primary elements"
          selectedSubtitle={
            <div>
              <p className="pb-3">
                You can re-roll your elements for {COST_REROLL_ELEMENT} reputation
                points. You have {userData.reputationPoints} reputation points. You can
                only re-roll elements which are not currently overwritten by a
                bloodline.
              </p>

              {userData.primaryElement ? (
                <p>
                  Current primary element: {userData.primaryElement}{" "}
                  {activeElements[0] === userData.primaryElement ||
                    `- Overwritten by bloodline (${activeElements[0]})`}
                </p>
              ) : undefined}
              {userData.secondaryElement ? (
                <p>
                  Current secondary element: {userData.secondaryElement}{" "}
                  {activeElements[1] === userData.secondaryElement ||
                    `- Overwritten by bloodline (${activeElements[1]})`}
                </p>
              ) : undefined}
            </div>
          }
          onClick={setActiveElement}
        >
          <RerollElement />
        </Accordion>
        <Accordion
          title="Combat Preferences"
          selectedTitle={activeElement}
          unselectedSubtitle="Customize battle preferences and AI behavior"
          selectedSubtitle=""
          onClick={setActiveElement}
        >
          <BattleSettingsEdit userId={userData.userId} />
        </Accordion>
        {canSwapBloodline(userData.role) && (
          <Accordion
            title="Swap Bloodline"
            selectedTitle={activeElement}
            unselectedSubtitle="Change your bloodline of choice"
            selectedSubtitle={`You can swap your current bloodline for another of similar rank for ${COST_SWAP_BLOODLINE} reputation points. You have ${userData.reputationPoints} reputation points.`}
            onClick={setActiveElement}
          >
            <SwapBloodline />
          </Accordion>
        )}
        {canSwapVillage(userData.role) && (
          <Accordion
            title="Swap Village"
            selectedTitle={activeElement}
            unselectedSubtitle="Change your village of choice"
            selectedSubtitle={`You can swap your current village for another for ${COST_SWAP_VILLAGE} reputation points. You have ${userData.reputationPoints} reputation points.`}
            onClick={setActiveElement}
          >
            <SwapVillage />
          </Accordion>
        )}
        {canEditPublicUser({ ...userData, role: userData.role }) && (
          <Accordion
            title="Admin Controls"
            selectedTitle={activeElement}
            unselectedSubtitle="Advanced admin controls"
            onClick={setActiveElement}
          >
            <AdminControls />
          </Accordion>
        )}
      </div>
    </ContentBox>
  );
}

/**
 * Email Reminder Settings component that shows a button to redirect to the email settings page
 */
const EmailReminderSettings: React.FC<{
  emailReminder: { email: string; secret: string };
}> = ({ emailReminder }) => {
  const emailSettingsUrl = `/emailsettings?email=${encodeURIComponent(emailReminder.email)}&secret=${encodeURIComponent(emailReminder.secret)}`;

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2 pb-4">
        <p className="text-sm text-muted-foreground">
          You have email reminders set up for:{" "}
          <span className="font-medium">{emailReminder.email}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Click the button below to manage your email notification preferences.
        </p>
      </div>

      <Link href={emailSettingsUrl} passHref>
        <Button className="flex items-center gap-2 ">
          <SendHorizontal className="h-4 w-4" />
          Manage Email Settings
        </Button>
      </Link>
    </div>
  );
};

/**
 * Battle Settings Edit
 */
const BattleSettingsEdit: React.FC<{ userId: string }> = ({ userId }) => {
  // Queries & mutations
  const [showActive, setShowActive] = useState<string>("preferred");
  const { data: profile, isPending: isPendingProfile } =
    api.profile.getPublicUser.useQuery({ userId: userId }, { enabled: !!userId });
  const { data: userData, updateUser } = useRequiredUserData();
  const utils = api.useUtils();

  // Form setup
  const form = useForm<z.infer<typeof updateUserPreferencesSchema>>({
    resolver: zodResolver(updateUserPreferencesSchema),
    defaultValues: {
      preferredStat: null,
      preferredGeneral1: null,
      preferredGeneral2: null,
    },
  });

  // Update battle description setting
  const { mutate: updateBattleDescription } =
    api.profile.updateBattleDescription.useMutation({
      onSuccess: async () => {
        await utils.profile.getUser.invalidate();
      },
    });

  const { mutate: updateAiProfile, isPending } = api.ai.updateAiProfile.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getAi.invalidate();
        await utils.profile.getPublicUser.invalidate();
      }
    },
  });

  // Update highest preferences
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    onSuccess: async (data) => {
      const values = form.getValues();
      showMutationToast(data);
      await updateUser({
        preferredStat: values.preferredStat,
        preferredGeneral1: values.preferredGeneral1,
        preferredGeneral2: values.preferredGeneral2,
      });
    },
  });

  // Update form when preferences are loaded
  useEffect(() => {
    if (userData) {
      form.reset({
        preferredStat: userData.preferredStat,
        preferredGeneral1: userData.preferredGeneral1,
        preferredGeneral2: userData.preferredGeneral2,
      });
    }
  }, [userData, form]);

  // Form submission
  const onSubmit = (values: z.infer<typeof updateUserPreferencesSchema>) => {
    updatePreferences(values);
  };

  // Loaders
  if (!profile || isPendingProfile) return <Loader explanation="Loading profile" />;

  // Render
  return (
    <div className="pb-3">
      <div className="flex items-center space-x-2 m-2 mb-4">
        <Tabs
          defaultValue={showActive}
          className="flex flex-col items-center justify-center w-full"
          onValueChange={(value) => setShowActive(value)}
        >
          <TabsList className="text-center">
            <TabsTrigger value="preferred">Preferences</TabsTrigger>
            <TabsTrigger value="combat">Settings</TabsTrigger>
            <TabsTrigger value="aiprofile">AI Profile</TabsTrigger>
          </TabsList>
          <TabsContent value="preferred">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="p-4 grid grid-cols-4 gap-3 w-full items-end"
              >
                <FormField
                  control={form.control}
                  name="preferredStat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offense</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value ? value : null)}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={null!}>Highest</SelectItem>
                          <SelectItem value="Ninjutsu">Ninjutsu</SelectItem>
                          <SelectItem value="Genjutsu">Genjutsu</SelectItem>
                          <SelectItem value="Taijutsu">Taijutsu</SelectItem>
                          <SelectItem value="Bukijutsu">Bukijutsu</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="preferredGeneral1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>General 1</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value ? value : null)}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={null!}>Highest</SelectItem>
                          <SelectItem value="Strength">Strength</SelectItem>
                          <SelectItem value="Intelligence">Intelligence</SelectItem>
                          <SelectItem value="Willpower">Willpower</SelectItem>
                          <SelectItem value="Speed">Speed</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="preferredGeneral2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>General 2</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value ? value : null)}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={null!}>Highest</SelectItem>
                          <SelectItem value="Strength">Strength</SelectItem>
                          <SelectItem value="Intelligence">Intelligence</SelectItem>
                          <SelectItem value="Willpower">Willpower</SelectItem>
                          <SelectItem value="Speed">Speed</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">Save</Button>
              </form>
              <FormDescription>
                This will be used as your highest offense type in combat instead of
                automatically choosing the highest stat.
              </FormDescription>
            </Form>
          </TabsContent>
          <TabsContent value="combat">
            <Switch
              id="battle-description"
              checked={userData?.showBattleDescription}
              onCheckedChange={(checked) =>
                updateBattleDescription({ showBattleDescription: checked })
              }
            />
            <Label htmlFor="battle-description">Show battle descriptions</Label>
            <br />
            <br />
            <Confirm
              title="Reset AI Profile"
              button={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!profile?.aiProfileId || isPending}
                >
                  {isPending ? <Loader size={5} /> : "Reset AI Profile"}
                </Button>
              }
              onAccept={() => {
                if (!profile?.aiProfileId) return;
                const defaultAiProfilePayload = {
                  id: profile.aiProfileId,
                  rules: [
                    AiRule.parse({
                      conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
                      action: ActionMoveTowardsOpponent.parse({}),
                    }),
                  ],
                  includeDefaultRules: true,
                };
                updateAiProfile(defaultAiProfilePayload);
              }}
            >
              This will reset your AI profile to default settings. This action cannot be
              undone. Are you sure you want to continue?
            </Confirm>
          </TabsContent>
          <TabsContent value="aiprofile">
            <AiProfileEdit userData={profile} hideTitle />
          </TabsContent>
        </Tabs>
      </div>

      <p className="italic">
        This allows you to change how your character behaves in the game in e.g. kage
        battles.
      </p>
    </div>
  );
};

/**
 * Marriage
 */
const Marriage: React.FC = () => {
  // tRPC utility
  const utils = api.useUtils();

  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  const { data: marriages } = api.marriage.getMarriedUsers.useQuery(
    {},
    {
      staleTime: 300000,
    },
  );

  const { data: requests } = api.marriage.getRequests.useQuery(undefined, {
    staleTime: 300000,
  });

  // How to deal with success responses
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await utils.marriage.getMarriedUsers.invalidate();
      await utils.marriage.getRequests.invalidate();
    }
  };

  // Queries & mutations
  const { data: userData } = useRequiredUserData();
  const { mutate: create, isPending: isCreating } =
    api.marriage.createRequest.useMutation({ onSuccess });
  const { mutate: accept, isPending: isAccepting } =
    api.marriage.acceptRequest.useMutation({ onSuccess });
  const { mutate: reject, isPending: isRejecting } =
    api.marriage.rejectRequest.useMutation({ onSuccess });
  const { mutate: cancel, isPending: isCancelling } =
    api.marriage.cancelRequest.useMutation({ onSuccess });
  const { mutate: divorce } = api.marriage.divorce.useMutation({ onSuccess });

  if (!requests) return <Loader explanation="Loading requests" />;

  //Derived
  const shownRequests = requests.filter((r) => r.status === "PENDING");

  // Render
  return (
    <>
      <Label className="pt-2">Users who are married to you</Label>
      <div className="grid grid-cols-6">
        {marriages?.map((user, i) => {
          return (
            <div
              key={`marriage-${i}`}
              className="flex flex-col items-center relative text-xs"
            >
              <AvatarImage
                href={user.avatar}
                alt={user.username}
                userId={user.userId}
                hover_effect={false}
                size={100}
              />
              {user.username}
              <Ban
                className="h-8 w-8 absolute top-0 right-0 bg-red-500 rounded-full p-1 hover:text-orange-500 hover:cursor-pointer"
                onClick={() => divorce({ userId: user.userId })}
              />
            </div>
          );
        })}
      </div>

      <ContentBox title="Proposals" subtitle="" initialBreak={true} padding={false}>
        <div className="p-3">
          <div className="flex flex-col gap-1">
            <UserSearchSelect
              useFormMethods={userSearchMethods}
              label="Search user you'd like to propose to"
              selectedUsers={[]}
              showYourself={false}
              inline={true}
              maxUsers={maxUsers}
              showAi={false}
            />
          </div>
        </div>
        <div className="p-2">
          <p>Send a proposal to this user</p>
          <Button
            id="send"
            disabled={targetUser === undefined}
            className="mt-2 w-full"
            onClick={() => create({ userId: targetUser?.userId || "" })}
          >
            <SendHorizontal className="h-5 w-5 mr-2" />
            Send Proposal
          </Button>
        </div>
        {shownRequests.length === 0 && (
          <p className="p-2 italic">No current proposals</p>
        )}
        {shownRequests.length > 0 && (
          <UserRequestSystem
            isLoading={isCreating || isAccepting || isRejecting || isCancelling}
            requests={shownRequests}
            userId={userData!.userId}
            onAccept={accept}
            onReject={reject}
            onCancel={cancel}
          />
        )}
      </ContentBox>
    </>
  );
};
/**
 * AI Avatar Change
 */
const NewAiAvatar: React.FC = () => {
  // Queries & mutations
  const { data: userData } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Create new avatar mutation
  const createAvatar = api.avatar.createAvatar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.profile.getUser.invalidate();
      await utils.avatar.getHistoricalAvatars.invalidate();
    },
  });
  const userAttributes = api.profile.getUserAttributes.useQuery(undefined, {
    enabled: !!userData,
  });

  if (createAvatar.isPending) return <Loader explanation="Processing avatar..." />;

  return (
    <div className="flex">
      <div className="basis-1/3">
        {userData && (
          <AvatarImage
            href={userData.avatar}
            alt={userData.username}
            refetchUserData={true}
            size={512}
            priority
          />
        )}
      </div>
      <div className="basis-2/3">
        <h2 className="font-bold">Current Attributes</h2>
        <div className="ml-5 grid grid-cols-2">
          <li key="rank">
            {userData?.rank ? capitalizeFirstLetter(userData.rank) : ""}
          </li>
          {userAttributes.data?.map((attribute) => (
            <li key={attribute.id}>{attribute.attribute}</li>
          ))}
        </div>
        <h2 className="mt-5 font-bold">Create a new avatar</h2>

        {userData && userData?.reputationPoints > 0 ? (
          <>
            <p className="italic">- Costs 1 reputation point</p>
            <Confirm
              title="Confirm Avatar Change"
              button={
                <Button id="create" className="w-full">
                  <SwitchCamera className="h-5 w-5 mr-2" />
                  New Avatar
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                createAvatar.mutate();
              }}
            >
              Changing your avatar will cost 1 reputation point. We would love to enable
              unlimited re-creations, but the model generating the avatars runs on
              NVidia A100 GPU cluster, and each generation costs a little bit of money.
              We are working on a solution to make this free, but for now, we need to
              charge a small fee to cover the cost of the GPU cluster.
            </Confirm>
          </>
        ) : (
          <p className="text-red-500">Requires 1 reputation point</p>
        )}
      </div>
    </div>
  );
};

/**
 * Historical AI Avatar Change
 */
const HistoricalAiAvatar: React.FC = () => {
  // Queries & mutations
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const { data: userData } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Fetch historical avatars query
  const {
    data: historicalAvatars,
    fetchNextPage,
    hasNextPage,
  } = api.avatar.getHistoricalAvatars.useInfiniteQuery(
    {
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const pageAvatars = historicalAvatars?.pages.map((page) => page.data).flat();

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Update avatar mutation
  const updateAvatar = api.avatar.updateAvatar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  // Delete avatar mutation
  const deleteAvatar = api.avatar.deleteAvatar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.avatar.getHistoricalAvatars.invalidate();
      }
    },
  });

  const loading = updateAvatar.isPending || deleteAvatar.isPending;
  if (loading) return <Loader explanation="Processing avatar..." />;

  return (
    <>
      {pageAvatars && (
        <div className="flex flex-wrap">
          {pageAvatars.map((avatar, i) => (
            <div
              key={avatar.id}
              className=" my-2 basis-1/6 relative"
              onClick={() => updateAvatar.mutate({ avatar: avatar.id })}
              ref={i === pageAvatars.length - 1 ? setLastElement : null}
            >
              <AvatarImage
                href={avatar.avatar}
                alt={userData?.username ?? "User Avatar"}
                hover_effect={true}
                size={200}
              />
              <Confirm
                title="Confirm Deletion"
                button={
                  <Trash2 className="absolute right-[8%] top-0 h-9 w-9 border-2 border-black cursor-pointer rounded-full bg-amber-100 fill-slate-500 p-1 hover:text-orange-500" />
                }
                onAccept={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteAvatar.mutate({ avatar: avatar.id });
                }}
              >
                You are about to delete an avatar. Note that this action is permanent.
                Are you sure?
              </Confirm>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

/**
 * Swap village
 */
const SwapVillage: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const [village, setVillage] = useState<Village | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const utils = api.useUtils();

  // Fetch data
  const { data, isFetching } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
    placeholderData: (previousData) => previousData,
  });
  const villages = data
    ?.filter((village) => ["VILLAGE", "OUTLAW"].includes(village.type))
    .map((village) => ({
      ...village,
      image: village.villageLogo,
    }));

  // Mutations
  const { mutate: swap, isPending: isSwapping } = api.village.swapVillage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsOpen(false);
    },
  });

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Derived data
  const canAfford = userData && userData.reputationPoints >= COST_SWAP_BLOODLINE;

  // Show component
  return (
    <div className="mt-2">
      {!isFetching && (
        <ActionSelector
          items={villages?.map((v) => ({ ...v, type: "village" }))}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id == village?.id) {
              setVillage(undefined);
              setIsOpen(false);
            } else {
              setVillage(villages?.find((village) => village.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading villages" />}
      {isOpen && userData && village && (
        <Modal
          title="Confirm Purchase"
          proceed_label={
            isSwapping
              ? undefined
              : canAfford
                ? `Swap for ${COST_SWAP_VILLAGE} reps`
                : `Need ${COST_SWAP_VILLAGE - userData.reputationPoints} reps`
          }
          setIsOpen={setIsOpen}
          isValid={false}
          onAccept={() => {
            if (canAfford) {
              swap({ villageId: village.id });
            } else {
              setIsOpen(false);
            }
          }}
          confirmClassName={
            canAfford
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-red-600 text-white hover:bg-red-700"
          }
        >
          {!isSwapping && <ItemWithEffects item={village} key={village.id} />}
          {isSwapping && <Loader explanation={`Purchasing ${village.name}`} />}
        </Modal>
      )}
    </div>
  );
};

/**
 * Swap bloodline
 */
const SwapBloodline: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const [bloodline, setBloodline] = useState<Bloodline | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const utils = api.useUtils();

  // Fetch data
  const { data: bloodlines, isFetching } = api.bloodline.getAll.useInfiniteQuery(
    { rank: userData?.bloodline?.rank ?? "D", limit: 50 },
    {
      enabled: !!userData,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allBloodlines = bloodlines?.pages.map((page) => page.data).flat();

  // Mutations
  const { mutate: swap, isPending: isSwapping } =
    api.bloodline.swapBloodline.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.profile.getUser.invalidate();
      },
      onSettled: () => {
        document.body.style.cursor = "default";
        setIsOpen(false);
      },
    });

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Derived data
  const isDisabled = userData.bloodline ? false : true;
  const canAfford = userData && userData.reputationPoints >= COST_SWAP_BLOODLINE;

  // Show component
  return (
    <div className="mt-2">
      {!isDisabled && !isFetching && (
        <ActionSelector
          items={allBloodlines}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id == bloodline?.id) {
              setBloodline(undefined);
              setIsOpen(false);
            } else {
              setBloodline(allBloodlines?.find((b) => b.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading bloodlines" />}
      {isDisabled && (
        <div>
          You do not have a bloodline currently. Go{" "}
          <Link className="font-bold" href="/travel">
            travel
          </Link>{" "}
          to the wake island location, and get one in the science building.
        </div>
      )}
      {isOpen && userData && bloodline && (
        <Modal
          title="Confirm Purchase"
          proceed_label={
            isSwapping
              ? undefined
              : canAfford
                ? `Swap for ${COST_SWAP_BLOODLINE} reps`
                : `Need ${COST_SWAP_BLOODLINE - userData.reputationPoints} reps`
          }
          setIsOpen={setIsOpen}
          isValid={false}
          onAccept={() => {
            if (canAfford) {
              swap({ bloodlineId: bloodline.id });
            } else {
              setIsOpen(false);
            }
          }}
          confirmClassName={
            canAfford
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-red-600 text-white hover:bg-red-700"
          }
        >
          {!isSwapping && <ItemWithEffects item={bloodline} key={bloodline.id} />}
          {isSwapping && <Loader explanation={`Purchasing ${bloodline.name}`} />}
        </Modal>
      )}
    </div>
  );
};

/**
 * Reset stats component
 */
const ResetStats: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  if (userData) capUserStats(userData);

  // Mutations
  const { mutate: updateStats } = api.blackmarket.updateStats.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading user" />;

  // Show component
  return (
    <DistributeStatsForm
      forceUseAll
      isRedistribution
      userData={userData}
      onAccept={updateStats}
      availableStats={round(userData.experience + 120)}
    />
  );
};

/**
 * Avatar change component
 */
const AvatarChange: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Get user status
  const userstatus = getUserFederalStatus(userData);

  // If we have federal support
  if (userstatus !== "NONE") {
    return (
      <div className="grid grid-cols-2 pt-2">
        <AvatarImage
          href={userData.avatar}
          alt={userData.userId}
          size={100}
          hover_effect={true}
          priority
        />
        <UploadButton
          endpoint={
            userstatus === "NORMAL"
              ? "avatarNormalUploader"
              : userstatus === "SILVER"
                ? "avatarSilverUploader"
                : "avatarGoldUploader"
          }
          onClientUploadComplete={(res) => {
            if (res?.[0]?.url) {
              setTimeout(() => void utils.profile.getUser.invalidate(), 1000);
            }
          }}
          onUploadError={(error: Error) => {
            showMutationToast({ success: false, message: error.message });
          }}
        />
      </div>
    );
  } else {
    return (
      <Link href="/points">
        <Button id="create" className="w-full my-3">
          Purchase Federal Support
        </Button>
      </Link>
    );
  }
};

/**
 * Attribute change component
 */
const AttributeChange: React.FC = () => {
  // State
  const [hairColor, setHairColor] = useState<(typeof colors)[number]>("Black");
  const [eyeColor, setEyeColor] = useState<(typeof colors)[number]>("Black");
  const [skinColor, setSkinColor] = useState<(typeof skin_colors)[number]>("Light");

  // Queries
  const { data, refetch } = api.profile.getUserAttributes.useQuery(undefined);
  const selectedAttributes = data
    ? data.map((a) => a.attribute as (typeof attributes)[number])
    : [];

  // Mutations
  const { mutate: insertAttr } = api.profile.insertAttribute.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
      }
    },
  });

  const { mutate: deleteAttr } = api.profile.deleteAttribute.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
      }
    },
  });

  return (
    <div className="grid grid-cols-2 pt-2">
      <div className="bg-popover m-3 rounded-md p-3">
        <p className="font-bold">Current </p>
        {selectedAttributes.map((attribute, i) => (
          <div
            key={i}
            className="flex flex-row items-center hover:text-orange-500 hover:cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteAttr({ attribute });
            }}
          >
            <p> - {attribute}</p> <ChevronsRight className="h-5 w-5 ml-1" />
          </div>
        ))}
      </div>
      <div className="bg-popover m-3 rounded-md p-3">
        <p className="font-bold">Available </p>
        {attributes
          .filter((a) => !selectedAttributes.includes(a))
          .map((attribute, i) => (
            <div
              key={i}
              className="flex flex-row items-center hover:text-orange-500 hover:cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                insertAttr({ attribute });
              }}
            >
              <ChevronsLeft className="h-5 w-5 mr-1" />
              <p> {attribute} </p>
            </div>
          ))}
        <div className="mt-3 relative">
          <Select
            onValueChange={(e) => setEyeColor(e as (typeof colors)[number])}
            defaultValue={eyeColor}
            value={eyeColor}
          >
            <Label htmlFor="eye_color">Eye color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="eye_color">
              {colors.map((color, i) => (
                <SelectItem key={i} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => insertAttr({ attribute: "Eyes", color: eyeColor })}
            className="absolute right-0 bottom-0"
          >
            <ChevronsLeft className="h-5 w-5 mr-1" />
          </Button>
        </div>
        <div className="mt-3 relative">
          <Select
            onValueChange={(e) => setSkinColor(e as (typeof skin_colors)[number])}
            defaultValue={skinColor}
            value={skinColor}
          >
            <Label htmlFor="skin_color">Skin color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="skin_color">
              {skin_colors.map((color, i) => (
                <SelectItem key={i} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => insertAttr({ attribute: "Skin", color: skinColor })}
            className="absolute right-0 bottom-0"
          >
            <ChevronsLeft className="h-5 w-5 mr-1" />
          </Button>
        </div>
        <div className="mt-3 relative">
          <Select
            onValueChange={(e) => setHairColor(e as (typeof colors)[number])}
            defaultValue={hairColor}
            value={hairColor}
          >
            <Label htmlFor="hair_color">Hair color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="hair_color">
              {colors.map((color, i) => (
                <SelectItem key={i} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => insertAttr({ attribute: "Hair", color: hairColor })}
            className="absolute right-0 bottom-0"
          >
            <ChevronsLeft className="h-5 w-5 mr-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Nindo change component
 */
const OwnNindoChange: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Mutations
  const { mutate, isPending: isUpdating } = api.profile.updateNindo.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getNindo.invalidate();
      }
    },
  });

  if (isUpdating) return <Loader explanation="Updating nindo..." />;
  if (!userData) return <Loader explanation="Loading profile..." />;

  return (
    <NindoChange
      userId={userData.userId}
      onChange={(data) => mutate({ userId: userData.userId, content: data.content })}
    />
  );
};

/**
 * Re-Roll Primary Element
 */
const RerollElement: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Derived
  const activeElements = getUserElements(userData);

  // Mutations
  const { mutate: roll, isPending: isRolling } =
    api.blackmarket.rerollElement.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  // Loaders
  if (isRolling) return <Loader explanation="Rerolling elements..." />;

  // Guards
  const canAfford = userData && userData.reputationPoints >= COST_REROLL_ELEMENT;
  const canChangeFirst =
    userData?.primaryElement && activeElements[0] === userData.primaryElement;
  const canChangeSecond =
    userData?.secondaryElement && activeElements[1] === userData.secondaryElement;
  const disabled = !canAfford || (!canChangeFirst && !canChangeSecond);

  return (
    <Confirm
      title="Confirm Re-Roll"
      button={
        <Button id="create" type="submit" className="w-full my-3" disabled={disabled}>
          Re-Roll Both Elements
        </Button>
      }
      onAccept={(e) => {
        e.preventDefault();
        roll();
      }}
    >
      Changing your base elements costs {COST_REROLL_ELEMENT} reputation points. Are you
      sure you want to re-roll?
    </Confirm>
  );
};

/**
 * Namechange component
 */
const NameChange: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Username search
  const { form, searchTerm } = useUserSearch();

  // Queries
  const { data: databaseUsername } = api.profile.getUsername.useQuery(
    { username: searchTerm },
    {},
  );

  // Mutations
  const { mutate: updateUsername } = api.profile.updateUsername.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  // Only show if we have userData
  if (!userData) {
    return <Loader explanation="Loading profile page..." />;
  }

  // Derived data
  const errors = form.formState.errors;
  const canBuyUsername = userData.reputationPoints >= COST_CHANGE_USERNAME;
  const error = databaseUsername?.username
    ? `${databaseUsername?.username} already exists`
    : errors.username?.message;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form>
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input id="username" placeholder="Search user" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Confirm
            title="Confirm New Username"
            button={
              <Button
                id="create"
                type="submit"
                className="w-full my-3"
                disabled={!canBuyUsername || searchTerm === "" || error !== undefined}
              >
                {canBuyUsername ? "Update Username" : "Not enough points"}
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              updateUsername({ username: searchTerm });
            }}
          >
            Changing your username costs {COST_CHANGE_USERNAME} reputation points, and
            can only be reverted by purchasing another name change. Are you sure you
            want to change your username to {searchTerm}?
          </Confirm>
        </form>
      </Form>
    </div>
  );
};

/**
 * Custom Title component
 */
const CustomTitle: React.FC = () => {
  // State
  const { data: userData, updateUser } = useRequiredUserData();

  // Mutations
  const { mutate: updateUsername } = api.blackmarket.updateCustomTitle.useMutation({
    onSuccess: async (data, variables) => {
      showMutationToast(data);
      if (data.success) {
        await updateUser({ username: variables.title });
      }
    },
  });

  // Title form
  const FormSchema = z.object({ title: z.string().min(1).max(15) });
  type FormSchemaType = z.infer<typeof FormSchema>;
  const form = useForm<FormSchemaType>({
    resolver: zodResolver(FormSchema),
    defaultValues: { title: "" },
  });
  const curTitle = useWatch({ control: form.control, name: "title" });

  // Form handlers
  const onSubmit = form.handleSubmit((data) => {
    updateUsername(data);
  });

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived data
  const canBuyUsername = userData.reputationPoints >= COST_CHANGE_USERNAME;
  const disabled = curTitle === "" || !canBuyUsername;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input id="username" placeholder="Your title" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Confirm
            title="Confirm Custom Title"
            disabled={disabled}
            button={
              <Button
                id="create"
                type="submit"
                className="w-full my-3"
                disabled={disabled}
              >
                {canBuyUsername ? "Set custom title" : "Not enough points"}
              </Button>
            }
            onAccept={onSubmit}
          >
            Changing your custom title costs {COST_CUSTOM_TITLE} reputation points, and
            can only be changed by requesting another change. Are you sure you want to
            change your title to {curTitle}?
          </Confirm>
        </form>
      </Form>
    </div>
  );
};

/**
 * Change gender component
 */
const ChangeGender: React.FC = () => {
  // State
  const { data: userData, updateUser } = useRequiredUserData();

  // Mutations
  const { mutate: updateUsername } = api.blackmarket.changeUserGender.useMutation({
    onSuccess: async (data, variables) => {
      showMutationToast(data);
      if (data.success) {
        await updateUser({ gender: variables.gender });
      }
    },
  });

  // Title form
  const FormSchema = z.object({ gender: z.enum(genders) });
  type FormSchemaType = z.infer<typeof FormSchema>;
  const form = useForm<FormSchemaType>({
    resolver: zodResolver(FormSchema),
  });
  const watchGender = useWatch({ control: form.control, name: "gender" });

  // Set current user gender
  useEffect(() => {
    if (userData?.gender) {
      form.setValue("gender", userData.gender as Gender);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

  // Form handlers
  const onSubmit = form.handleSubmit((data) => {
    updateUsername(data);
  });

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived data
  const canBuyUsername = userData.reputationPoints >= COST_CHANGE_GENDER;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form>
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <div className="flex flex-row items-center w-full">
                <FormItem className="w-full">
                  <FormLabel>Select gender</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="h-14 text-3xl ">
                        <SelectValue placeholder={userData.gender} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {genders.map((gender, index) => (
                        <SelectItem key={index} value={gender}>
                          {gender}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-row">
                    <FormDescription className="grow">
                      Gender of your ninja
                    </FormDescription>
                    <FormMessage />
                  </div>
                </FormItem>
                <div>
                  <div className="text-7xl basis-full flex-row">
                    {watchGender === "Male" && <p className="text-blue-500 p-2">♂</p>}
                    {watchGender === "Female" && (
                      <p className="text-pink-500 p-2">♀</p>
                    )}
                    {watchGender === "Other" && <p className="text-slate-500 p-2">⚥</p>}
                  </div>
                </div>
              </div>
            )}
          />
          <Confirm
            title="Confirm Gender Change"
            disabled={!canBuyUsername}
            button={
              <Button
                id="create"
                type="submit"
                className="w-full my-3"
                disabled={!canBuyUsername}
              >
                {canBuyUsername ? "Set new gender" : "Not enough points"}
              </Button>
            }
            onAccept={onSubmit}
          >
            Changing your gender costs {COST_CHANGE_GENDER} reputation points, and can
            only be changed by requesting another change. Are you sure you want to
            change your gender to {watchGender}?
          </Confirm>
        </form>
      </Form>
    </div>
  );
};

const AdminControls: React.FC = () => {
  const { mutate: massUnequipAll, isPending: isUnequippingRegular } = api.jutsu.massUnequipAll.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
    },
  });

  const { mutate: massUnequipAllRanked, isPending: isUnequippingRanked } = api.jutsu.massUnequipAllRanked.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
    },
  });

  const isPending = isUnequippingRegular || isUnequippingRanked;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Mass Unequip All Jutsu</h3>
          <p className="text-sm text-muted-foreground">
            This will unequip all jutsu from all users. Use with caution.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="destructive" 
            onClick={() => massUnequipAll()}
            disabled={isPending}
          >
            {isUnequippingRegular ? "Processing..." : "Unequip All Regular"}
          </Button>
          <Button 
            variant="destructive" 
            onClick={() => massUnequipAllRanked()}
            disabled={isPending}
          >
            {isUnequippingRanked ? "Processing..." : "Unequip All Ranked"}
          </Button>
        </div>
      </div>
    </div>
  );
};
