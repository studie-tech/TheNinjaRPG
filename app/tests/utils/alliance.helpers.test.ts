import { describe, expect, it } from "bun:test";
import type { VillageAlliance } from "@/drizzle/schema";
import { getAlliedVillageIds, isMapUserAlly } from "@/utils/alliance";

const relation = (
  villageIdA: string,
  villageIdB: string,
  status: VillageAlliance["status"],
) => ({ id: `${villageIdA}-${villageIdB}`, villageIdA, villageIdB, status }) as VillageAlliance;

describe("getAlliedVillageIds", () => {
  const relations = [
    relation("a", "b", "ALLY"),
    relation("c", "a", "ALLY"),
    relation("a", "d", "ENEMY"),
    relation("b", "c", "ALLY"),
  ];

  it("lists the village and its formal allies once each", () => {
    expect(getAlliedVillageIds(relations, "a")).toEqual(["a", "b", "c"]);
  });

  it("is empty for a user without a village", () => {
    expect(getAlliedVillageIds(relations, null)).toEqual([]);
  });
});

describe("isMapUserAlly", () => {
  const viewer = {
    villageId: "a",
    village: { id: "a", relationshipA: [relation("a", "b", "ALLY")], relationshipB: [] },
  };

  it("counts the viewer's village and its formal allies", () => {
    expect(isMapUserAlly(viewer, { villageId: "a" })).toBe(true);
    expect(isMapUserAlly(viewer, { villageId: "b" })).toBe(true);
    expect(isMapUserAlly(viewer, { villageId: "c" })).toBe(false);
  });

  it("lets a target's alliance status override the village rule", () => {
    expect(isMapUserAlly(viewer, { villageId: "a", allianceStatus: "ENEMY" })).toBe(false);
    expect(isMapUserAlly(viewer, { villageId: "c", allianceStatus: "ALLY" })).toBe(true);
  });

  it("treats a missing viewer as unrelated", () => {
    expect(isMapUserAlly(undefined, { villageId: "a" })).toBe(false);
  });
});
