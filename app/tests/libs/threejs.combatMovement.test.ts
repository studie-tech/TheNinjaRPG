import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { Group, Sprite, Texture, TextureLoader } from "three";
import type { UserData } from "@/drizzle/schema";
import type { ReturnedBattle, ReturnedUserState } from "@/libs/combat/types";
import { defineHex } from "@/libs/hexgrid";
import type { CharacterAnimations } from "@/libs/spriteAnimations";
import { createAggroHalo } from "@/libs/threejs/aggroHalo";
import { acquireAnimationTexture, clearUnusedAnimationTextures } from "@/libs/threejs/animationTextures";
import { AI_AVATAR_SPRITE, drawCombatUsers, resetCombatCaches } from "@/libs/threejs/combat";
import { loadTexture } from "@/libs/threejs/util";

let now = 0;
let sequence = 0;
let load: ReturnType<typeof vi.spyOn<TextureLoader, "load">>;
const sprites = new Set<Sprite>();
beforeEach(() => {
  now = 0;
  resetCombatCaches();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation(() => {
    const atlas = new Texture<HTMLImageElement>();
    atlas.image = document.createElement("img");
    atlas.image.width = 3072;
    atlas.image.height = 2048;
    return atlas;
  });
});
afterEach(() => {
  for (const sprite of sprites) sprite.userData.disposeCharacterAnimation?.();
  sprites.clear();
  clearUnusedAnimationTextures();
  vi.restoreAllMocks();
  resetCombatCaches();
});

const fixture = (animated = true, animateBattlefield = true) => {
  const id = `walking-${sequence++}`;
  const animations: CharacterAnimations = Object.fromEntries(["idle", "move"].map((action) => [action, {
    id: action, name: action, url: `https://example.com/${id}-${action}.png`,
    columns: 6, rows: action === "move" ? 2 : 4,
    frameCount: action === "move" ? 12 : 24, fps: 12.5, facing: "left",
  }]));
  const user = {
    userId: id, username: "Walker", isAi: true, isOriginal: true, avatarFacing: "left",
    direction: "left", longitude: 0, latitude: 0, curHealth: 100, maxHealth: 100,
    fledBattle: false, leftBattle: false, spriteAnimations: animated ? animations : {},
  } as ReturnedUserState;
  const grid = new Grid(defineHex(), rectangle({ width: 3, height: 1 }));
  grid.forEach((hex) => { hex.cost = 1; hex.blocked = false; });
  const actor = new Group();
  actor.name = id;
  const sprite = new Sprite();
  sprites.add(sprite);
  sprite.name = AI_AVATAR_SPRITE;
  sprite.userData = { avatarFacing: "left", avatarPath: `https://example.com/${id}.png`, mirrored: false };
  actor.add(sprite, createAggroHalo(20, 20, false));
  const group = new Group();
  group.add(actor);
  const battle = { usersState: [user], usersEffects: [] } as unknown as ReturnedBattle;
  const draw = (ms: number, users = [user], animateBattlefield = true) => {
    now = ms;
    return drawCombatUsers({ group_users: group, users, usersEffects: [], grid,
      playerId: "viewer", userData: { userId: "viewer" } as UserData, battle, sfxEnabled: false, animateBattlefield });
  };
  draw(0, [user], animateBattlefield);
  const start = actor.position.clone();
  user.longitude = 1;
  draw(0, [user], animateBattlefield);
  const target = grid.getHex({ col: 1, row: 0 })!;
  return { actor, sprite, user, group, grid, draw, start, target };
};

describe("combat walking playback", () => {
  it("snaps to destination without loading character sheets when animations are disabled", () => {
    const { actor, sprite, target, user } = fixture(true, false);
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    const animationUrls = Object.values(user.spriteAnimations!).map((animation) => animation.url);
    expect(load.mock.calls.some(([url]) => animationUrls.includes(url))).toBe(false);
  });

  it("finishes an interrupted walk immediately and resumes from that tile when re-enabled", () => {
    const { actor, user, grid, target, draw } = fixture();
    draw(100);
    expect(actor.position.x).not.toBe(-target.center.x);
    expect(draw(150, [user], false)).toBe(false);
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
    user.longitude = 2;
    expect(draw(200)).toBe(true);
    for (let time = 250; time <= 1200; time += 50) draw(time);
    const destination = grid.getHex({ col: 2, row: 0 })!;
    expect(actor.position.x).toBe(-destination.center.x);
    expect(actor.position.y).toBe(-destination.center.y);
  });

  it.each([30, 60, 170])("plays the walk throughout one tile at %i FPS, then returns to idle", (fps) => {
    const { actor, sprite, draw, start, target } = fixture();
    const frames = new Set<string>();
    for (let time = 1000 / fps; time < 480; time += 1000 / fps) {
      expect(draw(time)).toBe(true);
      frames.add(`${sprite.material.map?.offset.x},${sprite.material.map?.offset.y}`);
    }
    draw(480);
    expect(actor.position.x).toBeCloseTo((start.x - target.center.x) / 2, 5);
    expect(actor.position.y).toBeCloseTo((start.y - target.center.y) / 2, 5);
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    expect(frames.size).toBeGreaterThanOrEqual(5);
    for (let time = 480 + 1000 / fps; time < 1000; time += 1000 / fps) draw(time);
    expect(draw(1000)).toBe(false);
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
  });

  it("keeps the segment clock when no path is available", () => {
    const { actor, draw, user, grid } = fixture();
    grid.getHex({ col: 2, row: 0 })!.blocked = true;
    user.longitude = 2;
    draw(0);
    for (let time = 50; time <= 1000; time += 50) draw(time);
    const target = grid.getHex({ col: 2, row: 0 })!;
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
  });

  it("keeps ordinary image markers on a short time-based transition", () => {
    const { actor, draw, target } = fixture(false);
    for (let time = 25; time <= 250; time += 25) draw(time);
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
  });
  it("releases a removed actor's atlases and can initialize it again", () => {
    const { actor, sprite, draw } = fixture();
    expect(sprite.userData.characterAnimation.sources.size).toBeGreaterThan(0);
    draw(100, []);
    expect(actor.visible).toBe(false);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    draw(200);
    expect(actor.visible).toBe(true);
    expect(sprite.userData.characterAnimation.sources.size).toBeGreaterThan(0);
  });
  it.each(["disabled", "unassigned", "empty"])("restores a returning hidden actor's static image when animations are %s", (state) => {
    const { actor, sprite, user, group, draw } = fixture();
    draw(100, []);
    expect(group.children).toContain(actor);
    expect(actor.visible).toBe(false);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    if (state !== "disabled") user.spriteAnimations = state === "empty" ? {} : undefined;
    const staticMap = loadTexture(sprite.userData.avatarPath, 128, false);
    const staticDisposed = vi.spyOn(staticMap, "dispose");
    draw(200, [user], state !== "disabled");
    expect(actor.visible).toBe(true);
    expect(sprite.material.map).toBe(staticMap);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    const material = sprite.material;
    draw(300, [user], state !== "disabled");
    expect(sprite.material).toBe(material);
    expect(staticDisposed).not.toHaveBeenCalled();
  });
  it.each(["dead", "fled"])("reuses a living actor's idle atlas while a %s actor remains in battle state", (state) => {
    const { user, group, draw } = fixture();
    const inactive = { ...user, userId: `${user.userId}-inactive`, isOriginal: false,
      curHealth: state === "dead" ? 0 : 100, fledBattle: state === "fled" };
    const actor = new Group();
    actor.name = inactive.userId;
    const sprite = new Sprite();
    sprites.add(sprite);
    sprite.name = AI_AVATAR_SPRITE;
    sprite.userData = { avatarFacing: "left", avatarPath: "https://example.com/inactive.png", mirrored: false };
    actor.add(sprite, createAggroHalo(20, 20, false));
    group.add(actor);
    for (let ms = 50; ms <= 1050; ms += 50) draw(ms, [user, inactive]);
    const animationUrls = new Set(Object.values(user.spriteAnimations!).map((animation) => animation.url));
    const loads = load.mock.calls
      .map(([url]) => url).filter((url) => animationUrls.has(url));
    expect(loads).toEqual([user.spriteAnimations!.idle!.url, user.spriteAnimations!.move!.url]);
    expect(sprite.userData.characterAnimation).toBeUndefined();
  });
  it("releases all decoded sheets when the global animation preference is disabled", () => {
    const { user, sprite, draw } = fixture();
    const idle = acquireAnimationTexture(user.spriteAnimations!.idle!, 128)!;
    idle.release();
    const idleDisposed = vi.spyOn(idle.texture, "dispose");
    const move = sprite.userData.characterAnimation.sources.values().next().value;
    const moveDisposed = vi.spyOn(move.texture, "dispose");
    draw(100, [user], false);
    expect(sprite.userData.characterAnimation).toBeUndefined();
    expect(idleDisposed).toHaveBeenCalledTimes(1);
    expect(moveDisposed).toHaveBeenCalledTimes(1);
  });
});
