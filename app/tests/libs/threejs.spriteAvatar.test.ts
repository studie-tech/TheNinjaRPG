import { describe, it, expect } from "vitest";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { pickSpriteAvatar } from "@/libs/threejs/util";

describe("pickSpriteAvatar", () => {
  it("renders an NPC's full avatar even when avatarLight is a placeholder thumbnail", () => {
    // NPC templates frequently carry a default `avatarLight` while their real
    // art lives in `avatar`; the map must show the real art, not the placeholder.
    expect(
      pickSpriteAvatar({
        isNpc: true,
        avatar: "https://cdn/real-art.webp",
        avatarLight: "https://cdn/630cf6e7_default.webp",
      }),
    ).toBe("https://cdn/real-art.webp");
  });

  it("prefers the lightweight avatarLight thumbnail for regular players", () => {
    expect(
      pickSpriteAvatar({
        isNpc: false,
        avatar: "https://cdn/full.webp",
        avatarLight: "https://cdn/thumb.webp",
      }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("treats a user with no isNpc flag as a player (avatarLight first)", () => {
    expect(
      pickSpriteAvatar({
        avatar: "https://cdn/full.webp",
        avatarLight: "https://cdn/thumb.webp",
      }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("falls back to avatarLight for an NPC when avatar is missing", () => {
    expect(
      pickSpriteAvatar({ isNpc: true, avatar: null, avatarLight: "https://cdn/thumb.webp" }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("falls back to the default avatar when nothing is set", () => {
    expect(pickSpriteAvatar({ isNpc: true, avatar: null, avatarLight: null })).toBe(
      IMG_AVATAR_DEFAULT,
    );
    expect(pickSpriteAvatar({ avatar: null, avatarLight: null })).toBe(IMG_AVATAR_DEFAULT);
  });
});
