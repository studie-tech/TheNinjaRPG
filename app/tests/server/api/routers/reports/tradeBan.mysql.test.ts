import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, userReport, userReportComment } from "@/drizzle/schema";
import * as profileQueries from "@/queries/profile";
import { reportsRouter } from "@/server/api/routers/reports";
import { insertUsers } from "../../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const decision = {
  object_id: "trade-case",
  comment: "Lift the trade restriction after review",
  banTime: 1,
  banTimeUnit: "days" as const,
};

/**
 * Exercise real router decisions so permissions also cover persisted restrictions and audit comments.
 */
describeWithDatabase("moderator trade ban removal", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "staff", role: "MODERATOR" },
      { userId: "target", isBanned: true, isSilenced: true },
      { userId: "junior", role: "JR_MODERATOR" },
    ]);
    await db.insert(userReport).values({
      id: decision.object_id,
      reporterUserId: "staff",
      reportedUserId: "target",
      system: "user_profile",
      infraction: {},
      reason: "Trade restriction review",
      aiInterpretation: "",
      status: "UNVIEWED",
    });
  });

  it("lets a moderator lift a trade ban they imposed and records the decision", async () => {
    const db = await getTestDatabase();
    const staff = callerForDatabase(reportsRouter, "staff", db);
    expect(await staff.tradeBan(decision)).toMatchObject({ success: true, pendingReportCount: 0, userPatch: {}, userDelta: {} });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "target") }),
    ).toMatchObject({ isTradeBanned: true });
    await db.insert(userReport).values([
      {
        id: "ban",
        reportedUserId: "target",
        system: "user_profile",
        infraction: {},
        reason: "Independent ban",
        aiInterpretation: "",
        status: "BAN_ACTIVATED",
        banEnd: new Date(Date.now() + 86_400_000),
      },
      {
        id: "silence",
        reportedUserId: "target",
        system: "user_profile",
        infraction: {},
        reason: "Independent silence",
        aiInterpretation: "",
        status: "SILENCE_ACTIVATED",
        banEnd: new Date(Date.now() + 86_400_000),
      },
    ]);

    expect(await staff.clear(decision)).toMatchObject({ success: true, pendingReportCount: 0, userPatch: {}, userDelta: {} });
    expect(
      await db.query.userReport.findFirst({
        where: eq(userReport.id, decision.object_id),
      }),
    ).toMatchObject({ status: "REPORT_CLEARED" });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "target") }),
    ).toMatchObject({ isTradeBanned: false, isBanned: true, isSilenced: true });
    expect(
      await db.query.userReportComment.findMany({
        where: eq(userReportComment.reportId, decision.object_id),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "staff",
          decision: "REPORT_CLEARED",
          content: decision.comment,
        }),
      ]),
    );
  });

  it("keeps a committed moderation decision successful when optional report counts fail", async () => {
    const db = await getTestDatabase();
    vi.spyOn(profileQueries, "selectUserReportForGetUser").mockRejectedValueOnce(new Error("Report count unavailable"));
    const result = await callerForDatabase(reportsRouter, "staff", db).tradeBan(decision);
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(result.pendingReportCount).toBeUndefined();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "target") })).toMatchObject({ isTradeBanned: true });
    expect(await db.query.userReportComment.findMany()).toHaveLength(1);
  });

  it("keeps trading restricted until the last active trade ban is cleared", async () => {
    const db = await getTestDatabase();
    const staff = callerForDatabase(reportsRouter, "staff", db);
    expect(await staff.tradeBan(decision)).toMatchObject({ success: true });
    await db.insert(userReport).values({
      id: "second-trade-case",
      reportedUserId: "target",
      system: "user_profile",
      infraction: {},
      reason: "Independent trade ban",
      aiInterpretation: "",
      status: "TRADE_BAN_ACTIVATED",
      banEnd: new Date(Date.now() + 86_400_000),
    });
    expect(await staff.clear(decision)).toMatchObject({ success: true });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "target") }),
    ).toMatchObject({ isTradeBanned: true });
    expect(
      await staff.clear({ ...decision, object_id: "second-trade-case" }),
    ).toMatchObject({ success: true });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "target") }),
    ).toMatchObject({ isTradeBanned: false });
  });

  it.each(["target", "junior"])(
    "rejects clearing by %s without changing the ban",
    async (userId) => {
      const db = await getTestDatabase();
      expect(
        await callerForDatabase(reportsRouter, "staff", db).tradeBan(decision),
      ).toMatchObject({ success: true });
      expect(
        await callerForDatabase(reportsRouter, userId, db).clear(decision),
      ).toMatchObject({ success: false });
      expect(
        await db.query.userReport.findFirst({
          where: eq(userReport.id, decision.object_id),
        }),
      ).toMatchObject({ status: "TRADE_BAN_ACTIVATED" });
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "target") }),
      ).toMatchObject({ isTradeBanned: true });
      expect(await db.query.userReportComment.findMany()).toHaveLength(1);
    },
  );
});
