import { describe, expect, it } from "bun:test";
import {
  resolveSpriteAnimation,
  snapshotSpriteAnimations,
  spriteActionKey,
  spriteAnimationFrame,
  type CharacterAnimation,
} from "@/libs/spriteAnimations";
import { spriteAnimationSchema } from "@/validators/spriteAnimation";
const idle: CharacterAnimation = {
  id: "idle",
  name: "Idle",
  url: "https://example.com/idle.png",
  smallUrl: null,
  columns: 6,
  rows: 4,
  frameCount: 24,
  fps: 12,
  facing: "left",
};
describe("AI animation metadata", () => {
  it("resolves catalogue actions and idle fallback", () => {
    expect(spriteActionKey({ type: "basic", id: "move" })).toBe("move");
    expect(spriteActionKey({ type: "jutsu", id: "fire" })).toBe("jutsu:fire");
    expect(resolveSpriteAnimation({ idle }, "missing")).toBe(idle);
    expect(resolveSpriteAnimation({}, "idle")).toBeUndefined();
  });
  it("samples chronological loops and one shots", () => {
    expect(spriteAnimationFrame(idle, 2100, true)).toBe(1);
    expect(spriteAnimationFrame(idle, 2100, false)).toBe(23);
    expect(spriteAnimationFrame(idle, -1, true)).toBe(0);
  });
  it("keeps author metadata out of battle snapshots", () => {
    const result = snapshotSpriteAnimations([
      {
        actionKey: "idle",
        animation: { ...idle, createdAt: new Date(), createdByUserId: "editor" },
      },
    ]);
    expect(result.idle).toEqual(idle);
    expect(snapshotSpriteAnimations([{ actionKey: "idle", animation: null }])).toEqual(
      {},
    );
  });
  it("rejects oversized and overlong sheets", () => {
    expect(spriteAnimationSchema.safeParse(idle).success).toBe(true);
    expect(
      spriteAnimationSchema.safeParse({
        ...idle,
        columns: 8,
        rows: 11,
        frameCount: 81,
        fps: 12.5,
      }).success,
    ).toBe(true);
    expect(
      spriteAnimationSchema.safeParse({
        ...idle,
        columns: 9,
        rows: 18,
        frameCount: 160,
        fps: 12.5,
      }).success,
    ).toBe(true);
    expect(
      spriteAnimationSchema.safeParse({ ...idle, frameCount: 193, rows: 33 }).success,
    ).toBe(false);
    expect(spriteAnimationSchema.safeParse({ ...idle, fps: 1 }).success).toBe(false);
  });
});
