import { describe, expect, it } from "bun:test";
import { publicState } from "@/libs/combat/constants";
import {
  buildPlaybackFrames,
  combatHits,
  createCombatPlaybackRecorder,
} from "@/libs/combat/playback";
import type { CompleteBattle, ReturnedBattle } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

const setup = () => {
  const hero = makeBattleUser("hero", { longitude: 0, latitude: 0, curHealth: 100 });
  const foe = makeBattleUser("foe", { longitude: 5, latitude: 0, curHealth: 100 });
  return makeCompleteBattle({
    version: 10,
    usersState: [hero, foe],
    usersEffects: [],
    groundEffects: [],
  });
};
const user = (battle: CompleteBattle | ReturnedBattle, id: string) =>
  battle.usersState.find((row) => row.userId === id)!;
const slash = { id: "cue", animation: "slash" as const, longitude: 0, latitude: 0 };
const asReturned = (battle: CompleteBattle) => battle as unknown as ReturnedBattle;

/** The AI walks to the hero, then strikes with an effect, in one committed response. */
const walkThenStrike = () => {
  const previous = setup();
  const before = structuredClone(previous);
  const recorder = createCombatPlaybackRecorder(previous);
  user(previous, "foe").longitude = 1;
  recorder.record(previous, 10, "foe");
  user(previous, "foe").spriteAction = slash;
  user(previous, "hero").curHealth = 60;
  previous.groundEffects = [{ id: "hit" } as CompleteBattle["groundEffects"][number]];
  recorder.record(previous, 11, "foe");
  const next = asReturned({ ...previous, version: 12 });
  next.playback = recorder.steps;
  return { previous: asReturned(before), next, steps: recorder.steps };
};

describe("combat playback recording", () => {
  it("stores only what each action changed, in order", () => {
    const { steps } = walkThenStrike();
    expect(steps.map(({ version, actorId }) => [version, actorId])).toEqual([
      [10, "foe"],
      [11, "foe"],
    ]);
    expect(steps[0]?.users).toEqual([{ userId: "foe", longitude: 1 }]);
    expect(steps[0]?.addedEffectIds).toEqual([]);
    expect(steps[1]?.users).toEqual([
      { userId: "hero", curHealth: 60 },
      { userId: "foe", spriteAction: slash },
    ]);
    expect(steps[1]?.addedEffectIds).toEqual(["hit"]);
  });

  it("does not report a cue as new when effects clone fighters between actions", () => {
    const state = setup();
    user(state, "foe").spriteAction = slash;
    user(state, "foe").spriteAnimationEvent = {
      id: "event",
      actionKey: "basic:attack",
    };
    const recorder = createCombatPlaybackRecorder(state);
    const cloned = structuredClone(state);
    user(cloned, "foe").curHealth = 90;
    recorder.record(cloned, 10, "foe");
    expect(recorder.steps[0]?.users).toEqual([{ userId: "foe", curHealth: 90 }]);
  });

  it("gives an idle action no wind-up from the cue before it", () => {
    const state = setup();
    user(state, "foe").spriteAction = slash;
    const before = structuredClone(state);
    const recorder = createCombatPlaybackRecorder(state);
    const cloned = structuredClone(state);
    user(cloned, "foe").curStamina -= 5;
    recorder.record(cloned, 10, "foe");
    const next = asReturned({ ...cloned, version: 11 });
    next.playback = recorder.steps;
    const [frame] = buildPlaybackFrames(asReturned(before), next);
    expect(frame?.windup).toBeUndefined();
    expect(frame?.cueId).toBeUndefined();
  });

  it("still reports a repeated attack with a new cue", () => {
    const state = setup();
    user(state, "foe").spriteAction = slash;
    const recorder = createCombatPlaybackRecorder(state);
    const cloned = structuredClone(state);
    user(cloned, "foe").spriteAction = { ...slash, id: "second-cue" };
    recorder.record(cloned, 10, "foe");
    expect(recorder.steps[0]?.users[0]?.spriteAction?.id).toBe("second-cue");
  });

  it("exposes only public fields, so every viewer can receive the same steps", () => {
    const { steps } = walkThenStrike();
    const allowed = new Set<string>([...publicState, "userId"]);
    for (const row of steps.flatMap((step) => step.users))
      for (const key of Object.keys(row)) expect(allowed.has(key)).toBe(true);
  });
});

describe("combat playback frames", () => {
  it("never shows a strike's damage or effect while its fighter is still walking", () => {
    const { previous, next } = walkThenStrike();
    const [walk, strike] = buildPlaybackFrames(previous, next);
    expect(user(walk!.battle, "foe").longitude).toBe(1);
    expect(user(walk!.battle, "hero").curHealth).toBe(100);
    expect(walk!.battle.groundEffects).toEqual([]);
    expect(walk!.windup).toBeUndefined();
    expect(strike!.windup && user(strike!.windup, "hero").curHealth).toBe(100);
    expect(strike!.windup && user(strike!.windup, "foe").spriteAction).toEqual(slash);
    expect(strike!.windup?.groundEffects).toEqual([]);
    expect(strike!.impact).toBe(0.5);
  });

  it("ends on the exact committed battle", () => {
    const { previous, next } = walkThenStrike();
    expect(buildPlaybackFrames(previous, next).at(-1)?.battle).toBe(next);
  });

  it("keeps removed effects visible until the action that removed them", () => {
    const { previous, next } = walkThenStrike();
    const shield = { id: "shield" } as ReturnedBattle["groundEffects"][number];
    previous.groundEffects = [shield];
    next.playback![1]!.removedEffectIds = ["shield"];
    const [walk, strike] = buildPlaybackFrames(previous, next);
    expect(walk!.battle.groundEffects).toEqual([shield]);
    expect(strike!.windup?.groundEffects).toEqual([shield]);
  });

  it("introduces arriving fighters on their own action", () => {
    const { previous, next } = walkThenStrike();
    const summon = makeBattleUser("summon");
    next.usersState = [...next.usersState, summon as never];
    next.playback![1]!.userIds = ["hero", "foe", "summon"];
    next.playback![0]!.userIds = ["hero", "foe"];
    const [walk, strike] = buildPlaybackFrames(previous, next);
    expect(walk!.battle.usersState.map((row) => row.userId)).toEqual(["hero", "foe"]);
    expect(strike!.battle.usersState.map((row) => row.userId)).toContain("summon");
  });

  it("lands single actions from sources without steps on their fighter's strike", () => {
    const { previous, next } = walkThenStrike();
    next.playback = undefined;
    const [strike, ...rest] = buildPlaybackFrames(previous, next);
    expect(rest).toEqual([]);
    expect(strike?.cueId).toBe("cue");
    expect(strike?.version).toBe(previous.version);
    expect(strike?.windup && user(strike.windup, "hero").curHealth).toBe(100);
    expect(strike?.battle).toBe(next);
  });

  it("joins an actor's consecutive steps into one walk and stops before its strike", () => {
    const previous = setup();
    const before = structuredClone(previous);
    const recorder = createCombatPlaybackRecorder(previous);
    for (const [version, longitude] of [
      [10, 4],
      [11, 3],
      [12, 2],
    ] as const) {
      user(previous, "foe").longitude = longitude;
      recorder.record(previous, version, "foe");
    }
    user(previous, "foe").spriteAction = slash;
    user(previous, "hero").curHealth = 60;
    recorder.record(previous, 13, "foe");
    const next = asReturned({ ...previous, version: 14 });
    next.playback = recorder.steps;
    const frames = buildPlaybackFrames(asReturned(before), next);
    expect(frames.map(({ version }) => version)).toEqual([12, 13]);
    expect(user(frames[0]!.battle, "foe").longitude).toBe(2);
    expect(user(frames[0]!.battle, "hero").curHealth).toBe(100);
    expect(frames[1]?.cueId).toBe("cue");
  });

  it("keeps walks apart when another fighter acts between them", () => {
    const previous = setup();
    const before = structuredClone(previous);
    const recorder = createCombatPlaybackRecorder(previous);
    user(previous, "foe").longitude = 4;
    recorder.record(previous, 10, "foe");
    user(previous, "hero").longitude = 1;
    recorder.record(previous, 11, "hero");
    user(previous, "foe").longitude = 3;
    recorder.record(previous, 12, "foe");
    const next = asReturned({ ...previous, version: 13 });
    next.playback = recorder.steps;
    expect(
      buildPlaybackFrames(asReturned(before), next).map(({ actorId }) => actorId),
    ).toEqual(["foe", "hero", "foe"]);
  });

  it("does not join a move that reveals something on the field", () => {
    const previous = setup();
    const before = structuredClone(previous);
    const recorder = createCombatPlaybackRecorder(previous);
    user(previous, "foe").longitude = 4;
    previous.groundEffects = [
      { id: "trap" } as CompleteBattle["groundEffects"][number],
    ];
    recorder.record(previous, 10, "foe");
    user(previous, "foe").longitude = 3;
    recorder.record(previous, 11, "foe");
    const next = asReturned({ ...previous, version: 12 });
    next.playback = recorder.steps;
    expect(buildPlaybackFrames(asReturned(before), next)).toHaveLength(2);
  });

  it("does not replay anything for updates without a new strike", () => {
    const { previous } = walkThenStrike();
    expect(buildPlaybackFrames(previous, { ...previous, version: 11 })).toEqual([]);
  });
});

describe("combat hits", () => {
  it("reports damage only at the frame the strike lands", () => {
    const { previous, next } = walkThenStrike();
    const [walk, strike] = buildPlaybackFrames(previous, next);
    expect(combatHits(previous, walk!.battle)).toEqual([]);
    expect(combatHits(walk!.battle, strike!.windup!)).toEqual([]);
    expect(combatHits(strike!.windup!, strike!.battle)).toEqual([
      expect.objectContaining({ userId: "hero", amount: -40 }),
    ]);
  });

  it("reports healing, ignores sub-point changes and arriving fighters", () => {
    const { previous } = walkThenStrike();
    const next = structuredClone(previous);
    next.usersState.find((row) => row.userId === "hero")!.curHealth = 150;
    next.usersState.find((row) => row.userId === "foe")!.curHealth = 100.3;
    next.usersState.push(makeBattleUser("summon") as never);
    expect(combatHits(previous, next)).toEqual([
      expect.objectContaining({ userId: "hero", amount: 50 }),
    ]);
  });

  it("does not repeat a hit when the same battle refreshes", () => {
    const { previous } = walkThenStrike();
    expect(combatHits(previous, structuredClone(previous))).toEqual([]);
  });

  it("measures an overkill as the health actually lost", () => {
    const { previous } = walkThenStrike();
    const next = structuredClone(previous);
    next.usersState.find((row) => row.userId === "hero")!.curHealth = -500;
    expect(combatHits(previous, next)).toEqual([
      expect.objectContaining({ userId: "hero", amount: -100, severity: "crushing" }),
    ]);
  });

  it.each([
    [10, 1000, "light"],
    [80, 1000, "heavy"],
    [250, 1000, "crushing"],
    [2000, 200000, "light"],
    [2000, 2500, "crushing"],
  ] as const)("grades %s of %s health as %s", (lost, max, severity) => {
    const { previous } = walkThenStrike();
    const hero = previous.usersState.find((row) => row.userId === "hero")!;
    hero.maxHealth = max;
    hero.curHealth = max;
    const next = structuredClone(previous);
    next.usersState.find((row) => row.userId === "hero")!.curHealth = max - lost;
    expect(combatHits(previous, next)[0]?.severity).toBe(severity);
  });

  it("treats any lethal blow as crushing, however little health was left", () => {
    const { previous } = walkThenStrike();
    const hero = previous.usersState.find((row) => row.userId === "hero")!;
    hero.maxHealth = 1000;
    hero.curHealth = 5;
    const next = structuredClone(previous);
    next.usersState.find((row) => row.userId === "hero")!.curHealth = 0;
    expect(combatHits(previous, next)[0]?.severity).toBe("crushing");
  });
});
