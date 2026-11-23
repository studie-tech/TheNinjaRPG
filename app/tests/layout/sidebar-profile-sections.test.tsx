import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { replaceEqualDeep } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import * as client from "@/app/_trpc/client";
import * as tooltip from "@/components/ui/tooltip";
import { MAX_PVP_BRACKET, XP_BRACKETS } from "@/drizzle/constants";
import * as gameMenu from "@/hooks/useGameMenu";
import * as Avatar from "@/layout/Avatar";
import * as Image from "@/layout/Image";
import * as Link from "@/layout/Link";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import * as PoolStatusBars from "@/layout/PoolStatusBars";
import * as StatusBar from "@/layout/StatusBar";
import { calcLevelRequirements } from "@/libs/profile";
import * as userContext from "@/utils/UserContext";

const regenAt = new Date("2026-06-01T12:00:00.000Z");
let user: Record<string, unknown>;
const listeners = new Set<() => void>();
const renders = { pools: 0, bars: [] as string[], links: [] as string[] };

/** Apply a profile write the way the query cache publishes it to selecting observers. */
const write = (patch: Record<string, unknown>) =>
  act(() => {
    user = { ...user, ...patch };
    for (const listener of listeners) listener();
  });

beforeEach(() => {
  user = {
    userId: "player",
    username: "Player",
    avatar: null,
    status: "AWAKE",
    battleId: null,
    level: 10,
    experience: calcLevelRequirements(9),
    earnedExperience: 0,
    rank: "GENIN",
    regenAt,
    regeneration: 5,
    raidBuffs: [],
    titles: [],
    curHealth: 90,
    maxHealth: 100,
    curChakra: 90,
    maxChakra: 100,
    curStamina: 90,
    maxStamina: 100,
    curEnergy: 90,
    maxEnergy: 100,
    money: 100,
    reputationPoints: 3,
    longitude: 1,
    latitude: 1,
    immunityUntil: new Date(0),
    bracketImmunityLiftedUntil: new Date(0),
    warParticipantUntil: new Date(0),
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
  };
  renders.pools = 0;
  renders.bars = [];
  renders.links = [];
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  vi.spyOn(tooltip, "TooltipProvider").mockImplementation(Pass as never);
  vi.spyOn(tooltip, "Tooltip").mockImplementation(Pass as never);
  vi.spyOn(tooltip, "TooltipTrigger").mockImplementation(Pass as never);
  vi.spyOn(tooltip, "TooltipContent").mockImplementation(Pass as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: { getSidebarTimers: { useQuery: () => ({ data: undefined }) } },
    raids: { getUserRaidBuffs: { useQuery: () => ({ data: undefined }) } },
  });
  vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({ location: undefined } as never);
  vi.spyOn(Avatar, "default").mockReturnValue(null as never);
  vi.spyOn(Image, "default").mockReturnValue(null as never);
  vi.spyOn(PoolStatusBars, "PoolStatusBars").mockImplementation((() => {
    renders.pools++;
    return null;
  }) as never);
  vi.spyOn(StatusBar, "default").mockImplementation((({ title }: { title: string }) => {
    renders.bars.push(title);
    return null;
  }) as never);
  vi.spyOn(Link, "default").mockImplementation((({
    href,
    children,
  }: {
    href: string;
    children?: ReactNode;
  }) => {
    renders.links.push(href);
    return <a href={href}>{children}</a>;
  }) as never);
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(((
    select: (profile: never) => unknown,
  ) => {
    const selected = useRef<unknown>(undefined);
    const data = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => {
        selected.current = replaceEqualDeep(selected.current, select(user as never));
        return selected.current;
      },
    );
    return { data, timeDiff: 0 };
  }) as never);
});

afterEach(() => {
  cleanup();
  listeners.clear();
  vi.restoreAllMocks();
});

/** Clear the render log after mounting so each write reports only what it re-rendered. */
const mount = () => {
  const view = render(<MenuBoxProfile />);
  renders.pools = 0;
  renders.bars = [];
  renders.links = [];
  return view;
};

describe("profile sidebar sections", () => {
  it("omits the portrait while retaining detailed player readings", () => {
    const view = render(<MenuBoxProfile showAvatar={false} />);
    expect(Avatar.default).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Status:");
    expect(view.container.textContent).toContain("100");
    expect(renders.pools).toBe(1);
    expect(renders.bars).toEqual(["EP", "XP"]);
  });

  it("re-renders only the money row for a money write", () => {
    const view = mount();
    write({ money: 250 });
    expect(view.container.textContent).toContain("250");
    expect(renders).toEqual({ pools: 0, bars: [], links: ["/profile"] });
  });

  it("re-renders only the pool bars for a pool write", () => {
    mount();
    write({ curHealth: 80 });
    expect(renders).toEqual({ pools: 1, bars: ["EP"], links: [] });
  });

  it("re-renders only the pool bars for a regeneration timestamp write", () => {
    mount();
    write({ regenAt: new Date(regenAt.getTime() + 60_000) });
    expect(renders).toEqual({ pools: 1, bars: ["EP"], links: [] });
  });

  it("re-renders nothing for a position write", () => {
    mount();
    write({ longitude: 2, latitude: 3 });
    expect(renders).toEqual({ pools: 0, bars: [], links: [] });
  });

  it("re-renders the level progress for an experience write", () => {
    mount();
    write({ experience: calcLevelRequirements(9) + 1 });
    expect(renders.bars).toEqual(["XP"]);
    expect(renders.pools).toBe(0);
  });

  it("updates the bracket when experience crosses a bracket boundary", () => {
    user = { ...user, rank: "CHUNIN", level: 45, experience: XP_BRACKETS[0].max };
    const view = mount();
    expect(view.container.textContent).toContain(`Bracket: 1/${MAX_PVP_BRACKET}`);

    write({ experience: XP_BRACKETS[0].max + 1 });

    expect(view.container.textContent).toContain(`Bracket: 2/${MAX_PVP_BRACKET}`);
  });
});
