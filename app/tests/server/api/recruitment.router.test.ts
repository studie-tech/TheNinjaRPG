
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  historicalIp,
  questHistory,
  recruitmentRewards,
  recruitRankMilestone,
  recruitReferral,
  userAttribute,
  userData,
  village,
} from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import { updateRewards } from "@/server/api/routers/quests";
import { registerRouter } from "@/server/api/routers/register";
import { hashIp } from "@/server/utils/ipHash";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../../setup/testDatabase";

const RECRUITER = "router-recruiter";
const OTHER = "router-other";
const SHARED_IP = "203.0.113.50";
const FRESH_IP = "203.0.113.51";

// The backfill is the data section of the recruit-milestone migration, after its marker.
const backfill = readFileSync(
  join(import.meta.dirname, "../../../drizzle/migrations/0054_concerned_plazm.sql"),
  "utf8",
)
  .split("-- recruit-milestones-backfill:start")[1]!
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const register = async (userId: string, signupIp: string | undefined) => {
  const database = await getTestDatabase();
  const caller = registerRouter.createCaller({
    drizzle: database,
    userId,
    userIp: signupIp,
  } as never);
  return caller.createCharacter({
    // Usernames are alphanumeric and at most 12 characters.
    username: userId.replace(/[^a-zA-Z0-9]/g, "").slice(-12),
    gender: "Male",
    hair_color: "Black",
    eye_color: "Blue",
    skin_color: "Light",
    attribute_1: "Soft features",
    attribute_2: "Glasses",
    attribute_3: "Short Hair",
    read_tos: true,
    read_privacy: true,
    read_earlyaccess: true,
    recruiter_userid: RECRUITER,
    utm_source: null,
    bloodlineId: "recruit-bloodline",
  });
};

const referralOf = async (userId: string) => {
  const database = await getTestDatabase();
  return database.query.recruitReferral.findFirst({
    where: eq(recruitReferral.recruitUserId, userId),
  });
};

const recruiterRep = async () => {
  const database = await getTestDatabase();
  const row = await database.query.userData.findFirst({
    where: eq(userData.userId, RECRUITER),
    columns: { reputationPointsTotal: true, nRecruited: true },
  });
  return row;
};

describeWithDatabase("recruit rank milestones end to end", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      bloodline,
      bloodlineRolls,
      historicalIp,
      questHistory,
      recruitmentRewards,
      recruitRankMilestone,
      recruitReferral,
      userAttribute,
      userData,
      village,
    );
    await insertUsers([
      {
        userId: RECRUITER,
        username: "router-recruiter",
        lastIp: SHARED_IP,
        reputationPointsTotal: 0,
      },
      { userId: OTHER, username: "router-other", lastIp: "198.51.100.9" },
    ]);
    const database = await getTestDatabase();
    await Promise.all([
      database
        .insert(village)
        .values({ id: "recruit-horizon", name: "Horizon", sector: 1, kageId: OTHER }),
      database.insert(bloodline).values({
        id: "recruit-bloodline",
        name: "recruit bloodline",
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
    ]);
  });

  it("adds a recruit from a shared IP as a recruit but marks it ineligible", async () => {
    await expect(register("recruit-shared", SHARED_IP)).resolves.toMatchObject({
      success: true,
    });
    expect(await referralOf("recruit-shared")).toMatchObject({
      recruiterId: RECRUITER,
      isEligible: false,
      eligibilityReason: "SHARED_IP",
    });
    expect((await recruiterRep())?.nRecruited).toBe(1);
  });

  it("marks a recruit from a fresh IP eligible, and one without an IP eligible but unchecked", async () => {
    await register("recruit-fresh", FRESH_IP);
    await register("recruit-no-ip", undefined);
    expect(await referralOf("recruit-fresh")).toMatchObject({
      isEligible: true,
      eligibilityReason: "IP_NOT_SHARED",
    });
    expect(await referralOf("recruit-no-ip")).toMatchObject({
      isEligible: true,
      eligibilityReason: "IP_UNKNOWN",
    });
  });

  it("pays the recruiter when a rank reward promotes an eligible recruit", async () => {
    await register("recruit-fresh", FRESH_IP);
    const database = await getTestDatabase();
    const promote = async (rank: "GENIN" | "CHUNIN") => {
      const user = await database.query.userData.findFirst({
        where: eq(userData.userId, "recruit-fresh"),
      });
      if (!user) throw new Error("recruit missing");
      await updateRewards({
        client: database,
        user,
        rewards: PostProcessedRewardSchema.parse({ reward_rank: rank }),
        reason: "QUEST",
      });
    };
    await promote("GENIN");
    await promote("GENIN");
    await promote("CHUNIN");
    expect((await recruiterRep())?.reputationPointsTotal).toBe(6);

    const summary = await (await callerFor(profileRouter, RECRUITER)).getRecruitMilestones();
    expect(summary).toEqual([
      expect.objectContaining({
        recruitUserId: "recruit-fresh",
        eligibility: "ELIGIBLE",
        milestones: [
          expect.objectContaining({ rank: "GENIN", paid: true, reputationAwarded: 1 }),
          expect.objectContaining({ rank: "CHUNIN", paid: true, reputationAwarded: 5 }),
          expect.objectContaining({ rank: "JONIN", reached: false, paid: false }),
          expect.objectContaining({ rank: "ELITE JONIN", reached: false, paid: false }),
        ],
      }),
    ]);
    // The recruit's view carries nothing about the recruiter's milestones.
    expect(
      await (await callerFor(profileRouter, "recruit-fresh")).getRecruitMilestones(),
    ).toEqual([]);
  });

  it("pays Elite Jonin once when a rank reward moves an Elder there twice", async () => {
    await register("recruit-fresh", FRESH_IP);
    const database = await getTestDatabase();
    // Already an Elder: the backfill or an earlier promotion recorded the lower milestones.
    await database
      .update(userData)
      .set({ rank: "ELDER" })
      .where(eq(userData.userId, "recruit-fresh"));
    await database.insert(recruitRankMilestone).values(
      (["GENIN", "CHUNIN", "JONIN"] as const).map((rank) => ({
        recruitUserId: "recruit-fresh",
        recruiterId: RECRUITER,
        rank,
        status: "PRE_EXISTING" as const,
      })),
    );
    const moveTo = async (rank: "ELITE JONIN" | "JONIN") => {
      const user = await database.query.userData.findFirst({
        where: eq(userData.userId, "recruit-fresh"),
      });
      if (!user) throw new Error("recruit missing");
      await updateRewards({
        client: database,
        user,
        rewards: PostProcessedRewardSchema.parse({ reward_rank: rank }),
        reason: "QUEST",
      });
    };
    await moveTo("ELITE JONIN");
    await database
      .update(userData)
      .set({ rank: "ELDER" })
      .where(eq(userData.userId, "recruit-fresh"));
    await moveTo("ELITE JONIN");
    await moveTo("JONIN");
    await moveTo("ELITE JONIN");
    expect((await recruiterRep())?.reputationPointsTotal).toBe(10);
  });

  it("does not pay the recruiter for an ineligible recruit's promotion", async () => {
    await register("recruit-shared", SHARED_IP);
    const database = await getTestDatabase();
    const user = await database.query.userData.findFirst({
      where: eq(userData.userId, "recruit-shared"),
    });
    if (!user) throw new Error("recruit missing");
    await updateRewards({
      client: database,
      user,
      rewards: PostProcessedRewardSchema.parse({ reward_rank: "GENIN" }),
      reason: "QUEST",
    });
    expect((await recruiterRep())?.reputationPointsTotal).toBe(0);
    const summary = await (await callerFor(profileRouter, RECRUITER)).getRecruitMilestones();
    expect(summary[0]).toMatchObject({ eligibility: "SHARED_IP" });
    expect(summary[0]?.milestones[0]).toMatchObject({ reached: true, paid: false });
  });
});

describeWithDatabase("recruit referral backfill migration", () => {
  beforeEach(async () => {
    await resetTables(userData, historicalIp, recruitReferral, recruitRankMilestone);
  });

  it("judges old recruits on stored IPs and records held ranks as unpaid", async () => {
    await insertUsers([
      { userId: RECRUITER, username: "r", lastIp: "198.51.100.1", rank: "JONIN" },
      { userId: OTHER, username: "o", lastIp: "198.51.100.2" },
      // Shares its last IP with another account.
      { userId: "b-last", username: "b1", recruiterId: RECRUITER, lastIp: "198.51.100.2", rank: "CHUNIN" },
      // Its IP history overlaps another account's history.
      { userId: "b-hist", username: "b2", recruiterId: RECRUITER, lastIp: "192.0.2.10", rank: "STUDENT" },
      // Nothing shared.
      { userId: "b-clean", username: "b3", recruiterId: RECRUITER, lastIp: "192.0.2.11", rank: "ELDER" },
      // No IP left to check; placeholders never match each other.
      { userId: "b-none", username: "b4", recruiterId: RECRUITER, lastIp: "unknown", rank: "GENIN" },
      { userId: "b-none-2", username: "b5", recruiterId: OTHER, lastIp: "unknown" },
      // Elite Jonin holds every milestone, Elite Jonin included.
      { userId: "b-self", username: "b6", recruiterId: "b-self", lastIp: "192.0.2.12", rank: "ELITE JONIN" },
    ]);
    const database = await getTestDatabase();
    await database.insert(historicalIp).values([
      { userId: "b-hist", ip: "192.0.2.99", ipHash: hashIp("192.0.2.99") },
      { userId: OTHER, ip: "192.0.2.99", ipHash: hashIp("192.0.2.99") },
      { userId: "b-clean", ip: "192.0.2.11", ipHash: hashIp("192.0.2.11") },
    ]);
    // A milestone recorded by the application before a re-run must survive it.
    await database.insert(recruitRankMilestone).values({
      recruitUserId: "b-clean",
      recruiterId: RECRUITER,
      rank: "JONIN",
      status: "PAID",
      reputationAwarded: 10,
    });

    for (let run = 0; run < 2; run++) {
      for (const statement of backfill) await runRawSql(statement);
    }

    const referrals = await database
      .select({
        recruitUserId: recruitReferral.recruitUserId,
        isEligible: recruitReferral.isEligible,
        eligibilityReason: recruitReferral.eligibilityReason,
      })
      .from(recruitReferral)
      .orderBy(asc(recruitReferral.recruitUserId));
    expect(referrals).toEqual([
      { recruitUserId: "b-clean", isEligible: true, eligibilityReason: "BACKFILL_IP_NOT_SHARED" },
      { recruitUserId: "b-hist", isEligible: false, eligibilityReason: "BACKFILL_SHARED_IP" },
      { recruitUserId: "b-last", isEligible: false, eligibilityReason: "BACKFILL_SHARED_IP" },
      { recruitUserId: "b-none", isEligible: false, eligibilityReason: "BACKFILL_UNVERIFIED" },
      { recruitUserId: "b-none-2", isEligible: false, eligibilityReason: "BACKFILL_UNVERIFIED" },
      { recruitUserId: "b-self", isEligible: false, eligibilityReason: "SELF_REFERRAL" },
    ]);

    const milestones = await database
      .select({
        recruitUserId: recruitRankMilestone.recruitUserId,
        rank: recruitRankMilestone.rank,
        status: recruitRankMilestone.status,
      })
      .from(recruitRankMilestone);
    expect(
      milestones.map((m) => `${m.recruitUserId}:${m.rank}:${m.status}`).sort(),
    ).toEqual([
      "b-clean:CHUNIN:PRE_EXISTING",
      "b-clean:GENIN:PRE_EXISTING",
      "b-clean:JONIN:PAID",
      "b-last:CHUNIN:PRE_EXISTING",
      "b-last:GENIN:PRE_EXISTING",
      "b-none:GENIN:PRE_EXISTING",
      "b-self:CHUNIN:PRE_EXISTING",
      "b-self:ELITE JONIN:PRE_EXISTING",
      "b-self:GENIN:PRE_EXISTING",
      "b-self:JONIN:PRE_EXISTING",
    ]);
  });
});
