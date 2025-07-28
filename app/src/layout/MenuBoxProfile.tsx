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
import { useLocalStorage } from "@/hooks/localstorage";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Filter } from "lucide-react";
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

type EffectCategory = GeneralType | StatType | ElementName | "All";

type CollapsedEffect = {
  type: string;
  value: number;
  calculation: "static" | "percentage" | "formula";
  category: EffectCategory;
  upDownEffect: boolean;
  rounds: number[];
  sealed: boolean;
};

interface VisualizeEffectsProps {
  effects: UserEffect[];
  userId: string;
}

export const VisualizeEffects: React.FC<VisualizeEffectsProps> = ({
  effects,
  userId,
}) => {
  // ------------- Toggle states -------------
  const [includeJutsu, setIncludeJutsu] = useLocalStorage<boolean>(
    "ve_include_jutsu",
    true,
  );
  const [includeArmor, setIncludeArmor] = useLocalStorage<boolean>(
    "ve_include_armor",
    true,
  );
  const [includeItem, setIncludeItem] = useLocalStorage<boolean>(
    "ve_include_item",
    true,
  );
  const [includeBloodline, setIncludeBloodline] = useLocalStorage<boolean>(
    "ve_include_bloodline",
    true,
  );
  const [includeVillage, setIncludeVillage] = useLocalStorage<boolean>(
    "ve_include_village",
    true,
  );
  const [includeSkill, setIncludeSkill] = useLocalStorage<boolean>(
    "ve_include_skill",
    true,
  );

  const includeEffect = (type?: UserEffect["fromType"]): boolean => {
    if (!type) return true;
    switch (type) {
      case "jutsu":
        return includeJutsu;
      case "armor":
        return includeArmor;
      case "item":
        return includeItem;
      case "bloodline":
        return includeBloodline;
      case "village":
        return includeVillage;
      case "skill":
        return includeSkill;
      default:
        return true;
    }
  };

  // Filter effects before processing
  const filteredEffects = effects.filter((e) => includeEffect(e.fromType));

  // Get sealing effects among the filtered ones (used for strike-through calculation)
  const sealEffects = filteredEffects.filter((e) => e.type === "seal" && !e.isNew);

  // Collapse consequences based on their type & calculation type
  const collapsedEffects =
    filteredEffects
      .filter(isEffectActive)
      .filter((e) => e.targetId === userId)
      .filter((e) => e.rounds === undefined || e.rounds > 0)
      .reduce((acc, val) => {
        const stats = [
          ...(("statTypes" in val && val?.statTypes) || []),
          ...(("generalTypes" in val && val?.generalTypes) || []),
          ...(("elements" in val && val?.elements) || []),
        ];
        const isSealed = sealCheck(val, sealEffects);
        let cats = stats.length === 0 ? ["All"] : stats;
        const JUTSU_CATS = ["Taijutsu", "Ninjutsu", "Genjutsu", "Bukijutsu"];
        if (JUTSU_CATS.every((jc) => cats.includes(jc))) {
          cats = cats.filter((c) => !JUTSU_CATS.includes(c));
          cats.push("All");
        }
        const dual = val.type.includes("increase") || val.type.includes("decrease");
        const baseType = dual
          ? val.type.replace("increase", "").replace("decrease", "")
          : val.type;
        const sign = val.type.includes("decrease") ? -1 : 1;
        const value = Math.abs(val.power + val.level * val.powerPerLevel) * sign;
        cats.forEach((cat) => {
          const found = acc.find(
            (e) =>
              e.type === baseType &&
              e.calculation === val.calculation &&
              e.category === cat &&
              e.sealed === isSealed,
          );
          if (found) {
            found.value += value;
            if (val.rounds) found.rounds.push(val.rounds);
          } else {
            acc.push({
              type: baseType,
              value: isSealed ? 0 : value,
              category: cat as EffectCategory,
              calculation: val.calculation,
              upDownEffect: dual,
              rounds: val.rounds ? [val.rounds] : [],
              sealed: isSealed,
            });
          }
        });
        return acc;
      }, [] as CollapsedEffect[]) || [];

  // ------------ UI helpers ------------
  const valueTxt = (e: CollapsedEffect) =>
    `${e.value > 0 ? "+" : ""}${Math.round(e.value)}${
      e.calculation === "percentage" ? "%" : ""
    }`;
  const roundsTxt = (e: CollapsedEffect) =>
    e.rounds.length > 0 ? `↻ ${Math.max(...e.rounds)}` : "";

  const renderCompact = (e: CollapsedEffect) => {
    // Determine if this effect is beneficial (green) or detrimental (red)
    const isPositiveEffect = (() => {
      switch (e.type) {
        case "damagegiven":
          return e.value > 0; // More damage dealt is good
        case "damagetaken":
          return e.value < 0; // Less damage taken is good
        default:
          return e.value > 0; // Fallback for other types
      }
    })();

    return (
      <div key={`${e.type}-${e.category}`} className="flex flex-row items-center gap-2">
        <ElementImage element={e.category} className="w-6 h-6 shrink-0" />
        <div className="flex flex-col leading-none">
          <div
            className={cn(
              isPositiveEffect ? "text-green-500" : "text-red-500",
              e.sealed && "line-through",
            )}
          >
            {valueTxt(e)}
          </div>
          {roundsTxt(e) && <div className="text-xs">{roundsTxt(e)}</div>}
        </div>
      </div>
    );
  };

  // ------------ Categorisation ------------
  const STATUS_TYPES = new Set([
    "shield",
    "absorb",
    "reflect",
    "recoil",
    "afterburn",
    "drain",
    "poison",
    "lifesteal",
    "fleeprevent",
    "robprevent",
    "buffprevent",
    "debuffprevent",
    "clearprevent",
    "cleanseprevent",
    "healprevent",
    "stunprevent",
    "moveprevent",
    "sealprevent",
    "onehitkillprevent",
    "seal",
    "stun",
    "stealth",
    "finalstand",
    "clear",
    "cleanse",
  ]);

  const statusEffects = collapsedEffects.filter((e) => STATUS_TYPES.has(e.type));
  const damageGivenEffects = collapsedEffects.filter((e) => e.type === "damagegiven");
  const damageTakenEffects = collapsedEffects.filter((e) => e.type === "damagetaken");
  const statEffects = collapsedEffects.filter((e) => e.type === "stat");

  const statusLabel: Record<string, string> = {
    reflect: "Reflect",
    shield: "Shield",
    absorb: "Absorb",
    recoil: "Recoil",
    afterburn: "Afterburn",
    drain: "Drain",
    poison: "Poison",
    lifesteal: "Lifesteal",
    fleeprevent: "Cannot Flee",
    robprevent: "Rob Immunity",
    buffprevent: "Buff Immunity",
    debuffprevent: "Debuff Immunity",
    clearprevent: "Clear Immunity",
    cleanseprevent: "Cleanse Immunity",
    healprevent: "Heal Prevention",
    stunprevent: "Stun Resistance",
    moveprevent: "Immobilized",
    sealprevent: "Seal Immunity",
    onehitkillprevent: "OHKO Immunity",
    seal: "BL Sealed",
    stun: "Stunned",
    stealth: "Stealthed",
    finalstand: "Final Stand",
    clear: "Clear Positives",
    cleanse: "Cleanse Debuffs",
  };

  const statusVisuals = statusEffects.map((e) => (
    <div
      key={`${e.type}-${e.category}`}
      className="flex flex-row items-center gap-2 text-xs"
    >
      <ElementImage element={e.category} className="w-6 h-6 shrink-0" />
      <div
        className={cn(e.sealed && "line-through")}
      >{`${statusLabel[e.type] || e.type} ${valueTxt(e)} ${roundsTxt(e)}`}</div>
    </div>
  ));

  // ------------ Render ------------
  return (
    <div className="relative flex flex-col gap-4 text-base md:text-xs lg:text-base">
      {effects.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Filter className="w-5 h-5 absolute top-0 right-0 hover:cursor-pointer hover:text-orange-500" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-max p-2 text-xs">
            <div className="flex flex-col gap-2">
              {[
                {
                  id: "jutsu",
                  label: "Jutsu",
                  checked: includeJutsu,
                  onChange: setIncludeJutsu,
                },
                {
                  id: "armor",
                  label: "Armor",
                  checked: includeArmor,
                  onChange: setIncludeArmor,
                },
                {
                  id: "item",
                  label: "Item",
                  checked: includeItem,
                  onChange: setIncludeItem,
                },
                {
                  id: "bloodline",
                  label: "Bloodline",
                  checked: includeBloodline,
                  onChange: setIncludeBloodline,
                },
                {
                  id: "village",
                  label: "Village",
                  checked: includeVillage,
                  onChange: setIncludeVillage,
                },
                {
                  id: "skill",
                  label: "Skill",
                  checked: includeSkill,
                  onChange: setIncludeSkill,
                },
              ].map(({ id, label, checked, onChange }) => (
                <div key={id} className="flex items-center gap-2">
                  <Switch
                    id={`ve-toggle-${id}`}
                    checked={checked}
                    onCheckedChange={onChange}
                  />
                  <label htmlFor={`ve-toggle-${id}`}>{label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {statusVisuals.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Statuses</div>
          <div className="flex flex-col gap-1">{statusVisuals}</div>
        </div>
      )}

      {damageGivenEffects.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Damage Given</div>
          <div className="grid grid-cols-2 gap-1">
            {damageGivenEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {damageTakenEffects.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Damage Taken</div>
          <div className="grid grid-cols-2 gap-1">
            {damageTakenEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {statEffects.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Stats</div>
          <div className="grid grid-cols-2 gap-1">{statEffects.map(renderCompact)}</div>
        </div>
      )}
    </div>
  );
};
