import { beforeEach, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { jutsu, jutsuLoadout, userData, userJutsu, userVote } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import {
  insertJutsus,
  insertUsers,
  insertUserVotes,
  jutsuRow,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "auto-equip-learner";

const readLoadout = async () =>
  (
    await (
      await getTestDatabase()
    ).query.jutsuLoadout.findFirst({ where: eq(jutsuLoadout.id, "active") })
  )?.jutsuIds;

const readOwnership = async (jutsuId: string) => {
  const [row] = await (await getTestDatabase())
    .select({ equipped: userJutsu.equipped })
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, userId), eq(userJutsu.jutsuId, jutsuId)));
  return row;
};

describeWithDatabase("learning a new jutsu", () => {
  beforeEach(async () => {
    await resetTables(jutsuLoadout, userJutsu, jutsu, userVote, userData);
    await insertUsers([
      {
        userId,
        username: "AutoEquipLearner",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        money: 100_000,
        jutsuLoadout: "active",
      },
    ]);
    await insertUserVotes([{ userId }]);
    await insertJutsus([
      jutsuRow("known", { requiredRank: "STUDENT" }),
      jutsuRow("fresh", { requiredRank: "STUDENT" }),
    ]);
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values({ id: "active", userId, jutsuIds: ["known"] });
    await db
      .insert(userJutsu)
      .values({ id: "owned-known", userId, jutsuId: "known", equipped: true });
  });

  it("adds an auto-equipped jutsu to the active loadout and projects the change", async () => {
    const result = await (await callerFor(jutsuRouter, userId)).startTraining({
      jutsuId: "fresh",
    });
    expect(result.success, result.message).toBe(true);
    expect((await readOwnership("fresh"))?.equipped).toBe(true);
    expect(await readLoadout()).toEqual(["known", "fresh"]);
    expect(result.equip).toEqual({
      equipped: true,
      jutsuId: "fresh",
      loadout: { id: "active", jutsuIds: ["known"] },
    });
  });

  it("reports the equip without a loadout projection when no loadout is active", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ jutsuLoadout: null })
      .where(eq(userData.userId, userId));
    const result = await (await callerFor(jutsuRouter, userId)).startTraining({
      jutsuId: "fresh",
    });
    expect(result.success, result.message).toBe(true);
    expect(await readLoadout()).toEqual(["known"]);
    expect(result.equip).toEqual({
      equipped: true,
      jutsuId: "fresh",
      loadout: undefined,
    });
  });
});
