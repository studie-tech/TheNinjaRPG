import { describe, expect, it } from "bun:test";
import { calcActiveUser } from "@/libs/combat/actions";
import { placeTutorialOpponentsNearby } from "@/libs/combat/tutorialPlacement";
import { oddQHexDistance } from "@/libs/hexgrid";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describe("tutorial-guided battles", () => {
  const timedOut = (tutorialGuided: boolean, activeUserId: string) => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("learner", { curHealth: 100 }),
        makeBattleUser("dummy", { curHealth: 100, isAi: true }),
      ],
      activeUserId,
      // Well past COMBAT_SECONDS.
      roundStartAt: new Date(Date.now() - 10 * 60 * 1000),
      updatedAt: new Date(),
      version: 1,
    });
    battle.extraState.tutorialGuided = tutorialGuided;
    return calcActiveUser(battle, "learner");
  };

  it("lets a learner take as long as they need on their own turn", () => {
    const result = timedOut(true, "learner");
    expect(result.isUntimedTurn).toBe(true);
    expect(result.actor.userId).toBe("learner");
  });

  it("still times out the opponent's turn and every turn of ordinary fights", () => {
    expect(timedOut(true, "dummy").actor.userId).toBe("learner");
    expect(timedOut(false, "learner").actor.userId).toBe("dummy");
  });

  it("reports the untimed turn of the learner a timed-out opponent hands over to", () => {
    expect(timedOut(true, "dummy").isUntimedTurn).toBe(true);
    expect(timedOut(false, "learner").isUntimedTurn).toBe(false);
  });
});

describe("placeTutorialOpponentsNearby", () => {
  it("moves AI opponents two hexes from the player, onto free tiles", () => {
    const users: Parameters<typeof placeTutorialOpponentsNearby>[0] = [
      { userId: "learner", isAi: false, direction: "left", longitude: 3, latitude: 3 },
      { userId: "dummy", isAi: true, direction: "right", longitude: 10, latitude: 4 },
      { userId: "second", isAi: true, direction: "right", longitude: 11, latitude: 2 },
    ];
    placeTutorialOpponentsNearby(users, ["learner"], 13, 7);
    const [learner, dummy, second] = users;
    expect(oddQHexDistance(3, 3, dummy!.longitude, dummy!.latitude)).toBe(2);
    expect(oddQHexDistance(3, 3, second!.longitude, second!.latitude)).toBe(2);
    expect(`${dummy!.longitude},${dummy!.latitude}`).not.toBe(
      `${second!.longitude},${second!.latitude}`,
    );
    expect(learner).toEqual({
      userId: "learner",
      isAi: false,
      direction: "left",
      longitude: 3,
      latitude: 3,
    });
  });

  it("leaves the field alone without a guided player", () => {
    const users = [
      {
        userId: "dummy",
        isAi: true,
        direction: "right" as const,
        longitude: 10,
        latitude: 4,
      },
    ];
    placeTutorialOpponentsNearby(users, ["learner"], 13, 7);
    expect(users[0]).toEqual({
      userId: "dummy",
      isAi: true,
      direction: "right",
      longitude: 10,
      latitude: 4,
    });
  });

  it("keeps a companion on the player's side and hidden templates at their spawn", () => {
    const users: Parameters<typeof placeTutorialOpponentsNearby>[0] = [
      { userId: "learner", isAi: false, direction: "left", longitude: 3, latitude: 3 },
      { userId: "companion", isAi: true, direction: "left", longitude: 1, latitude: 3 },
      {
        userId: "template",
        isAi: true,
        hidden: true,
        isSummonTemplate: true,
        direction: "right",
        longitude: 12,
        latitude: 6,
      },
      { userId: "dummy", isAi: true, direction: "right", longitude: 10, latitude: 4 },
    ];
    placeTutorialOpponentsNearby(users, ["learner"], 13, 7);
    const [, companion, template, dummy] = users;
    expect([companion!.longitude, companion!.latitude]).toEqual([1, 3]);
    expect([template!.longitude, template!.latitude]).toEqual([12, 6]);
    expect(oddQHexDistance(3, 3, dummy!.longitude, dummy!.latitude)).toBe(2);
  });
});
