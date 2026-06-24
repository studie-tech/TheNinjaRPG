import { describe, it, expect } from "vitest";
import { arrivalPromptDecision } from "@/libs/overworldAi";

const npc = (id: string, longitude: number, latitude: number) => ({
  npcPlacementId: id,
  longitude,
  latitude,
});

describe("arrivalPromptDecision", () => {
  it("prompts the NPC on the player's tile when not already prompted", () => {
    const res = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: null,
    });
    expect(res.prompt?.npcPlacementId).toBe("A");
    expect(res.lastPromptedPlacementId).toBe("A");
  });

  it("does not re-prompt while standing on the already-prompted NPC", () => {
    const res = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: "A",
    });
    expect(res.prompt).toBeNull();
    expect(res.lastPromptedPlacementId).toBe("A");
  });

  it("re-arms (clears) when no NPC is on the player's tile", () => {
    const res = arrivalPromptDecision({
      playerLongitude: 9,
      playerLatitude: 9,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: "A",
    });
    expect(res.prompt).toBeNull();
    expect(res.lastPromptedPlacementId).toBeNull();
  });

  it("prompts again after the player leaves the tile and returns", () => {
    // arrive
    const a = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: null,
    });
    // leave (re-arms to null)
    const b = arrivalPromptDecision({
      playerLongitude: 0,
      playerLatitude: 0,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: a.lastPromptedPlacementId,
    });
    // return
    const c = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: b.lastPromptedPlacementId,
    });
    expect(c.prompt?.npcPlacementId).toBe("A");
  });

  it("prompts the new NPC when a different one moves onto the tile", () => {
    const res = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("B", 3, 4)],
      lastPromptedPlacementId: "A",
    });
    expect(res.prompt?.npcPlacementId).toBe("B");
    expect(res.lastPromptedPlacementId).toBe("B");
  });

  it("with two NPCs on one tile, deterministically prompts the first and does not double-prompt", () => {
    const npcs = [npc("A", 3, 4), npc("B", 3, 4)];
    const first = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs,
      lastPromptedPlacementId: null,
    });
    expect(first.prompt?.npcPlacementId).toBe("A");
    const second = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs,
      lastPromptedPlacementId: first.lastPromptedPlacementId,
    });
    expect(second.prompt).toBeNull();
  });

  it("ignores NPCs without a placement id", () => {
    const res = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [{ npcPlacementId: null, longitude: 3, latitude: 4 }],
      lastPromptedPlacementId: null,
    });
    expect(res.prompt).toBeNull();
    expect(res.lastPromptedPlacementId).toBeNull();
  });
});
