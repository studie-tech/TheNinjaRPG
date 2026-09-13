import { afterEach, describe, expect, it, vi } from "vitest";
import type { Quest, UserQuest } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { maskBattle, maskBattleDynamic } from "@/libs/combat/util";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

describe("masked battle payload", () => {
  afterEach(() => vi.restoreAllMocks());
  it("omits settlement records without mutating the authoritative battle or changing client actions", () => {
    vi.spyOn(Date, "now").mockReturnValue(1767225600000);
    const battle = makeCompleteBattle({
      usersState: [makeBattleUser("me"), makeBattleUser("opponent")],
      extraState: {
        userQuests: { me: [{ id: "quest", quest: { content: "x".repeat(10000) } } as unknown as UserQuest] },
        completedQuests: { me: [{ id: "completed", questId: "quest", completed: 1 }] },
        questData: { me: [] }, bounties: { me: [] }, bountySignups: { me: [] },
        sectorExclusiveRaids: [{ id: "raid" } as Quest],
        textureAssets: ["texture"], sfxAssets: ["sound"], jutsus: {}, items: {},
      },
    });
    const snapshot = structuredClone(battle);
    const masked = maskBattle(battle, "me");
    expect(masked.extraState.userQuests).toEqual({});
    expect(masked.extraState.completedQuests).toEqual({});
    expect(masked.extraState.sectorExclusiveRaids).toEqual([]);
    expect(masked.extraState.textureAssets).toBe(battle.extraState.textureAssets);
    expect(masked.extraState.jutsus).toBe(battle.extraState.jutsus);
    expect(availableUserActions(masked, "me")).toEqual(availableUserActions(battle, "me"));
    expect(masked.usersState).toEqual(maskBattleDynamic(battle, "me").usersState);
    expect(JSON.stringify(masked).length).toBeLessThan(JSON.stringify(battle).length - 10000);
    expect(battle).toEqual(snapshot);
  });
});
