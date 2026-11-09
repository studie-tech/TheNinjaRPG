import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq, gt } from "drizzle-orm";
import { GET as runDailyReports } from "@/app/api/daily-reports/route";
import { userData, userReport, userReportComment } from "@/drizzle/schema";
import * as gameSettings from "@/libs/gamesettings";
import { Pusher } from "@/libs/pusher";
import * as reportQueries from "@/queries/reports";
import {
  clearUserBanWithoutActiveReport,
  noActiveReportGuard,
} from "@/queries/reports";
import { reportsRouter } from "@/server/api/routers/reports";
import { insertUsers } from "../../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const decision = {
  object_id: "case",
  comment: "Reviewed by staff",
  banTime: 1,
  banTimeUnit: "days" as const,
};

const insertCase = async (values: Partial<typeof userReport.$inferInsert> = {}) => {
  const db = await getTestDatabase();
  await db.insert(userReport).values({
    id: "case",
    reporterUserId: "staff",
    reportedUserId: "target",
    system: "user_profile",
    infraction: {},
    reason: "Sanction review",
    aiInterpretation: "",
    status: "UNVIEWED",
    ...values,
  });
};

const target = async () => {
  const db = await getTestDatabase();
  return db.query.userData.findFirst({ where: eq(userData.userId, "target") });
};

const savedDecision = async () => {
  const db = await getTestDatabase();
  const [report, comments] = await Promise.all([
    db.query.userReport.findFirst({ where: eq(userReport.id, "case") }),
    db.query.userReportComment.findMany(),
  ]);
  return { report, comments };
};

describeWithDatabase("moderation sanctions", () => {
  beforeEach(async () => {
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "staff", role: "MODERATOR" },
      { userId: "player" },
      { userId: "target", status: "HOSPITALIZED" },
    ]);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it.each([
    ["ban", "BAN_ACTIVATED", { isBanned: true, status: "AWAKE" }],
    ["silence", "SILENCE_ACTIVATED", { isSilenced: true, status: "AWAKE" }],
    ["tradeBan", "TRADE_BAN_ACTIVATED", { isTradeBanned: true }],
    ["warn", "OFFICIAL_WARNING", { isWarned: true }],
  ] as const)(
    "%s records the decision and flags the user",
    async (action, status, flags) => {
      const db = await getTestDatabase();
      await insertCase();
      const staff = callerForDatabase(reportsRouter, "staff", db);
      expect(await staff[action](decision)).toMatchObject({ success: true });
      expect(await target()).toMatchObject(flags);
      const { report, comments } = await savedDecision();
      expect(report?.status).toBe(status);
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        userId: "staff",
        reportId: "case",
        content: decision.comment,
        decision: status,
      });
    },
  );

  it("timeout is admin-resolved and ends within the hour", async () => {
    const db = await getTestDatabase();
    await insertCase();
    await db
      .update(userData)
      .set({ role: "CONTENT-ADMIN" })
      .where(eq(userData.userId, "staff"));
    const staff = callerForDatabase(reportsRouter, "staff", db);
    const result = await staff.timeout({
      object_id: "case",
      comment: decision.comment,
    });
    expect(result).toMatchObject({ success: true });
    expect(await target()).toMatchObject({ isSilenced: true });
    const { report, comments } = await savedDecision();
    expect(report).toMatchObject({ status: "TIMEOUT_ACTIVATED", adminResolved: true });
    expect(report?.banEnd?.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(comments[0]?.decision).toBe("TIMEOUT_ACTIVATED");
  });

  it("rejects a player and leaves the report and user untouched", async () => {
    const db = await getTestDatabase();
    await insertCase();
    const player = callerForDatabase(reportsRouter, "player", db);
    expect(await player.ban(decision)).toMatchObject({ success: false });
    expect(await target()).toMatchObject({ isBanned: false });
    const { report, comments } = await savedDecision();
    expect(report?.status).toBe("UNVIEWED");
    expect(comments).toEqual([]);
  });

  it("the daily job lifts a flag whose sanctions have all expired", async () => {
    const db = await getTestDatabase();
    stubCronAuth(() => null);
    await insertCase({
      status: "BAN_ACTIVATED",
      banEnd: new Date(Date.now() - 60_000),
    });
    await db
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, "target"));
    vi.spyOn(gameSettings, "lockWithDailyTimer").mockResolvedValue({
      isNewDay: true,
      isClaimed: true,
    } as Awaited<ReturnType<typeof gameSettings.lockWithDailyTimer>>);
    const response = await runDailyReports(
      new Request("http://localhost/api/daily-reports"),
    );
    expect(response.status).toBe(200);
    expect(await target()).toMatchObject({ isBanned: false });
  });

  it("a batch reset keeps the flag of a user sanctioned after the read", async () => {
    const db = await getTestDatabase();
    await insertCase({
      status: "BAN_ACTIVATED",
      banEnd: new Date(Date.now() + 86_400_000),
    });
    await db
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, "target"));
    const reset = await clearUserBanWithoutActiveReport(
      db,
      ["target"],
      noActiveReportGuard(db, userData.userId, gt),
    );
    expect(reset.rowsAffected).toBe(0);
    expect(await target()).toMatchObject({ isBanned: true });
  });

  describe("silence clearing", () => {
    const expired = { banEnd: new Date(Date.now() - 60_000) };
    const running = { banEnd: new Date(Date.now() + 86_400_000) };
    const flagTarget = async (flags: Partial<typeof userData.$inferInsert>) => {
      const db = await getTestDatabase();
      await db.update(userData).set(flags).where(eq(userData.userId, "target"));
      return db;
    };
    const runDailyJob = async () => {
      stubCronAuth(() => null);
      vi.spyOn(gameSettings, "lockWithDailyTimer").mockResolvedValue({
        isNewDay: true,
        isClaimed: true,
      } as Awaited<ReturnType<typeof gameSettings.lockWithDailyTimer>>);
      return runDailyReports(new Request("http://localhost/api/daily-reports"));
    };

    it("getBan lifts an expired silence while a ban runs", async () => {
      const db = await flagTarget({ isBanned: true, isSilenced: true });
      await insertCase({ status: "SILENCE_ACTIVATED", ...expired });
      await insertCase({ id: "ban", status: "BAN_ACTIVATED", ...running });
      await callerForDatabase(reportsRouter, "target", db).getBan();
      expect(await target()).toMatchObject({ isBanned: true, isSilenced: false });
    });

    it("the daily job lifts an expired silence while a ban runs", async () => {
      await flagTarget({ isBanned: true, isSilenced: true });
      await insertCase({ status: "SILENCE_ACTIVATED", ...expired });
      await insertCase({ id: "ban", status: "BAN_ACTIVATED", ...running });
      expect((await runDailyJob()).status).toBe(200);
      expect(await target()).toMatchObject({ isBanned: true, isSilenced: false });
    });

    it("clearing a silence report lifts the flag while a ban runs", async () => {
      const db = await flagTarget({ isBanned: true, isSilenced: true });
      await insertCase({ status: "SILENCE_ACTIVATED", ...expired });
      await insertCase({ id: "ban", status: "BAN_ACTIVATED", ...running });
      const staff = callerForDatabase(reportsRouter, "staff", db);
      expect(await staff.clear(decision)).toMatchObject({ success: true });
      expect(await target()).toMatchObject({ isBanned: true, isSilenced: false });
    });

    it.each(["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"] as const)(
      "a running %s blocks getBan, the daily job and clear",
      async (status) => {
        const db = await flagTarget({ isSilenced: true });
        await insertCase({ status: "SILENCE_ACTIVATED", ...expired });
        await insertCase({ id: "running", status, ...running });

        await callerForDatabase(reportsRouter, "target", db).getBan();
        expect(await target()).toMatchObject({ isSilenced: true });

        expect((await runDailyJob()).status).toBe(200);
        expect(await target()).toMatchObject({ isSilenced: true });

        const staff = callerForDatabase(reportsRouter, "staff", db);
        expect(await staff.clear(decision)).toMatchObject({ success: true });
        expect(await target()).toMatchObject({ isSilenced: true });
      },
    );

    it("clear rechecks running reports with the same boundary", async () => {
      const db = await flagTarget({ isSilenced: true });
      await insertCase({ status: "SILENCE_ACTIVATED", ...expired });
      const guard = vi.spyOn(reportQueries, "noActiveReportGuard");
      await callerForDatabase(reportsRouter, "staff", db).clear(decision);
      expect(guard).toHaveBeenCalledWith(db, "target", gt);
    });
  });
});
