import { describe, expect, it } from "bun:test";
import { calcActiveUser } from "@/libs/combat/actions";
import type { BattleUserState } from "@/libs/combat/types";
import { makeCompleteBattle } from "../../setup/combat";

const mk = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x",
    controllerId: "x",
    isSummon: false,
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
    round: 0,
    ...over,
  }) as unknown as BattleUserState;

describe("calcActiveUser never selects a curHealth:0 template", () => {
  it("excludes the off-grid template from actor selection", () => {
    const player = mk({ userId: "p1", controllerId: "p1" });
    const enemy = mk({ userId: "e1", controllerId: "e1", isAi: true });
    // A template is non-live (curHealth: 0), so calcActiveUser must exclude it
    // from actor selection via its stillInBattle check — the hidden, off-grid
    // template is never picked as the active actor.
    const template = mk({
      userId: "tmpl",
      controllerId: "aiX",
      isSummon: true,
      isSummonTemplate: true,
      curHealth: 0,
    });
    const battle = makeCompleteBattle({
      usersState: [player, enemy, template],
      activeUserId: "p1",
      roundStartAt: new Date(0),
    });

    const { actor } = calcActiveUser(battle, "p1");
    expect(actor.userId).not.toBe("tmpl");
  });
});
