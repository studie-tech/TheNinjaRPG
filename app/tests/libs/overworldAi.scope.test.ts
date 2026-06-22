import { describe, expect, it } from "vitest";
import { placementsForObjective } from "@/libs/overworldAi";

const PLACEMENTS = [
  { id: "f1", aiTemplateUserId: "ai-1", interactionType: "FRIENDLY" },
  { id: "h1", aiTemplateUserId: "ai-2", interactionType: "HOSTILE" },
  { id: "f2", aiTemplateUserId: "ai-3", interactionType: "FRIENDLY" },
];

describe("placementsForObjective", () => {
  it("returns only FRIENDLY placements for deliver_item", () => {
    const r = placementsForObjective(PLACEMENTS, { task: "deliver_item", selectedAiIds: [] });
    expect(r.map((p) => p.id)).toEqual(["f1", "f2"]);
  });

  it("returns only FRIENDLY placements for dialog (ignores selectedAiIds)", () => {
    const r = placementsForObjective(PLACEMENTS, { task: "dialog", selectedAiIds: ["ai-2"] });
    expect(r.map((p) => p.id)).toEqual(["f1", "f2"]);
  });

  it("AI-filters for defeat_opponents when an AI is selected", () => {
    const r = placementsForObjective(PLACEMENTS, {
      task: "defeat_opponents",
      selectedAiIds: ["ai-2"],
    });
    expect(r.map((p) => p.id)).toEqual(["h1"]);
  });

  it("returns all for defeat_opponents with no AI selected", () => {
    const r = placementsForObjective(PLACEMENTS, { task: "defeat_opponents", selectedAiIds: [] });
    expect(r).toEqual(PLACEMENTS);
  });

  it("returns all for a non-friendly, non-AI task with no selection", () => {
    const r = placementsForObjective(PLACEMENTS, { task: "move_to_location", selectedAiIds: [] });
    expect(r).toEqual(PLACEMENTS);
  });
});
