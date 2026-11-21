import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  Assets,
  BufferImageSource,
  Container,
  type Mesh,
  type Sprite,
  Texture,
} from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import { insertAction } from "@/libs/combat/actions";
import { maskBattle } from "@/libs/combat/masking";
import { applyEffects, expireGroundEffects } from "@/libs/combat/process";
import type { GroundEffect, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { groundDecalBoundaries } from "@/libs/rendering/primitives/groundDecal";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatEffects } from "@/libs/rendering/scenes/combatEffects";
import { createCombatPlayback } from "@/libs/rendering/scenes/combatPlayback";
import { PoisonTag, SkillTreeValidator } from "@/validators/combat";
import {
  makeBasicAttack,
  makeBattleUser,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
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

const setupProjectileReplay = (strike = false) => {
  const scene = setup();
  Object.assign(scene.effect, {
    creatorId: "caster",
    longitude: 4,
    latitude: 0,
    projectileAnimation: "animation",
    appearAnimation: "animation",
    staticAnimation: "",
  });
  const caster = makeBattleUser("caster", {
    curHealth: 100,
    longitude: 0,
    latitude: 0,
  });
  const previous = {
    ...scene.snapshot.battle,
    version: 1,
    usersState: [caster],
    groundEffects: [],
  };
  const changes = {
    userId: "caster",
    curHealth: 60,
    ...(strike
      ? {
          spriteAction: {
            id: "strike",
            animation: "slash" as const,
            longitude: 0,
            latitude: 0,
          },
        }
      : {}),
  };
  const next: ReturnedBattle = {
    ...previous,
    version: 2,
    usersState: [{ ...caster, ...changes }],
    groundEffects: [scene.effect],
    playback: [
      {
        version: 2,
        actorId: "caster",
        userIds: ["caster"],
        users: [changes],
        addedEffectIds: [scene.effect.id],
        removedEffectIds: [],
        hits: [{ userId: "caster", amount: -40 }],
      },
    ],
  };
  const playback = createCombatPlayback(previous);
  playback.receive(next);
  const tick = (now: number, instant = false) =>
    playback.tick({
      now,
      instant,
      moving: false,
      cue: () => 1,
      projectilesArrived: scene.effects.projectilesArrived,
    });
  return { ...scene, playback, tick, next };
};

describe("Pixi combat effects", () => {
  it("raises protective clips without moving their ground artwork or changing their scale", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      appearAnimation: "animation",
      animationOffsetY: 0.5,
    });
    await scene.effects.sync(scene.snapshot);
    const tile = scene.grid.getHex({ col: 3, row: 1 })!;
    scene.effects.animate(0, false, false, null);
    for (const sprite of scene.effects.container.children[0]!.children as Sprite[]) {
      expect(sprite.y).toBeCloseTo(tile.height);
      expect(sprite.height).toBeCloseTo(tile.height);
    }
  });
  it("fades only a field perimeter, including newly exposed edges after expiry", () => {
    const { grid } = setup();
    const first = grid.getHex({ col: 3, row: 1 })!;
    const next = grid.getHex({ col: 4, row: 1 })!;
    const tiles = [
      { id: "first", material: "shadow", tile: first },
      { id: "next", material: "shadow", tile: next },
    ];
    const joined = groundDecalBoundaries(tiles);
    expect(joined.get("first")?.filter(Boolean)).toHaveLength(5);
    expect(joined.get("next")?.filter(Boolean)).toHaveLength(5);
    expect(
      groundDecalBoundaries(tiles.slice(0, 1)).get("first")?.filter(Boolean),
    ).toHaveLength(6);
    expect(
      groundDecalBoundaries([tiles[0]!, { ...tiles[1]!, material: "fire" }])
        .get("first")
        ?.filter(Boolean),
    ).toHaveLength(6);
    expect(
      groundDecalBoundaries([tiles[0]!, { ...tiles[0]!, id: "duplicate" }])
        .get("first")
        ?.filter(Boolean),
    ).toHaveLength(6);
  });
  it.each(["depleted", "projectile", "expired"] as const)(
    "feathers the exposed edge of a %s neighbor",
    async (state) => {
      const scene = setup();
      Object.assign(scene.effect, {
        staticAssetPath: "animation",
        staticAnimation: "",
        groundStyle: "DECAL",
        groundFeather: 0.1,
      });
      const neighbor = { ...scene.effect, id: "neighbor", longitude: 4 };
      scene.snapshot.battle.groundEffects.push(neighbor);
      await scene.effects.sync(scene.snapshot);
      const mesh = scene.effects.ground
        .getChildByLabel("effect")!
        .getChildByLabel("ground-surface") as Mesh;
      const outerEdges = () =>
        Object.entries(mesh.shader!.resources.style.uniforms).filter(
          ([key, value]) => key.startsWith("uEdge") && (value as number[])[3] === 1,
        ).length;
      expect(outerEdges()).toBe(5);
      if (state === "depleted") neighbor.power = 0;
      else if (state === "projectile") neighbor.projectileOnly = true;
      else scene.snapshot.battle.groundEffects = [scene.effect];
      await scene.effects.sync(scene.snapshot);
      expect(outerEdges()).toBe(6);
    },
  );
  it("attaches the latest perimeter when a neighbor expires during texture loading", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      staticAssetPath: "animation",
      staticAnimation: "",
      groundStyle: "DECAL",
      groundFeather: 0.1,
    });
    scene.snapshot.battle.groundEffects.push({
      ...scene.effect,
      id: "neighbor",
      longitude: 4,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => {
      await gate;
      return new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(16 * 16 * 4),
          width: 16,
          height: 16,
        }),
      });
    });
    const pending = scene.effects.sync(scene.snapshot);
    scene.snapshot.battle.groundEffects = [scene.effect];
    await scene.effects.sync(scene.snapshot);
    release();
    await pending;
    const mesh = scene.effects.ground
      .getChildByLabel("effect")!
      .getChildByLabel("ground-surface") as Mesh;
    expect(
      Object.entries(mesh.shader!.resources.style.uniforms).filter(
        ([key, value]) => key.startsWith("uEdge") && (value as number[])[3] === 1,
      ),
    ).toHaveLength(6);
  });
  it("emits one projectile and primary cue for a persistent cast on an occupied tile", async () => {
    const scene = setup();
    scene.snapshot.battle.groundEffects = [
      makeEffect(
        "stun",
        {
          rounds: 3,
          appearSfx: "appear",
          appearSfxPrimary: true,
          projectileAnimation: "animation",
        },
        {
          id: "cast",
          creatorId: "caster",
          actionId: "action",
          longitude: 4,
          latitude: 1,
          isNew: true,
          createdRound: 2,
          targetType: "user",
        },
      ),
    ];
    const battle = applyEffects(
      makeCompleteBattle({
        round: 2,
        groundEffects: scene.snapshot.battle.groundEffects,
        usersState: [
          makeBattleUser("caster", { longitude: 2, latitude: 1 }),
          makeBattleUser("target", { longitude: 4, latitude: 1 }),
        ],
      }),
      "caster",
    ).newBattle;
    const onsets = battle.groundEffects.filter(
      (effect) => effect.type === "visual" && effect.appearSfx === "appear",
    );
    expect(onsets).toHaveLength(1);
    expect(onsets[0]?.projectileAnimation).toBe("animation");
    expect(
      battle.groundEffects.some(
        (effect) => effect.id === "cast" && effect.type === "stun",
      ),
    ).toBe(true);
    await scene.effects.sync({ ...scene.snapshot, battle });
    scene.effects.animate(0, false, false, null);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
  });
  it("shares a cast's sound across tiles without silencing later casts or another caster", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      creatorId: "caster",
      actionId: "wall",
      createdRound: 1,
    });
    scene.snapshot.battle.groundEffects.push({
      ...scene.effect,
      id: "second-tile",
      longitude: 4,
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);

    scene.snapshot.battle.groundEffects.push(
      { ...scene.effect, id: "next-cast", longitude: 5 },
      { ...scene.effect, id: "other-caster", creatorId: "other", longitude: 6 },
    );
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(20, false, false, null);
    expect(scene.play).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])(
    "uses a marked primary cue regardless of tile order (%s)",
    async (reverse) => {
      const scene = setup();
      scene.snapshot.assets.push({ id: "accent", url: "accent.wav" } as GameAsset);
      Object.assign(scene.effect, {
        creatorId: "caster",
        actionId: "composite",
        createdRound: 1,
      });
      const primary = {
        ...scene.effect,
        id: "primary",
        longitude: 4,
        appearSfxPrimary: true,
      };
      scene.effect.appearSfx = "accent";
      scene.snapshot.battle.groundEffects = reverse
        ? [primary, scene.effect]
        : [scene.effect, primary];
      await scene.effects.sync(scene.snapshot);
      scene.effects.animate(0, false, false, null);
      expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);

      scene.snapshot.battle.groundEffects.push({
        ...primary,
        id: "later",
        createdRound: 2,
      });
      await scene.effects.sync(scene.snapshot);
      scene.effects.animate(20, false, false, null);
      expect(scene.play).toHaveBeenCalledTimes(2);
    },
  );
  it("retains distinct layered cues on casts without a primary", async () => {
    const scene = setup();
    scene.snapshot.assets.push({ id: "accent", url: "accent.wav" } as GameAsset);
    scene.snapshot.battle.groundEffects.push({
      ...scene.effect,
      id: "accent",
      longitude: 4,
      appearSfx: "accent",
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    expect(scene.play.mock.calls).toEqual([
      ["appear.wav", 0.4],
      ["accent.wav", 0.4],
    ]);
  });
  it("preserves unmarked transient visuals' existing sound deduplication", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      creatorId: "caster",
      actionId: "visual",
      createdRound: 2,
      soundOrigin: { actionId: "first", createdRound: 1, phase: "disappear" },
    });
    scene.snapshot.battle.groundEffects.push({
      ...scene.effect,
      id: "second",
      longitude: 4,
      soundOrigin: { actionId: "second", createdRound: 1, phase: "disappear" },
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
  });
  it.each(["appear", "disappear"] as const)(
    "preserves private primary %s cues for every viewer and deduplicates target copies",
    async (phase) => {
      const battle = makeCompleteBattle({
        width: 5,
        height: 5,
        createdAt: new Date("2020-01-01"),
        usersState: [
          makeBattleUser("caster", {
            direction: "left",
            longitude: 0,
            latitude: 0,
            enemySkillIds: ["private-skill", "private-bloodright"],
          }),
          makeBattleUser("victim", { direction: "right", longitude: 2, latitude: 0 }),
          makeBattleUser("other", { direction: "right", longitude: 3, latitude: 0 }),
        ],
      });
      battle.extraState.enemySkills = {
        "private-skill": [
          PoisonTag.parse({
            power: 20,
            rounds: 3,
            [`${phase}Sfx`]: "a",
            [`${phase}SfxPrimary`]: true,
          }),
        ],
        "private-bloodright": [
          PoisonTag.parse({
            power: 10,
            rounds: 2,
            [`${phase}Sfx`]: "b",
            [`${phase}SfxPrimary`]: true,
          }),
        ],
      };
      for (const effects of Object.values(battle.extraState.enemySkills))
        expect(SkillTreeValidator.shape.effects.safeParse(effects).success).toBe(true);
      expect(
        insertAction({
          battle,
          grid: getBattleGrid(20, battle),
          action: makeBasicAttack({ range: 5, methodSize: { x: 1, y: 0 } }),
          actorId: "caster",
          longitude: 2,
          latitude: 0,
        }),
      ).toBe(true);
      expect(
        battle.usersEffects.filter((effect) => effect.fromType === "skill"),
      ).toHaveLength(4);
      let { newBattle } = applyEffects(battle, "caster");
      if (phase === "disappear") {
        for (const effect of newBattle.usersEffects) effect.rounds = 0;
        newBattle = applyEffects(newBattle, "caster").newBattle;
      }
      const before = structuredClone(newBattle);
      for (const viewer of ["caster", "victim", "spectator"]) {
        const scene = setup();
        const masked = maskBattle(newBattle, viewer);
        await scene.effects.sync({
          ...scene.snapshot,
          battle: masked,
          assets: [
            { id: "a", url: "a.wav" },
            { id: "b", url: "b.wav" },
          ] as GameAsset[],
        });
        scene.effects.animate(0, false, false, null);
        expect(scene.play.mock.calls).toEqual([
          ["a.wav", 0.4],
          ["b.wav", 0.4],
        ]);
        if (viewer !== "caster") {
          expect(JSON.stringify(masked)).not.toContain("private-skill");
          expect(JSON.stringify(masked)).not.toContain("private-bloodright");
          for (const effect of masked.usersEffects.filter(
            (entry) => entry.fromType === "skill",
          )) {
            const onset = masked.groundEffects.find(
              (entry) => entry.appearSfx === effect.appearSfx,
            );
            expect(onset?.soundOrigin?.actionId).toBe(effect.actionId);
          }
        }
      }
      expect(newBattle).toEqual(before);
    },
  );
  it("keeps primary appearance and disappearance independent during movement", async () => {
    const scene = setup();
    scene.snapshot.assets.push({ id: "accent", url: "accent.wav" } as GameAsset);
    Object.assign(scene.effect, {
      creatorId: "caster",
      actionId: "composite",
      createdRound: 1,
      appearSfxPrimary: true,
      disappearSfxPrimary: true,
    });
    const accent = {
      ...scene.effect,
      id: "accent",
      longitude: 4,
      appearSfx: "accent",
      disappearSfx: "accent",
      appearSfxPrimary: false,
      disappearSfxPrimary: false,
    };
    scene.snapshot.battle.groundEffects.push(accent);
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, true, null);
    scene.effect.power = accent.power = 0;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(20, false, true, null);
    expect(scene.play).not.toHaveBeenCalled();
    scene.effects.animate(30, false, false, null);
    scene.effects.animate(81, false, false, null);
    expect(scene.play.mock.calls).toEqual([
      ["appear.wav", 0.4],
      ["disappear.wav", 0.4],
    ]);
  });
  it("preserves a composite's selected removal cue through authoritative expiry", async () => {
    const scene = setup();
    scene.snapshot.assets.push({ id: "accent", url: "accent.wav" } as GameAsset);
    const effect = makeEffect(
      "shield",
      {
        power: 1,
        health: 1,
        rounds: 1,
        disappearAnimation: "animation",
        disappearSfx: "disappear",
        disappearSfxPrimary: true,
      },
      {
        longitude: 3,
        latitude: 1,
        isNew: false,
        creatorId: "caster",
        actionId: "composite",
        createdRound: 1,
      },
    );
    effect.rounds = 0;
    const battle = makeCompleteBattle({
      round: 2,
      groundEffects: [
        {
          ...effect,
          id: "accent",
          longitude: 4,
          disappearSfx: "accent",
          disappearSfxPrimary: false,
        },
        effect,
      ],
    });
    expireGroundEffects(battle, []);
    scene.snapshot.battle = battle as unknown as ReturnedBattle;
    expect(battle.groundEffects[1]).toMatchObject({
      appearSfxPrimary: true,
      soundOrigin: { actionId: "composite", createdRound: 1, phase: "disappear" },
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    expect(scene.play.mock.calls).toEqual([["disappear.wav", 0.4]]);
  });
  it.each([false, true])(
    "waits for a delayed projectile's visible flight before landing health, log and sound (strike: %s)",
    async (strike) => {
      const scene = setupProjectileReplay(strike);
      const texture = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(4 * 16 * 4),
          width: 4,
          height: 16,
        }),
      });
      let resolveTexture!: (texture: Texture) => void;
      const loading = new Promise<Texture>((resolve) => {
        resolveTexture = resolve;
      });
      vi.spyOn(Assets, "load").mockImplementationOnce(() => loading);
      scene.tick(0);
      const travelling = scene.tick(1);
      const pending = scene.effects.sync({ ...scene.snapshot, battle: travelling });
      scene.effects.animate(1, false, false, null);
      expect(scene.tick(650)).toBe(travelling);
      expect(scene.effects.container.children[0]?.children).toHaveLength(0);
      expect(scene.playback.logVersion()).toBe(1);
      expect(scene.playback.takeHits()).toBeUndefined();
      expect(scene.play).not.toHaveBeenCalled();

      resolveTexture(texture);
      await pending;
      // Loading alone does not start a flight: its first rendered frame does.
      expect(scene.tick(800)).toBe(travelling);
      scene.effects.animate(800, false, false, null);
      const projectile = scene.effects.container.children[0]!.children[0] as Sprite;
      const origin = projectile.x;
      expect(projectile.visible).toBe(true);
      expect(scene.tick(1000)).toBe(travelling);
      scene.effects.animate(1000, false, false, null);
      expect(projectile.visible).toBe(true);
      expect(projectile.x).not.toBe(origin);
      expect(scene.tick(1339)).toBe(travelling);
      expect(scene.tick(1340)).toBe(scene.next);
      expect(scene.next.usersState[0]?.curHealth).toBe(60);
      expect(scene.playback.takeHits()).toEqual([{ userId: "caster", amount: -40 }]);
      expect(scene.playback.takeHits()).toBeUndefined();
      await scene.effects.sync({ ...scene.snapshot, battle: scene.next });
      scene.effects.animate(1340, false, false, null);
      expect(projectile.destroyed).toBe(true);
      expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
    },
  );
  it("lands a failed projectile load without waiting for the replay timeout", async () => {
    const scene = setupProjectileReplay();
    vi.spyOn(Assets, "load").mockRejectedValueOnce(new Error("Unavailable artwork"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const travelling = scene.tick(0);
    await scene.effects.sync({ ...scene.snapshot, battle: travelling });
    expect(warn).toHaveBeenCalled();
    expect(scene.tick(1)).toBe(scene.next);
    expect(scene.playback.takeHits()).toEqual([{ userId: "caster", amount: -40 }]);
  });
  it("bounds a stalled projectile load and discards artwork arriving after timeout", async () => {
    const scene = setupProjectileReplay();
    let resolveTexture!: (texture: Texture) => void;
    const loading = new Promise<Texture>((resolve) => {
      resolveTexture = resolve;
    });
    vi.spyOn(Assets, "load").mockImplementationOnce(() => loading);
    const travelling = scene.tick(0);
    const pending = scene.effects.sync({ ...scene.snapshot, battle: travelling });
    expect(scene.tick(3999)).toBe(travelling);
    expect(scene.tick(4000)).toBe(scene.next);
    expect(scene.playback.isPlaying()).toBe(false);
    expect(scene.playback.takeHits()).toEqual([{ userId: "caster", amount: -40 }]);
    // Removing the expired flight must also cancel its pending sprite creation.
    const root = scene.effects.container.children[0]!;
    const impact = scene.effects.sync({ ...scene.snapshot, battle: scene.next });
    resolveTexture(
      new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(4 * 16 * 4),
          width: 4,
          height: 16,
        }),
      }),
    );
    await Promise.all([pending, impact]);
    scene.effects.animate(4100, false, false, null);
    expect(root.destroyed).toBe(true);
    expect(scene.effects.projectilesArrived(4100)).toBe(false);
    expect(scene.playback.presented()).toBe(scene.next);
  });
  it("moves a cast from its creator to its target, then replaces travel with impact once", async () => {
    const scene = setup();
    scene.snapshot.battle.usersState = [
      makeBattleUser("caster", { longitude: 2, latitude: 1 }),
    ];
    Object.assign(scene.effect, {
      creatorId: "caster",
      projectileAnimation: "animation",
      projectileScale: 2,
      projectileOnly: true,
      staticAnimation: "",
      appearSfx: "",
    });
    await scene.effects.sync(scene.snapshot);
    const root = scene.effects.container.children[0]!;
    const projectile = root.children[0] as Sprite;
    scene.effects.animate(0, false, false, null);
    expect(scene.play).not.toHaveBeenCalled();
    const tile = scene.grid.getHex({ col: 3, row: 1 })!;
    expect(projectile.width).toBeCloseTo(tile.height * 0.65 * 2);
    const start = projectile.x;
    scene.effects.animate(100, false, false, null);
    expect(projectile.x).not.toBe(start);
    scene.effects.animate(650, false, false, null);
    expect(projectile.visible).toBe(false);
    Object.assign(scene.effect, {
      projectileOnly: false,
      appearAnimation: "animation",
      appearSfx: "appear",
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(650, false, false, null);
    expect(root.destroyed).toBe(true);
    expect(scene.effects.container.children[0]?.children).toHaveLength(1);
    const impact = scene.effects.container.children[0]?.children[0] as Sprite;
    expect(impact.width).toBeCloseTo(tile.height);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(660, false, false, null);
    expect(scene.play).toHaveBeenCalledTimes(1);
  });
  it("keeps a surface loop flattened through texture-frame changes", async () => {
    const scene = setup();
    scene.effect.groundStyle = "SURFACE";
    await scene.effects.sync(scene.snapshot);
    const sprite = scene.effects.ground.children[0]!.children[0] as Sprite;
    const tile = scene.grid.getHex({ col: 3, row: 1 })!;
    for (const now of [0, 10, 30, 80]) {
      scene.effects.animate(now, false, false, null);
      expect(sprite.height).toBeCloseTo(tile.height * 0.55);
    }
  });
  it("does not launch projectiles when hydrating an already-landed effect", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      projectileAnimation: "animation",
      staticAnimation: "",
    });
    await scene.effects.sync(scene.snapshot, true);
    scene.effects.animate(0, true, false, null);
    expect(scene.effects.container.children[0]?.children).toHaveLength(0);
    expect(scene.play).not.toHaveBeenCalled();
  });
  it("keeps an upright eruption above a separately softened ground decal", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      groundStyle: "DECAL",
      groundOpacity: 0.7,
      groundFeather: 0.1,
      staticAssetPath: "animation",
      staticAnimation: "",
      appearAnimation: "animation",
    });
    await scene.effects.sync(scene.snapshot);
    const root = scene.effects.container.children[0]!;
    const sprite = root.children[0] as Sprite;
    const tile = scene.grid.getHex({ col: 3, row: 1 })!;
    scene.effects.animate(0, false, false, null);
    expect(sprite.height).toBeCloseTo(tile.height);
    expect(sprite.alpha).toBe(1);
    expect(
      scene.effects.ground.children[0]!.getChildByLabel("ground-surface"),
    ).toBeDefined();
  });
  it("owns a feathered ground decal below actors and releases it on expiry", async () => {
    const scene = setup();
    Object.assign(scene.effect, {
      groundStyle: "SURFACE",
      groundOpacity: 0.6,
      groundFeather: 0.12,
      staticAssetPath: "animation",
      staticAnimation: "",
    });
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const surface = scene.effects.ground.children[0]!;
    expect(surface.getChildByLabel("ground-surface")).toBeDefined();
    const root = scene.effects.container.children[0]!;
    expect([surface.x, surface.y]).toEqual([root.x, root.y]);
    scene.snapshot.battle.groundEffects = [];
    await scene.effects.sync(scene.snapshot);
    expect(surface.destroyed).toBe(true);
  });
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
  it("carries a projectile-only cast and its real creator through authoritative effect processing", () => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("attacker", { longitude: 2, latitude: 1 }),
        makeBattleUser("defender", { longitude: 4, latitude: 1 }),
      ],
      usersEffects: [
        makeDamageEffect({
          creatorId: "attacker",
          targetId: "defender",
          targetType: "user",
          rounds: 0,
          projectileAnimation: "bolt",
          projectileScale: 2,
          appearAnimation: "",
          appearSfx: "",
          power: 1,
          calculation: "static",
        }),
      ],
    });
    const { newBattle } = applyEffects(battle, "attacker");
    expect(newBattle.groundEffects).toContainEqual(
      expect.objectContaining({
        type: "visual",
        creatorId: "attacker",
        projectileAnimation: "bolt",
        projectileScale: 2,
        longitude: 4,
        latitude: 1,
      }),
    );
  });
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
            animationOffsetY: 0.5,
            projectileAnimation: "bolt",
            projectileScale: 2,
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
    expect(end.projectileAnimation).toBeUndefined();
    expect(end.projectileScale).toBeUndefined();
    expect(end.animationOffsetY).toBe(0.5);
    const tile = scene.grid.getHex({ col: end.longitude, row: end.latitude })!;
    const clip = scene.effects.container.children[0]!.children[0] as Sprite;
    expect(clip.width).toBeCloseTo(tile.height * 2.5);
    expect(clip.height).toBeCloseTo(tile.height * 2.5);
    expect(clip.y).toBeCloseTo(tile.height);
    for (let frame = 1; frame <= 60; frame++)
      scene.effects.animate(frame, false, false, null);
    expect(scene.play.mock.calls).toEqual([["disappear.wav", 0.4]]);
  });
});
