import { describe, expect, it } from "vitest";
import { IMG_BADGE_DAYS_IN_VILLAGE, IMG_BADGE_PVPKILLS } from "@/drizzle/constants";
import { getObjectiveImage } from "@/libs/objectives";
import {
  allObjectiveTasks,
  objectiveImageMap,
  type AllObjectivesType,
} from "@/validators/objectives";

describe("objectiveImageMap / getObjectiveImage", () => {
  it("supplies non-empty display metadata for every objective task", () => {
    for (const task of allObjectiveTasks) {
      const meta = objectiveImageMap[task];
      expect(meta, `missing metadata for ${task}`).toBeDefined();
      expect(meta.image).not.toBe("");
      expect(meta.title).not.toBe("???");
      expect(meta.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("getObjectiveImage returns the co-located record entry for every task", () => {
    for (const task of allObjectiveTasks) {
      const objective = { task } as unknown as AllObjectivesType;
      expect(getObjectiveImage(objective)).toEqual(objectiveImageMap[task]);
    }
  });

  it("preserves the previous image + title verbatim for representative tasks", () => {
    expect(
      getObjectiveImage({ task: "pvp_kills" } as unknown as AllObjectivesType),
    ).toEqual({ image: IMG_BADGE_PVPKILLS, title: "PVP kills" });
    expect(
      getObjectiveImage({ task: "days_as_kage" } as unknown as AllObjectivesType),
    ).toEqual({ image: IMG_BADGE_DAYS_IN_VILLAGE, title: "Days as Kage" });
  });

  it("falls back to a placeholder for an unknown/corrupt task", () => {
    expect(
      getObjectiveImage({ task: "totally_unknown" } as unknown as AllObjectivesType),
    ).toEqual({ image: "", title: "???" });
  });
});
