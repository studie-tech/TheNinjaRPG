import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcCatalog } from "@/libs/lpc/catalog";
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
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => texture());
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("layered LPC actors", () => {
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
    const stage = new Container(); stage.addChild(actors.container);
    cleanups.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
    actors.sync(snapshot); await loaded;
    // Artwork attaches after the async factory and scene aggregation finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = actors.container.children[0]!;
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
    // The server recipe takes precedence over a stale cached profile body style.
    expect(create.mock.calls[0]?.[1]).toEqual(appearance);
    expect(renders).toHaveLength(1);
    snapshot.users = []; actors.sync(snapshot);
    expect(root.destroyed).toBe(true);
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
    expect(first.destroyed).toBe(true);
    expect(source.source.destroyed).toBe(false);
  });
  it("cancels a character that finishes loading after its scene is disposed", async () => {
    const { game, controller } = gameFixture();
    controller.abort();
    await expect(characters.createLpcCharacter(game, resolveSpriteAppearance({}))).rejects.toMatchObject({ name: "AbortError" });
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
    expect(render.mock.calls.at(-1)?.slice(1)).toEqual(["idle", 1, false]);
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
    expect(render.mock.calls.at(-1)?.[1]).toBe("idle");
    battle.usersState = []; actors.sync({ battle });
    expect(root?.destroyed).toBe(true);
  });
});
