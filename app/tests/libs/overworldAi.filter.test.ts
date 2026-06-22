import { describe, expect, it } from "vitest";
import { filterPlacementsByAi } from "@/libs/overworldAi";

describe("filterPlacementsByAi", () => {
  const placements = [
    { id: "p1", aiTemplateUserId: "ai-1" },
    { id: "p2", aiTemplateUserId: "ai-2" },
  ];

  it("returns all placements when no AI is selected", () => {
    expect(filterPlacementsByAi(placements, [])).toEqual(placements);
  });

  it("returns only placements for the selected AI", () => {
    expect(filterPlacementsByAi(placements, ["ai-1"])).toEqual([
      { id: "p1", aiTemplateUserId: "ai-1" },
    ]);
  });

  it("matches any of multiple selected AIs", () => {
    expect(filterPlacementsByAi(placements, ["ai-1", "ai-2"])).toEqual(placements);
  });

  it("returns empty when the selected AI has no placement", () => {
    expect(filterPlacementsByAi(placements, ["ai-3"])).toEqual([]);
  });
});
