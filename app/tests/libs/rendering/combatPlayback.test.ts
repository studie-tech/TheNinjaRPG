import { describe, expect, it } from "bun:test";
import type { ReturnedBattle } from "@/libs/combat/types";
import type { CombatPlaybackStep } from "@/libs/combat/playback";
import { createCombatPlayback } from "@/libs/rendering/scenes/combatPlayback";

const cue = (id: string) => ({ id, animation: "slash", longitude: 0, latitude: 0 });
const fighter = (health = 100, spriteAction?: ReturnType<typeof cue>) =>
  ({
    userId: "foe",
    longitude: 0,
    latitude: 0,
    curHealth: health,
    spriteAction,
  }) as never;
const battle = (version: number, overrides: Partial<ReturnedBattle> = {}) =>
  ({
    id: "battle",
    version,
    usersState: [fighter()],
    usersEffects: [],
    groundEffects: [],
    ...overrides,
  }) as unknown as ReturnedBattle;
const step = (version: number, users: object[] = []): CombatPlaybackStep =>
  ({
    version,
    actorId: "foe",
    userIds: ["foe"],
    users,
    addedEffectIds: [],
    removedEffectIds: [],
  }) as CombatPlaybackStep;
const idle = { instant: false, moving: false, cue: () => 1 };

describe("combat replay director", () => {
  it("presents an update immediately when nothing needs replaying", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(2);
    playback.receive(next);
    expect(playback.tick({ ...idle, now: 0 })).toBe(next);
    expect(playback.isPlaying()).toBe(false);
  });

  it("waits for the walk, then the strike frame, before revealing the hit", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(3, { usersState: [fighter(40, cue("a"))] });
    next.playback = [
      step(1, [{ userId: "foe", longitude: 2 }]),
      step(2, [{ userId: "foe", curHealth: 40, spriteAction: cue("a") }]),
    ];
    playback.receive(next);
    const shown = (input: Partial<typeof idle> & { now: number }) =>
      playback.tick({ ...idle, ...input }).usersState[0]!;

    expect(shown({ now: 0 }).longitude).toBe(2);
    expect(playback.logVersion()).toBe(1);
    // Still walking: the strike has not started.
    expect(shown({ now: 100, moving: true }).spriteAction).toBeUndefined();
    const windup = shown({ now: 200, cue: () => 0 });
    expect(windup.spriteAction?.id).toBe("a");
    expect(windup.curHealth).toBe(100);
    expect(playback.logVersion()).toBe(1);
    expect(shown({ now: 300, cue: () => 0.4 }).curHealth).toBe(100);
    expect(shown({ now: 400, cue: () => 0.5 }).curHealth).toBe(40);
    expect(playback.logVersion()).toBe(2);
    expect(playback.isPlaying()).toBe(true);
    playback.tick({ ...idle, now: 500 });
    playback.tick({ ...idle, now: 700 });
    expect(playback.presented()).toBe(next);
    expect(playback.isPlaying()).toBe(false);
    expect(playback.logVersion()).toBeUndefined();
  });

  it("queues a later response behind the actions still replaying", () => {
    const playback = createCombatPlayback(battle(1));
    const first = battle(2, { usersState: [fighter(100, cue("a"))] });
    first.playback = [step(1, [{ userId: "foe", spriteAction: cue("a") }])];
    const second = battle(3, {
      usersState: [{ ...(fighter() as object), longitude: 4 }] as never,
    });
    second.playback = [step(2, [{ userId: "foe", longitude: 4 }])];
    playback.receive(first);
    playback.tick({ ...idle, now: 0, cue: () => 0 });
    playback.receive(second);
    expect(
      playback.tick({ ...idle, now: 10, cue: () => 0 }).usersState[0]?.longitude,
    ).toBe(0);
    playback.tick({ ...idle, now: 20 });
    playback.tick({ ...idle, now: 200 });
    expect(playback.tick({ ...idle, now: 210 }).usersState[0]?.longitude).toBe(4);
  });

  it("skips to the live battle for reduced motion and hidden pages", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(2, { usersState: [fighter(40, cue("a"))] });
    next.playback = [step(1, [{ userId: "foe", spriteAction: cue("a") }])];
    playback.receive(next);
    playback.tick({ ...idle, now: 0, cue: () => 0 });
    expect(playback.tick({ ...idle, now: 1, instant: true })).toBe(next);
    expect(playback.isPlaying()).toBe(false);
  });

  it("restarts for a different battle and for older recovered versions", () => {
    const playback = createCombatPlayback(battle(5));
    const other = battle(1, { id: "other" });
    playback.receive(other);
    expect(playback.tick({ ...idle, now: 0 })).toBe(other);
  });

  it("refreshes an equal version in place without replaying", () => {
    const playback = createCombatPlayback(battle(2));
    const refetched = battle(2);
    playback.receive(refetched);
    expect(playback.tick({ ...idle, now: 0 })).toBe(refetched);
    expect(playback.isPlaying()).toBe(false);
  });

  it("lands a long authored clip's hit promptly, then lets the clip finish", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(2, { usersState: [fighter(40, cue("a"))] });
    next.playback = [
      step(1, [{ userId: "foe", curHealth: 40, spriteAction: cue("a") }]),
    ];
    playback.receive(next);
    playback.tick({ ...idle, now: 0, cue: () => 0 });
    expect(
      playback.tick({ ...idle, now: 100, cue: () => 0.05 }).usersState[0]?.curHealth,
    ).toBe(100);
    expect(
      playback.tick({ ...idle, now: 649, cue: () => 0.3 }).usersState[0]?.curHealth,
    ).toBe(100);
    expect(
      playback.tick({ ...idle, now: 650, cue: () => 0.31 }).usersState[0]?.curHealth,
    ).toBe(40);
    expect(playback.isPlaying()).toBe(true);
    playback.tick({ ...idle, now: 1000, cue: () => 0.8 });
    expect(playback.isPlaying()).toBe(true);
    playback.tick({ ...idle, now: 1300 });
    expect(playback.isPlaying()).toBe(false);
  });

  it("releases an action whose artwork never reports back", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(2, { usersState: [fighter(40, cue("a"))] });
    next.playback = [
      step(1, [{ userId: "foe", curHealth: 40, spriteAction: cue("a") }]),
    ];
    playback.receive(next);
    playback.tick({ ...idle, now: 0, cue: () => 0 });
    expect(playback.tick({ ...idle, now: 4000, cue: () => 0 })).toBe(next);
    expect(playback.isPlaying()).toBe(false);
  });

  it("drops the oldest actions from a long backlog", () => {
    const playback = createCombatPlayback(battle(1));
    const next = battle(21);
    next.playback = Array.from({ length: 20 }, (_, index) => step(index + 1));
    playback.receive(next);
    const seen = new Set<number>();
    for (let now = 0; now < 100; now++) {
      playback.tick({ ...idle, now });
      const version = playback.logVersion();
      if (version !== undefined) seen.add(version);
    }
    expect(seen.size).toBeLessThanOrEqual(8);
    expect(seen.has(20)).toBe(true);
    expect(playback.presented()).toBe(next);
  });
});
