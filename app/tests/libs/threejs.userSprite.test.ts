import { Texture } from "three";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/libs/threejs/util", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/libs/threejs/util")>()),
  loadTexture: vi.fn(() => new Texture()),
}));

import { createUserSprite } from "@/libs/threejs/sector";

const hex = { width: 20, height: 20 } as never;

/** Minimal sector user fixture for marker-tree compatibility assertions. */
const user = (patch: Record<string, unknown> = {}) =>
  ({
    userId: "user-1",
    username: "Player",
    rank: "JONIN",
    allianceStatus: "ALLY",
    avatar: "avatar.webp",
    avatarLight: "avatar-light.webp",
    ...patch,
  }) as never;

describe("createUserSprite compatibility", () => {
  it("preserves the legacy player marker and hidden action child layout", () => {
    const group = createUserSprite(user(), hex);

    expect(group.name).toBe("user-1");
    expect(group.userData).toMatchObject({
      type: "user",
      userId: "user-1",
    });
    expect(group.children.map((child) => child.userData.type)).toEqual([
      "userMarker",
      "marker",
      undefined,
      "attack",
      "heal",
      "info",
    ]);
    expect(group.children.slice(3).every((child) => !child.visible)).toBe(true);
  });

  it("keeps restricted players non-attackable while retaining heal and info", () => {
    const group = createUserSprite(user({ rank: "STUDENT" }), hex);

    expect(group.children.map((child) => child.userData.type)).toEqual([
      "userMarker",
      "marker",
      undefined,
      "heal",
      "info",
    ]);
  });

  it.each([
    ["FRIENDLY", "talk"],
    ["HOSTILE", "attack"],
  ])("renders a %s NPC as a character plus visible %s action", (interaction, action) => {
    const group = createUserSprite(
      user({
        userId: "ai-template",
        isNpc: true,
        npcPlacementId: "placement-1",
        npcPositionVersion: 4,
        npcInteractionType: interaction,
      }),
      hex,
    );

    expect(group.name).toBe("placement-1");
    expect(group.children.map((child) => child.userData.type)).toEqual([
      undefined,
      action,
    ]);
    expect(group.children[1]?.visible).toBe(true);
    expect(group.children[1]?.userData).toMatchObject({
      npcPlacementId: "placement-1",
      npcPositionVersion: 4,
    });
  });
});
