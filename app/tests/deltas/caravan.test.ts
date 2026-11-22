import { describe, expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  getActivatedTradeRoutes,
  getBanditControls,
  getCancelledCaravans,
  getCheckedInCaravans,
  getClaimedLootControls,
  getDepartedCaravans,
  getGroupControls,
  getJoinedEscortCaravans,
  getLeftEscortCaravans,
  getLeftGroupControls,
  getPreparedCaravans,
  getProposedTradeRoutes,
  getRejoinedEscortCaravans,
  getReleasedEscortUserUpdate,
  getRemovedTradeRoutes,
  getStartedOperationControls,
  getStoppedSabotageCaravans,
  getTrackedControls,
  getUpgradedTradeRoutes,
  hasCaravanStockMoved,
} from "@/deltas/caravan";
import {
  CARAVAN_GUARD_SLOTS,
  CARAVAN_HISTORY_SIZE,
  CARAVAN_OPERATION_HISTORY_SIZE,
} from "@/drizzle/constants";
import { getRouteTravelMinutes } from "@/libs/caravan";

type Routes = NonNullable<RouterOutputs["tradeRoute"]["getRoutes"]>;
type Caravans = NonNullable<RouterOutputs["caravan"]["getCaravans"]>;
type Controls = RouterOutputs["caravanOps"]["getControls"];

const now = new Date("2026-11-21T12:00:00Z");
const routes = (): Routes =>
  ({
    canManage: true,
    fundsLabel: "village tokens",
    routes: [
      {
        id: "active",
        status: "ACTIVE",
        level: 1,
        partner: { id: "b", name: "B" },
        proposedByUs: true,
        sectors: 4,
        markers: [],
        blocked: false,
      },
    ],
    partners: [{ id: "c", name: "C", block: null }],
  }) as unknown as Routes;
const caravan = (overrides: Partial<Caravans["caravans"][number]> = {}) =>
  ({
    id: "k",
    status: "PREPARING",
    outgoing: true,
    partner: "B",
    cargo: [{ itemId: "wood", name: "Wood", quantity: 100 }],
    lossPercent: 0,
    delayMinutes: 0,
    departedAt: null,
    arrivesAt: null,
    progress: 0,
    sector: 1,
    checkpoints: 0,
    disrupted: false,
    guards: [],
    openSlots: CARAVAN_GUARD_SLOTS,
    encounter: null,
    sabotage: [],
    viewer: null,
    ...overrides,
  }) as Caravans["caravans"][number];
const caravans = (rows = [caravan()]): Caravans => ({
  canManage: true,
  settled: false,
  caravans: rows,
  history: [],
});
const controls = (): Controls =>
  ({
    sector: 3,
    bandit: { enabled: false },
    operations: [],
    commitment: { caravanId: "k", role: "BANDIT", groupLeaderId: "lead" },
    caravans: [
      {
        id: "k",
        status: "TRAVELLING",
        lastSector: 3,
        seenAt: now,
        inSector: true,
        groups: [
          {
            leaderId: "lead",
            leaderName: "Lead",
            joinable: false,
            members: [{ userId: "lead" }, { userId: "x" }, { userId: "me" }],
          },
        ],
      },
    ],
    loot: [{ caravanId: "k", lines: [] }],
    markers: [],
  }) as unknown as Controls;

describe("trade route deltas", () => {
  it("lists a proposal and drops its partner from the choices", () => {
    const next = getProposedTradeRoutes(routes(), {
      id: "new",
      partner: { id: "c", name: "C" },
      sectors: 6,
    });
    expect(next?.routes[1]).toMatchObject({
      id: "new",
      status: "PROPOSED",
      level: 1,
      travelMinutes: getRouteTravelMinutes(1),
      blocked: false,
    });
    expect(next?.partners).toEqual([]);
    expect(
      getProposedTradeRoutes(null, {
        id: "x",
        partner: { id: "c", name: "C" },
        sectors: 1,
      }),
    ).toBeUndefined();
  });

  it("activates an accepted proposal only from its proposed state", () => {
    const proposed = getProposedTradeRoutes(routes(), {
      id: "new",
      partner: { id: "c", name: "C" },
      sectors: 6,
    })!;
    const next = getActivatedTradeRoutes(proposed, {
      routeId: "new",
      markers: [{ id: "m", sector: 4, control: 100 }],
    });
    expect(next?.routes[1]).toMatchObject({
      status: "ACTIVE",
      markers: [{ id: "m", sector: 4, control: 100, controller: null }],
    });
    expect(
      getActivatedTradeRoutes(routes(), { routeId: "active", markers: [] }),
    ).toBeUndefined();
  });

  it("removes a closed route and offers its partner again", () => {
    const next = getRemovedTradeRoutes(routes(), {
      routeId: "active",
      partner: { id: "b", name: "B", block: null },
    });
    expect(next?.routes).toEqual([]);
    expect(next?.partners.map((row) => row.id)).toEqual(["c", "b"]);
  });

  it("upgrades a route from its loaded level only", () => {
    expect(
      getUpgradedTradeRoutes(routes(), { routeId: "active", level: 2 })?.routes[0],
    ).toMatchObject({ level: 2, travelMinutes: getRouteTravelMinutes(2) });
    expect(
      getUpgradedTradeRoutes(routes(), { routeId: "active", level: 3 }),
    ).toBeUndefined();
  });
});

describe("caravan deltas", () => {
  it("wakes only a queued viewer among the escorts a cancellation released", () => {
    const queued = { userId: "g1", status: "QUEUED" };
    expect(getReleasedEscortUserUpdate(queued, ["g1", "g2"])).toEqual({
      userPatch: { status: "AWAKE" },
    });
    expect(getReleasedEscortUserUpdate(queued, ["g2"])).toEqual({});
    expect(
      getReleasedEscortUserUpdate({ userId: "g1", status: "BATTLE" }, ["g1"]),
    ).toEqual({});
  });

  it("lists a prepared caravan first and moves a cancelled one into the history", () => {
    const prepared = getPreparedCaravans(caravans([]), {
      id: "k",
      partner: "B",
      cargo: [{ itemId: "wood", name: "Wood", quantity: 100 }],
      sector: 1,
    });
    expect(prepared?.caravans).toEqual([caravan()]);
    const cancelled = getCancelledCaravans(prepared!, {
      caravanId: "k",
      resolvedAt: now,
    });
    expect(cancelled?.caravans).toEqual([]);
    expect(cancelled?.history[0]).toEqual({
      id: "k",
      status: "CANCELLED",
      outgoing: true,
      partner: "B",
      cargo: [{ itemId: "wood", name: "Wood", quantity: 100 }],
      resolvedAt: now,
    });
    const full = {
      ...caravans(),
      history: Array.from({ length: CARAVAN_HISTORY_SIZE }, (_, index) => ({
        ...cancelled!.history[0]!,
        id: `h${index}`,
      })),
    };
    expect(
      getCancelledCaravans(full, { caravanId: "k", resolvedAt: now })?.history,
    ).toHaveLength(CARAVAN_HISTORY_SIZE);
  });

  it("starts a dispatched journey only for a preparing caravan", () => {
    const arrivesAt = new Date(now.getTime() + 30 * 60_000);
    const departed = {
      caravanId: "k",
      departedAt: now,
      arrivesAt,
      sector: 1,
    };
    const next = getDepartedCaravans(caravans(), departed);
    expect(next?.caravans[0]).toMatchObject({
      status: "TRAVELLING",
      departedAt: now,
      arrivesAt,
    });
    expect(getDepartedCaravans(next!, departed)).toBeUndefined();
  });

  it("follows the viewer through the escort", () => {
    const guard = { userId: "me", username: "Me" };
    const joined = getJoinedEscortCaravans(caravans(), "k", guard);
    expect(joined?.caravans[0]).toMatchObject({
      guards: [{ ...guard, status: "QUEUED", objectives: 0 }],
      openSlots: CARAVAN_GUARD_SLOTS - 1,
      viewer: { status: "QUEUED", canCheckIn: false },
    });
    expect(getJoinedEscortCaravans(joined!, "k", guard)).toBeUndefined();
    const checked = getCheckedInCaravans(joined!, "k", "me");
    expect(checked?.caravans[0]?.viewer?.canCheckIn).toBe(false);
    expect(checked?.caravans[0]?.guards[0]?.objectives).toBe(1);
    const rejoined = getRejoinedEscortCaravans(checked!, "k", "me");
    expect(rejoined?.caravans[0]?.viewer?.status).toBe("QUEUED");
    const left = getLeftEscortCaravans(joined!, "k", "me");
    expect(left?.caravans[0]).toMatchObject({
      guards: [],
      openSlots: CARAVAN_GUARD_SLOTS,
      viewer: null,
    });
    expect(getLeftEscortCaravans(left!, "k", "me")).toBeUndefined();
    expect(getJoinedEscortCaravans(caravans(), "missing", guard)).toBeUndefined();
  });

  it("reloads stock only for caravan changes that moved the village's stock", () => {
    const travelling = caravan({ status: "TRAVELLING" });
    const incoming = caravan({ id: "in", outgoing: false });
    const finished = (status: "DELIVERED" | "CANCELLED", outgoing = true) => ({
      ...caravans([]),
      history: [
        {
          id: outgoing ? "k" : "in",
          status,
          outgoing,
          partner: "B",
          cargo: [],
          resolvedAt: now,
        },
      ],
    });
    // The first list shown has nothing to compare with.
    expect(hasCaravanStockMoved(undefined, caravans())).toBe(false);
    // Preparing reserves and departing removes the origin's stock.
    expect(hasCaravanStockMoved(caravans([]), caravans())).toBe(true);
    expect(hasCaravanStockMoved(caravans([]), caravans([travelling]))).toBe(true);
    expect(hasCaravanStockMoved(caravans(), caravans([travelling]))).toBe(true);
    expect(hasCaravanStockMoved(caravans([]), caravans([incoming]))).toBe(false);
    expect(
      hasCaravanStockMoved(
        caravans([incoming]),
        caravans([{ ...incoming, status: "TRAVELLING" }]),
      ),
    ).toBe(false);
    expect(hasCaravanStockMoved(caravans([travelling]), caravans([travelling]))).toBe(
      false,
    );
    // A cancellation returns stock to the origin; a delivery credits the destination.
    expect(hasCaravanStockMoved(caravans(), finished("CANCELLED"))).toBe(true);
    expect(hasCaravanStockMoved(caravans([travelling]), finished("DELIVERED"))).toBe(
      false,
    );
    expect(
      hasCaravanStockMoved(caravans([incoming]), finished("DELIVERED", false)),
    ).toBe(true);
    expect(
      hasCaravanStockMoved(caravans([incoming]), finished("CANCELLED", false)),
    ).toBe(false);
    // A preparing caravan delivered unseen departed meanwhile.
    expect(hasCaravanStockMoved(caravans(), finished("DELIVERED"))).toBe(true);
    // A delivery that arrived between two lists shows only in the history, once.
    expect(hasCaravanStockMoved(caravans([]), finished("DELIVERED", false))).toBe(true);
    expect(
      hasCaravanStockMoved(finished("DELIVERED", false), finished("DELIVERED", false)),
    ).toBe(false);
    // A caravan gone from the list and its history may have moved either.
    expect(hasCaravanStockMoved(caravans([travelling]), caravans([]))).toBe(true);
  });

  it("removes sabotage an escort stopped", () => {
    const row = caravan({
      sabotage: [{ id: "op", type: "DELAY", username: "S", finishesAt: now }],
    });
    expect(
      getStoppedSabotageCaravans(caravans([row]), "k", "op")?.caravans[0]?.sabotage,
    ).toEqual([]);
  });
});

describe("caravan control deltas", () => {
  it("records banditry, operations and sightings", () => {
    expect(getBanditControls(controls(), true).bandit.enabled).toBe(true);
    const operation = {
      id: "op",
      type: "SEARCH" as const,
      status: "ACTIVE" as const,
      succeeds: null,
      sector: 3,
      finishesAt: now,
    };
    const many = {
      ...controls(),
      operations: Array.from({ length: CARAVAN_OPERATION_HISTORY_SIZE }, (_, i) => ({
        ...operation,
        id: `old${i}`,
        status: "RESOLVED" as const,
      })),
    };
    const started = getStartedOperationControls(many, operation);
    expect(started.operations).toHaveLength(CARAVAN_OPERATION_HISTORY_SIZE);
    expect(started.operations[0]).toEqual(operation);
    const tracked = getTrackedControls(controls(), {
      caravanId: "k",
      sector: 7,
      seenAt: now,
    });
    expect(tracked?.caravans[0]).toMatchObject({ lastSector: 7, inSector: false });
    expect(
      getTrackedControls(controls(), { caravanId: "x", sector: 7, seenAt: now }),
    ).toBeUndefined();
  });

  it("commits to a group with its confirmed members and releases the viewer", () => {
    const current = controls();
    const groups = current.caravans[0]!.groups;
    const grouped = getGroupControls(
      { ...current, commitment: null },
      {
        commitment: current.commitment!,
        groups,
      },
    );
    expect(grouped?.commitment).toEqual(current.commitment);
    const left = getLeftGroupControls(current, { caravanId: "k", userId: "me" });
    expect(left?.commitment).toBeNull();
    expect(left?.caravans[0]?.groups[0]).toMatchObject({
      joinable: true,
      members: [{ userId: "lead" }, { userId: "x" }],
    });
    const disbanded = getLeftGroupControls(current, {
      caravanId: "k",
      userId: "lead",
    });
    expect(disbanded?.caravans[0]?.groups).toEqual([]);
  });

  it("removes claimed loot once", () => {
    const claimed = getClaimedLootControls(controls(), "k");
    expect(claimed?.loot).toEqual([]);
    expect(getClaimedLootControls(claimed!, "k")).toBeUndefined();
  });
});
