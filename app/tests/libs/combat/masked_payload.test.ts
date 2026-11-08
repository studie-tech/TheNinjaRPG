import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Bloodline, Quest, UserQuest } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { maskBattle } from "@/libs/combat/masking";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

describe("masked battle payload", () => {
  afterEach(() => vi.restoreAllMocks());
  it("omits settlement records without mutating the authoritative battle or changing client actions", () => {
    vi.spyOn(Date, "now").mockReturnValue(1767225600000);
    const battle = makeCompleteBattle({
      usersState: [makeBattleUser("me"), makeBattleUser("opponent", {bloodlineId: "line"})],
      extraState: {
        userQuests: { me: [{ id: "quest", quest: { content: "x".repeat(10000) } } as unknown as UserQuest] },
        completedQuests: { me: [{ id: "completed", questId: "quest", completed: 1 }] },
        questData: { me: [] }, bounties: { me: [] }, bountySignups: { me: [] },
        sectorExclusiveRaids: [{ id: "raid" } as Quest],
        jutsus: {}, items: {},
        bloodlines: { line: { id: "line", name: "Visible bloodline", effects: [], bloodrightTiers: [{ id: "hidden-tier", hidden: true, description: "Secret catalog" }] } as unknown as Bloodline },
      },
    });
    Object.assign(battle.extraState, {textureAssets: ["texture"], sfxAssets: ["sound"]});
    const snapshot = structuredClone(battle);
    const masked = maskBattle(battle, "me");
    expect(masked.extraState.userQuests).toEqual({});
    expect(masked.extraState.completedQuests).toEqual({});
    expect(masked.extraState.sectorExclusiveRaids).toEqual([]);
    expect(masked.extraState.textureAssets).not.toContain("texture");
    expect(masked.extraState.jutsus).toEqual(battle.extraState.jutsus);
    expect(masked.extraState.bloodlines.line).toEqual<Pick<Bloodline, "id" | "name" | "effects">>({ id: "line", name: "Visible bloodline", effects: [] });
    expect(JSON.stringify(masked)).not.toContain("Secret catalog");
    expect(availableUserActions(masked, "me")).toEqual(availableUserActions(battle, "me"));
    expect(JSON.stringify(masked).length).toBeLessThan(JSON.stringify(battle).length - 10000);
    expect(battle).toEqual(snapshot);
  });
});
