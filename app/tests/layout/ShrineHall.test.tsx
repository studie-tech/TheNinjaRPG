import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { SHRINE_BOOST_BASE_PERC, SHRINE_BOOST_COST } from "@/drizzle/constants";
import * as contentBox from "@/layout/ContentBox";
import { ShrineHall } from "@/layout/ShrineHall";
import * as table from "@/layout/Table";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

describe("ShrineHall reserve boost locks", () => {
  let animationFrameDescriptor: PropertyDescriptor | undefined;
  let cancelAnimationFrameDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    ensureDom();
    animationFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame",
    );
    cancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "cancelAnimationFrame",
    );
    Object.defineProperties(globalThis, {
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) =>
          Number(setTimeout(() => callback(Date.now()), 0)),
      },
      cancelAnimationFrame: {
        configurable: true,
        value: (id: number) => clearTimeout(id),
      },
    });
    vi.spyOn(contentBox, "default").mockImplementation(
      ({ children }: { children: ReactNode }) => <>{children}</>,
    );
    vi.spyOn(table, "default").mockImplementation(() => <></>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    for (const [key, descriptor] of [
      ["requestAnimationFrame", animationFrameDescriptor],
      ["cancelAnimationFrame", cancelAnimationFrameDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  it.each([
    { name: "active reserve lock", lockDays: 7, canActivate: false },
    { name: "expired reserve lock", lockDays: -1, canActivate: true },
    { name: "unlocked shrine", lockDays: 0, canActivate: true },
  ])("shows the effective bonus and activation availability with $name", (fixture) => {
    const shrines = [{
      sector: 100,
      villageId: "reserve-village",
      shrineLevel: 3,
      boostLockedUntil: fixture.lockDays
        ? new Date(Date.now() + fixture.lockDays * 86400000)
        : null,
    }];
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
      expect(view.getByText("Need at least one Level 3 shrine to activate boosts")).toBeTruthy();
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
});

/** Render the Shrine Hall for a Kage whose village owns the given sectors. */
const renderShrineHall = (shrines: object[]) => {
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
    travel: { getSectorData: { useQuery: () => ({ data: {} }) } },
    shrine: {
      getCapturedSectors: { useQuery: () => ({ data: shrines }) },
      getShrineAis: { useQuery: () => ({ data: [] }) },
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
