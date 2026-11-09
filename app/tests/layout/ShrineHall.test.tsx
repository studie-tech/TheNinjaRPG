import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { SHRINE_BOOST_BASE_PERC, SHRINE_BOOST_COST } from "@/drizzle/constants";
import * as contentBox from "@/layout/ContentBox";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { ShrineHall } from "@/layout/ShrineHall";
import * as table from "@/layout/Table";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

describe("ShrineHall reserve boost locks", () => {
  beforeEach(() => {
    installBrowserGlobals({ events: [], animationFrame: true });
    vi.spyOn(contentBox, "default").mockImplementation(
      ({ children }: { children: ReactNode }) => <>{children}</>,
    );
    vi.spyOn(table, "default").mockImplementation(() => <></>);
    vi.spyOn(itemWithEffects, "default").mockImplementation(() => <></>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreBrowserGlobals();
  });

  it.each([
    { name: "active reserve lock", lockDays: 7, canActivate: false },
    { name: "expired reserve lock", lockDays: -1, canActivate: true },
    { name: "unlocked shrine", lockDays: 0, canActivate: true },
  ])("shows the effective bonus and activation availability with $name", (fixture) => {
    const shrines = [
      {
        sector: 100,
        villageId: "reserve-village",
        shrineLevel: 3,
        boostLockedUntil: fixture.lockDays
          ? new Date(Date.now() + fixture.lockDays * 86400000)
          : null,
      },
    ];
    const view = renderShrineHall(shrines);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Boosts" }), {
      button: 0,
      ctrlKey: false,
    });
    const bonus = fixture.canActivate ? SHRINE_BOOST_BASE_PERC : 0;
    expect(view.getByText(`+${bonus}% bonus`)).toBeTruthy();
    if (fixture.canActivate) {
      const activation = view.getByRole("button", {
        name: /Crafting.*Activate Now/,
      }) as HTMLButtonElement;
      expect(activation.textContent).toContain(`+${bonus}%`);
      expect(activation.disabled).toBe(false);
    } else {
      expect(view.queryByRole("button", { name: /Activate Now/ })).toBeNull();
      expect(
        view.getByText("Need at least one Level 3 shrine to activate boosts"),
      ).toBeTruthy();
    }
  });

  it("leaves destroyed level 0 shrines out of maintenance", () => {
    const view = renderShrineHall([
      { id: 1, sector: 100, villageId: "reserve-village", shrineLevel: 2 },
      { id: 2, sector: 290, villageId: "reserve-village", shrineLevel: 0 },
    ]);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Maintenance" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(view.getByText("Sector 100")).toBeTruthy();
    expect(view.queryByText("Sector 290")).toBeNull();
  });

  it("judges maintenance due dates against the server clock", () => {
    // The device runs two hours ahead of the server, so an hour-old due date is still upcoming.
    vi.spyOn(UserContext, "useUserInfo").mockReturnValue({
      timeDiff: 2 * 3600000,
    } as never);
    const view = renderShrineHall([
      {
        id: 1,
        sector: 100,
        villageId: "reserve-village",
        shrineLevel: 2,
        nextMaintainanceDueDate: new Date(Date.now() - 3600000),
      },
    ]);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Maintenance" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(view.getByText("Sector 100")).toBeTruthy();
    expect(view.queryByText("Payment overdue")).toBeNull();
  });

  const defenders = (activeAiIds: string[], unlockedAiIds: string[]) => {
    const view = renderShrineHall(
      [{ id: 1, sector: 100, villageId: "reserve-village", shrineLevel: 2 }],
      {
        ais: ["live-a", "live-b", "live-c", "live-d"].map((userId) => ({
          userId,
          username: userId,
          level: 50,
        })),
        settings: { activeAiIds, unlockedAiIds },
      },
    );
    fireEvent.mouseDown(view.getByRole("tab", { name: "Defenders" }), {
      button: 0,
      ctrlKey: false,
    });
    return view;
  };

  it("does not count retired defenders against the assignment cap", () => {
    const retired = ["retired-a", "retired-b", "retired-c"];
    const view = defenders(retired, [...retired, "live-a"]);
    expect(view.getByRole("button", { name: "Assign" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(view.queryByText(/Maximum defenders assigned/)).toBeNull();
    expect(view.getByText("Using default AI defenders")).toBeTruthy();
  });

  it("disables assignment once live defenders fill the cap", () => {
    const live = ["live-a", "live-b", "live-c"];
    const view = defenders(live, [...live, "live-d"]);
    expect(view.getByRole("button", { name: "Assign" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(view.getByText(/Maximum defenders assigned/)).toBeTruthy();
  });
});

/** Render the Shrine Hall for a Kage whose village owns the given sectors. */
const renderShrineHall = (
  shrines: object[],
  defenders: { ais?: object[]; settings?: object } = {},
) => {
  const user = {
    userId: "kage",
    villageId: "reserve-village",
    sector: 100,
    role: "USER",
    rank: "JONIN",
    village: {
      id: "reserve-village",
      name: "Reserve village",
      kageId: "kage",
      tokens: SHRINE_BOOST_COST * 3,
      shrineSettings: {
        activeBoosts: { Training: new Date(Date.now() + 3600000).toISOString() },
        boostTemplate: [],
        ...defenders.settings,
      },
    },
  } as unknown as NonNullable<UserWithRelations>;
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  const invalidation = { invalidate: vi.fn() };
  const templateData = { boostTemplate: [] };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      profile: { getUser: invalidation },
      travel: { getSectorData: invalidation },
      shrine: {
        getCapturedSectors: invalidation,
        getBoostTemplate: invalidation,
      },
    }),
    shrine: {
      getCapturedSectors: { useQuery: () => ({ data: shrines }) },
      getShrineAis: { useQuery: () => ({ data: defenders.ais ?? [] }) },
      getBoostTemplate: { useQuery: () => ({ data: templateData }) },
      upgradeShrine: mutation,
      activateBoost: mutation,
      unlockAiDefender: mutation,
      toggleVillageAiDefender: mutation,
      payWeeklyMaintenance: mutation,
      setBoostTemplate: mutation,
    },
    war: { getActiveWars: { useQuery: () => ({ data: [], refetch: vi.fn() }) } },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: user,
    updateUser: vi.fn(),
    prepareUserUpdate: vi.fn(),
  } as never);

  return render(<ShrineHall user={user} navTabs={null} />);
};
