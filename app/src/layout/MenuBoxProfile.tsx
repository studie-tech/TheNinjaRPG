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
import { formatClockTime, getGameTime } from "@/utils/time";
import {
  selectUserWithoutPosition,
  userBattleAtom,
  useUserDataSelector,
} from "@/utils/UserContext";

const MenuBoxProfile: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserDataSelector(selectUserWithoutPosition);
  const [now, setNow] = useState(Date.now);
  const refreshTime = () => setNow(Date.now());
  const battle = useAtomValue(userBattleAtom);
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

  // Get location of user
  const { location } = useGameMenu();

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

  // Battle user state
  const battleUser = battle?.usersState.find((u) => u.userId === userData?.userId);
  // Checkpoints display the carried pools without the generic hidden BATTLE bars.
  const hasBattlePools = !!battleUser || isBetweenPyramidBattles(userData);
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

  // Status link
  const statusLink = (status: (typeof UserStatuses)[number] | "UNKNOWN") => {
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
        if (location) {
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

  const levelExperience = userData && levelExperienceProgress(userData);
  const canLevelUp = !!userData && !levelUpBlockMessage(userData);
  const unassignedExperience = userData ? unassignedExperienceTowardLevel(userData) : 0;

  return (
    <>
      <div className="flex-col items-center justify-center">
        <div className="grid grid-cols-2 items-center justify-center md:grid-cols-1">
          <Link href="/profile">
            <AvatarImage
              href={userData?.avatar}
              alt={userData?.username}
              className="theme-player-avatar"
              size={100}
              hover_effect={true}
              priority
            />
          </Link>

          <div className="pt-5">
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
                  ? (battle.extraState.energyRegenerationPeriods?.[userData.userId] ??
                    [])
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
                userData &&
                ["BATTLE", "HOSPITALIZED", "TRAVEL"].includes(userData.status)
                  ? "AWAKE"
                  : userData?.status
              }
              current={userData?.curEnergy}
              total={userData?.maxEnergy}
              timeDiff={timeDiff}
            />
            {userData?.rank === "ELITE JONIN" ? (
              <Link href="/academy" className="block text-center text-sm underline">
                Milestones: {Math.max(0, userData.level - MAX_EXPERIENCE_LEVEL)}/
                {MAX_PLAYER_LEVEL - MAX_EXPERIENCE_LEVEL}
              </Link>
            ) : canLevelUp ? (
              <LevelUpBtn />
            ) : (
              <>
                <StatusBar
                  title="XP"
                  tooltip="Experience required for next level"
                  color="bg-yellow-500"
                  showText={true}
                  lastRegenAt={userData?.regenAt}
                  regen={0}
                  status={userData?.status}
                  current={levelExperience?.earned ?? 0}
                  total={levelExperience?.required}
                  timeDiff={timeDiff}
                />
                {unassignedExperience > 0 && (
                  <Link
                    href="/profile/experience"
                    className="block text-center text-xs underline"
                  >
                    {unassignedExperience.toLocaleString()} unassigned XP, assign toward
                    your next level
                  </Link>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4">
          <hr />
          <p className="mt-2 flex flex-row">
            <b>Status: </b>{" "}
            <span className="ml-1">{statusLink(userData?.status || "UNKNOWN")}</span>
          </p>
          {userData?.village?.name && (
            <p className="flex flex-row">
              <b>Village: </b>{" "}
              <Link href="/village" className="ml-1 hover:text-orange-500">
                {userData.village.name}
              </Link>
            </p>
          )}
          {userData && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="cursor-default">
                    <b>Bracket: </b>
                    {getExpBracket(userData.experience, userData.rank)}/
                    {MAX_PVP_BRACKET}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  {userData.rank === "ELITE JONIN" ? (
                    <>
                      Elite Jonin use bracket {ELITE_JONIN_BRACKET}. Your fights are
                      limited to brackets {ELITE_JONIN_BRACKET - 1} and{" "}
                      {ELITE_JONIN_BRACKET}, including during wars or when immunity is
                      lifted.
                    </>
                  ) : (
                    <>
                      PvP bracket based on experience (Academy & Genin are bracket 0).
                      You can freely attack players in your bracket, one bracket below,
                      or higher. Attacking Elite Jonin requires bracket{" "}
                      {ELITE_JONIN_BRACKET - 1} or {ELITE_JONIN_BRACKET}. Other players
                      more than one bracket below are protected unless their immunity is
                      lifted or both sides are active war participants.
                    </>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <p suppressHydrationWarning>
            <b>Time: </b> <GameClock />
          </p>
        </div>
        {/* ACTIVE EFFECTS */}
        {battle?.usersEffects && userData && (
          <>
            <hr className="my-2" />
            <ul className="italic">
              <VisualizeEffects
                effects={battle.usersEffects}
                userId={userData.userId}
                diffuseDamage={battleUser?.diffuseDamage}
              />
            </ul>
          </>
        )}
        <hr className="my-2" />
        <div className="flex flex-col gap-1">
          <TooltipProvider delayDuration={50}>
            <Tooltip>
              <TooltipTrigger className="w-full">
                <Link
                  href={location ? "/bank" : "/profile"}
                  className="hover:text-orange-500"
                >
                  <div className="flex flex-row items-center">
                    <p className="mr-3 text-xl">両</p>
                    {userData?.money?.toLocaleString() ?? "??"}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Money on hand</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
                        onFinish={async () => {
                          refreshTime();
                          await Promise.all([
                            utils.raids.getUserRaidBuffs.invalidate(),
                            utils.profile.getUser.invalidate(),
                          ]);
                        }}
                      />
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Meal effect: {buff.item?.name ?? "Meal"}
                </TooltipContent>
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
                <TooltipProvider key={kind} delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger className="w-full">
                      <div className="flex flex-row items-center hover:text-orange-500">
                        <Icon className="mr-2 h-6 w-6" />
                        <Link href="/traininggrounds">
                          <Countdown targetDate={endsAt} timeDiff={timeDiff} />
                        </Link>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {MASTERY_QUEUE_KIND_LABELS[kind]} training
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null;
            })}
          {trainingJutsu && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    <Atom className="mr-2 h-6 w-6" />
                    <Link href="/traininggrounds">
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
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Training {trainingJutsu.name} to level {trainingJutsu.level}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {userData?.covertTrainingType && covertTrainingFinishAt && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    {userData.covertTrainingType === "stealth" ? (
                      <EyeOff className="mr-2 h-6 w-6" />
                    ) : (
                      <ScanSearch className="mr-2 h-6 w-6" />
                    )}
                    <Link href="/traininggrounds">
                      <Countdown
                        targetDate={covertTrainingFinishAt}
                        timeDiff={timeDiff}
                        onFinish={async () => {
                          await utils.profile.getUser.invalidate();
                        }}
                      />
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {userData.covertTrainingType === "stealth"
                    ? "Stealth training"
                    : "Sensory training"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {activeItemCraftingTimer && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    <Hammer className="mr-2 h-6 w-6" />
                    <Link href="/occupation">
                      <Countdown
                        targetDate={activeItemCraftingTimer.craftingFinishedAt}
                        timeDiff={timeDiff}
                        onFinish={async () => {
                          await Promise.all([
                            utils.item.getUserItems.invalidate(),
                            utils.profile.getSidebarTimers.invalidate(),
                          ]);
                        }}
                      />
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Crafting {activeItemCraftingTimer.itemName}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {activeImbuementTimer && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    <Gem className="mr-2 h-6 w-6" />
                    <Link href="/occupation">
                      <Countdown
                        targetDate={activeImbuementTimer.craftingFinishedAt}
                        timeDiff={timeDiff}
                        onFinish={async () => {
                          await Promise.all([
                            utils.item.getUserItems.invalidate(),
                            utils.profile.getSidebarTimers.invalidate(),
                          ]);
                        }}
                      />
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Imbuing {activeImbuementTimer.imbuedName} onto{" "}
                  {activeImbuementTimer.targetName}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {userData && userData.dailyMissions < MISSIONS_PER_DAY && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Link href="/missionhall" className="hover:text-orange-500">
                    <div className="flex flex-row items-center">
                      <LayoutList className="mr-2 h-6 w-6" /> {userData.dailyMissions} /{" "}
                      {MISSIONS_PER_DAY}
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Daily missions to complete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {userData && (userData.dailyErrands ?? 0) < ERRANDS_PER_DAY && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Link href="/missionhall" className="hover:text-orange-500">
                    <div className="flex flex-row items-center">
                      <ClipboardList className="mr-2 h-6 w-6" />{" "}
                      {userData.dailyErrands ?? 0} / {ERRANDS_PER_DAY}
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Daily errands to complete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {userData &&
            (userData.dailyMedicalMissions ?? 0) < MEDICAL_MISSIONS_PER_DAY && (
              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger className="w-full">
                    <Link href="/missionhall" className="hover:text-orange-500">
                      <div className="flex flex-row items-center">
                        <Stethoscope className="mr-2 h-6 w-6" />{" "}
                        {userData.dailyMedicalMissions ?? 0} /{" "}
                        {MEDICAL_MISSIONS_PER_DAY}
                      </div>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>Daily medical missions to complete</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          {userData && (userData.dailyPvpMissions ?? 0) < PVP_MISSIONS_PER_DAY && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Link href="/missionhall" className="hover:text-orange-500">
                    <div className="flex flex-row items-center">
                      <Swords className="mr-2 h-6 w-6" />{" "}
                      {userData.dailyPvpMissions ?? 0} / {PVP_MISSIONS_PER_DAY}
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Daily PvP missions to complete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider delayDuration={50}>
            <Tooltip>
              <TooltipTrigger className="w-full">
                <Link href="/points" className="hover:text-orange-500">
                  <div className="flex flex-row items-center">
                    <Star className="mr-2 h-6 w-6" />{" "}
                    {userData?.reputationPoints ?? "??"}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Reputation points for use in black market</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
