"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Dices,
  Droplets,
  Heart,
  History,
  Loader2,
  Mail,
  Palette,
  PenLine,
  RotateCcw,
  SendHorizontal,
  Settings,
  Shield,
  ShieldOff,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  SwitchCamera,
  Swords,
  Tag,
  Tent,
  Trash2,
  Trophy,
  Type,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ContentType,
  IMG_ORIENTATION,
  TavernColorPreset,
} from "@/drizzle/constants";
import {
  BLOODLINE_SWAP_COOLDOWN_HOURS,
  BLOODLINE_SWAP_FREE_DAYS,
  COST_CHANGE_GENDER,
  COST_CHANGE_USERNAME,
  COST_CUSTOM_TITLE,
  COST_REROLL_ELEMENT,
  COST_RESET_STATS,
  COST_SKILL_RESET,
  COST_SWAP_BLOODLINE,
  COST_SWAP_VILLAGE,
  COST_TAVERN_COLOR_CHANGE,
  getTavernColorChangeCost,
  TavernColorPresets,
} from "@/drizzle/constants";
import type { Bloodline, Village } from "@/drizzle/schema";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useLocalStorage } from "@/hooks/localstorage";
import { FONT_SCALE_OPTIONS, useFontScale } from "@/hooks/useFontScale";
import Accordion from "@/layout/Accordion";
import ActivityStreakPanel from "@/layout/ActivityStreakPanel";
import AiProfileEdit from "@/layout/AiProfileEdit";
import AvatarImage from "@/layout/Avatar";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NindoChange from "@/layout/NindoChange";
import { CurrentSageMode } from "@/layout/SageMode";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  getMobileNavIcon,
  getNavOptionById,
  MOBILE_NAV_OPTIONS,
  MOBILE_NAV_STORAGE_KEY,
  type MobileNavConfig,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";
import { useInfinitePagination } from "@/libs/pagination";
import {
  getTavernTitleClass,
  getTavernUsernameClass,
  TAVERN_COLOR_STYLES,
} from "@/libs/tavernColors";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import type { BaseServerResponse } from "@/server/api/trpc";
import { round } from "@/utils/math";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  canAwardExperience,
  canChangeContent,
  canClearSectors,
  canEnableGlobalTavern,
  canSwapVillage,
  canUnequipAllUsers,
  isStaffMember,
  isStaffRole,
} from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useUserSearch } from "@/utils/search";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import { UploadButton } from "@/utils/uploadthing";
import {
  ActionMoveTowardsOpponent,
  AiRule,
  ConditionDistanceHigherThan,
} from "@/validators/ai";
import type { StatSchemaType } from "@/validators/combat";
import {
  type Attribute,
  attributes,
  type Color,
  colors,
  type Gender,
  genders,
  getSearchValidator,
  type SkinColor,
  skin_colors,
} from "@/validators/register";
import {
  type GenderChangeSchema,
  genderChangeSchema,
  getUserElements,
  type TitleChangeSchema,
  titleChangeSchema,
  updateUserPreferencesSchema,
} from "@/validators/user";

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
      defaultBackHref="/profile"
      padding={false}
    >
      <div className="grid grid-cols-1">
        <Accordion
          title="AI Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Generate a new avatar"
          icon={Sparkles}
          onClick={setActiveElement}
        >
          <NewAiAvatar />
        </Accordion>
        <Accordion
          title="Previous Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Choose an old avatar"
          icon={History}
          onClick={setActiveElement}
        >
          <HistoricalAiAvatar contentType="user" />
        </Accordion>
        <Accordion
          title="Custom Avatar"
          selectedTitle={activeElement}
          unselectedSubtitle="Upload a custom avatar"
          selectedSubtitle={`Avatar size is limited based on federal support status`}
          icon={Upload}
          onClick={setActiveElement}
        >
          <AvatarChange />
        </Accordion>
        <Accordion
          title="User Blacklist"
          selectedTitle={activeElement}
          unselectedSubtitle="Filter away toxic profiles from your feeds"
          icon={Ban}
          onClick={setActiveElement}
        >
          <UserBlacklistControl />
        </Accordion>
        <Accordion
          title="Nindo"
          selectedTitle={activeElement}
          unselectedSubtitle="Your personal way of the ninja"
          icon={PenLine}
          onClick={setActiveElement}
        >
          <OwnNindoChange />
        </Accordion>
        <Accordion
          title="Marriage"
          selectedTitle={activeElement}
          unselectedSubtitle="Manage Marriage"
          icon={Heart}
          onClick={setActiveElement}
        >
          <Marriage />
        </Accordion>
        <Accordion
          title="Activity Rewards"
          selectedTitle={activeElement}
          unselectedSubtitle="View and claim your daily activity streak"
          icon={Trophy}
          onClick={setActiveElement}
        >
          <ActivityStreakPanel />
        </Accordion>
        <Accordion
          title="Name Change"
          selectedTitle={activeElement}
          unselectedSubtitle="Change your username"
          selectedSubtitle={`You can change your username for ${COST_CHANGE_USERNAME} reputation points. You
          have ${userData.reputationPoints} reputation points.`}
          icon={Type}
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
          icon={Tag}
          onClick={setActiveElement}
        >
          <CustomTitle />
        </Accordion>
        <Accordion
          title="Tavern Colors"
          selectedTitle={activeElement}
          unselectedSubtitle="Customize your tavern username and title colors"
          selectedSubtitle={`Each color change costs ${COST_TAVERN_COLOR_CHANGE} reputation points. You have ${userData.reputationPoints} reputation points.`}
          icon={Palette}
          onClick={setActiveElement}
        >
          <TavernColors />
        </Accordion>
        <Accordion
          title="Change Gender"
          selectedTitle={activeElement}
          unselectedSubtitle="Change the gender of your character"
          selectedSubtitle={`Change your gender for ${COST_CHANGE_GENDER} reputation points. You
          have ${userData.reputationPoints} reputation points.`}
          icon={Users}
          onClick={setActiveElement}
        >
          <ChangeGender />
        </Accordion>
        <Accordion
          title="Attribute Management"
          selectedTitle={activeElement}
          unselectedSubtitle="Change character attributes"
          selectedSubtitle={`You can select a total of 5 attributes!`}
          icon={SlidersHorizontal}
          onClick={setActiveElement}
        >
          <AttributeChange />
        </Accordion>
        <Accordion
          title="Reset Stats"
          selectedTitle={activeElement}
          unselectedSubtitle="Redistribute your experience points"
          selectedSubtitle={`You can redistribute your stats for ${COST_RESET_STATS} reputation points. You
          have ${userData.reputationPoints} reputation points. You have ${userData.experience + 120} experience points to distribute.`}
          icon={BarChart3}
          onClick={setActiveElement}
        >
          <ResetStats />
        </Accordion>
        <Accordion
          title="Reset Skills"
          selectedTitle={activeElement}
          unselectedSubtitle="Reset all skill tree investments"
          icon={RotateCcw}
          selectedSubtitle={
            isStaffMember(userData)
              ? `You can reset your skill tree and get all spent skill points back for free as a staff member. You have ${userData.reputationPoints} reputation points.`
              : `You can reset your skill tree and get all spent skill points back for ${COST_SKILL_RESET} reputation points. You have ${userData.reputationPoints} reputation points.`
          }
          onClick={setActiveElement}
        >
          <ResetSkills />
        </Accordion>
        {emailReminder && (
          <Accordion
            title="Email Reminder Settings"
            selectedTitle={activeElement}
            unselectedSubtitle="Manage your email notification preferences"
            icon={Mail}
            onClick={setActiveElement}
          >
            <EmailReminderSettings emailReminder={emailReminder} />
          </Accordion>
        )}
        <Accordion
          title="Re-Roll Elements"
          selectedTitle={activeElement}
          unselectedSubtitle="Re-roll your primary elements"
          icon={Dices}
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
          icon={Swords}
          onClick={setActiveElement}
        >
          <BattleSettingsEdit userId={userData.userId} />
        </Accordion>
        <Accordion
          title="Mobile Navigation"
          selectedTitle={activeElement}
          unselectedSubtitle="Customize mobile navigation bar buttons"
          selectedSubtitle="Choose which shortcuts appear on mobile"
          icon={Smartphone}
          onClick={setActiveElement}
        >
          <MobileNavSettings />
        </Accordion>
        <Accordion
          title="Display Settings"
          selectedTitle={activeElement}
          unselectedSubtitle="Adjust text size for accessibility"
          selectedSubtitle="Choose your preferred text size"
          icon={Settings}
          onClick={setActiveElement}
        >
          <FontScaleSettings />
        </Accordion>
        <Accordion
          title="Swap Bloodline"
          selectedTitle={activeElement}
          unselectedSubtitle="Change your bloodline of choice"
          selectedSubtitle={
            isStaffMember(userData)
              ? `You can swap your bloodline to any bloodline your character has previously possessed for free as a staff member. You must still wait ${BLOODLINE_SWAP_COOLDOWN_HOURS} hours between swaps. Note: Bloodlines purchased directly before 14/06/2025 have not been recorded and can therefore not be swapped. You have ${userData.reputationPoints} reputation points.`
              : `You can swap your bloodline to any bloodline your character has previously possessed for ${COST_SWAP_BLOODLINE} reputation points. You must wait ${BLOODLINE_SWAP_COOLDOWN_HOURS} hours between swaps. Note: Bloodlines purchased directly before 14/06/2025 have not been recorded and can therefore not be swapped. You have ${userData.reputationPoints} reputation points.`
          }
          icon={Droplets}
          onClick={setActiveElement}
        >
          <SwapBloodline />
        </Accordion>
        <Accordion
          title="Sage Mode"
          selectedTitle={activeElement}
          unselectedSubtitle="View or remove your sage mode"
          selectedSubtitle={
            userData.sageModeId
              ? "Your awakened sage mode."
              : "You have not awakened a sage mode yet."
          }
          icon={Sparkles}
          onClick={setActiveElement}
        >
          {userData.sageModeId ? (
            <CurrentSageMode sageModeId={userData.sageModeId} embedded />
          ) : (
            <p className="p-3 italic">You have not awakened a sage mode yet.</p>
          )}
        </Accordion>
        {canSwapVillage(userData.role) && (
          <Accordion
            title="Swap Village"
            selectedTitle={activeElement}
            unselectedSubtitle="Change your village of choice"
            selectedSubtitle={`You can swap your current village for another for ${COST_SWAP_VILLAGE} reputation points. You have ${userData.reputationPoints} reputation points.`}
            icon={Tent}
            onClick={setActiveElement}
          >
            <SwapVillage />
          </Accordion>
        )}
        {userData && isStaffRole(userData.role) && (
          <Accordion
            title="Management Commands"
            selectedTitle={activeElement}
            unselectedSubtitle="Staff Management Commands"
            icon={Shield}
            onClick={setActiveElement}
          >
            <ManagementCommands user={userData} />
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
    <div className="space-y-4 p-4">
      <div className="space-y-2 pb-4">
        <p className="text-muted-foreground text-sm">
          You have email reminders set up for:{" "}
          <span className="font-medium">{emailReminder.email}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Click the button below to manage your email notification preferences.
        </p>
      </div>

      <Link href={emailSettingsUrl} passHref>
        <Button className="flex items-center gap-2">
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
  const [battleDescriptionDraft, setBattleDescriptionDraft] = useState(
    userData?.showBattleDescription ?? false,
  );
  const battleDescriptionRequestRef = useRef(false);
  const preferencesRequestRef = useRef(false);

  // Default auto-combat preference (persisted on the user)
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();

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
  const {
    mutateAsync: updateBattleDescription,
    isPending: isUpdatingBattleDescription,
  } = api.profile.updateBattleDescription.useMutation({
    onSuccess: async () => {
      await utils.profile.getUser.invalidate();
    },
  });

  useEffect(() => {
    if (!battleDescriptionRequestRef.current && userData) {
      setBattleDescriptionDraft(userData.showBattleDescription);
    }
  }, [userData]);

  const handleBattleDescriptionChange = async (checked: boolean) => {
    if (battleDescriptionRequestRef.current) return;

    const previousValue = battleDescriptionDraft;
    battleDescriptionRequestRef.current = true;
    setBattleDescriptionDraft(checked);

    try {
      const result = await updateBattleDescription({
        showBattleDescription: checked,
      });
      if (!result.success) {
        showMutationToast(result);
        setBattleDescriptionDraft(previousValue);
      }
    } catch (error) {
      showMutationToast({
        success: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Could not update the preference",
      });
      setBattleDescriptionDraft(previousValue);
    } finally {
      battleDescriptionRequestRef.current = false;
    }
  };

  const { mutate: updateAiProfile, isPending } = api.ai.updateAiProfile.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.profile.getAi.invalidate(),
          utils.profile.getPublicUser.invalidate(),
        ]);
      }
    },
  });

  // Update highest preferences
  const { mutateAsync: updatePreferences, isPending: isUpdatingPreferences } =
    api.profile.updatePreferences.useMutation();

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
  const onSubmit = async (values: z.infer<typeof updateUserPreferencesSchema>) => {
    if (preferencesRequestRef.current) return;

    preferencesRequestRef.current = true;
    try {
      const result = await updatePreferences(values);
      showMutationToast(result);
      if (result.success) {
        await updateUser({
          preferredStat: values.preferredStat,
          preferredGeneral1: values.preferredGeneral1,
          preferredGeneral2: values.preferredGeneral2,
        });
      }
    } catch {
      // Mutation errors are surfaced by the shared tRPC error handler. Keep the draft.
    } finally {
      preferencesRequestRef.current = false;
    }
  };

  // Loaders
  if (!profile || isPendingProfile) return <Loader explanation="Loading profile" />;

  // Render
  return (
    <div className="pb-3">
      <div className="m-2 mb-4 flex items-center space-x-2">
        <Tabs
          defaultValue={showActive}
          className="flex w-full flex-col items-center justify-center"
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
                className="grid w-full grid-cols-4 items-end gap-3 p-4"
                aria-busy={isUpdatingPreferences}
              >
                <FormField
                  control={form.control}
                  name="preferredStat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offense</FormLabel>
                      <Select
                        disabled={isUpdatingPreferences}
                        onValueChange={(value) =>
                          field.onChange(value === "__highest__" ? null : value)
                        }
                        value={field.value ?? "__highest__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__highest__">Highest</SelectItem>
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
                        disabled={isUpdatingPreferences}
                        onValueChange={(value) =>
                          field.onChange(value === "__highest__" ? null : value)
                        }
                        value={field.value ?? "__highest__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__highest__">Highest</SelectItem>
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
                        disabled={isUpdatingPreferences}
                        onValueChange={(value) =>
                          field.onChange(value === "__highest__" ? null : value)
                        }
                        value={field.value ?? "__highest__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__highest__">Highest</SelectItem>
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
                <Button type="submit" disabled={isUpdatingPreferences}>
                  {isUpdatingPreferences ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span role="status" aria-live="polite">
                        Saving
                      </span>
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </form>
              <FormDescription>
                This will be used as your highest offense type in combat instead of
                automatically choosing the highest stat.
              </FormDescription>
            </Form>
          </TabsContent>
          <TabsContent value="combat">
            <div
              className="flex min-h-8 items-center gap-2"
              aria-busy={isUpdatingBattleDescription}
            >
              <Switch
                id="battle-description"
                checked={battleDescriptionDraft}
                disabled={isUpdatingBattleDescription}
                aria-describedby={
                  isUpdatingBattleDescription ? "battle-description-pending" : undefined
                }
                onCheckedChange={handleBattleDescriptionChange}
              />
              <Label htmlFor="battle-description">Show battle descriptions</Label>
              {isUpdatingBattleDescription && (
                <span
                  id="battle-description-pending"
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 text-muted-foreground text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving
                </span>
              )}
            </div>
            <br />
            <Switch
              id="default-auto-combat"
              checked={autoCombat}
              onCheckedChange={setAutoCombat}
            />
            <Label htmlFor="default-auto-combat">
              Start battles with auto combat (your AI profile fights for you)
            </Label>
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
  const divorceRequestRef = useRef(new Set<string>());
  const [divorcingUserIds, setDivorcingUserIds] = useState(() => new Set<string>());

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
      await Promise.all([
        utils.marriage.getMarriedUsers.invalidate(),
        utils.marriage.getRequests.invalidate(),
      ]);
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
  const { mutateAsync: divorce } = api.marriage.divorce.useMutation({ onSuccess });

  const handleDivorce = async (userId: string) => {
    if (divorceRequestRef.current.has(userId)) return;

    divorceRequestRef.current.add(userId);
    setDivorcingUserIds((current) => new Set(current).add(userId));

    try {
      await divorce({ userId });
    } catch {
      // The shared tRPC error handler surfaces transport errors. Keep the
      // confirmation open so the user can safely retry.
    } finally {
      divorceRequestRef.current.delete(userId);
      setDivorcingUserIds((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  };

  if (!requests) return <Loader explanation="Loading requests" />;

  //Derived
  const shownRequests = requests.filter((r) => r.status === "PENDING");

  // Render
  return (
    <>
      <Label className="pt-2">Users who are married to you</Label>
      <div className="grid grid-cols-6">
        {marriages?.map((user) => {
          const isDivorcing = divorcingUserIds.has(user.userId);

          return (
            <div
              key={user.userId}
              className="relative flex flex-col items-center text-xs"
            >
              <AvatarImage
                href={user.avatar}
                alt={user.username}
                userId={user.userId}
                hover_effect={false}
                size={100}
              />
              {user.username}
              <Confirm
                id={`divorce-${user.userId}`}
                title={`Divorce ${user.username}?`}
                proceed_label="Divorce"
                proceed_loading_label="Divorcing"
                confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                isLoading={isDivorcing}
                keepOpenOnAccept
                disabled={isDivorcing}
                button={
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-0 right-0 h-8 w-8 rounded-full shadow-sm"
                    disabled={isDivorcing}
                    aria-label={
                      isDivorcing
                        ? `Divorcing ${user.username}`
                        : `Divorce ${user.username}`
                    }
                    aria-busy={isDivorcing}
                  >
                    {isDivorcing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Ban className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                }
                onAccept={(event) => {
                  event.preventDefault();
                  void handleDivorce(user.userId);
                }}
              >
                Divorcing {user.username} will immediately end your marriage. This
                action cannot be undone.
              </Confirm>
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
            <SendHorizontal className="mr-2 h-5 w-5" />
            Send Proposal
          </Button>
        </div>
        {shownRequests.length === 0 && (
          <p className="p-2 italic">No current proposals</p>
        )}
        {shownRequests.length > 0 && userData && (
          <UserRequestSystem
            isLoading={isCreating || isAccepting || isRejecting || isCancelling}
            requests={shownRequests}
            userId={userData.userId}
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
      await Promise.all([
        utils.profile.getUser.invalidate(),
        utils.avatar.getHistoricalAvatars.invalidate(),
      ]);
    },
  });
  const userAttributes = api.profile.getUserAttributes.useQuery(undefined, {
    enabled: !!userData,
  });

  if (createAvatar.isPending) return <Loader explanation="Processing" />;

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
                  <SwitchCamera className="mr-2 h-5 w-5" />
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

interface HistoricalAiAvatarProps {
  relationId?: string;
  contentType: ContentType;
  onUpdate?: (url: string) => void;
  size?: IMG_ORIENTATION;
  disabled?: boolean;
  operationGeneration?: number;
}

export const HistoricalAiAvatar: React.FC<HistoricalAiAvatarProps> = (props) => {
  // Queries & mutations
  const [lastElement, setLastElement] = useState<HTMLButtonElement | null>(null);
  const { data: userData } = useRequiredUserData();
  const { size = "square" } = props;
  const disabledRef = useRef(Boolean(props.disabled));
  const operationGenerationRef = useRef(props.operationGeneration ?? 0);
  const updateGenerationRef = useRef<number | null>(null);
  disabledRef.current = Boolean(props.disabled);
  operationGenerationRef.current = props.operationGeneration ?? 0;

  // tRPC utility
  const utils = api.useUtils();

  // Fetch historical avatars query
  const {
    data: historicalAvatars,
    fetchNextPage,
    hasNextPage,
  } = api.avatar.getHistoricalAvatars.useInfiniteQuery(
    {
      relationId: props.relationId,
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const pageAvatars = historicalAvatars?.pages.flatMap((page) => page.data);

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Update avatar mutation
  const updateAvatar = api.avatar.updateAvatar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (
        data.success &&
        data.url &&
        !disabledRef.current &&
        updateGenerationRef.current === operationGenerationRef.current
      ) {
        await utils.profile.getUser.invalidate();
        if (
          props.onUpdate &&
          !disabledRef.current &&
          updateGenerationRef.current === operationGenerationRef.current
        ) {
          props.onUpdate(data.url);
        }
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
  if (loading) return <Loader explanation="Processing" />;

  return (
    <>
      {pageAvatars && (
        <div className="flex flex-wrap">
          {pageAvatars.map((avatar, i) => (
            <button
              type="button"
              key={avatar.id}
              className="relative my-2 basis-1/6"
              disabled={props.disabled}
              onClick={() => {
                if (disabledRef.current) return;
                updateGenerationRef.current = operationGenerationRef.current;
                updateAvatar.mutate({ avatar: avatar.id, type: props.contentType });
              }}
              ref={i === pageAvatars.length - 1 ? setLastElement : null}
            >
              <AvatarImage
                href={avatar.avatar}
                alt={userData?.username ?? "User Avatar"}
                hover_effect={true}
                size={200}
                className={size === "square" ? "aspect-square" : "aspect-auto"}
              />
              <Confirm
                title="Confirm Deletion"
                button={
                  <Trash2 className="absolute top-0 right-[8%] h-9 w-9 cursor-pointer rounded-full border-2 border-black bg-amber-100 fill-slate-500 p-1 hover:text-orange-500" />
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
            </button>
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
  const canAfford = userData && userData.reputationPoints >= COST_SWAP_VILLAGE;

  // Show component
  return (
    <div className="mt-2">
      {!isFetching && (
        <ActionSelector
          items={villages?.map((v) => ({ ...v, type: "village" }))}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === village?.id) {
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
      <Modal
        title="Confirm Purchase"
        proceed_label={
          isSwapping
            ? undefined
            : canAfford
              ? `Swap for ${COST_SWAP_VILLAGE} reps`
              : `Need ${COST_SWAP_VILLAGE - userData.reputationPoints} reps`
        }
        isOpen={isOpen && !!village}
        setIsOpen={setIsOpen}
        isValid={false}
        onAccept={() => {
          if (canAfford && village) {
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
        {village && !isSwapping && <ItemWithEffects item={village} key={village.id} />}
        {isSwapping && village && <Loader explanation="Purchasing" />}
      </Modal>
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
  const { data: bloodlines, isFetching } =
    api.bloodline.getUserHistoricBloodlines.useQuery(undefined);
  const { data: swapInfo } = api.bloodline.getSwapInfo.useQuery(undefined, {
    enabled: !!userData,
  });

  // Mutations
  const { mutate: swap, isPending: isSwapping } =
    api.bloodline.swapBloodline.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.bloodline.getSwapInfo.invalidate(),
        ]);
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

  // Check for free swap eligibility
  const federalStatus = getUserFederalStatus(userData);
  const hasFreeSwapEligibility = federalStatus === "SILVER" || federalStatus === "GOLD";
  const hasFreeSwapAvailable = swapInfo?.isFree ?? false;

  // Calculate when free swap resets (30 days from oldest free swap)
  const getFreeSwapResetTime = () => {
    if (
      !swapInfo?.recentSwaps ||
      swapInfo.recentSwaps.length === 0 ||
      !hasFreeSwapEligibility
    )
      return null;

    const oldestFreeSwap = swapInfo.recentSwaps.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];

    if (!oldestFreeSwap) return null;

    const resetDate = secondsFromDate(
      BLOODLINE_SWAP_FREE_DAYS * DAY_S,
      new Date(oldestFreeSwap.createdAt),
    );
    const now = new Date();
    const secondsUntilReset = Math.floor((resetDate.getTime() - now.getTime()) / 1000);
    return secondsFromNow(secondsUntilReset);
  };

  const freeSwapResetTime = getFreeSwapResetTime();

  // Derived data
  const hasAvailableSwaps = bloodlines && bloodlines.length > 0;
  const isDisabled = !hasAvailableSwaps;
  const isFreeSwap = hasFreeSwapAvailable;
  const canAfford =
    isFreeSwap || (userData && userData.reputationPoints >= COST_SWAP_BLOODLINE);

  // Show component
  return (
    <div className="mt-2 space-y-2">
      {/* Free Swap Timer */}
      {hasFreeSwapEligibility && swapInfo && !swapInfo.isFree && freeSwapResetTime && (
        <div className="mb-4 rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
          <div className="space-y-2 text-center">
            <p className="text-muted-foreground text-sm">
              You have used your free bloodline swap. You must wait for the{" "}
              {BLOODLINE_SWAP_FREE_DAYS}-day reset or pay reputation points.
            </p>
            <p className="font-semibold text-lg">
              Next free bloodline swap available:{" "}
              <Countdown targetDate={freeSwapResetTime} />
            </p>
          </div>
        </div>
      )}
      {!isDisabled && !isFetching && bloodlines && (
        <ActionSelector
          items={bloodlines}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === bloodline?.id) {
              setBloodline(undefined);
              setIsOpen(false);
            } else {
              setBloodline(bloodlines?.find((b) => b.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading bloodlines" />}
      {isDisabled && (
        <div>
          You do not have any bloodlines available to swap to. Go{" "}
          <Link className="font-bold" href="/travel">
            travel
          </Link>{" "}
          to the wake island location, and get bloodlines in the science building to
          build your history.
        </div>
      )}
      <Modal
        title="Confirm Purchase"
        proceed_label={
          isSwapping
            ? undefined
            : isFreeSwap
              ? "Swap for free"
              : canAfford
                ? `Swap for ${COST_SWAP_BLOODLINE} reps`
                : `Need ${COST_SWAP_BLOODLINE - userData.reputationPoints} reps`
        }
        isOpen={isOpen && !!bloodline}
        setIsOpen={setIsOpen}
        isValid={false}
        onAccept={() => {
          if (canAfford && bloodline) {
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
        {bloodline && !isSwapping && (
          <ItemWithEffects item={bloodline} key={bloodline.id} />
        )}
        {isSwapping && bloodline && <Loader explanation="Purchasing" />}
      </Modal>
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
  const submissionInFlight = useRef(false);

  // Mutations
  const { mutateAsync: updateStats, isPending } =
    api.blackmarket.updateStats.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate().catch(() => undefined);
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const submitStatRedistribution = async (data: StatSchemaType) => {
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    try {
      await updateStats(data);
    } catch {
      // The mutation's onError handler displays the actionable error to the user.
    } finally {
      submissionInFlight.current = false;
    }
  };

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading user" />;

  // Calculate total stats available for redistribution
  const totalStats =
    userData.ninjutsuOffence +
    userData.taijutsuOffence +
    userData.genjutsuOffence +
    userData.bukijutsuOffence +
    userData.ninjutsuDefence +
    userData.taijutsuDefence +
    userData.genjutsuDefence +
    userData.bukijutsuDefence +
    userData.strength +
    userData.speed +
    userData.intelligence +
    userData.willpower;

  const cost = canChangeContent(userData.role) ? 0 : COST_RESET_STATS;
  const canAfford = userData.reputationPoints >= cost;

  // Show component
  return (
    <div className="flex flex-col gap-3">
      <p>
        Redistribute all your stats ({totalStats} total points). This will cost {cost}{" "}
        reputation points.
      </p>
      {!canAfford && (
        <p className="font-bold text-red-500">
          You need {cost - userData.reputationPoints} more reputation points to reset
          your stats.
        </p>
      )}
      {canAfford && (
        <DistributeStatsForm
          userData={userData}
          availableStats={round(userData.experience + 120)}
          onAccept={submitStatRedistribution}
          forceUseAll={true}
          isRedistribution={true}
          showWrapper={false}
          isPending={isPending}
          pendingLabel="Redistributing"
        />
      )}
    </div>
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
            const serverData = res?.[0]?.serverData;
            if (serverData?.error) {
              showMutationToast({ success: false, message: serverData.error });
              return;
            }
            if (serverData?.fileUrl) {
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
        <Button id="create" className="my-3 w-full">
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
  const [hairColor, setHairColor] = useState<Color>("Black");
  const [eyeColor, setEyeColor] = useState<Color>("Black");
  const [skinColor, setSkinColor] = useState<SkinColor>("Light");
  const [pendingAttributeAdditions, setPendingAttributeAdditions] = useState<
    Partial<Record<Attribute | "Eyes" | "Skin" | "Hair", string>>
  >({});
  const [pendingAttributeRemovals, setPendingAttributeRemovals] = useState(
    () => new Set<string>(),
  );
  const pendingAttributeAdditionRef = useRef(new Set<string>());
  const pendingAttributeRemovalRef = useRef(new Set<string>());

  // Queries
  const { data, refetch } = api.profile.getUserAttributes.useQuery(undefined);
  const selectedAttributes = data ? data.map((a) => a.attribute as Attribute) : [];

  // Mutations
  const { mutateAsync: insertAttr } = api.profile.insertAttribute.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
      }
    },
  });

  const addAttribute = async (
    attribute: Attribute | "Eyes" | "Skin" | "Hair",
    color?: Color | SkinColor,
  ) => {
    if (pendingAttributeAdditionRef.current.has(attribute)) return;

    const label = color ? `${color} ${attribute}` : attribute;
    pendingAttributeAdditionRef.current.add(attribute);
    setPendingAttributeAdditions((current) => ({
      ...current,
      [attribute]: label,
    }));

    try {
      await insertAttr({ attribute, color });
    } catch {
      // The mutation's existing error handling reports transport failures.
    } finally {
      pendingAttributeAdditionRef.current.delete(attribute);
      setPendingAttributeAdditions((current) => {
        const next = { ...current };
        delete next[attribute];
        return next;
      });
    }
  };

  const { mutateAsync: deleteAttr } = api.profile.deleteAttribute.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
      }
    },
  });

  const removeAttribute = async (attribute: string) => {
    if (pendingAttributeRemovalRef.current.has(attribute)) return;

    pendingAttributeRemovalRef.current.add(attribute);
    setPendingAttributeRemovals((current) => new Set(current).add(attribute));

    try {
      await deleteAttr({ attribute });
    } catch {
      // The shared tRPC error handler reports transport failures. Because the
      // row remains rendered until a successful refetch, it is ready to retry.
    } finally {
      pendingAttributeRemovalRef.current.delete(attribute);
      setPendingAttributeRemovals((current) => {
        const next = new Set(current);
        next.delete(attribute);
        return next;
      });
    }
  };

  return (
    <div className="grid grid-cols-2 pt-2">
      <div className="m-3 rounded-md bg-popover p-3">
        <p className="font-bold">Current </p>
        {selectedAttributes.map((attribute) => {
          const isRemoving = pendingAttributeRemovals.has(attribute);
          return (
            <button
              type="button"
              key={attribute}
              className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRemoving}
              aria-busy={isRemoving}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void removeAttribute(attribute);
              }}
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                  <span aria-live="polite">Removing</span>
                </>
              ) : (
                <>
                  <span> - {attribute}</span>
                  <ChevronsRight className="ml-1 h-5 w-5" />
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="m-3 rounded-md bg-popover p-3">
        <p className="font-bold">Available </p>
        {attributes
          .filter((a) => !selectedAttributes.includes(a))
          .map((attribute) => {
            const pendingLabel = pendingAttributeAdditions[attribute];
            return (
              <button
                type="button"
                key={attribute}
                className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(pendingLabel)}
                aria-busy={Boolean(pendingLabel)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void addAttribute(attribute);
                }}
              >
                {pendingLabel ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                    <span aria-live="polite">Adding</span>
                  </>
                ) : (
                  <>
                    <ChevronsLeft className="mr-1 h-5 w-5" />
                    <span> {attribute} </span>
                  </>
                )}
              </button>
            );
          })}
        <div
          className="relative mt-3"
          aria-busy={Boolean(pendingAttributeAdditions.Eyes)}
        >
          <Select
            onValueChange={(e) => setEyeColor(e as Color)}
            defaultValue={eyeColor}
            value={eyeColor}
            disabled={Boolean(pendingAttributeAdditions.Eyes)}
          >
            <Label htmlFor="eye_color">Eye color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="eye_color">
              {colors.map((color, i) => (
                <SelectItem key={`${color}-${i}`} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void addAttribute("Eyes", eyeColor)}
            className="absolute right-0 bottom-0"
            disabled={Boolean(pendingAttributeAdditions.Eyes)}
            aria-label={
              pendingAttributeAdditions.Eyes
                ? `Adding ${pendingAttributeAdditions.Eyes}`
                : `Add ${eyeColor} Eyes`
            }
          >
            {pendingAttributeAdditions.Eyes ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                <span aria-live="polite">Adding</span>
              </>
            ) : (
              <ChevronsLeft className="h-5 w-5" />
            )}
          </Button>
        </div>
        <div
          className="relative mt-3"
          aria-busy={Boolean(pendingAttributeAdditions.Skin)}
        >
          <Select
            onValueChange={(e) => setSkinColor(e as SkinColor)}
            defaultValue={skinColor}
            value={skinColor}
            disabled={Boolean(pendingAttributeAdditions.Skin)}
          >
            <Label htmlFor="skin_color">Skin color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="skin_color">
              {skin_colors.map((color, i) => (
                <SelectItem key={`${color}-${i}`} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void addAttribute("Skin", skinColor)}
            className="absolute right-0 bottom-0"
            disabled={Boolean(pendingAttributeAdditions.Skin)}
            aria-label={
              pendingAttributeAdditions.Skin
                ? `Adding ${pendingAttributeAdditions.Skin}`
                : `Add ${skinColor} Skin`
            }
          >
            {pendingAttributeAdditions.Skin ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                <span aria-live="polite">Adding</span>
              </>
            ) : (
              <ChevronsLeft className="h-5 w-5" />
            )}
          </Button>
        </div>
        <div
          className="relative mt-3"
          aria-busy={Boolean(pendingAttributeAdditions.Hair)}
        >
          <Select
            onValueChange={(e) => setHairColor(e as Color)}
            defaultValue={hairColor}
            value={hairColor}
            disabled={Boolean(pendingAttributeAdditions.Hair)}
          >
            <Label htmlFor="hair_color">Hair color</Label>
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="hair_color">
              {colors.map((color, i) => (
                <SelectItem key={`${color}-${i}`} value={color}>
                  {color}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void addAttribute("Hair", hairColor)}
            className="absolute right-0 bottom-0"
            disabled={Boolean(pendingAttributeAdditions.Hair)}
            aria-label={
              pendingAttributeAdditions.Hair
                ? `Adding ${pendingAttributeAdditions.Hair}`
                : `Add ${hairColor} Hair`
            }
          >
            {pendingAttributeAdditions.Hair ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                <span aria-live="polite">Adding</span>
              </>
            ) : (
              <ChevronsLeft className="h-5 w-5" />
            )}
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

  if (isUpdating) return <Loader explanation="Updating" />;
  if (!userData) return <Loader explanation="Loading profile..." />;

  return (
    <NindoChange
      userId={userData.userId}
      onChange={(data) => mutate({ userId: userData.userId, content: data.content })}
    />
  );
};

interface ElementRerollButtonProps {
  elementType: "primary" | "secondary";
  canAfford: boolean;
  canChange: boolean;
  onReroll: (elementType: "primary" | "secondary") => void;
}

const ElementRerollButton: React.FC<ElementRerollButtonProps> = ({
  elementType,
  canAfford,
  canChange,
  onReroll,
}) => (
  <Confirm
    title={`Confirm ${elementType.charAt(0).toUpperCase() + elementType.slice(1)} Element Re-Roll`}
    button={
      <Button
        id={`reroll-${elementType}`}
        type="submit"
        className="w-full"
        disabled={!canAfford || !canChange}
      >
        Re-Roll {elementType.charAt(0).toUpperCase() + elementType.slice(1)} Element
      </Button>
    }
    onAccept={(e) => {
      e.preventDefault();
      onReroll(elementType);
    }}
  >
    Rerolling your {elementType} element costs {COST_REROLL_ELEMENT} reputation points.
    Are you sure you want to re-roll your {elementType} element?
  </Confirm>
);

/**
 * Re-Roll Elements
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
  if (isRolling) return <Loader explanation="Rerolling" />;

  // Guards
  const canAfford = userData && userData.reputationPoints >= COST_REROLL_ELEMENT;
  const canChangeFirst =
    userData?.primaryElement && activeElements[0] === userData.primaryElement;
  const canChangeSecond =
    userData?.secondaryElement && activeElements[1] === userData.secondaryElement;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <ElementRerollButton
          elementType="primary"
          canAfford={canAfford ?? false}
          canChange={canChangeFirst ?? false}
          onReroll={(elementType) => roll({ elementType })}
        />
        <ElementRerollButton
          elementType="secondary"
          canAfford={canAfford ?? false}
          canChange={canChangeSecond ?? false}
          onReroll={(elementType) => roll({ elementType })}
        />
      </div>
    </div>
  );
};

/**
 * Namechange component
 */
const NameChange: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const [showNameChangeConfirm, setShowNameChangeConfirm] = useState(false);
  const [isChangingUsername, setIsChangingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const usernameRequestRef = useRef(false);

  // Username search
  const { form, searchTerm } = useUserSearch();

  // Queries
  const { data: databaseUsername } = api.profile.getUsername.useQuery(
    { username: searchTerm },
    {},
  );

  // Mutations
  const { mutateAsync: updateUsername } = api.profile.updateUsername.useMutation();

  const handleUsernameChange = async () => {
    if (usernameRequestRef.current) return;

    const submittedUsername = usernameDraft;
    usernameRequestRef.current = true;
    setIsChangingUsername(true);
    try {
      const data = await updateUsername({ username: submittedUsername });
      showMutationToast(data);
      if (data.success) {
        // The paid mutation has already committed. A failed cache refresh must
        // not leave the confirmation retryable and charge the user twice.
        await utils.profile.getUser.invalidate().catch(() => undefined);
        setShowNameChangeConfirm(false);
      } else {
        setUsernameDraft(submittedUsername);
        form.setValue("username", submittedUsername, { shouldValidate: true });
      }
    } catch {
      // The shared tRPC error handler surfaces transport failures. Leave the
      // confirmation and draft open so the user can correct or retry it.
      setUsernameDraft(submittedUsername);
      form.setValue("username", submittedUsername, { shouldValidate: true });
    } finally {
      usernameRequestRef.current = false;
      setIsChangingUsername(false);
    }
  };

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
        <form
          aria-busy={isChangingUsername}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !isChangingUsername &&
              canBuyUsername &&
              usernameDraft !== "" &&
              error === undefined
            ) {
              setShowNameChangeConfirm(true);
            }
          }}
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    {...field}
                    id="username"
                    placeholder="Search user"
                    value={usernameDraft}
                    readOnly={isChangingUsername}
                    aria-disabled={isChangingUsername}
                    className={
                      isChangingUsername ? "cursor-not-allowed opacity-50" : undefined
                    }
                    onChange={(event) => {
                      field.onChange(event);
                      setUsernameDraft(event.target.value);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            id="create"
            type="submit"
            className="my-3 w-full"
            disabled={
              isChangingUsername ||
              !canBuyUsername ||
              usernameDraft === "" ||
              error !== undefined
            }
          >
            {canBuyUsername ? "Update Username" : "Not enough points"}
          </Button>
          <Modal
            title="Confirm New Username"
            isOpen={showNameChangeConfirm}
            setIsOpen={setShowNameChangeConfirm}
            proceed_label="Change username"
            proceed_loading_label="Changing"
            isLoading={isChangingUsername}
            keepOpenOnAccept
            onAccept={(e) => {
              e.preventDefault();
              void handleUsernameChange();
            }}
          >
            Changing your username costs {COST_CHANGE_USERNAME} reputation points, and
            can only be reverted by purchasing another name change. Are you sure you
            want to change your username to {usernameDraft}?
          </Modal>
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
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const [showCustomTitleConfirm, setShowCustomTitleConfirm] = useState(false);
  const [isUpdatingCustomTitle, setIsUpdatingCustomTitle] = useState(false);
  const customTitleRequestRef = useRef(false);

  // Mutations
  const { mutateAsync: updateCustomTitle } =
    api.blackmarket.updateCustomTitle.useMutation();

  // Title form
  const form = useForm<TitleChangeSchema>({
    resolver: zodResolver(titleChangeSchema),
    defaultValues: { title: "" },
  });
  const curTitle = useWatch({ control: form.control, name: "title" });

  // Form handlers
  const onSubmit = form.handleSubmit(() => {
    if (!isUpdatingCustomTitle) setShowCustomTitleConfirm(true);
  });

  const handleCustomTitleChange = async () => {
    if (customTitleRequestRef.current) return;

    const submittedTitle = form.getValues("title");
    customTitleRequestRef.current = true;
    setIsUpdatingCustomTitle(true);

    try {
      const data = await updateCustomTitle({ title: submittedTitle });
      showMutationToast(data);
      if (data.success) {
        // The purchase already succeeded at this point; a cache refresh failure
        // must not leave a retryable dialog that could charge the user again.
        await utils.profile.getUser.invalidate().catch(() => undefined);
        setShowCustomTitleConfirm(false);
      } else {
        form.setValue("title", submittedTitle, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch {
      // The shared tRPC error handler surfaces transport failures. Keep the
      // confirmation and draft open so the user can safely retry.
      form.setValue("title", submittedTitle, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } finally {
      customTitleRequestRef.current = false;
      setIsUpdatingCustomTitle(false);
    }
  };

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived data
  const canBuyTitle = userData.reputationPoints >= COST_CUSTOM_TITLE;
  const disabled = isUpdatingCustomTitle || curTitle === "" || !canBuyTitle;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form onSubmit={onSubmit} aria-busy={isUpdatingCustomTitle}>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    id="custom-title"
                    placeholder="Your title"
                    readOnly={isUpdatingCustomTitle}
                    aria-disabled={isUpdatingCustomTitle}
                    className={
                      isUpdatingCustomTitle
                        ? "cursor-not-allowed opacity-50"
                        : undefined
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            id="set-custom-title"
            type="submit"
            className="my-3 w-full"
            disabled={disabled}
          >
            {canBuyTitle ? "Set custom title" : "Not enough points"}
          </Button>
          <Modal
            title="Confirm Custom Title"
            isOpen={showCustomTitleConfirm}
            setIsOpen={setShowCustomTitleConfirm}
            proceed_label="Set custom title"
            proceed_loading_label="Setting"
            isLoading={isUpdatingCustomTitle}
            keepOpenOnAccept
            onAccept={(event) => {
              event.preventDefault();
              void handleCustomTitleChange();
            }}
          >
            Changing your custom title costs {COST_CUSTOM_TITLE} reputation points, and
            can only be changed by requesting another change. Are you sure you want to
            change your title to {curTitle}?
          </Modal>
        </form>
      </Form>
    </div>
  );
};

/** Preset-only tavern styling controls. Username and title are separate purchases. */
const TavernColors: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const [usernameColor, setUsernameColor] = useState<TavernColorPreset>(
    userData?.tavernUsernameColor ?? "DEFAULT",
  );
  const [titleColor, setTitleColor] = useState<TavernColorPreset>(
    userData?.tavernTitleColor ?? "DEFAULT",
  );

  useEffect(() => {
    if (userData) {
      setUsernameColor(userData.tavernUsernameColor);
      setTitleColor(userData.tavernTitleColor);
    }
  }, [userData?.tavernUsernameColor, userData?.tavernTitleColor]);

  const updateColor = api.profile.updateTavernColor.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) await utils.profile.getUser.invalidate();
    },
  });

  if (!userData) return <Loader explanation="Loading tavern colors" />;

  const controls: Array<{
    target: "username" | "title";
    label: string;
    value: TavernColorPreset;
    current: TavernColorPreset;
    setValue: (value: TavernColorPreset) => void;
  }> = [
    {
      target: "username",
      label: "Username color",
      value: usernameColor,
      current: userData.tavernUsernameColor,
      setValue: setUsernameColor,
    },
    {
      target: "title",
      label: "Title badge color",
      value: titleColor,
      current: userData.tavernTitleColor,
      setValue: setTitleColor,
    },
  ];

  return (
    <div className="grid gap-6 p-4 md:grid-cols-2">
      {controls.map((control) => {
        const cost = getTavernColorChangeCost(control.value);
        const unchanged = control.value === control.current;
        const canAfford = userData.reputationPoints >= cost;
        const isThisPending =
          updateColor.isPending && updateColor.variables?.target === control.target;
        const disabled = unchanged || !canAfford || updateColor.isPending;

        return (
          <section key={control.target} className="space-y-4 rounded-lg border p-4">
            <fieldset>
              <legend className="font-semibold text-lg">{control.label}</legend>
              <p className="mb-3 text-muted-foreground text-sm">
                Current: {TAVERN_COLOR_STYLES[control.current].label}. Every change
                costs {COST_TAVERN_COLOR_CHANGE} reputation.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TavernColorPresets.map((preset) => {
                  const style = TAVERN_COLOR_STYLES[preset];
                  const selected = control.value === preset;
                  return (
                    <label
                      key={preset}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-poppopover ${
                        selected ? "ring-2 ring-primary" : ""
                      } ${updateColor.isPending ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`tavern-${control.target}-color`}
                        value={preset}
                        checked={selected}
                        aria-label={`${control.label}: ${style.label}`}
                        className="sr-only"
                        onChange={() => control.setValue(preset)}
                        disabled={updateColor.isPending}
                      />
                      <span
                        aria-hidden="true"
                        className={`h-6 w-6 shrink-0 rounded-full border ${style.swatchClass}`}
                      />
                      {style.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="rounded-md bg-popover p-3 text-center">
              <p className="mb-2 text-muted-foreground text-xs">Live preview</p>
              {control.target === "username" ? (
                <span
                  className={`${
                    control.value === "DEFAULT"
                      ? "text-popover-foreground"
                      : getTavernUsernameClass(control.value)
                  } font-bold`}
                >
                  {userData.username}
                </span>
              ) : (
                <span
                  className={`m-1 rounded-md p-1 ${getTavernTitleClass(control.value)}`}
                >
                  {userData.customTitle || "Custom title preview"}
                </span>
              )}
            </div>

            <Confirm
              title={`Confirm ${control.label}`}
              disabled={disabled}
              button={
                <Button type="button" className="w-full" disabled={disabled}>
                  {isThisPending ? (
                    <Loader size={5} />
                  ) : unchanged ? (
                    "Already selected"
                  ) : !canAfford ? (
                    `Need ${cost - userData.reputationPoints} More Reps`
                  ) : (
                    `Apply for ${cost} Reps`
                  )}
                </Button>
              }
              onAccept={(event) => {
                event.preventDefault();
                updateColor.mutate({
                  target: control.target,
                  color: control.value,
                });
              }}
            >
              Change your tavern {control.target} color to{" "}
              {TAVERN_COLOR_STYLES[control.value].label} for {cost} reputation points?
            </Confirm>
          </section>
        );
      })}
      <p className="text-muted-foreground text-sm md:col-span-2">
        Username and title choices are purchased independently. Tavern colors never
        appear in inbox, support, forums, or other posts. Staff role styling remains
        authoritative, while Default keeps the existing supporter username style.
      </p>
    </div>
  );
};

/**
 * Change gender component
 */
const ChangeGender: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const [showGenderConfirmation, setShowGenderConfirmation] = useState(false);
  const [isChangingGender, setIsChangingGender] = useState(false);
  const genderChangeRequestRef = useRef(false);

  // Mutations
  const { mutateAsync: changeGender } = api.blackmarket.changeUserGender.useMutation();

  // Gender form
  const form = useForm<GenderChangeSchema>({
    resolver: zodResolver(genderChangeSchema),
    defaultValues: { gender: userData?.gender as Gender | undefined },
  });
  const watchGender = useWatch({ control: form.control, name: "gender" });

  // Set current user gender
  useEffect(() => {
    if (userData?.gender) {
      form.setValue("gender", userData.gender as Gender);
    }
  }, [userData]);

  // Form handlers
  const onSubmit = form.handleSubmit(() => {
    if (!isChangingGender) setShowGenderConfirmation(true);
  });

  const handleGenderChange = async () => {
    if (genderChangeRequestRef.current || !userData) return;

    const submittedGender = form.getValues("gender");
    genderChangeRequestRef.current = true;
    setIsChangingGender(true);

    try {
      const data = await changeGender({ gender: submittedGender });
      showMutationToast(data);
      if (data.success) {
        // The purchase already succeeded at this point. Refresh gender and balance
        // from the server once, then close even if the refresh fails, so stale cached
        // reputation cannot overwrite a concurrent mutation or enable a repeat charge.
        await utils.profile.getUser.invalidate().catch(() => undefined);
        setShowGenderConfirmation(false);
      } else {
        form.setValue("gender", submittedGender, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch {
      // The shared tRPC error handler surfaces transport failures. Keep the
      // confirmation and selected gender open so the user can retry.
      form.setValue("gender", submittedGender, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } finally {
      genderChangeRequestRef.current = false;
      setIsChangingGender(false);
    }
  };

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Derived data
  const canBuyGender = userData.reputationPoints >= COST_CHANGE_GENDER;

  return (
    <div className="grid grid-cols-1">
      <Form {...form}>
        <form onSubmit={onSubmit} aria-busy={isChangingGender}>
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <div className="flex w-full flex-row items-center">
                <FormItem className="w-full">
                  <FormLabel>Select gender</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                    disabled={isChangingGender}
                  >
                    <FormControl>
                      <SelectTrigger className="h-14 text-3xl">
                        <SelectValue placeholder={userData.gender} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {genders.map((gender, i) => (
                        <SelectItem key={`${gender}-${i}`} value={gender}>
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
                  <div className="basis-full flex-row text-7xl">
                    {watchGender === "Male" && <p className="p-2 text-blue-500">♂</p>}
                    {watchGender === "Female" && <p className="p-2 text-pink-500">♀</p>}
                    {watchGender === "Other" && <p className="p-2 text-slate-500">⚥</p>}
                  </div>
                </div>
              </div>
            )}
          />
          <Button
            id="change-gender"
            type="submit"
            className="my-3 w-full"
            disabled={!canBuyGender || isChangingGender}
          >
            {canBuyGender ? "Set new gender" : "Not enough points"}
          </Button>
          <Modal
            title="Confirm Gender Change"
            isOpen={showGenderConfirmation}
            setIsOpen={setShowGenderConfirmation}
            proceed_label="Set new gender"
            proceed_loading_label="Changing"
            isLoading={isChangingGender}
            keepOpenOnAccept
            onAccept={(event) => {
              event.preventDefault();
              void handleGenderChange();
            }}
          >
            Changing your gender costs {COST_CHANGE_GENDER} reputation points, and can
            only be changed by requesting another change. Are you sure you want to
            change your gender to {watchGender}?
          </Modal>
        </form>
      </Form>
    </div>
  );
};

/**
 * Site Management Functionality
 */
interface ManagementCommandsProps {
  user: NonNullable<UserWithRelations>;
}
const ManagementCommands: React.FC<ManagementCommandsProps> = ({ user }) => {
  // State for sector selection
  const [sectorNumber, setSectorNumber] = useState<number>(1);
  // State for mass experience award
  const [experienceAmount, setExperienceAmount] = useState<number>(100);

  // Utility
  const utils = api.useUtils();

  // Global tavern toggle
  const { data: globalTavernEnabled = true } =
    api.misc.getGlobalTavernEnabled.useQuery();
  const { mutate: toggleGlobalTavern, isPending: isTogglingTavern } =
    api.misc.toggleGlobalTavern.useMutation({
      onSuccess: (result) => {
        showMutationToast(result);
        void utils.misc.getGlobalTavernEnabled.invalidate();
      },
    });

  // Mutations
  const { mutate: unequipAllGear, isPending: isUnequipping } =
    api.staff.unequipAllGear.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.item.getUserItems.invalidate(),
          ]);
        }
      },
    });

  const { mutate: unequipAllJutsus, isPending: isUnequippingJutsus } =
    api.staff.unequipAllJutsus.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.jutsu.getUserJutsus.invalidate(),
          ]);
        }
      },
    });

  const { mutate: releaseSector, isPending: isReleasingSector } =
    api.staff.releaseSector.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.travel.getSectorData.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
        }
      },
    });

  const { mutate: awardExperienceToAll, isPending: isAwardingExperience } =
    api.profile.awardExperienceToAll.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: resetAllUsersSkillPoints, isPending: isResettingSkillTrees } =
    api.skillTree.resetAllUsersSkillPoints.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.skillTree.getUserSkills.invalidate(),
          ]);
        }
      },
    });

  // Show options
  return (
    <div className="grid grid-cols-3 items-center gap-4 p-4">
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Unequip All Gear"
          button={
            <Button variant="destructive" disabled={isUnequipping} className="w-full">
              {isUnequipping ? (
                <Loader size={5} />
              ) : (
                <>
                  <ShieldOff className="mr-2 h-4 w-4" />
                  Unequip All Gear
                </>
              )}
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            unequipAllGear();
          }}
        >
          This will unequip all currently equipped gear <b>FOR ALL NON-AI USERS</b> and
          clear all of their item loadouts (AI opponents are left unchanged). Are you
          sure you want to continue?
        </Confirm>
      )}
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Unequip All Jutsus"
          button={
            <Button
              variant="destructive"
              disabled={isUnequippingJutsus}
              className="w-full"
            >
              {isUnequippingJutsus ? (
                <Loader size={5} />
              ) : (
                <>
                  <ShieldOff className="mr-2 h-4 w-4" />
                  Unequip All Jutsus
                </>
              )}
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            unequipAllJutsus();
          }}
        >
          This will unequip all currently equipped jutsus <b>FOR ALL NON-AI USERS</b>{" "}
          and clear all of their jutsu loadouts (AI opponents are left unchanged). Are
          you sure you want to continue?
        </Confirm>
      )}
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Reset All Skill Trees"
          button={
            <Button
              variant="destructive"
              disabled={isResettingSkillTrees}
              className="w-full"
            >
              {isResettingSkillTrees ? (
                <Loader size={5} />
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Reset All Skill Trees
                </>
              )}
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            resetAllUsersSkillPoints();
          }}
        >
          This will reset all users&apos; skill trees and refund their skill points{" "}
          <b>FOR ALL USERS</b>. Are you sure you want to continue?
        </Confirm>
      )}
      {canAwardExperience(user) && (
        <Confirm
          title="Confirm Mass Experience Award"
          button={
            <Button
              variant="default"
              disabled={isAwardingExperience}
              className="w-full bg-green-500"
            >
              {isAwardingExperience ? (
                <Loader size={5} />
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Award Experience to All
                </>
              )}
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            awardExperienceToAll({ amount: experienceAmount });
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="experienceAmount">Experience Amount</Label>
              <Input
                id="experienceAmount"
                type="number"
                min={1}
                max={100000}
                value={experienceAmount}
                onChange={(e) =>
                  setExperienceAmount(parseInt(e.target.value, 10) || 100)
                }
                className="w-32"
              />
            </div>
            <p>
              This will award <b>{experienceAmount}</b> experience points to{" "}
              <b>ALL USERS</b>. Are you sure you want to continue?
            </p>
          </div>
        </Confirm>
      )}
      {canClearSectors(user.role) && (
        <Confirm
          title="Confirm Clear Sector"
          button={
            <Button
              variant="destructive"
              disabled={isReleasingSector}
              className="w-full"
            >
              {isReleasingSector ? (
                <Loader size={5} />
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Sector
                </>
              )}
            </Button>
          }
          onAccept={(e) => {
            e.preventDefault();
            releaseSector({ sector: sectorNumber });
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="sectorNumber">Sector #</Label>
              <Input
                id="sectorNumber"
                type="number"
                min={1}
                value={sectorNumber}
                onChange={(e) => setSectorNumber(parseInt(e.target.value, 10) || 1)}
                className="w-20"
              />
            </div>
            <p>
              This will clear sector <b>{sectorNumber}</b> ownership from the database.
              Are you sure you want to continue?
            </p>
          </div>
        </Confirm>
      )}
      {canEnableGlobalTavern(user.role) && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-popover px-3 py-2">
          <Label htmlFor="globalTavernToggle" className="font-medium text-sm">
            Global Tavern
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {globalTavernEnabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              id="globalTavernToggle"
              checked={!!globalTavernEnabled}
              onCheckedChange={(checked) => {
                toggleGlobalTavern({ enabled: checked });
              }}
              disabled={isTogglingTavern}
              aria-label="Toggle global tavern"
            />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Reset skills component
 */
const ResetSkills: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Get reset info
  const { data: resetInfo } = api.skillTree.getResetInfo.useQuery();

  // Mutations
  const { mutate: resetSkills, isPending } = api.skillTree.resetSkillPoints.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.skillTree.getUserSkills.invalidate(),
            utils.skillTree.getResetInfo.invalidate(),
          ]);
        }
      },
    },
  );

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading user" />;

  // Guards
  const isFree = resetInfo?.isFree;
  const canAffordPaid = userData.reputationPoints >= COST_SKILL_RESET;
  const canAfford = Boolean(isFree) || canAffordPaid;

  // Calculate when skill resets reset (monthly - 1st of next month)
  const now = new Date();
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  const secondsUntilNextMonth = Math.floor(
    (nextMonth.getTime() - now.getTime()) / 1000,
  );
  const skillResetResetTime = secondsFromNow(secondsUntilNextMonth);

  return (
    <div className="space-y-4 p-4">
      {/* Skill Reset Timer */}
      {resetInfo && !resetInfo.isFree && (
        <div className="mb-4 rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
          <div className="space-y-2 text-center">
            <p className="text-muted-foreground text-sm">
              You have used {resetInfo.freeResetsUsed} free skill resets this month.
              {resetInfo.freeResetsRemaining === 0 &&
                " You must wait for monthly reset or pay reputation points."}
            </p>
            <p className="font-semibold text-lg">
              Next free skill reset available:{" "}
              <Countdown targetDate={skillResetResetTime} />
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2 pb-4">
        <p className="text-muted-foreground text-sm">
          This will reset all your skill tree investments and refund all spent skill
          points.
        </p>
      </div>

      <Confirm
        title="Confirm Skill Reset"
        button={
          <Button
            id="reset-skills"
            type="submit"
            className="w-full"
            disabled={!canAfford || isPending}
            variant={canAfford ? "default" : "destructive"}
          >
            {isPending ? (
              <Loader size={5} />
            ) : isFree ? (
              isStaffMember(userData) ? (
                "Reset Skills (Free for staff)"
              ) : (
                `Reset Skills (${resetInfo?.freeResetsRemaining} free GOLD resets remaining)`
              )
            ) : canAffordPaid ? (
              `Reset Skills for ${COST_SKILL_RESET} Reps`
            ) : (
              `Need ${COST_SKILL_RESET - userData.reputationPoints} More Reps`
            )}
          </Button>
        }
        onAccept={(e) => {
          e.preventDefault();
          resetSkills();
        }}
      >
        This will reset all your skill tree investments and refund all spent skill
        points
        {isFree
          ? isStaffMember(userData)
            ? " (Free for staff member)"
            : " (Free GOLD monthly reset)"
          : ` for ${COST_SKILL_RESET} reputation points`}
        . This action cannot be undone. Are you sure you want to continue?
      </Confirm>
    </div>
  );
};

/**
 * Mobile Navigation Settings component
 */
const MobileNavSettings: React.FC = () => {
  const [config, setConfig] = useLocalStorage<MobileNavConfig>(
    MOBILE_NAV_STORAGE_KEY,
    DEFAULT_MOBILE_NAV_CONFIG,
  );

  const normalizedConfig = normalizeMobileNavConfig(config);

  // Get all selected IDs to filter duplicates
  const selectedIds = [...normalizedConfig.left, ...normalizedConfig.right];

  const handleLeftChange = (index: number, newId: string) => {
    const newLeft = [...normalizedConfig.left];
    newLeft[index] = newId;
    setConfig({ ...normalizedConfig, left: newLeft });
  };

  const handleRightChange = (index: number, newId: string) => {
    const newRight = [...normalizedConfig.right];
    newRight[index] = newId;
    setConfig({ ...normalizedConfig, right: newRight });
  };

  const handleReset = () => {
    setConfig(DEFAULT_MOBILE_NAV_CONFIG);
  };

  const renderSlotSelector = (
    currentId: string,
    onChange: (newId: string) => void,
    label: string,
  ) => {
    const Icon = getMobileNavIcon(currentId);
    return (
      <div className="flex items-center gap-2">
        <Label className="w-16 text-sm">{label}</Label>
        <Select value={currentId} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{getNavOptionById(currentId)?.name}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MOBILE_NAV_OPTIONS.map((option) => {
              const OptionIcon = getMobileNavIcon(option.id);
              const isDisabled =
                selectedIds.includes(option.id) && option.id !== currentId;
              return (
                <SelectItem key={option.id} value={option.id} disabled={isDisabled}>
                  <div className="flex items-center gap-2">
                    <OptionIcon className="h-4 w-4" />
                    <span>{option.name}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-4 p-3">
      <p className="text-muted-foreground text-sm">
        Customize the 5 buttons shown in your mobile navigation bar. The center button
        automatically shows Village or Travel based on your location. Note: If you
        configure Travel in a slot, it will be hidden when outside the village (since
        the center button already shows Travel in that case).
      </p>

      <div className="space-y-3">
        <div className="font-semibold text-sm">Left Side (2 buttons)</div>
        {normalizedConfig.left.map((id, index) => (
          <div key={`left-${index}`}>
            {renderSlotSelector(
              id,
              (newId) => handleLeftChange(index, newId),
              `Slot ${index + 1}`,
            )}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="font-semibold text-sm">Right Side (3 buttons)</div>
        {normalizedConfig.right.map((id, index) => (
          <div key={`right-${index}`}>
            {renderSlotSelector(
              id,
              (newId) => handleRightChange(index, newId),
              `Slot ${index + 1}`,
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={handleReset}>
        Reset to Default
      </Button>
    </div>
  );
};

/**
 * Font Scale Settings component
 */
const FontScaleSettings: React.FC = () => {
  const { fontScale, setFontScale } = useFontScale();

  return (
    <div className="space-y-4 p-3">
      <p className="text-muted-foreground text-sm">
        Adjust text size for better readability. This affects all text throughout the
        game.
      </p>

      <div className="space-y-2">
        <Label>Text Size</Label>
        <Select
          value={String(fontScale)}
          onValueChange={(v) => setFontScale(Number(v) as typeof fontScale)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SCALE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded border p-3">
        <p className="font-bold">Preview</p>
        <p>This is how your text will appear throughout the game.</p>
      </div>
    </div>
  );
};
