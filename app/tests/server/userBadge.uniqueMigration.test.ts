// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { userBadge } from "@/drizzle/schema";
import {
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const statements = readFileSync(
  join(
    import.meta.dirname,
    "../../drizzle/migrations/0045_user_badge_unique_assignment.sql",
  ),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const applyMigration = async () => {
  for (const statement of statements) await runRawSql(statement);
};

describeWithDatabase("UserBadge unique assignment migration", () => {
  beforeEach(async () => {
    await resetTables(userBadge);
    await runRawSql(
      "ALTER TABLE `UserBadge` DROP INDEX `UserBadge_userId_badgeId_key`",
    );
    await runRawSql("DROP TABLE IF EXISTS `_UserBadge_duplicates_0045`");
  });

  afterEach(async () => {
    await runRawSql("DROP TABLE IF EXISTS `_UserBadge_duplicates_0045`");
    await resetTables(userBadge);
    await runRawSql(
      "ALTER TABLE `UserBadge` DROP INDEX `UserBadge_userId_badgeId_key`",
    ).catch(() => undefined);
    await runRawSql(
      "ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_userId_badgeId_key` UNIQUE(`userId`,`badgeId`)",
    );
  });

  it("collapses existing duplicate groups and preserves the earliest award timestamp", async () => {
    await runRawSql(
      "INSERT INTO `UserBadge` (`userId`,`badgeId`,`createdAt`) VALUES " +
        "('u1','b1','2026-09-11 12:00:00.000')," +
        "('u1','b1','2026-09-10 12:00:00.000')," +
        "('u1','b1','2026-09-09 12:00:00.000')," +
        "('u1','b2','2026-09-08 12:00:00.000')," +
        "('u2','b1','2026-09-07 12:00:00.000')",
    );

    await applyMigration();

    const database = await getTestDatabase();
    const rows = await database
      .select({
        userId: userBadge.userId,
        badgeId: userBadge.badgeId,
        createdAt: sql<string>`DATE_FORMAT(${userBadge.createdAt}, '%Y-%m-%d %H:%i:%s')`,
      })
      .from(userBadge)
      .orderBy(asc(userBadge.userId), asc(userBadge.badgeId));
    expect(rows).toEqual([
      { userId: "u1", badgeId: "b1", createdAt: "2026-09-09 12:00:00" },
      { userId: "u1", badgeId: "b2", createdAt: "2026-09-08 12:00:00" },
      { userId: "u2", badgeId: "b1", createdAt: "2026-09-07 12:00:00" },
    ]);
    expect(await indexColumns("UserBadge", "UserBadge_userId_badgeId_key")).toEqual({
      columns: ["userId", "badgeId"],
      unique: true,
    });
  });

  it("is a no-op for distinct memberships and rejects a later duplicate", async () => {
    await runRawSql(
      "INSERT INTO `UserBadge` (`userId`,`badgeId`) VALUES ('u1','b1'),('u1','b2')",
    );

    await applyMigration();

    const failure: unknown = await runRawSql(
      "INSERT INTO `UserBadge` (`userId`,`badgeId`) VALUES ('u1','b1')",
    ).catch((error: unknown) => error);
    const cause = (failure as { cause?: { message?: string } })?.cause?.message;
    expect(cause ?? String(failure)).toMatch(/Duplicate entry/i);
    const database = await getTestDatabase();
    const rows = await database.select().from(userBadge);
    expect(rows).toHaveLength(2);
  });
});
