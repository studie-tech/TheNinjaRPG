import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { fetchActionUser } from "@/queries/actionReadiness";
import { updateUserDataForJoinMatch } from "@/queries/tournament";
import { prepareActionReadiness } from "@/server/utils/actionReadiness";
import { insertUsers } from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("scheduled match actor recovery", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      {
        userId: "acting-player",
        username: "acting-player",
        status: "ASLEEP",
        autoWakeUp: true,
      },
      { userId: "opponent", username: "opponent", status: "ASLEEP" },
    ]);
  });

  it("folds recovery and the scheduled participant reset into one guarded update", async () => {
    const db = await getTestDatabase();
    const readiness = prepareActionReadiness(
      await fetchActionUser(db, "acting-player"),
      [],
    );
    const result = await updateUserDataForJoinMatch(
      db,
      { userId1: "acting-player", userId2: "opponent" },
      "acting-player",
      readiness,
    );
    expect(result.rowsAffected).toBeGreaterThan(0);
    expect((await db.query.userData.findMany()).map((user) => user.status)).toEqual([
      "AWAKE",
      "AWAKE",
    ]);
  });

  it("does not wake either participant when the actor's recovery claim loses", async () => {
    const db = await getTestDatabase();
    const readiness = prepareActionReadiness(
      await fetchActionUser(db, "acting-player"),
      [],
    );
    await db
      .update(userData)
      .set({ autoWakeUp: false })
      .where(eq(userData.userId, "acting-player"));
    const result = await updateUserDataForJoinMatch(
      db,
      { userId1: "acting-player", userId2: "opponent" },
      "acting-player",
      readiness,
    );
    expect(result.rowsAffected).toBe(0);
    expect((await db.query.userData.findMany()).map((user) => user.status)).toEqual([
      "ASLEEP",
      "ASLEEP",
    ]);
  });
});
