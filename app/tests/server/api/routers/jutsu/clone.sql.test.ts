import { beforeEach, expect, it } from "bun:test";
import { eq, ne } from "drizzle-orm";
import { actionLog, jutsu, userData } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers, insertJutsus } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../../../../setup/testDatabase";

describeWithDatabase("jutsu clone audit atomicity", () => {
  beforeEach(async () => {
    await resetTables(actionLog, jutsu, userData);
    await insertUsers([{ userId: "clone-editor", username: "Editor", role: "CONTENT" }]);
    await insertJutsus([{ id: "clone-source", name: "Fireball", requiredRank: "GENIN" }]);
  });

  it("rolls back the copy when its audit fails, then allows one clean retry", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(jutsuRouter, "clone-editor");
    await runRawSql(
      "CREATE TRIGGER reject_clone_audit BEFORE INSERT ON ActionLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit unavailable'",
    );
    try {
      await expect(caller.clone({ id: "clone-source" })).rejects.toThrow();
      expect(await database.select({ id: jutsu.id }).from(jutsu)).toEqual([
        { id: "clone-source" },
      ]);
      expect(await database.select().from(actionLog)).toEqual([]);
    } finally {
      await runRawSql("DROP TRIGGER reject_clone_audit");
    }

    const result = await caller.clone({ id: "clone-source" });
    expect(result.success).toBe(true);
    expect(await database.select({ id: jutsu.id }).from(jutsu)).toHaveLength(2);
    const logs = await database.select().from(actionLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: "clone-editor",
      relatedId: result.message,
      relatedMsg: `Clone: Fireball - copy ${result.message}`,
      changes: ["Cloned from Fireball"],
    });
  });

  it("clones maximum-length names repeatedly within the audit summary limit", async () => {
    const database = await getTestDatabase();
    await database
      .update(jutsu)
      .set({ name: "a".repeat(191) })
      .where(eq(jutsu.id, "clone-source"));
    const caller = await callerFor(jutsuRouter, "clone-editor");
    const first = await caller.clone({ id: "clone-source" });
    const second = await caller.clone({ id: "clone-source" });
    expect(first.success && second.success).toBe(true);
    expect(first.message).not.toBe(second.message);
    const copies = await database.select({ name: jutsu.name }).from(jutsu).where(ne(jutsu.id, "clone-source"));
    expect(copies).toHaveLength(2);
    expect(copies.every(({ name }) => name.length <= 191 && name.includes(" - copy "))).toBe(true);
    const logs = await database.select().from(actionLog);
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.relatedMsg?.length === 191)).toBe(true);
  });
});
