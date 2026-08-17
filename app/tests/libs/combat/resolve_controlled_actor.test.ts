import { describe, it, expect } from "vitest";
import { resolveControlledActorId } from "@/libs/combat/util";
import { makeBattleUser } from "./helpers/battleScenario";
import type { BattleUserState, ReturnedBattle } from "@/libs/combat/types";

// isAi matters here: resolveControlledActorId projects getTurnControl, and a
// summon is isAi=true, so it only reaches the human action set when isPiloted
// is also true. That is the whole point of routing through one predicate.
const mk = (userId: string, controllerId: string, over: Partial<BattleUserState> = {}) =>
  makeBattleUser(userId, { controllerId, ...over });

const battle = (activeUserId: string | null, usersState: BattleUserState[]) =>
  ({ activeUserId, usersState }) as unknown as Pick<
    ReturnedBattle,
    "activeUserId" | "usersState"
  >;

describe("resolveControlledActorId", () => {
  const me = "p1";
  const self = mk("p1", "p1");
  const mySummon = mk("s1", "p1", { isAi: true, isSummon: true, isPiloted: true });
  const myAiSummon = mk("s2", "p1", { isAi: true, isSummon: true, isPiloted: false });
  const otherSummon = mk("s3", "p2", { isAi: true, isSummon: true, isPiloted: true });

  it("returns my id on my own turn", () => {
    expect(resolveControlledActorId(battle("p1", [self, mySummon]), me)).toBe("p1");
  });

  it("returns my piloted summon's id on its turn", () => {
    expect(resolveControlledActorId(battle("s1", [self, mySummon]), me)).toBe("s1");
  });

  it("returns my id when my non-piloted summon is the active actor", () => {
    expect(resolveControlledActorId(battle("s2", [self, myAiSummon]), me)).toBe("p1");
  });

  it("returns my id when another player's piloted summon is active", () => {
    expect(resolveControlledActorId(battle("s3", [self, otherSummon]), me)).toBe("p1");
  });

  it("returns my id when the active actor is not in usersState", () => {
    expect(resolveControlledActorId(battle("ghost", [self]), me)).toBe("p1");
  });

  it("returns my id when the battle is missing", () => {
    expect(resolveControlledActorId(undefined, me)).toBe("p1");
    expect(resolveControlledActorId(null, me)).toBe("p1");
  });

  it("returns undefined when there is no session user", () => {
    expect(resolveControlledActorId(battle("s1", [self, mySummon]), undefined)).toBe(
      undefined,
    );
  });
});
