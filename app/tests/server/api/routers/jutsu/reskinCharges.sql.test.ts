import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { COST_RESKIN_JUTSU } from "@/drizzle/constants";
import { jutsu, jutsuReskin, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertJutsus, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const OWNER = "reskin-owner";

const reskinInput = (jutsuId: string) => ({
  jutsuId,
  name: "New reskin",
  description: "New reskin description",
  battleDescription: "New reskin battle text",
});

const reputationOf = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, OWNER) })
  )?.reputationPoints;

describeWithDatabase("jutsu reskin charges", () => {
  beforeEach(async () => {
    await resetTables(jutsuReskin, userJutsu, jutsu, userData);
    const db = await getTestDatabase();
    await insertJutsus(
      ["jutsu-a", "jutsu-b"].map((id) => ({ id, requiredRank: "GENIN" })),
    );
    await db.insert(userJutsu).values([
      { id: "uj-a", userId: OWNER, jutsuId: "jutsu-a" },
      { id: "uj-b", userId: OWNER, jutsuId: "jutsu-b" },
    ]);
  });

  it("charges once when the same reskin is submitted twice at the same time", async () => {
    await insertUsers([
      { userId: OWNER, username: "Owner", reputationPoints: COST_RESKIN_JUTSU * 2 },
    ]);
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, jutsuReskin, [
      async () => {
        results.push(
          (
            await (
              await callerFor(jutsuRouter, OWNER)
            ).createReskin(reskinInput("jutsu-a"))
          ).success,
        );
      },
    ]);
    results.unshift(
      (
        await callerForDatabase(jutsuRouter, OWNER, raced).createReskin(
          reskinInput("jutsu-a"),
        )
      ).success,
    );
    expect({
      reputation: await reputationOf(),
      reskins: (await db.query.jutsuReskin.findMany()).length,
      results,
    }).toEqual({ reputation: COST_RESKIN_JUTSU, reskins: 1, results: [false, true] });
  });

  it("never overdraws reputation when reskins of different jutsu race", async () => {
    await insertUsers([
      { userId: OWNER, username: "Owner", reputationPoints: COST_RESKIN_JUTSU },
    ]);
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, userData, [
      async () => {
        results.push(
          (
            await (
              await callerFor(jutsuRouter, OWNER)
            ).createReskin(reskinInput("jutsu-b"))
          ).success,
        );
      },
    ]);
    results.unshift(
      (
        await callerForDatabase(jutsuRouter, OWNER, raced).createReskin(
          reskinInput("jutsu-a"),
        )
      ).success,
    );
    expect({
      reputation: await reputationOf(),
      reskins: (await db.query.jutsuReskin.findMany()).length,
      results,
    }).toEqual({ reputation: 0, reskins: 1, results: [false, true] });
  });
});
