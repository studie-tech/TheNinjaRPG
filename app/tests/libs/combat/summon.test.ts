import { describe, it, expect } from "vitest";
import {
  isSummonTemplate,
  isActiveSummon,
  isLiveSummon,
  spliceOrphanedSummons,
  summonsAllowedInBattle,
} from "@/libs/combat/summon";
import { maskBattle } from "@/libs/combat/util";
import type { Battle } from "@/drizzle/schema";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";

const mk = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x",
    controllerId: "x",
    isSummon: false,
    isSummonTemplate: false,
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
    ...over,
  }) as unknown as BattleUserState;

const noEffects: UserEffect[] = [];
const player = mk({ userId: "p1", controllerId: "p1" });

describe("isSummonTemplate / isActiveSummon", () => {
  it("flagged template -> template", () => {
    const t = mk({ userId: "t", controllerId: "aiX", isSummon: true, isSummonTemplate: true, curHealth: 0 });
    expect(isSummonTemplate(t, [player, t])).toBe(true);
    expect(isActiveSummon(t, [player, t])).toBe(false);
  });
  it("legacy template (no flag, curHealth 0, controller absent) -> template", () => {
    const t = mk({ userId: "t", controllerId: "aiX", isSummon: true, isSummonTemplate: undefined, curHealth: 0 });
    expect(isSummonTemplate(t, [player, t])).toBe(true);
  });
  it("spawned summon (alive, controller present) -> active", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, curHealth: 50 });
    expect(isSummonTemplate(s, [player, s])).toBe(false);
    expect(isActiveSummon(s, [player, s])).toBe(true);
  });
  it("dead spawned summon (curHealth 0, controller present) -> active, not template", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, curHealth: 0 });
    expect(isSummonTemplate(s, [player, s])).toBe(false);
    expect(isActiveSummon(s, [player, s])).toBe(true);
  });
  it("orphaned-live summon (controller absent, alive) -> active, not template", () => {
    const s = mk({ userId: "s", controllerId: "ghost", isSummon: true, curHealth: 50 });
    expect(isSummonTemplate(s, [player, s])).toBe(false);
    expect(isActiveSummon(s, [player, s])).toBe(true);
  });
  it("non-summon -> never template, never active", () => {
    expect(isSummonTemplate(player, [player])).toBe(false);
    expect(isActiveSummon(player, [player])).toBe(false);
  });
});

describe("isLiveSummon", () => {
  it("alive active summon with present controller is live", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, curHealth: 50 });
    expect(isLiveSummon(s, [player, s], noEffects)).toBe(true);
  });
  it("dead active summon is not live", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, curHealth: 0 });
    expect(isLiveSummon(s, [player, s], noEffects)).toBe(false);
  });
  it("left-battle summon is not live", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, curHealth: 50, leftBattle: true });
    expect(isLiveSummon(s, [player, s], noEffects)).toBe(false);
  });
});

describe("legacy fallback (no isSummonTemplate flag)", () => {
  it("classifies a flag-less curHealth-0 controller-less summon as a template", () => {
    const t = mk({ userId: "t", controllerId: "aiX", isSummon: true, isSummonTemplate: undefined, curHealth: 0 });
    expect(isSummonTemplate(t, [player, t])).toBe(true);
    expect(isActiveSummon(t, [player, t])).toBe(false);
  });
  it("still treats a flag-less alive summon with a present controller as active", () => {
    const s = mk({ userId: "s", controllerId: "p1", isSummon: true, isSummonTemplate: undefined, curHealth: 50 });
    expect(isActiveSummon(s, [player, s])).toBe(true);
  });
});

describe("isSummonTemplate is server-internal (stripped by masking)", () => {
  it("is absent from the masked public state of a non-controller viewer", () => {
    const summon = mk({ userId: "s1", controllerId: "p1", isSummon: true, isSummonTemplate: true, curHealth: 50 });
    const battle = { usersState: [summon] } as unknown as Battle;
    const masked = maskBattle(battle, "opponentX");
    expect("isSummonTemplate" in (masked.usersState[0] as object)).toBe(false);
  });
  it("is absent even from the controller's own (full) masked state", () => {
    // The controller gets allState (public+private); isSummonTemplate is in
    // neither list, so it must be stripped for them too.
    const summon = mk({ userId: "s1", controllerId: "p1", isSummon: true, isSummonTemplate: true, curHealth: 50 });
    const battle = { usersState: [summon] } as unknown as Battle;
    const masked = maskBattle(battle, "p1");
    expect("isSummonTemplate" in (masked.usersState[0] as object)).toBe(false);
  });
});

describe("spliceOrphanedSummons determinism", () => {
  it("classifies against a snapshot, not the mutating array", () => {
    // u1 (dead) controls s1; enemy alive; order puts the orphan before its
    // dead controller is removed — result must not depend on splice order.
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 0 }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
      mk({ userId: "enemy", controllerId: "enemy", curHealth: 100 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects).map((u) => u.userId);
    expect(removed).toEqual(["s1"]);
    expect(state.map((u) => u.userId)).toEqual(["u1", "enemy"]);
  });
});

describe("summonsAllowedInBattle", () => {
  it("allows summons in interactive battle types", () => {
    expect(summonsAllowedInBattle({ battleType: "COMBAT" })).toBe(true);
  });
  it("blocks summons in KAGE_AI (auto-resolved)", () => {
    expect(summonsAllowedInBattle({ battleType: "KAGE_AI" })).toBe(false);
  });
  it("blocks summons in CLAN_CHALLENGE (auto-resolved)", () => {
    expect(summonsAllowedInBattle({ battleType: "CLAN_CHALLENGE" })).toBe(false);
  });
});
