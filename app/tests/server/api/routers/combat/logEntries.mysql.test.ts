import { beforeEach, expect, it } from "bun:test";
import { battleAction } from "@/drizzle/schema";
import { AdjustableBasicActions } from "@/drizzle/constants";
import { combatRouter } from "@/server/api/routers/combat";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const actions = Array.from({ length: 240 }, (_, index) => ({
  id: `action-${index}`,
  battleId: "fight",
  battleVersion: index + 1,
  // Round is intentionally not monotonic with version: both ordering columns matter.
  battleRound: index % 17,
  userId: index % 2 ? "hero" : "opponent",
  actionId: ["strike", "wait", "flee", ...AdjustableBasicActions][
    index % (3 + AdjustableBasicActions.length)
  ]!,
  description: `Action ${index}.`,
  appliedEffects: [],
}));

describeWithDatabase("combat.getBattleEntries", () => {
  beforeEach(async () => {
    await resetTables(battleAction);
    const database = await getTestDatabase();
    await database
      .insert(battleAction)
      .values([
        ...actions,
        { ...actions[0]!, id: "other-battle", battleId: "other", battleRound: 999 },
      ]);
  });

  it("returns the default latest 30 actions in round/version order", async () => {
    const caller = await callerFor(combatRouter, "hero");
    const rows = await caller.getBattleEntries({ battleId: "fight" });
    expect(rows.map((row) => row.id)).toEqual(
      [...actions]
        .sort(
          (a, b) => b.battleRound - a.battleRound || b.battleVersion - a.battleVersion,
        )
        .slice(0, 30)
        .map((row) => row.id),
    );
  });

  for (const userFilter of ["all", "user", "opponents"] as const) {
    for (const showBasicActions of [true, false]) {
      it(`preserves filtered pagination (${userFilter}, basic=${showBasicActions})`, async () => {
        const caller = await callerFor(combatRouter, "hero");
        const basicActions: string[] = [...AdjustableBasicActions, "flee", "wait"];
        const expected = actions
          .filter(
            (action) =>
              (userFilter === "all" ||
                (userFilter === "user"
                  ? action.userId === "hero"
                  : action.userId !== "hero")) &&
              (showBasicActions || !basicActions.includes(action.actionId)),
          )
          .sort(
            (a, b) =>
              b.battleRound - a.battleRound || b.battleVersion - a.battleVersion,
          );
        const rows = await caller.getBattleEntries({
          battleId: "fight",
          userFilter,
          showBasicActions,
          limit: 15,
          offset: 15,
        });
        expect(rows.map((row) => row.id)).toEqual(
          expected.slice(15, 30).map((row) => row.id),
        );
      });
    }
  }
});
