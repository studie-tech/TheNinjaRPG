import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { prepareVillageDutyDefender } from "@/libs/combat/initiation";
import { applyEffects } from "@/libs/combat/process";
import type { CombatQueryUser } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { calcLevelRequirements } from "@/libs/profile";
import { DamageTag } from "@/validators/combat";
import { makeCombatAction, makeCompleteBattle, makeEffect } from "../../setup/combat";
import { makeInitiationUser, preloadBattle } from "./helpers/preload";

describe("village duty barrier damage", () => {
  for (const battleType of ["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const) {
    it.each([0, 50])(
      `matches player damage in ${battleType} with a %d percent offence buff`,
      async (buff) => {
        const experience = calcLevelRequirements(50);
        // Spend exactly the level's experience above base stats, within player caps.
        const human = {
          ...makeInitiationUser({
            userId: "owner",
            villageId: "home",
            rank: "JONIN",
            level: 50,
            experience,
            offence: 10 + experience / 4,
            defence: 10 + experience / 4,
            strength: 10 + experience / 8,
            intelligence: 10 + experience / 8,
            willpower: 10 + experience / 8,
            speed: 10 + experience / 8,
            villageDutyVillageId: "home",
            villageDutyStartedAt: new Date("2026-11-09"),
          }),
          joinedVillageAt: new Date("2026-01-01"),
        };
        const copy = prepareVillageDutyDefender(
          human as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
          "home",
          "duty:opaque-1234",
        )!;
        expect(copy).toBeDefined();
        const results = [];
        for (const input of [human, copy]) {
          const loaded = await preloadBattle(
            [structuredClone(input) as unknown as CombatQueryUser],
            { battleType },
          );
          const actor = loaded.usersState[0]!;
          expect(actor.isOriginal).toBe(true);
          expect(actor.offence).toBe(human.offence);
          actor.longitude = 0;
          actor.latitude = 0;
          const barrierHealth = 100_000;
          const battle = makeCompleteBattle({
            battleType,
            createdAt: new Date(0),
            width: 5,
            height: 5,
            round: 2,
            usersState: loaded.usersState,
            extraState: loaded.extraState,
            groundEffects: [
              makeEffect(
                "barrier",
                {
                  power: 50,
                  powerPerLevel: 0,
                  rounds: 10,
                  absorbPercentage: 50,
                  curHealth: barrierHealth,
                  maxHealth: barrierHealth,
                },
                {
                  id: "barrier",
                  creatorId: "enemy",
                  longitude: 1,
                  latitude: 0,
                  isNew: false,
                  castThisRound: false,
                  createdRound: 0,
                  level: 0,
                },
              ),
            ],
            usersEffects: [
              makeEffect(
                "increasestat",
                {
                  power: buff,
                  powerPerLevel: 0,
                  rounds: 5,
                  statTypes: ["Ninjutsu"],
                  direction: "offence",
                  calculation: "percentage",
                },
                {
                  creatorId: actor.userId,
                  targetId: actor.userId,
                  targetType: "user",
                  isNew: false,
                  castThisRound: false,
                  createdRound: 0,
                },
              ),
            ],
          });
          const action = makeCombatAction({
            id: "aoe-jutsu",
            target: "OPPONENT",
            method: "AOE_CIRCLE_SPAWN",
            range: 3,
            level: 1,
            effects: [
              DamageTag.parse({
                statTypes: ["Ninjutsu"],
                generalTypes: ["Strength"],
                power: 100,
                powerPerLevel: 0,
              }),
            ],
          });
          expect(
            insertAction({
              battle,
              grid: getBattleGrid(20, battle),
              action,
              actorId: actor.userId,
              longitude: 1,
              latitude: 0,
            }),
          ).toBe(true);
          const { newBattle } = applyEffects(battle, actor.userId, action);
          expect(actor.offence).toBe(human.offence * (1 + buff / 100));
          const barrier = newBattle.groundEffects.find(
            (effect) => effect.id === "barrier",
          );
          if (!barrier || !("curHealth" in barrier)) throw new Error("Missing barrier");
          const damage = barrierHealth - barrier.curHealth;
          expect(damage).toBeGreaterThan(0);
          results.push(damage);
        }
        expect(results[1]).toBe(results[0]);
      },
    );
  }
});
