import { describe, expect, it } from "bun:test";
import {
  BOSS_FIGHT_MAX_FORMS,
  ID_SFX_TRANSFORMATION_BURST,
  ID_SFX_TRANSFORMATION_SURGE,
} from "@/drizzle/constants";
import {
  bossChainIssue,
  bossFormsFrom,
  expandBossWaves,
  withBossForms,
} from "@/libs/combat/bossFight";
import { advanceEncounterWave, prepareEncounterWaves } from "@/libs/combat/encounters";
import { resolveCombatInspection } from "@/libs/combat/inspection";
import { maskBattle } from "@/libs/combat/masking";
import { calcBattleResult } from "@/libs/combat/settlement";
import { makeCompleteBattle, makeUser } from "../../setup/combat";

const form = (userId: string, longitude = 8, latitude = 4) =>
  makeUser({ userId, isAi: true, direction: "right", longitude, latitude });

const arrival = (announce: string, tier = 1) => ({
  announce,
  log: `${announce} rises`,
  tier,
  color: 0x112233,
  glow: 0x445566,
});

const link = (userId: string, nextAiId: string) => ({
  userId,
  nextAiId,
  ...arrival(nextAiId.toUpperCase()),
});

/** A challenger facing a boss's current form, with later forms waiting. */
const trial = (pending: string[] = ["genin", "chunin"]) =>
  makeCompleteBattle({
    battleType: "OVERWORLD",
    round: 1,
    width: 12,
    height: 10,
    usersState: [
      makeUser({ userId: "hero", controllerId: "hero", direction: "left" }),
      form("student"),
    ],
    extraState: {
      encounter: {
        wave: 1,
        waveStartedRound: 0,
        pendingWaves: pending.map((id, index) => ({
          users: [form(id, 0, 0)],
          effects: [],
          delayRounds: 0,
          arrival: arrival(id.toUpperCase(), index + 1),
        })),
      },
    },
  });

describe("boss fight", () => {
  it("turns a lone target that transforms into a boss fight, and leaves other fights as they are", () => {
    const links = [link("first", "second")];
    expect(withBossForms({ targetIds: ["first"] }, links)).toEqual({
      targetIds: ["first", "second"],
      waves: [
        { aiIds: ["first"], delayRounds: 0 },
        { aiIds: ["second"], delayRounds: 0, arrival: arrival("SECOND") },
      ],
    });
    const alone = { targetIds: ["alone"] };
    expect(withBossForms(alone, links)).toBe(alone);
    const pack = { targetIds: ["first", "guard"] };
    expect(withBossForms(pack, links)).toBe(pack);
    const authored = {
      targetIds: ["first"],
      waves: [{ aiIds: ["first"], delayRounds: 3 }],
    };
    expect(withBossForms(authored, links).targetIds).toEqual(["first", "second"]);
  });

  it("walks an AI's links into forms, stopping at the end, a loop or the form limit", () => {
    const links = [link("first", "second"), link("second", "third")];
    expect(bossFormsFrom("first", links).map((entry) => entry.aiId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(bossFormsFrom("first", links)[0]?.arrival).toBeUndefined();
    expect(bossFormsFrom("second", links)[1]?.arrival).toEqual(arrival("THIRD"));
    expect(bossFormsFrom("alone", links).map((entry) => entry.aiId)).toEqual(["alone"]);
    const loop = [link("first", "second"), link("second", "first")];
    expect(bossFormsFrom("first", loop)).toHaveLength(2);
    const long = Array.from({ length: 20 }, (_, i) => link(`f${i}`, `f${i + 1}`));
    expect(bossFormsFrom("f0", long)).toHaveLength(BOSS_FIGHT_MAX_FORMS);
  });

  it("brings a lone wave enemy's later forms into its encounter, leaving packs alone", () => {
    const links = [link("boss", "risen")];
    const pack = { aiIds: ["boss", "guard"], delayRounds: 0 };
    const lone = { aiIds: ["boss"], delayRounds: 2 };
    expect(expandBossWaves([pack, lone], links)).toEqual([
      pack,
      lone,
      { aiIds: ["risen"], delayRounds: 0, arrival: arrival("RISEN") },
    ]);
  });

  it("rejects a link that would break any chain it joins", () => {
    const links = [link("a", "b"), link("b", "c")];
    expect(bossChainIssue({ userId: "c", nextAiId: "d" }, links)).toBeUndefined();
    expect(bossChainIssue({ userId: "a", nextAiId: "a" }, links)).toContain("itself");
    expect(bossChainIssue({ userId: "c", nextAiId: "a" }, links)).toContain("loop");
    // Replacing a form's own link is judged without the link it replaces.
    expect(bossChainIssue({ userId: "b", nextAiId: "d" }, links)).toBeUndefined();
    const full = Array.from({ length: BOSS_FIGHT_MAX_FORMS - 1 }, (_, i) =>
      link(`f${i}`, `f${i + 1}`),
    );
    expect(
      bossChainIssue(
        { userId: `f${BOSS_FIGHT_MAX_FORMS - 1}`, nextAiId: "extra" },
        full,
      ),
    ).toContain(`${BOSS_FIGHT_MAX_FORMS} forms`);
  });

  it("tells each form whether another follows it, and leaves other enemies alone", async () => {
    const hero = makeUser({ userId: "hero", direction: "left" });
    const opening = {
      usersState: [hero, form("first")],
      userEffects: [],
      extraState: {},
    } as never;
    const second = form("second");
    const third = form("third");
    const plain = form("plain");
    const replies = [second, third, plain];
    const encounter = await prepareEncounterWaves(
      [
        { aiIds: ["first"], delayRounds: 0 },
        { aiIds: ["second"], delayRounds: 0, arrival: arrival("SECOND") },
        { aiIds: ["third"], delayRounds: 0, arrival: arrival("THIRD") },
        { aiIds: ["plain"], delayRounds: 0 },
      ],
      opening,
      async () =>
        ({
          usersState: [replies.shift()!],
          userEffects: [],
          extraState: {},
        }) as never,
    );

    const first = (opening as { usersState: (typeof hero)[] }).usersState[1]!;
    expect(hero.risesAgain).toBeUndefined();
    expect(first.risesAgain).toBe(true);
    expect(second.risesAgain).toBe(true);
    expect(third.risesAgain).toBeUndefined();
    expect(plain.risesAgain).toBeUndefined();
    expect(encounter.pendingWaves.map((wave) => wave.arrival?.announce)).toEqual([
      "SECOND",
      "THIRD",
      undefined,
    ]);
  });

  it("spawns an ordinary wave beside the fallen, with no transformation", () => {
    const battle = trial(["genin"]);
    delete battle.extraState.encounter!.pendingWaves[0]!.arrival;
    const fallen = battle.usersState[1]!;
    fallen.curHealth = 0;

    expect(advanceEncounterWave(battle)).toBe(true);

    const genin = battle.usersState.find((user) => user.userId === "genin")!;
    expect(genin.transformation).toBeUndefined();
    expect(fallen.leftBattle).toBeFalsy();
  });

  it("leaves a form standing until it falls", () => {
    const battle = trial();
    expect(advanceEncounterWave(battle)).toBe(false);
    expect(battle.usersState).toHaveLength(2);
  });

  it("raises the next form on the tile the last one fell on, leaving no remains", () => {
    const battle = trial();
    const fallen = battle.usersState[1]!;
    fallen.curHealth = 0;

    expect(advanceEncounterWave(battle)).toBe(true);

    const genin = battle.usersState.find((user) => user.userId === "genin")!;
    expect({ x: genin.longitude, y: genin.latitude }).toEqual({ x: 8, y: 4 });
    expect(genin.transformation).toMatchObject({
      ...arrival("GENIN"),
      fromUserId: "student",
    });
    expect(fallen.leftBattle).toBe(true);
    expect(battle.extraState.encounter?.wave).toBe(2);
  });

  it("chains from each form to the next, not from the first", () => {
    const battle = trial();
    battle.usersState[1]!.curHealth = 0;
    advanceEncounterWave(battle);
    battle.usersState.find((user) => user.userId === "genin")!.curHealth = 0;
    advanceEncounterWave(battle);
    expect(
      battle.usersState.find((user) => user.userId === "chunin")?.transformation,
    ).toMatchObject({ fromUserId: "genin", announce: "CHUNIN" });
  });

  it("moves the new form elsewhere when a fighter has taken the tile", () => {
    const battle = trial(["genin"]);
    battle.usersState[1]!.curHealth = 0;
    Object.assign(battle.usersState[0]!, { longitude: 8, latitude: 4 });
    advanceEncounterWave(battle);
    const genin = battle.usersState.find((user) => user.userId === "genin")!;
    expect({ x: genin.longitude, y: genin.latitude }).not.toEqual({ x: 8, y: 4 });
    expect(genin.transformation?.fromUserId).toBe("student");
  });

  it("ends only when the last form falls", () => {
    const battle = trial(["genin"]);
    battle.usersState[1]!.curHealth = 0;
    expect(calcBattleResult(battle, "hero")).toBeNull();
    advanceEncounterWave(battle);
    expect(calcBattleResult(battle, "hero")).toBeNull();
    battle.usersState.find((user) => user.userId === "genin")!.curHealth = 0;
    expect(advanceEncounterWave(battle)).toBe(false);
    expect(calcBattleResult(battle, "hero")?.outcome).toBe("Won");
  });

  it("shows clients the transformation cue, never the forms still to come", () => {
    const battle = trial();
    battle.usersState[1]!.curHealth = 0;
    advanceEncounterWave(battle);
    const masked = maskBattle(battle, "hero");
    expect(
      masked.usersState.find((user) => user.userId === "genin")?.transformation
        ?.announce,
    ).toBe("GENIN");
    expect(JSON.stringify(masked)).not.toContain("chunin");
    expect(masked.extraState.encounter).toEqual({ wave: 2 });
  });

  it("tells clients a fallen form rises again, and loads the transformation sounds", () => {
    const battle = trial();
    battle.usersState[1]!.risesAgain = true;
    const masked = maskBattle(battle, "hero");
    expect(
      masked.usersState.find((user) => user.userId === "student")?.risesAgain,
    ).toBe(true);
    expect(masked.extraState.sfxAssets).toEqual(
      expect.arrayContaining([
        ID_SFX_TRANSFORMATION_SURGE,
        ID_SFX_TRANSFORMATION_BURST,
      ]),
    );
  });

  it("shows the risen form beside the field, whatever the initiative order", () => {
    const battle = trial();
    const fallen = battle.usersState[1]!;
    fallen.curHealth = 0;
    fallen.initiative = 100;
    advanceEncounterWave(battle);

    expect(battle.usersState[0]?.userId).toBe("student");
    expect(resolveCombatInspection(battle, "hero", null)?.userId).toBe("genin");
  });

  it("stays on the form that just fell, not an earlier one, until the next rises", () => {
    const battle = trial();
    const student = battle.usersState[1]!;
    student.curHealth = 0;
    student.leftBattle = true;
    const fallen = form("genin");
    fallen.curHealth = 0;
    battle.usersState.push(fallen);

    expect(resolveCombatInspection(battle, "hero", null)?.userId).toBe("genin");
  });

  it("keeps the last opponent beside the field once everyone has left", () => {
    const battle = trial([]);
    battle.usersState[1]!.curHealth = 0;
    battle.usersState[1]!.leftBattle = true;

    expect(resolveCombatInspection(battle, "hero", null)?.userId).toBe("student");
  });
});
