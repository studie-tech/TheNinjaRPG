import { describe, expect, it } from "vitest";
import { Texture } from "three";

import { createCombatSprite, createUserSprite } from "@/libs/threejs/sector";

const hex = { width: 20, height: 20 } as never;
/** Returns an unloaded Three.js texture for browser-independent marker tests. */
const textureForPath = () => new Texture();

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
    const group = createUserSprite(user(), hex, textureForPath);

    expect(group.name).toBe("user-1");
    expect(group.userData).toMatchObject({
      type: "user",
      userId: "user-1",
    });
    expect(group.children.map((child) => child.userData.type)).toEqual([
      "userMarker",
      "marker",
      "avatar",
      "attack",
      "heal",
      "info",
    ]);
    expect(group.children.slice(3).every((child) => !child.visible)).toBe(true);
  });

  it("keeps restricted players non-attackable while retaining heal and info", () => {
    const group = createUserSprite(user({ rank: "STUDENT" }), hex, textureForPath);

    expect(group.children.map((child) => child.userData.type)).toEqual([
      "userMarker",
      "marker",
      "avatar",
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
      textureForPath,
    );

    expect(group.name).toBe("placement-1");
    expect(group.children.map((child) => child.userData.type)).toEqual([
      "avatar",
      action,
    ]);
    expect(group.children[1]?.visible).toBe(true);
    expect(group.children[1]?.userData).toMatchObject({
      npcPlacementId: "placement-1",
      npcPositionVersion: 4,
    });
    // The body doubles as a click target, so it must identify its placement
    expect(group.children[0]?.userData).toMatchObject({
      userId: "ai-template",
      npcPlacementId: "placement-1",
    });
  });

  it("keeps player avatar sprites free of placement identity", () => {
    const group = createUserSprite(user(), hex, textureForPath);
    const avatar = group.children.find((child) => child.userData.type === "avatar");
    expect(avatar?.userData.npcPlacementId).toBeUndefined();
  });
});

describe("createCombatSprite compatibility", () => {
  it("renders a VS marker for a solo fighter so PvE battles stay visible", () => {
    const group = createCombatSprite(
      user({ battleId: "battle-1" }),
      undefined,
      "battle-1",
      hex,
      textureForPath,
    );

    expect(group.name).toBe("battle-1");
    expect(group.userData).toMatchObject({
      type: "user",
      battleId: "battle-1",
    });
    expect(group.children.some((child) => child.userData.type === "battleMarker")).toBe(
      true,
    );
  });

  it("renders both portraits when two fighters share a battle", () => {
    const group = createCombatSprite(
      user({ userId: "user-1", battleId: "battle-2" }),
      user({ userId: "user-2", battleId: "battle-2" }),
      "battle-2",
      hex,
      textureForPath,
    );

    expect(group.children.filter((child) => child.userData.type === "marker").length).toBe(
      1,
    );
    expect(group.children.length).toBeGreaterThan(
      createCombatSprite(
        user({ battleId: "battle-2" }),
        undefined,
        "battle-2",
        hex,
        textureForPath,
      ).children.length,
    );
  });
});
