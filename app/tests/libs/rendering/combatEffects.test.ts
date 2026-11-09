import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import type { GroundEffect, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatEffects } from "@/libs/rendering/scenes/combatEffects";
import { applyEffects, expireGroundEffects } from "@/libs/combat/process";
import {
  makeBattleUser,
  makeDamageEffect,
  makeEffect,
  makeCompleteBattle,
} from "../../setup/combat";

let sequence = 0;
const scopes: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Assets, "load").mockImplementation(
    async () =>
      new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(4 * 16 * 4),
          width: 4,
          height: 16,
        }),
      }),
  );
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const cleanup of scopes.splice(0)) cleanup();
  await Promise.resolve();
  vi.restoreAllMocks();
});
const setup = (hexWidth = 40) => {
  const owned = new Set<() => void>();
  const game = {
    own: (cleanup: () => void) => {
      owned.add(cleanup);
    },
    disown: (cleanup: () => void) => {
      owned.delete(cleanup);
    },
    invalidate: () => {},
    isDisposed: () => false,
    signal: new AbortController().signal,
  } as unknown as GameRenderer;
  scopes.push(() => {
    for (const cleanup of owned) cleanup();
  });
  const battle = makeCompleteBattle({
    width: 12,
    height: 10,
  }) as unknown as ReturnedBattle;
  const grid = getBattleGrid(hexWidth, battle, { x: -hexWidth / 2, y: -hexWidth / 2 });
  const play = vi.fn();
  const effects = createCombatEffects(game, grid, play);
  const stage = new Container();
  stage.addChild(effects.ground, effects.container);
  scopes.push(() =>
    stage.destroy({ children: true, texture: false, textureSource: false }),
  );
  const prefix = `effect-${sequence++}`;
  const assets = [
    {
      id: "animation",
      image: `https://example.com/${prefix}.png`,
      frames: 4,
      speed: 10,
    },
    { id: "appear", url: "appear.wav" },
    { id: "disappear", url: "disappear.wav" },
  ] as unknown as GameAsset[];
  const effect = {
    id: "effect",
    type: "visual",
    longitude: 3,
    latitude: 1,
    power: 100,
    staticAnimation: "animation",
    appearSfx: "appear",
    disappearSfx: "disappear",
  } as GroundEffect;
  battle.groundEffects = [effect];
  const snapshot = { battle, assets, sound: true, volume: 0.4 };
  return { effects, snapshot, effect, play, owned, grid, stage };
};

describe("Pixi combat effects", () => {
  it.each([24, 48])(
    "fits ground and character animations to their hex at %s world units",
    async (hexWidth) => {
      const scene = setup(hexWidth);
      scene.effect.appearAnimation = "animation";
      const target = makeBattleUser("target", { longitude: 4, latitude: 3 });
      const attached = makeEffect(
        "visual",
        { appearAnimation: "animation", staticAnimation: "animation" },
        {
          id: "attached",
          creatorId: target.userId,
          targetId: target.userId,
          targetType: "user",
        },
      );
      scene.snapshot.battle = makeCompleteBattle({
        width: 12,
        height: 10,
        usersState: [target],
        groundEffects: [scene.effect],
        usersEffects: [attached],
      }) as unknown as ReturnedBattle;
      await scene.effects.sync(scene.snapshot);
      for (const zoom of [1, 2]) {
        scene.stage.scale.set(zoom, -zoom);
        scene.stage.position.set(73, 41);
        for (const now of [0, 10, 30]) {
          scene.effects.animate(now, false, false, null);
          for (const [id, position] of [
            [scene.effect.id, scene.effect],
            [attached.id, target],
          ] as const) {
            const tile = scene.grid.getHex({
              col: position.longitude,
              row: position.latitude,
            })!;
            const center = tile.corners.reduce(
              (sum, point) => ({ x: sum.x + point.x / 6, y: sum.y + point.y / 6 }),
              { x: 0, y: 0 },
            );
            const root = scene.effects.container.getChildByLabel(id)!;
            expect(root.children).toHaveLength(2);
            for (const clip of root.children as Sprite[]) {
              const bounds = clip.getBounds();
              expect(bounds.width).toBeCloseTo(tile.height * zoom);
              expect(bounds.height).toBeCloseTo(tile.height * zoom);
              expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(73 + center.x * zoom);
              expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(41 - center.y * zoom);
            }
          }
        }
      }
    },
  );
  it.each([24, 48])(
    "scales only selected ground and fighter effects at %s world units",
    async (hexWidth) => {
      const scene = setup(hexWidth);
      scene.effect.animationScale = 2.5;
      scene.effect.appearAnimation = "animation";
      const target = makeBattleUser("target", { longitude: 4, latitude: 3 });
      const attached = makeEffect(
        "visual",
        {
          appearAnimation: "animation",
          staticAnimation: "animation",
          animationScale: 2.5,
        },
        {
          id: "attached",
          creatorId: target.userId,
          targetId: target.userId,
          targetType: "user",
        },
      );
      const legacy = { ...scene.effect, id: "legacy", longitude: 5 };
      delete (legacy as Partial<GroundEffect>).animationScale;
      scene.snapshot.battle = makeCompleteBattle({
        usersState: [target],
        groundEffects: [scene.effect, legacy],
        usersEffects: [attached],
      }) as unknown as ReturnedBattle;
      await scene.effects.sync(scene.snapshot);
      for (const zoom of [1, 2]) {
        scene.stage.scale.set(zoom, -zoom);
        scene.effects.animate(0, true, false, null);
        for (const [id, scale, position] of [
          [scene.effect.id, 2.5, scene.effect],
          [legacy.id, 1, legacy],
          [attached.id, 2.5, target],
        ] as const) {
          const tile = scene.grid.getHex({
            col: position.longitude,
            row: position.latitude,
          })!;
          const root = scene.effects.container.getChildByLabel(id)!;
          for (const clip of root.children as Sprite[]) {
            expect(clip.getBounds().width).toBeCloseTo(tile.height * scale * zoom);
            expect(clip.getBounds().height).toBeCloseTo(tile.height * scale * zoom);
            expect(clip.position.x).toBeCloseTo(tile.width / 2);
            expect(clip.position.y).toBeCloseTo(tile.height / 2);
          }
        }
      }
    },
  );
  it("keeps static barrier artwork below overlays with shared position, visibility and lifetime", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      type: "barrier",
      animationScale: 2.5,
      staticAssetPath: "obstacle",
      staticAnimation: "",
      appearAnimation: "animation",
      curHealth: 25,
      maxHealth: 50,
    });
    scene.snapshot.assets.push({
      id: "obstacle",
      image: "https://example.com/barrier.png",
    } as GameAsset);
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const art = scene.effects.ground.children[0]!,
      overlay = scene.effects.container.children[0]!;
    expect(art.children[0]?.label).toBe("static");
    expect(overlay.children).not.toContain(art);
    expect(overlay.children).toHaveLength(2);
    expect([art.x, art.y]).toEqual([overlay.x, overlay.y]);
    scene.effects.animate(40, false, false, null);
    expect(overlay.children).toHaveLength(1);
    const bounds = art.getBounds();
    expect(bounds.width).toBeCloseTo(scene.grid.getHex({ col: 3, row: 1 })!.width);
    expect(
      scene.effects.hit(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.id,
    ).toBe(scene.effect.id);
    scene.effect.latitude = 2;
    await scene.effects.sync(scene.snapshot);
    expect([art.x, art.y]).toEqual([overlay.x, overlay.y]);
    scene.effect.power = 0;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(50, false, false, null);
    expect(art.visible).toBe(false);
    expect(overlay.visible).toBe(false);
    expect(
      scene.effects.hit(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
    ).toBeNull();
    scene.effect.power = 100;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(60, false, false, null);
    expect(art.visible).toBe(true);
    expect(overlay.visible).toBe(true);
    scene.snapshot.battle.groundEffects = [];
    await scene.effects.sync(scene.snapshot);
    expect(art.destroyed).toBe(true);
    expect(overlay.destroyed).toBe(true);
    expect(scene.effects.ground.children).toHaveLength(0);
  });

  it("picks an animated overlay above later static artwork", async () => {
    const scene = setup();
    scene.snapshot.assets.push({
      id: "obstacle",
      image: "https://example.com/overlay-barrier.png",
    } as GameAsset);
    scene.snapshot.battle.groundEffects.push({
      ...scene.effect,
      id: "later-static",
      staticAnimation: "",
      staticAssetPath: "obstacle",
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const bounds = scene.effects.ground.children[0]!.getBounds();
    expect(
      scene.effects.hit(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.id,
    ).toBe(scene.effect.id);
  });

  it("retains depleted effects without replaying sounds or recreating loops", async () => {
    const scene = setup();
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const root = scene.effects.container.children[0];
    if (!root) throw new Error("Effect was not created");
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
    scene.effect.power = 0;
    await scene.effects.sync(scene.snapshot);
    for (let frame = 0; frame < 60; frame++)
      scene.effects.animate(frame, false, false, null);
    expect(scene.effects.container.children).toEqual([root]);
    expect(root?.visible).toBe(false);
    expect(scene.play.mock.calls).toEqual([
      ["appear.wav", 0.4],
      ["disappear.wav", 0.4],
    ]);
    scene.effect.power = 100;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(60, false, false, null);
    expect(root?.visible).toBe(true);
  });
  it("retires expired effects and their resource scopes", async () => {
    const scene = setup();
    await scene.effects.sync(scene.snapshot);
    expect(scene.owned.size).toBeGreaterThan(1);
    scene.snapshot.battle.groundEffects = [];
    await scene.effects.sync(scene.snapshot);
    expect(scene.effects.container.children).toHaveLength(0);
    // Only the scene-level sound queue cleanup remains registered.
    expect(scene.owned.size).toBe(1);
  });
  it("releases completed one-shot views while keeping the static loop alive", async () => {
    const scene = setup();
    scene.effect.appearAnimation = "animation";
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const root = scene.effects.container.children[0];
    expect(root?.children).toHaveLength(2);
    scene.effects.animate(40, false, false, null);
    expect(root?.children).toHaveLength(1);
  });
  it("queues appearance and disappearance behind movement exactly once", async () => {
    const scene = setup();
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, true, null);
    scene.effect.power = 0;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(1, false, true, null);
    expect(scene.play).not.toHaveBeenCalled();
    scene.effects.animate(2, false, false, null);
    scene.effects.animate(51, false, false, null);
    expect(scene.play).not.toHaveBeenCalled();
    scene.effects.animate(52, false, false, null);
    expect(scene.play.mock.calls).toEqual([
      ["appear.wav", 0.4],
      ["disappear.wav", 0.4],
    ]);
    scene.effects.animate(100, false, false, null);
    expect(scene.play).toHaveBeenCalledTimes(2);
  });
  it.each(["initial", "muted"])(
    "does not replay a suppressed %s disappearance",
    async (reason) => {
      const scene = setup();
      scene.effect.power = 0;
      scene.snapshot.sound = reason !== "muted";
      await scene.effects.sync(scene.snapshot, reason === "initial");
      scene.effects.animate(0, false, false, null);
      scene.snapshot.sound = true;
      await scene.effects.sync(scene.snapshot);
      scene.effects.animate(100, false, false, null);
      expect(scene.play).not.toHaveBeenCalled();
    },
  );
});

describe("authoritative combat effect transitions", () => {
  it("plays one disappearance when actual combat damage depletes a retained shield", async () => {
    const scene = setup();
    const shield = makeEffect(
      "shield",
      {
        power: 1,
        health: 1,
        rounds: 5,
        staticAnimation: "animation",
        disappearSfx: "disappear",
      },
      {
        id: "shield",
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        isNew: false,
        createdRound: 0,
      },
    );
    const battle = makeCompleteBattle({
      round: 2,
      usersState: [
        makeBattleUser("attacker", { longitude: 3, latitude: 1 }),
        makeBattleUser("defender", { longitude: 4, latitude: 1 }),
      ],
      usersEffects: [
        shield,
        makeDamageEffect({
          power: 100,
          calculation: "static",
          creatorId: "attacker",
          targetId: "defender",
          targetType: "user",
          isNew: true,
          createdRound: 2,
          rounds: 0,
        }),
      ],
    });
    scene.snapshot.battle = battle as unknown as ReturnedBattle;
    await scene.effects.sync(scene.snapshot, true);
    scene.effects.animate(0, false, false, null);
    const root = scene.effects.container.children[0];
    if (!root) throw new Error("Shield was not rendered");
    const { newBattle } = applyEffects(battle, "attacker");
    expect(
      newBattle.usersEffects.find((effect) => effect.id === shield.id),
    ).toMatchObject({ power: 0, rounds: 5, disappearSfx: "disappear" });
    scene.snapshot.battle = newBattle as unknown as ReturnedBattle;
    await scene.effects.sync(scene.snapshot);
    for (let frame = 1; frame <= 60; frame++)
      scene.effects.animate(frame, false, false, null);
    expect(scene.effects.container.children).toEqual([root]);
    expect(root?.visible).toBe(false);
    expect(scene.play.mock.calls).toEqual([["disappear.wav", 0.4]]);
  });
  it("renders the disappearance visual created by authoritative ground-effect expiry once", async () => {
    const scene = setup();
    const battle = makeCompleteBattle({
      round: 2,
      groundEffects: [
        makeEffect(
          "shield",
          {
            power: 1,
            health: 1,
            rounds: 1,
            animationScale: 2.5,
            disappearAnimation: "animation",
            disappearSfx: "disappear",
          },
          { longitude: 3, latitude: 1, targetType: "barrier", isNew: false },
        ),
      ],
    });
    battle.groundEffects[0]!.rounds = 0;
    expireGroundEffects(battle, []);
    scene.snapshot.battle = battle as unknown as ReturnedBattle;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    expect(scene.effects.container.children).toHaveLength(1);
    expect(scene.effects.container.children[0]?.visible).toBe(true);
    const end = scene.snapshot.battle.groundEffects[0]!;
    const tile = scene.grid.getHex({ col: end.longitude, row: end.latitude })!;
    const clip = scene.effects.container.children[0]!.children[0] as Sprite;
    expect(clip.width).toBeCloseTo(tile.height * 2.5);
    expect(clip.height).toBeCloseTo(tile.height * 2.5);
    for (let frame = 1; frame <= 60; frame++)
      scene.effects.animate(frame, false, false, null);
    expect(scene.play.mock.calls).toEqual([["disappear.wav", 0.4]]);
  });
});
