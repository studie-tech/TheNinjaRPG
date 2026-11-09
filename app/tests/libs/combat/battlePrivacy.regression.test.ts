import { afterEach, describe, expect, it, vi } from "bun:test";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { AiProfile, Jutsu } from "@/drizzle/schema";
import { availableUserActions, calcActiveUser } from "@/libs/combat/actions";
import type { BattleWar, ReturnedBattle } from "@/libs/combat/types";
import { hasNoAvailableActions } from "@/libs/combat/turn";
import { maskBattle } from "@/libs/combat/masking";
import {
  flatCombatStats,
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeTag,
} from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const now = new Date("2026-10-11T12:00:00Z");

const battleWithPrivateAction = (isAi: boolean) =>
  makeCompleteBattle({
    usersState: [
      makeBattleUser("foe", {
        isAi,
        actionPoints: isAi ? 100 : 10,
        jutsus: [
          {
            id: "owned-attack",
            jutsuId: "attack",
            level: 1,
            experience: 0,
            equipped: true,
            lastUsedRound: -1,
            originalCooldown: 0,
          },
        ],
      }),
      makeBattleUser("me"),
    ],
    activeUserId: "foe",
    createdAt: now,
    roundStartAt: now,
    usersEffects: [
      makeEffect(
        "moveprevent",
        { power: 100, rounds: 3 },
        {
          creatorId: "me",
          targetId: "foe",
          isNew: false,
          castThisRound: false,
        },
      ),
    ],
    extraState: {
      jutsus: {
        attack: {
          id: "attack",
          name: "Attack",
          image: "/attack.png",
          effects: [],
          cooldown: 0,
          target: "OPPONENT",
          method: "SINGLE",
          range: 5,
          actionCostPerc: 10,
          healthCost: 0,
          chakraCost: 0,
          staminaCost: 0,
          healthCostReducePerLvl: 0,
          chakraCostReducePerLvl: 0,
          staminaCostReducePerLvl: 0,
          jutsuWeapon: "NONE",
          requiredMastery: 0,
          battleUsageType: "BOTH",
          battleDescription: "attack",
          elementClassification: "None",
        } as unknown as Jutsu,
      },
    },
  });

describe("battle privacy regressions", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["COMBAT", true, "Player", "Mercenary", IMG_AVATAR_DEFAULT],
    ["SHRINE_WAR", true, "Player", "Mercenary", IMG_AVATAR_DEFAULT],
    ["QUEST", true, "Player", "Player", "profile-avatar"],
    ["SPARRING", true, "Player", "Player", "profile-avatar"],
    ["RANKED_PVP", true, "Player", "Player", "profile-avatar"],
    ["HUNTING", true, "Player", "Player", "profile-avatar"],
    ["COMBAT", false, "Player", "ANBU Member", "squad-avatar"],
    ["COMBAT", false, "Mercenary", "ANBU Member", "squad-avatar"],
  ] as const)(
    "preserves %s anonymity for mercenary %s named %s",
    async (battleType, isMercenary, username, expectedName, expectedAvatar) => {
      const user = makeCombatQueryUser("fighter", {
        username,
        avatar: "profile-avatar",
        avatarLight: "profile-avatar",
        regenAt: now,
        bloodlineId: null,
        anbuId: "squad",
        anbuSquad: { id: "squad", image: "squad-avatar" },
      });
      const processed = await preloadBattle([user], {
        battleType,
        leftSideUserIds: ["attacker"],
        width: 13,
        height: 9,
        defaultProfile: { id: "Default" } as AiProfile,
        wars: [
          {
            id: "w",
            warMercenaries: isMercenary
              ? [{ userId: "fighter", sideVillageId: "a" }]
              : [],
          },
        ] as unknown as BattleWar[],
      });
      expect(processed.usersState[0]).toMatchObject({
        username: expectedName,
        avatar: expectedAvatar,
      });
      expect(processed.usersState[0]?.isMasked === true).toBe(
        expectedName === "Mercenary",
      );
    },
  );

  it("strips private stat metadata from realized public catalogs without mutating battle state", async () => {
    const authored = makeTag("increasedamagegiven", { power: 12 });
    const user = makeCombatQueryUser("foe", {
      ...flatCombatStats(100),
      villageId: "village",
      level: 50,
      regenAt: now,
      longitude: 0,
      latitude: 0,
      curHealth: 1000,
      maxHealth: 1000,
      curChakra: 1000,
      maxChakra: 1000,
      curStamina: 1000,
      maxStamina: 1000,
      speed: 70,
      intelligence: 80,
      willpower: 90,
      preferredGeneral1: "Speed",
      preferredGeneral2: "Willpower",
      bloodlineId: "line",
      cookingJobs: [
        {
          id: "pending-meal",
          userId: "foe",
          experience: 250,
          finishesAt: new Date(now.getTime() + 60000),
        },
      ],
      bloodline: {
        id: "line",
        name: "Visible bloodline",
        effects: [structuredClone(authored)],
        bloodrightTiers: [],
      },
      items: [
        {
          id: "keystone-row",
          userId: "foe",
          itemId: "keystone",
          equipped: "KEYSTONE",
          durability: 100,
          level: 1,
          quantity: 1,
          imbuements: [],
          dropChancePerc: 0,
          item: {
            id: "keystone",
            name: "Visible keystone",
            itemType: "KEYSTONE",
            maxDurability: 100,
            bloodlineId: null,
            canBeImbued: false,
            battleUsageType: "BOTH",
            cooldown: 0,
            effects: [structuredClone(authored)],
          },
        },
      ],
    });
    const processed = await preloadBattle([user]);
    // A selected item can share the passive template stored in keystoneItems.
    expect(processed.usersState[0]).not.toHaveProperty("cookingJobs");
    expect(user.cookingJobs).toHaveLength(1);
    processed.extraState.revealedActions = { itemIds: ["keystone"], jutsuIds: [] };
    const battle = makeCompleteBattle({
      usersState: processed.usersState,
      usersEffects: processed.userEffects,
      extraState: processed.extraState,
    });
    expect(battle.extraState.bloodlines.line?.effects[0]).toMatchObject({
      highestGenerals: ["speed", "willpower"],
    });
    expect(battle.extraState.items.keystone?.effects[0]).toMatchObject({
      highestGenerals: ["speed", "willpower"],
    });
    for (const definition of [
      battle.extraState.bloodlines.line,
      battle.extraState.items.keystone,
      battle.extraState.keystoneItems.keystone,
    ]) {
      Object.assign(definition!.effects[0]!, {
        targetHighestGenerals: ["speed", "willpower"],
      });
    }
    const before = structuredClone(battle);
    for (const viewer of ["me", "spectator"]) {
      const response = maskBattle(battle, viewer);
      const catalogs = [
        response.extraState.bloodlines.line,
        response.extraState.items.keystone,
        response.extraState.keystoneItems.keystone,
      ];
      for (const definition of catalogs) {
        expect(definition?.effects).toHaveLength(1);
        expect(definition?.effects[0]).toMatchObject(authored);
        expect(definition?.effects[0]).not.toHaveProperty("highestGenerals");
        expect(definition?.effects[0]).not.toHaveProperty("targetHighestGenerals");
      }
    }
    expect(battle).toEqual(before);
  });

  for (const isAi of [false, true]) {
    it(`keeps an immobilized ${isAi ? "AI" : "human"} active when its private action is hidden`, () => {
      vi.spyOn(Date, "now").mockReturnValue(now.getTime());
      const battle = battleWithPrivateAction(isAi);
      expect(hasNoAvailableActions(battle, "foe")).toBe(false);
      expect(calcActiveUser(battle, "me").actor.userId).toBe("foe");
      const response = maskBattle(battle, "me");
      expect(response.extraState.jutsus).not.toHaveProperty("attack");
      expect(hasNoAvailableActions(response, "foe")).toBe(false);
      expect(calcActiveUser(response, "me").actor.userId).toBe("foe");
      // CombatTimeline asks for public actors' actions and fills missing jutsus with [].
      availableUserActions(response, "foe");
      expect(response.usersState[0]?.jutsus).toEqual([]);
      expect(hasNoAvailableActions(response, "foe")).toBe(false);
      expect(calcActiveUser(response, "me").actor.userId).toBe("foe");
    });
  }

  for (const field of ["jutsus", "items"] as const) {
    it(`treats a living actor with missing ${field} as potentially actionable`, () => {
      const battle = battleWithPrivateAction(false) as ReturnedBattle;
      const actor = battle.usersState[0]!;
      actor.actionPoints = 0;
      delete actor[field];
      expect(hasNoAvailableActions(battle, "foe")).toBe(false);
    });
  }

  it("still advances exhausted controlled actors and authoritative actors with full loadouts", () => {
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    for (const isAi of [false, true]) {
      const battle = battleWithPrivateAction(isAi);
      battle.usersState[0]!.actionPoints = 0;
      for (const response of [battle, maskBattle(battle, "foe")]) {
        expect(hasNoAvailableActions(response, "foe")).toBe(true);
        expect(calcActiveUser(response, "foe").actor.userId).toBe("me");
      }
    }
  });

  it("still treats dead, fled and departed actors with hidden loadouts as exhausted", () => {
    for (const overrides of [
      { curHealth: 0 },
      { fledBattle: true },
      { leftBattle: true },
    ]) {
      const battle = battleWithPrivateAction(false);
      Object.assign(battle.usersState[0]!, overrides);
      expect(hasNoAvailableActions(maskBattle(battle, "me"), "foe")).toBe(true);
    }
  });

  it("still advances a hidden actor after its turn times out", () => {
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const battle = battleWithPrivateAction(true);
    battle.roundStartAt = new Date(now.getTime() - 10 * 60 * 1000);
    expect(calcActiveUser(maskBattle(battle, "me"), "me").actor.userId).toBe("me");
  });
});
