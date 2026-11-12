import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  battle,
  battleHistory,
  type Jutsu,
  type SkillTree,
  skillTree,
  userJutsu,
} from "@/drizzle/schema";
import { availableUserActions, userItemToAction } from "@/libs/combat/actions";
import { prepareVillageDutyDefender } from "@/libs/combat/initiation";
import { refreshMasteries } from "@/libs/combat/mastery";
import { applyEffects } from "@/libs/combat/process";
import { clone, getPower } from "@/libs/combat/tags";
import type { CombatQueryUser, UserEffect } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import * as cooking from "@/server/utils/cooking";
import * as userQueue from "@/server/utils/userQueue";
import {
  fakeInitiationClient,
  makeInitiationUser,
  preloadBattle,
} from "../../../../libs/combat/helpers/preload";
import {
  makeBattleUserItem,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
  makeTag,
  makeWeapon,
  tableDefaults,
} from "../../../../setup/combat";
import { trackerQuest, trackerUser } from "../../../../setup/quest";

/** Enrolled offline owner whose battle copy must leave their account untouched. */
const owner = () =>
  makeInitiationUser({
    userId: "owner",
    villageId: "home",
    villageDutyVillageId: "home",
    villageDutyStartedAt: new Date("2026-11-09"),
    status: "ASLEEP",
    curHealth: 1,
  });
describe("village duty combat isolation", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "admits only the attacker for %s and never publishes a battle to the owner",
    async (battleType) => {
      const defender = { ...owner(), joinedVillageAt: new Date("2026-01-01") };
      const before = structuredClone(defender);
      const fake = fakeInitiationClient([
        makeInitiationUser({ userId: "attacker", villageId: "enemy" }),
        defender,
      ]);
      const predicates: string[] = [];
      const client = Object.create(fake.client) as DrizzleClient;
      client.update = (() => ({
        set: () => ({
          where: (predicate: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
            const query = new MySqlDialect().sqlToQuery(predicate);
            predicates.push(JSON.stringify(query));
            return Promise.resolve({ rowsAffected: 1 });
          },
        }),
      })) as unknown as DrizzleClient["update"];
      const result = await initiateBattle(
        {
          client,
          userIds: ["attacker"],
          targetIds: ["duty:opaque-1234"],
          villageDuty: {
            actorId: "duty:opaque-1234",
            userId: "owner",
            villageId: "home",
            startedAt: new Date("2026-11-10T10:00:00Z").toISOString(),
            slot: 0,
            battleId: "copy-fixture-battle",
          },
          forceDefenderVillageId: "home",
        },
        battleType,
      );
      expect(result.success).toBe(true);
      const copy = fake
        .saved()
        ?.usersState.find((u) => u.controllerId === "duty:opaque-1234");
      expect(copy?.isAi).toBe(true);
      expect(copy?.userId).not.toBe("owner");
      expect(copy?.curHealth).toBe(copy?.maxHealth);
      expect(copy?.spriteAppearance).toBeDefined();
      expect(predicates.join()).not.toContain('"owner"');
      expect(Pusher.prototype.trigger).not.toHaveBeenCalledWith(
        "owner",
        expect.anything(),
        expect.anything(),
      );
      expect(defender).toEqual(before);
    },
  );
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "preserves owned equipment scaling in %s copies and character scaling for authored AI and clones",
    async (battleType) => {
      const defender = {
        ...owner(),
        joinedVillageAt: new Date("2026-01-01"),
        items: (
          [
            ["WEAPON", "HAND_1", "HAND"],
            ["ARMOR", "CHEST", "CHEST"],
            ["ACCESSORY", "WAIST", "WAIST"],
            ["KEYSTONE", "KEYSTONE", "KEYSTONE"],
          ] as const
        ).map(([itemType, equipped, slot], index) => ({
          ...makeBattleUserItem({
            id: `owned-${itemType}`,
            itemId: itemType,
            equipped,
            level: 1 + index,
          }),
          userId: "owner",
          imbuements: [],
          item: makeWeapon({
            id: itemType,
            itemType,
            battleUsageType: "ALL",
            slot,
            lpcProfile: "NONE",
            chakraCost: 120,
            chakraCostReducePerLvl: 1,
            ...(itemType !== "WEAPON"
              ? {
                  effects: [
                    makeTag("increasemastery", {
                      masteryTypes: ["Ninjutsu"],
                      calculation: "static",
                      power: 22,
                      powerPerLevel: 1,
                    }),
                  ],
                }
              : {}),
          }),
        })),
      };
      const copy = prepareVillageDutyDefender(
        defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
        "home",
        "duty:opaque-1234",
      )!;
      const results = await Promise.all(
        [defender, copy, { ...defender, userId: "authored-ai", isAi: true }].map(
          (user) =>
            preloadBattle([structuredClone(user) as unknown as CombatQueryUser], {
              battleType,
            }),
        ),
      );
      for (const [index, result] of results.entries()) {
        const user = result.usersState[0]!;
        const weapon = user.items.find((item) => item.itemId === "WEAPON")!;
        const battle = makeCompleteBattle({
          battleType,
          usersState: result.usersState,
          usersEffects: result.userEffects,
          extraState: result.extraState,
        });
        const action = userItemToAction(weapon, user, battle);
        for (const item of user.items.filter((item) => item.itemId !== "WEAPON")) {
          const effect = result.userEffects.find(
            (effect) => effect.actionId === item.itemId,
          )!;
          const level = index === 2 ? user.level : item.level;
          expect(effect.level).toBe(level);
          expect(getPower(effect).power).toBe(22 + level);
        }
        const level = index === 2 ? user.level : weapon.level;
        expect(action.level).toBe(level);
        expect(
          getPower({ ...action.effects[0], level: action.level } as UserEffect).power,
        ).toBe(22 + level);
        expect(action.chakraCost).toBe(120 - level);
        const original = structuredClone(user);
        clone(
          battle.usersState,
          {
            ...makeEffect(
              "clone",
              { power: 100, rounds: 5 },
              { creatorId: user.userId, isNew: true },
            ),
            longitude: 1,
            latitude: 1,
          },
          battle.extraState,
        );
        const standIn = battle.usersState[1]!;
        const clonedWeapon = standIn.items.find((item) => item.itemId === "WEAPON")!;
        const clonedAction = userItemToAction(clonedWeapon, standIn, battle);
        expect(standIn.isAi).toBe(true);
        expect(standIn.isVillageDutyCopy).toBeUndefined();
        expect(clonedWeapon.id).toBe(weapon.id);
        expect(clonedWeapon.level).toBe(weapon.level);
        expect(clonedAction.level).toBe(user.level);
        expect(
          getPower({
            ...clonedAction.effects[0],
            level: clonedAction.level,
          } as UserEffect).power,
        ).toBe(22 + user.level);
        expect(clonedAction.chakraCost).toBe(120 - user.level);
        expect(user).toEqual(original);
      }
      expect(results[1]!.usersState[0]!.isAi).toBe(true);
    },
  );
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "keeps player skill eligibility for %s copies after a reset or deactivation",
    async (battleType) => {
      const defender = {
        ...owner(),
        joinedVillageAt: new Date("2026-01-01"),
        userSkills: [] as CombatQueryUser["userSkills"],
        items: [
          {
            ...makeBattleUserItem({
              id: "owned-gear",
              itemId: "gear",
              equipped: "HAND_1",
            }),
            userId: "owner",
            imbuements: [],
            item: makeWeapon({
              id: "gear",
              requiredSkillId: "required",
              battleUsageType: "ALL",
            }),
          },
        ],
        jutsus: [
          {
            id: "owned-jutsu",
            jutsuId: "gated",
            equipped: true,
            level: 1,
            experience: 0,
            jutsu: makeJutsu({ id: "gated", requiredSkillId: "required" }),
          },
        ],
      };
      for (const activated of [undefined, false, true]) {
        defender.userSkills =
          activated === undefined
            ? []
            : [
                {
                  id: "owned-skill",
                  userId: "owner",
                  skillId: "required",
                  activated,
                  purchasedAt: new Date(),
                  skill: {
                    ...tableDefaults(skillTree),
                    id: "required",
                    effects: [],
                  } as unknown as SkillTree,
                },
              ];
        const copy = prepareVillageDutyDefender(
          defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
          "home",
          "duty:opaque-1234",
        )!;
        const result = await preloadBattle([copy], { battleType });
        const user = result.usersState[0]!;
        const battle = makeCompleteBattle({
          battleType,
          usersState: result.usersState,
          usersEffects: result.userEffects,
          extraState: result.extraState,
        });
        const actions = availableUserActions(battle, user.userId, false).map(
          (action) => action.id,
        );
        expect(user.activeSkillIds).toEqual(activated ? ["required"] : []);
        expect(user.items.map((item) => item.itemId)).toEqual(
          activated ? ["gear"] : [],
        );
        expect(user.jutsus.map((jutsu) => jutsu.jutsuId)).toEqual(
          activated ? ["gated"] : [],
        );
        expect(actions.includes("gear")).toBe(!!activated);
        expect(actions.includes("gated")).toBe(!!activated);
        expect(user.isAi).toBe(true);
        expect(user.isVillageDutyCopy).toBe(true);
      }
      for (const isSummon of [false, true]) {
        const result = await preloadBattle(
          [
            {
              ...structuredClone(defender),
              userId: "duty:authored-ai",
              userSkills: [],
              isAi: true,
            } as unknown as CombatQueryUser,
          ],
          { battleType, isSummon },
        );
        expect(result.usersState[0]!.activeSkillIds).toBeUndefined();
        expect(result.usersState[0]!.items.map((item) => item.itemId)).toEqual([
          "gear",
        ]);
        expect(result.usersState[0]!.jutsus.map((jutsu) => jutsu.jutsuId)).toEqual([
          "gated",
        ]);
      }
    },
  );
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "applies every player jutsu gate to %s copies and removes their reward tracking",
    async (battleType) => {
      const history = trackerUser(
        [trackerQuest("owner-quest", [])],
        [{ id: "owner-quest", goals: [] }],
      );
      const requirements: Partial<Jutsu>[] = [
        {},
        { requiredSkillId: "missing" },
        { bloodlineId: "other" },
        { bloodlineReskinId: "other" },
        { elementClassification: "Fire" },
        { requiredNinjutsuMastery: 1_000_000 },
        { jutsuWeapon: "SWORD" },
        { requiredBloodlineItemId: "missing" },
        { requiredLevel: 10_000 },
        { requiredRank: "ELITE JONIN" },
        { jutsuRank: "H" },
        { villageId: "other" },
      ];
      const defender = {
        ...owner(),
        joinedVillageAt: new Date("2026-01-01"),
        rank: "CHUNIN",
        primaryElement: "Water",
        secondaryElement: "Wind",
        jutsus: requirements.map((requirement, index) => ({
          id: `owned-${index}`,
          jutsuId: `jutsu-${index}`,
          equipped: true,
          level: 1,
          experience: 0,
          jutsu: makeJutsu({ id: `jutsu-${index}`, ...requirement }),
        })),
        userQuests: history.userQuests as NonNullable<CombatQueryUser["userQuests"]>,
        questData: history.questData,
        completedQuests: [
          {
            id: "owner-receipt",
            questId: "receipt",
            completed: 1,
            previousCompletes: 0,
            questType: "daily" as const,
          },
        ],
      };
      const copy = prepareVillageDutyDefender(
        defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
        "home",
        "duty:opaque-1234",
      )!;
      expect(copy.completedQuests).toEqual(defender.completedQuests);
      expect(copy.userQuests.map((entry) => entry.questId)).toEqual(["owner-quest"]);
      expect(copy.questData).toEqual(defender.questData);
      const before = structuredClone(defender);
      const result = await preloadBattle([copy], { battleType });
      expect(result.usersState[0]!.jutsus.map((jutsu) => jutsu.jutsuId)).toEqual([
        "jutsu-0",
      ]);
      expect(result.extraState.userQuests).toEqual({});
      expect(result.extraState.completedQuests).toEqual({});
      expect(result.extraState.questData).toEqual({});
      expect(defender).toEqual(before);
    },
  );
  it("rejects a cancelled enrollment before battle writes", async () => {
    const fake = fakeInitiationClient([
      makeInitiationUser({ userId: "attacker" }),
      { ...owner(), villageDutyVillageId: null },
    ]);
    const result = await initiateBattle(
      {
        client: fake.client,
        userIds: ["attacker"],
        targetIds: ["duty:opaque-1234"],
        villageDuty: {
          actorId: "duty:opaque-1234",
          userId: "owner",
          villageId: "home",
          startedAt: new Date("2026-11-10T10:00:00Z").toISOString(),
          slot: 0,
          battleId: "copy-fixture-battle",
        },
      },
      "VILLAGE_PROTECTOR",
    );
    expect(result.success).toBe(false);
    expect(fake.saved()).toBeUndefined();
  });
  it.each([
    ["VILLAGE_PROTECTOR", "queue"],
    ["VILLAGE_PROTECTOR", "cooking"],
    ["SHRINE_WAR", "queue"],
    ["SHRINE_WAR", "cooking"],
  ] as const)(
    "rejects %s before battle writes when duty ends during %s settlement",
    async (battleType, settlement) => {
      const attacker = makeInitiationUser({ userId: "attacker", villageId: "enemy" });
      const defender = { ...owner(), joinedVillageAt: new Date("2026-01-01") };
      // Settlement changes the authoritative rows between the initial read and its reload.
      Object.assign(attacker, {
        queue: settlement === "queue" ? [{ kind: "JUTSU", startsAt: new Date(0) }] : [],
        cookingJobs:
          settlement === "cooking"
            ? [{ id: "cooking", experience: 1, finishesAt: new Date(0) }]
            : [],
      });
      const standDown = () => {
        defender.villageDutyVillageId = null;
        defender.villageDutyStartedAt = null;
        attacker.queue.length = attacker.cookingJobs.length = 0;
      };
      const queueSettlement = vi
        .spyOn(userQueue, "settleDueTimedQueues")
        .mockImplementation(async () => {
          standDown();
          return 0;
        });
      const cookingSettlement = vi
        .spyOn(cooking, "settleCookingExperience")
        .mockImplementation(async () => {
          standDown();
          return true;
        });
      const fake = fakeInitiationClient([attacker, defender]);
      const claim = vi.fn(() => ({
        set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
      }));
      const client = Object.create(fake.client) as DrizzleClient;
      const insert = vi.fn(fake.client.insert);
      client.insert = insert;
      client.update = claim as unknown as DrizzleClient["update"];
      const result = await initiateBattle(
        {
          client,
          userIds: ["attacker"],
          targetIds: ["duty:opaque-1234"],
          villageDuty: {
            actorId: "duty:opaque-1234",
            userId: "owner",
            villageId: "home",
            startedAt: new Date("2026-11-10T10:00:00Z").toISOString(),
            slot: 0,
            battleId: "copy-fixture-battle",
          },
        },
        battleType,
      );
      expect(
        settlement === "queue" ? queueSettlement : cookingSettlement,
      ).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("stood down or changed villages");
      expect(insert).not.toHaveBeenCalledWith(battle);
      expect(insert).not.toHaveBeenCalledWith(battleHistory);
      expect(claim).not.toHaveBeenCalled();
      expect(fake.saved()).toBeUndefined();
    },
  );
  it("gives the copy independent inventory with no drops, active queues, or reward receipts", () => {
    const defender = {
      ...owner(),
      joinedVillageAt: new Date("2026-01-01"),
      items: [
        {
          id: "owned-blade",
          userId: "owner",
          dropChancePerc: 100,
          quantity: 1,
          equipped: "HAND_1",
          item: { id: "blade", itemType: "WEAPON", slot: "HAND_1", lpcProfile: "NONE" },
        },
      ],
      queue: [{ id: "job" }],
      bounties: [{ id: "bounty" }],
      activePetId: "pet",
    };
    const copy = prepareVillageDutyDefender(
      defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
      "home",
      "duty:opaque-1234",
    );
    expect(copy?.userId).toBe("duty:opaque-1234");
    expect(copy?.queue).toEqual([]);
    expect(copy?.bounties).toEqual([]);
    expect(copy?.activePetId).toBeNull();
    expect(copy?.items[0]?.dropChancePerc).toBe(0);
    expect(copy?.items[0]?.id).not.toBe("owned-blade");
    expect(defender.items[0]?.dropChancePerc).toBe(100);
    expect(defender.queue).toHaveLength(1);
    expect(defender.userId).toBe("owner");
  });
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "checks owned item mastery and mastery debuffs throughout %s copies",
    async (battleType) => {
      for (const mastery of [0, 600]) {
        const defender = {
          ...owner(),
          joinedVillageAt: new Date("2026-01-01"),
          bukijutsuMastery: mastery,
          items: (["WEAPON", "CONSUMABLE"] as const).map((itemType) => ({
            ...makeBattleUserItem({
              id: `owned-${itemType}`,
              itemId: itemType,
              equipped: "HAND_1",
              quantity: 3,
            }),
            userId: "owner",
            imbuements: [],
            item: makeWeapon({ id: itemType, itemType, requiredBukijutsuMastery: 500 }),
          })),
          jutsus: [
            {
              ...tableDefaults(userJutsu),
              id: "owned-jutsu",
              userId: "owner",
              jutsuId: "mastery-jutsu",
              equipped: true,
              level: 1,
              experience: 0,
              jutsu: makeJutsu({ id: "mastery-jutsu", requiredBukijutsuMastery: 500 }),
            },
          ],
        };
        const copy = prepareVillageDutyDefender(
          defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
          "home",
          "duty:opaque-1234",
        )!;
        for (const input of [defender, copy]) {
          const result = await preloadBattle(
            [structuredClone(input) as CombatQueryUser],
            { battleType },
          );
          // Battle JSON round trips must retain the distinction from authored AI.
          const battle = JSON.parse(
            JSON.stringify(
              makeCompleteBattle({
                battleType,
                usersState: result.usersState,
                usersEffects: result.userEffects,
                extraState: result.extraState,
                round: 2,
              }),
            ),
          ) as ReturnType<typeof makeCompleteBattle>;
          const user = battle.usersState[0]!;
          refreshMasteries(battle.usersState, battle.usersEffects);
          const actions = () =>
            availableUserActions(battle, user.userId, false).map((action) => action.id);
          for (const id of ["WEAPON", "CONSUMABLE", "mastery-jutsu"]) {
            expect(actions().includes(id)).toBe(mastery === 600);
          }
          if (mastery === 0) continue;
          battle.usersEffects.push(
            makeEffect(
              "decreasemastery",
              {
                masteryTypes: ["Bukijutsu"],
                calculation: "static",
                power: 300,
                powerPerLevel: 0,
                rounds: 5,
              },
              {
                creatorId: user.userId,
                targetId: user.userId,
                targetType: "user",
                isNew: false,
                castThisRound: false,
                createdRound: 0,
              },
            ),
          );
          const { newBattle } = applyEffects(battle, user.userId);
          expect(newBattle.usersState[0]!.bukijutsuMastery).toBe(300);
          const after = availableUserActions(newBattle, user.userId, false).map(
            (action) => action.id,
          );
          for (const id of ["WEAPON", "CONSUMABLE", "mastery-jutsu"])
            expect(after).not.toContain(id);
        }
      }
    },
  );
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "applies configured jutsu equip caps to players and copies in %s, preserving authored AI",
    async (battleType) => {
      const limits = [
        { category: "40 AP" as const, unrankedMaxEquipped: 1, rankedMaxEquipped: 1 },
      ];
      for (const kind of ["player", "copy", "authored"] as const) {
        const defender = {
          ...owner(),
          status: "AWAKE" as const,
          curHealth: 1000,
          joinedVillageAt: new Date("2026-01-01"),
          isAi: kind === "authored",
          jutsus: [0, 1].map((index) => ({
            ...tableDefaults(userJutsu),
            userId: "owner",
            id: `owned-cap-${index}`,
            jutsuId: `capped-${index}`,
            equipped: true,
            level: 1,
            experience: 0,
            jutsu: makeJutsu({ id: `capped-${index}`, actionCostPerc: 40 }),
          })) as CombatQueryUser["jutsus"],
        };
        const fake = fakeInitiationClient(
          [makeInitiationUser({ userId: "attacker", villageId: "enemy" }), defender],
          { equipLimits: limits },
        );
        const client = Object.create(fake.client) as DrizzleClient;
        client.update = (() => ({
          set: () => ({
            where: async () => ({ rowsAffected: kind === "player" ? 2 : 1 }),
          }),
        })) as unknown as DrizzleClient["update"];
        const result = await initiateBattle(
          {
            client,
            userIds: ["attacker"],
            targetIds: [kind === "copy" ? "duty:opaque-1234" : "owner"],
            ...(kind === "copy"
              ? {
                  villageDuty: {
                    actorId: "duty:opaque-1234",
                    userId: "owner",
                    villageId: "home",
                    startedAt: new Date("2026-11-10T10:00:00Z").toISOString(),
                    slot: 0,
                    battleId: "copy-fixture-battle",
                  },
                }
              : {}),
            jutsuEquipLimits: limits,
          },
          battleType,
        );
        expect(result.success).toBe(true);
        const saved = fake.saved()!;
        const fighter = saved.usersState.find(
          (user) =>
            user.controllerId === (kind === "copy" ? "duty:opaque-1234" : "owner"),
        )!;
        const actions = availableUserActions(saved, fighter.userId, false)
          .filter((action) => action.id.startsWith("capped-"))
          .map((action) => action.id);
        expect(actions).toEqual(
          kind === "authored" ? ["capped-0", "capped-1"] : ["capped-0"],
        );
        expect(fake.readEquipLimits).not.toHaveBeenCalled();
      }
    },
  );
});
