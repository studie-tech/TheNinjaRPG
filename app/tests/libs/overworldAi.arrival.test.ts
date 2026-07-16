import { describe, it, expect } from "vitest";
import { arrivalPromptDecision, isArrivalPromptStale } from "@/libs/overworldAi";

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

describe("isArrivalPromptStale", () => {
  it("keeps the prompt open while the player stands on its NPC", () => {
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [npc("A", 3, 4)],
        playerLongitude: 3,
        playerLatitude: 4,
      }),
    ).toBe(false);
  });

  it("goes stale when the player walks off the tile while the prompt is up", () => {
    // The reported bug: the modal stayed open pointing at a tile the player had left, and its CTA
    // then tripped the server's "You are not standing on the NPC's tile" guard.
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [npc("A", 3, 4)],
        playerLongitude: 5,
        playerLatitude: 4,
      }),
    ).toBe(true);
  });

  it("goes stale when the NPC moves away from a stationary player", () => {
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [npc("A", 9, 9)],
        playerLongitude: 3,
        playerLatitude: 4,
      }),
    ).toBe(true);
  });

  it("goes stale when the NPC despawns out of the sector data", () => {
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [],
        playerLongitude: 3,
        playerLatitude: 4,
      }),
    ).toBe(true);
  });

  it("still closes on despawn when the player position is unknown", () => {
    // The despawn half must not be gated on known coordinates: the effect this replaced cleared a
    // despawned NPC's prompt regardless of position, and a transient undefined `userData` must not
    // strand the modal.
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [],
        playerLongitude: undefined,
        playerLatitude: undefined,
      }),
    ).toBe(true);
  });

  it("holds the prompt open when the position is unknown but its NPC is still present", () => {
    // Unknown position suspends only the tile comparison — it must not be read as "walked off".
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [npc("A", 3, 4)],
        playerLongitude: undefined,
        playerLatitude: undefined,
      }),
    ).toBe(false);
  });

  it("is never stale with no prompt open", () => {
    expect(
      isArrivalPromptStale({
        promptedPlacementId: null,
        npcs: [],
        playerLongitude: 3,
        playerLatitude: 4,
      }),
    ).toBe(false);
  });

  it("does not close the armed prompt the player is still standing on", () => {
    // Guards the trap in the literal `else setArrivalNpc(null)` fix: once armed,
    // `arrivalPromptDecision` returns `prompt: null` for the NPC underfoot, so an `else` branch
    // would close the modal on the next re-render. The staleness check must not.
    const armed = arrivalPromptDecision({
      playerLongitude: 3,
      playerLatitude: 4,
      npcs: [npc("A", 3, 4)],
      lastPromptedPlacementId: "A",
    });
    expect(armed.prompt).toBeNull();
    expect(
      isArrivalPromptStale({
        promptedPlacementId: "A",
        npcs: [npc("A", 3, 4)],
        playerLongitude: 3,
        playerLatitude: 4,
      }),
    ).toBe(false);
  });
});
