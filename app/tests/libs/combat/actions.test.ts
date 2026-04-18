import { describe, expect, it, vi } from "vitest";

/** Keep AP helpers testable without loading the full combat graph (process, hex, Three). */
vi.mock("@/libs/combat/process", () => ({
  applyEffects: vi.fn(() => ({
    newBattle: {},
    actionEffects: [],
  })),
  checkFriendlyFire: vi.fn(() => true),
}));

vi.mock("@/libs/hexgrid", () => ({
  getPossibleActionTiles: vi.fn(() => new Set()),
  PathCalculator: vi.fn(),
}));

/** Avoid executing real db/env when transitive imports touch `@/server/db`. */
vi.mock("@/server/db", () => ({
  drizzleDB: {},
}));

import {
  actionPointsAfterAction,
  getActionPointCost,
} from "@/libs/combat/actions";
import type { ElementName } from "@/drizzle/constants";
import type { CombatAction, ReturnedBattle, ReturnedUserState, UserEffect } from "@/libs/combat/types";

const makeBattle = (effects: UserEffect[]): ReturnedBattle =>
  ({
    id: "battle-1",
    activeUserId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    roundStartAt: new Date("2026-01-01T00:00:00Z"),
    background: "default",
    width: 10,
    height: 10,
    battleType: "COMBAT",
    version: 1,
    round: 1,
    rewardScaling: 1,
    forceKeepPools: false,
    groundEffects: [],
    usersEffects: effects,
    usersState: [
      {
        userId: "user-1",
        actionPoints: 50,
        longitude: 0,
        latitude: 0,
      },
    ],
    extraState: {
      jutsus: {},
      jutsuReskins: {},
      items: {},
      bloodlines: {},
      villages: {},
      anbuSquads: {},
      keystoneItems: {},
      wars: {},
      aiProfiles: {},
      relations: {},
      clans: {},
      userQuests: {},
      completedQuests: {},
      questData: {},
      bounties: {},
      bountySignups: {},
    },
  }) as unknown as ReturnedBattle;

const makeTimeDilation = (opts?: { elements?: ElementName[] }): UserEffect =>
  ({
    id: "effect-1",
    creatorId: "user-2",
    targetId: "user-1",
    level: 1,
    isNew: false,
    castThisRound: false,
    createdRound: 1,
    power: 10,
    type: "timedilation",
    calculation: "static",
    direction: "offence",
    rounds: 1,
    longitude: 0,
    latitude: 0,
    barrierAbsorb: 0,
    actionId: "time-dilation",
    ...(opts?.elements && opts.elements.length > 0 ? { elements: opts.elements } : {}),
  }) as UserEffect;

const makeJutsuAction = (): CombatAction =>
  ({
    id: "jutsu-1",
    name: "Expensive Jutsu",
    image: "/jutsu.png",
    battleDescription: "test",
    type: "jutsu",
    target: "OTHER_USER",
    method: "SINGLE",
    range: 1,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 60,
    updatedAt: Date.now(),
    cooldown: 0,
    originalCooldown: 0,
    effects: [],
    data: {
      effects: [{ type: "damage", elements: ["Fire"] }],
    },
  }) as unknown as CombatAction;

/** Fire only on normalized top-level `effects` (no embedded `data.effects`). */
const makeJutsuFireTopLevelOnly = (): CombatAction =>
  ({
    id: "jutsu-1",
    name: "Expensive Jutsu",
    image: "/jutsu.png",
    battleDescription: "test",
    type: "jutsu",
    target: "OTHER_USER",
    method: "SINGLE",
    range: 1,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 60,
    updatedAt: Date.now(),
    cooldown: 0,
    originalCooldown: 0,
    effects: [{ type: "damage", elements: ["Fire"] }],
    data: undefined,
  }) as unknown as CombatAction;

const makeUser = (): ReturnedUserState =>
  ({
    userId: "user-1",
    actionPoints: 50,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }) as unknown as ReturnedUserState;

describe("combat AP cost adjustments", () => {
  it("reduces jutsu AP cost when time dilation is active", () => {
    const battle = makeBattle([makeTimeDilation()]);
    const action = makeJutsuAction();

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });

  it("allows a discounted jutsu when the adjusted AP cost is affordable", () => {
    const battle = makeBattle([makeTimeDilation()]);
    const action = makeJutsuAction();
    const user = makeUser();

    const result = actionPointsAfterAction(user, battle, action);

    expect(result.apAvailableAfter).toBe(0);
    expect(result.canAct).toBe(true);
  });

  it("uses top-level action.effects for element-scoped time dilation when data is absent", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Fire"] })]);
    const action = makeJutsuFireTopLevelOnly();

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });

  it("does not apply element-scoped time dilation when action elements do not overlap", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Water"] })]);
    const action = makeJutsuFireTopLevelOnly();

    expect(getActionPointCost("user-1", battle, action)).toBe(60);
  });

  it("still matches elements from embedded jutsu data.effects", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Fire"] })]);
    const action = makeJutsuAction();

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });
});
