import { describe, it, expect } from "vitest";
import { maskUsersState } from "@/libs/combat/util";
import type { BattleUserState } from "@/libs/combat/types";

const makeUser = (overrides: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "u1",
    username: "Tester",
    controllerId: "u1",
    isAi: false,
    isSummon: false,
    curHealth: 100,
    // minimal public fields touched by the masking copy; cast covers the rest
    ...overrides,
  }) as unknown as BattleUserState;

describe("maskUsersState isPiloted round-trip", () => {
  it("keeps isPiloted for the controller (full state)", () => {
    const summon = makeUser({
      userId: "summon1",
      controllerId: "player1",
      isAi: true,
      isSummon: true,
      isPiloted: true,
    });
    const [masked] = maskUsersState([summon], "player1");
    expect(masked?.isPiloted).toBe(true);
  });

  it("keeps isPiloted for an opponent (public state)", () => {
    const summon = makeUser({
      userId: "summon1",
      controllerId: "player1",
      isAi: true,
      isSummon: true,
      isPiloted: true,
    });
    const [masked] = maskUsersState([summon], "enemy1");
    expect(masked?.isPiloted).toBe(true);
  });

  it("leaves isPiloted undefined for a non-piloted user (self/full state)", () => {
    const human = makeUser({ userId: "player1", controllerId: "player1" });
    const [maskedSelf] = maskUsersState([human], "player1");
    expect(maskedSelf?.isPiloted).toBeUndefined();
  });

  it("leaves isPiloted undefined for a non-piloted user (opponent/public state)", () => {
    const human = makeUser({ userId: "player1", controllerId: "player1" });
    const [maskedOther] = maskUsersState([human], "enemy1");
    expect(maskedOther?.isPiloted).toBeUndefined();
  });
});
