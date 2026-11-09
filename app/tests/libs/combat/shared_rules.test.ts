import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { TEMPORAL_AP_DELTA } from "@/drizzle/constants";
import { settlementWrites } from "@/libs/combat/database";
import { hasHumanOpponent, isHumanOpponent } from "@/libs/combat/participants";
import {
  applyPreventTag,
  isPreventEffect,
  markPassiveEffect,
  realizePassiveEffect,
  temporalShift,
} from "@/libs/combat/tags";
import type { UserEffect } from "@/libs/combat/types";
import { syncPoolAdjustments, wearBattleItem } from "@/libs/combat/util";
import type { PusherClient } from "@/libs/pusher";
import type { DrizzleClient } from "@/server/db";
import { PreventTagTypes } from "@/validators/combat";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeTag,
} from "../../setup/combat";

const target = () => makeBattleUser("defender");
const newCast = {
  creatorId: "attacker",
  targetId: "defender",
  targetType: "user" as const,
  fromType: "jutsu" as const,
  createdRound: 1,
  isNew: true,
  castThisRound: true,
};

afterEach(() => {
  spyOn(Math, "random").mockRestore();
});

describe("applyPreventTag", () => {
  it.each([...PreventTagTypes])("latches %s at full power on a passed roll", (type) => {
    spyOn(Math, "random").mockReturnValue(0);
    const effect = makeEffect(type, { power: 50, rounds: 3 }, newCast);
    expect(isPreventEffect(effect)).toBe(true);
    const info = applyPreventTag(effect as never, [], target());
    expect(effect.power).toBe(100);
    expect(effect.rounds).toBe(3);
    expect(info?.txt).toEndWith("for the next 3 rounds");
  });

  it.each([...PreventTagTypes])("ends a new %s on a failed roll", (type) => {
    spyOn(Math, "random").mockReturnValue(0.99);
    const effect = makeEffect(type, { power: 50, rounds: 3 }, newCast);
    const info = applyPreventTag(effect as never, [], target());
    expect(effect.power).toBe(50);
    expect(effect.rounds).toBe(0);
    expect(info?.color).toBe("blue");
  });

  it("keeps an ongoing prevent running on a failed roll", () => {
    spyOn(Math, "random").mockReturnValue(0.99);
    const effect = makeEffect(
      "stunprevent",
      { power: 50, rounds: 3 },
      {
        ...newCast,
        isNew: false,
        castThisRound: false,
      },
    );
    expect(applyPreventTag(effect as never, [], target())).toBeUndefined();
    expect(effect.rounds).toBe(3);
  });

  it("does not treat other statuses as prevent tags", () => {
    expect(isPreventEffect(makeEffect("stun", { rounds: 1 }, newCast))).toBe(false);
  });
});

describe("temporalShift", () => {
  it.each([
    ["timecompression", "time compression", "more", "red"],
    ["timedilation", "time dilation", "less", "blue"],
  ] as const)("announces %s", (type, label, change, color) => {
    spyOn(Math, "random").mockReturnValue(0);
    const effect = makeEffect(type, { power: 100, rounds: 3 }, newCast);
    expect(temporalShift(effect as never, [effect], target())).toEqual({
      txt: `defender is affected by ${label}, actions will cost ${TEMPORAL_AP_DELTA} ${change} AP [all jutsu]`,
      color,
    });
  });

  it.each([
    ["timecompression", "time compression"],
    ["timedilation", "time dilation"],
  ] as const)("rejects an overlapping %s", (type, label) => {
    const active = makeEffect(
      type,
      { power: 100, rounds: 3 },
      {
        ...newCast,
        isNew: false,
        castThisRound: false,
      },
    );
    const effect = makeEffect(
      type,
      { power: 100, rounds: 3 },
      { ...newCast, id: "new" },
    );
    expect(temporalShift(effect as never, [active, effect], target())?.txt).toBe(
      `defender already has ${label} active`,
    );
    expect(effect.rounds).toBe(0);
  });
});

describe("passive effects", () => {
  const user = makeBattleUser("attacker");
  const tag = () => makeTag("increasestat", { power: 5, rounds: 3 }) as UserEffect;

  it("realizes tags as already active on the realizing user by default", () => {
    const realized = realizePassiveEffect({
      tag: tag(),
      user,
      actionId: "skill-1",
      level: 2,
      fromType: "skill",
    });
    expect(realized).toMatchObject({
      isNew: false,
      castThisRound: false,
      targetId: "attacker",
      creatorId: "attacker",
      fromType: "skill",
      level: 2,
    });
  });

  it("forwards the round that dates the effect", () => {
    const realized = realizePassiveEffect({
      tag: tag(),
      user,
      targetId: "defender",
      actionId: "skill-1",
      level: 0,
      fromType: "sageMode",
      round: 7,
    });
    expect(realized.targetId).toBe("defender");
    expect(realized.createdRound).toBe(7);
  });

  it("marks an already realized tag in place", () => {
    const effect = makeEffect("increasestat", { rounds: 3 }, newCast);
    expect(markPassiveEffect(effect, "attacker", "skill")).toBe(effect);
    expect(effect).toMatchObject({
      isNew: false,
      castThisRound: false,
      targetId: "attacker",
      fromType: "skill",
    });
  });
});

describe("human opponents", () => {
  const user = { direction: "left" as const };
  const human = { direction: "right" as const, isAi: false, isSummon: false };

  it.each([
    [human, true],
    [{ ...human, isAi: true }, false],
    [{ ...human, isSummon: true }, false],
    [{ ...human, direction: "left" as const }, false],
  ])("classifies %j", (candidate, expected) => {
    expect(isHumanOpponent(user, candidate)).toBe(expected);
    expect(hasHumanOpponent([candidate], user)).toBe(expected);
  });
});

describe("wearBattleItem", () => {
  const armor = () => ({ durability: 200, equipped: "CHEST" as const });

  it("clamps to the item's maximum before wearing", () => {
    const worn = armor();
    wearBattleItem(makeCompleteBattle(), worn, { maxDurability: 100 }, 3);
    expect(worn.durability).toBe(97);
    expect(worn.equipped).toBe("CHEST");
  });

  it("unequips at the usability floor", () => {
    const worn = { durability: 1, equipped: "CHEST" as "CHEST" | "NONE" };
    wearBattleItem(makeCompleteBattle(), worn, { maxDurability: 100 }, 3);
    expect(worn).toEqual({ durability: 0, equipped: "NONE" });
  });

  it("leaves gear alone in battles without durability loss", () => {
    const worn = armor();
    const battle = makeCompleteBattle({ battleType: "SPARRING" });
    wearBattleItem(battle, worn, { maxDurability: 100 }, 3);
    expect(worn.durability).toBe(200);
  });
});

describe("syncPoolAdjustments", () => {
  it("reverses a tracked adjustment after its effect has gone", () => {
    const user = makeBattleUser("defender", { maxHealth: 1100, curHealth: 1100 });
    user._prevHealthAdj = 100;
    syncPoolAdjustments([user], []);
    expect(user._prevHealthAdj).toBeUndefined();
  });

  it("skips users with neither current nor tracked pool effects", () => {
    const user = makeBattleUser("defender", { maxHealth: 1100, curHealth: 1100 });
    syncPoolAdjustments([user], []);
    expect(user.maxHealth).toBe(1100);
  });
});

describe("settlementWrites", () => {
  const writes = (
    extraState: Record<string, unknown>,
    options: { battleOver?: boolean } = {},
  ) =>
    settlementWrites(
      {} as DrizzleClient,
      {} as PusherClient,
      makeCompleteBattle({
        usersState: [makeBattleUser("attacker")],
        extraState: extraState as never,
      }),
      null,
      "attacker",
      options.battleOver ?? false,
    );
  const allWrites = 7;

  it("runs every writer, with quest updates first", async () => {
    const list = writes({});
    expect(list).toHaveLength(allWrites);
    expect(await list[0]).toEqual({ updatedQuestIds: [] });
  });

  it.each(["dungeon", "hunting"])("leaves only updateUser for %s", (key) => {
    expect(writes({ [key]: {} })).toHaveLength(1);
  });

  it("skips the tournament write once the claim committed the outcome", () => {
    const list = writes({ tournamentGameId: "game" }, { battleOver: true });
    expect(list).toHaveLength(allWrites - 1);
  });
});
