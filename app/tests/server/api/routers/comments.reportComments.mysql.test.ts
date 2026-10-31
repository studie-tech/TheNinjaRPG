import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { TERR_BOT_ID } from "@/drizzle/constants";
import { userData, userReport, userReportComment } from "@/drizzle/schema";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("report comments by authors without a user row", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "player", level: 50 },
      { userId: "staff", level: 50, role: "MODERATOR" },
    ]);
    const db = await getTestDatabase();
    await db.insert(userReport).values({
      id: "report",
      reporterUserId: TERR_BOT_ID,
      reportedUserId: "player",
      system: "sanction_carryover",
      infraction: {},
      reason: "Sanction re-applied from a previously deleted account.",
      aiInterpretation: "",
      status: "BAN_ACTIVATED",
      adminResolved: true,
    });
    await db.insert(userReportComment).values([
      {
        id: "bot-comment",
        userId: TERR_BOT_ID,
        reportId: "report",
        content: "The remaining sanction was re-applied.",
        decision: "BAN_ACTIVATED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "staff-comment",
        userId: "staff",
        reportId: "report",
        content: "Confirmed.",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the comments to a reader who cannot see secret data", async () => {
    const api = await callerFor(commentsRouter, "player");
    const result = await api.getReportComments({ id: "report", limit: 10 });

    expect(result.nextCursor).toBeNull();
    const byId = Object.fromEntries(result.data.map((c) => [c.id, c.user]));
    expect(byId["bot-comment"]).toBeNull();
    expect(byId["staff-comment"]).toMatchObject({
      username: "moderator",
      role: "MODERATOR",
      level: 0,
    });
  });
});
