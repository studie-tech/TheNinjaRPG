import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import * as client from "@/app/_trpc/client";
import * as pools from "@/hooks/useEffectivePools";
import * as Avatar from "@/layout/Avatar";
import * as Image from "@/layout/Image";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import * as PoolStatusBars from "@/layout/PoolStatusBars";
import * as gameMenu from "@/hooks/useGameMenu";
import * as userContext from "@/utils/UserContext";

const localNow = new Date("2026-06-01T12:00:00.000Z");

const mount = (timers: Record<string, Date | null>, timeDiff: number) => {
  const data = {
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
    ...timers,
  };
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
    data,
    timeDiff,
  } as never);
  return render(<MenuBoxProfile />);
};

/** A server deadline `ms` ahead of the server clock, whose local reading is offset by timeDiff. */
const serverDeadline = (ms: number, timeDiff: number) =>
  new Date(localNow.getTime() - timeDiff + ms);

beforeEach(() => {
  setSystemTime(localNow);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: { getSidebarTimers: { useQuery: () => ({ data: undefined }) } },
    raids: { getUserRaidBuffs: { useQuery: () => ({ data: undefined }) } },
  });
  vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({ location: undefined } as never);
  vi.spyOn(pools, "useEffectivePools").mockReturnValue({} as never);
  vi.spyOn(Avatar, "default").mockReturnValue(null as never);
  vi.spyOn(Image, "default").mockReturnValue(null as never);
  vi.spyOn(PoolStatusBars, "PoolStatusBars").mockReturnValue(null as never);
});

afterEach(() => {
  cleanup();
  setSystemTime();
  vi.restoreAllMocks();
});

describe("sidebar timers", () => {
  it.each([
    ["immunityUntil", 0],
    ["bracketImmunityLiftedUntil", 0],
    ["warParticipantUntil", 0],
    ["immunityUntil", 300_000],
    ["bracketImmunityLiftedUntil", 300_000],
    ["warParticipantUntil", -300_000],
  ])("reads %s against the server clock at offset %i", (field, timeDiff) => {
    mount({ [field]: serverDeadline(3_725_500, timeDiff) }, timeDiff);
    expect(screen.getByText("[01:02:05]")).toBeTruthy();
  });

  it("shows a timer the local clock would call finished", () => {
    mount({ immunityUntil: serverDeadline(60_500, 300_000) }, 300_000);
    expect(screen.getByText("[01:00]")).toBeTruthy();
  });

  it("hides a timer the local clock would still count down", () => {
    mount({ warParticipantUntil: serverDeadline(-60_000, -300_000) }, -300_000);
    expect(screen.queryByText(/^\[/)).toBeNull();
  });

  it("keeps whole days in timers over a day", () => {
    mount({ immunityUntil: serverDeadline(90_000_500, 0) }, 0);
    expect(screen.getByText("[1d 01:00:00]")).toBeTruthy();
  });
});
