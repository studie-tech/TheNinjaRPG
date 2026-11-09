import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  quest,
  questHistory,
  recruitmentRewards,
  userData,
  userVote,
} from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { updateRewards } from "@/server/utils/questRewards";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const RECRUITER = "boost-recruiter";
const RECRUIT = "boost-recruit";
const seed = async (recruiterXp = 1400, recruitXp = 600, kills = 0) => {
  await insertUsers([
    {
      userId: RECRUITER,
      username: RECRUITER,
      pvpExperience: recruiterXp,
      weeklyPvpKills: kills,
      weeklyPvpKillsAt: new Date(),
      bank: 0,
      villagePrestige: 0,
    },
    {
      userId: RECRUIT,
      username: RECRUIT,
      pvpExperience: recruitXp,
      recruiterId: RECRUITER,
      level: 10,
      rank: "JONIN",
      experience: 100000,
      regeneration: 0,
      villagePrestige: 0,
    },
  ]);
};

describeWithDatabase(
  "generated recruiter rewards use the recipient's PvP boost",
  () => {
    beforeEach(async () =>
      resetTables(recruitmentRewards, userData, userVote, quest, questHistory),
    );
    afterEach(() => vi.restoreAllMocks());

    it.each([
      {
        recruiterXp: 1400,
        recruitXp: 600,
        kills: 0,
        pvpBoostApplied: false,
        prestige: 115,
        recruitPrestige: 1000,
      },
      {
        recruiterXp: 600,
        recruitXp: 1400,
        kills: 0,
        pvpBoostApplied: false,
        prestige: 115,
        recruitPrestige: 1150,
      },
      {
        recruiterXp: 1400,
        recruitXp: 600,
        kills: 5,
        pvpBoostApplied: true,
        prestige: 116,
        recruitPrestige: 1000,
      },
    ])(
      "pays/logs $prestige prestige with recruiter XP=$recruiterXp and frozen=$pvpBoostApplied",
      async ({
        recruiterXp,
        recruitXp,
        kills,
        pvpBoostApplied,
        prestige,
        recruitPrestige,
      }) => {
        await seed(recruiterXp, recruitXp, kills);
        const db = await getTestDatabase();
        const recruit = (await db.query.userData.findFirst({
          where: eq(userData.userId, RECRUIT),
        }))!;
        await updateRewards({
          client: db,
          user: recruit,
          rewards: PostProcessedRewardSchema.parse({ reward_prestige: 1000 }),
          reason: "QUEST",
          pvpBoostApplied,
        });
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, RECRUIT) }),
        ).toMatchObject({ villagePrestige: recruitPrestige });
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, RECRUITER) }),
        ).toMatchObject({ villagePrestige: prestige });
        expect(await db.query.recruitmentRewards.findMany()).toMatchObject([
          {
            userId: RECRUITER,
            recruitedUserId: RECRUIT,
            amount: prestige,
            type: "PRESTIGE",
          },
        ]);
      },
    );

    it.each([
      { recruiterXp: 1400, recruitXp: 600, kills: 0, amount: 15306 },
      { recruiterXp: 600, recruitXp: 1400, kills: 0, amount: 13310 },
      { recruiterXp: 1400, recruitXp: 600, kills: 5, amount: 15472 },
    ])(
      "pays/logs $amount integer level-up ryo with recruiter XP=$recruiterXp",
      async ({ recruiterXp, recruitXp, kills, amount }) => {
        await seed(recruiterXp, recruitXp, kills);
        const db = await getTestDatabase();
        expect(
          (await (await callerFor(profileRouter, RECRUIT)).levelUp()).success,
        ).toBe(true);
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, RECRUITER) }),
        ).toMatchObject({ bank: amount });
        expect(await db.query.recruitmentRewards.findMany()).toMatchObject([
          { userId: RECRUITER, recruitedUserId: RECRUIT, amount, type: "MONEY" },
        ]);
      },
    );

    it("grants no referral reward when the level-up snapshot is rejected", async () => {
      await seed();
      const db = await getTestDatabase();
      const raced = beforeStatements(db, userData, [
        async () =>
          db.update(userData).set({ level: 11 }).where(eq(userData.userId, RECRUIT)),
      ]);
      expect(
        (await callerForDatabase(profileRouter, RECRUIT, raced).levelUp()).success,
      ).toBe(false);
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, RECRUITER) }),
      ).toMatchObject({ bank: 0 });
      expect(await db.query.recruitmentRewards.findMany()).toHaveLength(0);
    });
  },
);
