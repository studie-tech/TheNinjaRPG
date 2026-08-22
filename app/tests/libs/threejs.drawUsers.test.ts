import { Group, Texture } from "three";
import { describe, expect, it } from "vitest";

import { drawUsers } from "@/libs/threejs/sector";

/** One flat-topped hex per column/row, enough for findHex and sprite placement. */
const grid = {
  getHex: ({ col, row }: { col: number; row: number }) => ({
    col,
    row,
    width: 20,
    height: 20,
    center: { x: col * 20, y: row * 20 },
  }),
} as never;

/** Returns an unloaded Three.js texture so markers build without a browser. */
const textureForPath = () => new Texture();

/** Minimal awake player fixture; `experience` decides the user's XP bracket. */
const player = (patch: Record<string, unknown> = {}) =>
  ({
    userId: "other-1",
    username: "Other",
    rank: "JONIN",
    allianceStatus: "NEUTRAL",
    status: "AWAKE",
    avatar: "avatar.webp",
    avatarLight: "avatar-light.webp",
    longitude: 5,
    latitude: 5,
    experience: 0,
    ...patch,
  }) as never;

/** Names of the markers drawUsers left visible in the scene group. */
const visibleMarkers = (group: Group) =>
  group.children.filter((child) => child.visible).map((child) => child.name);

const draw = (users: unknown[], minBracket: number, selfUserId?: string) => {
  const group_users = new Group();
  drawUsers({
    group_users,
    users: users as never,
    grid,
    lastTime: Date.now(),
    angle: 0,
    minBracket,
    selfUserId,
    textureForPath,
  });
  return group_users;
};

describe("drawUsers bracket filtering", () => {
  it("draws everyone while no bracket is selected", () => {
    const group = draw(
      [player({ userId: "self" }), player({ userId: "other-1", longitude: 6 })],
      -1,
      "self",
    );

    expect(visibleMarkers(group).sort()).toEqual(["other-1", "self"]);
  });

  it("keeps the viewer's own marker when their bracket is filtered out", () => {
    // Bracket 2 starts above 500k XP, so a 0 XP viewer does not match it
    const group = draw([player({ userId: "self" })], 2, "self");

    expect(visibleMarkers(group)).toEqual(["self"]);
  });

  it("still hides other players who do not match the selected bracket", () => {
    const group = draw(
      [player({ userId: "self" }), player({ userId: "other-1", longitude: 6 })],
      2,
      "self",
    );

    expect(visibleMarkers(group)).toEqual(["self"]);
  });

  it("draws other players who do match the selected bracket", () => {
    const group = draw(
      [
        player({ userId: "self" }),
        player({ userId: "other-1", longitude: 6, experience: 600_000 }),
      ],
      2,
      "self",
    );

    expect(visibleMarkers(group).sort()).toEqual(["other-1", "self"]);
  });
});
