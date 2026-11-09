import { describe, expect, it } from "bun:test";
import { didKageChallengerWin, didUserTakeKageSeat } from "@/libs/combat/settlement";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describe("Kage challenge outcome", () => {
  it("does not treat the defending Kage's victory as a challenger win", () => {
    const challenger = makeBattleUser("challenger", {
      isAggressor: true,
      curHealth: 0,
    });
    const kage = makeBattleUser("kage", { isAggressor: false, curHealth: 100 });

    expect(didKageChallengerWin(challenger, kage)).toBe(false);
  });

  it("transfers the position only when the challenger survives", () => {
    const challenger = makeBattleUser("challenger", {
      isAggressor: true,
      curHealth: 100,
    });
    const kage = makeBattleUser("kage", { isAggressor: false, curHealth: 0 });

    expect(didKageChallengerWin(challenger, kage)).toBe(true);
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

    expect(didKageChallengerWin(defeatedChallenger, defeatedKage)).toBe(false);
    expect(didKageChallengerWin(fleeingChallenger, standingKage)).toBe(false);
  });
});

describe("Kage seat change after a challenge", () => {
  const kageBattle = (challengerHealth: number, kageHealth: number) =>
    makeCompleteBattle({
      battleType: "KAGE_PVP",
      usersState: [
        makeBattleUser("challenger", {
          isAggressor: true,
          villageId: "village-1",
          curHealth: challengerHealth,
        }),
        makeBattleUser("kage", {
          isAggressor: false,
          villageId: "village-1",
          curHealth: kageHealth,
        }),
      ],
    });

  it("seats a winning challenger, so only they lose an elder rank", () => {
    const battle = kageBattle(100, 0);

    expect(didUserTakeKageSeat(battle, "challenger")).toBe(true);
    expect(didUserTakeKageSeat(battle, "kage")).toBe(false);
  });

  it("keeps a losing challenger's rank", () => {
    const battle = kageBattle(0, 100);

    expect(didUserTakeKageSeat(battle, "challenger")).toBe(false);
    expect(didUserTakeKageSeat(battle, "kage")).toBe(false);
  });

  it("never seats a summon or a user outside a Kage challenge", () => {
    const withSummon = kageBattle(100, 0);
    withSummon.usersState.push(
      makeBattleUser("summon", {
        isAggressor: true,
        isSummon: true,
        villageId: "village-1",
      }),
    );
    const arena = { ...kageBattle(100, 0), battleType: "ARENA" as const };

    expect(didUserTakeKageSeat(withSummon, "summon")).toBe(false);
    expect(didUserTakeKageSeat(arena, "challenger")).toBe(false);
  });
});
