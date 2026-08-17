import { describe, it, expect } from "vitest";
import { resolveControlledActorId } from "@/libs/combat/actions";

const mk = (userId: string, controllerId: string, isPiloted?: boolean) => ({
  userId,
  controllerId,
  isPiloted,
});

const battle = (
  activeUserId: string | null,
  usersState: ReturnType<typeof mk>[],
) => ({ activeUserId, usersState });

describe("resolveControlledActorId", () => {
  const me = "p1";
  const self = mk("p1", "p1");
  const mySummon = mk("s1", "p1", true);
  const myAiSummon = mk("s2", "p1", false);
  const otherSummon = mk("s3", "p2", true);

  it("returns my id on my own turn", () => {
    expect(resolveControlledActorId(battle("p1", [self, mySummon]), me)).toBe(
      "p1",
    );
  });

  it("returns my piloted summon's id on its turn", () => {
    expect(resolveControlledActorId(battle("s1", [self, mySummon]), me)).toBe(
      "s1",
    );
  });

  it("returns my id when my non-piloted summon is the active actor", () => {
    expect(resolveControlledActorId(battle("s2", [self, myAiSummon]), me)).toBe(
      "p1",
    );
  });

  it("returns my id when another player's piloted summon is active", () => {
    expect(
      resolveControlledActorId(battle("s3", [self, otherSummon]), me),
    ).toBe("p1");
  });

  it("returns my id when the battle is missing", () => {
    expect(resolveControlledActorId(undefined, me)).toBe("p1");
    expect(resolveControlledActorId(null, me)).toBe("p1");
  });
});
