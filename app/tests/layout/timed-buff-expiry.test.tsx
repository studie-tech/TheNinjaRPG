import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as pools from "@/hooks/useEffectivePools";
import * as gameMenu from "@/hooks/useGameMenu";
import { ActiveTimedBuffs } from "@/layout/ActiveTimedBuffs";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as Countdown from "@/layout/Countdown";
import * as Image from "@/layout/Image";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import * as PoolStatusBars from "@/layout/PoolStatusBars";
import * as userContext from "@/utils/UserContext";

const invalidateBuffs = vi.fn(async () => undefined);
const invalidateProfile = vi.fn(async () => undefined);
const refetchBuffs = vi.fn(async () => undefined);
const meal = {
  id: "meal",
  itemId: "stew",
  item: { name: "Stew", image: null },
  quest: null,
  effects: [],
  createdAt: new Date(0),
  expiresAt: new Date(0),
};

beforeEach(() => {
  meal.createdAt = new Date(Date.now() - 60_000);
  meal.expiresAt = new Date(Date.now() + 60_000);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      raids: { getUserRaidBuffs: { invalidate: invalidateBuffs } },
      profile: { getUser: { invalidate: invalidateProfile } },
    }),
    profile: { getSidebarTimers: { useQuery: () => ({ data: undefined }) } },
    raids: {
      getUserRaidBuffs: {
        useQuery: () => ({ data: { buffs: [meal] }, refetch: refetchBuffs }),
      },
    },
  });
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation((select) => {
    const value = {
      data: {
        userId: "player",
        username: "Player",
        status: "AWAKE",
        level: 10,
        experience: 0,
        rank: "GENIN",
      },
      timeDiff: 0,
    };
    return { ...value, data: select(value.data as never) } as never;
  });
  // Each countdown exposes its expiry callback as a button.
  vi.spyOn(Countdown, "default").mockImplementation((({
    onFinish,
  }: {
    onFinish?: () => unknown;
  }) => (
    <button type="button" onClick={() => void onFinish?.()}>
      expire
    </button>
  )) as never);
  vi.spyOn(ContentBox, "default").mockImplementation((({
    children,
  }: {
    children: React.ReactNode;
  }) => <section>{children}</section>) as never);
  vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({ location: undefined } as never);
  vi.spyOn(pools, "useEffectivePools").mockReturnValue({} as never);
  vi.spyOn(Avatar, "default").mockReturnValue(null as never);
  vi.spyOn(Image, "default").mockReturnValue(null as never);
  vi.spyOn(ItemWithEffects, "default").mockReturnValue(null as never);
  vi.spyOn(PoolStatusBars, "PoolStatusBars").mockReturnValue(null as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invalidateBuffs.mockClear();
  invalidateProfile.mockClear();
  refetchBuffs.mockClear();
});

// UserContext refetches the profile at every raid buff expiry on its own.
describe("timed buff expiry", () => {
  it("refreshes the sidebar meal list without a second profile read", async () => {
    render(<MenuBoxProfile />);
    await act(async () => {
      fireEvent.click(screen.getByText("expire"));
    });
    expect(invalidateBuffs).toHaveBeenCalledTimes(1);
    expect(invalidateProfile).not.toHaveBeenCalled();
  });

  it("refreshes the active effects panel without a second profile read", async () => {
    render(<ActiveTimedBuffs />);
    await act(async () => {
      fireEvent.click(screen.getByText("expire"));
    });
    expect(refetchBuffs).toHaveBeenCalledTimes(1);
    expect(invalidateProfile).not.toHaveBeenCalled();
  });
});
