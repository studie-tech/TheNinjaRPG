"use client";

import {
  Ban,
  BarChart3,
  Dices,
  Droplets,
  GraduationCap,
  Heart,
  LayoutTemplate,
  Mail,
  MessageCircle,
  Palette,
  PenLine,
  RotateCcw,
  Settings,
  Shield,
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
  UserRound,
  Users,
  Volume2,
} from "lucide-react";
import { api } from "@/app/_trpc/client";
import {
  BLOODLINE_SWAP_COOLDOWN_HOURS,
  COST_CHANGE_GENDER,
  COST_CHANGE_USERNAME,
  COST_REROLL_ELEMENT,
  COST_RESET_STATS,
  COST_SKILL_RESET,
  COST_SWAP_BLOODLINE,
  COST_SWAP_VILLAGE,
  COST_TAVERN_COLOR_CHANGE,
  MAX_ATTRIBUTES,
} from "@/drizzle/constants";
import { ActionSettings } from "@/layout/ActionSettings";
import ActivityStreakPanel from "@/layout/ActivityStreakPanel";
import { ResetBloodright } from "@/layout/Bloodright";
import ContentBox from "@/layout/ContentBox";
import { CharacterDeletionSettings } from "@/layout/DeleteUserButton";
import { DiscordLinkSettings } from "@/layout/DiscordLinkSettings";
import { ElementalMastery } from "@/layout/ElementalMastery";
import { GameSettingsPanel } from "@/layout/GameSettings";
import Loader from "@/layout/Loader";
import { ParentalControls } from "@/layout/ParentalControls";
import {
  type ProfileSettingsGroup,
  ProfileSettingsNavigation,
} from "@/layout/ProfileSettingsNavigation";
import { AttributeChange } from "@/layout/profileEdit/AttributeChange";
import { AvatarSettings } from "@/layout/profileEdit/AvatarSettings";
import { BattleSettingsEdit } from "@/layout/profileEdit/BattleSettingsEdit";
import { ChangeGender } from "@/layout/profileEdit/ChangeGender";
import { EmailReminderSettings } from "@/layout/profileEdit/EmailReminderSettings";
import { FontScaleSettings } from "@/layout/profileEdit/FontScaleSettings";
import { ManagementCommands } from "@/layout/profileEdit/ManagementCommands";
import { Marriage } from "@/layout/profileEdit/Marriage";
import { MobileNavSettings } from "@/layout/profileEdit/MobileNavSettings";
import { NameChange } from "@/layout/profileEdit/NameChange";
import { OwnNindoChange } from "@/layout/profileEdit/OwnNindoChange";
import { RerollElement } from "@/layout/profileEdit/RerollElement";
import { ResetSkills } from "@/layout/profileEdit/ResetSkills";
import { ResetStats } from "@/layout/profileEdit/ResetStats";
import { SwapBloodline } from "@/layout/profileEdit/SwapBloodline";
import { SwapVillage } from "@/layout/profileEdit/SwapVillage";
import { TavernColors } from "@/layout/profileEdit/TavernColors";
import { CurrentSageMode } from "@/layout/SageMode";
import { Titles } from "@/layout/Titles";
import { TutorialSettings } from "@/layout/TutorialSettings";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import { getRedistributableStatTotal } from "@/libs/profile";
import { getBloodlineElements } from "@/libs/userElements";
import { round } from "@/utils/math";
import { canSwapVillage, isStaffMember, isStaffRole } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Assemble the player's permitted settings while retaining each editor's save flow.
 * The navigator mounts only the selected editor; availability queries stay upfront.
 */
export function ProfileEdit() {
  const { data: userData, updateUser } = useRequiredUserData();
  const { data: emailReminder } = api.misc.getPersonalEmailReminder.useQuery();
  const { data: discordStatus } = api.discord.getStatus.useQuery();

  if (!userData) return <Loader explanation="Loading profile page..." />;

  const bloodlineElements = Array.from(new Set(getBloodlineElements(userData)));
  const reputationBalance = `You have ${userData.reputationPoints} reputation points.`;
  const groups: ProfileSettingsGroup[] = [
    {
      id: "appearance",
      title: "Profile & appearance",
      description: "Avatar, name, nindo, titles, and character appearance",
      icon: UserRound,
      settings: [
        {
          id: "avatar",
          title: "Avatar",
          description: "Generate, restore, or upload your profile image",
          keywords: "AI previous historical custom picture photo",
          icon: SwitchCamera,
          content: <AvatarSettings />,
        },
        {
          id: "name",
          title: "Name change",
          description: "Change your character's username",
          icon: Type,
          notice: `Change your username for ${COST_CHANGE_USERNAME} reputation points. ${reputationBalance}`,
          content: <NameChange />,
        },
        {
          id: "nindo",
          title: "Nindo",
          description: "Write your personal way of the ninja",
          keywords: "biography bio signature",
          icon: PenLine,
          content: <OwnNindoChange />,
        },
        {
          id: "titles",
          title: "Titles",
          description: "Choose a title for your profile and tavern posts",
          icon: Tag,
          notice:
            "Bonuses from all collected titles apply, whichever title you display.",
          content: <Titles />,
        },
        {
          id: "tavern-colors",
          title: "Tavern colors",
          description: "Customize your username and title colors",
          icon: Palette,
          notice: `Each color change costs ${COST_TAVERN_COLOR_CHANGE} reputation points. ${reputationBalance}`,
          content: <TavernColors />,
        },
        {
          id: "gender",
          title: "Gender",
          description: "Change your character's gender",
          icon: Users,
          notice: `Change your gender for ${COST_CHANGE_GENDER} reputation points. ${reputationBalance}`,
          content: <ChangeGender />,
        },
        {
          id: "attributes",
          title: "Character attributes",
          description: "Customize your appearance and in-game character",
          keywords: "hair skin eyes beard sprite body clothing outfit",
          icon: SlidersHorizontal,
          notice: `Choose up to ${MAX_ATTRIBUTES} traits. Colors are separate.`,
          content: <AttributeChange />,
        },
      ],
    },
    {
      id: "combat",
      title: "Character & combat",
      description: "Battle preferences, elements, bloodline, and stat resets",
      icon: Swords,
      settings: [
        {
          id: "preferences",
          title: "Combat preferences",
          description:
            "Automatic waking, battle settings, elemental mastery, and AI behavior",
          keywords:
            "wake up automatically for actions waking auto combat damage generals description sleep awake hospital",
          icon: Swords,
          content: (
            <>
              <ActionSettings />
              <ElementalMastery />
              <BattleSettingsEdit userId={userData.userId} />
            </>
          ),
        },
        {
          id: "elements",
          title: "Re-roll elements",
          description: "Re-roll your primary and secondary elements",
          icon: Dices,
          notice: (
            <>
              <p>
                Re-roll your elements for {COST_REROLL_ELEMENT} reputation points.{" "}
                {reputationBalance} Only elements not overwritten by a bloodline can be
                re-rolled.
              </p>
              {userData.primaryElement && (
                <p className="mt-2">
                  Current primary element: {userData.primaryElement}
                </p>
              )}
              {userData.secondaryElement && (
                <p>Current secondary element: {userData.secondaryElement}</p>
              )}
              {bloodlineElements.length > 0 && (
                <p>Overwritten by bloodline: {bloodlineElements.join(", ")}</p>
              )}
            </>
          ),
          content: <RerollElement />,
        },
        {
          id: "bloodline",
          title: "Swap bloodline",
          description: "Switch to a bloodline you have previously possessed",
          icon: Droplets,
          notice: `${isStaffMember(userData) ? "Swap your bloodline for free as a staff member." : `Paid bloodline swaps cost ${COST_SWAP_BLOODLINE} reputation points. Eligible supporters can use their available free swap.`} You must wait ${BLOODLINE_SWAP_COOLDOWN_HOURS} hours between swaps. Bloodlines purchased directly before 14/06/2025 have not been recorded and cannot be swapped. ${reputationBalance}`,
          content: <SwapBloodline />,
        },
        {
          id: "sage-mode",
          title: "Sage mode",
          description: "View or remove your awakened sage mode",
          icon: Sparkles,
          content: userData.sageModeId ? (
            <CurrentSageMode sageModeId={userData.sageModeId} embedded />
          ) : (
            <p className="text-sm">You have not awakened a sage mode yet.</p>
          ),
        },
        {
          id: "stats",
          title: "Reset stats",
          description: "Redistribute your combat stat points",
          icon: BarChart3,
          notice: `Redistribute your stats for ${COST_RESET_STATS} reputation points. ${reputationBalance} You have ${round(getRedistributableStatTotal(userData))} combat stat points to distribute.`,
          content: <ResetStats />,
        },
        {
          id: "skills",
          title: "Reset skills",
          description: "Refund your skill tree investments",
          icon: RotateCcw,
          notice: `${isStaffMember(userData) ? "Reset your skill tree and get all spent skill points back for free as a staff member." : `Skills and Bloodright share your monthly allowance of free resets. Paid skill resets cost ${COST_SKILL_RESET} reputation points.`} ${reputationBalance}`,
          content: <ResetSkills />,
        },
        {
          id: "bloodright",
          title: "Reset Bloodright",
          description: "Refund all Bloodright investments",
          icon: RotateCcw,
          content: <ResetBloodright />,
        },
        ...(canSwapVillage(userData.role)
          ? [
              {
                id: "village",
                title: "Swap village",
                description: "Move your character to another village",
                icon: Tent,
                notice: `Swap your village for ${COST_SWAP_VILLAGE} reputation points. ${reputationBalance}`,
                content: <SwapVillage />,
              },
            ]
          : []),
      ],
    },
    {
      id: "display",
      title: "Display & navigation",
      description: "Game layout, text size, reading comfort, and mobile shortcuts",
      icon: Settings,
      settings: [
        {
          id: "layout",
          title: "Game layout",
          description: "Layout, lighter layout, and sidebars",
          keywords: "theme template skin design sidebar",
          icon: LayoutTemplate,
          content: (
            <GameSettingsPanel
              userData={userData}
              updateUser={updateUser}
              section="display"
            />
          ),
        },
        {
          id: "effects",
          title: "Visual effects",
          description: "Lighting, shadows, and animations",
          keywords: "graphics lighting shadows animations day night weather",
          icon: Sparkles,
          content: <GameSettingsPanel section="effects" />,
        },
        {
          id: "reading",
          title: "Display settings",
          description: "Adjust text size, fonts, spacing, and reading colors",
          keywords: "accessibility font scale contrast",
          icon: Settings,
          content: <FontScaleSettings />,
        },
        {
          id: "mobile",
          title: "Mobile navigation",
          description: "Choose the shortcuts in your mobile navigation bar",
          keywords: "phone buttons menu",
          icon: Smartphone,
          content: <MobileNavSettings />,
        },
      ],
    },
    {
      id: "sound",
      title: "Sound & music",
      description: "Soundtrack, Nindo audio, combat and button sounds",
      icon: Volume2,
      settings: [
        {
          id: "audio",
          title: "Sound & music",
          description: "Music, sound effects, and effect volume",
          keywords: "audio music soundtrack sfx volume mute nindo",
          icon: Volume2,
          content: (
            <GameSettingsPanel
              userData={userData}
              updateUser={updateUser}
              section="audio"
            />
          ),
        },
      ],
    },
    {
      id: "help",
      title: "Help & tutorial",
      description: "Tutorial mode, player guide, and support tickets",
      icon: GraduationCap,
      settings: [
        {
          id: "tutorial",
          title: "Help & tutorial",
          description: "Tutorial mode, player guide, and support tickets",
          keywords: "tutorial guide help support quests",
          icon: GraduationCap,
          content: <TutorialSettings />,
        },
      ],
    },
    {
      id: "privacy",
      title: "Connections & privacy",
      description: "Parental controls, blacklist, marriage, and linked accounts",
      icon: Shield,
      settings: [
        {
          id: "parental-controls",
          title: "Parental controls",
          description: "Manage tavern access and approved players",
          keywords: "safety messages pin",
          icon: Shield,
          content: <ParentalControls />,
        },
        {
          id: "blacklist",
          title: "User blacklist",
          description: "Manage players hidden from your feeds",
          keywords: "block ignore safety",
          icon: Ban,
          content: <UserBlacklistControl />,
        },
        {
          id: "marriage",
          title: "Marriage",
          description: "Manage your marriage and proposals",
          icon: Heart,
          content: <Marriage />,
        },
        ...(discordStatus?.enabled
          ? [
              {
                id: "discord",
                title: "Discord",
                description: discordStatus.link
                  ? `Linked to ${discordStatus.link.discordUsername}`
                  : "Link your Discord account to join the server",
                icon: MessageCircle,
                content: <DiscordLinkSettings />,
              },
            ]
          : []),
        ...(emailReminder
          ? [
              {
                id: "email",
                title: "Email reminders",
                description: "Manage your email notification preferences",
                icon: Mail,
                content: <EmailReminderSettings emailReminder={emailReminder} />,
              },
            ]
          : []),
      ],
    },
    {
      id: "activity",
      title: "Activity rewards",
      description: "Your daily streak, progress, and claimable rewards",
      icon: Trophy,
      settings: [
        {
          id: "rewards",
          title: "Daily activity streak",
          description: "View your progress and claim activity rewards",
          icon: Trophy,
          content: <ActivityStreakPanel />,
        },
      ],
    },
    ...(isStaffRole(userData.role)
      ? [
          {
            id: "staff",
            title: "Staff tools",
            description: "Management commands for your staff role",
            icon: Shield,
            settings: [
              {
                id: "management",
                title: "Management commands",
                description: "Access staff character and game management tools",
                icon: Shield,
                content: <ManagementCommands user={userData} />,
              },
            ],
          },
        ]
      : []),
    {
      id: "deletion",
      title: "Delete character",
      description: userData.deletionAt
        ? "Manage or cancel your deletion request"
        : "Review the waiting period and permanent deletion process",
      icon: Trash2,
      destructive: true,
      settings: [
        {
          id: "character",
          title: "Delete character",
          description: "Manage your character's deletion request",
          keywords: "account remove cancel timer",
          icon: Trash2,
          content: <CharacterDeletionSettings userData={userData} />,
        },
      ],
    },
  ];

  return (
    <ContentBox title="Settings" padding={false}>
      <ProfileSettingsNavigation groups={groups} />
    </ContentBox>
  );
}
