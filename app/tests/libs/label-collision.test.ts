import { describe, expect, it } from "vitest";
import { selectNonOverlappingLabels } from "@/libs/sector-map/label-collision";

describe("selectNonOverlappingLabels", () => {
  it("keeps the highest-priority label from an overlapping cluster", () => {
    const selected = selectNonOverlappingLabels([
      {
        item: "outer",
        rect: { left: 20, right: 120, top: 20, bottom: 60 },
        priority: 2,
      },
      {
        item: "center",
        rect: { left: 40, right: 140, top: 30, bottom: 70 },
        priority: 1,
      },
    ]);
    expect(selected).toEqual(["center"]);
  });

  it("keeps separated labels and respects a reserved hovered rectangle", () => {
    const selected = selectNonOverlappingLabels(
      [
        {
          item: "blocked",
          rect: { left: 45, right: 95, top: 45, bottom: 75 },
          priority: 1,
        },
        {
          item: "free",
          rect: { left: 140, right: 190, top: 45, bottom: 75 },
          priority: 2,
        },
      ],
      [{ left: 40, right: 100, top: 40, bottom: 80 }],
    );
    expect(selected).toEqual(["free"]);
  });

  it("applies padding between otherwise non-overlapping labels", () => {
    const candidates = [
      {
        item: "first",
        rect: { left: 0, right: 50, top: 0, bottom: 30 },
        priority: 1,
      },
      {
        item: "second",
        rect: { left: 53, right: 103, top: 0, bottom: 30 },
        priority: 2,
      },
    ];
    expect(selectNonOverlappingLabels(candidates, [], 4)).toEqual(["first"]);
    expect(selectNonOverlappingLabels(candidates, [], 2)).toEqual([
      "first",
      "second",
    ]);
  });
});
