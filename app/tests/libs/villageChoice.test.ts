import { describe, expect, it } from "bun:test";
import {
  VILLAGE_CHOICE_FULL_MIN_GAP,
  VILLAGE_CHOICE_FULL_RATIO,
  VILLAGE_CHOICE_MIN_OPEN,
} from "@/drizzle/constants";
import { getDialogVillageMembership, getFullVillageIds } from "@/libs/villageChoice";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";

const villages = (...players: number[]) =>
  players.map((count, index) => ({ id: `v${index}`, players: count }));

describe("getFullVillageIds", () => {
  it("closes villages past both the ratio and the gap above the quietest", () => {
    const quietest = 200;
    const limit = Math.max(
      quietest * VILLAGE_CHOICE_FULL_RATIO,
      quietest + VILLAGE_CHOICE_FULL_MIN_GAP,
    );
    expect(
      getFullVillageIds(villages(quietest, quietest, limit, limit + 1, limit * 2)),
    ).toEqual(new Set(["v3", "v4"]));
  });

  it("keeps small populations open until the gap is crossed", () => {
    const quietest = 4;
    expect(
      getFullVillageIds(
        villages(quietest, quietest, quietest + VILLAGE_CHOICE_FULL_MIN_GAP, 1000),
      ),
    ).toEqual(new Set(["v3"]));
  });

  it("always offers the quietest villages, however lopsided the counts", () => {
    const counts = [0, 500, 900, 1000, 1200];
    const full = getFullVillageIds(villages(...counts));
    expect(counts.length - full.size).toBe(VILLAGE_CHOICE_MIN_OPEN);
    expect(full.has("v0")).toBe(false);
    expect(full.has("v1")).toBe(false);
  });

  it("closes nothing when the villages are balanced or absent", () => {
    expect(getFullVillageIds(villages(100, 110, 120, 105, 99)).size).toBe(0);
    expect(getFullVillageIds([]).size).toBe(0);
  });
});

describe("getDialogVillageMembership", () => {
  const content = {
    objectives: [
      DialogObjective.parse({
        id: "choose",
        task: "dialog",
        nextObjectiveId: [{ text: "Hyorin", nextObjectiveId: "hyorin" }],
      }),
      DialogObjective.parse({
        id: "hyorin",
        task: "dialog",
        ...ObjectiveReward.parse({ reward_village_membership: "HYORIN" }),
      }),
    ],
  };

  it("names the village an answer's objective grants", () => {
    expect(getDialogVillageMembership(content, "hyorin")).toBe("HYORIN");
  });

  it("ignores answers into objectives without membership", () => {
    expect(getDialogVillageMembership(content, "choose")).toBeUndefined();
    expect(getDialogVillageMembership(content, "missing")).toBeUndefined();
    expect(getDialogVillageMembership(undefined, "hyorin")).toBeUndefined();
  });
});
