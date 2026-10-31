import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, type Sprite, Texture } from "pixi.js";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as characters from "@/libs/rendering/primitives/character";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatActors } from "@/libs/rendering/scenes/combatActors";
import type { SpriteAppearance } from "@/validators/lpc";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const cleanups: (() => void)[] = [];
let sequence = 0;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 4096, height: 4096 }) }));
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({ resource: Promise.resolve(Texture.WHITE), release() {} }));
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
const setup = async (isAi = true, spriteAppearance?: SpriteAppearance) => {
  const owned = new Set<() => void>(), stage = new Container();
  const game = { own: (cleanup: () => void) => owned.add(cleanup), disown: (cleanup: () => void) => owned.delete(cleanup), isDisposed: () => false, signal: new AbortController().signal } as unknown as GameRenderer;
  cleanups.push(() => { stage.destroy({ children: true, texture: false, textureSource: false }); for (const cleanup of owned) cleanup(); });
  const user = makeBattleUser("actor", { longitude: 3, latitude: 1, avatar: `https://example.com/actor-${sequence++}.png`, isAi, isOriginal: true, spriteAppearance });
  const battle = makeCompleteBattle({ usersState: [user], usersEffects: [], width: 12, height: 10 }) as unknown as ReturnedBattle;
  const grid = getBattleGrid(40, battle, { x: -20, y: -20 });
  const step = vi.fn(), actors = createCombatActors(game, grid, step);
  stage.addChild(actors.container); actors.sync({ battle }); await actors.ready();
  const root = actors.container.children[0]!;
  const selection = root.getChildByLabel("combat-selection") as Graphics;
  const hover = root.getChildByLabel("combat-hover") as Graphics;
  const threat = root.getChildByLabel("combat-aggro") as Container;
  const highest = threat.getChildByLabel("combat-aggro-highest") as Graphics;
  const health = root.getChildByLabel("combat-health") as Container;
  return { actors, root, selection, hover, threat, highest, health, user, battle, grid, owned, step };
};

describe("combat actor reconciliation", () => {
  it("interpolates position across snapshots without recreating the actor or mutating pools", async () => {
    const { actors, root, user, battle } = await setup();
    const pools = [user.curHealth, user.maxHealth];
    user.longitude = 4; actors.sync({ battle });
    const before = { x: root.x, y: root.y };
    expect(actors.animate({ now: 1000, delta: 1 / 60, reducedMotion: false }, user.userId, undefined)).toBe(true);
    expect(actors.container.children[0]).toBe(root);
    expect({ x: root.x, y: root.y }).not.toEqual(before);
    expect([user.curHealth, user.maxHealth]).toEqual(pools);
    actors.animate({ now: 1017, delta: 1 / 60, reducedMotion: true }, user.userId, undefined);
    expect(actors.animate({ now: 1034, delta: 0, reducedMotion: true }, user.userId, undefined)).toBe(false);
  });
  it("returns to the completed tile when a snapshot changes target mid-step", async () => {
    const { actors, root, user, battle, step } = await setup();
    const start = root.position.clone();
    user.longitude = 4; actors.sync({ battle });
    actors.animate({ now: 1000, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(root.position).not.toEqual(start);
    user.longitude = 3; actors.sync({ battle });
    for (let tick = 0; tick < 60; tick++) actors.animate({ now: 1017 + tick * 1000 / 60, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(root.position).toEqual(start);
    expect(step).not.toHaveBeenCalled();
    expect(actors.animate({ now: 3000, delta: 0, reducedMotion: false }, user.userId, undefined)).toBe(false);
  });
  it("hides empty threat tracks and reuses them when aggro changes", async () => {
    const { actors, threat, highest, user, battle } = await setup();
    const aggro = new Map([[user.userId, { enmity: 0, ratio: 0, isHighest: false }]]);
    actors.sync({ battle, aggro });
    expect(threat.visible).toBe(false);
    expect(threat.children[2]?.visible).toBe(false);
    expect(highest.visible).toBe(false);
    const children = [...threat.children];
    aggro.set(user.userId, { enmity: 25, ratio: 1, isHighest: true });
    actors.sync({ battle, aggro });
    expect(threat.visible).toBe(true);
    expect(highest.visible).toBe(true);
    aggro.set(user.userId, { enmity: 0, ratio: 0, isHighest: false });
    actors.sync({ battle, aggro });
    expect(threat.visible).toBe(false);
    expect(highest.visible).toBe(false);
    expect(threat.children).toEqual(children);
    actors.sync({ battle }); expect(threat.visible).toBe(false);
  });
  it("clamps threat amounts inside the retained meter and distinguishes the highest-threat cue", async () => {
    const { actors, threat, highest, user, battle } = await setup();
    actors.sync({ battle, aggro: new Map([[user.userId, { enmity: 100, ratio: 1, isHighest: true }]]) });
    const fill = threat.children[2] as Sprite, width = fill.width;
    const geometry = highest.context;
    expect(highest.visible).toBe(true);
    expect(fill.tint).toBe(0xf59e0b);
    for (const ratio of [0.25, 2, 0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      actors.sync({ battle, aggro: new Map([[user.userId, { enmity: ratio * 100, ratio, isHighest: ratio === 1 }]]) });
      expect(fill.width).toBeCloseTo(width * (Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0));
      expect(threat.visible).toBe(Number.isFinite(ratio) && ratio > 0);
      expect(highest.context).toBe(geometry);
      expect(highest.visible).toBe(false);
      expect(fill.tint).toBe(0xfbbf24);
    }
  });
  it.each([false, true])("keeps ground cues beneath artwork and the HUD above the head for NPC=%s", async (isAi) => {
    const { root, selection, hover, threat, health, user, grid } = await setup(isAi);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const art = root.getChildByLabel("combat-art")!;
    for (const marker of [selection, hover]) {
      expect(root.getChildIndex(marker)).toBeLessThan(root.getChildIndex(art));
      expect(marker.getLocalBounds().maxY).toBeLessThan(tile.height * 0.5);
    }
    expect(root.children[0]!.width).toBeLessThan(tile.width * 0.5);
    expect(root.children[0]!.height).toBeLessThanOrEqual(tile.height * 0.2);
    if (isAi) {
      const figure = art.children[0]!.children.find((child) => child.label === "aiAvatar")!;
      expect(root.children[0]!.y).toBeCloseTo(figure.y - figure.height / 2);
    }
    expect(threat.y - threat.height / 2).toBeCloseTo(health.y + health.height / 2);
    for (const label of ["combat-health", "combat-stamina", "combat-chakra"]) {
      const meter = root.getChildByLabel(label)!;
      expect(meter.y - meter.height / 2).toBeGreaterThan(tile.height * (isAi ? 1.7 : 1.4));
    }
  });
  it.each([false, true])("keeps HUD and ground cues clear of portrait artwork, including failed LPC atlases=%s", async (failedAtlas) => {
    if (failedAtlas) {
      vi.spyOn(characters, "createLpcCharacter").mockRejectedValue(new Error("Atlas unavailable"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
    }
    const { actors, root, selection, hover, user, battle, grid } = await setup(false, failedAtlas ? resolveSpriteAppearance({}) : undefined);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const art = root.getChildByLabel("combat-art")!;
    const top = art.getLocalBounds().maxY;
    expect(top).toBeCloseTo(tile.height * 1.5);
    const meters = ["combat-health", "combat-stamina", "combat-chakra", "combat-aggro"].map((label) => root.getChildByLabel(label)!);
    const positions = meters.map((meter) => meter.y);
    for (const meter of meters) expect(meter.y + meter.getLocalBounds().minY).toBeGreaterThan(top);
    const markers = [selection, hover], groundPositions = markers.map((marker) => marker.y);
    for (const marker of markers) expect(marker.y + marker.getLocalBounds().maxY - marker.pivot.y).toBeLessThan(art.getLocalBounds().minY);
    const frame = { now: 1000, delta: 0, reducedMotion: true };
    actors.animate(frame, user.userId, undefined);
    expect(selection.visible).toBe(true); expect(hover.visible).toBe(false);
    actors.animate(frame, "other", user.userId);
    expect(selection.visible).toBe(false); expect(hover.visible).toBe(true);
    actors.animate({ now: 450, delta: 0, reducedMotion: false }, user.userId, undefined);
    expect(selection.y + (selection.getLocalBounds().maxY - selection.pivot.y) * selection.scale.y).toBeLessThan(art.getLocalBounds().minY);
    actors.sync({ battle }); actors.sync({ battle });
    expect(meters.map((meter) => meter.y)).toEqual(positions);
    expect(markers.map((marker) => marker.y)).toEqual(groundPositions);
  });
  it("retains the compact HUD position when LPC artwork loads successfully", async () => {
    const { root, user, grid } = await setup(false, resolveSpriteAppearance({}));
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    expect(root.getChildByLabel("combat-health")?.y).toBeCloseTo(tile.height * 1.5);
    expect(root.getChildByLabel("combat-aggro")?.y).toBeCloseTo(tile.height * 1.6);
    for (const label of ["combat-selection", "combat-hover"]) {
      const marker = root.getChildByLabel(label)!;
      expect(marker.y).toBe(marker.pivot.y);
    }
  });
  it.each(["helmet", "crown", "horns"])("clears tall %s artwork with every HUD row without moving ground cues", async (profile) => {
    const appearance = resolveSpriteAppearance({});
    appearance.layers.push({ profile, color: "gray" });
    const { actors, root, user, battle, grid } = await setup(false, appearance);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const frameTop = tile.height * 1.5;
    const meters = ["combat-health", "combat-stamina", "combat-chakra", "combat-aggro"].map((label) => root.getChildByLabel(label)!);
    const positions = meters.map((meter) => meter.y);
    for (const meter of meters) expect(meter.y + meter.getLocalBounds().minY).toBeGreaterThan(frameTop);
    for (const label of ["combat-selection", "combat-hover"]) {
      const marker = root.getChildByLabel(label)!;
      expect(marker.y).toBe(marker.pivot.y);
    }
    actors.sync({ battle }); actors.sync({ battle });
    expect(meters.map((meter) => meter.y)).toEqual(positions);
  });
  it("keeps distinct resource and amber threat rows full-height and contiguous", async () => {
    const { root, user, grid } = await setup(false, resolveSpriteAppearance({}));
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const meters = ["combat-chakra", "combat-stamina", "combat-health", "combat-aggro"].map((label) => root.getChildByLabel(label)!);
    expect(meters.map((meter) => (meter.children[2] as Sprite).tint)).toEqual([0x0000ff, 0x008000, 0xb22222, 0xfbbf24]);
    for (const meter of meters) {
      expect(meter.height).toBeCloseTo(tile.height / 10);
      expect(meter.width).toBeCloseTo(tile.width / 2);
      expect(meter.children[0]).toMatchObject({ tint: 0x000000 });
    }
    const gaps = meters.slice(1).map((meter, index) => meter.y - meter.height / 2 - (meters[index]!.y + meters[index]!.height / 2));
    for (const gap of gaps) expect(gap).toBeCloseTo(0);
  });
  it("centers LPC ground rings and shadows on the authored foot contact point", async () => {
    const { root, selection, hover, user, grid } = await setup(false, resolveSpriteAppearance({}));
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const art = root.getChildByLabel("combat-art")!.children[0]!.children[0]!;
    const footY = art.y - Math.abs(art.scale.y) * (0.5 - 4 / 64);
    expect(footY).toBeGreaterThan(tile.height * 0.2);
    for (const marker of [selection, hover]) {
      const bounds = marker.getLocalBounds();
      expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(art.x);
      expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(footY);
    }
    expect(root.children[0]?.position).toMatchObject({ x: tile.width / 2, y: footY });
    expect(root.children[0]!.width).toBeLessThan(tile.width * 0.4);
    expect(root.children[0]!.height).toBeLessThan(tile.height * 0.2);
  });
  it("pulses selection size and opacity around a fixed foot point and freezes for reduced motion", async () => {
    const { actors, selection, hover, user } = await setup(false, resolveSpriteAppearance({}));
    const geometry = selection.context;
    const center = selection.toGlobal(selection.pivot);
    actors.animate({ now: 450, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(selection.alpha).toBeCloseTo(1);
    expect(selection.scale.x).toBeCloseTo(1.08);
    expect(selection.scale.y).toBeCloseTo(1.08);
    expect(selection.toGlobal(selection.pivot)).toEqual(center);
    actors.animate({ now: 1350, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(selection.alpha).toBeCloseTo(0.7);
    expect(selection.scale.x).toBe(1);
    expect(selection.toGlobal(selection.pivot)).toEqual(center);
    expect(selection.context).toBe(geometry);
    expect(hover.alpha).toBe(1);
    expect(hover.scale.x).toBe(1);
    for (const now of [1800, 2250]) {
      actors.animate({ now, delta: 1 / 60, reducedMotion: true }, user.userId, undefined);
      expect(selection.alpha).toBe(1);
      expect(selection.scale.x).toBe(1);
    }
    actors.animate({ now: 450, delta: 0, reducedMotion: false }, user.userId, undefined);
    actors.animate({ now: 450, delta: 0, reducedMotion: false }, "other", undefined);
    expect(selection.scale.x).toBe(1);
  });
  it("shows distinct selection and hover states without rebuilding their geometry", async () => {
    const { actors, selection, hover, health, user, grid } = await setup();
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    for (const marker of [selection, hover]) {
      expect(marker.width).toBeLessThan(tile.width * 0.4);
      expect(marker.height).toBeLessThan(tile.height * 0.2);
      expect(marker.context.instructions.every((instruction) => instruction.action === "stroke")).toBe(true);
    }
    const selectedGeometry = [...selection.context.instructions], hoverGeometry = [...hover.context.instructions];
    const frame = { now: 1000, delta: 1 / 60, reducedMotion: true };
    actors.animate(frame, user.userId, user.userId);
    expect(selection.visible).toBe(true); expect(hover.visible).toBe(false); expect(health.visible).toBe(true);
    actors.animate(frame, "other", user.userId);
    expect(selection.visible).toBe(false); expect(hover.visible).toBe(true); expect(health.visible).toBe(true);
    actors.animate({ ...frame, reducedMotion: false }, "other", undefined);
    expect(selection.visible).toBe(false); expect(hover.visible).toBe(false); expect(health.visible).toBe(false);
    expect(selection.context.instructions).toEqual(selectedGeometry);
    expect(hover.context.instructions).toEqual(hoverGeometry);
  });
  it("identifies clones with gray rings without adding a chevron or hit target", async () => {
    const { actors, root, selection, hover, user, battle, grid } = await setup(false);
    user.isOriginal = false; user.isSummon = true;
    actors.sync({ battle });
    const frame = { now: 450, delta: 0, reducedMotion: false };
    actors.animate(frame, "other", undefined);
    expect(root.getChildByLabel("combat-original")).toBeNull();
    expect(selection.visible).toBe(true); expect(selection.tint).toBe(0xd1d5db);
    expect(selection.alpha).toBe(0.55); expect(selection.scale.x).toBe(1);
    actors.animate(frame, "other", user.userId);
    expect(selection.alpha).toBe(1); expect(hover.visible).toBe(false);
    actors.animate(frame, user.userId, user.userId);
    expect(selection.tint).toBe(0xd1d5db); expect(selection.scale.x).toBeCloseTo(1.08);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const point = selection.toGlobal({ x: tile.width / 2, y: tile.height * 0.21 });
    expect(actors.hit(point.x, point.y)).toBeNull();
  });
  it("keeps ordinary summons and auto-battle originals out of clone styling", async () => {
    const { actors, selection, hover, user, battle } = await setup(false);
    const frame = { now: 450, delta: 0, reducedMotion: true };
    for (const patch of [{ isOriginal: true, isSummon: true }, { isOriginal: false, isSummon: false }]) {
      Object.assign(user, patch); actors.sync({ battle });
      actors.animate(frame, "other", undefined);
      expect(selection.visible).toBe(false);
      actors.animate(frame, user.userId, undefined);
      expect(selection.visible).toBe(true); expect(selection.tint).toBe(0xf0c56b);
      actors.animate(frame, "other", user.userId);
      expect(hover.visible).toBe(true); expect(hover.tint).toBe(0x9ae0e9);
    }
  });
  it.each([{ curHealth: 0 }, { fledBattle: true }, { hidden: true }, { leftBattle: true }])("hides tactical cues for an inactive or hidden actor: %j", async (patch) => {
    const { actors, selection, hover, threat, health, user, battle } = await setup(false);
    const aggro = new Map([[user.userId, { enmity: 100, ratio: 1, isHighest: true }]]);
    const frame = { now: 1000, delta: 1 / 60, reducedMotion: true };
    actors.sync({ battle, aggro }); actors.animate(frame, user.userId, user.userId);
    expect(selection.visible).toBe(true); expect(threat.visible).toBe(true);
    Object.assign(user, patch);
    actors.sync({ battle, aggro }); actors.animate(frame, user.userId, user.userId);
    for (const marker of [selection, hover, threat, health]) expect(marker.visible).toBe(false);
  });
  it("removes absent actors and their asset scopes immediately", async () => {
    const { actors, root, battle, owned } = await setup();
    const before = owned.size;
    battle.usersState = []; actors.sync({ battle });
    expect(root.destroyed).toBe(true); expect(actors.container.children).toHaveLength(0);
    expect(owned.size).toBeLessThan(before);
  });
});
