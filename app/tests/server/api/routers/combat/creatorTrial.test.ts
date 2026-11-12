import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { CREATOR_TRIAL_FIRST_FORM, CREATOR_USERNAME } from "@/drizzle/constants";
import {
  aiProfile,
  aiTransformation,
  badge,
  battle,
  quest,
  questHistory,
  userBadge,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { questsRouter } from "@/server/api/routers/quests";
import { insertDefaultAiProfile, insertUsers } from "../../../../setup/factories";
import { readMigration } from "../../../../setup/migrations";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../../../../setup/testDatabase";

const HERO = "trial-hero";
const CREATOR = "trial-creator";
const SPOT = { sector: 12, longitude: 5, latitude: 6 };
const IDS = [CREATOR_TRIAL_FIRST_FORM, "trial-form-b", "creator-trial-elite"];
const ARRIVAL = { log: "It rises", tier: 1, color: 1, glow: 2 };

const attack = async (position = SPOT) =>
  initiateBattle(
    {
      ...position,
      userIds: [HERO],
      targetIds: [CREATOR],
      client: await getTestDatabase(),
      actionUserId: HERO,
      biome: "default",
    },
    "COMBAT",
  );

/** The fight a quest objective naming the creator starts, as quest consequences do. */
const questFight = async () =>
  initiateBattle(
    {
      ...SPOT,
      longitude: SPOT.longitude + 3,
      userIds: [HERO],
      targetIds: [CREATOR],
      client: await getTestDatabase(),
      biome: "default",
      questBattleSource: { questId: "kill-the-creator", objectiveId: "objective" },
    },
    "QUEST",
  );

describeWithDatabase("creator trial admission", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battle,
      aiProfile,
      aiTransformation,
      badge,
      quest,
      questHistory,
      userBadge,
      userData,
      userJutsu,
    );
    await insertDefaultAiProfile({ userId: IDS[0] });
    await insertUsers([
      {
        userId: HERO,
        username: HERO,
        level: 8,
        rank: "STUDENT",
        villageId: "village",
        ...SPOT,
      },
      {
        userId: CREATOR,
        username: CREATOR_USERNAME,
        level: 3,
        rank: "STUDENT",
        villageId: "village",
        ...SPOT,
      },
      ...IDS.map((userId, index) => ({
        userId,
        username: `Form ${index}`,
        isAi: true,
        level: 10 + index * 20,
        rank: "JONIN" as const,
      })),
    ]);
    await (await getTestDatabase()).insert(aiTransformation).values(
      IDS.slice(1).map((nextAiId, index) => ({
        ...ARRIVAL,
        userId: IDS[index]!,
        nextAiId,
        announce: `FORM ${index + 1}`,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens a PvE battle against the forms and leaves the creator's account alone", async () => {
    const client = await getTestDatabase();
    const result = await attack();
    expect(result).toMatchObject({ success: true });

    const created = (await client.query.battle.findFirst())!;
    expect(created.battleType).toBe("OVERWORLD");
    const enemies = created.usersState.filter(
      (user) => user.direction === "right" && !user.isSummon,
    );
    expect(enemies.map((user) => user.controllerId)).toEqual([IDS[0]!]);
    expect(enemies[0]?.username).toBe(CREATOR_USERNAME);
    expect(
      created.extraState.encounter?.pendingWaves.flatMap((wave) =>
        wave.users.filter((user) => !user.isSummon).map((user) => user.controllerId),
      ),
    ).toEqual(IDS.slice(1));
    expect(
      created.extraState.encounter?.pendingWaves.map((wave) => wave.arrival?.announce),
    ).toEqual(["FORM 1", "FORM 2"]);
    expect(enemies[0]?.risesAgain).toBe(true);
    expect(created.extraState.creatorTrial).toEqual({
      creatorId: CREATOR,
      username: CREATOR_USERNAME,
    });

    const creator = await client.query.userData.findFirst({
      where: eq(userData.userId, CREATOR),
    });
    expect(creator).toMatchObject({ status: "AWAKE", battleId: null });
    expect(
      (await client.query.userData.findFirst({ where: eq(userData.userId, HERO) }))
        ?.battleId,
    ).toBe(created.id);
  });

  it("turns a quest fight naming the creator into the trial, keeping it a quest fight", async () => {
    const client = await getTestDatabase();
    expect(await questFight()).toMatchObject({ success: true });

    const created = (await client.query.battle.findFirst())!;
    expect(created.battleType).toBe("QUEST");
    expect(created.extraState.questBattleSource).toEqual({
      questId: "kill-the-creator",
      objectiveId: "objective",
    });
    const enemies = created.usersState.filter(
      (user) => user.direction === "right" && !user.isSummon,
    );
    expect(enemies.map((user) => user.controllerId)).toEqual([IDS[0]!]);
    expect(created.extraState.encounter?.pendingWaves).toHaveLength(IDS.length - 1);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, CREATOR) }),
    ).toMatchObject({ status: "AWAKE", battleId: null });
  });

  it("still requires standing with the creator", async () => {
    const client = await getTestDatabase();
    const result = await attack({ ...SPOT, longitude: SPOT.longitude + 1 });
    expect(result).toMatchObject({
      success: false,
      message: "Attack failed, did the target move?",
    });
    expect(await client.query.battle.findFirst()).toBeUndefined();
  });

  it("reports a trial whose forms are not seeded instead of opening an empty battle", async () => {
    const client = await getTestDatabase();
    await client.delete(userData).where(eq(userData.userId, IDS[2]!));
    expect(await attack()).toMatchObject({
      success: false,
      message: "The trial is unavailable",
    });
    expect(await client.query.battle.findFirst()).toBeUndefined();
  });

  it.each([
    ["an attack", attack],
    ["the quest's own fight", questFight],
  ])(
    "credits the creator's achievement when the last form falls after %s",
    async (_, start) => {
      const client = await getTestDatabase();
      await client.insert(badge).values({
        id: "creator-badge",
        name: "Killed the Creator",
        image: "image",
        description: "",
      });
      await client.insert(quest).values({
        id: "kill-the-creator",
        name: "Kill the Creator",
        image: "image",
        description: "",
        successDescription: "",
        questType: "achievement",
        requiredRank: "STUDENT",
        content: {
          reward: {},
          objectives: [
            {
              id: "objective",
              task: "defeat_opponents",
              sector: 0,
              longitude: 0,
              latitude: 0,
              opponentAIs: [{ ids: [CREATOR], number: 1 }],
              completionOutcome: "Win",
              successDescription: "You did it",
              reward_badges: ["creator-badge"],
            },
          ],
          sceneBackground: "",
          sceneCharacters: [],
        },
      } as never);
      await start();
      const created = (await client.query.battle.findFirst())!;
      const usersState = created.usersState.map((user) =>
        user.controllerId === IDS[0] ? { ...user, curHealth: 0 } : user,
      );
      const { encounter, ...extraState } = created.extraState;
      await client
        .update(battle)
        .set({
          usersState,
          extraState: { ...extraState, encounter: { ...encounter!, pendingWaves: [] } },
        })
        .where(eq(battle.id, created.id));

      const caller = await callerFor(combatRouter, HERO);
      const outcome = await caller.getBattle({ battleId: created.id });
      expect(outcome.result?.outcome).toBe("Won");
      expect(outcome.result?.notifications).toContain("You did it");

      const quests = await callerFor(questsRouter, HERO);
      expect(await quests.checkRewards({ questId: "kill-the-creator" })).toMatchObject({
        success: true,
      });
      expect(
        await client.query.userBadge.findFirst({ where: eq(userBadge.userId, HERO) }),
      ).toMatchObject({ badgeId: "creator-badge" });
    },
  );

  it.each([true, false])(
    "awards God-mode independently when the original achievement is completed: %s",
    async (hasOriginal) => {
      const client = await getTestDatabase();
      const originalQuestId = "g2ilVOzFys21wkEHwfTeE";
      await client.insert(badge).values({
        id: "original-badge",
        name: "Killed the Creator",
        image: "image",
        description: "",
      });
      await client.insert(quest).values({
        id: originalQuestId,
        name: "Kill the Creator",
        questType: "achievement",
        content: {
          reward: {},
          objectives: [
            {
              id: "original-objective",
              task: "defeat_opponents",
              opponentAIs: [{ ids: [CREATOR], number: 1 }],
              completionOutcome: "Win",
              reward_rank: "NONE",
              reward_village_membership: "NONE",
              reward_badges: ["original-badge", "creator-trial-badge"],
            },
          ],
          sceneBackground: "",
          sceneCharacters: [],
        },
      } as never);
      if (hasOriginal) {
        await client.insert(questHistory).values({
          id: "original-history",
          userId: HERO,
          questId: originalQuestId,
          questType: "achievement",
          completed: 1,
          previousCompletes: 1,
          endAt: new Date(),
        });
        await client
          .insert(userBadge)
          .values({ userId: HERO, badgeId: "original-badge" });
      }
      await runRawSql(await readMigration("0152_creator_trial_achievement.sql"));
      await attack();
      const created = (await client.query.battle.findFirst())!;
      // Set up the final round with both earlier forms defeated and the last form on the field.
      const pending = created.extraState.encounter!.pendingWaves;
      const usersState = [
        ...created.usersState,
        ...pending.flatMap((wave) => wave.users),
      ].map((user) => (user.isAi ? { ...user, curHealth: 0 } : user));
      await client
        .update(battle)
        .set({
          usersState,
          extraState: {
            ...created.extraState,
            encounter: { ...created.extraState.encounter!, pendingWaves: [] },
          },
        })
        .where(eq(battle.id, created.id));
      const caller = await callerFor(combatRouter, HERO);
      expect((await caller.getBattle({ battleId: created.id })).result?.outcome).toBe(
        "Won",
      );
      const quests = await callerFor(questsRouter, HERO);
      expect(
        await quests.checkRewards({ questId: "creator-trial-achievement" }),
      ).toMatchObject({ success: true });
      if (!hasOriginal)
        expect(await quests.checkRewards({ questId: originalQuestId })).toMatchObject({
          success: true,
        });
      await quests.checkRewards({ questId: "creator-trial-achievement" });
      expect(
        await client.query.userData.findFirst({ where: eq(userData.userId, HERO) }),
      ).toMatchObject({ rank: "STUDENT", villageId: "village" });
      expect(
        (await client.query.userBadge.findMany({ where: eq(userBadge.userId, HERO) }))
          .map((row) => row.badgeId)
          .sort(),
      ).toEqual(["creator-trial-badge", "original-badge"]);
      expect(
        await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, originalQuestId),
        }),
      ).toMatchObject({ completed: 1, previousCompletes: 1 });
    },
  );

  it.each(["Lost", "Fled", "opening-only", "pending"] as const)(
    "withholds the God-mode badge for %s",
    async (outcome) => {
      const client = await getTestDatabase();
      await runRawSql(await readMigration("0152_creator_trial_achievement.sql"));
      await attack();
      const created = (await client.query.battle.findFirst())!;
      const encounter = created.extraState.encounter!;
      const usersState =
        outcome === "Lost" || outcome === "Fled"
          ? [
              ...created.usersState.map((user) =>
                user.isAi
                  ? { ...user, curHealth: 0 }
                  : {
                      ...user,
                      curHealth: outcome === "Lost" ? 0 : user.curHealth,
                      fledBattle: outcome === "Fled",
                    },
              ),
              ...encounter.pendingWaves.flatMap((wave) => wave.users),
            ]
          : created.usersState.map((user) =>
              user.isAi ? { ...user, curHealth: 0 } : user,
            );
      await client
        .update(battle)
        .set({
          usersState,
          extraState: {
            ...created.extraState,
            encounter: {
              ...encounter,
              pendingWaves: outcome === "pending" ? encounter.pendingWaves : [],
            },
          },
        })
        .where(eq(battle.id, created.id));
      const caller = await callerFor(combatRouter, HERO);
      const result = (await caller.getBattle({ battleId: created.id })).result;
      if (outcome === "pending") expect(result).toBeNull();
      else expect(result?.outcome).toBe(outcome === "opening-only" ? "Won" : outcome);
      await (await callerFor(questsRouter, HERO)).checkRewards({
        questId: "creator-trial-achievement",
      });
      expect(
        await client.query.userBadge.findMany({ where: eq(userBadge.userId, HERO) }),
      ).toEqual([]);
      const hero = await client.query.userData.findFirst({
        where: eq(userData.userId, HERO),
      });
      expect(
        hero?.questData
          ?.find((tracker) => tracker.id === "creator-trial-achievement")
          ?.goals.some((goal) => goal.done),
      ).not.toBe(true);
    },
  );
});
