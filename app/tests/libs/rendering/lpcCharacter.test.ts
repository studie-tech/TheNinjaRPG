import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcCatalog, lpcFrame, spriteLayerSheets, type LpcLayout } from "@/libs/lpc/catalog";
import * as characters from "@/libs/rendering/primitives/character";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatActors } from "@/libs/rendering/scenes/combatActors";
import { createTravelActors, type TravelActorsSnapshot } from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";
import type { SpriteAppearance } from "@/validators/lpc";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const cleanups: (() => void)[] = [];
const originalCreate = characters.createLpcCharacter;
const texture = () => new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 4096, height: 4096 }) });
const frame = (now: number, reducedMotion = false) => ({ now, delta: 1 / 60, reducedMotion });
/** Keep fixtures CPU-only while exercising real Pixi frame views, scope cleanup and cancellation. */
const gameFixture = () => {
  const owned = new Set<() => void>();
  const controller = new AbortController();
  const source = texture();
  const game = {
    own: (cleanup: () => void) => owned.add(cleanup),
    disown: (cleanup: () => void) => owned.delete(cleanup),
    assets: { texture: vi.fn(async () => source) },
    signal: controller.signal,
    isDisposed: () => controller.signal.aborted,
  } as unknown as GameRenderer;
  cleanups.push(() => { controller.abort(); for (const cleanup of owned) cleanup(); source.destroy(true); });
  return { game, owned, source, controller };
};
/** Compare sampled texel bounds without mixing logical trim metadata into Pixi's rectangle. */
const frameRectangle = (sample: NonNullable<ReturnType<typeof lpcFrame>>) => {
  const { x, y, width, height } = sample;
  return { x, y, width, height };
};
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => texture());
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("layered LPC actors", () => {
  it("gives identical characters independent idle phases while sharing their textures", async () => {
    const { game } = gameFixture();
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0).mockReturnValueOnce(0.9).mockReturnValueOnce(0.5);
    const appearance = resolveSpriteAppearance({});
    const first = await characters.createLpcCharacter(game, appearance, "travel");
    const second = await characters.createLpcCharacter(game, appearance, "travel");
    first.render({ now: 1000, delta: 0, reducedMotion: false }, "idle", 2);
    second.render({ now: 1000, delta: 0, reducedMotion: false }, "idle", 2);
    const a = first.sprite.children[0] as Sprite, b = second.sprite.children[0] as Sprite;
    expect(a.texture.source).toBe(b.texture.source);
    expect(a.texture.frame).not.toEqual(b.texture.frame);
    for (const actor of [first, second]) {
      const pieces = appearance.layers.flatMap((layer) => spriteLayerSheets(appearance, layer, "travel"));
      const elapsed = actor === first ? 60 : 540;
      for (const [index, piece] of pieces.entries()) expect((actor.sprite.children[index] as Sprite).texture.frame).toMatchObject(frameRectangle(lpcFrame(piece, "idle", 2, elapsed)!));
    }
  });
  it("varies each idle cycle's speed and leaves walking and attacks on their authored clock", async () => {
    const { game } = gameFixture();
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(0.9);
    const appearance = resolveSpriteAppearance({});
    const actor = await characters.createLpcCharacter(game, appearance);
    const sheet = spriteLayerSheets(appearance, appearance.layers[0]!)[0]!;
    actor.render({ now: 2000, delta: 2, reducedMotion: false }, "idle", 2);
    expect(random).toHaveBeenCalledTimes(3);
    actor.render({ now: 3000, delta: 1, reducedMotion: false }, "idle", 2);
    const body = actor.sprite.children[0] as Sprite;
    expect(body.texture.frame).toMatchObject(frameRectangle(lpcFrame(sheet, "idle", 2, 0)!));
    expect(body.texture.frame).not.toMatchObject(frameRectangle(lpcFrame(sheet, "idle", 2, 400)!));
    actor.render(frame(4000), "walk", 2);
    actor.render(frame(4180), "walk", 2);
    expect(body.texture.frame).toMatchObject(frameRectangle(lpcFrame(sheet, "walk", 2, 180)!));
    actor.render(frame(5000), "slash", 2);
    actor.render(frame(5160), "slash", 2);
    expect(body.texture.frame).toMatchObject(frameRectangle(lpcFrame(sheet, "slash", 2, 160)!));
    expect(random).toHaveBeenCalledTimes(3);
  });
  it("samples idle consistently across frame rates and freezes it for reduced motion", async () => {
    const { game } = gameFixture();
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const appearance = resolveSpriteAppearance({});
    const poses: unknown[] = [];
    for (const fps of [30, 60, 120]) {
      const actor = await characters.createLpcCharacter(game, appearance, "travel");
      for (let tick = 1; tick <= fps * 3.6; tick++) actor.render({ now: tick * 1000 / fps, delta: 1 / fps, reducedMotion: false }, "idle", 2);
      const part = actor.sprite.children[0] as Sprite;
      poses.push(part.texture.frame.clone());
      actor.render({ now: 5000, delta: 0.1, reducedMotion: true }, "idle", 2);
      const frozen = part.texture;
      actor.render({ now: 50000, delta: 0.1, reducedMotion: true }, "idle", 2);
      expect(part.texture).toBe(frozen);
      expect(part.y).toBe(0);
    }
    expect(poses[1]).toEqual(poses[0]);
    expect(poses[2]).toEqual(poses[0]);
  });
  it("uses a common authored combat or idle pose and keeps unsupported outfits together", async () => {
    const { game } = gameFixture();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    for (const [profile, state] of [["shirt", "combat"], ["leather", "idle"], ["club", "stand"]] as const) {
      const appearance: SpriteAppearance = { version: 1, body: "male", layers: [{ profile: "body", color: "light" }, { profile, color: "brown" }] };
      const actor = await characters.createLpcCharacter(game, appearance);
      actor.render({ now: 1000, delta: 0, reducedMotion: false }, "combat", 2);
      const parts = appearance.layers.flatMap((layer) => spriteLayerSheets(appearance, layer));
      for (const [index, part] of parts.entries()) {
        const child = actor.sprite.children[index] as Sprite;
        const expected = lpcFrame(part, state, 2, 540);
        const ownsPose = lpcCatalog.layouts[part.layout]!.clips[state];
        expect(child.visible).toBe(!!ownsPose);
        if (ownsPose) expect(child.texture.frame).toMatchObject(frameRectangle(expected!));
        expect(child.y).toBe(0);
      }
      actor.render(frame(2000, true), "combat", 2);
      for (const child of actor.sprite.children as Sprite[]) expect(child.y).toBe(0);
      actor.render(frame(3000), "walk", 2);
      for (const child of actor.sprite.children as Sprite[]) expect(child.y).toBe(0);
    }
  });
  it("keeps unsupported idle outfits planted through every breathing phase", async () => {
    const { game } = gameFixture();
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (const body of ["male", "female"] as const) for (const mode of ["all", "travel"] as const) for (const profile of ["club", "katana", "robe", "belt"]) {
      const appearance: SpriteAppearance = { version: 1, body, layers: [{ profile: "body", color: "light" }, { profile, color: "brown" }] };
      const actor = await characters.createLpcCharacter(game, appearance, mode);
      for (const direction of [0, 1, 2, 3] as const) for (const animation of ["idle", "combat"] as const) {
        actor.render({ now: 0, delta: 0, reducedMotion: false }, animation, direction);
        const neutral = (actor.sprite.children as Sprite[]).map((child) => ({ texture: child.texture, visible: child.visible }));
        for (let tick = 1; tick <= 240; tick++) {
          actor.render({ now: tick * 1000 / 60, delta: 1 / 60, reducedMotion: false }, animation, direction);
          for (const [index, child] of (actor.sprite.children as Sprite[]).entries()) {
            expect(child.y).toBe(0);
            expect(child.texture).toBe(neutral[index]!.texture);
            expect(child.visible).toBe(neutral[index]!.visible);
          }
        }
      }
    }
  });
  it.each([
    { profile: "club", animation: "slash", bodyAnimation: "slash", frames: Array.from({ length: 4 }, () => [5, 4, 3, 2, 1, 0]) },
    { profile: "whip", animation: "slash", bodyAnimation: "slash", frames: [[0, 1, 4, 5, 3, 2, 2, 1], [0, 1, 5, 4, 3, 3, 3, 2], [0, 1, 5, 4, 3, 3, 2, 1], [0, 1, 5, 4, 3, 3, 3, 2]] },
    { profile: "crossbow", animation: "shoot", bodyAnimation: "thrust", frames: Array.from({ length: 4 }, () => [0, 1, 2, 3, 4, 5, 6, 7]) },
  ] as const)("keeps $profile columns aligned with authored body/clothing poses", async ({ profile, animation, bodyAnimation, frames }) => {
    const { game } = gameFixture();
    for (const body of ["male", "female"] as const) for (const reducedMotion of [false, true]) for (const mirror of [false, true]) {
      const appearance: SpriteAppearance = { version: 1, body, layers: [{ profile: "body", color: "light" }, { profile: "shirt", color: "black" }, { profile, color: "brown", mirror }] };
      const actor = await characters.createLpcCharacter(game, appearance);
      const parts = appearance.layers.flatMap((layer) => spriteLayerSheets(appearance, layer).map((sheet) => ({ layer, sheet })));
      for (const direction of [0, 1, 2, 3] as const) {
        actor.render(frame(1000, reducedMotion), animation, direction, true);
        for (let step = 0; step <= frames[direction].length; step++) {
          actor.render(frame(1000 + step * 80, reducedMotion), animation, direction);
          const poseDirection = mirror && (direction === 1 || direction === 3) ? direction === 1 ? 3 : 1 : direction;
          const pose = frames[poseDirection][Math.min(reducedMotion ? 0 : step, frames[poseDirection].length - 1)]!;
          for (const [index, part] of parts.entries()) {
            const weapon = part.layer.profile === profile;
            const state = weapon ? animation : bodyAnimation;
            const facing = weapon && mirror && (direction === 1 || direction === 3) ? direction === 1 ? 3 : 1 : direction;
            const expected = lpcFrame(part.sheet, state, facing, weapon ? step * 80 : pose * 80, weapon && reducedMotion);
            const child = actor.sprite.children[index] as Sprite;
            expect(child.visible).toBe(!!expected);
            if (expected) expect(child.texture.frame).toMatchObject({ x: expected.x, y: expected.y, width: expected.width, height: expected.height });
          }
        }
      }
      expect(actor.durations[animation]).toBe(frames[0].length * 80);
    }
  });
  it.each([
    { primary: "club", secondary: "club", animation: "slash" },
    { primary: "whip", secondary: "whip", animation: "slash" },
    { primary: "crossbow", secondary: "crossbow", animation: "shoot" },
    { primary: "club", secondary: "whip", animation: "slash" },
    { primary: "whip", secondary: "club", animation: "slash" },
  ] as const)("aligns paired $primary/$secondary weapons with one body pose", async ({ primary, secondary, animation }) => {
    const { game } = gameFixture();
    for (const body of ["male", "female"] as const) for (const reducedMotion of [false, true]) for (const primaryMirror of [false, true]) {
      const appearance: SpriteAppearance = { version: 1, body, layers: [
        { profile: "body", color: "light" }, { profile: "shirt", color: "black" },
        { profile: primary, color: "brown", mirror: primaryMirror },
        { profile: secondary, color: "brown", mirror: !primaryMirror },
      ] };
      const actor = await characters.createLpcCharacter(game, appearance);
      const parts = appearance.layers.flatMap((layer) => spriteLayerSheets(appearance, layer).map((sheet) => ({ layer, sheet })));
      const owner = parts.find((part) => part.layer === appearance.layers[2])!;
      const ownerPose = lpcCatalog.layouts[owner.sheet.layout]!.bodyPoses![animation]!;
      for (const direction of [0, 1, 2, 3] as const) {
        const reflected = direction === 1 ? 3 : direction === 3 ? 1 : direction;
        const ownerFacing = primaryMirror ? reflected : direction;
        actor.render(frame(1000, reducedMotion), animation, direction, true);
        for (let step = 0; step <= 8; step++) {
          actor.render(frame(1000 + step * 80, reducedMotion), animation, direction);
          const ownerStep = Math.min(reducedMotion ? 0 : step, ownerPose.frames[ownerFacing]!.length - 1);
          const bodyStep = ownerPose.frames[ownerFacing]![ownerStep]!;
          for (const [index, part] of parts.entries()) {
            const child = actor.sprite.children[index] as Sprite;
            const facing = part.layer.mirror ? reflected : direction;
            const pose = lpcCatalog.layouts[part.sheet.layout]!.bodyPoses?.[animation];
            if (!pose) {
              const expected = lpcFrame(part.sheet, ownerPose.animation, facing, bodyStep * 80)!;
              expect(child.texture.frame).toMatchObject({ x: expected.x, y: expected.y, width: expected.width, height: expected.height });
              continue;
            }
            // Decode the selected native rectangle back to its authored body reference.
            const selected = pose.frames[facing]!.flatMap((bodyFrame, column) => {
              const expected = lpcFrame(part.sheet, animation, facing, column * 80)!;
              return child.texture.frame.x === expected.x && child.texture.frame.y === expected.y ? [bodyFrame] : [];
            });
            expect(child.visible).toBe(true);
            expect(selected).toContain(bodyStep);
            if (primary === secondary || part.layer === owner.layer) {
              const expected = lpcFrame(part.sheet, animation, facing, step * 80, reducedMotion)!;
              expect(child.texture.frame).toMatchObject({ x: expected.x, y: expected.y, width: expected.width, height: expected.height });
            }
          }
        }
      }
    }
  });
  it("shares immutable source-owned frame views across independently animated actors", async () => {
    const { game, source, owned } = gameFixture();
    const appearance: SpriteAppearance = { version: 1, body: "male", layers: [{ profile: "body", color: "light" }] };
    const [first, second] = await Promise.all([
      characters.createLpcCharacter(game, appearance),
      characters.createLpcCharacter(game, appearance),
    ]);
    const firstPart = first.sprite.children[0] as Sprite;
    const secondPart = second.sprite.children[0] as Sprite;
    expect(firstPart.texture).toBe(secondPart.texture);
    first.render(frame(1000), "walk", 2, true);
    second.render(frame(1000), "walk", 2, true);
    const standing = secondPart.texture;
    expect(firstPart.texture).toBe(standing);
    first.render(frame(1180), "walk", 2);
    const walking = firstPart.texture;
    expect(walking).not.toBe(standing);
    expect(secondPart.texture).toBe(standing);
    const imageSource = source.source;
    expect(imageSource.listenerCount("destroy")).toBe(1);
    const listeners = imageSource.listenerCount("resize");
    [...owned][0]!();
    expect(first.sprite.destroyed).toBe(true);
    expect(second.sprite.destroyed).toBe(false);
    expect(standing.destroyed).toBe(false);
    expect(walking.destroyed).toBe(false);
    imageSource.unload();
    expect(imageSource.destroyed).toBe(false);
    expect(walking.destroyed).toBe(false);
    second.render(frame(1180), "walk", 2);
    expect(secondPart.texture).toBe(walking);
    expect(imageSource.listenerCount("resize")).toBe(listeners);
    const replacement = gameFixture();
    const third = await characters.createLpcCharacter(replacement.game, appearance);
    third.render(frame(1000), "walk", 2, true);
    third.render(frame(1180), "walk", 2);
    const replacementPart = third.sprite.children[0] as Sprite;
    expect(replacementPart.texture).not.toBe(walking);
    expect(replacementPart.texture.source).toBe(replacement.source.source);
    imageSource.destroy();
    expect(standing.destroyed).toBe(true);
    expect(walking.destroyed).toBe(true);
    expect(imageSource.listenerCount("resize")).toBe(0);
    expect(imageSource.listenerCount("destroy")).toBe(0);
    expect(replacementPart.texture.destroyed).toBe(false);
  });
  it("preserves packed frame geometry, mirrored scale and unit-square hit bounds", async () => {
    const { game } = gameFixture();
    const key = "body/male/light/blue";
    const original = lpcCatalog.entries[key]!;
    const layoutCount = lpcCatalog.layouts.length;
    cleanups.push(() => { lpcCatalog.entries[key] = original; lpcCatalog.layouts.splice(layoutCount); });
    const base: LpcLayout = { cell: 64, columns: 1, trim: { x: 12, y: 6, width: 20, height: 40 }, clips: { idle: [[0], [0], [0], [0]], walk: [[0], [0], [0], [0]] } };
    const layouts = [
      base,
      { ...base, cell: 128 },
      { ...base, trim: { ...base.trim!, width: 21 } },
      { ...base, trim: { ...base.trim!, height: 41 } },
      { ...base, trim: { ...base.trim!, x: 13 } },
      { ...base, trim: { ...base.trim!, y: 7 } },
      base,
    ];
    const views: Texture[] = [];
    for (const [index, layout] of layouts.entries()) {
      lpcCatalog.entries[key] = [{ image: `packed-${index}`, z: 1, layout: lpcCatalog.layouts.push(layout) - 1 }];
      const actor = await characters.createLpcCharacter(game, { version: 1, body: "male", layers: [{ profile: "body", color: "light", mirror: true }] });
      const part = actor.sprite.children[0] as Sprite;
      views.push(part.texture);
      expect(part.texture.frame).toMatchObject({ x: 1, y: 1, width: layout.trim!.width, height: layout.trim!.height });
      expect(part.texture.orig).toMatchObject({ x: 0, y: 0, width: layout.cell, height: layout.cell });
      expect(part.texture.trim).toMatchObject(layout.trim!);
      expect(part.scale.x).toBe(-1 / 64);
      expect(part.scale.y).toBe(1 / 64);
      expect(part.width).toBe(layout.cell / 64);
      expect(part.height).toBe(layout.cell / 64);
      expect(part.visualBounds).toMatchObject({ minX: layout.trim!.x - layout.cell / 2, minY: layout.trim!.y - layout.cell / 2, maxX: layout.trim!.x + layout.trim!.width - layout.cell / 2, maxY: layout.trim!.y + layout.trim!.height - layout.cell / 2 });
      expect(actor.sprite.boundsArea).toMatchObject({ x: -0.5, y: -0.5, width: 1, height: 1 });
      actor.render(frame(90), "walk", 3);
      expect(part.scale.x).toBe(-1 / 64);
      expect(part.scale.y).toBe(1 / 64);
    }
    expect(new Set(views).size).toBe(layouts.length - 1);
    expect(views.at(-1)).toBe(views[0]);
  });
  it("keeps mirrored off-hand thrusts facing the same direction as the body", async () => {
    const { game } = gameFixture();
    const actor = await characters.createLpcCharacter(game, { version: 1, body: "male", layers: [{ profile: "dagger", color: "blue", mirror: true }] });
    const sheets = lpcCatalog.entries["dagger/male/blue/blue"]!;
    for (const direction of [1, 3] as const) {
      actor.render(frame(1000), "thrust", direction, true);
      const sprites = actor.sprite.children as Sprite[];
      for (const [index, child] of sprites.entries()) {
        if (!child.visible) continue;
        const expected = lpcFrame(sheets[index]!, "thrust", direction === 1 ? 3 : 1, 0)!;
        expect(child.texture.frame.x).toBe(expected.x);
        expect(child.texture.frame.y).toBe(expected.y);
        expect(child.scale.x).toBeLessThan(0);
      }
    }
  });
  it("walks toward sector updates, keeps canonical equipment and snaps reduced motion", async () => {
    const { game } = gameFixture();
    let resolveLoaded: (() => void) | undefined;
    const loaded = new Promise<void>((resolve) => { resolveLoaded = resolve; });
    const renders: ReturnType<typeof vi.fn>[] = [];
    const create = vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => {
      const actor = await originalCreate(...args);
      const render = vi.fn(actor.render); renders.push(render); resolveLoaded?.();
      return { ...actor, render };
    });
    const appearance = resolveSpriteAppearance({ spriteBodyStyle: "female" });
    const user = { userId: "sector-owner", longitude: 3, latitude: 1, status: "AWAKE", rank: "JONIN", allianceStatus: "NEUTRAL", experience: 0, spriteAppearance: appearance } as SectorUser;
    const viewer = { userId: user.userId, sector: 724, rank: "JONIN", userQuests: [], questData: [] } as unknown as UserWithRelations;
    const battle = makeCompleteBattle({ width: 12, height: 10 }) as unknown as ReturnedBattle;
    const grid = getBattleGrid(40, battle, { x: -20, y: -20 });
    const snapshot: TravelActorsSnapshot = { grid, viewer, users: [user], sector: 724, minBracket: -1, showUsers: true, friendlyAttack: false, structureObjectiveIds: new Set() };
    const actors = createTravelActors(game);
    const tileBounds = grid.getHex({ col: 3, row: 1 })!;
    const farTile = grid.getHex({ col: 11, row: 9 })!;
    snapshot.users.push({ ...user, userId: "distant-owner", longitude: 11, latitude: 9 });
    actors.setViewport({ minX: -tileBounds.center.x, maxX: -tileBounds.center.x, minY: -tileBounds.center.y, maxY: -tileBounds.center.y });
    const stage = new Container(); stage.addChild(actors.container);
    cleanups.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
    actors.sync(snapshot); await loaded;
    // Artwork attaches after the async factory and scene aggregation finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = actors.container.children[0]!;
    expect(actors.container.children).toHaveLength(1);
    actors.animate(frame(1000));
    const before = root.position.clone();
    user.longitude = 4;
    actors.sync(snapshot); actors.animate(frame(1100));
    expect(actors.container.children[0]).toBe(root);
    expect(root.position.x).not.toBe(before.x);
    expect(renders[0]!.mock.calls.at(-1)?.[1]).toBe("walk");
    actors.animate(frame(1200, true)); actors.animate(frame(1300, true));
    const tile = grid.getHex({ col: 4, row: 1 })!;
    expect(root.x).toBeCloseTo(-tile.center.x);
    expect(root.y).toBeCloseTo(-tile.center.y);
    expect(renders[0]!.mock.calls.at(-1)?.[1]).toBe("idle");
    user.longitude = 11;
    actors.sync(snapshot);
    for (let tick = 0; tick < 60; tick++) actors.animate(frame(1400 + tick * 1000 / 60));
    expect(root.x).toBeCloseTo(-grid.getHex({ col: 11, row: 1 })!.center.x);
    // The server recipe takes precedence over a stale cached profile body style.
    expect(create.mock.calls[0]?.[1]).toEqual(appearance);
    expect(renders).toHaveLength(1);
    expect((root.children[0] as Graphics).context.fillStyle.color).toBe(0x081115);
    expect((root.children[0] as Graphics).context.strokeStyle.color).toBe(0x3c80bb);
    user.allianceStatus = "ENEMY";
    actors.sync(snapshot);
    const hostile = actors.container.children[0]!;
    expect(root.destroyed).toBe(true);
    expect((hostile.children[0] as Graphics).context.fillStyle.color).toBe(0x081115);
    expect((hostile.children[0] as Graphics).context.strokeStyle.color).toBe(0xb84040);
    actors.setViewport({ minX: -farTile.center.x, maxX: -farTile.center.x, minY: -farTile.center.y, maxY: -farTile.center.y });
    expect(actors.container.children).toHaveLength(2);
    const distant = actors.container.children.find((child) => child !== hostile)!;
    actors.setViewport({ minX: -tileBounds.center.x, maxX: -tileBounds.center.x, minY: -tileBounds.center.y, maxY: -tileBounds.center.y });
    expect(distant.destroyed).toBe(true);
    expect(actors.container.children).toHaveLength(1);
    user.longitude = 0;
    snapshot.sector = 725;
    snapshot.grid = getBattleGrid(40, battle, { x: -20, y: -20 });
    actors.sync(snapshot); actors.animate(frame(2500));
    expect(hostile.destroyed).toBe(true);
    const crossed = actors.container.children[0]!;
    expect(crossed.x).toBeCloseTo(-snapshot.grid.getHex({ col: 0, row: 1 })!.center.x);
    snapshot.users = []; actors.sync(snapshot);
    expect(crossed.destroyed).toBe(true);
  });
  it("selects attack sheets instead of held weapons and restarts repeated attacks", async () => {
    const { game, source, owned } = gameFixture();
    const appearance: SpriteAppearance = { version: 1, body: "male", layers: [{ profile: "katana", color: "blue" }] };
    const actor = await characters.createLpcCharacter(game, appearance);
    const sheets = lpcCatalog.entries["katana/male/blue/blue"]!;
    const sprites = actor.sprite.children as Sprite[];
    actor.render(frame(1000), "slash", 2, true);
    expect(sprites.filter((part) => part.visible).length).toBeGreaterThan(0);
    for (let i = 0; i < sprites.length; i++) expect(sprites[i]!.visible).toBe(!!lpcCatalog.layouts[sheets[i]!.layout]!.clips.slash);
    const active = sprites.find((part) => part.visible)!;
    const first = active.texture;
    actor.render(frame(1240), "slash", 2);
    expect(active.texture).not.toBe(first);
    actor.render(frame(1300), "slash", 2, true);
    expect(active.texture).toBe(first);
    actor.render(frame(1450), "walk", 2, true);
    for (let i = 0; i < sprites.length; i++) expect(sprites[i]!.visible).toBe(!!lpcCatalog.layouts[sheets[i]!.layout]!.clips.walk);
    for (const cleanup of owned) cleanup();
    expect(actor.sprite.destroyed).toBe(true);
    expect(first.destroyed).toBe(false);
    expect(source.source.destroyed).toBe(false);
    source.source.destroy();
    expect(first.destroyed).toBe(true);
  });
  it("cancels a character that finishes loading after its scene is disposed", async () => {
    const { game, controller } = gameFixture();
    controller.abort();
    await expect(characters.createLpcCharacter(game, resolveSpriteAppearance({}))).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([30, 60, 120].flatMap((fps) => [
    { fps, longitude: 3, latitude: 2, reducedMotion: false },
    { fps, longitude: 4, latitude: 1, reducedMotion: false },
    { fps, longitude: 8, latitude: 1, reducedMotion: false },
    { fps, longitude: 8, latitude: 1, reducedMotion: true },
  ]))("advances combat walk textures throughout movement across refetches: %j", async ({ fps, longitude, latitude, reducedMotion }) => {
    const { game } = gameFixture();
    const poses = new Set<string>();
    const renders: ReturnType<typeof vi.fn>[] = [];
    const create = vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => {
      const actor = await originalCreate(...args);
      const render = vi.fn((...input: Parameters<typeof actor.render>) => {
        actor.render(...input);
        if (input[1] === "walk") {
          const part = actor.sprite.children[0] as Sprite;
          poses.add(`${part.texture.frame.x},${part.texture.frame.y}`);
        }
      });
      renders.push(render);
      return { ...actor, render };
    });
    const user = makeBattleUser("walking-actor", { isAi: false, isOriginal: true, longitude: 3, latitude: 1, spriteAppearance: resolveSpriteAppearance({}) });
    const battle = makeCompleteBattle({ usersState: [user], usersEffects: [], width: 12, height: 10 }) as unknown as ReturnedBattle;
    const grid = getBattleGrid(40, battle, { x: -20, y: -20 });
    const actors = createCombatActors(game, grid, () => {});
    const stage = new Container(); stage.addChild(actors.container);
    cleanups.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
    actors.sync({ battle }); await actors.ready();
    const root = actors.container.children[0]!;
    user.longitude = longitude; user.latitude = latitude;
    user.spriteAction = { id: "walk", animation: "walk", longitude, latitude };
    actors.sync({ battle });
    let tick = 0;
    while (actors.animate({ now: 1000 + tick++ * 1000 / fps, delta: 1 / fps, reducedMotion }, user.userId, undefined) && tick < fps * 10) actors.sync({ battle });
    expect(tick).toBeLessThan(fps * 10);
    if (reducedMotion) { expect(poses.size).toBe(1); expect(tick).toBe(5); }
    else expect(poses.size).toBeGreaterThanOrEqual(longitude === 8 ? 8 : 4);
    const target = grid.getHex({ col: longitude, row: latitude })!;
    expect(root.x).toBeCloseTo(-target.center.x);
    expect(root.y).toBeCloseTo(-target.center.y);
    expect(actors.container.children[0]).toBe(root);
    expect(create).toHaveBeenCalledTimes(1);
    const render = renders[0]!;
    expect(render.mock.calls.every((call) => call[3] === false)).toBe(true);
    actors.animate(frame(7000, reducedMotion), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.[1]).toBe("combat");
  });
  it("deduplicates combat cues across refetches, restarts consecutive attacks and keeps the actor", async () => {
    const { game } = gameFixture();
    const renders: ReturnType<typeof vi.fn>[] = [];
    const create = vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => {
      const actor = await originalCreate(...args);
      const render = vi.fn(actor.render);
      renders.push(render);
      return { ...actor, render };
    });
    const user = makeBattleUser("lpc-actor", { isAi: false, isOriginal: true, longitude: 3, latitude: 1, spriteAppearance: resolveSpriteAppearance({}), spriteAction: { id: "before-arrival", animation: "slash", longitude: 3, latitude: 1 } });
    const battle = makeCompleteBattle({ usersState: [user], usersEffects: [], width: 12, height: 10 }) as unknown as ReturnedBattle;
    const actors = createCombatActors(game, getBattleGrid(40, battle, { x: -20, y: -20 }), () => {});
    const stage = new Container(); stage.addChild(actors.container);
    cleanups.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
    actors.sync({ battle }); await actors.ready();
    const root = actors.container.children[0];
    const render = renders[0]!;
    actors.animate(frame(1000), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.slice(1)).toEqual(["combat", 1, false]);
    user.spriteAction = { id: "first", animation: "slash", longitude: 3, latitude: 1 };
    actors.sync({ battle }); actors.animate(frame(1100), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.[3]).toBe(true);
    actors.sync({ battle }); actors.animate(frame(1200), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.[3]).toBe(false);
    user.spriteAction = { ...user.spriteAction, id: "second" };
    actors.sync({ battle }); actors.animate(frame(1300), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.[3]).toBe(true);
    expect(actors.container.children[0]).toBe(root);
    expect(create).toHaveBeenCalledTimes(1);
    actors.animate(frame(2000), user.userId, undefined);
    expect(render.mock.calls.at(-1)?.[1]).toBe("combat");
    battle.usersState = []; actors.sync({ battle });
    expect(root?.destroyed).toBe(true);
  });
  it.each([{ profile: "whip", animation: "slash" }, { profile: "crossbow", animation: "shoot" }] as const)("expires $profile cues after their authored eight-frame cycle", async ({ profile, animation }) => {
    const { game } = gameFixture();
    const renders: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => {
      const actor = await originalCreate(...args);
      const render = vi.fn(actor.render); renders.push(render);
      return { ...actor, render };
    });
    const user = makeBattleUser("custom-actor", { isAi: false, isOriginal: true, longitude: 3, latitude: 1, spriteAppearance: { version: 1, body: "male", layers: [{ profile: "body", color: "light" }, { profile, color: "brown" }] } });
    const battle = makeCompleteBattle({ usersState: [user], usersEffects: [], width: 12, height: 10 }) as unknown as ReturnedBattle;
    const actors = createCombatActors(game, getBattleGrid(40, battle, { x: -20, y: -20 }), () => {});
    const stage = new Container(); stage.addChild(actors.container);
    cleanups.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
    actors.sync({ battle }); await actors.ready();
    actors.animate(frame(1000), user.userId, undefined);
    user.spriteAction = { id: "custom-strike", animation, longitude: 3, latitude: 1 };
    actors.sync({ battle }); actors.animate(frame(1100), user.userId, undefined);
    actors.sync({ battle }); actors.animate(frame(1660), user.userId, undefined);
    expect(renders[0]!.mock.calls.at(-1)?.[1]).toBe(animation);
    actors.animate(frame(1740), user.userId, undefined);
    expect(renders[0]!.mock.calls.at(-1)?.[1]).toBe("combat");
  });
});
