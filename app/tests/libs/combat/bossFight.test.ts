import { describe, expect, it } from "bun:test";
import {
  CREATOR_TRIAL_FORMS,
  ID_SFX_TRANSFORMATION_BURST,
  ID_SFX_TRANSFORMATION_SURGE,
} from "@/drizzle/constants";
import { findSidebarOpponent } from "@/libs/combat/actions";
import { bossFightEncounter } from "@/libs/combat/bossFight";
import { advanceEncounterWave, prepareEncounterWaves } from "@/libs/combat/encounters";
import { calcBattleResult, maskBattle } from "@/libs/combat/util";
import { bossArrivalSchema } from "@/validators/coop";
import { makeCompleteBattle, makeUser } from "./helpers/battleScenario";

const form = (userId: string, longitude = 8, latitude = 4) =>
  makeUser({ userId, isAi: true, direction: "right", longitude, latitude });

const arrival = (announce: string, tier = 1) => ({
  announce,
  log: `${announce} rises`,
  tier,
  color: 0x112233,
  glow: 0x445566,
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
  it("fights every form in order, one at a time, keeping each arrival", () => {
    const rising = arrival("SECOND");
    expect(
      bossFightEncounter([{ aiId: "first" }, { aiId: "second", arrival: rising }]),
    ).toEqual({
      targetIds: ["first", "second"],
      encounterWaves: [
        { aiIds: ["first"], delayRounds: 0 },
        { aiIds: ["second"], delayRounds: 0, arrival: rising },
      ],
    });
  });

  it("authors the creator's forms as a valid, escalating boss", () => {
    const [opening, ...later] = CREATOR_TRIAL_FORMS;
    expect("arrival" in opening).toBe(false);
    const tiers = later.map((form) => bossArrivalSchema.parse(form.arrival).tier);
    expect(tiers).toEqual([1, 2, 3, 4]);
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
      async () => ({
        usersState: [replies.shift()!],
        userEffects: [],
        extraState: {},
      }) as never,
    );

    const first = (opening as { usersState: typeof hero[] }).usersState[1]!;
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
      masked.usersState.find((user) => user.userId === "genin")?.transformation?.announce,
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
      expect.arrayContaining([ID_SFX_TRANSFORMATION_SURGE, ID_SFX_TRANSFORMATION_BURST]),
    );
  });

  it("shows the risen form beside the field, whatever the initiative order", () => {
    const battle = trial();
    const fallen = battle.usersState[1]!;
    fallen.curHealth = 0;
    fallen.initiative = 100;
    advanceEncounterWave(battle);

    expect(battle.usersState[0]?.userId).toBe("student");
    expect(findSidebarOpponent(battle.usersState, "hero")?.userId).toBe("genin");
  });

  it("stays on the form that just fell, not an earlier one, until the next rises", () => {
    const battle = trial();
    const student = battle.usersState[1]!;
    student.curHealth = 0;
    student.leftBattle = true;
    const fallen = form("genin");
    fallen.curHealth = 0;
    battle.usersState.push(fallen);

    expect(findSidebarOpponent(battle.usersState, "hero")?.userId).toBe("genin");
  });

  it("keeps the last opponent beside the field once everyone has left", () => {
    const battle = trial([]);
    battle.usersState[1]!.curHealth = 0;
    battle.usersState[1]!.leftBattle = true;

    expect(findSidebarOpponent(battle.usersState, "hero")?.userId).toBe("student");
  });
});
