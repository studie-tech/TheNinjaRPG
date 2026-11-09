import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, userItem, userJutsu, userNindo } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("AI cloning", () => {
  beforeEach(async () => {
    await resetTables(userNindo, userItem, userJutsu, userData);
    await insertUsers([
      { userId: "editor", role: "CONTENT-ADMIN" },
      { userId: "ai", username: "Bandit", isAi: true },
    ]);
    await (await getTestDatabase())
      .insert(userNindo)
      .values({ id: "nindo", userId: "ai", content: "Never give up" });
  });

  it("gives the clone its own copy of the source nindo", async () => {
    const editor = await callerFor(profileRouter, "editor");
    const result = await editor.cloneAi({ id: "ai" });
    expect(result.success).toBe(true);
    const db = await getTestDatabase();
    expect(
      await db.query.userNindo.findFirst({
        where: eq(userNindo.userId, result.message),
      }),
    ).toMatchObject({ content: "Never give up" });
    expect(
      await db.query.userNindo.findFirst({ where: eq(userNindo.id, "nindo") }),
    ).toMatchObject({ userId: "ai" });
  });
});
