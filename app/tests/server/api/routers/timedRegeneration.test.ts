import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import {
  ENERGY_QUEST_REWARDS,
  MEDNIN_REQUIRED_EXP,
  REGEN_SECONDS,
  TERMINAL_DIALOG_PREFIX,
} from "@/drizzle/constants";
import {
  quest,
  questHistory,
  userData,
  userQueue,
  userRaidBuff,
} from "@/drizzle/schema";
import { calcCurrent } from "@/libs/regeneration";
import { Pusher } from "@/libs/pusher";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { upsertQuestEntry } from "@/server/utils/questAssignment";
import { createTRPCRouter } from "@/server/api/trpc";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { IncreaseRegenerationTag } from "@/validators/combat";
import { DialogObjective, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertUsers,
  insertQuests,
  insertQuestHistory,
} from "../../../setup/factories";
import { queueEnergy, readEnergyQueue } from "../../../setup/queues";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { barrier, interceptExecute } from "../../../setup/statements";

const USER_ID = "timed-recovery";
const VILLAGE_ID = "timed-recovery-village";
const STEP = REGEN_SECONDS * 1000;
const questRouter = createTRPCRouter({ quests: questsRouter });
const readUser = async (userId = USER_ID) =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });

describeWithDatabase(
  "timed regeneration at hospital and isolation clock resets",
  () => {
    beforeEach(async () => {
      await resetTables(userRaidBuff, userQueue, questHistory, quest, userData);
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      vi.spyOn(nextServer, "after").mockImplementation(() => {});
      await insertUsers([
        {
          userId: USER_ID,
          username: "TimedRecovery",
          status: "HOSPITALIZED",
          rank: "JONIN",
          level: 50,
          isOutlaw: true,
          villageId: VILLAGE_ID,
          regeneration: 10,
          curEnergy: 0,
          curHealth: 100,
          maxHealth: 1000,
          curChakra: 100,
          maxChakra: 1000,
          curStamina: 100,
          maxStamina: 1000,
          money: 10000,
          primaryElement: "Fire",
          secondaryElement: "Water",
        },
      ]);
    });
    afterEach(() => {
      setSystemTime();
      vi.restoreAllMocks();
    });

    it.each(["HOSPITALIZED", "TRAVEL", "BATTLE"] as const)(
      "%s profiles retain earned ticks when a meal expires without resetting the recovery clock",
      async (status) => {
        const db = await getTestDatabase();
        const from = new Date("2026-01-01T00:00:00Z");
        await db
          .update(userData)
          .set({
            status,
            battleId: null,
            regenAt: from,
            updatedAt: from,
            joinedVillageAt: new Date(from.getTime() - 100 * 86400000),
            curHealth: 0,
            curChakra: 0,
            curStamina: 0,
            travelFinishAt: new Date(from.getTime() + 600000),
          })
          .where(eq(userData.userId, USER_ID));
        if (status === "BATTLE") {
          await insertQuests([
            {
              id: "retained-recovery",
              questType: "battlepyramid",
              content: {
                isolated: true,
                entryItems: [],
                objectives: [],
                reward: ObjectiveReward.parse({}),
                sceneBackground: "",
                sceneCharacters: [],
              },
            },
          ]);
          await insertQuestHistory([
            {
              userId: USER_ID,
              questId: "retained-recovery",
              questType: "battlepyramid",
              isolated: true,
            },
          ]);
        }
        await db.insert(userRaidBuff).values({
          id: "retained-meal",
          userId: USER_ID,
          itemId: "meal",
          createdAt: from,
          expiresAt: new Date(from.getTime() + 150000),
          effects: [IncreaseRegenerationTag.parse({ power: 70 })],
        });
        await queueEnergy(USER_ID, [{ stat: "offence", energy: 1000 }]);
        for (const [elapsed, rate, earned] of [
          [149999, 17, 34],
          [151001, 10, 34],
          [240000, 10, 54],
        ] as const) {
          setSystemTime(new Date(from.getTime() + elapsed));
          const { user } = await fetchUpdatedUser({ client: db, userId: USER_ID });
          expect(user).toEqual(
            expect.objectContaining({
              status,
              curEnergy: 0,
              regenAt: from,
              regeneration: rate,
              regenerationWithoutTimedBuffs: 10,
            }),
          );
          expect(
            calcCurrent(
              user!.curEnergy,
              user!.maxEnergy,
              "AWAKE",
              user!.regenerationWithoutTimedBuffs,
              user!.regenAt,
              0,
              undefined,
              user!.raidBuffs,
            ).current,
          ).toBe(earned);
          if (status === "TRAVEL") {
            for (const pool of ["Health", "Chakra", "Stamina"] as const)
              expect(
                calcCurrent(
                  user![`cur${pool}`],
                  user![`max${pool}`],
                  status,
                  user!.regenerationWithoutTimedBuffs,
                  user!.regenAt,
                  0,
                  undefined,
                  user!.raidBuffs,
                ).current,
              ).toBe(earned);
          }
        }
        expect(await readUser()).toEqual(
          expect.objectContaining({
            status,
            curEnergy: 0,
            curHealth: 0,
            curChakra: 0,
            curStamina: 0,
            regenAt: from,
          }),
        );
        expect(await readEnergyQueue(USER_ID)).toMatchObject([
          { stat: "offence", energy: 1000 },
        ]);
      },
    );

    it.each([
      [4 * STEP + 5000, 4, 54],
      [4 * STEP - 1, 3, 44],
    ])(
      "isolated quest entry %dms after the clock settles %d ticks with timed recovery",
      async (elapsed, ticks, earned) => {
        const db = await getTestDatabase();
        const from = new Date("2026-01-01T00:00:00Z");
        await db
          .update(userData)
          .set({
            status: "AWAKE",
            battleId: null,
            regenAt: from,
            updatedAt: from,
            joinedVillageAt: new Date(from.getTime() - 100 * 86400000),
            curHealth: 0,
            curChakra: 0,
            curStamina: 0,
            curEnergy: 0,
          })
          .where(eq(userData.userId, USER_ID));
        await insertQuests([
          {
            id: "entry-recovery",
            questType: "story",
            content: {
              isolated: true,
              entryItems: [],
              objectives: [],
              reward: ObjectiveReward.parse({}),
              sceneBackground: "",
              sceneCharacters: [],
            },
          },
        ]);
        await db.insert(userRaidBuff).values({
          id: "entry-meal",
          userId: USER_ID,
          itemId: "meal",
          createdAt: from,
          expiresAt: new Date(from.getTime() + 2.5 * STEP),
          effects: [IncreaseRegenerationTag.parse({ power: 70 })],
        });
        setSystemTime(from);
        const { user } = await fetchUpdatedUser({ client: db, userId: USER_ID });
        const story = await db.query.quest.findFirst({
          where: eq(quest.id, "entry-recovery"),
        });
        setSystemTime(new Date(from.getTime() + elapsed));

        await upsertQuestEntry(db, user!, story!, "system", null);

        const pools = {
          curHealth: earned,
          curChakra: earned,
          curStamina: earned,
          curEnergy: earned,
        };
        const stored = await readUser();
        expect(stored).toMatchObject({ status: "BATTLE", ...pools });
        expect(user).toMatchObject(pools);
        expect(stored?.regenAt.getTime()).toBe(from.getTime() + ticks * STEP);
        expect(user?.regenAt.getTime()).toBe(from.getTime() + ticks * STEP);
      },
    );

    const recoveryClock = async (ticks = 4, overlap = false, active = false) => {
      const db = await getTestDatabase();
      // Keep the last tick comfortably away from a real SQL clock boundary.
      const from = new Date(Date.now() - ticks * STEP - 5000);
      await db
        .update(userData)
        .set({ regenAt: from })
        .where(eq(userData.userId, USER_ID));
      await db.insert(userRaidBuff).values({
        id: "recovery-meal",
        userId: USER_ID,
        itemId: "meal",
        createdAt: new Date(from.getTime() + (active ? 3.5 * STEP : 0)),
        expiresAt: new Date(from.getTime() + (active ? 10 * STEP : 2.5 * STEP)),
        effects: [IncreaseRegenerationTag.parse({ power: 70 })],
      });
      if (overlap)
        await db.insert(userRaidBuff).values({
          id: "recovery-raid",
          userId: USER_ID,
          createdAt: new Date(from.getTime() + 1.5 * STEP),
          expiresAt: new Date(from.getTime() + 3.5 * STEP),
          effects: [IncreaseRegenerationTag.parse({ power: 30 })],
        });
      return from;
    };

    it.each([
      { ticks: 12, overlap: false, active: false, expected: 134 },
      { ticks: 4, overlap: true, active: false, expected: 57 },
      { ticks: 4, overlap: false, active: true, expected: 47 },
    ])(
      "NPC checkout earns $expected Energy across timed intervals",
      async ({ ticks, overlap, active, expected }) => {
        await recoveryClock(ticks, overlap, active);
        await queueEnergy(USER_ID, [{ stat: "offence", energy: 100 }]);
        const before = await readUser();
        const api = await callerFor(hospitalRouter, USER_ID);
        const result = await api.npcHeal({ villageId: VILLAGE_ID });
        const saved = await readUser();
        expect(result.success).toBe(true);
        expect(saved).toMatchObject({
          status: "AWAKE",
          curHealth: 1000,
          curEnergy: expected,
          offence: before!.offence,
        });
        expect(result.data?.curEnergy).toBe(expected);
        expect(result.data?.regenAt.getTime()).toBe(saved!.regenAt.getTime());
        expect(await readEnergyQueue(USER_ID)).toMatchObject([
          { stat: "offence", energy: 100 },
        ]);
        expect((await api.npcHeal({ villageId: VILLAGE_ID })).success).toBe(false);
        // An awake profile may now spend the recovered Energy on its ordinary queue.
        expect((await readUser())?.curEnergy).toBe(
          expected - (expected >= 100 ? 100 : 0),
        );
      },
    );

    it.each([false, true])(
      "mednin healing settles the live recipient clock, intervening reset=%s",
      async (interveningReset) => {
        const from = await recoveryClock();
        await queueEnergy(USER_ID, [{ stat: "offence", energy: 100 }]);
        await insertUsers([
          {
            userId: "timed-healer",
            rank: "JONIN",
            status: "AWAKE",
            isOutlaw: true,
            villageId: VILLAGE_ID,
            regeneration: 0,
            curChakra: 8000,
            maxChakra: 8000,
            medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
          },
        ]);
        const db = await getTestDatabase();
        const client = interceptExecute(db, async (_query, run) => {
          // Another healer has already consumed the first two ticks and changed the balance.
          if (interveningReset)
            await db
              .update(userData)
              .set({ curEnergy: 100, regenAt: new Date(from.getTime() + 2 * STEP) })
              .where(eq(userData.userId, USER_ID));
          return run();
        });
        const api = callerForDatabase(hospitalRouter, "timed-healer", client);
        expect(
          (await api.userHeal({ userId: USER_ID, healPercentage: 10 })).success,
        ).toBe(true);
        expect((await readUser())?.curEnergy).toBe(interveningReset ? 120 : 54);
        expect(await readEnergyQueue(USER_ID)).toMatchObject([
          { stat: "offence", energy: 100 },
        ]);
      },
    );

    it("concurrent mednins retry stale recipient snapshots without replaying elapsed ticks", async () => {
      await recoveryClock();
      const healerIds = ["healer-a", "healer-b"];
      await insertUsers(
        healerIds.map((userId) => ({
          userId,
          username: userId,
          rank: "JONIN",
          status: "AWAKE",
          isOutlaw: true,
          villageId: VILLAGE_ID,
          regeneration: 0,
          curChakra: 8000,
          maxChakra: 8000,
          medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
        })),
      );
      const db = await getTestDatabase();
      const before = await readUser();
      const bothLoaded = barrier(2);
      const client = interceptExecute(db, async (_query, run) => {
        // Both requests load the recipient snapshot before either delivers healing.
        await bothLoaded();
        return run();
      });
      const results = await Promise.all(
        healerIds.map(async (userId) => ({
          userId,
          result: await callerForDatabase(hospitalRouter, userId, client).userHeal({
            userId: USER_ID,
            healPercentage: 10,
          }),
        })),
      );
      expect(results.filter(({ result }) => result.success)).toHaveLength(1);
      const winner = results.find(({ result }) => result.success)!;
      const loser = results.find(({ result }) => !result.success)!;
      expect(winner.result).toMatchObject({ success: true, expGain: 10 });
      expect(winner.result.chakraCost).toBeCloseTo(15);
      expect(loser.result).toMatchObject({
        success: false,
        message: expect.stringContaining("state or target changed"),
      });
      const [recipient, paidHealer, unpaidHealer] = await Promise.all([
        readUser(),
        readUser(winner.userId),
        readUser(loser.userId),
      ]);
      expect(recipient).toMatchObject({
        curHealth: 200,
        curEnergy: 54,
        status: "HOSPITALIZED",
      });
      expect(recipient!.updatedAt.getTime()).toBeGreaterThan(
        before!.updatedAt.getTime(),
      );
      expect(paidHealer).toMatchObject({
        curChakra: 7985,
        medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY + 10,
      });
      expect(unpaidHealer).toMatchObject({
        curChakra: 8000,
        medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
      });

      const retry = await (await callerFor(hospitalRouter, loser.userId)).userHeal({
        userId: USER_ID,
        healPercentage: 10,
      });
      expect(retry).toMatchObject({ success: true, expGain: 10 });
      expect(retry.chakraCost).toBeCloseTo(15);
      const [savedRecipient, ...savedHealers] = await Promise.all([
        readUser(),
        ...healerIds.map((userId) => readUser(userId)),
      ]);
      expect(savedRecipient).toMatchObject({
        curHealth: 300,
        curEnergy: 54,
        status: "HOSPITALIZED",
      });
      for (const healer of savedHealers) {
        expect(healer).toMatchObject({
          curChakra: 7985,
          medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY + 10,
        });
      }
    });

    it.each(["abandon", "complete", "retire", "orphan"] as const)(
      "isolated %s earns expired meal/raid recovery once without training queues",
      async (end) => {
        const db = await getTestDatabase();
        await db
          .update(userData)
          .set({ status: "AWAKE", regeneration: 0, regenAt: new Date() })
          .where(eq(userData.userId, USER_ID));
        await insertQuests([
          {
            id: "recovery-pyramid",
            hidden: false,
            questType: "battlepyramid",
            maxAttempts: 100,
            maxCompletes: 100,
            content: {
              isolated: true,
              entryItems: [],
              sceneBackground: "",
              sceneCharacters: [],
              reward: ObjectiveReward.parse({}),
              objectives: [
                DialogObjective.parse({
                  id: "finish",
                  task: "dialog",
                  nextObjectiveId: [{ text: "Complete" }],
                }),
              ],
            },
          },
        ]);
        const { quests: api } = await callerFor(questRouter, USER_ID);
        expect(
          (await api.startQuest({ questId: "recovery-pyramid", userSector: 0 }))
            .success,
        ).toBe(true);
        await db
          .update(userData)
          .set({ regeneration: 10 })
          .where(eq(userData.userId, USER_ID));
        await recoveryClock(4, true);
        await queueEnergy(USER_ID, [{ stat: "offence", energy: 1000 }]);
        const before = await readUser();
        const finish = async () => {
          if (end === "abandon") return api.abandon({ id: "recovery-pyramid" });
          if (end === "complete")
            return api.checkRewards({
              questId: "recovery-pyramid",
              nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
            });
          return fetchUpdatedUser({ client: db, userId: USER_ID });
        };
        if (end === "complete")
          await db
            .update(userData)
            .set({
              questData: [
                QuestTracker.parse({
                  id: "recovery-pyramid",
                  goals: [{ id: "finish" }],
                }),
              ],
            })
            .where(eq(userData.userId, USER_ID));
        if (end === "retire")
          await db
            .update(questHistory)
            .set({ endAt: new Date() })
            .where(eq(questHistory.questId, "recovery-pyramid"));
        if (end === "orphan")
          await db.delete(quest).where(eq(quest.id, "recovery-pyramid"));
        const result = await finish();
        if ("success" in result) expect(result).toMatchObject({ success: true });
        const expected =
          57 + (end === "complete" ? (ENERGY_QUEST_REWARDS.battlepyramid ?? 0) : 0);
        expect(await readUser()).toMatchObject({
          status: "AWAKE",
          curEnergy: expected,
          curHealth: before!.curHealth,
          offence: before!.offence,
        });
        expect(await readEnergyQueue(USER_ID)).toMatchObject([
          { stat: "offence", energy: 1000 },
        ]);
        await finish();
        expect((await readUser())?.curEnergy).toBe(expected);
      },
    );

    it.each([
      { startsAt: STEP + 1, endsAt: 3 * STEP + 1, at: 4 * STEP, expected: 54 },
      { startsAt: STEP, endsAt: 2 * STEP, at: 4 * STEP, expected: 47 },
      { startsAt: 0, endsAt: STEP + 1, at: 4 * STEP, expected: 47 },
      { startsAt: 0, endsAt: 10 * STEP, at: STEP - 1, expected: 0 },
      { startsAt: 0, endsAt: 10 * STEP, at: STEP, expected: 17 },
      { startsAt: 0, endsAt: 10 * STEP, at: STEP + 1, expected: 17 },
    ])(
      "keeps SQL and response ticks exact at millisecond boundaries: %j",
      async ({ startsAt, endsAt, at, expected }) => {
        const db = await getTestDatabase();
        const from = new Date("2026-01-01T00:00:00Z");
        const user = {
          regeneration: 17,
          regenerationWithoutTimedBuffs: 10,
          regenAt: from,
          raidBuffs: [
            {
              createdAt: new Date(from.getTime() + startsAt),
              expiresAt: new Date(from.getTime() + endsAt),
              effects: [IncreaseRegenerationTag.parse({ power: 70 })],
            },
          ],
        };
        const to = new Date(from.getTime() + at);
        await db
          .update(userData)
          .set({ regenAt: from, curEnergy: 0 })
          .where(eq(userData.userId, USER_ID));
        await db
          .update(userData)
          .set({ curEnergy: userRegenerationGainSql(user, userData.regenAt, to) })
          .where(eq(userData.userId, USER_ID));
        expect(getUserRegenerationGain(user, to)).toBe(expected);
        expect((await readUser())?.curEnergy).toBe(expected);
      },
    );
  },
);
