import { describe, expect, it } from "bun:test";
import type { Bloodline } from "@/drizzle/schema";
import { performAIaction } from "@/libs/combat/ai_v2";
import { advanceEncounterWave } from "@/libs/combat/encounters";
import { maskBattle } from "@/libs/combat/masking";
import type { CompleteBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { dungeonBattleOutcome } from "@/libs/dungeon";
import { AiRule, type ZodAllAiAction } from "@/validators/ai";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
  makeTag,
  makeWeapon,
} from "../../setup/combat";
import { dungeonBattleState, encounterWaveState } from "../../setup/dungeon";

describe("AI action catalog isolation", () => {
  it.each(["end_turn", "use_specific_jutsu", "use_specific_item"] as const)(
    "%s reuses frozen definitions while isolating combat state",
    (type) => {
      const action = AiRule.parse({
        conditions: [],
        action: {
          type,
          jutsuId: "strike",
          itemId: "weapon-1",
          target: "CLOSEST_OPPONENT",
        },
      }).action;
      const battle = scenario(action);
      freezeCatalogs(battle);
      const before = structuredClone(battle);
      const result = run(battle);

      expect(result.nextActionId).toBe(
        type === "end_turn"
          ? "wait"
          : type === "use_specific_jutsu"
            ? "strike"
            : "weapon-1",
      );
      expect(result.nextBattle.extraState.jutsus).toBe(battle.extraState.jutsus);
      expect(result.nextBattle.extraState.items).toBe(battle.extraState.items);
      for (const key of sharedSnapshotKeys) {
        expect(result.nextBattle.extraState[key]).toBe(battle.extraState[key]);
      }
      expect(result.nextBattle.usersState).not.toBe(battle.usersState);
      expect(result.nextBattle.usersEffects).not.toBe(battle.usersEffects);
      expect(result.nextBattle.groundEffects).not.toBe(battle.groundEffects);
      expect(result.nextBattle.extraState.aiProfiles).toEqual(
        before.extraState.aiProfiles,
      );
      expect(result.nextBattle.extraState.aiProfiles).not.toBe(
        battle.extraState.aiProfiles,
      );
      expect(battle).toEqual(before);

      const actor = result.nextBattle.usersState[0]!;
      if (type === "end_turn") {
        expect(actor.actionPoints).toBe(0);
      } else {
        expect(result.nextBattle.usersState[1]!.curHealth).toBeLessThan(
          before.usersState[1]!.curHealth,
        );
        expect(result.nextBattle.extraState.revealedActions).toEqual({
          jutsuIds: type === "use_specific_jutsu" ? ["strike"] : [],
          itemIds: type === "use_specific_item" ? ["weapon-1"] : [],
        });
        if (type === "use_specific_jutsu") {
          expect(actor.jutsus[0]!.lastUsedRound).toBe(battle.round);
        } else {
          expect(actor.items[0]!.lastUsedRound).toBe(battle.round);
          expect(actor.items[0]!.durability).toBe(97);
        }
      }
    },
  );

  it("isolates summon templates and bloodline realization from the preceding battle", () => {
    const battle = scenario(
      AiRule.parse({
        conditions: [],
        action: {
          type: "use_specific_jutsu",
          jutsuId: "strike",
          target: "COORDINATE",
          coordinates: { longitude: 2, latitude: 2 },
        },
      }).action,
    );
    battle.extraState.jutsus.strike!.target = "EMPTY_GROUND";
    battle.extraState.jutsus.strike!.effects = [
      makeTag("summon", {
        aiId: "creature",
        aiHp: 1000,
        rounds: 3,
        power: 100,
      }),
    ];
    battle.extraState.bloodlines.creature = {
      id: "creature",
      effects: [makeTag("shield", { power: 100, rounds: 3 })],
    } as Bloodline;
    battle.usersState.push(
      makeBattleUser("template", {
        controllerId: "creature",
        isAi: true,
        isSummon: true,
        isSummonTemplate: true,
        hidden: true,
        curHealth: 0,
        bloodlineId: "creature",
        effects: [],
      }),
    );
    freezeCatalogs(battle);
    const before = structuredClone(battle);
    const { nextBattle, nextActionId } = run(battle);

    expect(nextActionId).toBe("strike");
    const summon = nextBattle.usersState.find((u) => u.summonSourceId === "creature");
    expect(summon).toBeDefined();
    expect(nextBattle.usersEffects).toContainEqual(
      expect.objectContaining({
        type: "shield",
        fromType: "bloodline",
        targetId: summon!.userId,
      }),
    );
    expect(nextBattle.extraState.bloodlines.creature!.effects[0]).toHaveProperty(
      "creatorId",
      summon!.userId,
    );
    expect(battle).toEqual(before);
  });

  it("keeps run state and future waves private and independent after an AI kill", () => {
    const battle = scenario(
      AiRule.parse({
        conditions: [],
        action: {
          type: "use_specific_jutsu",
          jutsuId: "strike",
          target: "CLOSEST_OPPONENT",
        },
      }).action,
    );
    battle.usersState[1]!.curHealth = 1;
    battle.extraState.dungeon = dungeonBattleState({
      lastActionRound: { opponent: 1 },
    });
    battle.extraState.encounter = encounterWaveState();
    battle.extraState.encounter.pendingWaves.push({
      users: [
        makeBattleUser("private-next-enemy", {
          isAi: true,
          direction: "right",
          longitude: 0,
          latitude: 0,
        }),
      ],
      effects: [
        makeEffect(
          "shield",
          { power: 10, rounds: 3 },
          { targetId: "private-next-enemy" },
        ),
      ],
      delayRounds: 0,
    });
    freezeCatalogs(battle);
    const before = structuredClone(battle);
    const { nextBattle, nextActionId } = run(battle);

    expect(nextActionId).toBe("strike");
    expect(nextBattle.usersState[1]!.curHealth).toBe(0);
    const masked = maskBattle(nextBattle, "actor");
    expect(masked.extraState.encounter).toEqual({ wave: 1 });
    expect(masked.extraState.dungeon).not.toHaveProperty("runState");
    expect(JSON.stringify(masked)).not.toContain("private-next-enemy");

    expect(advanceEncounterWave(nextBattle)).toBe(true);
    expect(nextBattle.extraState.encounter!.wave).toBe(2);
    expect(nextBattle.extraState.encounter!.pendingWaves).toHaveLength(0);
    expect(nextBattle.usersState.some((u) => u.userId === "private-next-enemy")).toBe(
      true,
    );
    expect(
      dungeonBattleOutcome(nextBattle, nextBattle.extraState.dungeon!.expiresAt),
    ).toBe("ended");
    nextBattle.extraState.dungeon!.runState.readyIds.push("actor");
    nextBattle.extraState.dungeon!.lastActionRound.actor = 2;
    expect(battle).toEqual(before);
  });
});

const scenario = (action: ZodAllAiAction): CompleteBattle => {
  const weapon = makeWeapon(
    { range: 10, cooldown: 2, preventBattleUsage: false },
    { calculation: "static", power: 100, powerPerLevel: 0 },
  );
  const strike = makeJutsu({
    id: "strike",
    jutsuType: "AI",
    range: 10,
    cooldown: 2,
    effects: weapon.effects,
  });
  return makeCompleteBattle({
    width: 8,
    height: 5,
    battleType: "QUEST",
    round: 1,
    activeUserId: "actor",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(0),
    usersState: [
      makeBattleUser("actor", {
        isAi: true,
        direction: "left",
        longitude: 1,
        latitude: 1,
        aiProfileId: "profile",
        jutsus: [
          {
            id: "owned-strike",
            jutsuId: "strike",
            equipped: true,
            level: 1,
            experience: 0,
            lastUsedRound: -2,
            originalCooldown: 2,
          },
        ],
        items: [makeBattleUserItem({ lastUsedRound: -2, originalCooldown: 2 })],
      }),
      makeBattleUser("opponent", {
        isAi: false,
        direction: "right",
        longitude: 3,
        latitude: 1,
      }),
    ],
    extraState: {
      jutsus: { strike },
      items: { "weapon-1": weapon },
      bloodlines: {},
      jutsuReskins: {},
      sageModes: {},
      villages: {},
      anbuSquads: {},
      clans: {},
      keystoneItems: {},
      wars: {},
      relations: {},
      userQuests: {},
      completedQuests: {},
      questData: {},
      bounties: {},
      bountySignups: {},
      settings: [],
      revealedActions: { jutsuIds: [], itemIds: [] },
      aiProfiles: {
        profile: {
          id: "profile",
          userId: "actor",
          includeDefaultRules: false,
          rules: [{ conditions: [], action }],
        },
      },
    },
  });
};

const run = (battle: CompleteBattle) =>
  performAIaction(battle, getBattleGrid(1, battle), "actor");

const freezeCatalogs = (battle: CompleteBattle) => {
  deepFreeze(battle.extraState.jutsus);
  deepFreeze(battle.extraState.items);
  for (const key of sharedSnapshotKeys) deepFreeze(battle.extraState[key]);
};

const sharedSnapshotKeys = [
  "userQuests",
  "completedQuests",
  "questData",
  "settings",
  "villages",
  "relations",
  "wars",
  "anbuSquads",
  "clans",
  "bounties",
  "bountySignups",
  "jutsuReskins",
] as const;

const deepFreeze = (value: unknown) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
};
