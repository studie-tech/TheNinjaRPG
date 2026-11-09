import { describe, expect, it } from "bun:test";
import type { RouterInputs } from "@/app/_trpc/client";
import { mergeBattleEntries } from "@/deltas/combat";
import type { BattleAction } from "@/drizzle/schema";

const entry = (version: number, userId = "me", actionId = "jutsu") =>
  ({
    id: `${version}`,
    battleId: "battle",
    battleVersion: version,
    battleRound: 1,
    userId,
    actionId,
  }) as BattleAction;
const input: RouterInputs["combat"]["getBattleEntries"] = {
  battleId: "battle",
  refreshKey: 3,
  limit: 3,
};
const previous = [entry(2), entry(1)];
const incoming = [entry(4, "other"), entry(3, "me", "wait")];

describe("mergeBattleEntries", () => {
  it.each([3, 1])("extends a complete page with limit %i", (limit) => {
    const result = mergeBattleEntries(
      previous.slice(0, limit),
      incoming,
      { ...input, limit },
      5,
    );
    expect(result?.map((row) => row.battleVersion)).toEqual([4, 3, 2].slice(0, limit));
    expect(previous.map((row) => row.battleVersion)).toEqual([2, 1]);
    expect(incoming.map((row) => row.battleVersion)).toEqual([4, 3]);
  });

  it.each([
    [undefined, incoming, input, 5],
    [[], incoming, input, 5],
    [[{ ...entry(2), battleId: "other" }, entry(1)], incoming, input, 5],
    [[], [entry(0)], { ...input, refreshKey: 0 }, 1],
    [[entry(1)], incoming, input, 5],
    [previous, incoming, { ...input, userFilter: "user" as const }, 5],
    [previous, incoming, { ...input, userFilter: "opponents" as const }, 5],
    [previous, incoming, { ...input, showBasicActions: false }, 5],
    [previous, [entry(4)], input, 5],
    [previous, [entry(3), entry(3)], input, 5],
    [previous, incoming, { ...input, battleId: "other-battle" }, 5],
    [previous, incoming, { ...input, offset: 5 }, 5],
    [[entry(3)], incoming, input, 5],
    [previous, [], input, 3],
  ])(
    "refetches on missing history, gaps, mismatched battles or pages",
    (old, delta, key, next) => {
      expect(mergeBattleEntries(old, delta, key, next)).toBeUndefined();
    },
  );

  it("can extend an empty, fully fetched history", () => {
    expect(mergeBattleEntries([], [entry(1)], { ...input, refreshKey: 1 }, 2)).toEqual([
      entry(1),
    ]);
  });

  it("repairs a claimed version from overlapping rows and ignores duplicate or older delivery", () => {
    const key = { ...input, refreshKey: 5 };
    const repaired = mergeBattleEntries([entry(3), entry(2)], [entry(4)], key, 5);
    expect(repaired?.map((row) => row.battleVersion)).toEqual([4, 3, 2]);
    expect(mergeBattleEntries(repaired, [entry(4)], key, 5)).toEqual(repaired);
    expect(mergeBattleEntries(repaired, [entry(1)], key, 2)).toEqual(repaired);
    expect(
      mergeBattleEntries([entry(2)], incoming, input, 5)?.map(
        (row) => row.battleVersion,
      ),
    ).toEqual([4, 3, 2]);
  });
});

it("extends a complete unversioned saved log and preserves newer committed rows", () => {
  const saved = { ...input, refreshKey: undefined };
  expect(
    mergeBattleEntries(previous, incoming, saved, 5)?.map((row) => row.battleVersion),
  ).toEqual([4, 3, 2]);
  expect(
    mergeBattleEntries([entry(6), entry(5), entry(4)], incoming, saved, 5)?.map(
      (row) => row.battleVersion,
    ),
  ).toEqual([6, 5, 4]);
  expect(mergeBattleEntries([entry(1)], [entry(4)], saved, 5)).toBeUndefined();
});
