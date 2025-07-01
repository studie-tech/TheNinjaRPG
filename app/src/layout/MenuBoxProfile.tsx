import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import StatusBar from "@/layout/StatusBar";
import AvatarImage from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import LevelUpBtn from "@/layout/LevelUpBtn";
import ElementImage from "@/layout/ElementImage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trainingSpeedSeconds } from "@/libs/train";
import { useUserData } from "@/utils/UserContext";
import { groupBy } from "@/utils/grouping";
import { ShieldCheck, Swords, Moon, Sun, Dumbbell, Star } from "lucide-react";
import { LayoutList, Atom } from "lucide-react";
import { sealCheck } from "@/libs/combat/tags";
import { isEffectActive } from "@/libs/combat/util";
import { getDaysHoursMinutesSeconds, getGameTime } from "@/utils/time";
import { useGameMenu } from "@/libs/menus";
import { secondsFromDate } from "@/utils/time";
import { useAtomValue } from "jotai";
import { userBattleAtom } from "@/utils/UserContext";
import { calcLevelRequirements } from "@/libs/profile";
import { DISCORD_INVITE_URL, MISSIONS_PER_DAY } from "@/drizzle/constants";
import { cn } from "src/libs/shadui";
import {
  IMG_ICON_DISCORD,
  IMG_ICON_FACEBOOK,
  IMG_ICON_INSTAGRAM,
  IMG_ICON_REDDIT,
  IMG_ICON_TIKTOK,
  IMG_ICON_TWITTER,
  IMG_ICON_YOUTUBE,
} from "@/drizzle/constants";
import type { GeneralType, StatType, ElementName } from "@/drizzle/constants";
import type { UserStatuses } from "@/drizzle/constants";
import type { UserEffect } from "@/libs/combat/types";
import { api } from "@/app/_trpc/client";
import { useFiltering, getFilter } from "@/layout/JutsuFiltering";

/**
 * Social media links
 */
export const socials = [
  {
    url: DISCORD_INVITE_URL,
    image: IMG_ICON_DISCORD,
    alt: "Discord",
  },
  {
    url: "https://www.facebook.com/profile.php?id=61554961626034",
    image: IMG_ICON_FACEBOOK,
    alt: "Facebook",
  },
  {
    url: "https://www.youtube.com/@fullstackscientist",
    image: IMG_ICON_YOUTUBE,
    alt: "Youtube",
  },
  {
    url: "https://twitter.com/RealTheNinjaRPG",
    image: IMG_ICON_TWITTER,
    alt: "Twitter",
  },
  {
    url: "https://www.instagram.com/theninjarpg/",
    image: IMG_ICON_INSTAGRAM,
    alt: "Instagram",
  },
  {
    url: "https://www.tiktok.com/@theninjarpg",
    image: IMG_ICON_TIKTOK,
    alt: "Tiktok",
  },
  {
    url: "https://www.reddit.com/r/theninjarpg/",
    image: IMG_ICON_REDDIT,
    alt: "Reddit",
  },
];

const MenuBoxProfile: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserData();
  const [, setState] = useState<number>(0);
  const [gameTime, setGameTime] = useState<string>(getGameTime());
  const battle = useAtomValue(userBattleAtom);
  const utils = api.useUtils();
  const state = useFiltering();

  // Get user's jutsus
  const { data: userJutsus } = api.jutsu.getUserJutsus.useQuery(getFilter(state), {
    enabled: !!userData,
  });
  const trainingJutsu = userJutsus?.find(
    (j) => j.finishTraining && j.finishTraining > new Date(),
  );

  // Update the gameTime with the UTC HH:MM:SS timestring every second
  useEffect(() => {
    const interval = setInterval(() => {
      setGameTime(getGameTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Get location of user
  const { location } = useGameMenu(userData);

  // Derived data
  const immunitySecsLeft =
    (userData && (userData.immunityUntil.getTime() - Date.now()) / 1000) || 0;

  // Battle user state
  const battleUser = battle?.usersState.find((u) => u.userId === userData?.userId);

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
          <div className="flex flex-row hover:text-orange-500">
            QUEUED <Swords className="ml-1 h-6 w-6 hover:text-orange-500" />
          </div>
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

  const expRequired = userData && calcLevelRequirements(userData.level - 1);
  const expForNextLevel = userData && calcLevelRequirements(userData.level);
  const expTowardsNextLevel =
    userData && Math.max(0, userData.experience - (expRequired ?? 0));
  const expNeededForNextLevel =
    userData && Math.max(1, (expForNextLevel ?? 0) - (expRequired ?? 0));

  return (
    <>
      <div className="flex-col items-center justify-center ">
        <div className="grid grid-cols-2 md:grid-cols-1 items-center justify-center">
          <Link href="/profile">
            <AvatarImage
              href={userData?.avatar}
              userId={userData?.userId}
              alt={userData?.username}
              refetchUserData={true}
              size={100}
              hover_effect={true}
              priority
            />
          </Link>

          <div className="pt-5">
            <StatusBar
              title="HP"
              tooltip="Health"
              color="bg-red-500"
              showText={true}
              lastRegenAt={userData?.regenAt}
              regen={battleUser ? 0 : userData?.regeneration}
              status={battleUser ? "AWAKE" : userData?.status}
              current={battleUser?.curHealth || userData?.curHealth}
              total={battleUser?.maxHealth || userData?.maxHealth}
              timeDiff={timeDiff}
            />
            <StatusBar
              title="CP"
              tooltip="Chakra"
              color="bg-blue-500"
              showText={true}
              lastRegenAt={userData?.regenAt}
              regen={battleUser ? 0 : userData?.regeneration}
              status={battleUser ? "AWAKE" : userData?.status}
              current={battleUser?.curChakra || userData?.curChakra}
              total={battleUser?.maxChakra || userData?.maxChakra}
              timeDiff={timeDiff}
            />
            <StatusBar
              title="SP"
              tooltip="Stamina"
              color="bg-green-500"
              showText={true}
              lastRegenAt={userData?.regenAt}
              regen={battleUser ? 0 : userData?.regeneration}
              status={battleUser ? "AWAKE" : userData?.status}
              current={battleUser?.curStamina || userData?.curStamina}
              total={battleUser?.maxStamina || userData?.maxStamina}
              timeDiff={timeDiff}
            />
            {expRequired &&
            expForNextLevel &&
            expTowardsNextLevel &&
            expNeededForNextLevel &&
            expTowardsNextLevel >= expNeededForNextLevel ? (
              <LevelUpBtn />
            ) : (
              <StatusBar
                title="XP"
                tooltip="Experience required for next level"
                color="bg-yellow-500"
                showText={true}
                lastRegenAt={userData?.regenAt}
                regen={0}
                status={userData?.status}
                current={expTowardsNextLevel}
                total={expNeededForNextLevel}
                timeDiff={timeDiff}
              />
            )}
          </div>
        </div>

        <div className="mt-4">
          <hr />
          <p className="mt-2 flex flex-row">
            <b>Status: </b>{" "}
            <span className="ml-1">{statusLink(userData?.status || "UNKNOWN")}</span>
          </p>
          <p suppressHydrationWarning>
            <b>Time: </b> {gameTime}
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
                    <p className="text-xl mr-3">両</p> {userData?.money ?? "??"}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Money on hand</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {userData && userData.immunityUntil > new Date() && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center">
                    <ShieldCheck className="h-6 w-6 mr-2" />
                    <Cooldown
                      createdAt={Date.now()}
                      totalSeconds={immunitySecsLeft}
                      initialSecondsLeft={immunitySecsLeft}
                      setState={setState}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Immune from PvP attacks</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {userData?.trainingStartedAt && userData?.currentlyTraining && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    <Dumbbell className="h-6 w-6 mr-2" />
                    <Link href="/traininggrounds">
                      <Countdown
                        targetDate={secondsFromDate(
                          trainingSpeedSeconds(userData?.trainingSpeed),
                          userData?.trainingStartedAt,
                        )}
                        timeDiff={timeDiff}
                      />
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Current training activity</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {trainingJutsu && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <div className="flex flex-row items-center hover:text-orange-500">
                    <Atom className="h-6 w-6 mr-2" />
                    <Link href="/traininggrounds">
                      <Countdown
                        targetDate={trainingJutsu.finishTraining || new Date()}
                        timeDiff={timeDiff}
                        onFinish={async () => {
                          await utils.jutsu.getUserJutsus.invalidate();
                        }}
                      />
                    </Link>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Training {trainingJutsu.jutsu?.name} to level {trainingJutsu.level}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider delayDuration={50}>
            <Tooltip>
              <TooltipTrigger className="w-full">
                <Link href="/points" className="hover:text-orange-500">
                  <div className="flex flex-row items-center">
                    <Star className="h-6 w-6 mr-2" />{" "}
                    {userData?.reputationPoints ?? "??"}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Reputation points for use in black market</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {userData && userData.dailyMissions < MISSIONS_PER_DAY && (
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Link href="/missionhall" className="hover:text-orange-500">
                    <div className="flex flex-row items-center">
                      <LayoutList className="h-6 w-6 mr-2" />{" "}
                      {userData?.dailyMissions ?? "??"} / {MISSIONS_PER_DAY}
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Daily missions to complete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      <hr className="my-2" />
      <div className="px-2 pt-2 flex align-center justify-center">
        {socials.map((social, i) => {
          return (
            <a target="_blank" href={social.url} key={i} className="hover:opacity-80">
              <Image src={social.image} width={64} height={64} alt={social.alt}></Image>
            </a>
          );
        })}
      </div>
    </>
  );
};

export default MenuBoxProfile;

/**
 * Returns a formatted time string based on the number of seconds left.
 * If the number of seconds is greater than 0, the time string will be in the format "HH:MM:SS" or "MM:SS" if the number of hours is 0.
 * If the number of seconds is 0 or less, the time string will be "Done".
 *
 * @param secondsLeft The number of seconds left.
 * @returns The formatted time string.
 */
const getTimeStr = (secondsLeft: number) => {
  const [, hours, minutes, seconds] = getDaysHoursMinutesSeconds(secondsLeft);
  if (secondsLeft > 0) {
    const hoursStr = hours.toString().padStart(2, "0");
    const minutesStr = minutes.toString().padStart(2, "0");
    const secondsStr = seconds.toString().padStart(2, "0");
    if (hours > 0) {
      return `${hoursStr}:${minutesStr}:${secondsStr}`;
    } else {
      return `${minutesStr}:${secondsStr}`;
    }
  } else {
    return `Done`;
  }
};

interface CooldownProps {
  initialSecondsLeft: number;
  totalSeconds: number;
  createdAt: number;
  setState: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * A component that displays a countdown timer.
 *
 * @param props - The component props.
 * @returns The rendered `Cooldown` component.
 */
const Cooldown: React.FC<CooldownProps> = (props) => {
  const { createdAt, totalSeconds, initialSecondsLeft, setState } = props;
  const [counter, setCounter] = useState<string>(getTimeStr(initialSecondsLeft * 1000));

  useEffect(() => {
    if (totalSeconds) {
      const secondsLeft = createdAt + totalSeconds * 1000 - Date.now();
      if (secondsLeft > 0) {
        const interval = setInterval(() => {
          const secondsLeft = createdAt + totalSeconds * 1000 - Date.now();
          setCounter(getTimeStr(secondsLeft));
        }, 1000);
        return () => clearInterval(interval);
      } else {
        if (initialSecondsLeft > 0) {
          setState((prev) => prev + 1);
        }
        setCounter(`Done`);
      }
    }
  }, [totalSeconds, createdAt, initialSecondsLeft, setState]);

  return counter ? <>[{counter}]</> : <></>;
};

type CollapsedEffect = {
  type: string;
  value: number;
  calculation: "static" | "percentage" | "formula";
  category: GeneralType | StatType | ElementName | "All";
  upDownEffect: boolean;
  rounds: number[];
  sealed: boolean;
};

interface VisualizeEffectsProps {
  effects: UserEffect[];
  userId: string;
}

const VisualizeEffects: React.FC<VisualizeEffectsProps> = ({ effects, userId }) => {
  // Get sealing effects
  const sealEffects = effects.filter((e) => e.type === "seal" && !e.isNew);
  // Collapse consequences based on their type & calculation type
  const collapsedEffects =
    effects
      .filter(isEffectActive)
      .filter((e) => e.targetId === userId)
      .filter((e) => e.rounds === undefined || e.rounds > 0)
      .reduce((acc, val) => {
        // Convenience
        const stats = [
          ...(("statTypes" in val && val?.statTypes) || []),
          ...(("generalTypes" in val && val?.generalTypes) || []),
          ...(("elements" in val && val?.elements) || []),
        ];
        const isSealed = sealEffects && sealCheck(val, sealEffects);
        const cats = stats.length === 0 ? ["All" as const] : stats;
        const dual = val.type.includes("increase") || val.type.includes("decrease");
        const baseType = dual
          ? val.type.replace("increase", "").replace("decrease", "")
          : val.type;
        const sign = val.type.includes("decrease") ? -1 : 1;
        const value = Math.abs(val.power + val.level * val.powerPerLevel) * sign;
        // Already exists?
        cats.forEach((cat) => {
          const found = acc.find(
            (e) =>
              e.type === baseType &&
              e.calculation === val.calculation &&
              e.category === cat &&
              e.sealed === isSealed,
          );
          // Update
          if (found) {
            found.value += value;
            if (val.rounds) found.rounds.push(val.rounds);
          } else {
            acc.push({
              type: baseType,
              value: isSealed ? 0 : value,
              category: cat,
              calculation: val.calculation,
              upDownEffect: dual,
              rounds: val.rounds ? [val.rounds] : [],
              sealed: isSealed,
            });
          }
        });
        return acc;
      }, [] as CollapsedEffect[]) || [];

  // Group the effects by type
  const groupedEffects = groupBy(collapsedEffects, "type");

  // Convenience for showing
  const visuals: React.ReactNode[] = [];
  const insert = (
    image: React.ReactNode,
    className: string,
    txtName: string,
    showValue: boolean,
    effect: CollapsedEffect,
  ) => {
    const e = effect;
    const value = e.value.toFixed(2);
    const valTxt = `[${e.value > 0 ? "+" : ""}${value}${e.calculation === "percentage" ? "%" : ""}]`;
    const roundsTxt = e.rounds.length > 0 ? `[${e.rounds.join(", ")} rounds]` : "";
    visuals.push(
      <div
        key={`${e.type}-${e.category}`}
        className={cn("flex flex-row gap-2 items-center", className)}
      >
        {image}{" "}
        <div className="leading-none">
          <div className={cn(e.sealed ? "line-through" : "")}>
            {txtName} {showValue ? valTxt : ""}
          </div>
          <div className="text-xs">{roundsTxt}</div>
        </div>
      </div>,
    );
  };

  // Go through the effects, and for each type create the visual
  groupedEffects.forEach((value: CollapsedEffect[], key: string) => {
    // Icons with tooltips for each stat
    value.forEach((e) => {
      // Image to show
      const image = (
        <ElementImage
          key={`${key}-${e.category}`}
          element={e.category}
          className="w-8 h-8"
        />
      );
      // Show different effects
      switch (key) {
        case "damagegiven":
          if (e.value > 0) {
            insert(image, "text-green-500", `↑ Damage`, true, e);
          } else {
            insert(image, "text-red-500", `↓ Damage`, true, e);
          }
          break;
        case "damagetaken":
          if (e.value > 0) {
            insert(image, "text-red-500", `↓ Protection`, true, e);
          } else {
            insert(image, "text-green-500", `↑ Protection`, true, e);
          }
          break;
        case "stat":
          if (e.value > 0) {
            insert(image, "text-green-500", `↑ Stats`, true, e);
          } else {
            insert(image, "text-red-500", `↓ Stats`, true, e);
          }
          break;
        case "heal":
          if (e.value > 0) {
            insert(image, "text-green-500", `↑ Healing`, true, e);
          } else {
            insert(image, "text-red-500", `↓ Healing`, true, e);
          }
          break;
        case "poolcost":
          if (e.value > 0) {
            insert(image, "text-red-500", `↓ Action cost`, true, e);
          } else {
            insert(image, "text-green-500", `↑ Action cost`, true, e);
          }
          break;
        case "damage":
          insert(image, "text-red-500", `↓ Taking Dmg`, true, e);
          break;
        case "pierce":
          insert(image, "text-red-500", `↓ Piercing Dmg`, true, e);
          break;
        case "shield":
          insert(image, "text-green-500", `↑ Shield`, true, e);
          break;
        case "absorb":
          insert(image, "text-green-500", `↑ Absorb`, true, e);
          break;
        case "reflect":
          insert(image, "text-green-500", `↑ Reflect`, true, e);
          break;
        case "recoil":
          insert(image, "text-red-500", `↓ Dmg recoil`, true, e);
          break;
        case "drain":
          insert(image, "text-purple-500", `↓ Draining`, true, e);
          break;
        case "poison":
          insert(image, "text-purple-500", `↓ Poisoned`, true, e);
          break;
        case "lifesteal":
          insert(image, "text-green-500", `↑ Steal life`, true, e);
          break;
        case "fleeprevent":
          insert(image, "text-blue-500", `- Cannot Flee`, false, e);
          break;
        case "robprevent":
          insert(image, "text-blue-500", `- Rob Immunity`, false, e);
          break;
        case "buffprevent":
          insert(image, "text-blue-500", `- Buff Immunity`, false, e);
          break;
        case "debuffprevent":
          insert(image, "text-blue-500", `- Debuff Immunity`, false, e);
          break;
        case "clearprevent":
          insert(image, "text-blue-500", `- Clear Immunity`, false, e);
          break;
        case "cleanseprevent":
          insert(image, "text-blue-500", `- Cleanse Immunity`, false, e);
          break;
        case "healprevent":
          insert(image, "text-blue-500", `- Heal Prevention`, false, e);
          break;
        case "stunprevent":
          insert(image, "text-blue-500", `- Stun Resistance`, false, e);
          break;
        case "moveprevent":
          insert(image, "text-blue-500", `- Immobilized`, false, e);
          break;
        case "sealprevent":
          insert(image, "text-blue-500", `- Seal immunity`, false, e);
          break;
        case "onehitkillprevent":
          insert(image, "text-blue-500", `- OHKO immunity`, false, e);
          break;
        case "seal":
          insert(image, "text-blue-500", `- BL Sealed`, false, e);
          break;
        case "stun":
          insert(image, "text-blue-500", `- Stunned`, false, e);
          break;
        case "stealth":
          insert(image, "text-blue-500", `- Stealthed`, false, e);
          break;
        case "finalstand":
          insert(image, "text-orange-500", `- Final Stand`, false, e);
          break;
        case "clear":
          insert(image, "text-red-500", `↓ Clearing positive effects`, false, e);
          break;
        case "cleanse":
          insert(image, "text-green-500", `↑ Clearing negative effects`, false, e);
          break;
      }
    });
    // Show the effect with its stats
  });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-1 gap-3 md:gap-1 lg:gap-3 text-base md:text-xs lg:text-base">
      {visuals}
    </div>
  );
};
