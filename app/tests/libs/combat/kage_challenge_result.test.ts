import { describe, expect, it } from "vitest";
import { didKageChallengerWin } from "@/libs/combat/kage";
import type { CompleteBattle } from "@/libs/combat/types";
import { makeBattleUser } from "./helpers/battleScenario";

describe("Kage challenge outcome", () => {
  const battle = (challenger: ReturnType<typeof makeBattleUser>, kage: ReturnType<typeof makeBattleUser>) =>
    ({ usersState: [challenger, kage], usersEffects: [] }) as unknown as CompleteBattle;

  it("does not treat the defending Kage's victory as a challenger win", () => {
    const challenger = makeBattleUser("challenger", {
      isAggressor: true,
      curHealth: 0,
    });
    const kage = makeBattleUser("kage", { isAggressor: false, curHealth: 100 });

    expect(didKageChallengerWin(battle(challenger, kage), challenger, kage)).toBe(
      false,
    );
  });

  it("transfers the position only when the challenger survives", () => {
    const challenger = makeBattleUser("challenger", {
      isAggressor: true,
      curHealth: 100,
    });
    const kage = makeBattleUser("kage", { isAggressor: false, curHealth: 0 });

    expect(didKageChallengerWin(battle(challenger, kage), challenger, kage)).toBe(
      true,
    );
  });

  it("does not count a draw or a fleeing challenger as a win", () => {
    const defeatedChallenger = makeBattleUser("challenger", {
      isAggressor: true,
      curHealth: 0,
    });
    const defeatedKage = makeBattleUser("kage", { curHealth: 0 });
    const fleeingChallenger = makeBattleUser("fleeing-challenger", {
      isAggressor: true,
      fledBattle: true,
    });
    const standingKage = makeBattleUser("standing-kage");

    expect(
      didKageChallengerWin(
        battle(defeatedChallenger, defeatedKage),
        defeatedChallenger,
        defeatedKage,
      ),
    ).toBe(false);
    expect(
      didKageChallengerWin(
        battle(fleeingChallenger, standingKage),
        fleeingChallenger,
        standingKage,
      ),
    ).toBe(false);
  });
});
