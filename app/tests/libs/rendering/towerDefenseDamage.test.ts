import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Container, type Sprite, Texture } from "pixi.js";
import { TD_DAMAGE_NUMBER_POOL_SIZE, TD_HEX_SIZE } from "@/drizzle/constants";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createTowerDefenseEffects } from "@/libs/rendering/scenes/towerDefenseEffects";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";
import { calculateHexDistance } from "@/libs/towerDefense/game";
import type {
  TowerDefenseAbility,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";

const disposers: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillText() {} }) as never,
  );
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

const game = () => {
  const owned: (() => void)[] = [];
  let disposed = false;
  const renderer = {
    stage: new Container(),
    assets: { texture: async () => Texture.WHITE },
    signal: new AbortController().signal,
    isDisposed: () => disposed,
    own: (dispose: () => void) => owned.push(dispose),
    invalidate: vi.fn(),
  } as unknown as GameRenderer;
  disposers.push(() => {
    disposed = true;
    for (const dispose of owned) dispose();
  });
  return renderer;
};

const frame: GameFrame = { now: 1000, delta: 1 / 60, reducedMotion: false };
const characters = "0123456789!-";
const origin = { col: 3, row: 3 };
const targets = [
  { col: 3, row: 3 },
  { col: 4, row: 3 },
  { col: 5, row: 4 },
  { col: 6, row: 2 },
];

/** The floating number a landed projectile shows, as the pre-extraction effects module computed it. */
const reference = (
  projectile: TowerDefenseProjectile,
  ability: Pick<TowerDefenseAbility, "critChance" | "damagePerTile"> | undefined,
) => {
  const distanceBonus = Math.floor(
    calculateHexDistance(projectile.origin, projectile.target) *
      (ability?.damagePerTile ?? 0),
  );
  const critical =
    projectile.critRoll !== undefined &&
    projectile.critRoll < (ability?.critChance ?? 0);
  const value = (projectile.damage + distanceBonus) * (critical ? 2 : 1);
  return { text: `${Math.round(value)}${critical ? "!" : ""}`.slice(0, 12), critical };
};

const shown = (effects: Awaited<ReturnType<typeof createTowerDefenseEffects>>) => {
  const numbers = effects.container.children[2]!.children as Container[];
  const visible = numbers.filter((root) => root.visible);
  expect(visible).toHaveLength(1);
  const root = visible[0]!;
  const glyphs = (root.children as Sprite[]).filter((glyph) => glyph.visible);
  return {
    text: glyphs.map((glyph) => characters[glyph.texture.frame.x / 32]).join(""),
    tints: [...new Set(glyphs.map((glyph) => glyph.tint))],
    scale: root.scale.x,
    flipped: root.scale.y === -root.scale.x,
  };
};

describe("tower defense damage numbers", () => {
  const abilities = [
    undefined,
    { critChance: 0, damagePerTile: 0 },
    { critChance: 0.3, damagePerTile: 0.5 },
    { critChance: 1, damagePerTile: 2.75 },
    { critChance: 0.5, damagePerTile: 1 },
  ];
  const cases = [0, 1, 7, 99, 12345].flatMap((damage) =>
    targets.flatMap((target) =>
      abilities.flatMap((ability) =>
        [undefined, 0, 0.29, 0.3, 0.5, 0.99].map((critRoll) => ({
          damage,
          target,
          ability,
          critRoll,
        })),
      ),
    ),
  );

  it(`shows the landed damage and crit styling for ${cases.length} projectile and ability combinations`, async () => {
    const renderer = game();
    const effects = await createTowerDefenseEffects(renderer);
    const { grid } = prepareTowerDefenseTerrain("damage-numbers", 7, origin);
    let landed = 0;
    for (const [index, { damage, target, ability, critRoll }] of cases.entries()) {
      const projectile: TowerDefenseProjectile = {
        id: `shot-${index}`,
        abilityType: "shuriken",
        origin,
        target,
        progress: 0.5,
        damage,
        ...(critRoll === undefined ? {} : { critRoll }),
      };
      const fullAbility =
        ability &&
        ({
          id: "a",
          name: "A",
          damage,
          range: 3,
          cooldownMs: 0,
          ...ability,
        } as TowerDefenseAbility);
      effects.update(
        [projectile],
        [],
        grid,
        fullAbility,
        frame,
        undefined,
        vi.fn(),
        vi.fn(),
      );
      effects.update([], [], grid, fullAbility, frame, undefined, vi.fn(), vi.fn());
      const expected = reference(projectile, fullAbility);
      const actual = shown(effects);
      expect(actual.text).toBe(expected.text);
      expect(actual.tints).toEqual([expected.critical ? 0xff4444 : 0xffffff]);
      expect(actual.scale).toBeCloseTo(
        ((TD_HEX_SIZE * 0.3) / 64) * (expected.critical ? 1 : 29 / 38),
      );
      expect(actual.flipped).toBe(true);
      if (expected.critical) landed++;
      // Free the pooled number for the next projectile.
      for (const root of effects.container.children[2]!.children) root.visible = false;
    }
    expect(effects.container.children[2]!.children).toHaveLength(
      TD_DAMAGE_NUMBER_POOL_SIZE,
    );
    // The grid includes both critical and ordinary hits.
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(cases.length);
  });
});
