import { describe, expect, it } from "vitest";
import { deriveOverworldOpponents } from "@/libs/overworldAi";

describe("deriveOverworldOpponents", () => {
  const aiByPlacement = new Map([["place-1", "ai-1"]]);

  it("sets opponentAIs from the bound placement's AI for defeat_opponents", () => {
    const { objectives, missing } = deriveOverworldOpponents(
      [{ task: "defeat_opponents", overworldPlacementId: "place-1", opponentAIs: [] }],
      aiByPlacement,
    );
    const [first] = objectives;
    expect(first?.opponentAIs).toEqual([{ ids: ["ai-1"], number: 1 }]);
    expect(missing).toEqual([]);
  });

  it("leaves unbound objectives untouched", () => {
    const input = [
      { task: "defeat_opponents", overworldPlacementId: "", opponentAIs: [{ ids: ["x"], number: 2 }] },
      { task: "dialog", overworldPlacementId: "place-1" },
    ];
    const { objectives, missing } = deriveOverworldOpponents(input as never, aiByPlacement);
    const [first] = objectives;
    expect(first?.opponentAIs).toEqual([{ ids: ["x"], number: 2 }]);
    expect(missing).toEqual([]);
  });

  it("reports placement ids that cannot be resolved", () => {
    const { missing } = deriveOverworldOpponents(
      [{ task: "defeat_opponents", overworldPlacementId: "ghost", opponentAIs: [] }],
      aiByPlacement,
    );
    expect(missing).toEqual(["ghost"]);
  });
});
