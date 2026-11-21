import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { availableUserActions } from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import { maskBattle } from "@/libs/combat/masking";
import { TerrainHex } from "@/libs/hexgrid";
import { ActionWithEffectHighestPower } from "@/validators/ai";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
  makeTag,
} from "../../setup/combat";

const fixture = () => {
  const jutsu = makeJutsu({
    id: "replacement",
    name: "Replacement Strike",
    battleDescription: "%user strikes %target",
    jutsuType: "AI",
    range: 3,
    target: "OTHER_USER",
    actionCostPerc: 40,
    chakraCost: 20,
    cooldown: 3,
    effects: [makeTag("damage", { power: 5, calculation: "formula" })],
  });
  const actor = makeBattleUser("actor", {
    isAi: true,
    rank: "STUDENT",
    basicAttackJutsuId: jutsu.id,
    longitude: 1,
    latitude: 1,
    aiProfileId: "profile",
    jutsus: [
      {
        id: "equipped",
        jutsuId: jutsu.id,
        equipped: true,
        level: 1,
        experience: 0,
        lastUsedRound: -10,
        originalCooldown: jutsu.cooldown,
        origin: "user",
      },
    ],
  });
  const opponent = makeBattleUser("opponent", {
    direction: "left",
    longitude: 2,
    latitude: 1,
  });
  const battle = makeCompleteBattle({
    createdAt: new Date(0),
    round: 1,
    width: 6,
    height: 6,
    battleType: "ARENA",
    activeUserId: actor.userId,
    usersState: [actor, opponent],
    extraState: {
      jutsus: { [jutsu.id]: jutsu },
      aiProfiles: {
        profile: {
          id: "profile",
          userId: actor.userId,
          jutsuLoadoutId: null,
          includeDefaultRules: false,
          rules: [
            {
              conditions: [],
              action: ActionWithEffectHighestPower.parse({
                effect: "damage",
                target: "CLOSEST_OPPONENT",
              }),
            },
          ],
        },
      },
    },
  });
  return { jutsu, actor, opponent, battle };
};

describe("AI Basic Attack Replacement", () => {
  it("exposes one equipped Jutsu with its authored mechanics and no Basic Attack", () => {
    const { actor, jutsu, battle } = fixture();
    const actions = availableUserActions(battle, actor.userId);
    expect(actions.some((a) => a.id === "basicAttack")).toBe(false);
    expect(actions.filter((a) => a.id === jutsu.id)).toHaveLength(1);
    expect(actions.find((a) => a.id === jutsu.id)).toMatchObject({
      type: "jutsu",
      range: 3,
      actionCostPerc: 40,
      chakraCost: 20,
      cooldown: 3,
    });
  });

  it.each([null, undefined, "deleted"])(
    "keeps the standard attack for an unset or missing reference: %s",
    (id) => {
      const { actor, battle } = fixture();
      actor.basicAttackJutsuId = id as string | null;
      expect(
        availableUserActions(battle, actor.userId).some((a) => a.id === "basicAttack"),
      ).toBe(true);
    },
  );

  it("does not alter player auto combat or village duty copies", () => {
    const { actor, battle } = fixture();
    actor.isAi = false;
    actor.isAutoCombat = true;
    expect(
      availableUserActions(battle, actor.userId).some((a) => a.id === "basicAttack"),
    ).toBe(true);
    actor.isAi = true;
    actor.isVillageDutyCopy = true;
    expect(
      availableUserActions(battle, actor.userId).some((a) => a.id === "basicAttack"),
    ).toBe(true);
  });

  it("does not resurrect Basic Attack when the Jutsu is on cooldown or sealed", () => {
    const { actor, jutsu, battle } = fixture();
    actor.jutsus[0]!.lastUsedRound = battle.round;
    expect(
      availableUserActions(battle, actor.userId, true, true).some(
        (a) => a.id === jutsu.id || a.id === "basicAttack",
      ),
    ).toBe(false);
    actor.jutsus[0]!.lastUsedRound = -10;
    jutsu.elementClassification = "Fire";
    jutsu.actionCostPerc = 60;
    battle.usersEffects = [
      makeEffect("elementalseal", { rounds: 3 }, { targetId: actor.userId }),
    ];
    expect(
      availableUserActions(battle, actor.userId).some(
        (a) => a.id === jutsu.id || a.id === "basicAttack",
      ),
    ).toBe(false);
    // The move/end-turn fallback must not reintroduce Basic Attack either.
    expect(
      availableUserActions(battle, actor.userId, false).some(
        (a) => a.id === "basicAttack",
      ),
    ).toBe(false);
  });

  it("uses and charges the Jutsu through the AI's ordinary damage rule", () => {
    const { actor, jutsu, battle } = fixture();
    const grid = new Grid(TerrainHex, rectangle({ width: 6, height: 6 }));
    const result = performAIaction(battle, grid, actor.userId);
    expect(result.nextActionId).toBe(jutsu.id);
    const next = result.nextBattle.usersState.find((u) => u.userId === actor.userId)!;
    expect(next.actionPoints).toBe(actor.actionPoints - jutsu.actionCostPerc);
    expect(next.curChakra).toBeLessThan(actor.curChakra);
    expect(next.jutsus[0]?.lastUsedRound).toBe(battle.round);
  });

  it("chooses another legal action when the replacement is unaffordable", () => {
    const { actor, battle } = fixture();
    actor.actionPoints = 20;
    const grid = new Grid(TerrainHex, rectangle({ width: 6, height: 6 }));
    expect(performAIaction(battle, grid, actor.userId).nextActionId).toBe("wait");
  });

  it("ends the turn during replacement cooldown in snapshots without the ownership flag", () => {
    const { actor, opponent, battle } = fixture();
    expect(actor.hasBasicAttackReplacement).toBeUndefined();
    actor.jutsus[0]!.lastUsedRound = battle.round;
    const grid = new Grid(TerrainHex, rectangle({ width: 6, height: 6 }));
    const result = performAIaction(battle, grid, actor.userId);
    expect(result.nextActionId).toBe("wait");
    expect(result.nextBattle.usersState[0]?.curHealth).toBe(5000);
    expect(result.nextBattle.usersState[1]?.curHealth).toBe(opponent.curHealth);
    expect(result.aiDescriptions.join(" ")).not.toMatch(/give up/);
  });

  it("keeps controlled summons' client actions consistent without revealing the setting to opponents", () => {
    const { actor, jutsu, battle } = fixture();
    actor.controllerId = "player";
    actor.isSummon = true;
    actor.isPiloted = true;
    const controlled = maskBattle(battle, "player");
    expect(controlled.usersState[0]?.basicAttackJutsuId).toBe(jutsu.id);
    expect(availableUserActions(controlled, actor.userId).map((a) => a.id)).toEqual(
      availableUserActions(battle, actor.userId).map((a) => a.id),
    );
    expect(
      maskBattle(battle, "opponent").usersState[0]?.basicAttackJutsuId,
    ).toBeUndefined();
  });
});
