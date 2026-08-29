import { describe, expect, it } from "vitest";
import { getNewTrackers, isObjectiveLocationSatisfied } from "@/libs/quest";
import { DeliverItem, SimpleObjective } from "@/validators/objectives";

// The player has been validated server-side as standing on the NPC placement's
// CURRENT tile. The objective's own coordinates were baked in at quest-save time
// and can diverge from the placement (e.g. after a roaming NPC's daily reposition,
// or simply the 0/0/0 default for a fixed NPC the author never matched coords to).
const onNpcTile = { sector: 1, longitude: 1, latitude: 1 };

const boundDeliverWithStaleCoords = DeliverItem.parse({
  id: "o1",
  task: "deliver_item",
  overworldPlacementId: "p1",
  sectorType: "specific",
  sector: 100,
  longitude: 9,
  latitude: 9,
  deliverItemIds: ["i1"],
  item_name: "Secret scroll",
});

describe("isObjectiveLocationSatisfied", () => {
  it("treats a placement-bound objective as on-location when the player interacts with that placement, despite stale coords", () => {
    expect(
      isObjectiveLocationSatisfied(onNpcTile, boundDeliverWithStaleCoords, new Set(["p1"])),
    ).toBe(true);
  });

  it("is not satisfied when the player is at a different placement than the one the objective binds", () => {
    expect(
      isObjectiveLocationSatisfied(onNpcTile, boundDeliverWithStaleCoords, new Set(["other"])),
    ).toBe(false);
  });

  it("is not satisfied for a placement-bound objective when no placement context is supplied (non-overworld callers unchanged)", () => {
    expect(isObjectiveLocationSatisfied(onNpcTile, boundDeliverWithStaleCoords)).toBe(false);
  });

  it("does NOT complete a placement-bound objective via coordinates alone — the placement is authoritative", () => {
    // Coords happen to match the player's tile, but the player isn't interacting with the
    // placement. A bound objective must resolve off the placement, never coincidental coords
    // (otherwise it could auto-complete on travel).
    const boundCoordsMatch = DeliverItem.parse({
      id: "o4",
      task: "deliver_item",
      overworldPlacementId: "p9",
      sectorType: "specific",
      sector: 1,
      longitude: 1,
      latitude: 1,
      deliverItemIds: ["i1"],
      item_name: "Secret scroll",
    });
    expect(isObjectiveLocationSatisfied(onNpcTile, boundCoordsMatch)).toBe(false);
    expect(isObjectiveLocationSatisfied(onNpcTile, boundCoordsMatch, new Set(["p9"]))).toBe(true);
  });

  it("still satisfies on exact coordinate match (existing isLocationObjective behavior preserved)", () => {
    const atTile = DeliverItem.parse({
      id: "o2",
      task: "deliver_item",
      sectorType: "specific",
      sector: 1,
      longitude: 1,
      latitude: 1,
      deliverItemIds: ["i1"],
      item_name: "Secret scroll",
    });
    expect(isObjectiveLocationSatisfied(onNpcTile, atTile)).toBe(true);
  });

  it("is not satisfied for an unbound objective whose coords differ from the player's tile", () => {
    const unbound = DeliverItem.parse({
      id: "o3",
      task: "deliver_item",
      sectorType: "specific",
      sector: 100,
      longitude: 9,
      latitude: 9,
      deliverItemIds: ["i1"],
      item_name: "Secret scroll",
    });
    expect(isObjectiveLocationSatisfied(onNpcTile, unbound)).toBe(false);
  });

  it("ignores malformed legacy bindings on unsupported tasks", () => {
    const unsupported = SimpleObjective.parse({
      id: "legacy",
      task: "pvp_kills",
      overworldPlacementId: "p1",
      sector: 1,
      longitude: 1,
      latitude: 1,
    });
    expect(isObjectiveLocationSatisfied(onNpcTile, unsupported)).toBe(true);
  });
});

/** Builds a stable pre-overworld tracker spanning every location-sensitive objective. */
const makeLegacyLocationUser = () => {
  const location = { sector: 1, longitude: 1, latitude: 1 };
  const objectives = [
    { id: "move", task: "move_to_location", ...location },
    {
      id: "collect",
      task: "collect_item",
      ...location,
      collectItemIds: ["collected-item"],
      item_name: "Collected item",
    },
    {
      id: "deliver",
      task: "deliver_item",
      ...location,
      deliverItemIds: ["delivered-item"],
      item_name: "Delivered item",
    },
    {
      id: "defeat",
      task: "defeat_opponents",
      ...location,
      opponentAIs: [{ ids: ["target-ai"], number: 1 }],
    },
    {
      id: "dialog",
      task: "dialog",
      nextObjectiveId: [{ text: "Continue", nextObjectiveId: "move" }],
    },
  ];
  const quest = {
    id: "legacy-location-quest",
    name: "Legacy location quest",
    questType: "mission",
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 100,
    maxCompletes: 100,
    retryDelay: "none",
    requiredVillage: null,
    content: { objectives, reward: {} },
  };
  return {
    userId: "legacy-user",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    sector: 1,
    longitude: 1,
    latitude: 1,
    status: "AWAKE",
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    useritems: [{ itemId: "delivered-item" }],
    questData: [
      {
        id: quest.id,
        startAt: "2026-01-01T00:00:00.000Z",
        goals: objectives.map(({ id }) => ({ id })),
      },
    ],
    userQuests: [{ id: "history", questId: quest.id, completed: 0, quest }],
  } as unknown as Parameters<typeof getNewTrackers>[0];
};

const legacyLocationTasks = [
  { task: "move_to_location" as const },
  { task: "collect_item" as const },
  { task: "deliver_item" as const },
  { task: "defeat_opponents" as const, contentId: "other-ai" },
  { task: "dialog" as const, contentId: "move" },
];

describe("getNewTrackers — legacy location compatibility", () => {
  it("keeps unbound location and dialog results unchanged with irrelevant placement context", () => {
    const baseline = getNewTrackers(
      structuredClone(makeLegacyLocationUser()),
      legacyLocationTasks,
    );
    const withIrrelevantPlacementContext = getNewTrackers(
      structuredClone(makeLegacyLocationUser()),
      legacyLocationTasks,
      undefined,
      new Map([["unrelated-placement", false]]),
      new Set(["unrelated-placement"]),
    );

    expect(withIrrelevantPlacementContext).toEqual(baseline);
    const goals = baseline.trackers[0]?.goals ?? [];
    expect(goals.find(({ id }) => id === "move")?.done).toBe(true);
    expect(goals.find(({ id }) => id === "collect")?.done).toBe(true);
    expect(goals.find(({ id }) => id === "deliver")?.done).toBe(true);
    expect(goals.find(({ id }) => id === "dialog")?.selectedNextObjectiveId).toBe(
      "move",
    );
  });

  it("keeps coordinate behavior for an unsupported legacy placement field", () => {
    const user = makeLegacyLocationUser();
    const move = user.userQuests?.[0]?.quest.content.objectives.find(
      ({ id }) => id === "move",
    );
    if (!move) throw new Error("move objective fixture missing");
    move.overworldPlacementId = "legacy-unsupported-binding";

    const result = getNewTrackers(
      user,
      [{ task: "move_to_location" }],
      undefined,
      new Map(),
    );

    expect(result.trackers[0]?.goals.find(({ id }) => id === "move")?.done).toBe(
      true,
    );
    expect(result.consequences.some(({ type }) => type === "fail_quest")).toBe(false);
  });
});
