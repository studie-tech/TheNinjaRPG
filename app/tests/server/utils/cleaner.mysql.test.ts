import { beforeEach, expect, it } from "bun:test";
import { eq, lt, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@/drizzle/schema";
import {
  bankTransfers,
  conversation,
  dailyBankInterest,
  historicalAvatar,
  user2conversation,
  userData,
  userItem,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { cleanupOrphanRows, deleteCleanupCandidates } from "@/server/utils/cleaner";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("cleaner consistent-read candidate batches", () => {
  beforeEach(async () => {
    await resetTables(
      bankTransfers,
      historicalAvatar,
      user2conversation,
      conversation,
      userItem,
      userData,
    );
    await insertUsers([{ userId: "live", username: "live" }]);
  });

  const withoutUser = (db: DrizzleClient) =>
    notExists(
      db
        .select({ id: userData.userId })
        .from(userData)
        .where(eq(userData.userId, userItem.userId))
        .limit(1),
    );

  it("rechecks restored parents and drains subsequent keyset batches", async () => {
    const db = await getTestDatabase();
    await db.insert(userItem).values([
      { id: "a", userId: "rescued", itemId: "item" },
      { id: "b", userId: "missing", itemId: "item" },
      { id: "c", userId: "live", itemId: "item" },
    ]);
    const interleaved = beforeStatements(db, userItem, [
      () => insertUsers([{ userId: "rescued", username: "rescued" }]),
    ]);
    await deleteCleanupCandidates(
      interleaved,
      userItem,
      { id: userItem.id },
      withoutUser(db),
      1,
    );
    expect(
      (await db.select({ id: userItem.id }).from(userItem)).map(({ id }) => id).sort(),
    ).toEqual(["a", "c"]);
  });

  it("rechecks inactive-character eligibility after a player resumes", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ experience: 0 }).where(eq(userData.userId, "live"));
    const interleaved = beforeStatements(db, userData, [
      () =>
        db
          .update(userData)
          .set({ experience: 1000 })
          .where(eq(userData.userId, "live")),
    ]);
    await deleteCleanupCandidates(
      interleaved,
      userData,
      { userId: userData.userId },
      lt(userData.experience, 100),
    );
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "live") }),
    ).toBeDefined();
  });

  it("rechecks composite keys across batches and supports numeric primary keys", async () => {
    const db = await getTestDatabase();
    await db.insert(user2conversation).values([
      { conversationId: "a-rescued'会話", userId: "rescued" },
      { conversationId: "same", userId: "live" },
      { conversationId: "same", userId: "missing" },
      { conversationId: "other", userId: "missing" },
    ]);
    const missingMember = notExists(
      db
        .select({ id: userData.userId })
        .from(userData)
        .where(eq(userData.userId, user2conversation.userId))
        .limit(1),
    );
    const interleaved = beforeStatements(db, user2conversation, [
      () => insertUsers([{ userId: "rescued", username: "rescued" }]),
    ]);
    await deleteCleanupCandidates(
      interleaved,
      user2conversation,
      {
        conversationId: user2conversation.conversationId,
        userId: user2conversation.userId,
      },
      missingMember,
      1,
    );
    expect(
      (await db.select({ userId: user2conversation.userId }).from(user2conversation))
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual(["live", "rescued"]);
    await db
      .insert(historicalAvatar)
      .values([{ userId: "live" }, { userId: "missing" }]);
    await deleteCleanupCandidates(
      db,
      historicalAvatar,
      { id: historicalAvatar.id },
      notExists(
        db
          .select({ id: userData.userId })
          .from(userData)
          .where(eq(userData.userId, historicalAvatar.userId))
          .limit(1),
      ),
      1,
    );
    expect(
      await db.select({ userId: historicalAvatar.userId }).from(historicalAvatar),
    ).toEqual([{ userId: "live" }]);
  });

  it("executes every daily sweep and handles transfers without a row id", async () => {
    const db = await getTestDatabase();
    await db.insert(bankTransfers).values([
      { senderId: "missing", receiverId: "live", amount: 1 },
      { senderId: "missing", receiverId: "live", amount: 1 },
      { senderId: "live", receiverId: "missing", amount: 1 },
      { senderId: "live", receiverId: "live", amount: 1 },
    ]);
    await cleanupOrphanRows(db);
    expect(
      await db
        .select({
          senderId: bankTransfers.senderId,
          receiverId: bankTransfers.receiverId,
        })
        .from(bankTransfers),
    ).toEqual([{ senderId: "live", receiverId: "live" }]);
  });

  it("does not wait on live inventory rows that block the original orphan delete", async () => {
    const db = await getTestDatabase();
    await db.insert(userItem).values([
      { id: "a-live", userId: "live", itemId: "item" },
      { id: "b-orphan", userId: "missing", itemId: "item" },
    ]);
    const locker = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const cleaner = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    try {
      await cleaner.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await cleaner.query("SET SESSION innodb_lock_wait_timeout = 1");
      await locker.beginTransaction();
      await locker.query(
        "UPDATE UserItem SET quantity = quantity + 1 WHERE id = 'a-live'",
      );
      const client = drizzle(cleaner, {
        schema,
        mode: "default",
      }) as unknown as DrizzleClient;
      const started = performance.now();
      await deleteCleanupCandidates(
        client,
        userItem,
        { id: userItem.id },
        withoutUser(client),
      );
      console.info(
        `Candidate cleanup while live row locked: ${(performance.now() - started).toFixed(1)} ms`,
      );
      expect(
        await db.query.userItem.findFirst({ where: eq(userItem.id, "b-orphan") }),
      ).toBeUndefined();
      // Keep the old statement as the control: even with no orphans left, its
      // target scan blocks on the same live row and exhausts the lock timeout.
      await expect(
        Promise.resolve(
          client
            .delete(userItem)
            .where(
              notExists(
                client
                  .select({ id: userData.userId })
                  .from(userData)
                  .where(eq(userData.userId, userItem.userId)),
              ),
            ),
        ),
      ).rejects.toMatchObject({
        cause: { code: "ER_LOCK_WAIT_TIMEOUT" },
      });
    } finally {
      await locker.rollback();
      await Promise.all([locker.end(), cleaner.end()]);
    }
  });

  it("keeps full orphan batches from waiting on an unrelated parent insertion", async () => {
    const db = await getTestDatabase();
    await insertUsers(
      Array.from({ length: 1000 }, (_, index) => ({
        userId: `live-${index}`,
        username: `live-${index}`,
      })),
    );
    await db.insert(userItem).values([
      { id: "live-item", userId: "live", itemId: "item" },
      ...Array.from({ length: 1000 }, (_, index) => ({
        id: `orphan-${index}`,
        userId: `missing-${index}`,
        itemId: "item",
      })),
    ]);
    const locker = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const cleaner = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    try {
      await cleaner.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await cleaner.query("SET SESSION innodb_lock_wait_timeout = 1");
      await locker.beginTransaction();
      await locker.query(
        "INSERT INTO UserData (userId, username, gender) VALUES ('registering', 'registering', 'Male')",
      );
      const client = drizzle(cleaner, {
        schema,
        mode: "default",
      }) as unknown as DrizzleClient;
      await cleanupOrphanRows(client);
      expect(await db.select({ id: userItem.id }).from(userItem)).toEqual([
        { id: "live-item" },
      ]);
    } finally {
      await locker.rollback();
      await Promise.all([locker.end(), cleaner.end()]);
    }
  });

  it("keeps a dense full membership batch from locking a live membership", async () => {
    const db = await getTestDatabase();
    const memberships = [
      { conversationId: "a-live", userId: "live" },
      ...Array.from({ length: 1000 }, (_, index) => ({
        conversationId: `b-orphan-${index}`,
        userId: "missing",
      })),
    ];
    await db
      .insert(conversation)
      .values(memberships.map(({ conversationId }) => ({ id: conversationId })));
    await db.insert(user2conversation).values(memberships);
    await db.execute(sql`ANALYZE TABLE ${user2conversation}`);
    const locker = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const cleaner = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    try {
      // The literal-key join must retain primary-key access with a connection
      // collation different from the schema's default collation.
      await cleaner.query("SET NAMES utf8mb4 COLLATE utf8mb4_bin");
      await cleaner.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await cleaner.query("SET SESSION innodb_lock_wait_timeout = 1");
      await locker.beginTransaction();
      await locker.query(
        "UPDATE UsersInConversation SET lastReadAt = NOW(3) WHERE conversationId = 'a-live' AND userId = 'live'",
      );
      const client = drizzle(cleaner, {
        schema,
        mode: "default",
      }) as unknown as DrizzleClient;
      const started = performance.now();
      await cleanupOrphanRows(client);
      console.info(
        `Dense membership cleanup while live row locked: ${(performance.now() - started).toFixed(1)} ms`,
      );
      expect(
        await db
          .select({
            conversationId: user2conversation.conversationId,
            userId: user2conversation.userId,
          })
          .from(user2conversation),
      ).toEqual([{ conversationId: "a-live", userId: "live" }]);
    } finally {
      await locker.rollback();
      await Promise.all([locker.end(), cleaner.end()]);
    }
  });

  it("has a date-leading interest expiry index", async () => {
    expect(
      await indexColumns("DailyBankInterest", "DailyBankInterest_date_idx"),
    ).toEqual({ columns: ["date"], unique: false });
    const db = await getTestDatabase();
    const plan =
      await db.execute(sql`EXPLAIN FORMAT=TRADITIONAL DELETE FROM ${dailyBankInterest}
      WHERE ${dailyBankInterest.date} < '2020-01-01' ORDER BY ${dailyBankInterest.date} LIMIT 10000`);
    expect(JSON.stringify(plan)).toContain("DailyBankInterest_date_idx");
  });
});
