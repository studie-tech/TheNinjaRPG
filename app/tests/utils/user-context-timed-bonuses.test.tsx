import { act, cleanup, render } from "@testing-library/react";
import * as clerk from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as trpc from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type ReactNode, useState } from "react";
import * as client from "@/app/_trpc/client";
import * as pusher from "@/layout/PusherHandler";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { UserContextProvider, useUserData } from "@/utils/UserContext";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();
const BASE = Date.UTC(2026, 9, 24, 12);
let nowMs = BASE;
const refetch = vi.fn();
const otherBoostNotice = {
  href: "/clanhall",
  name: "Clan crafting boost",
  group: "Active boosts",
  color: "green" as const,
};
const advance = (ms: number) => {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
};

beforeEach(() => {
  nowMs = BASE;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  refetch.mockClear();
  vi.spyOn(trpc, "getQueryKey").mockReturnValue([["profile", "getUser"]]);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "crafter" },
  } as never);
  vi.spyOn(pusher, "usePusherHandler").mockReturnValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mount = (
  fields: Record<string, unknown>,
  children: ReactNode = <div>Recipe</div>,
) => {
  const response = {
    serverTime: BASE - 2000,
    notifications: [
      otherBoostNotice,
      { href: "/territory-war", name: "Territory War bonus", group: "Active boosts", color: "green" },
    ],
    userData: {
      userId: "crafter",
      updatedAt: new Date(BASE),
      status: "AWAKE",
      ...fields,
    },
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getUser: {
        useQuery: () => {
          const [notifications, setNotifications] = useState(response.notifications);
          return {
            data: { ...response, notifications },
            status: "success",
            refetch: () => {
              refetch();
              // profile.getUser omits the active-boost notice after the window expires.
              setNotifications((current) =>
                current.filter((notice) => notice.name !== "Territory War bonus"),
              );
            },
          };
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UserContextProvider initialIsSignedIn>{children}</UserContextProvider>
    </QueryClientProvider>,
  );
};

describe("global timed bonus refresh", () => {
  it.each([
    { village: { territoryWarBoostUntil: new Date(BASE + 5000) } },
    {
      isOutlaw: true,
      clanId: "faction",
      clan: { territoryWarBoostUntil: new Date(BASE + 5000) },
      village: { territoryWarBoostUntil: new Date(BASE + 60_000) },
    },
  ])("refreshes the current competitor's bonus at server expiry %j", (fields) => {
    mount(fields);
    act(() => advance(7000));
    expect(refetch).not.toHaveBeenCalled();
    act(() => advance(1000));
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => advance(20_000));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps Cooking and raid-buff deadlines after the bonus refresh", () => {
    mount({
      village: { territoryWarBoostUntil: new Date(BASE + 5000) },
      cookingJobs: [{ finishesAt: new Date(BASE + 10_000) }],
      raidBuffs: [{ expiresAt: new Date(BASE + 15_000) }],
    });
    act(() => advance(8000));
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => advance(5000));
    expect(refetch).toHaveBeenCalledTimes(2);
    act(() => advance(5000));
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("propagates expiry through the boost notice with unchanged user data and clock offset", () => {
    const seen: ReturnType<typeof useUserData>[] = [];
    const Bonus = () => {
      const context = useUserData();
      seen.push(context);
      return (
        <output>
          {context.data
            ? getTerritoryWarBoost(
                context.data,
                new Date(Date.now() - context.timeDiff),
              )
            : 0}
        </output>
      );
    };
    const view = mount(
      { village: { territoryWarBoostUntil: new Date(BASE + 5000) } },
      <Bonus />,
    );
    const before = seen.at(-1)!;
    expect(view.getByText("0.15")).toBeTruthy();
    act(() => advance(8000));
    const after = seen.at(-1)!;
    expect(after.data).toBe(before.data);
    expect(after.timeDiff).toBe(before.timeDiff);
    expect(before.notifications).toHaveLength(2);
    expect(after.notifications).toEqual([otherBoostNotice]);
    expect(view.getByText("0")).toBeTruthy();
  });
});
