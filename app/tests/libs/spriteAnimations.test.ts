import { describe, expect, it } from "bun:test";
import { Sprite, Texture } from "three";
import { resolveSpriteAnimation, spriteActionKey, spriteAnimationFrame, type CharacterAnimation } from "@/libs/spriteAnimations";
import { applySpriteAnimationFrame, updateCharacterAnimation } from "@/libs/threejs/characterAnimation";
import { spriteAnimationSchema } from "@/validators/spriteAnimation";

const idle: CharacterAnimation = { id: "idle", name: "Idle", url: "https://example.com/idle.png", columns: 6, rows: 4, frameCount: 24, fps: 12.5, facing: "left" };
const move: CharacterAnimation = { ...idle, id: "move", url: "https://example.com/move.png", rows: 2, frameCount: 12 };
const attack: CharacterAnimation = { ...move, id: "attack", url: "https://example.com/attack.png" };
const loaded = () => { const texture = new Texture(); texture.image = { width: 3072, height: 2048 }; return texture; };

describe("AI sprite animation selection", () => {
  it("uses a specific action, then idle, then the existing image", () => {
    const animations = { idle, "jutsu:fire": attack };
    expect(resolveSpriteAnimation(animations, "jutsu:fire")).toBe(attack);
    expect(resolveSpriteAnimation(animations, "move")).toBe(idle);
    expect(resolveSpriteAnimation({}, "move")).toBeUndefined();
    expect(spriteActionKey({ type: "basic", id: "move" })).toBe("move");
    expect(spriteActionKey({ type: "jutsu", id: "fire" })).toBe("jutsu:fire");
    expect(spriteActionKey({ type: "item", id: "fire" })).toBe("item:fire");
  });
  it("wraps loops and clamps single actions to their last frame", () => {
    expect(spriteAnimationFrame(idle, 2000, true)).toBe(1);
    expect(spriteAnimationFrame(idle, 2000, false)).toBe(23);
  });
  it("mirrors within the selected atlas cell, including a partial last row", () => {
    const texture = new Texture();
    applySpriteAnimationFrame(texture, idle, 7, true);
    expect(texture.repeat.x).toBe(-1 / 6);
    expect(texture.offset.x).toBe(2 / 6);
    expect(texture.offset.y).toBe(0.5);
  });
  it("keeps actors and the shared source atlas independent", () => {
    const atlas = loaded(); const a = new Sprite(); const b = new Sprite();
    const base = { animations: { idle, move }, event: undefined, moving: false, facing: "left" as const, staticMap: loaded(), now: 0, textureForPath: () => atlas };
    updateCharacterAnimation({ ...base, sprite: a });
    updateCharacterAnimation({ ...base, sprite: b });
    updateCharacterAnimation({ ...base, sprite: a, facing: "right", now: 160 });
    expect(a.material.map).not.toBe(b.material.map);
    expect(a.material.map?.repeat.x).toBe(-1 / 6);
    expect(b.material.map?.repeat.x).toBe(1 / 6);
    expect(atlas.repeat.x).toBe(1);
    expect(atlas.offset.x).toBe(0);
  });
  it("switches idle → movement → jutsu → idle and restarts repeat casts", () => {
    const sprite = new Sprite();
    const base = { sprite, animations: { idle, move, "jutsu:fire": attack }, event: undefined, moving: false, facing: "left" as const, staticMap: loaded(), now: 0, textureForPath: loaded };
    updateCharacterAnimation(base);
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
    updateCharacterAnimation({ ...base, moving: true, now: 100 });
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    const event = { id: "cast-1", actionKey: "jutsu:fire" };
    updateCharacterAnimation({ ...base, event, now: 200 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
    updateCharacterAnimation({ ...base, event, now: 1400 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
    updateCharacterAnimation({ ...base, event: { ...event, id: "cast-2" }, now: 1500 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
  });
  it("falls back to the static image if no idle atlas can load", () => {
    const sprite = new Sprite(); const staticMap = loaded();
    updateCharacterAnimation({ sprite, animations: { idle }, event: undefined, moving: false, facing: "left", staticMap, now: 0, textureForPath: () => new Texture() });
    expect(sprite.material.map).toBe(staticMap);
  });
  it("plays movement before an action received in the same update, without expiring the action in transit", () => {
    const sprite = new Sprite();
    const base = { sprite, animations: { idle, move, "jutsu:fire": attack }, event: undefined, moving: false, facing: "left" as const, staticMap: loaded(), now: 0, textureForPath: loaded };
    updateCharacterAnimation(base);
    const event = { id: "move-and-cast", actionKey: "jutsu:fire" };
    updateCharacterAnimation({ ...base, event, moving: true, now: 100 });
    updateCharacterAnimation({ ...base, event, moving: true, now: 900 });
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    updateCharacterAnimation({ ...base, event, now: 1500 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
    expect(sprite.userData.characterAnimation.startedAt).toBe(1500);
    updateCharacterAnimation({ ...base, event, now: 2500 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
    updateCharacterAnimation({ ...base, event, moving: true, now: 2600 });
    updateCharacterAnimation({ ...base, event, now: 4000 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
  });
  it("plays consecutive actions and an explicit wait delivered during movement in order, once each", () => {
    const sprite = new Sprite();
    const wait = { ...move, id: "wait", url: "https://example.com/wait.png" };
    const base = { sprite, animations: { idle, move, "jutsu:fire": attack, "jutsu:ice": attack, "basic:wait": wait }, moving: false, facing: "left" as const, staticMap: loaded(), textureForPath: loaded };
    const first = { id: "cast-1", actionKey: "jutsu:fire" };
    const second = { id: "cast-2", actionKey: "jutsu:ice" };
    const last = { id: "wait", actionKey: "basic:wait" };
    updateCharacterAnimation({ ...base, event: undefined, now: 0 });
    updateCharacterAnimation({ ...base, event: first, moving: true, now: 1000 });
    updateCharacterAnimation({ ...base, event: second, moving: true, now: 2000 });
    updateCharacterAnimation({ ...base, event: last, moving: true, now: 3000 });
    updateCharacterAnimation({ ...base, event: last, moving: true, now: 3500 });
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    updateCharacterAnimation({ ...base, event: last, now: 4000 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
    expect(sprite.userData.characterAnimation.startedAt).toBe(4000);
    updateCharacterAnimation({ ...base, event: last, now: 4400 });
    expect(sprite.material.map?.offset.x).not.toBe(0);
    updateCharacterAnimation({ ...base, event: last, now: 4960 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
    expect(sprite.userData.characterAnimation.startedAt).toBe(4960);
    expect(sprite.material.map?.offset.x).toBe(0);
    updateCharacterAnimation({ ...base, event: last, now: 5920 });
    expect(sprite.userData.characterAnimation.animationId).toBe("wait");
    updateCharacterAnimation({ ...base, event: last, now: 7000 });
    updateCharacterAnimation({ ...base, event: last, now: 7100 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
    const remounted = new Sprite();
    updateCharacterAnimation({ ...base, sprite: remounted, event: last, now: 7100 });
    expect(remounted.userData.characterAnimation.animationId).toBe("idle");
  });
  it("rejects sheets whose declared frames do not fit the grid", () => {
    expect(spriteAnimationSchema.safeParse({ ...idle, frameCount: 25 }).success).toBe(false);
    expect(spriteAnimationSchema.safeParse(idle).success).toBe(true);
  });
  it("loads only idle initially, and skips all sheets when animations are disabled", () => {
    const sprite = new Sprite(); const fetch = () => loaded();
    const urls: string[] = [];
    const base = { sprite, animations: { idle, move, "jutsu:fire": attack }, event: undefined,
      moving: false, facing: "left" as const, staticMap: loaded(), now: 0,
      textureForPath: (url: string) => { urls.push(url); return fetch(); } };
    updateCharacterAnimation({ ...base, enabled: false });
    expect(urls).toEqual([]);
    updateCharacterAnimation(base);
    expect(urls).toEqual([idle.url]);
    updateCharacterAnimation({ ...base, moving: true, now: 100 });
    expect(urls).toEqual([idle.url, move.url]);
    updateCharacterAnimation({ ...base, enabled: false, now: 200 });
    expect(sprite.material.map).toBe(base.staticMap);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    updateCharacterAnimation({ ...base, enabled: false, now: 300 });
    expect(urls).toHaveLength(2);
  });
  it("starts a lazy action when loaded, and advances past failures to the next action", () => {
    const pending = new Texture(); const bad = new Texture(); bad.userData.failed = true;
    const sprite = new Sprite();
    const base = { sprite, animations: { idle, "jutsu:fire": attack, "jutsu:bad": { ...attack, id: "bad", url: "bad" } },
      moving: false, facing: "left" as const, staticMap: loaded(),
      textureForPath: (url: string) => url === attack.url ? pending : url === "bad" ? bad : loaded() };
    updateCharacterAnimation({ ...base, event: undefined, now: 0 });
    updateCharacterAnimation({ ...base, event: { id: "bad", actionKey: "jutsu:bad" }, now: 100 });
    updateCharacterAnimation({ ...base, event: { id: "good", actionKey: "jutsu:fire" }, now: 200 });
    expect(sprite.userData.characterAnimation.eventStartedAt).toBeUndefined();
    pending.image = loaded().image;
    updateCharacterAnimation({ ...base, event: { id: "good", actionKey: "jutsu:fire" }, now: 5000 });
    expect(sprite.userData.characterAnimation.animationId).toBe("attack");
    expect(sprite.userData.characterAnimation.eventStartedAt).toBe(5000);
    updateCharacterAnimation({ ...base, event: undefined, now: 6000 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
  });
  it("rejects excessive frame counts, padded grids and long loops", () => {
    expect(spriteAnimationSchema.safeParse({ ...idle, columns: 8, rows: 9, frameCount: 65 }).success).toBe(false);
    expect(spriteAnimationSchema.safeParse({ ...idle, columns: 9, rows: 9 }).success).toBe(false);
    expect(spriteAnimationSchema.safeParse({ ...idle, fps: 1 }).success).toBe(false);
  });
});
