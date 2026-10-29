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
  const identity = root.getChildByLabel("combat-original") as Graphics;
  const threat = root.getChildByLabel("combat-aggro") as Container;
  const highest = threat.getChildByLabel("combat-aggro-highest") as Graphics;
  const health = root.getChildByLabel("combat-health") as Container;
  return { actors, root, selection, hover, identity, threat, highest, health, user, battle, grid, owned, step };
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
  it("keeps an empty threat track for zero aggro and removes it when threat does not apply", async () => {
    const { actors, threat, highest, user, battle } = await setup();
    const aggro = new Map([[user.userId, { enmity: 0, ratio: 0, isHighest: false }]]);
    actors.sync({ battle, aggro });
    expect(threat.visible).toBe(true);
    expect(threat.children[2]?.visible).toBe(false);
    expect(highest.visible).toBe(false);
    const children = [...threat.children];
    actors.sync({ battle, aggro });
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
      expect(highest.context).toBe(geometry);
      expect(highest.visible).toBe(false);
      expect(fill.tint).toBe(0xfbbf24);
    }
  });
  it.each([false, true])("keeps ground cues beneath artwork and the HUD above the head for NPC=%s", async (isAi) => {
    const { root, selection, hover, identity, threat, health, user, grid } = await setup(isAi);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const art = root.getChildByLabel("combat-art")!;
    for (const marker of [selection, hover, identity]) {
      expect(root.getChildIndex(marker)).toBeLessThan(root.getChildIndex(art));
      expect(marker.getLocalBounds().maxY).toBeLessThan(tile.height * 0.5);
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
    const { actors, root, selection, hover, identity, user, battle, grid } = await setup(false, failedAtlas ? resolveSpriteAppearance({}) : undefined);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const art = root.getChildByLabel("combat-art")!;
    const top = art.getLocalBounds().maxY;
    expect(top).toBeCloseTo(tile.height * (failedAtlas ? 1.35 : 1.5));
    const meters = ["combat-health", "combat-stamina", "combat-chakra", "combat-aggro"].map((label) => root.getChildByLabel(label)!);
    const positions = meters.map((meter) => meter.y);
    for (const meter of meters) expect(meter.y + meter.getLocalBounds().minY).toBeGreaterThan(top);
    const markers = [selection, hover, identity], groundPositions = markers.map((marker) => marker.y);
    for (const marker of markers) expect(marker.y + marker.getLocalBounds().maxY).toBeLessThan(art.getLocalBounds().minY);
    const frame = { now: 1000, delta: 0, reducedMotion: true };
    actors.animate(frame, user.userId, undefined);
    expect(selection.visible).toBe(true); expect(hover.visible).toBe(false);
    actors.animate(frame, "other", user.userId);
    expect(selection.visible).toBe(false); expect(hover.visible).toBe(true);
    actors.sync({ battle }); actors.sync({ battle });
    expect(meters.map((meter) => meter.y)).toEqual(positions);
    expect(markers.map((marker) => marker.y)).toEqual(groundPositions);
  });
  it("retains the compact HUD position when LPC artwork loads successfully", async () => {
    const { root, user, grid } = await setup(false, resolveSpriteAppearance({}));
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    expect(root.getChildByLabel("combat-health")?.y).toBeCloseTo(tile.height * 1.35);
    expect(root.getChildByLabel("combat-aggro")?.y).toBeCloseTo(tile.height * 1.45);
    for (const label of ["combat-selection", "combat-hover", "combat-original"])
      expect(root.getChildByLabel(label)?.y).toBe(0);
  });
  it.each(["helmet", "crown", "horns"])("clears tall %s artwork with every HUD row without moving ground cues", async (profile) => {
    const appearance = resolveSpriteAppearance({});
    appearance.layers.push({ profile, color: "gray" });
    const { actors, root, user, battle, grid } = await setup(false, appearance);
    const tile = grid.getHex({ col: user.longitude, row: user.latitude })!;
    const frameTop = tile.height * 1.35;
    const meters = ["combat-health", "combat-stamina", "combat-chakra", "combat-aggro"].map((label) => root.getChildByLabel(label)!);
    const positions = meters.map((meter) => meter.y);
    for (const meter of meters) expect(meter.y + meter.getLocalBounds().minY).toBeGreaterThan(frameTop);
    for (const label of ["combat-selection", "combat-hover", "combat-original"])
      expect(root.getChildByLabel(label)?.y).toBe(0);
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
    for (const marker of [selection, hover]) {
      const bounds = marker.getLocalBounds();
      expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(art.x);
      expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(footY);
    }
    expect(root.children[0]?.position).toMatchObject({ x: tile.width / 2, y: footY });
  });
  it("gently pulses selection opacity without moving its center and freezes for reduced motion", async () => {
    const { actors, selection, hover, user } = await setup(false, resolveSpriteAppearance({}));
    const bounds = selection.getLocalBounds().clone();
    const geometry = selection.context;
    actors.animate({ now: 450, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(selection.alpha).toBeCloseTo(1);
    actors.animate({ now: 1350, delta: 1 / 60, reducedMotion: false }, user.userId, undefined);
    expect(selection.alpha).toBeCloseTo(0.7);
    expect(selection.getLocalBounds()).toEqual(bounds);
    expect(selection.context).toBe(geometry);
    expect(hover.alpha).toBe(1);
    for (const now of [1800, 2250]) {
      actors.animate({ now, delta: 1 / 60, reducedMotion: true }, user.userId, undefined);
      expect(selection.alpha).toBe(1);
    }
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
  it("marks original players and the viewer's summons without including decoration in hits", async () => {
    const player = await setup(false);
    expect(player.identity.visible).toBe(true);
    player.user.isOriginal = false; player.actors.sync({ battle: player.battle });
    expect(player.identity.visible).toBe(false);
    const npc = await setup();
    expect(npc.identity.visible).toBe(false);
    npc.user.isSummon = true; npc.user.controllerId = "viewer";
    npc.actors.sync({ battle: npc.battle, playerId: "viewer" });
    expect(npc.identity.visible).toBe(true);
    const tile = npc.grid.getHex({ col: npc.user.longitude, row: npc.user.latitude })!;
    const point = npc.root.toGlobal({ x: tile.width / 2, y: tile.height * 0.06 });
    expect(npc.actors.hit(point.x, point.y)).toBeNull();
    npc.actors.sync({ battle: npc.battle, playerId: "other" });
    expect(npc.identity.visible).toBe(false);
  });
  it.each([{ curHealth: 0 }, { fledBattle: true }, { hidden: true }, { leftBattle: true }])("hides tactical cues for an inactive or hidden actor: %j", async (patch) => {
    const { actors, selection, hover, identity, threat, health, user, battle } = await setup(false);
    const aggro = new Map([[user.userId, { enmity: 100, ratio: 1, isHighest: true }]]);
    const frame = { now: 1000, delta: 1 / 60, reducedMotion: true };
    actors.sync({ battle, aggro }); actors.animate(frame, user.userId, user.userId);
    expect(selection.visible).toBe(true); expect(threat.visible).toBe(true);
    Object.assign(user, patch);
    actors.sync({ battle, aggro }); actors.animate(frame, user.userId, user.userId);
    for (const marker of [selection, hover, identity, threat, health]) expect(marker.visible).toBe(false);
  });
  it("removes absent actors and their asset scopes immediately", async () => {
    const { actors, root, battle, owned } = await setup();
    const before = owned.size;
    battle.usersState = []; actors.sync({ battle });
    expect(root.destroyed).toBe(true); expect(actors.container.children).toHaveLength(0);
    expect(owned.size).toBeLessThan(before);
  });
});
