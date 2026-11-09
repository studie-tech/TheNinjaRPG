import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as dynamic from "next/dynamic";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import {
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
} from "@/drizzle/constants";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import * as map from "@/hooks/map";
import * as building from "@/layout/Building";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as GlobalMap from "@/layout/Map";
import * as panel from "@/layout/ObjectiveWarPanel";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import type { FetchActiveWarsReturnType } from "@/routers/war";
import * as UserContext from "@/utils/UserContext";
import { defaultWarRules } from "@/validators/war";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { controllableMutation, stubSelect } from "./helpers/warUi";
import { testRouter } from "../setup/router";

// Exercise declarations through WarMap while isolating map rendering and transport.
vi.spyOn(dynamic, "default").mockImplementation(
  () =>
    ((props: { onTileClick: (sector: number) => void }) => (
      <>
        <button type="button" onClick={() => props.onTileClick(102)}>
          Target tile
        </button>
        <button type="button" onClick={() => props.onTileClick(103)}>
          Alliance tile
        </button>
        <button type="button" onClick={() => props.onTileClick(105)}>
          Sector tile
        </button>
      </>
    )) as never,
);
const { WarRoom } = await import("@/layout/WarSystem");
const { WarMap } = await import("@/layout/WarMap");
const { SectorWar } = await import("@/layout/SectorWar");
const { VillageWar } = await import("@/layout/VillageWar");

type MutationResult = { success: boolean; message: string };
const mutation = () => controllableMutation<MutationResult>();

const declarations = mutation();
const declare = declarations.mutate;
const releaseSector = mutation();
const leaveAlliance = mutation();
const declareEnemy = mutation();
const sectorWar = mutation();
const buildShrine = mutation();
const adminEndWar = mutation();
const invalidateAllSectors = vi.fn(async () => {});
const own = {
  id: "own",
  name: "Own",
  sector: 101,
  type: "VILLAGE",
  allianceSystem: true,
} as Village;
const target = {
  id: "target",
  name: "Target",
  sector: 102,
  type: "VILLAGE",
  allianceSystem: true,
} as Village;
const allied = { ...target, id: "allied", name: "Allied", sector: 103 };
const structures = [
  { id: "mission", name: "Mission Hall", route: "/missionhall" },
  { id: "training", name: "Training Grounds", route: "/traininggrounds" },
  { id: "town", name: "Town Hall", route: "/townhall" },
] as VillageStructure[];
let user: NonNullable<UserWithRelations>;
let ownsSector = false;
let relationshipStatus: VillageAlliance["status"] = "ENEMY";
let raidOptions: { route: string; block?: string }[] = [];

beforeEach(() => {
  // Isolate globe rendering when another page has already loaded WarMap.
  vi.spyOn(GlobalMap, "default").mockImplementation((props) => (
    <>
      <button type="button" onClick={() => props.onTileClick?.(102)}>
        Target tile
      </button>
      <button type="button" onClick={() => props.onTileClick?.(103)}>
        Alliance tile
      </button>
      <button type="button" onClick={() => props.onTileClick?.(105)}>
        Sector tile
      </button>
    </>
  ));
  installBrowserGlobals();
  vi.clearAllMocks();
  ownsSector = false;
  relationshipStatus = "ENEMY";
  raidOptions = [];
  user = {
    userId: "leader",
    villageId: own.id,
    village: own,
    isOutlaw: false,
  } as NonNullable<UserWithRelations>;
  const invalidate = vi.fn(async () => {});
  invalidateAllSectors.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      village: { getSectorOwnerships: { invalidate }, getAlliances: { invalidate } },
      travel: { getAllSectors: { invalidate: invalidateAllSectors } },
      war: { getActiveWars: { invalidate }, getRaidOptions: { invalidate } },
    }),
    travel: {
      getAllSectors: {
        useQuery: () => ({
          data: ownsSector ? [{ villageId: own.id, sectors: [102] }] : [],
        }),
      },
    },
    village: {
      getVillageStructures: { useQuery: () => ({ data: structures }) },
      releaseSector,
      leaveAlliance,
      declareEnemy,
    },
    war: {
      getRules: { useQuery: () => ({ data: undefined }) },
      getRaidOptions: {
        useQuery: () => ({ data: raidOptions, isFetching: false }),
      },
      declareSectorWar: sectorWar,
      declareVillageWarOrRaid: declarations,
      buildShrine,
      adminEndWar,
    },
  });
  vi.spyOn(map, "useMap").mockReturnValue({ globe: {} as never, mapError: false });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () => ({ data: user }) as never,
  );
  vi.spyOn(Image, "default").mockImplementation(() => <span />);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  stubSelect("Structure");
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = () =>
  render(
    <WarMap
      user={user}
      isKage
      villages={ownsSector ? [user.village!] : [user.village!, target, allied]}
      relationships={[
        {
          id: "enemies",
          villageIdA: own.id,
          villageIdB: target.id,
          status: relationshipStatus,
        } as VillageAlliance,
        {
          id: "allies",
          villageIdA: own.id,
          villageIdB: allied.id,
          status: "ALLY",
        } as VillageAlliance,
      ]}
    />,
  );

describe("war room participation", () => {
  it("loads active wars without village membership and keeps village history unavailable", () => {
    vi.spyOn(ContentBox, "default").mockImplementation(
      ({ title, children, topRightContent }) => (
        <>
          <h1>{title}</h1>
          {topRightContent}
          {children}
        </>
      ),
    );
    user = { ...user, villageId: null, village: null };
    const activeWars = vi.fn(() => ({ data: [] }));
    const endedWars = vi.fn(() => ({ data: undefined }));
    Object.assign(client.api.village, {
      getAlliances: { useQuery: () => ({ data: { villages: [], relationships: [] } }) },
    });
    Object.assign(client.api.war, {
      getActiveWars: { useQuery: activeWars },
      getEndedWars: { useQuery: endedWars },
      getAllyOffers: { useQuery: () => ({ data: [] }) },
      acceptAllyOffer: declarations,
      rejectAllyOffer: declarations,
      cancelAllyOffer: declarations,
    });
    const view = render(
      <AppRouterContext.Provider value={testRouter("war-room")}>
        <WarRoom user={user} />
      </AppRouterContext.Provider>,
    );
    expect(activeWars).toHaveBeenCalledWith(
      { villageId: "" },
      expect.objectContaining({ enabled: true }),
    );
    expect(endedWars).toHaveBeenCalledWith(
      { villageId: "" },
      expect.objectContaining({ enabled: false }),
    );
    expect(view.getByRole("heading", { name: "Active Wars" })).toBeDefined();
    expect(view.getByRole("button", { name: "Active" })).toBeDefined();
    expect(view.getByText("No active wars")).toBeDefined();
    expect(view.queryByText("Join a village first")).toBeNull();
    expect(view.queryByRole("button", { name: "Ended" })).toBeNull();
  });
});

describe("war declaration targets", () => {
  it.each(["HIDEOUT", "STRONGHOLD"] as const)(
    "explains why %s cannot acquire another sector while retaining owned-sector release",
    (type) => {
      user = { ...user, isOutlaw: true, village: { ...own, type } };
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Sector tile" }));
      expect(view.getByText("Factions cannot purchase sectors.")).toBeDefined();
      expect(view.queryByRole("button", { name: "Declare War" })).toBeNull();
      expect(sectorWar.mutate).not.toHaveBeenCalled();
      fireEvent.click(view.getAllByRole("button", { name: /^Close$/ })[0]!);
      ownsSector = true;
      view.rerender(
        <WarMap user={user} isKage villages={[user.village!]} relationships={[]} />,
      );
      fireEvent.click(view.getByRole("button", { name: "Target tile" }));
      fireEvent.click(view.getByRole("button", { name: "Release Sector" }));
      expect(releaseSector.mutate).toHaveBeenCalledWith({ sector: 102 });
    },
  );

  it("continues offering sector declarations to ordinary villages", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Sector tile" }));
    fireEvent.click(view.getByRole("button", { name: "Declare War" }));
    expect(sectorWar.mutate).toHaveBeenCalledWith({
      sectorId: 105,
      userVillageId: own.id,
    });
  });

  it("declares ordinary village wars against the Town Hall", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    fireEvent.click(view.getByRole("button", { name: "Declare War" }));
    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare).toHaveBeenCalledWith({
      userVillageId: own.id,
      targetVillageId: target.id,
      targetStructureRoute: "/townhall",
    });
  });

  it("explains the daily token decay before sector and village wars", () => {
    const decay = `Each day at war reduces your tokens by ${WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to ${WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5}% after 5 days and ${WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8}% after 8 days).`;
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    expect(view.getByRole("dialog").textContent).toContain(`Village Tokens. ${decay}`);
    cleanup();
    const sector = mount();
    fireEvent.click(sector.getByRole("button", { name: "Sector tile" }));
    expect(sector.getByRole("dialog").textContent).toContain(
      `Village Tokens. ${decay}`,
    );
  });

  it("lists the alliances an enemy declaration breaks and the enemies it adds", () => {
    relationshipStatus = "NEUTRAL";
    const rich = { ...own, tokens: 1_000_000_000 } as Village;
    const third = { ...target, id: "third", name: "Third", sector: 104 };
    user = { ...user, village: rich };
    const view = render(
      <WarMap
        user={user}
        isKage
        villages={[rich, target, allied, third]}
        relationships={
          [
            {
              id: "own-target",
              villageIdA: own.id,
              villageIdB: target.id,
              status: "NEUTRAL",
            },
            {
              id: "own-allied",
              villageIdA: own.id,
              villageIdB: allied.id,
              status: "ALLY",
            },
            {
              id: "allied-target",
              villageIdA: allied.id,
              villageIdB: target.id,
              status: "ALLY",
            },
            {
              id: "third-target",
              villageIdA: third.id,
              villageIdB: target.id,
              status: "ALLY",
            },
          ] as VillageAlliance[]
        }
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    expect(view.getByText("Additional Enemies:").parentElement?.textContent).toBe(
      "Additional Enemies: Third will become enemies",
    );
    expect(view.getByText("Broken Alliances:").parentElement?.textContent).toBe(
      "Broken Alliances: Allied will become neutral",
    );
  });

  it("shows a structure's raid block and holds the raid until another structure is chosen", () => {
    raidOptions = [
      { route: "/missionhall", block: "Raided too recently" },
      { route: "/traininggrounds" },
    ];
    user = { ...user, isOutlaw: true, village: { ...own, type: "HIDEOUT" } };
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    expect(view.getByRole("status").textContent).toBe("Raided too recently");
    expect(
      (view.getByRole("button", { name: "Start Raid" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const selector = view.getAllByRole("combobox", { name: "Structure" }).at(-1)!;
    fireEvent.change(selector, { target: { value: "/traininggrounds" } });
    expect(view.queryByRole("status")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Start Raid" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps the faction raid default and submits the selected structure", () => {
    user = { ...user, isOutlaw: true, village: { ...own, type: "HIDEOUT" } };
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    const selector = view.getAllByRole("combobox", { name: "Structure" }).at(-1)!;
    expect((selector as HTMLSelectElement).value).toBe("/missionhall");
    expect(view.queryByRole("option", { name: "Town Hall" })).toBeNull();
    fireEvent.change(selector, { target: { value: "/traininggrounds" } });
    fireEvent.click(view.getByRole("button", { name: "Start Raid" }));
    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare).toHaveBeenCalledWith({
      userVillageId: own.id,
      targetVillageId: target.id,
      targetStructureRoute: "/traininggrounds",
    });
  });
});

describe("paid sector shrine claims", () => {
  const mountShrine = () =>
    render(
      <SectorWar
        user={user}
        isKage
        war={
          {
            id: "claim-sector",
            attackerVillageId: own.id,
            defenderVillageId: target.id,
            attackerVillage: { ...own, structures: [] },
            defenderVillage: { ...target, structures: [] },
            type: "SECTOR_WAR",
            status: "ACTIVE",
            sector: 105,
            defenderShrineHp: 0,
            startedAt: new Date(),
            endedAt: null,
            lastTokenReductionAt: new Date(),
            warAllies: [],
            attackerShrineHp: 0,
            attackerShrineMaxHp: 0,
            attackerShrineStatus: "CAPTURED",
            defenderShrineMaxHp: 500,
            defenderShrineStatus: "CAPTURED",
            attackerWarHealth: 10000,
            attackerWarHealthMax: 10000,
            defenderWarHealth: 10000,
            defenderWarHealthMax: 10000,
            targetStructureRoute: "/townhall",
            settlement: null,
            settlementPending: false,
            rules: null,
            objectiveState: null,
            combatStartedAt: null,
          } satisfies FetchActiveWarsReturnType
        }
      />,
    );

  it.each(["HIDEOUT", "STRONGHOLD"] as const)(
    "does not offer %s a paid shrine claim from an existing war",
    (type) => {
      user = {
        ...user,
        isOutlaw: true,
        village: { ...own, type, tokens: WAR_PURCHASE_SHRINE_TOKEN_COST },
      };
      const view = mountShrine();
      expect(
        view.getByText(
          "This shrine has been destroyed. Factions cannot purchase sectors.",
        ),
      ).toBeDefined();
      expect(view.queryByRole("button", { name: /Build Shrine/ })).toBeNull();
      expect(buildShrine.mutate).not.toHaveBeenCalled();
    },
  );

  it("continues offering ordinary villages a paid shrine claim", () => {
    user = { ...user, village: { ...own, tokens: WAR_PURCHASE_SHRINE_TOKEN_COST } };
    const view = mountShrine();
    fireEvent.click(view.getAllByRole("button", { name: /Build Shrine/ })[0]!);
    fireEvent.click(view.getByRole("button", { name: "Proceed" }));
    expect(buildShrine.mutate).toHaveBeenCalledWith({ warId: "claim-sector" });
  });

  it("refreshes the war map's sector owners after claiming a shrine", async () => {
    user = { ...user, village: { ...own, tokens: WAR_PURCHASE_SHRINE_TOKEN_COST } };
    mountShrine();
    await act(() => buildShrine.respond({ success: true, message: "Claimed" }));
    expect(invalidateAllSectors).toHaveBeenCalledTimes(1);
  });
});

describe("war map confirmations", () => {
  it("clears a rejected declaration when opening another target from the map", async () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    fireEvent.click(view.getByRole("button", { name: "Declare War" }));
    await act(() =>
      declarations.respond({ success: false, message: "Declaration rejected" }),
    );
    expect(view.getByRole("alert").textContent).toBe("Declaration rejected");
    fireEvent.click(view.getAllByRole("button", { name: /^Close$/ })[0]!);
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Alliance tile" }));
    expect(view.getByRole("button", { name: "Break Alliance" })).toBeDefined();
    expect(view.queryByRole("alert")?.textContent ?? null).toBeNull();
  });

  for (const scenario of [
    { label: "Declare Enemy", status: "NEUTRAL", action: declareEnemy },
    { label: "Break Alliance", status: "ALLY", action: leaveAlliance },
    { label: "Release Sector", status: "ENEMY", action: releaseSector },
  ] as const) {
    it(`dismisses ${scenario.label} after acceptance and successful completion`, async () => {
      relationshipStatus = scenario.status;
      ownsSector = scenario.action === releaseSector;
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Target tile" }));
      expect(view.getByRole("dialog")).toBeDefined();
      fireEvent.click(view.getByRole("button", { name: scenario.label }));
      expect(scenario.action.mutate).toHaveBeenCalledTimes(1);
      expect(view.queryByRole("dialog")).toBeNull();
      await act(() => scenario.action.respond({ success: true, message: "Success" }));
      expect(view.queryByRole("dialog")).toBeNull();
    });
  }

  for (const isOutlaw of [false, true]) {
    it(`keeps a rejected ${isOutlaw ? "raid" : "village war"} open for retry and closes on success`, async () => {
      if (isOutlaw) user = { ...user, isOutlaw, village: { ...own, type: "HIDEOUT" } };
      const label = isOutlaw ? "Start Raid" : "Declare War";
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Target tile" }));
      fireEvent.click(view.getByRole("button", { name: label }));
      expect(view.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
      expect(
        view
          .getAllByRole("button", { name: /^Close$/ })
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true);
      await act(() =>
        declarations.respond({ success: false, message: "Declaration rejected" }),
      );
      expect(view.getByRole("alert").textContent).toBe("Declaration rejected");
      expect(view.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
      expect(
        (view.getByRole("button", { name: label }) as HTMLButtonElement).disabled,
      ).toBe(false);
      fireEvent.click(view.getByRole("button", { name: label }));
      expect(view.queryByRole("alert")).toBeNull();
      expect(declare).toHaveBeenCalledTimes(2);
      await act(() => declarations.respond({ success: true, message: "Success" }));
      expect(view.queryByRole("dialog")).toBeNull();
    });
  }

  it("keeps a transport failure open with feedback and usable controls", async () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Target tile" }));
    fireEvent.click(view.getByRole("button", { name: "Declare War" }));
    await act(() => declarations.fail());
    expect(view.getByRole("alert").textContent).toBe(
      "The declaration could not be completed. Please try again.",
    );
    expect(
      (view.getByRole("button", { name: "Declare War" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      view
        .getAllByRole("button", { name: /^Close$/ })
        .every((button) => !(button as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});

describe("objective war townhall health", () => {
  const war = {
    id: "objective-war",
    type: "VILLAGE_WAR",
    status: "ACTIVE",
    rules: defaultWarRules,
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    warAllies: [
      {
        villageId: "attacker-ally",
        supportVillageId: "attacker",
        village: { name: "Attacking ally" },
      },
      {
        villageId: "defender-ally",
        supportVillageId: "defender",
        village: { name: "Defending ally" },
      },
    ],
    attackerVillage: {
      id: "attacker",
      name: "Attacker",
      structures: [{ route: "/townhall" }],
    },
    defenderVillage: {
      id: "defender",
      name: "Defender",
      structures: [{ route: "/townhall" }],
    },
    startedAt: new Date(),
    lastTokenReductionAt: new Date(),
    targetStructureRoute: "/townhall",
    attackerWarHealth: 10000,
    defenderWarHealth: 10000,
    attackerWarHealthMax: 10000,
    defenderWarHealthMax: 10000,
  } as FetchActiveWarsReturnType;
  const freshWar = { ...war, attackerWarHealth: 9700, defenderWarHealth: 8200 };
  let response: FetchActiveWarsReturnType | undefined;
  let pollInterval: (query: {
    state: { data?: { war: FetchActiveWarsReturnType } };
  }) => number | false;

  beforeEach(() => {
    response = undefined;
    const mutation = {
      useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    };
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      war: {
        getObjectiveWarInfo: {
          useQuery: (
            _input: unknown,
            options: { refetchInterval: typeof pollInterval },
          ) => {
            pollInterval = options.refetchInterval;
            return { data: response ? { war: response } : undefined };
          },
        },
        getWarKills: { useQuery: () => ({}) },
        getWarKillStats: { useQuery: () => ({}) },
        getAllyOffers: { useQuery: () => ({ data: [] }) },
        acceptAllyOffer: mutation,
        rejectAllyOffer: mutation,
        cancelAllyOffer: mutation,
        createAllyOffer: mutation,
        surrender: mutation,
        adminEndWar: mutation,
      },
    });
    vi.spyOn(panel, "ObjectiveWarPanel").mockImplementation(() => null);
    vi.spyOn(building, "default").mockImplementation(() => null);
    vi.spyOn(Image, "default").mockImplementation(() => null);
  });

  const expectHealth = (view: ReturnType<typeof render>, health: number[]) => {
    const labels = view.getAllByText(/^HP \(/);
    expect(labels.map((label) => label.textContent)).toEqual(
      health.map((current) => `HP (${current} / 10000)`),
    );
    expect(
      labels.map(
        (label) =>
          (label.parentElement?.querySelector(".bg-red-500") as HTMLElement).style
            .width,
      ),
    ).toEqual(health.map((current) => `${(current / 10000) * 100}%`));
  };

  const viewers = [
    ["attacker", true],
    ["attacker-ally", true],
    ["defender", false],
    ["defender-ally", false],
  ] as const;

  it("keeps masked kill history and statistics readable while preserving ordinary and self navigation", () => {
    const push = vi.fn();
    const router = {
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      push,
      replace: vi.fn(),
      prefetch: vi.fn(),
      bfcacheId: "war-history",
    };
    // Bun preserves module mocks across files, so bind the hook to this test's router.
    vi.spyOn(navigation, "useRouter").mockReturnValue(router);
    const identities = [
      { userId: null, username: "Mercenary" },
      { userId: "ordinary", username: "Ordinary" },
      { userId: user.userId, username: "Self" },
    ];
    Object.assign(client.api.war, {
      getWarKills: {
        useQuery: () => ({
          data: identities.map((identity, index) => ({
            id: `kill-${index}`,
            killerId: identity.userId,
            killer: { ...identity, avatar: "" },
            victim: { userId: "victim", username: "Victim", avatar: "" },
            killerVillage: { name: "Attacker" },
            victimVillage: { name: "Defender" },
            killedAt: new Date(),
            sector: 1,
            shrineHpChange: 0,
            townhallHpChange: 0,
          })),
        }),
      },
      getWarKillStats: {
        useQuery: () => ({
          data: identities.map((identity) => ({
            killerId: identity.userId,
            killerUsername: identity.username,
            killerAvatar: "",
            villageName: null,
            count: 1,
          })),
        }),
      },
    });
    const view = render(
      <AppRouterContext.Provider value={router}>
        <VillageWar war={{ ...war, rules: null }} user={user} isKage={false} />
      </AppRouterContext.Provider>,
    );
    for (const icon of ["swords", "trophy"]) {
      fireEvent.click(
        view.container.querySelector(`.lucide-${icon}`)!.closest("button")!,
      );
      const rows = within(view.getByRole("dialog")).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(3);
      expect(rows[0]!.textContent).toContain("Mercenary");
      expect(rows[0]!.classList.contains("cursor-pointer")).toBe(false);
      fireEvent.click(rows[0]!);
      expect(push).not.toHaveBeenCalled();
      for (const index of [1, 2]) {
        fireEvent.click(rows[index]!);
        expect(push).toHaveBeenLastCalledWith(`/userid/${identities[index]!.userId}`);
      }
      push.mockClear();
      fireEvent.click(
        within(view.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0]!,
      );
    }
  });

  it.each(viewers)(
    "shows the latest initial snapshot to %s",
    (villageId, isAttacker) => {
      response = freshWar;
      const user = {
        userId: "viewer",
        villageId,
        role: "USER",
      } as NonNullable<UserWithRelations>;
      const view = render(<VillageWar war={war} user={user} isKage={false} />);
      expectHealth(view, isAttacker ? [9700, 8200] : [8200, 9700]);
    },
  );

  it.each([
    ["neutral", "attacker", true],
    [null, "attacker", true],
    ["defender", "attacker", true],
    ["neutral", "defender", false],
    [null, "defender", false],
  ] as const)(
    "uses the hired %s player's %s side for the heading and health order",
    (villageId, sideVillageId, isAttacker) => {
      response = {
        ...freshWar,
        warMercenaries: [
          {
            id: "contract",
            warId: war.id,
            sideVillageId,
            userId: "viewer",
            invitedById: "kage",
            tokens: 4,
            slot: 1,
            createdAt: new Date(),
            acceptedAt: new Date(),
            endedAt: null,
            activeSlot: 1,
            activeUserId: "viewer",
            invitedUserId: "viewer",
          },
        ],
      };
      const user = {
        userId: "viewer",
        villageId,
        role: "USER",
      } as NonNullable<UserWithRelations>;
      const view = render(<VillageWar war={war} user={user} isKage={false} />);
      expect(
        view.getByRole("heading", {
          name: `${isAttacker ? "Attacking Defender" : "Defending Against Attacker"} - Village war`,
        }),
      ).toBeDefined();
      expectHealth(view, isAttacker ? [9700, 8200] : [8200, 9700]);
    },
  );

  it.each(viewers)(
    "refreshes visible health after polling for %s",
    (villageId, isAttacker) => {
      const user = {
        userId: "viewer",
        villageId,
        role: "USER",
      } as NonNullable<UserWithRelations>;
      const view = render(<VillageWar war={war} user={user} isKage={false} />);
      expectHealth(view, [10000, 10000]);

      response = freshWar;
      view.rerender(<VillageWar war={war} user={user} isKage={false} />);
      expectHealth(view, isAttacker ? [9700, 8200] : [8200, 9700]);

      response = { ...freshWar, attackerWarHealth: 9740, defenderWarHealth: 7900 };
      view.rerender(<VillageWar war={war} user={user} isKage={false} />);
      expectHealth(view, isAttacker ? [9740, 7900] : [7900, 9740]);
    },
  );

  it("shows the polled outcome, removes active actions and stops polling when a war ends", () => {
    const user = {
      userId: "viewer",
      villageId: "attacker",
      role: "OWNER",
    } as NonNullable<UserWithRelations>;
    const view = render(<VillageWar war={war} user={user} isKage />);
    expect(
      view.getByRole("button", { name: "Surrender war objective-war" }),
    ).toBeDefined();
    expect(view.getByRole("button", { name: /Administratively end/ })).toBeDefined();
    expect(pollInterval({ state: {} })).toBe(10000);

    response = { ...freshWar, status: "ATTACKER_VICTORY", endedAt: new Date() };
    view.rerender(<VillageWar war={war} user={user} isKage />);
    expect(view.getByText("Outcome: Victory")).toBeDefined();
    expect(view.getByText(/^Ended:/)).toBeDefined();
    expect(
      view.queryByRole("button", { name: "Surrender war objective-war" }),
    ).toBeNull();
    expect(view.queryByRole("button", { name: /Administratively end/ })).toBeNull();
    expect(view.queryByText(/^HP \(/)).toBeNull();
    expect(pollInterval({ state: { data: { war: response } } })).toBe(false);
  });

  it.each(
    viewers.flatMap(([villageId, isAttacker]) =>
      (
        [
          ["ATTACKER_VICTORY", isAttacker ? "Victory" : "Defeat"],
          ["DEFENDER_VICTORY", isAttacker ? "Defeat" : "Victory"],
          ["DRAW", "War ended in a Draw"],
        ] as const
      ).map(([status, label]) => [villageId, status, label] as const),
    ),
  )("shows %s the %s outcome as %s", (villageId, status, label) => {
    const user = {
      userId: "viewer",
      villageId,
      role: "USER",
    } as NonNullable<UserWithRelations>;
    response = { ...war, status, endedAt: new Date() };
    const view = render(<VillageWar war={war} user={user} isKage={false} />);
    const colour = {
      Victory: "text-green-500",
      Defeat: "text-red-500",
      "War ended in a Draw": "text-yellow-500",
    }[label];
    expect(view.getByText(`Outcome: ${label}`).className).toBe(`font-bold ${colour}`);
  });

  it.each(viewers)(
    "lists the viewer's side first on shrines and supporting forces for %s",
    (villageId, isAttacker) => {
      const user = {
        userId: "viewer",
        villageId,
        role: "USER",
      } as NonNullable<UserWithRelations>;
      const shrineWar = {
        ...war,
        rules: null,
        attackerWarHealth: 9000,
        defenderWarHealth: 8000,
        attackerShrineHp: 400,
        attackerShrineMaxHp: 500,
        attackerShrineStatus: "ACTIVE",
        defenderShrineHp: 0,
        defenderShrineMaxHp: 500,
        defenderShrineStatus: "CAPTURED",
      } as unknown as FetchActiveWarsReturnType;
      const view = render(<VillageWar war={shrineWar} user={user} isKage={false} />);
      const order = isAttacker ? ["Attacker", "Defender"] : ["Defender", "Attacker"];
      expect(view.getAllByText(/ Shrine$/).map((label) => label.textContent)).toEqual(
        order.map((name) => `${name} Shrine`),
      );
      expect(
        view
          .getAllByText(/^(Captured|Damaged|Active)$/)
          .map((badge) => badge.textContent),
      ).toEqual(isAttacker ? ["Active", "Captured"] : ["Captured", "Active"]);
      const own = isAttacker
        ? (["HP (9000 / 10000)", "HP (400 / 500)"] as const)
        : (["HP (8000 / 10000)", "HP (0 / 500)"] as const);
      const enemy = isAttacker
        ? (["HP (8000 / 10000)", "HP (0 / 500)"] as const)
        : (["HP (9000 / 10000)", "HP (400 / 500)"] as const);
      expect(view.getAllByText(/^HP \(/).map((label) => label.textContent)).toEqual([
        own[0],
        enemy[0],
        own[1],
        enemy[1],
      ]);
      const forces = view.getByText("Supporting Forces").parentElement!;
      expect(
        [...forces.querySelectorAll("p.text-muted-foreground")].map(
          (name) => name.textContent,
        ),
      ).toEqual(order);
      expect(
        [...forces.querySelectorAll("span.text-sm")].map((ally) => ally.textContent),
      ).toEqual(
        isAttacker
          ? ["Attacking ally", "Defending ally"]
          : ["Defending ally", "Attacking ally"],
      );
    },
  );

  it("does not poll historical objective wars", () => {
    const user = {
      userId: "viewer",
      villageId: "attacker",
      role: "USER",
    } as NonNullable<UserWithRelations>;
    render(
      <VillageWar
        war={{ ...war, status: "DRAW", endedAt: new Date() }}
        user={user}
        isKage={false}
      />,
    );
    expect(pollInterval({ state: {} })).toBe(false);
  });

  describe("war room offers", () => {
    const person = { username: "Kage", level: 100, rank: "ELDER", village: null };
    const offer = (id: string, relatedId: string, senderId: string) => ({
      id,
      relatedId,
      senderId,
      receiverId: senderId === "kage" ? "other" : "kage",
      status: "PENDING",
      type: "WAR_ALLY",
      value: 10,
      createdAt: new Date(),
      sender: person,
      receiver: person,
    });
    const mountRoom = (
      requests: ReturnType<typeof offer>[],
      overrides: Partial<NonNullable<UserWithRelations>> = {},
    ) => {
      vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
        <>
          <h1>{title}</h1>
          {children}
        </>
      ));
      const kage = {
        userId: "kage",
        villageId: "attacker",
        isOutlaw: false,
        village: { id: "attacker", kageId: "kage" },
        ...overrides,
      } as NonNullable<UserWithRelations>;
      const offers = { useQuery: () => ({ data: requests }) };
      Object.assign(client.api, {
        useUtils: () => ({ war: { getAllyOffers: { invalidate: vi.fn() } } }),
        travel: { getAllSectors: { useQuery: () => ({ data: [] }) } },
        village: {
          getAlliances: {
            useQuery: () => ({ data: { villages: [], relationships: [] } }),
          },
          getVillageStructures: { useQuery: () => ({ data: [] }) },
          releaseSector,
          leaveAlliance,
          declareEnemy,
        },
      });
      Object.assign(client.api.war, {
        getActiveWars: { useQuery: () => ({ data: [war] }) },
        getEndedWars: { useQuery: () => ({ data: undefined }) },
        getAllyOffers: offers,
        getRules: { useQuery: () => ({ data: undefined }) },
        getRaidOptions: { useQuery: () => ({ data: [], isFetching: false }) },
        declareSectorWar: sectorWar,
        declareVillageWarOrRaid: declarations,
        buildShrine,
      });
      return render(
        <AppRouterContext.Provider value={testRouter("war-offers")}>
          <WarRoom user={kage} />
        </AppRouterContext.Provider>,
      );
    };

    it("lists an offer once, on its war's card", () => {
      const view = mountRoom([offer("sent", war.id, "kage")]);
      expect(view.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
      expect(view.getByRole("heading", { name: "War Ally Offers" })).toBeDefined();
      expect(view.queryByRole("heading", { name: "War Contract Offers" })).toBeNull();
    });

    it("keeps offers for other wars on the board", () => {
      const view = mountRoom([
        offer("sent", war.id, "kage"),
        offer("received", "other-war", "other"),
      ]);
      expect(view.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
      expect(view.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
      expect(view.getByRole("heading", { name: "War Contract Offers" })).toBeDefined();
    });

    it("keeps every offer on the board for factions, whose cards list none", () => {
      const view = mountRoom([offer("sent", war.id, "kage")], { isOutlaw: true });
      expect(view.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
      expect(view.queryByRole("heading", { name: "War Ally Offers" })).toBeNull();
      expect(view.getByRole("heading", { name: "War Contract Offers" })).toBeDefined();
    });

    it("explains an empty board", () => {
      const view = mountRoom([]);
      expect(view.getByText("No pending war participation requests")).toBeDefined();
    });
  });
});
