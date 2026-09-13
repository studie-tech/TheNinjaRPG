import { describe, expect, it } from "vitest";
import type { RouterInputs } from "@/app/_trpc/client";
import type { BattleAction } from "@/drizzle/schema";
import { mergeBattleEntries } from "@/libs/combat/log";

const entry = (version: number, userId = "me", actionId = "jutsu") =>
  ({ id: `${version}`, battleId: "battle", battleVersion: version, battleRound: 1,
    userId, actionId }) as BattleAction;
const input: RouterInputs["combat"]["getBattleEntries"] = {
  battleId: "battle", refreshKey: 3, limit: 3,
};
const previous = [entry(2), entry(1)];
const incoming = [entry(4, "other"), entry(3, "me", "wait")];

describe("mergeBattleEntries", () => {
  it.each([
    [{}, [4, 3, 2]],
    [{ userFilter: "user" }, [3, 2, 1]],
    [{ userFilter: "opponents" }, [4]],
    [{ showBasicActions: false }, [4, 2, 1]],
    [{ userFilter: "user", showBasicActions: false }, [2, 1]],
    [{ limit: 1 }, [4]],
  ] as const)("preserves query filters and limits: %j", (filters, versions) => {
    const old = "userFilter" in filters && filters.userFilter === "opponents" ? [] : previous;
    const result = mergeBattleEntries(old, incoming, { ...input, ...filters }, 5, "me");
    expect(result?.map((row) => row.battleVersion)).toEqual(versions);
    expect(previous.map((row) => row.battleVersion)).toEqual([2, 1]);
    expect(incoming.map((row) => row.battleVersion)).toEqual([4, 3]);
  });

  it.each([
    [undefined, incoming, input, 5],
    [previous, [entry(4)], input, 5],
    [previous, [entry(3), entry(3)], input, 5],
    [previous, incoming, { ...input, battleId: "other-battle" }, 5],
    [previous, incoming, { ...input, offset: 5 }, 5],
    [previous, incoming, { ...input, refreshKey: undefined }, 5],
    [[entry(3)], incoming, input, 5],
    [previous, [], input, 3],
  ])("refetches on missing history, gaps, mismatched battles or pages", (old, delta, key, next) => {
    expect(mergeBattleEntries(old, delta, key, next, "me")).toBeUndefined();
  });

  it("can extend an empty, fully fetched history", () => {
    expect(mergeBattleEntries([], [entry(0)], { ...input, refreshKey: 0 }, 1, "me"))
      .toEqual([entry(0)]);
  });
});
