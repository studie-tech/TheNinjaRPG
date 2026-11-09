import { describe, expect, it } from "bun:test";
import { AttackMethods } from "@/drizzle/constants";
import { insertAction } from "@/libs/combat/actions";
import { getTargetTiles } from "@/libs/combat/targeting";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { getAffectedTiles, getBattleGrid } from "@/libs/combat/util";
import {
  DamageTag,
  JutsuValidator,
  JutsuValidatorRawSchema,
  MoveTag,
} from "@/validators/combat";
import { methodSizeSchema } from "@/validators/methodSize";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeJutsu,
} from "../../setup/combat";

const actor = () =>
  makeBattleUser("actor", { longitude: 0, latitude: 0, direction: "left" });
const setup = () => {
  const user = actor();
  const battle = makeCompleteBattle({
    width: 12,
    height: 10,
    createdAt: new Date(0),
    updatedAt: new Date(),
    usersState: [user],
    activeUserId: "actor",
    roundStartAt: new Date(),
  });
  const grid = getBattleGrid(20, battle as ReturnedBattle);
  const a = grid.getHex({ col: 0, row: 0 })!;
  const b = grid.getHex({ col: 3, row: 3 })!;
  const action = makeCombatAction({
    id: "expanded",
    name: "Expanded",
    target: "GROUND",
    range: 5,
    effects: [DamageTag.parse({ rounds: 2 })],
  });
  return { user, battle, grid, a, b, action };
};
const positions = (tiles: Iterable<{ col: number; row: number }>) =>
  [...tiles].map((tile) => `${tile.col},${tile.row}`).sort();

describe("method size", () => {
  it("expands each axis independently and clips the map", () => {
    const info = setup();
    const resolve = (x: number, y: number) =>
      getTargetTiles({ ...info, action: { ...info.action, methodSize: { x, y } } });
    expect(positions(resolve(1, 0))).toEqual(["2,3", "3,3", "4,3"]);
    expect(positions(resolve(0, 1))).toEqual(["3,2", "3,3", "3,4"]);
    expect(resolve(1, 1)).toHaveLength(9);
    const corner = getTargetTiles({
      ...info,
      b: info.a,
      action: { ...info.action, methodSize: { x: 1, y: 1 } },
    });
    expect(corner).toHaveLength(4);
    expect(corner).toContain(info.a);
  });
  it.each(AttackMethods.filter((method) => !["ALL", "COORDINATES"].includes(method)))(
    "preserves default %s and expands without duplicates",
    (method) => {
      const info = setup();
      const action = { ...info.action, method, range: 2 };
      const base = getTargetTiles({ ...info, action });
      expect(
        positions(
          getTargetTiles({
            ...info,
            action: { ...action, methodSize: { x: 0, y: 0 } },
          }),
        ),
      ).toEqual(positions(base));
      const expanded = getTargetTiles({
        ...info,
        action: { ...action, methodSize: { x: 1, y: 2 } },
      });
      expect(new Set(expanded).size).toBe(expanded.length);
      for (const tile of base) expect(expanded).toContain(tile);
      expect(expanded.length).toBeGreaterThan(base.length);
    },
  );
  it("uses the same expanded footprint for preview and accepted cast", () => {
    const info = setup();
    const action = { ...info.action, methodSize: { x: 1, y: 1 } };
    const preview = getTargetTiles({ ...info, action });
    const resolved = getAffectedTiles({
      ...info,
      action,
      users: info.battle.usersState,
      ground: [],
      userId: "actor",
      preview: true,
    });
    expect(positions(resolved.green)).toEqual(positions(preview));
    insertAction({
      battle: info.battle,
      grid: info.grid,
      action,
      actorId: "actor",
      longitude: info.b.col,
      latitude: info.b.row,
    });
    expect(
      positions(
        info.battle.groundEffects
          .filter((effect) => effect.type === "damage")
          .map((effect) => ({ col: effect.longitude, row: effect.latitude })),
      ),
    ).toEqual(positions(preview));
  });
  it.each([undefined, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])(
    "excludes the caster from spiral preview and accepted cast with size %j",
    (methodSize) => {
      const info = setup();
      const action: CombatAction = {
        ...info.action,
        method: "AOE_SPIRAL_SHOOT",
        methodSize,
      };
      const preview = getTargetTiles({ ...info, action });
      const resolved = getAffectedTiles({
        ...info,
        action,
        users: info.battle.usersState,
        ground: [],
        userId: "actor",
        preview: true,
      });
      expect(
        insertAction({
          battle: info.battle,
          grid: info.grid,
          action,
          actorId: "actor",
          longitude: info.b.col,
          latitude: info.b.row,
        }),
      ).toBe(true);
      const effects = info.battle.groundEffects.filter(
        (effect) => effect.type === "damage",
      );
      expect(preview.includes(info.a)).toBe(false);
      expect(resolved.green.has(info.a)).toBe(false);
      expect(
        effects.some(
          (effect) => effect.longitude === info.a.col && effect.latitude === info.a.row,
        ),
      ).toBe(false);
      expect(positions(resolved.green)).toEqual(positions(preview));
      expect(
        positions(
          effects.map((effect) => ({ col: effect.longitude, row: effect.latitude })),
        ),
      ).toEqual(positions(preview));
    },
  );
  it.each([
    { x: -1, y: 0 },
    { x: 0, y: 11 },
    { x: 0.5, y: 1 },
    { x: Infinity, y: 0 },
    { x: NaN, y: 0 },
  ])("rejects invalid expansion %j", (size) => {
    expect(methodSizeSchema.safeParse(size).success).toBe(false);
  });
  it("rejects expanded movement", () => {
    const draft = JutsuValidatorRawSchema.parse(
      makeJutsu({
        methodSize: { x: 1, y: 0 },
        target: "EMPTY_GROUND",
        jutsuType: "AI",
        actionCostPerc: 10,
        effects: [MoveTag.parse({})],
      }),
    );
    expect(JutsuValidator.safeParse(draft).success).toBe(false);
  });
});
