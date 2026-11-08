import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as tooltip from "@/components/ui/tooltip";
import {
  ERRANDS_PER_DAY,
  MEDICAL_MISSIONS_PER_DAY,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import * as gameMenu from "@/hooks/useGameMenu";
import * as pools from "@/hooks/useEffectivePools";
import * as Avatar from "@/layout/Avatar";
import * as Image from "@/layout/Image";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import * as PoolStatusBars from "@/layout/PoolStatusBars";
import * as userContext from "@/utils/UserContext";

const localNow = new Date("2026-06-01T12:00:00.000Z");
const later = (minutes: number) => new Date(localNow.getTime() + minutes * 60_000);

const user = {
  userId: "player",
  username: "Player",
  status: "AWAKE",
  level: 10,
  experience: 0,
  rank: "GENIN",
  battleId: null,
  immunityUntil: new Date(0),
  bracketImmunityLiftedUntil: new Date(0),
  warParticipantUntil: new Date(0),
  currentlyTrainingMastery: "ninjutsuMastery",
  masteryTrainingStartedAt: localNow,
  trainingSpeed: "15min",
  covertTrainingType: "stealth",
  covertTrainingStartedAt: localNow,
  covertTrainingMinutes: 45,
  dailyMissions: 1,
  dailyErrands: 2,
  dailyMedicalMissions: 0,
  dailyPvpMissions: 1,
  reputationPoints: 7,
};

beforeEach(() => {
  setSystemTime(localNow);
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  vi.spyOn(tooltip, "TooltipProvider").mockImplementation(Pass as never);
  vi.spyOn(tooltip, "Tooltip").mockImplementation(Pass as never);
  vi.spyOn(tooltip, "TooltipTrigger").mockImplementation((({ className, children }: { className?: string; children?: ReactNode }) => (
    <div data-trigger={className ?? ""}>{children}</div>
  )) as never);
  vi.spyOn(tooltip, "TooltipContent").mockImplementation((({ children }: { children?: ReactNode }) => (
    <div data-tooltip="">{children}</div>
  )) as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getSidebarTimers: {
        useQuery: () => ({
          data: {
            jutsuTraining: { name: "Fireball", level: 3, finishTraining: later(30) },
            crafting: { itemName: "Kunai", craftingFinishedAt: later(20) },
            imbuement: { imbuedName: "Flame", targetName: "Sword", craftingFinishedAt: later(25) },
          },
        }),
      },
    },
    raids: { getUserRaidBuffs: { useQuery: () => ({ data: undefined }) } },
  });
  vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({ location: undefined } as never);
  vi.spyOn(pools, "useEffectivePools").mockReturnValue({} as never);
  vi.spyOn(Avatar, "default").mockReturnValue(null as never);
  vi.spyOn(Image, "default").mockReturnValue(null as never);
  vi.spyOn(PoolStatusBars, "PoolStatusBars").mockReturnValue(null as never);
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({ data: user, timeDiff: 0 } as never);
});

afterEach(() => {
  cleanup();
  setSystemTime();
  vi.restoreAllMocks();
});

const rows = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("[data-trigger]")].map((trigger) => {
    const link = trigger.querySelector("a");
    return {
      trigger: trigger.getAttribute("data-trigger"),
      outer: trigger.firstElementChild?.tagName,
      outerClass: trigger.firstElementChild?.getAttribute("class"),
      href: link?.getAttribute("href") ?? null,
      linkWraps: link ? link.textContent : null,
      text: trigger.textContent,
      tooltip: trigger.nextElementSibling?.textContent,
    };
  });

describe("sidebar status rows", () => {
  it("renders each timer and quota row with its link placement and tooltip", () => {
    const view = render(<MenuBoxProfile />);
    const all = rows(view);
    const timers = all.filter((row) => row.outer === "DIV" && row.href && row.href !== "/missionhall" && row.href !== "/points");
    expect(timers).toEqual([
      {
        trigger: "w-full",
        outer: "DIV",
        outerClass: "flex flex-row items-center hover:text-orange-500",
        href: "/traininggrounds",
        linkWraps: "15 mins, 0 secs",
        text: "15 mins, 0 secs",
        tooltip: "Mastery training",
      },
      {
        trigger: "w-full",
        outer: "DIV",
        outerClass: "flex flex-row items-center hover:text-orange-500",
        href: "/traininggrounds",
        linkWraps: "30 mins, 0 secs",
        text: "30 mins, 0 secs",
        tooltip: "Training Fireball to level 3",
      },
      {
        trigger: "w-full",
        outer: "DIV",
        outerClass: "flex flex-row items-center hover:text-orange-500",
        href: "/traininggrounds",
        linkWraps: "45 mins, 0 secs",
        text: "45 mins, 0 secs",
        tooltip: "Stealth training",
      },
      {
        trigger: "w-full",
        outer: "DIV",
        outerClass: "flex flex-row items-center hover:text-orange-500",
        href: "/occupation",
        linkWraps: "20 mins, 0 secs",
        text: "20 mins, 0 secs",
        tooltip: "Crafting Kunai",
      },
      {
        trigger: "w-full",
        outer: "DIV",
        outerClass: "flex flex-row items-center hover:text-orange-500",
        href: "/occupation",
        linkWraps: "25 mins, 0 secs",
        text: "25 mins, 0 secs",
        tooltip: "Imbuing Flame onto Sword",
      },
    ]);
    const quotas = all.filter((row) => row.outer === "A");
    expect(quotas).toEqual(
      [
        ["/profile", "両??", "Money on hand"],
        ["/missionhall", ` 1 / ${MISSIONS_PER_DAY}`, "Daily missions to complete"],
        ["/missionhall", ` 2 / ${ERRANDS_PER_DAY}`, "Daily errands to complete"],
        ["/missionhall", ` 0 / ${MEDICAL_MISSIONS_PER_DAY}`, "Daily medical missions to complete"],
        ["/missionhall", ` 1 / ${PVP_MISSIONS_PER_DAY}`, "Daily PvP missions to complete"],
        ["/points", " 7", "Reputation points for use in black market"],
      ].map(([href, text, tip]) => ({
        trigger: "w-full",
        outer: "A",
        outerClass: "hover:text-orange-500",
        href,
        linkWraps: text,
        text,
        tooltip: tip,
      })),
    );
    const iconRows = [...view.container.querySelectorAll("[data-trigger]")].filter((trigger) =>
      ["/traininggrounds", "/occupation", "/missionhall", "/points"].includes(
        trigger.querySelector("a")?.getAttribute("href") ?? "",
      ),
    );
    expect(iconRows).toHaveLength(10);
    for (const trigger of iconRows) {
      expect(trigger.querySelector("svg")?.getAttribute("class") ?? "").toContain("mr-2 h-6 w-6");
    }
  });

  it("hides quota rows once their daily limit is reached", () => {
    vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
      data: {
        ...user,
        dailyMissions: MISSIONS_PER_DAY,
        dailyErrands: ERRANDS_PER_DAY,
        dailyMedicalMissions: MEDICAL_MISSIONS_PER_DAY,
        dailyPvpMissions: PVP_MISSIONS_PER_DAY,
      },
      timeDiff: 0,
    } as never);
    const view = render(<MenuBoxProfile />);
    expect(rows(view).filter((row) => row.href === "/missionhall")).toEqual([]);
  });
});
