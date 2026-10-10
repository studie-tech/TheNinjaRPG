
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "bun:test";
import {
  actionLog,
  historicalIp,
  recruitmentRewards,
  recruitRankMilestone,
  recruitReferral,
  userData,
  visitorLog,
} from "@/drizzle/schema";
import { hashIp } from "@/server/utils/ipHash";
import {
  awardRecruitRankMilestones,
  checkRecruitSignupEligibility,
  fetchRecruitMilestoneSummary,
  isKnownIp,
  milestonesReachedAt,
  toRecruitEligibilityDisplay,
} from "@/server/utils/recruitment";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const RECRUITER = "recruiter";
const RECRUIT = "recruit";
const OTHER = "other-account";
const SIGNUP_IP = "203.0.113.7";

describe("milestonesReachedAt", () => {
  it("reaches every milestone at or below the rank", () => {
    const ranks = (rank: Parameters<typeof milestonesReachedAt>[0]) =>
      milestonesReachedAt(rank).map((m) => `${m.rank}:${m.reputation}`);
    expect(ranks("STUDENT")).toEqual([]);
    expect(ranks("NONE")).toEqual([]);
    expect(ranks("GENIN")).toEqual(["GENIN:1"]);
    expect(ranks("CHUNIN")).toEqual(["GENIN:1", "CHUNIN:5"]);
    expect(ranks("JONIN")).toEqual(["GENIN:1", "CHUNIN:5", "JONIN:10"]);
    // Elders are chosen from Jonin and rank below Elite Jonin.
    expect(ranks("ELDER")).toEqual(ranks("JONIN"));
    expect(ranks("ELITE JONIN")).toEqual([
      "GENIN:1",
      "CHUNIN:5",
      "JONIN:10",
      "ELITE JONIN:10",
    ]);
  });
});

describe("isKnownIp", () => {
  it("rejects the placeholders a missing header produces", () => {
    expect(isKnownIp(undefined)).toBe(false);
    expect(isKnownIp(null)).toBe(false);
    expect(isKnownIp("")).toBe(false);
    expect(isKnownIp("unknown")).toBe(false);
    expect(isKnownIp(SIGNUP_IP)).toBe(true);
  });
});

describe("toRecruitEligibilityDisplay", () => {
  it("never shows more than eligible, shared IP or unverified", () => {
    expect(
      toRecruitEligibilityDisplay({ isEligible: true, eligibilityReason: "IP_UNKNOWN" }),
    ).toBe("ELIGIBLE");
    expect(
      toRecruitEligibilityDisplay({ isEligible: false, eligibilityReason: "SHARED_IP" }),
    ).toBe("SHARED_IP");
    expect(
      toRecruitEligibilityDisplay({
        isEligible: false,
        eligibilityReason: "BACKFILL_SHARED_IP",
      }),
    ).toBe("SHARED_IP");
    expect(
      toRecruitEligibilityDisplay({
        isEligible: false,
        eligibilityReason: "BACKFILL_UNVERIFIED",
      }),
    ).toBe("UNVERIFIED");
    expect(
      toRecruitEligibilityDisplay({ isEligible: false, eligibilityReason: "SELF_REFERRAL" }),
    ).toBe("UNVERIFIED");
    expect(toRecruitEligibilityDisplay(undefined)).toBe("UNVERIFIED");
  });
});

const recruiterRow = async () => {
  const database = await getTestDatabase();
  const row = await database.query.userData.findFirst({
    where: eq(userData.userId, RECRUITER),
    columns: {
      reputationPoints: true,
      reputationPointsTotal: true,
      unreadRecruitRewards: true,
    },
  });
  if (!row) throw new Error("recruiter missing");
  return row;
};

const milestoneRows = async () => {
  const database = await getTestDatabase();
  return database
    .select({
      rank: recruitRankMilestone.rank,
      status: recruitRankMilestone.status,
      reputationAwarded: recruitRankMilestone.reputationAwarded,
    })
    .from(recruitRankMilestone)
    .where(eq(recruitRankMilestone.recruitUserId, RECRUIT))
    .orderBy(asc(recruitRankMilestone.id));
};

const insertReferral = async (
  isEligible: boolean,
  eligibilityReason: typeof recruitReferral.$inferInsert.eligibilityReason = isEligible
    ? "IP_NOT_SHARED"
    : "SHARED_IP",
) => {
  const database = await getTestDatabase();
  await database
    .insert(recruitReferral)
    .values({ recruitUserId: RECRUIT, recruiterId: RECRUITER, isEligible, eligibilityReason });
};

const award = async (rank: Parameters<typeof milestonesReachedAt>[0]) =>
  awardRecruitRankMilestones({
    client: await getTestDatabase(),
    recruitUserId: RECRUIT,
    recruiterId: RECRUITER,
    rank,
  });

describeWithDatabase("awardRecruitRankMilestones", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      recruitReferral,
      recruitRankMilestone,
      recruitmentRewards,
      actionLog,
    );
    await insertUsers([
      {
        userId: RECRUITER,
        username: "recruiter",
        reputationPoints: 3,
        reputationPointsTotal: 0,
      },
      { userId: RECRUIT, username: "recruit", recruiterId: RECRUITER, rank: "STUDENT" },
    ]);
  });

  it("pays 1, 5 and 10 reputation the first time an eligible recruit reaches each rank", async () => {
    await insertReferral(true);
    expect(await award("STUDENT")).toEqual([]);
    expect(await award("GENIN")).toEqual([
      { rank: "GENIN", status: "PAID", reputation: 1 },
    ]);
    expect(await award("CHUNIN")).toEqual([
      { rank: "CHUNIN", status: "PAID", reputation: 5 },
    ]);
    expect(await award("JONIN")).toEqual([
      { rank: "JONIN", status: "PAID", reputation: 10 },
    ]);
    expect(await recruiterRow()).toEqual({
      reputationPoints: 3 + 16,
      reputationPointsTotal: 16,
      unreadRecruitRewards: 3,
    });

    const database = await getTestDatabase();
    const history = await database
      .select({ type: recruitmentRewards.type, amount: recruitmentRewards.amount })
      .from(recruitmentRewards)
      .where(eq(recruitmentRewards.userId, RECRUITER));
    expect(history.map((h) => `${h.type}:${h.amount}`).sort()).toEqual([
      "RANK_MILESTONE:1",
      "RANK_MILESTONE:10",
      "RANK_MILESTONE:5",
    ]);
    const logs = await database
      .select({ relatedId: actionLog.relatedId, relatedValue: actionLog.relatedValue })
      .from(actionLog)
      .where(eq(actionLog.userId, RECRUIT));
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.relatedId === RECRUITER)).toBe(true);
  });

  it("pays every milestone below a rank reached by skipping ranks", async () => {
    await insertReferral(true);
    expect((await award("ELDER")).map((o) => o.rank)).toEqual(["GENIN", "CHUNIN", "JONIN"]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(16);
    expect((await award("ELITE JONIN")).map((o) => o.rank)).toEqual(["ELITE JONIN"]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(26);
  });

  it("pays Elite Jonin once across Elder and Jonin round trips in any direction", async () => {
    await insertReferral(true);
    await award("JONIN");
    for (const rank of [
      "ELDER",
      "ELITE JONIN",
      "ELDER",
      "ELITE JONIN",
      "JONIN",
      "ELITE JONIN",
      "CHUNIN",
      "ELITE JONIN",
    ] as const) {
      await award(rank);
    }
    expect((await recruiterRow()).reputationPointsTotal).toBe(26);
    expect((await milestoneRows()).map((m) => `${m.rank}:${m.status}`)).toEqual([
      "GENIN:PAID",
      "CHUNIN:PAID",
      "JONIN:PAID",
      "ELITE JONIN:PAID",
    ]);
  });

  it("pays every milestone once when Elite Jonin is the first rank recorded", async () => {
    await insertReferral(true);
    const reached = await award("ELITE JONIN");
    expect(reached.map((o) => `${o.rank}:${o.reputation}`)).toEqual([
      "GENIN:1",
      "CHUNIN:5",
      "JONIN:10",
      "ELITE JONIN:10",
    ]);
    expect(await award("ELDER")).toEqual([]);
    expect(await award("ELITE JONIN")).toEqual([]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(26);
  });

  it("never pays a milestone twice across retries, demotion and re-promotion", async () => {
    await insertReferral(true);
    await award("CHUNIN");
    expect(await award("CHUNIN")).toEqual([]);
    expect(await award("STUDENT")).toEqual([]);
    expect(await award("GENIN")).toEqual([]);
    expect(await award("CHUNIN")).toEqual([]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(6);
    expect(await milestoneRows()).toHaveLength(2);
  });

  it("pays once when the same promotion is recorded concurrently", async () => {
    await insertReferral(true);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => award("CHUNIN")),
    );
    const applied = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    expect(applied.map((o) => o.rank).sort()).toEqual(["CHUNIN", "GENIN"]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(6);
    expect(await milestoneRows()).toHaveLength(2);
  });

  it("records but never pays milestones of an ineligible recruit", async () => {
    await insertReferral(false);
    expect(await award("CHUNIN")).toEqual([
      { rank: "GENIN", status: "INELIGIBLE", reputation: 0 },
      { rank: "CHUNIN", status: "INELIGIBLE", reputation: 0 },
    ]);
    expect(await recruiterRow()).toMatchObject({
      reputationPoints: 3,
      reputationPointsTotal: 0,
      unreadRecruitRewards: 0,
    });
    const database = await getTestDatabase();
    expect(await database.select().from(recruitmentRewards)).toHaveLength(0);

    // Becoming eligible later only affects ranks not reached yet.
    await database
      .update(recruitReferral)
      .set({ isEligible: true })
      .where(eq(recruitReferral.recruitUserId, RECRUIT));
    expect(await award("JONIN")).toEqual([
      { rank: "JONIN", status: "PAID", reputation: 10 },
    ]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(10);
  });

  it("treats a recruit without a referral record as ineligible", async () => {
    expect(await award("GENIN")).toEqual([
      { rank: "GENIN", status: "INELIGIBLE", reputation: 0 },
    ]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(0);
  });

  it("does not back-pay ranks recorded as already held", async () => {
    await insertReferral(true);
    const database = await getTestDatabase();
    await database.insert(recruitRankMilestone).values([
      { recruitUserId: RECRUIT, recruiterId: RECRUITER, rank: "GENIN", status: "PRE_EXISTING" },
      { recruitUserId: RECRUIT, recruiterId: RECRUITER, rank: "CHUNIN", status: "PRE_EXISTING" },
    ]);
    expect(await award("CHUNIN")).toEqual([]);
    expect(await award("JONIN")).toEqual([
      { rank: "JONIN", status: "PAID", reputation: 10 },
    ]);
    expect((await recruiterRow()).reputationPointsTotal).toBe(10);
  });

  it("records a deleted recruiter's milestones without paying anyone", async () => {
    await insertReferral(true);
    const database = await getTestDatabase();
    await database.delete(userData).where(eq(userData.userId, RECRUITER));
    expect(await award("GENIN")).toEqual([
      { rank: "GENIN", status: "NO_RECRUITER", reputation: 0 },
    ]);
  });

  it("does nothing for a player without a recruiter", async () => {
    const result = await awardRecruitRankMilestones({
      client: await getTestDatabase(),
      recruitUserId: RECRUIT,
      recruiterId: null,
      rank: "JONIN",
    });
    expect(result).toEqual([]);
    expect(await milestoneRows()).toEqual([]);
  });

  it("summarises eligibility and milestones for the recruiter only", async () => {
    await insertReferral(true);
    await award("GENIN");
    const summary = await fetchRecruitMilestoneSummary(await getTestDatabase(), RECRUITER);
    expect(summary).toEqual([
      {
        recruitUserId: RECRUIT,
        eligibility: "ELIGIBLE",
        milestones: [
          {
            rank: "GENIN",
            reputation: 1,
            reached: true,
            paid: true,
            status: "PAID",
            reputationAwarded: 1,
          },
          ...(["CHUNIN", "JONIN", "ELITE JONIN"] as const).map((rank) => ({
            rank,
            reputation: rank === "CHUNIN" ? 5 as const : 10 as const,
            reached: false,
            paid: false,
            status: null,
            reputationAwarded: 0,
          })),
        ],
      },
    ]);
    expect(await fetchRecruitMilestoneSummary(await getTestDatabase(), OTHER)).toEqual([]);
  });
});

describeWithDatabase("checkRecruitSignupEligibility", () => {
  beforeEach(async () => {
    await resetTables(userData, historicalIp, visitorLog);
    await insertUsers([
      { userId: RECRUITER, username: "recruiter", lastIp: "198.51.100.1" },
      { userId: OTHER, username: "other", lastIp: "198.51.100.2" },
      { userId: RECRUIT, username: "recruit", lastIp: SIGNUP_IP, recruiterId: RECRUITER },
    ]);
  });

  const check = async (signupIp: string | null | undefined, recruiterId = RECRUITER) =>
    checkRecruitSignupEligibility({
      client: await getTestDatabase(),
      recruitUserId: RECRUIT,
      recruiterId,
      signupIp,
    });

  it("is eligible when only the recruit's own records and visitor tracking hold the IP", async () => {
    const database = await getTestDatabase();
    await Promise.all([
      database
        .insert(historicalIp)
        .values({ userId: RECRUIT, ip: SIGNUP_IP, ipHash: hashIp(SIGNUP_IP) }),
      database.insert(visitorLog).values({ id: nanoid(), ipHash: hashIp(SIGNUP_IP) }),
    ]);
    expect(await check(SIGNUP_IP)).toEqual({ isEligible: true, reason: "IP_NOT_SHARED" });
  });

  it("is ineligible when another account's IP history holds the signup IP", async () => {
    const database = await getTestDatabase();
    await database
      .insert(historicalIp)
      .values({ userId: OTHER, ip: SIGNUP_IP, ipHash: hashIp(SIGNUP_IP) });
    expect(await check(SIGNUP_IP)).toEqual({ isEligible: false, reason: "SHARED_IP" });
  });

  it("is ineligible when the recruiter last played from the signup IP", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ lastIp: SIGNUP_IP })
      .where(eq(userData.userId, RECRUITER));
    expect(await check(SIGNUP_IP)).toEqual({ isEligible: false, reason: "SHARED_IP" });
  });

  it("stays eligible but records that no IP could be checked", async () => {
    for (const ip of [undefined, null, "", "unknown"]) {
      expect(await check(ip)).toEqual({ isEligible: true, reason: "IP_UNKNOWN" });
    }
  });

  it("rejects a self-referral", async () => {
    expect(await check(SIGNUP_IP, RECRUIT)).toEqual({
      isEligible: false,
      reason: "SELF_REFERRAL",
    });
  });
});
