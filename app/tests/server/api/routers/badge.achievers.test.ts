import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { userBadge, userData } from "@/drizzle/schema";
import { badgeRouter } from "@/routers/badge";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Exercise the public procedure without granting a signed-in user or staff role. */
const anonymousCaller = async () =>
  badgeRouter.createCaller({
    drizzle: await getTestDatabase(),
    userId: null,
    userIp: "127.0.0.1",
  } as never);

describeWithDatabase("public badge achievers", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userBadge, userData);
    await insertUsers([
      {
        userId: "a",
        username: "First",
        level: 20,
        lastIp: "203.0.113.7",
        money: 12345,
      },
      { userId: "b", username: "Second" },
      { userId: "c", username: "Third" },
    ]);
    const db = await getTestDatabase();
    // Duplicate awards, timestamp ties and orphan assignments exercise holder identity.
    await db.insert(userBadge).values([
      { userId: "a", badgeId: "badge", createdAt: new Date("2026-01-01T12:00:00Z") },
      { userId: "a", badgeId: "badge", createdAt: new Date("2026-03-01T12:00:00Z") },
      { userId: "b", badgeId: "badge", createdAt: new Date("2026-02-01T12:00:00Z") },
      { userId: "c", badgeId: "badge", createdAt: new Date("2026-02-01T12:00:00Z") },
      {
        userId: "deleted",
        badgeId: "badge",
        createdAt: new Date("2026-04-01T12:00:00Z"),
      },
      { userId: "a", badgeId: "other", createdAt: new Date("2026-05-01T12:00:00Z") },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows signed-out visitors and returns only public holder fields", async () => {
    const result = await (await anonymousCaller()).getAchievers({
      badgeId: "badge",
      order: "oldest",
    });
    expect(result.total).toBe(3);
    expect(result.users.map((user) => user.userId)).toEqual(["a", "b", "c"]);
    expect(result.users[0]?.achievedAt).toEqual(new Date("2026-01-01T12:00:00Z"));
    expect(Object.keys(result.users[0]!).sort()).toEqual([
      "achievedAt",
      "avatar",
      "level",
      "userId",
      "username",
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("paginates by award time with stable ties and no duplicate holders", async () => {
    const caller = await anonymousCaller();
    const first = await caller.getAchievers({ badgeId: "badge", limit: 2 });
    const last = await caller.getAchievers({ badgeId: "badge", limit: 2, page: 1 });
    expect(first.users.map((user) => user.userId)).toEqual(["b", "c"]);
    expect(first.hasMore).toBe(true);
    expect(last.users.map((user) => user.userId)).toEqual(["a"]);
    expect(last.hasMore).toBe(false);
    expect(last.total).toBe(3);
  });

  it("returns a settled empty result for an unowned badge or a page past the end", async () => {
    const caller = await anonymousCaller();
    expect(await caller.getAchievers({ badgeId: "missing" })).toEqual({
      users: [],
      total: 0,
      hasMore: false,
    });
    expect(await caller.getAchievers({ badgeId: "badge", page: 10 })).toEqual({
      users: [],
      total: 3,
      hasMore: false,
    });
  });

  it("rejects invalid and unbounded pagination", async () => {
    const caller = await anonymousCaller();
    for (const input of [
      { page: -1 },
      { page: 0.5 },
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
    ]) {
      await expect(
        caller.getAchievers({ badgeId: "badge", ...input }),
      ).rejects.toThrow();
    }
  });
});
