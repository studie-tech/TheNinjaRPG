import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { maskBattle } from "@/libs/combat/masking";
import {
  buildPlaybackFrames,
  createCombatPlaybackRecorder,
} from "@/libs/combat/playback";
import { applyEffects, expireGroundEffects } from "@/libs/combat/process";
import { getBattleGrid } from "@/libs/combat/util";
import { CloneTag, SummonTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
} from "../../setup/combat";
import { makeSpawnedSummon, makeSummonTemplate } from "./helpers/summon";

const castSpawn = (
  kind: "clone" | "summon",
  mode: "success" | "occupied" | "missing template" | "auto" | "capped" = "success",
) => {
  const battle = makeCompleteBattle({
    width: 12,
    height: 10,
    version: 1,
    round: 1,
    createdAt: new Date(0),
    battleType: mode === "auto" ? "KAGE_AI" : "COMBAT",
    usersState: [
      makeBattleUser("caster", { longitude: 0, latitude: 0 }),
      makeBattleUser("enemy", {
        direction: "right",
        longitude: mode === "occupied" ? 2 : 5,
        latitude: 0,
      }),
      ...(mode === "missing template"
        ? []
        : [{ ...makeSummonTemplate("template", "Creature"), effects: [] }]),
      ...(mode === "capped"
        ? [
            makeSpawnedSummon("existing", "template", {
              controllerId: "caster",
              longitude: 4,
            }),
          ]
        : []),
    ],
  });
  const tag = (kind === "clone" ? CloneTag : SummonTag).parse({
    rounds: 3,
    power: 50,
    aiId: "template",
    aiHp: 500,
    projectileAnimation: "bolt",
    appearAnimation: "burst",
    appearSfx: "arrival",
    appearSfxPrimary: true,
    ...(mode === "success"
      ? {
          staticAnimation: "aura",
          disappearAnimation: "exit",
          disappearSfx: "departure",
        }
      : {}),
  });
  const action = makeCombatAction({
    target: "EMPTY_GROUND",
    range: 3,
    level: 1,
    effects: [tag],
  });
  const previous = maskBattle(structuredClone(battle), "caster");
  const recorder = createCombatPlaybackRecorder(battle);
  const accepted = insertAction({
    battle,
    grid: getBattleGrid(20, battle),
    action,
    actorId: "caster",
    longitude: 2,
    latitude: 0,
  });
  const { newBattle, actionEffects } = applyEffects(battle, "caster", action);
  newBattle.version = 2;
  recorder.record(newBattle, 2, "caster", actionEffects);
  const next = maskBattle(newBattle, "caster");
  next.playback = recorder.steps;
  const frame = buildPlaybackFrames(previous, next)[0]!;
  const spawned = newBattle.usersState.find(
    (user) => user.isSummon && !user.isSummonTemplate && user.userId !== "existing",
  );
  const onsets = next.groundEffects.filter((effect) => effect.type === "visual");
  return { accepted, newBattle, next, frame, spawned, onsets };
};

describe("spawn playback through action processing", () => {
  it.each(["clone", "summon"] as const)(
    "launches an authored %s arrival from its caster",
    (kind) => {
      const { accepted, spawned, onsets, frame, newBattle, next } = castSpawn(kind);
      expect(accepted).toBe(true);
      expect(spawned).toBeDefined();
      expect(onsets).toHaveLength(1);
      expect(onsets[0]).toMatchObject({
        creatorId: "caster",
        longitude: 2,
        latitude: 0,
        projectileAnimation: "bolt",
        appearAnimation: "burst",
        appearSfx: "arrival",
        appearSfxPrimary: true,
      });
      expect(next.extraState.textureAssets).toContain("bolt");
      expect(next.extraState.textureAssets).toContain("burst");
      expect(next.extraState.sfxAssets).toContain("arrival");
      expect(frame.travel?.groundEffects).toHaveLength(1);
      expect(frame.travel?.groundEffects[0]).toMatchObject({
        ...onsets[0],
        projectileOnly: true,
      });
      expect(
        frame.travel?.usersState.some((user) => user.userId === spawned!.userId),
      ).toBe(false);
      expect(
        frame.battle.usersState.some((user) => user.userId === spawned!.userId),
      ).toBe(true);
      const gameplay = newBattle.groundEffects.find((effect) => effect.type === kind)!;
      expect(gameplay.creatorId).toBe(kind === "clone" ? spawned!.userId : "caster");
      expect(gameplay.isNew).toBe(false);
      expect(gameplay.appearAnimation).toBe("");
      expect(gameplay.appearSfx).toBe("");
      expect(gameplay.projectileAnimation).toBeUndefined();
      expect(gameplay.staticAnimation).toBe("aura");
      expect(gameplay.disappearAnimation).toBe("exit");
      expect(gameplay.disappearSfx).toBe("departure");

      expireGroundEffects(newBattle, []);
      const recorder = createCombatPlaybackRecorder(newBattle);
      const previous = maskBattle(structuredClone(newBattle), "caster");
      const later = applyEffects(newBattle, "enemy").newBattle;
      later.version = 3;
      recorder.record(later, 3, "enemy");
      const laterMasked = maskBattle(later, "caster");
      laterMasked.playback = recorder.steps;
      expect(buildPlaybackFrames(previous, laterMasked)[0]?.travel).toBeUndefined();
      expect(later.groundEffects.some((effect) => effect.type === "visual")).toBe(
        false,
      );
      expect(
        later.usersState.filter((user) => user.isSummon && !user.isSummonTemplate),
      ).toHaveLength(1);

      const active = later.groundEffects.find((effect) => effect.type === kind)!;
      active.rounds = 0;
      expireGroundEffects(later, []);
      expect(later.usersState.some((user) => user.userId === spawned!.userId)).toBe(
        false,
      );
      expect(later.usersState.some((user) => user.userId === "caster")).toBe(true);
      const exit = later.groundEffects.find((effect) => effect.type === "visual");
      expect(exit).toMatchObject({
        creatorId: kind === "clone" ? spawned!.userId : "caster",
        appearAnimation: "exit",
        appearSfx: "departure",
      });
      expect(exit?.projectileAnimation).toBeUndefined();
    },
  );

  it.each(["clone", "summon"] as const)(
    "leaves no presentation for an occupied %s destination",
    (kind) => {
      const { accepted, spawned, onsets, frame } = castSpawn(kind, "occupied");
      expect(accepted).toBe(false);
      expect(spawned).toBeUndefined();
      expect(onsets).toHaveLength(0);
      expect(frame.travel).toBeUndefined();
    },
  );

  it.each(["missing template", "auto", "capped"] as const)(
    "leaves no presentation for a rejected summon: %s",
    (mode) => {
      const { accepted, spawned, onsets, frame } = castSpawn("summon", mode);
      expect(accepted).toBe(true);
      expect(spawned).toBeUndefined();
      expect(onsets).toHaveLength(0);
      expect(frame.travel).toBeUndefined();
    },
  );
});
