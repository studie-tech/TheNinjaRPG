import { describe, expect, it } from "vitest";
import { placementToSectorUser } from "@/libs/overworldAi";

describe("placementToSectorUser", () => {
  const placement = {
    id: "p1",
    aiTemplateUserId: "ai-1",
    interactionType: "FRIENDLY" as const,
    sector: 10,
    longitude: 3,
    latitude: 4,
    positionVersion: 7,
  };
  const template = {
    userId: "ai-1",
    username: "Wandering Sage",
    avatar: "/a.png",
    avatarLight: null,
    curHealth: 100,
    maxHealth: 100,
    level: 20,
    rank: "JONIN" as const,
  };

  it("maps a placement into a SectorUser NPC entity keyed by placement id", () => {
    const e = placementToSectorUser(placement, template);
    expect(e.userId).toBe("ai-1");
    expect(e.isNpc).toBe(true);
    expect(e.npcPlacementId).toBe("p1");
    expect(e.npcInteractionType).toBe("FRIENDLY");
    expect(e.npcPositionVersion).toBe(7);
    expect(e.status).toBe("AWAKE");
    expect(e.longitude).toBe(3);
    expect(e.latitude).toBe(4);
  });
});
