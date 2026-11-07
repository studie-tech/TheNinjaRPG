import { describe, expect, it } from "bun:test";
import { CREATOR_TRIAL_FORMS, CREATOR_USERNAME } from "@/drizzle/constants";
import { findSidebarOpponent } from "@/libs/combat/actions";
import { creatorTrialWaves, isCreator } from "@/libs/combat/creatorTrial";
import { advanceEncounterWave } from "@/libs/combat/encounters";
import { calcBattleResult, maskBattle } from "@/libs/combat/util";
import { makeCompleteBattle, makeUser } from "./helpers/battleScenario";

const form = (userId: string, longitude = 8, latitude = 4) =>
  makeUser({ userId, isAi: true, direction: "right", longitude, latitude });

/** A challenger facing the trial's current form, with later forms waiting. */
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
      creatorTrial: { creatorId: "creator", username: CREATOR_USERNAME },
      encounter: {
        wave: 1,
        waveStartedRound: 0,
        transformInPlace: true,
        pendingWaves: pending.map((id) => ({
          users: [form(id, 0, 0)],
          effects: [],
          delayRounds: 0,
        })),
      },
    },
  });

describe("creator trial", () => {
  it("fights every form in rank order, one at a time", () => {
    expect(creatorTrialWaves()).toEqual(
      CREATOR_TRIAL_FORMS.map(({ aiId }) => ({ aiIds: [aiId], delayRounds: 0 })),
    );
  });

  it("recognises only the creator's own account", () => {
    expect(isCreator({ username: CREATOR_USERNAME })).toBe(true);
    expect(isCreator({ username: CREATOR_USERNAME, isAi: true })).toBe(false);
    expect(isCreator({ username: "Someone else" })).toBe(false);
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
    expect(genin.transformation).toMatchObject({ fromUserId: "student", stage: 2 });
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
    ).toMatchObject({ fromUserId: "genin", stage: 3 });
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
      masked.usersState.find((user) => user.userId === "genin")?.transformation?.stage,
    ).toBe(2);
    expect(JSON.stringify(masked)).not.toContain("chunin");
    expect(masked.extraState.encounter).toEqual({ wave: 2 });
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
