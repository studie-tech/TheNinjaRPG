import { describe, expect, it } from "bun:test";
import { actionPointsAfterAction, getActionPointCost } from "@/libs/combat/actions";
import type { ElementName } from "@/drizzle/constants";
import type {
  CombatAction,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import type { ZodAllTags } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
} from "../../setup/combat";

const makeBattle = (effects: UserEffect[]): ReturnedBattle =>
  makeCompleteBattle({
    usersEffects: effects,
    usersState: [makeBattleUser("user-1", { actionPoints: 50 })],
  }) as ReturnedBattle;

const makeTimeDilation = (opts?: { elements?: ElementName[] }): UserEffect =>
  makeEffect(
    "timedilation",
    { power: 10, calculation: "static", rounds: 1, elements: opts?.elements },
    {
      creatorId: "user-2",
      targetId: "user-1",
      level: 1,
      createdRound: 1,
      actionId: "time-dilation",
    },
  );

const FIRE_DAMAGE = [{ type: "damage", elements: ["Fire"] }] as ZodAllTags[];

/** Expensive jutsu; element tags sit on the top-level `effects`, the embedded `data`, or both. */
const makeJutsuAction = (
  fields: Pick<CombatAction, "effects" | "data">,
): CombatAction =>
  makeCombatAction({
    id: "jutsu-1",
    name: "Expensive Jutsu",
    actionCostPerc: 60,
    ...fields,
  });

const makeUser = (): ReturnedUserState =>
  ({
    userId: "user-1",
    actionPoints: 50,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }) as unknown as ReturnedUserState;

describe("combat AP cost adjustments", () => {
  it("reduces jutsu AP cost when time dilation is active", () => {
    const battle = makeBattle([makeTimeDilation()]);
    const action = makeJutsuAction({
      effects: [],
      data: makeJutsu({ effects: FIRE_DAMAGE }),
    });

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });

  it("allows a discounted jutsu when the adjusted AP cost is affordable", () => {
    const battle = makeBattle([makeTimeDilation()]);
    const action = makeJutsuAction({
      effects: [],
      data: makeJutsu({ effects: FIRE_DAMAGE }),
    });
    const user = makeUser();

    const result = actionPointsAfterAction(user, battle, action);

    expect(result.apAvailableAfter).toBe(0);
    expect(result.canAct).toBe(true);
  });

  it("uses top-level action.effects for element-scoped time dilation when data is absent", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Fire"] })]);
    const action = makeJutsuAction({ effects: FIRE_DAMAGE, data: undefined });

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });

  it("does not apply element-scoped time dilation when action elements do not overlap", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Water"] })]);
    const action = makeJutsuAction({ effects: FIRE_DAMAGE, data: undefined });

    expect(getActionPointCost("user-1", battle, action)).toBe(60);
  });

  it("still matches elements from embedded jutsu data.effects", () => {
    const battle = makeBattle([makeTimeDilation({ elements: ["Fire"] })]);
    const action = makeJutsuAction({
      effects: [],
      data: makeJutsu({ effects: FIRE_DAMAGE }),
    });

    expect(getActionPointCost("user-1", battle, action)).toBe(50);
  });
});
