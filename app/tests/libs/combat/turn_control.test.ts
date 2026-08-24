import { describe, it, expect } from "vitest";
import { getTurnControl } from "@/libs/combat/util";

describe("getTurnControl truth table", () => {
  const suid = "player1";

  it("human player I control -> user turn, not AI turn", () => {
    expect(
      getTurnControl(
        { isAi: false, isPiloted: false, controllerId: "player1" },
        suid,
      ),
    ).toEqual({ isUserTurn: true, isAITurn: false });
  });

  it("AI-driven actor -> AI turn, not user turn", () => {
    expect(
      getTurnControl(
        { isAi: true, isPiloted: false, controllerId: "ai_123" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: true });
  });

  it("AI (non-piloted) summon I control -> AI turn, not user turn", () => {
    expect(
      getTurnControl(
        { isAi: true, isPiloted: false, controllerId: "player1" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: true });
  });

  it("my piloted summon (isAi true, isPiloted true, mine) -> user turn, not AI turn", () => {
    expect(
      getTurnControl(
        { isAi: true, isPiloted: true, controllerId: "player1" },
        suid,
      ),
    ).toEqual({ isUserTurn: true, isAITurn: false });
  });

  it("another player's piloted summon -> neither my user turn nor AI turn", () => {
    expect(
      getTurnControl(
        { isAi: true, isPiloted: true, controllerId: "player2" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: false });
  });

  it("another human player's turn -> neither my user turn nor AI turn", () => {
    expect(
      getTurnControl(
        { isAi: false, isPiloted: false, controllerId: "player2" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: false });
  });

  it("my own actor on auto combat -> AI turn, not user turn", () => {
    expect(
      getTurnControl(
        { isAi: false, isPiloted: false, isAutoCombat: true, controllerId: "player1" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: true });
  });

  it("another human on auto combat -> AI turn, so any client may drive it", () => {
    expect(
      getTurnControl(
        { isAi: false, isPiloted: false, isAutoCombat: true, controllerId: "player2" },
        suid,
      ),
    ).toEqual({ isUserTurn: false, isAITurn: true });
  });
});
