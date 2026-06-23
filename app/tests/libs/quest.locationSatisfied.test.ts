import { describe, expect, it } from "vitest";
import { isObjectiveLocationSatisfied } from "@/libs/quest";
import { DeliverItem } from "@/validators/objectives";

// The player has been validated server-side as standing on the NPC placement's
// CURRENT tile. The objective's own coordinates were baked in at quest-save time
// and can diverge from the placement (e.g. after a roaming NPC's daily reposition,
// or simply the 0/0/0 default for a fixed NPC the author never matched coords to).
const onNpcTile = { sector: 1, longitude: 1, latitude: 1 };

const boundDeliverWithStaleCoords = DeliverItem.parse({
  id: "o1",
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

  it("still satisfies on exact coordinate match (existing isLocationObjective behavior preserved)", () => {
    const atTile = DeliverItem.parse({
      id: "o2",
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
      sectorType: "specific",
      sector: 100,
      longitude: 9,
      latitude: 9,
      deliverItemIds: ["i1"],
      item_name: "Secret scroll",
    });
    expect(isObjectiveLocationSatisfied(onNpcTile, unbound)).toBe(false);
  });
});
