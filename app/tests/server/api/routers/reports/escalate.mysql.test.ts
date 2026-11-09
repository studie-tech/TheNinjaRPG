import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { BanState } from "@/drizzle/constants";
import { userData, userReport, userReportComment } from "@/drizzle/schema";
import { reportsRouter } from "@/server/api/routers/reports";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const DAY_MS = 86_400_000;
const escalation = {
  object_id: "case",
  comment: "Please review my ban",
  banTime: 0,
  banTimeUnit: "days" as const,
};

/** Store one report against `subject`, filed by `reporter`. */
const insertReport = async (
  status: BanState,
  overrides: Partial<typeof userReport.$inferInsert> = {},
) =>
  (await getTestDatabase()).insert(userReport).values({
    id: "case",
    reporterUserId: "reporter",
    reportedUserId: "subject",
    system: "user_profile",
    infraction: {},
    reason: "Spam",
    aiInterpretation: "",
    status,
    banEnd: new Date(Date.now() + DAY_MS),
    ...overrides,
  });

const storedReport = async () =>
  (await getTestDatabase()).query.userReport.findFirst({
    where: eq(userReport.id, "case"),
  });
const storedSubject = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, "subject"),
  });

/**
 * Escalation is the banned user's appeal of their own active ban: only they may file it, and
 * the escalated ban keeps them banned until an admin decides.
 */
describeWithDatabase("ban escalation", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "subject", isBanned: true },
      { userId: "reporter" },
      { userId: "bystander" },
    ]);
  });

  it("lets the banned subject escalate their own active ban and stays banned", async () => {
    await insertReport("BAN_ACTIVATED");
    const subject = await callerFor(reportsRouter, "subject");
    expect(await subject.escalate(escalation)).toMatchObject({
      success: true,
      message: "Report escalated",
    });
    expect(await storedReport()).toMatchObject({ status: "BAN_ESCALATED" });
    expect(await (await getTestDatabase()).query.userReportComment.findMany()).toEqual([
      expect.objectContaining({ userId: "subject", decision: "BAN_ESCALATED" }),
    ]);
    // Loading the ban screen must not lift a ban that is waiting for an admin.
    expect(await subject.getBan()).toMatchObject({
      id: "case",
      status: "BAN_ESCALATED",
    });
    expect(await storedSubject()).toMatchObject({ isBanned: true });
  });

  it.each([
    ["an unrelated player", "bystander", "SILENCE_ACTIVATED"],
    ["an unrelated player", "bystander", "BAN_ACTIVATED"],
    ["the reporter", "reporter", "BAN_ACTIVATED"],
    ["the subject of a silence", "subject", "SILENCE_ACTIVATED"],
  ] as const)("rejects %s (%s) escalating a %s report", async (_, userId, status) => {
    await insertReport(status);
    const caller = await callerFor(reportsRouter, userId);
    expect(await caller.escalate(escalation)).toMatchObject({
      success: false,
      message: "You cannot escalate",
    });
    expect(await storedReport()).toMatchObject({ status });
    expect(await (await getTestDatabase()).query.userReportComment.findMany()).toEqual(
      [],
    );
  });

  it.each([
    ["an admin-resolved", { adminResolved: true }],
    ["an expired", { banEnd: new Date(Date.now() - DAY_MS) }],
  ])("rejects escalating %s ban", async (_, overrides) => {
    await insertReport("BAN_ACTIVATED", overrides);
    const subject = await callerFor(reportsRouter, "subject");
    expect(await subject.escalate(escalation)).toMatchObject({ success: false });
    expect(await storedReport()).toMatchObject({ status: "BAN_ACTIVATED" });
  });
});

describeWithDatabase("report listing filters", () => {
  beforeEach(async () => {
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "staff", role: "MODERATOR" },
      { userId: "alice", username: "alice" },
      { userId: "bob", username: "bob" },
      { userId: "target", username: "target" },
    ]);
    const db = await getTestDatabase();
    await db.insert(userReport).values(
      ["alice", "bob"].map((reporterUserId) => ({
        id: `by-${reporterUserId}`,
        reporterUserId,
        reportedUserId: "target",
        system: "user_profile",
        infraction: {},
        reason: "Spam",
        aiInterpretation: "",
        status: "BAN_ACTIVATED" as const,
        banEnd: new Date(Date.now() + DAY_MS),
      })),
    );
  });

  it("filters staff listings by reporter", async () => {
    const staff = await callerFor(reportsRouter, "staff");
    const result = await staff.getAll({ reporterUser: "alice", limit: 10 });
    expect(result.data.map(({ UserReport }) => UserReport.id)).toEqual(["by-alice"]);
  });

  it("ignores the reporter filter for players, who cannot see reporters", async () => {
    const target = await callerFor(reportsRouter, "target");
    const result = await target.getAll({ reporterUser: "alice", limit: 10 });
    expect(result.data.map(({ UserReport }) => UserReport.id).sort()).toEqual([
      "by-alice",
      "by-bob",
    ]);
  });
});
