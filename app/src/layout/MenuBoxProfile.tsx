import { useAtomValue } from "jotai";
import {
  Atom,
  ClipboardList,
  EyeOff,
  Flame,
  Gem,
  Hammer,
  LayoutList,
  Medal,
  Moon,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Star,
  Stethoscope,
  Sun,
  Swords,
  Utensils,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UserStatuses } from "@/drizzle/constants";
import {
  ELITE_JONIN_BRACKET,
  ERRANDS_PER_DAY,
  MASTERY_QUEUE_KIND_LABELS,
  MAX_EXPERIENCE_LEVEL,
  MAX_PLAYER_LEVEL,
  MAX_PVP_BRACKET,
  MasteryQueueKinds,
  MEDICAL_MISSIONS_PER_DAY,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
  SOCIAL_LINKS,
} from "@/drizzle/constants";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import { useGameMenu } from "@/hooks/useGameMenu";
import AvatarImage from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import StatusBar from "@/layout/StatusBar";
import { VisualizeEffects } from "@/layout/VisualizeEffects";
import {
  getExpBracket,
  levelExperienceProgress,
  levelUpBlockMessage,
  unassignedExperienceTowardLevel,
} from "@/libs/profile";
import { isBetweenPyramidBattles } from "@/libs/questRun";
import { calcCovertTrainingFinishAt } from "@/libs/stealth";
import { regenerationBuffs } from "@/libs/titles";
import { masteryTrainingEndsAt } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { formatClockTime, getGameTime } from "@/utils/time";
import { userBattleAtom, useUserDataSelector } from "@/utils/UserContext";

/**
 * Profile sidebar. Each section selects only the profile fields it displays, so a profile
 * write re-renders the sections showing a changed value.
 */
const MenuBoxProfile: React.FC = () => {
  const { data: identity } = useUserDataSelector(selectIdentity);
  const { location } = useGameMenu();
  const hasLocation = !!location;

  return (
    <>
      <div className="flex-col items-center justify-center">
        <div className="grid grid-cols-2 items-center justify-center md:grid-cols-1">
          <Link href="/profile">
            <AvatarImage
              href={identity?.avatar}
              alt={identity?.username}
              className="theme-player-avatar"
              size={100}
              hover_effect={true}
              priority
            />
          </Link>

          <div className="pt-5">
            <ProfilePools />
            <ProfileLevel />
          </div>
        </div>

        <div className="mt-4">
          <hr />
          <ProfileStanding hasLocation={hasLocation} />
          <p suppressHydrationWarning>
            <b>Time: </b> <GameClock />
          </p>
        </div>
        <ProfileBattleEffects />
        <hr className="my-2" />
        <div className="flex flex-col gap-1">
          <ProfileMoney hasLocation={hasLocation} />
          <ProfileTimers />
          <ProfileDailyActivities />
          <ProfileReputation />
        </div>
      </div>
      <hr className="my-2" />
      <div className="flex justify-center px-2 pt-2 align-center">
        {SOCIAL_LINKS.map((social) => {
          return (
            <a
              target="_blank"
              href={social.url}
              key={social.url}
              className="hover:opacity-80"
              rel="noopener"
            >
              <Image src={social.image} width={64} height={64} alt={social.alt}></Image>
            </a>
          );
        })}
      </div>
    </>
  );
};

export default MenuBoxProfile;

/** Health, chakra, stamina and energy, with combat values while the player fights. */
const ProfilePools: React.FC = () => {
  const { data: userData, timeDiff } = useUserDataSelector(selectPools);
  const battle = useAtomValue(userBattleAtom);
  const battleUser = battle?.usersState.find((u) => u.userId === userData?.userId);
  // Checkpoints display the carried pools without the generic hidden BATTLE bars.
  const hasBattlePools = !!battleUser || !!userData?.isBetweenPyramidBattles;
  const passiveRegeneration =
    userData?.regenerationWithoutTimedBuffs ?? userData?.regeneration;
  const poolRegenerationBuffs = regenerationBuffs({
    raidBuffs: userData?.raidBuffs,
    titles: userData?.titles,
  });

  // Calculate effective pool values with fallbacks (effectivePools → battleUser → userData)
  const pools = useEffectivePools({
    battleUser,
    usersEffects: battle?.usersEffects,
    userData,
  });

  return (
    <>
      <PoolStatusBars
        pools={pools}
        remountOnChange
        lastRegenAt={userData?.regenAt}
        regen={hasBattlePools ? 0 : passiveRegeneration}
        timedBuffs={hasBattlePools ? undefined : poolRegenerationBuffs}
        status={hasBattlePools ? "AWAKE" : userData?.status}
        timeDiff={timeDiff}
      />
      <StatusBar
        title="EP"
        tooltip="Energy continues recovering during combat and is credited when you leave."
        combatRegenerationPeriods={
          userData?.status === "BATTLE" && battle?.id === userData.battleId
            ? (battle.extraState.energyRegenerationPeriods?.[userData.userId] ?? [])
            : undefined
        }
        timedBuffs={poolRegenerationBuffs}
        color="bg-violet-500"
        showText
        lastRegenAt={userData?.regenAt}
        regen={
          userData?.status === "BATTLE" && battle?.id === userData.battleId
            ? (battle?.extraState.energyRegeneration?.[userData.userId] ??
              userData.regeneration)
            : passiveRegeneration
        }
        status={
          userData && ["BATTLE", "HOSPITALIZED", "TRAVEL"].includes(userData.status)
            ? "AWAKE"
            : userData?.status
        }
        current={userData?.curEnergy}
        total={userData?.maxEnergy}
        timeDiff={timeDiff}
      />
    </>
  );
};

/** Experience toward the next level, the level-up action or Elite Jonin milestones. */
const ProfileLevel: React.FC = () => {
  const { data: userData, timeDiff } = useUserDataSelector(selectLevel);
  if (userData?.rank === "ELITE JONIN")
    return (
      <Link href="/academy" className="block text-center text-sm underline">
        Milestones: {Math.max(0, userData.level - MAX_EXPERIENCE_LEVEL)}/
        {MAX_PLAYER_LEVEL - MAX_EXPERIENCE_LEVEL}
      </Link>
    );
  if (userData?.canLevelUp) return <LevelUpBtn />;
  return (
    <>
      <StatusBar
        title="XP"
        tooltip="Experience required for next level"
        color="bg-yellow-500"
        showText={true}
        lastRegenAt={userData?.regenAt}
        regen={0}
        status={userData?.status}
        current={userData?.earnedExperience ?? 0}
        total={userData?.requiredExperience}
        timeDiff={timeDiff}
      />
      {userData && userData.unassignedExperience > 0 && (
        <Link
          href="/profile/experience"
          className="block text-center text-xs underline"
        >
          {userData.unassignedExperience.toLocaleString()} unassigned XP, assign toward
          your next level
        </Link>
      )}
    </>
  );
};

/** Status, village and PvP bracket. */
const ProfileStanding: React.FC<{ hasLocation: boolean }> = ({ hasLocation }) => {
  const { data: userData } = useUserDataSelector(selectStanding);
  return (
    <>
      <p className="mt-2 flex flex-row">
        <b>Status: </b>{" "}
        <span className="ml-1">
          <StatusLink
            status={userData?.status ?? "UNKNOWN"}
            hasLocation={hasLocation}
          />
        </span>
      </p>
      {userData?.villageName && (
        <p className="flex flex-row">
          <b>Village: </b>{" "}
          <Link href="/village" className="ml-1 hover:text-orange-500">
            {userData.villageName}
          </Link>
        </p>
      )}
      {userData && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="cursor-default">
                <b>Bracket: </b>
                {userData.bracket}/{MAX_PVP_BRACKET}
              </p>
            </TooltipTrigger>
            <TooltipContent>
              {userData.isEliteJonin ? (
                <>
                  Elite Jonin use bracket {ELITE_JONIN_BRACKET}. Your fights are limited
                  to brackets {ELITE_JONIN_BRACKET - 1} and {ELITE_JONIN_BRACKET},
                  including during wars or when immunity is lifted.
                </>
              ) : (
                <>
                  PvP bracket based on experience (Academy & Genin are bracket 0). You
                  can freely attack players in your bracket, one bracket below, or
                  higher. Attacking Elite Jonin requires bracket{" "}
                  {ELITE_JONIN_BRACKET - 1} or {ELITE_JONIN_BRACKET}. Other players more
                  than one bracket below are protected unless their immunity is lifted
                  or both sides are active war participants.
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
};

/** Status label linked to the page where the player can act on it. */
const StatusLink: React.FC<{
  status: (typeof UserStatuses)[number] | "UNKNOWN";
  hasLocation: boolean;
}> = ({ status, hasLocation }) => {
  switch (status) {
    case "BATTLE":
      return (
        <Link href="/combat" className="flex flex-row hover:text-orange-500">
          BATTLE <ShieldCheck className="ml-1 h-6 w-6 hover:text-orange-500" />
        </Link>
      );
    case "ASLEEP":
      return (
        <Link href="/home" className="flex flex-row hover:text-orange-500">
          ASLEEP <Moon className="ml-1 h-6 w-6 hover:text-orange-500" />
        </Link>
      );
    case "QUEUED":
      return (
        <span className="flex flex-row hover:text-orange-500">
          QUEUED <Swords className="ml-1 h-6 w-6 hover:text-orange-500" />
        </span>
      );
    case "AWAKE":
      if (hasLocation) {
        return (
          <Link href="/home" className="flex flex-row hover:text-orange-500">
            AWAKE <Sun className="ml-1 h-6 w-6 hover:text-orange-500" />
          </Link>
        );
      } else {
        return <span>{status}</span>;
      }
    default:
      return <span>{status}</span>;
  }
};

/** Effects active on the player in the current battle. */
const ProfileBattleEffects: React.FC = () => {
  const { data: userId } = useUserDataSelector(selectUserId);
  const battle = useAtomValue(userBattleAtom);
  if (!battle?.usersEffects || !userId) return null;
  const battleUser = battle.usersState.find((u) => u.userId === userId);
  return (
    <>
      <hr className="my-2" />
      <ul className="italic">
        <VisualizeEffects
          effects={battle.usersEffects}
          userId={userId}
          diffuseDamage={battleUser?.diffuseDamage}
        />
      </ul>
    </>
  );
};

/** Money on hand, linked to the bank inside a location. */
const ProfileMoney: React.FC<{ hasLocation: boolean }> = ({ hasLocation }) => {
  const { data: money } = useUserDataSelector(selectMoney);
  return (
    <TooltipProvider delayDuration={50}>
      <Tooltip>
        <TooltipTrigger className="w-full">
          <Link
            href={hasLocation ? "/bank" : "/profile"}
            className="hover:text-orange-500"
          >
            <div className="flex flex-row items-center">
              <p className="mr-3 text-xl">両</p>
              {money?.toLocaleString() ?? "??"}
            </div>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Money on hand</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/** Meals, immunities and every running training or crafting countdown. */
const ProfileTimers: React.FC = () => {
  const { data: userData, timeDiff } = useUserDataSelector(selectTimers);
  const [now, setNow] = useState(Date.now);
  const refreshTime = () => setNow(Date.now());
  const utils = api.useUtils();

  const { data: sidebarTimers } = api.profile.getSidebarTimers.useQuery(undefined, {
    enabled: !!userData,
  });
  const trainingJutsu = sidebarTimers?.jutsuTraining;
  const { data: timedBuffs } = api.raids.getUserRaidBuffs.useQuery(undefined, {
    enabled: !!userData,
  });
  // Server only returns unexpired buffs; Countdown handles expiry + refetch
  const mealBuffs = timedBuffs?.buffs.filter((buff) => buff.itemId) ?? [];

  /** Finish time for stealth or sensory training at the training grounds */
  const covertTrainingFinishAt = userData?.covertTrainingType
    ? calcCovertTrainingFinishAt(
        userData.covertTrainingStartedAt,
        userData.covertTrainingMinutes,
      )
    : null;

  const activeItemCraftingTimer = sidebarTimers?.crafting;
  const activeImbuementTimer = sidebarTimers?.imbuement;
  /** A finished craft or imbuement changes the inventory and the next sidebar timer. */
  const refreshItemTimers = async () => {
    await Promise.all([
      utils.item.getUserItems.invalidate(),
      utils.profile.getSidebarTimers.invalidate(),
    ]);
  };

  const immunitySecsLeft = useSecondsUntil(userData?.immunityUntil, now, timeDiff);
  const bracketImmunitySecsLeft = useSecondsUntil(
    userData?.bracketImmunityLiftedUntil,
    now,
    timeDiff,
  );
  const warParticipantSecsLeft = useSecondsUntil(
    userData?.warParticipantUntil,
    now,
    timeDiff,
  );

  return (
    <>
      {mealBuffs.map((buff) => (
        <TooltipProvider key={buff.id} delayDuration={50}>
          <Tooltip>
            <TooltipTrigger className="w-full">
              <div className="flex flex-row items-center">
                <Utensils className="mr-2 h-6 w-6" />
                <span>
                  Meal:{" "}
                  <Countdown
                    targetDate={buff.expiresAt}
                    timeDiff={timeDiff}
                    onEndShow="Expired"
                    // UserContext refreshes the profile at every buff expiry.
                    onFinish={async () => {
                      refreshTime();
                      await utils.raids.getUserRaidBuffs.invalidate();
                    }}
                  />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Meal effect: {buff.item?.name ?? "Meal"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      {userData && immunitySecsLeft > 0 && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger className="w-full">
              <div className="flex flex-row items-center">
                <ShieldCheck className="mr-2 h-6 w-6" />
                <Countdown
                  targetDate={userData.immunityUntil}
                  timeDiff={timeDiff}
                  format={formatBracketedClock}
                  onFinish={refreshTime}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Immune from PvP attacks</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {userData && !userData.battleId && bracketImmunitySecsLeft > 0 && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger className="w-full">
              <div className="flex flex-row items-center text-orange-500">
                <ShieldAlert className="mr-2 h-6 w-6" />
                <Countdown
                  targetDate={userData.bracketImmunityLiftedUntil}
                  timeDiff={timeDiff}
                  format={formatBracketedClock}
                  onFinish={refreshTime}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Bracket Immunity Lifted</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {userData && !userData.battleId && warParticipantSecsLeft > 0 && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger className="w-full">
              <div className="flex flex-row items-center text-red-500">
                <Swords className="mr-2 h-6 w-6" />
                <Countdown
                  targetDate={userData.warParticipantUntil}
                  timeDiff={timeDiff}
                  format={formatBracketedClock}
                  onFinish={refreshTime}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>War Participant</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {userData &&
        MasteryQueueKinds.map((kind) => {
          const endsAt = masteryTrainingEndsAt(userData, kind);
          const Icon = kind === "ELEMENT" ? Flame : Medal;
          return endsAt ? (
            <SidebarTimerRow
              key={kind}
              icon={<Icon className="mr-2 h-6 w-6" />}
              href="/traininggrounds"
              tooltip={<>{MASTERY_QUEUE_KIND_LABELS[kind]} training</>}
            >
              <Countdown targetDate={endsAt} timeDiff={timeDiff} />
            </SidebarTimerRow>
          ) : null;
        })}
      {trainingJutsu && (
        <SidebarTimerRow
          icon={<Atom className="mr-2 h-6 w-6" />}
          href="/traininggrounds"
          tooltip={
            <>
              Training {trainingJutsu.name} to level {trainingJutsu.level}
            </>
          }
        >
          <Countdown
            targetDate={trainingJutsu.finishTraining}
            timeDiff={timeDiff}
            onFinish={async () => {
              await Promise.all([
                utils.jutsu.getUserJutsus.invalidate(),
                utils.profile.getSidebarTimers.invalidate(),
              ]);
            }}
          />
        </SidebarTimerRow>
      )}
      {userData?.covertTrainingType && covertTrainingFinishAt && (
        <SidebarTimerRow
          icon={
            userData.covertTrainingType === "stealth" ? (
              <EyeOff className="mr-2 h-6 w-6" />
            ) : (
              <ScanSearch className="mr-2 h-6 w-6" />
            )
          }
          href="/traininggrounds"
          tooltip={
            userData.covertTrainingType === "stealth"
              ? "Stealth training"
              : "Sensory training"
          }
        >
          <Countdown
            targetDate={covertTrainingFinishAt}
            timeDiff={timeDiff}
            onFinish={async () => {
              await utils.profile.getUser.invalidate();
            }}
          />
        </SidebarTimerRow>
      )}
      {activeItemCraftingTimer && (
        <SidebarTimerRow
          icon={<Hammer className="mr-2 h-6 w-6" />}
          href="/occupation"
          tooltip={<>Crafting {activeItemCraftingTimer.itemName}</>}
        >
          <Countdown
            targetDate={activeItemCraftingTimer.craftingFinishedAt}
            timeDiff={timeDiff}
            onFinish={refreshItemTimers}
          />
        </SidebarTimerRow>
      )}
      {activeImbuementTimer && (
        <SidebarTimerRow
          icon={<Gem className="mr-2 h-6 w-6" />}
          href="/occupation"
          tooltip={
            <>
              Imbuing {activeImbuementTimer.imbuedName} onto{" "}
              {activeImbuementTimer.targetName}
            </>
          }
        >
          <Countdown
            targetDate={activeImbuementTimer.craftingFinishedAt}
            timeDiff={timeDiff}
            onFinish={refreshItemTimers}
          />
        </SidebarTimerRow>
      )}
    </>
  );
};

/** Daily missions, errands, medical and PvP missions still open today. */
const ProfileDailyActivities: React.FC = () => {
  const { data: userData } = useUserDataSelector(selectDailyActivities);
  return (
    <>
      {userData &&
        [
          {
            icon: LayoutList,
            done: userData.dailyMissions,
            limit: MISSIONS_PER_DAY,
            tooltip: "Daily missions to complete",
          },
          {
            icon: ClipboardList,
            done: userData.dailyErrands ?? 0,
            limit: ERRANDS_PER_DAY,
            tooltip: "Daily errands to complete",
          },
          {
            icon: Stethoscope,
            done: userData.dailyMedicalMissions ?? 0,
            limit: MEDICAL_MISSIONS_PER_DAY,
            tooltip: "Daily medical missions to complete",
          },
          {
            icon: Swords,
            done: userData.dailyPvpMissions ?? 0,
            limit: PVP_MISSIONS_PER_DAY,
            tooltip: "Daily PvP missions to complete",
          },
        ].map(({ icon: Icon, done, limit, tooltip }) =>
          done < limit ? (
            <SidebarLinkRow key={tooltip} href="/missionhall" tooltip={tooltip}>
              <Icon className="mr-2 h-6 w-6" /> {done} / {limit}
            </SidebarLinkRow>
          ) : null,
        )}
    </>
  );
};

/** Reputation points, linked to the black market. */
const ProfileReputation: React.FC = () => {
  const { data: reputationPoints } = useUserDataSelector(selectReputationPoints);
  return (
    <SidebarLinkRow href="/points" tooltip="Reputation points for use in black market">
      <Star className="mr-2 h-6 w-6" /> {reputationPoints ?? "??"}
    </SidebarLinkRow>
  );
};

/** Sidebar row whose countdown links to the page running the timer. */
const SidebarTimerRow: React.FC<{
  icon: React.ReactNode;
  href: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, href, tooltip, children }) => (
  <TooltipProvider delayDuration={50}>
    <Tooltip>
      <TooltipTrigger className="w-full">
        <div className="flex flex-row items-center hover:text-orange-500">
          {icon}
          <Link href={href}>{children}</Link>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** Sidebar row linked as a whole to the page where the value is used. */
const SidebarLinkRow: React.FC<{
  href: string;
  tooltip: string;
  children: React.ReactNode;
}> = ({ href, tooltip, children }) => (
  <TooltipProvider delayDuration={50}>
    <Tooltip>
      <TooltipTrigger className="w-full">
        <Link href={href} className="hover:text-orange-500">
          <div className="flex flex-row items-center">{children}</div>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** A live text node keeps UTC clock ticks outside the surrounding React tree. */
const GameClock: React.FC = () => {
  const clock = React.useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      const label = clock.current,
        time = getGameTime();
      if (label && label.textContent !== time) label.textContent = time;
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <span ref={clock} suppressHydrationWarning>
      {getGameTime()}
    </span>
  );
};

/**
 * Seconds left until the server time `until` on the parent clock, which the row's Countdown
 * advances on expiry. A new snapshot may already have expired since that clock last moved,
 * so a change of `until` also reads the current time.
 */
const useSecondsUntil = (
  until: Date | null | undefined,
  now: number,
  timeDiff: number,
) => {
  const untilMs = until ? until.getTime() + timeDiff : 0;
  const secsAtSnapshot = useMemo(
    () => Math.max(0, (untilMs - Date.now()) / 1000),
    [untilMs],
  );
  return Math.min(secsAtSnapshot, Math.max(0, (untilMs - now) / 1000));
};

/** Wrap a remaining duration in the sidebar's bracketed clock notation. */
const formatBracketedClock = (msLeft: number) => `[${formatClockTime(msLeft)}]`;

/** Account identity shown by the avatar. */
const selectIdentity = (user: ProfileUser) => ({
  avatar: user.avatar,
  username: user.username,
});

const selectUserId = (user: ProfileUser) => user.userId;

/** Pools, their regeneration and the battle state that replaces them in combat. */
const selectPools = (user: ProfileUser) => ({
  userId: user.userId,
  status: user.status,
  battleId: user.battleId,
  isBetweenPyramidBattles: isBetweenPyramidBattles(user),
  regenAt: user.regenAt,
  regeneration: user.regeneration,
  regenerationWithoutTimedBuffs: user.regenerationWithoutTimedBuffs,
  raidBuffs: user.raidBuffs,
  titles: user.titles,
  curHealth: user.curHealth,
  maxHealth: user.maxHealth,
  curChakra: user.curChakra,
  maxChakra: user.maxChakra,
  curStamina: user.curStamina,
  maxStamina: user.maxStamina,
  curEnergy: user.curEnergy,
  maxEnergy: user.maxEnergy,
});

/** Level progress, derived here so experience-neutral writes keep the selection equal. */
const selectLevel = (user: ProfileUser) => {
  const progress = levelExperienceProgress(user);
  return {
    rank: user.rank,
    level: user.level,
    status: user.status,
    regenAt: user.regenAt,
    earnedExperience: progress.earned,
    requiredExperience: progress.required,
    canLevelUp: !levelUpBlockMessage(user),
    unassignedExperience: unassignedExperienceTowardLevel(user),
  };
};

const selectStanding = (user: ProfileUser) => ({
  status: user.status,
  villageName: user.village?.name,
  bracket: getExpBracket(user.experience, user.rank),
  isEliteJonin: user.rank === "ELITE JONIN",
});

const selectMoney = (user: ProfileUser) => user.money;

/** Deadlines and training sessions behind the sidebar countdowns. */
const selectTimers = (user: ProfileUser) => ({
  battleId: user.battleId,
  immunityUntil: user.immunityUntil,
  bracketImmunityLiftedUntil: user.bracketImmunityLiftedUntil,
  warParticipantUntil: user.warParticipantUntil,
  currentlyTrainingMastery: user.currentlyTrainingMastery,
  masteryTrainingStartedAt: user.masteryTrainingStartedAt,
  trainingSpeed: user.trainingSpeed,
  currentlyTrainingElement: user.currentlyTrainingElement,
  elementalTrainingStartedAt: user.elementalTrainingStartedAt,
  elementalTrainingSpeed: user.elementalTrainingSpeed,
  covertTrainingType: user.covertTrainingType,
  covertTrainingStartedAt: user.covertTrainingStartedAt,
  covertTrainingMinutes: user.covertTrainingMinutes,
});

const selectDailyActivities = (user: ProfileUser) => ({
  dailyMissions: user.dailyMissions,
  dailyErrands: user.dailyErrands,
  dailyMedicalMissions: user.dailyMedicalMissions,
  dailyPvpMissions: user.dailyPvpMissions,
});

const selectReputationPoints = (user: ProfileUser) => user.reputationPoints;

type ProfileUser = NonNullable<UserWithRelations>;
