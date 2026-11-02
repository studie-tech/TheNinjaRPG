import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { COST_RESKIN_JUTSU } from "@/drizzle/constants";
import { jutsu, jutsuReskin, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const OWNER = "reskin-owner";

const jutsuRow = (id: string) => ({
  id, name: `Jutsu ${id}`, description: id, battleDescription: id, effects: [],
  target: "SELF" as const, range: 0, requiredRank: "GENIN" as const,
  jutsuType: "NORMAL" as const, image: `/${id}.png`,
});

const reskinInput = (jutsuId: string) => ({
  jutsuId, name: "New reskin", description: "New reskin description", battleDescription: "New reskin battle text",
});

const reputationOf = async () =>
  (await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, OWNER) }))?.reputationPoints;

/** Run a reskin request, reporting a thrown error as a failed result. */
const attempt = (request: Promise<{ success: boolean }>) =>
  request.then((result) => result.success, () => false);

describeWithDatabase("jutsu reskin charges", () => {
  beforeEach(async () => {
    await resetTables(jutsuReskin, userJutsu, jutsu, userData);
    const db = await getTestDatabase();
    await db.insert(jutsu).values([jutsuRow("jutsu-a"), jutsuRow("jutsu-b")]);
    await db.insert(userJutsu).values([
      { id: "uj-a", userId: OWNER, jutsuId: "jutsu-a" },
      { id: "uj-b", userId: OWNER, jutsuId: "jutsu-b" },
    ]);
  });

  it("charges once when the same reskin is submitted twice at the same time", async () => {
    await insertUsers([{ userId: OWNER, username: "Owner", reputationPoints: COST_RESKIN_JUTSU * 2 }]);
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, jutsuReskin, [async () => {
      results.push(await attempt((await callerFor(jutsuRouter, OWNER)).createReskin(reskinInput("jutsu-a"))));
    }]);
    results.unshift(await attempt(callerForDatabase(jutsuRouter, OWNER, raced).createReskin(reskinInput("jutsu-a"))));
    expect({ reputation: await reputationOf(), reskins: (await db.query.jutsuReskin.findMany()).length, results })
      .toEqual({ reputation: COST_RESKIN_JUTSU, reskins: 1, results: [false, true] });
  });

  it("never overdraws reputation when reskins of different jutsu race", async () => {
    await insertUsers([{ userId: OWNER, username: "Owner", reputationPoints: COST_RESKIN_JUTSU }]);
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, userData, [async () => {
      results.push(await attempt((await callerFor(jutsuRouter, OWNER)).createReskin(reskinInput("jutsu-b"))));
    }]);
    results.unshift(await attempt(callerForDatabase(jutsuRouter, OWNER, raced).createReskin(reskinInput("jutsu-a"))));
    expect({ reputation: await reputationOf(), reskins: (await db.query.jutsuReskin.findMany()).length, results })
      .toEqual({ reputation: 0, reskins: 1, results: [false, true] });
  });
});
