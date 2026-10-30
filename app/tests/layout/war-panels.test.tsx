import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import { type ComponentProps, type ReactNode, useState } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as select from "@/components/ui/select";
import {
  WAR_ESPIONAGE_TARGET,
  WAR_POINT_CONVERSION_DAYS,
  WAR_POINT_PRESTIGE_RATE,
} from "@/drizzle/constants";
import * as modal from "@/layout/Modal";
import { ObjectiveWarPanel } from "@/layout/ObjectiveWarPanel";
import { WarDashboardNotices } from "@/layout/WarDashboardNotices";
import { WarFieldActions } from "@/layout/WarFieldActions";
import { WarMercenaries } from "@/layout/WarMercenaries";
import type { UserWithRelations } from "@/routers/profile";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import { SimpleObjective } from "@/validators/objectives";
import { defaultWarRules } from "@/validators/war";
import { ensureDom } from "../setup/dom.mjs";

type ObjectiveInfo = NonNullable<RouterOutputs["war"]["getObjectiveWarInfo"]>;
type MutationResult = import("@/validators/userCache").UserDeltaResponse & { battleId?: string };
type MutationCallbacks = {
  onMutate?: () => number | undefined;
  onSuccess?: (result: MutationResult, variables: unknown, revision: number | undefined) => void | Promise<void>;
  onError?: (error: Error) => void;
};
type PollInterval = (query: {
  state: { data?: ObjectiveInfo | null };
}) => number | false;

/** Keep transport controllable while preserving each component's pending and feedback lifecycle. */
const mutation = () => {
  const mutate = vi.fn();
  let callbacks: MutationCallbacks;
  let revision: number | undefined;
  let setPending: (pending: boolean) => void;
  return {
    mutate,
    useMutation: (options: MutationCallbacks) => {
      const [isPending, setIsPending] = useState(false);
      const [variables, setVariables] = useState<unknown>();
      callbacks = options;
      setPending = setIsPending;
      return {
        isPending,
        variables,
        mutate: (input: unknown) => {
          revision = options.onMutate?.();
          mutate(input);
          setVariables(input);
          setIsPending(true);
        },
      };
    },
    respond: async (result: MutationResult) => {
      await callbacks.onSuccess?.(result, undefined, revision);
      setPending(false);
    },
    fail: (message: string) => {
      callbacks.onError?.(new Error(message));
      setPending(false);
    },
  };
};

const start = mutation();
const finish = mutation();
const cancel = mutation();
const attack = mutation();
const camp = mutation();
const convert = mutation();
const objectiveRefetch = vi.fn(async () => {});
const claimRefetch = vi.fn(async () => {});
const campRefetch = vi.fn(async () => {});
const invalidateObjective = vi.fn(async () => {});
const invalidateWars = vi.fn(async () => {});
const invalidateClaims = vi.fn(async () => {});
const invalidateUser = vi.fn(async () => {});
const updateUser = vi.fn(async (_patch: unknown) => {});
const router = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  bfcacheId: "war-panels",
};
const NOW = Date.UTC(2026, 9, 1, 12);
let nowMs: number;
let timeDiff: number;
let user: NonNullable<UserWithRelations>;
let info: ObjectiveInfo | null | undefined;
let objectiveError: Error | null;
let isPending: boolean;
let pollInterval: PollInterval;
let wars: {
  id: string;
  rules: unknown;
  attackerVillage: { name: string };
  defenderVillage: { name: string };
}[];
let mercenaries: RouterOutputs["war"]["getMercenaries"];
let claims: RouterOutputs["war"]["getWarPointClaims"];
let camps: RouterOutputs["war"]["getWarCampNotices"];
let claimError: Error | null;
const originalEvent = globalThis.Event;
const originalCustomEvent = globalThis.CustomEvent;

const makeInfo = (): ObjectiveInfo => ({
  war: {
    id: "war-1",
    type: "VILLAGE_WAR",
    status: "ACTIVE",
    endedAt: null,
    startedAt: new Date(NOW - 7_200_000),
    lastTokenReductionAt: new Date(NOW - 7_200_000),
    settlement: null,
    settlementPending: false,
    sector: 20,
    targetStructureRoute: "/townhall",
    attackerShrineHp: 1000,
    attackerShrineMaxHp: 1000,
    attackerShrineStatus: "ACTIVE",
    defenderShrineHp: 1000,
    defenderShrineMaxHp: 1000,
    defenderShrineStatus: "ACTIVE",
    combatStartedAt: new Date(NOW - 3_600_000),
    rules: { ...defaultWarRules, durationDays: 2 },
    attackerVillageId: "own",
    defenderVillageId: "enemy",
    attackerVillage: { name: "Own village", sector: 10 },
    defenderVillage: { name: "Enemy village", sector: 20 },
    attackerWarHealth: 8000,
    attackerWarHealthMax: 10000,
    defenderWarHealth: 6000,
    defenderWarHealthMax: 10000,
    warAllies: [],
    warMercenaries: [],
    objectiveState: {
      attackerEspionage: WAR_ESPIONAGE_TARGET,
      defenderEspionage: 0,
      objectives: [20, 30].map((sector) => ({
        sector,
        villageId: "enemy",
        hp: 500,
        maxHp: 1000,
        isReserve: false,
        destroyed: false,
      })),
    },
  },
  missions: [
    {
      questId: "quest-1",
      name: "Weaken the shrine",
      objective: SimpleObjective.parse({
        id: "objective-1",
        task: "sabotage",
        durationSeconds: 30,
        value: 100,
      }),
    },
  ],
  camps: [20, 30].map((sector) => ({
    id: `camp-${sector}`,
    warId: "war-1",
    guardianId: "guardian",
    sector,
    startsAt: new Date(NOW - 10_000),
    endsAt: new Date(NOW + 60_000),
    attackerScore: 10,
    defenderScore: 5,
    resolvedAt: null,
  })),
  contributions: [],
  combatContributions: [],
  attempt: null,
});

const mount = (children: ReactNode) =>
  render(
    <AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider>,
  );
const openTab = (view: ReturnType<typeof render>, name: RegExp | string) => {
  fireEvent.mouseDown(view.getByRole("tab", { name }), { button: 0, ctrlKey: false });
};
const advance = (ms: number) =>
  act(() => {
    nowMs += ms;
    vi.advanceTimersByTime(ms);
  });
const readyAttempt = (endsAt = new Date(NOW - 1000).toISOString()) => ({
  id: "attempt-1",
  warId: "war-1",
  questId: "quest-1",
  objectiveId: "objective-1",
  sideVillageId: "own",
  villageId: "own",
  sector: 20,
  task: "sabotage" as const,
  value: 100,
  endsAt,
});

beforeEach(() => {
  ensureDom();
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  vi.clearAllMocks();
  vi.useFakeTimers();
  nowMs = NOW;
  timeDiff = 0;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  user = {
    userId: "ninja",
    villageId: "own",
    sector: 20,
  } as NonNullable<UserWithRelations>;
  info = makeInfo();
  objectiveError = null;
  claimError = null;
  isPending = false;
  claims = [];
  mercenaries = { canHire: false, roster: [] };
  camps = [];
  wars = [
    {
      id: "war-1",
      rules: defaultWarRules,
      attackerVillage: { name: "Own village" },
      defenderVillage: { name: "Enemy village" },
    },
  ];
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      war: {
        getObjectiveWarInfo: { invalidate: invalidateObjective },
        getActiveWars: { invalidate: invalidateWars },
        getWarPointClaims: { invalidate: invalidateClaims },
      },
      profile: { getUser: { invalidate: invalidateUser } },
    }),
    war: {
      getMercenaries: { useQuery: () => ({ data: mercenaries }) },
      getMercenaryOffers: { useQuery: () => ({ data: [] }) },
      inviteMercenary: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      acceptMercenary: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      leaveMercenary: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      getObjectiveWarInfo: {
        useQuery: vi.fn(
          (_input: unknown, options: { refetchInterval: PollInterval }) => {
            pollInterval = options.refetchInterval;
            const [, setVersion] = useState(0);
            objectiveRefetch.mockImplementation(async () =>
              setVersion((version) => version + 1),
            );
            return {
              data: info,
              error: objectiveError,
              isPending,
              refetch: objectiveRefetch,
            };
          },
        ),
      },
      getActiveWars: { useQuery: () => ({ data: wars }) },
      getWarPointClaims: {
        useQuery: () => ({ data: claims, error: claimError, refetch: claimRefetch }),
      },
      getWarCampNotices: { useQuery: () => ({ data: camps, refetch: campRefetch }) },
      startWarMission: start,
      completeWarMission: finish,
      cancelWarMission: cancel,
      attackWarCamp: camp,
      convertWarPoints: convert,
    },
    profile: { searchUsers: { useQuery: () => ({ data: [] }) } },
    combat: { startShrineBattle: attack },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () => ({ data: user, timeDiff, updateUser, prepareUserUpdate: () => 7 }) as never,
  );
  vi.spyOn(routing, "pushToCombat").mockImplementation(() => {});
  // Exercise our mounting/selection logic; shared Modal and Radix behavior have their own coverage.
  vi.spyOn(modal, "default").mockImplementation((props) => (
    <div role="dialog" aria-label={props.title}>
      {props.children}
      <button type="button" onClick={() => props.setIsOpen(false)}>
        Close
      </button>
    </div>
  ));
  vi.spyOn(select, "Select").mockImplementation(
    ({ value, onValueChange, children }: ComponentProps<typeof select.Select>) => (
      <select
        aria-label="Choose a war"
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    ),
  );
  vi.spyOn(select, "SelectTrigger").mockImplementation(
    Object.assign(() => <></>, { displayName: select.SelectTrigger.displayName }),
  );
  vi.spyOn(select, "SelectContent").mockImplementation(
    Object.assign(
      ({ children }: ComponentProps<typeof select.SelectContent>) => <>{children}</>,
      { displayName: select.SelectContent.displayName },
    ),
  );
  vi.spyOn(select, "SelectItem").mockImplementation(
    Object.assign(
      ({ value, children }: ComponentProps<typeof select.SelectItem>) => (
        <option value={value}>{children}</option>
      ),
      { displayName: select.SelectItem.displayName },
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.Event = originalEvent;
  globalThis.CustomEvent = originalCustomEvent;
});

describe("war mercenary management", () => {
  const contract = (slot: number) => ({
    id: `contract-${slot}`, warId: "war-1", sideVillageId: "own", userId: `mercenary-${slot}`,
    invitedById: "kage", tokens: 4, slot, createdAt: new Date(NOW),
    acceptedAt: slot === 1 ? new Date(NOW) : null, endedAt: null,
    activeSlot: slot, activeUserId: slot === 1 ? `mercenary-${slot}` : null,
    invitedUserId: `mercenary-${slot}`, user: { username: `Mercenary ${slot}` },
  });

  it("keeps the roster collapsed and omits hiring at capacity, restoring it when a slot opens", () => {
    mercenaries = { canHire: true, roster: [contract(1), contract(2), contract(3)] };
    const view = mount(<WarMercenaries warId="war-1" />);
    const summary = view.getByText("Mercenaries · 3/3");
    const disclosure = summary.closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(view.queryByPlaceholderText("Choose mercenary")).toBeNull();
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    expect(view.getByRole("button", { name: "Dismiss" })).toBeDefined();
    expect(view.getAllByRole("button", { name: "Cancel invitation" })).toHaveLength(2);
    expect(view.queryByRole("button", { name: "Invite mercenary" })).toBeNull();

    mercenaries = { ...mercenaries, roster: mercenaries.roster.slice(0, 2) };
    view.rerender(<WarMercenaries warId="war-1" />);
    expect(disclosure.open).toBe(true);
    expect(view.getByText("Mercenaries · 2/3")).toBeDefined();
    expect(view.getByPlaceholderText("Choose mercenary")).toBeDefined();
    expect(view.getByLabelText("Village token payment")).toBeDefined();
    expect(view.getByRole("button", { name: "Invite mercenary" })).toBeDefined();
    expect(view.getByText(/1 token = 1,000 Ryo/)).toBeDefined();
  });

  it("keeps resignation available to a hired player without exposing hiring controls", () => {
    mercenaries = { canHire: false, roster: [contract(1)] };
    const view = mount(<WarMercenaries warId="war-1" />);
    fireEvent.click(view.getByText("Mercenaries · 1/3"));
    expect(view.getByRole("button", { name: "Resign" })).toBeDefined();
    expect(view.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(view.queryByPlaceholderText("Choose mercenary")).toBeNull();
  });
});

describe("war field objectives", () => {
  it("keeps masked contributions readable without profile navigation in either table", () => {
    const identities = [
      { userId: null, username: "Mercenary", isMasked: true },
      { userId: user.userId, username: "Mercenary", isMasked: false },
    ];
    info!.contributions = identities.map((identity) => ({
      ...identity, damage: 100, recovery: 50, convertedAt: null, expiredAt: null,
    }));
    info!.combatContributions = identities.map((identity) => ({
      ...identity, kills: 1, losses: 0,
    }));
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    openTab(view, "Contributions");
    for (const table of view.getAllByRole("table")) {
      const [masked, own] = within(table).getAllByRole("row").slice(1);
      expect(masked!.textContent).toContain("Mercenary");
      expect(masked!.classList.contains("cursor-pointer")).toBe(false);
      fireEvent.click(masked!);
      expect(router.push).not.toHaveBeenCalled();
      fireEvent.click(own!);
      expect(router.push).toHaveBeenCalledWith(`/userid/${user.userId}`);
      router.push.mockClear();
    }
  });

  it("mounts one field panel only while its toolbar dialog is open", () => {
    const view = mount(<WarFieldActions />);
    const query = client.api.war.getObjectiveWarInfo.useQuery;
    const toggle = view.getByRole("button", { name: "War" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(query).not.toHaveBeenCalled();
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const dialog = view.getByRole("dialog", { name: "War" });
    expect(
      within(dialog).getAllByRole("region", { name: "War objectives" }),
    ).toHaveLength(1);
    expect(query).toHaveBeenCalledWith({ warId: "war-1" }, expect.anything());
    expect(view.queryByRole("tab", { name: "Contributions" })).toBeNull();
    expect(view.queryByText("Townhall health")).toBeNull();
    expect(
      view
        .getByRole("link", { name: "View war overview and contributions" })
        .getAttribute("href"),
    ).toBe("/townhall#Wars");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByRole("region", { name: "War objectives" })).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects one participating war at a time and falls back when the selected war ends", () => {
    wars.push({ ...wars[0]!, id: "war-2", defenderVillage: { name: "Other village" } });
    const view = mount(<WarFieldActions />);
    fireEvent.click(view.getByRole("button", { name: "War" }));
    fireEvent.change(view.getByRole("combobox", { name: "Choose a war" }), {
      target: { value: "war-2" },
    });
    expect(client.api.war.getObjectiveWarInfo.useQuery).toHaveBeenLastCalledWith(
      { warId: "war-2" },
      expect.anything(),
    );
    expect(view.getAllByRole("region", { name: "War objectives" })).toHaveLength(1);
    wars = [wars[0]!];
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(client.api.war.getObjectiveWarInfo.useQuery).toHaveBeenLastCalledWith(
      { warId: "war-1" },
      expect.anything(),
    );
    expect(view.queryByRole("combobox")).toBeNull();
  });

  it("hides uninvolved and legacy wars and never reopens automatically after participation ends", () => {
    const view = mount(<WarFieldActions />);
    fireEvent.click(view.getByRole("button", { name: "War" }));
    const saved = wars;
    wars = [{ ...wars[0]!, rules: null }];
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(view.queryByRole("button", { name: "War" })).toBeNull();
    expect(view.queryByRole("dialog")).toBeNull();
    wars = [];
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(view.queryByRole("button", { name: "War" })).toBeNull();
    wars = saved;
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(
      view.getByRole("button", { name: "War" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("counts only unexpired camps and this participant's ready mission using server time", () => {
    timeDiff = 5000;
    user.warMission = readyAttempt(new Date(NOW - 3000).toISOString());
    camps = [
      { id: "expired", sector: 10, endsAt: new Date(NOW - 6000) },
      { id: "open", sector: 20, endsAt: new Date(NOW + 60_000) },
    ];
    const view = mount(<WarFieldActions />);
    expect(view.getByRole("button", { name: "War, 1 update" })).toBeDefined();
    advance(3000);
    expect(campRefetch).toHaveBeenCalledTimes(1);
    expect(view.getByRole("button", { name: "War, 2 updates" })).toBeDefined();
    advance(63_000);
    expect(view.getByRole("button", { name: "War, 1 update" })).toBeDefined();
    expect(client.api.war.getObjectiveWarInfo.useQuery).not.toHaveBeenCalled();
    user.warMission = { ...user.warMission, warId: "unrelated" };
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(view.getByRole("button", { name: "War" })).toBeDefined();
  });

  it("offers retry after the initial load fails and stops polling an ended snapshot", () => {
    info = undefined;
    isPending = true;
    const view = mount(<WarFieldActions />);
    fireEvent.click(view.getByRole("button", { name: "War" }));
    expect(view.getByText("Loading war objectives...")).toBeDefined();
    isPending = false;
    objectiveError = new Error("Connection interrupted");
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(view.getByRole("alert").textContent).toContain(
      "Unable to load war objectives",
    );
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(objectiveRefetch).toHaveBeenCalledTimes(1);
    info = makeInfo();
    objectiveError = null;
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(pollInterval({ state: { data: info } })).toBe(10000);
    info = { ...info, war: { ...info.war, status: "DRAW", endedAt: new Date(NOW) } };
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarFieldActions />
      </AppRouterContext.Provider>,
    );
    expect(view.getByText("War ended")).toBeDefined();
    expect(pollInterval({ state: { data: info } })).toBe(false);
  });

  it("unlocks mission completion at its server-time boundary and refreshes eligibility", () => {
    timeDiff = 5000;
    info!.attempt = readyAttempt(new Date(NOW - 3000).toISOString());
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    expect(
      (view.getByRole("button", { name: "Complete mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(view.queryByText("Ready to complete")).toBeNull();
    advance(1999);
    expect(objectiveRefetch).not.toHaveBeenCalled();
    advance(1001);
    expect(objectiveRefetch).toHaveBeenCalledTimes(1);
    expect(view.getByText(/Ready to complete/)).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Complete mission" }));
    expect(finish.mutate).toHaveBeenCalledWith({ attemptId: "attempt-1" });
    expect(
      (view.getByRole("button", { name: "Completing..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it.each([
    { villageId: "own", side: "own", destination: "Enemy village", sector: 20 },
    { villageId: "enemy", side: "enemy", destination: "Own village", sector: 10 },
    { villageId: "ally", side: "own", destination: "Enemy village", sector: 20 },
    { villageId: "ally", side: "enemy", destination: "Own village", sector: 10 },
  ])(
    "guides $villageId on side $side to the opposing village for espionage",
    (fixture) => {
      user.villageId = fixture.villageId;
      info!.war.objectiveState!.attackerEspionage = 0;
      info!.war.warAllies = [
        {
          id: "ally-1",
          warId: "war-1",
          villageId: "ally",
          supportVillageId: fixture.side,
          tokensPaid: 0,
          acceptedAt: new Date(NOW),
          joinedAt: new Date(NOW),
          endedAt: null,
          activeVillageId: "ally",
        },
      ];
      const view = mount(<ObjectiveWarPanel warId="war-1" />);
      openTab(view, "Missions");
      expect(
        view
          .getByRole("link", {
            name: `${fixture.destination} (sector ${fixture.sector})`,
          })
          .getAttribute("href"),
      ).toBe(`/travel?sector=${fixture.sector}`);
    },
  );

  it("keeps rejected and failed missions retryable with feedback beside the action", async () => {
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    openTab(view, "Missions");
    expect(
      view.getByText(/Travel to a revealed enemy shrine to sabotage it/),
    ).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Start sabotage" }));
    expect(start.mutate).toHaveBeenCalledWith({
      warId: "war-1",
      questId: "quest-1",
      objectiveId: "objective-1",
    });
    expect(
      (view.getByRole("button", { name: "Starting..." }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(() =>
      start.respond({ success: false, message: "Return to your village first" }),
    );
    expect(view.getByRole("alert").textContent).toBe("Return to your village first");
    expect(invalidateObjective).toHaveBeenCalledWith({ warId: "war-1" });
    expect(invalidateWars).toHaveBeenCalledTimes(1);
    expect(invalidateUser).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Start sabotage" }));
    expect(view.queryByRole("alert")).toBeNull();
    act(() => start.fail("Network unavailable"));
    expect(view.getByRole("alert").textContent).toBe("Network unavailable");
    expect(
      (view.getByRole("button", { name: "Start sabotage" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("retains cancellation after a war ends and blocks starting a second concurrent mission", async () => {
    info!.attempt = { ...readyAttempt(), warId: "another-war" };
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    openTab(view, "Missions");
    expect(view.getByRole("status").textContent).toContain("mission in the other war");
    expect(
      (view.getByRole("button", { name: "Start sabotage" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(view.queryByRole("button", { name: "Complete mission" })).toBeNull();
    info!.attempt = readyAttempt();
    info!.war = { ...info!.war, status: "DRAW", endedAt: new Date(NOW) };
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <ObjectiveWarPanel warId="war-1" />
      </AppRouterContext.Provider>,
    );
    expect(
      (view.getByRole("button", { name: "Complete mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Cancel mission" }));
    expect(cancel.mutate).toHaveBeenCalledWith({ attemptId: "attempt-1" });
    await act(() => cancel.respond({ success: true, message: "Mission cancelled" }));
    expect(view.getByRole("status").textContent).toBe("Mission cancelled");
  });

  it("offers local guardian and camp battles while remote sectors require travel", async () => {
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    const local = within(
      view.getByRole("heading", { name: "Attack sector 20" }).parentElement!
        .parentElement!,
    );
    const remote = within(
      view.getByRole("heading", { name: "Attack sector 30" }).parentElement!
        .parentElement!,
    );
    expect(local.queryByRole("link", { name: /Travel/ })).toBeNull();
    expect(local.getByText("You are here")).toBeDefined();
    expect(
      remote.getByRole("link", { name: "Travel to sector 30" }).getAttribute("href"),
    ).toBe("/travel?sector=30");
    expect(
      (remote.getByRole("button", { name: "Attack guardian" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(local.getByRole("button", { name: "Attack guardian" }));
    expect(attack.mutate).toHaveBeenCalledWith({ sector: 20 });
    let publishUser: () => void = () => {};
    updateUser.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          publishUser = resolve;
        }),
    );
    let response: Promise<void>;
    act(() => {
      response = attack.respond({
        success: true,
        message: "Battle ready",
        battleId: "battle-1",
      });
    });
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ status: "BATTLE", battleId: "battle-1" }),
    );
    expect(routing.pushToCombat).not.toHaveBeenCalled();
    await act(async () => {
      publishUser();
      await response;
    });
    expect(routing.pushToCombat).toHaveBeenCalledWith(
      expect.objectContaining({ push: router.push }),
      "battle-1",
    );
    openTab(view, /^Camps/);
    const localCamp = within(
      view.getByRole("heading", { name: "War camp · Sector 20" }).parentElement!
        .parentElement!,
    );
    const remoteCamp = within(
      view.getByRole("heading", { name: "War camp · Sector 30" }).parentElement!
        .parentElement!,
    );
    expect(
      (remoteCamp.getByRole("button", { name: "Attack war camp" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(localCamp.getByRole("button", { name: "Attack war camp" }));
    expect(camp.mutate).toHaveBeenCalledWith({ campId: "camp-20" });
    await act(() => camp.respond({ success: false, message: "This camp has closed" }));
    expect(view.getByRole("alert").textContent).toBe("This camp has closed");
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("keeps combat closed in the notice period and after settlement starts", () => {
    info!.war.combatStartedAt = new Date(NOW + 60_000);
    const view = mount(<ObjectiveWarPanel warId="war-1" />);
    expect(view.getByText("Notice period")).toBeDefined();
    expect(view.queryByRole("button", { name: "Attack guardian" })).toBeNull();
    openTab(view, "Missions");
    expect(view.getByText("Espionage and sabotage missions unlock when combat begins.")).toBeDefined();
    expect(
      (view.getByRole("button", { name: "Start sabotage" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    openTab(view, /^Camps/);
    expect(
      view
        .getAllByRole("button", { name: "Attack war camp" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    info!.war.attackerWarHealth = 0;
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <ObjectiveWarPanel warId="war-1" />
      </AppRouterContext.Provider>,
    );
    expect(view.getByText("Settling war")).toBeDefined();
    openTab(view, "Missions");
    expect(
      (view.getByRole("button", { name: "Start sabotage" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("war dashboard updates", () => {
  it("retries failed notices and refreshes camps and claims at their server deadline", () => {
    claimError = new Error("Unavailable");
    const view = mount(<WarDashboardNotices />);
    expect(view.getByRole("alert").textContent).toContain(
      "Unable to refresh war updates",
    );
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(claimRefetch).toHaveBeenCalledTimes(1);
    expect(campRefetch).toHaveBeenCalledTimes(1);
    claimError = null;
    timeDiff = 5000;
    camps = [{ id: "camp-20", sector: 20, endsAt: new Date(NOW - 3000) }];
    view.rerender(
      <AppRouterContext.Provider value={router}>
        <WarDashboardNotices />
      </AppRouterContext.Provider>,
    );
    expect(
      view.getByRole("link", { name: "Travel to camp" }).getAttribute("href"),
    ).toBe("/travel?sector=20");
    advance(1999);
    expect(campRefetch).toHaveBeenCalledTimes(1);
    advance(1001);
    expect(claimRefetch).toHaveBeenCalledTimes(2);
    expect(campRefetch).toHaveBeenCalledTimes(2);
  });

  it("serializes reward conversion, retains rejection feedback, and refreshes prestige on success", async () => {
    claims = ["war-1", "war-2"].map((warId) => ({
      warId,
      points: 100,
      endedAt: new Date(NOW),
    }));
    const view = mount(<WarDashboardNotices />);
    expect(
      view.getAllByText(
        `100 war points → ${(100 * WAR_POINT_PRESTIGE_RATE).toLocaleString()} prestige`,
      ),
    ).toHaveLength(2);
    fireEvent.click(
      view.getAllByRole("button", { name: "Convert all war points" })[0]!,
    );
    expect(convert.mutate).toHaveBeenCalledWith({ warId: "war-1" });
    expect(
      (view.getByRole("button", { name: "Converting..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        view.getByRole("button", {
          name: "Convert all war points",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(() =>
      convert.respond({ success: false, message: "This reward has expired" }),
    );
    expect(view.getByRole("alert").textContent).toBe("This reward has expired");
    expect(invalidateClaims).toHaveBeenCalledTimes(1);
    expect(invalidateUser).not.toHaveBeenCalled();
    fireEvent.click(
      view.getAllByRole("button", { name: "Convert all war points" })[0]!,
    );
    expect(view.queryByRole("alert")).toBeNull();
    act(() => convert.fail("Connection interrupted"));
    expect(view.getByRole("alert").textContent).toBe("Connection interrupted");
    fireEvent.click(
      view.getAllByRole("button", { name: "Convert all war points" })[0]!,
    );
    await act(() => convert.respond({ success: true, message: "Prestige granted" }));
    expect(view.getByRole("status").textContent).toBe("Prestige granted");
    expect(invalidateClaims).toHaveBeenCalledTimes(2);
    expect(invalidateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refreshes expiring point claims without waiting for the next background poll", () => {
    const lifetime = WAR_POINT_CONVERSION_DAYS * 86400000;
    claims = [
      { warId: "war-1", points: 100, endedAt: new Date(NOW - lifetime + 2000) },
    ];
    mount(<WarDashboardNotices />);
    advance(1999);
    expect(claimRefetch).not.toHaveBeenCalled();
    advance(1001);
    expect(claimRefetch).toHaveBeenCalledTimes(1);
    expect(campRefetch).toHaveBeenCalledTimes(1);
  });
});
