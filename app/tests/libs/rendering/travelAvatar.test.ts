import { describe, it, expect } from "bun:test";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { travelAvatar } from "@/libs/rendering/scenes/travelActors";

describe("travelAvatar", () => {
  it("renders an NPC's full avatar even when avatarLight is a placeholder thumbnail", () => {
    // NPC templates frequently carry a default `avatarLight` while their real
    // art lives in `avatar`; the map must show the real art, not the placeholder.
    expect(
      travelAvatar({
        isNpc: true,
        avatar: "https://cdn/real-art.webp",
        avatarLight: "https://cdn/630cf6e7_default.webp",
      }),
    ).toBe("https://cdn/real-art.webp");
  });

  it("prefers the lightweight avatarLight thumbnail for regular players", () => {
    expect(
      travelAvatar({
        isNpc: false,
        avatar: "https://cdn/full.webp",
        avatarLight: "https://cdn/thumb.webp",
      }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("treats a user with no isNpc flag as a player (avatarLight first)", () => {
    expect(
      travelAvatar({
        avatar: "https://cdn/full.webp",
        avatarLight: "https://cdn/thumb.webp",
      }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("falls back to avatarLight for an NPC when avatar is missing", () => {
    expect(
      travelAvatar({
        isNpc: true,
        avatar: null,
        avatarLight: "https://cdn/thumb.webp",
      }),
    ).toBe("https://cdn/thumb.webp");
  });

  it("falls back to the default avatar when nothing is set", () => {
    expect(travelAvatar({ isNpc: true, avatar: null, avatarLight: null })).toBe(
      IMG_AVATAR_DEFAULT,
    );
    expect(travelAvatar({ avatar: null, avatarLight: null })).toBe(IMG_AVATAR_DEFAULT);
  });
});
