import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, userData, village } from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const villageId = "prestige-home";

const prestigeOf = async (userId: string) =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) })
  )?.villagePrestige;

describeWithDatabase("Elder prestige transfers", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData, village);
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: villageId, name: "Prestige home", kageId: "kage" });
    await insertUsers([
      {
        userId: "elder",
        username: "elder",
        villageId,
        rank: "ELDER",
        villagePrestige: 100,
      },
      {
        userId: "kage",
        username: "kage",
        villageId,
        rank: "JONIN",
        villagePrestige: 0,
      },
      {
        userId: "villager",
        username: "villager",
        villageId,
        rank: "GENIN",
        villagePrestige: 0,
      },
    ]);
  });

  it("only sends prestige to the village kage", async () => {
    const result = await (await callerFor(kageRouter, "elder")).sendKagePrestige({
      kageId: "villager",
      amount: 50,
    });
    expect({
      success: result.success,
      villager: await prestigeOf("villager"),
      elder: await prestigeOf("elder"),
    }).toEqual({ success: false, villager: 0, elder: 100 });
  });

  it("never overdraws the elder when two sends race", async () => {
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, userData, [
      async () => {
        results.push(
          (
            await (
              await callerFor(kageRouter, "elder")
            ).sendKagePrestige({ kageId: "kage", amount: 100 })
          ).success,
        );
      },
    ]);
    results.unshift(
      (
        await callerForDatabase(kageRouter, "elder", raced).sendKagePrestige({
          kageId: "kage",
          amount: 100,
        })
      ).success,
    );
    expect({
      elder: await prestigeOf("elder"),
      kage: await prestigeOf("kage"),
      results,
    }).toEqual({ elder: 0, kage: 100, results: [false, true] });
  });
});
