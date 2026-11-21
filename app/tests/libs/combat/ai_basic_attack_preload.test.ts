import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { availableUserActions } from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import { maskBattle } from "@/libs/combat/masking";
import { TerrainHex } from "@/libs/hexgrid";
import { ActionWithEffectHighestPower } from "@/validators/ai";
import { makeCompleteBattle, makeJutsu, makeTag } from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const replacement = makeJutsu({
  id: "replacement",
  jutsuType: "AI",
  battleUsageType: "PVP",
  effects: [makeTag("damage", { power: 5, calculation: "formula" })],
});
const alternative = makeJutsu({
  ...replacement,
  id: "alternative",
  battleUsageType: "BOTH",
  range: 3,
  target: "OTHER_USER",
});

const equipped = (jutsu: typeof replacement) => ({
  id: `owned-${jutsu.id}`,
  userId: "ai",
  jutsuId: jutsu.id,
  equipped: true,
  level: 1,
  experience: 0,
  jutsu,
});

describe("AI Basic Attack Replacement during battle initiation", () => {
  it.each(["cooldown", "battle usage"])(
    "ends the turn when its only replacement is unavailable through %s",
    async (unavailableThrough) => {
      const jutsu = makeJutsu({
        ...alternative,
        id: replacement.id,
        battleUsageType: unavailableThrough === "battle usage" ? "PVP" : "BOTH",
        cooldown: 3,
      });
      const prepared = await preloadBattle(
        [
          makeCombatQueryUser("ai", {
            isAi: true,
            rank: "STUDENT",
            basicAttackJutsuId: jutsu.id,
            jutsus: [equipped(jutsu)],
            aiProfile: {
              id: "profile",
              userId: "ai",
              jutsuLoadoutId: null,
              includeDefaultRules: true,
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
          }),
          makeCombatQueryUser("opponent"),
        ],
        { battleType: "QUEST" },
      );
      const actor = prepared.usersState[0]!;
      const opponent = prepared.usersState[1]!;
      Object.assign(actor, { longitude: 1, latitude: 1 });
      Object.assign(opponent, { longitude: 2, latitude: 1 });
      if (unavailableThrough === "cooldown") actor.jutsus[0]!.lastUsedRound = 1;
      const battle = makeCompleteBattle({
        createdAt: new Date(0),
        battleType: "QUEST",
        round: 2,
        width: 10,
        height: 10,
        activeUserId: actor.userId,
        usersState: prepared.usersState,
        usersEffects: prepared.userEffects,
        extraState: prepared.extraState,
      });
      expect(actor.hasBasicAttackReplacement).toBe(true);
      expect(
        availableUserActions(battle, actor.userId, true, true).map((a) => a.id),
      ).toEqual(["meditate", "move", "wait"]);

      const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
      const result = performAIaction(battle, grid, actor.userId);
      expect(result.nextActionId).toBe("wait");
      expect(result.aiDescriptions.join(" ")).not.toMatch(/give up/);
      expect(result.nextBattle.usersState[0]).toMatchObject({
        curHealth: actor.curHealth,
        curChakra: actor.curChakra,
        actionPoints: 0,
        usedActions: [{ id: "wait", type: "basic" }],
      });
      expect(result.nextBattle.usersState[1]?.curHealth).toBe(opponent.curHealth);
      if (unavailableThrough === "cooldown") {
        expect(result.nextBattle.usersState[0]?.jutsus[0]?.lastUsedRound).toBe(1);
      }
    },
  );

  it.each([false, true])(
    "keeps a use-gated replacement suppressed and chooses a legal Jutsu (summon: %s)",
    async (isSummon) => {
      const ai = makeCombatQueryUser("ai", {
        isAi: true,
        basicAttackJutsuId: replacement.id,
        jutsus: [equipped(replacement), equipped(alternative)],
        aiProfile: {
          id: "profile",
          userId: "ai",
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
      });
      const prepared = await preloadBattle([ai, makeCombatQueryUser("opponent")], {
        battleType: "QUEST",
        isSummon,
      });
      const actor = prepared.usersState[0]!;
      const opponent = prepared.usersState[1]!;
      Object.assign(actor, { longitude: 1, latitude: 1 });
      Object.assign(opponent, { longitude: 2, latitude: 1 });
      const battle = makeCompleteBattle({
        createdAt: new Date(0),
        battleType: "QUEST",
        round: 1,
        width: 10,
        height: 10,
        activeUserId: actor.userId,
        usersState: prepared.usersState,
        usersEffects: prepared.userEffects,
        extraState: prepared.extraState,
      });

      expect(actor.jutsus.map((owned) => owned.jutsuId)).toEqual([alternative.id]);
      expect(battle.extraState.jutsus[replacement.id]).toBeUndefined();
      const actionIds = availableUserActions(battle, actor.userId).map((a) => a.id);
      expect(actionIds).not.toContain("basicAttack");
      expect(actionIds).not.toContain(replacement.id);
      expect(actionIds).toContain(alternative.id);
      const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
      expect(performAIaction(battle, grid, actor.userId).nextActionId).toBe(
        alternative.id,
      );

      if (isSummon) {
        actor.controllerId = "player";
        actor.isPiloted = true;
        const controlled = maskBattle(battle, "player");
        expect(availableUserActions(controlled, actor.userId).map((a) => a.id)).toEqual(
          availableUserActions(battle, actor.userId).map((a) => a.id),
        );
        expect(
          maskBattle(battle, opponent.userId).usersState[0]?.hasBasicAttackReplacement,
        ).toBeUndefined();
      }

      // Reprocessing a frozen actor must not mistake its filtered record for deletion.
      const reprocessed = await preloadBattle(
        [makeCombatQueryUser("ai", { ...actor, jutsus: [] })],
        { battleType: "QUEST", isSummon },
      );
      const nextActor = reprocessed.usersState[0]!;
      expect(
        availableUserActions(
          makeCompleteBattle({
            battleType: "QUEST",
            usersState: reprocessed.usersState,
            usersEffects: reprocessed.userEffects,
            extraState: reprocessed.extraState,
          }),
          nextActor.userId,
        ).some((action) => action.id === "basicAttack"),
      ).toBe(false);
    },
  );

  it.each([null, "deleted"])(
    "retains the standard fallback when initiation has no replacement content: %s",
    async (basicAttackJutsuId) => {
      const prepared = await preloadBattle([
        makeCombatQueryUser("ai", { isAi: true, basicAttackJutsuId }),
      ]);
      const actor = prepared.usersState[0]!;
      const battle = makeCompleteBattle({
        usersState: prepared.usersState,
        usersEffects: prepared.userEffects,
        extraState: prepared.extraState,
      });
      expect(
        availableUserActions(battle, actor.userId).some(
          (action) => action.id === "basicAttack",
        ),
      ).toBe(true);
    },
  );
});
