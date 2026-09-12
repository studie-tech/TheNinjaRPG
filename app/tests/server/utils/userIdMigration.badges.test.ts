// @vitest-environment node

import { asc } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { userBadge } from "@/drizzle/schema";
import { migrateUserBadges } from "@/server/utils/userIdMigration";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("user-id badge migration", () => {
  beforeEach(async () => {
    await resetTables(userBadge);
  });

  it("merges colliding memberships and preserves the earliest award", async () => {
    const database = await getTestDatabase();
    await database.insert(userBadge).values([
      {
        userId: "old-badge-user",
        badgeId: "shared-badge",
        createdAt: new Date("2026-09-10T12:00:00.000Z"),
      },
      {
        userId: "old-badge-user",
        badgeId: "old-only-badge",
        createdAt: new Date("2026-09-11T12:00:00.000Z"),
      },
      {
        userId: "new-badge-user",
        badgeId: "shared-badge",
        createdAt: new Date("2026-09-12T12:00:00.000Z"),
      },
      {
        userId: "new-badge-user",
        badgeId: "new-only-badge",
        createdAt: new Date("2026-09-09T12:00:00.000Z"),
      },
    ]);

    await database.transaction((tx) =>
      migrateUserBadges(tx, "old-badge-user", "new-badge-user"),
    );

    const rows = await database
      .select()
      .from(userBadge)
      .orderBy(asc(userBadge.badgeId));
    expect(rows).toEqual([
      expect.objectContaining({
        userId: "new-badge-user",
        badgeId: "new-only-badge",
      }),
      expect.objectContaining({
        userId: "new-badge-user",
        badgeId: "old-only-badge",
      }),
      expect.objectContaining({
        userId: "new-badge-user",
        badgeId: "shared-badge",
        createdAt: new Date("2026-09-10T12:00:00.000Z"),
      }),
    ]);
  });
});
