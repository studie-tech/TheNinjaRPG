import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  quest,
  userData,
  village,
  war,
  warActionReceipt,
  warAlly,
  warContribution,
  warMercenary,
} from "@/drizzle/schema";
import { warRouter } from "@/server/api/routers/war";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../../setup/factories";
import { overrideQuery } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const startEspionage = async () => {
  const db = await getTestDatabase();
  const spy = callerForDatabase(warRouter, "spy", db);
  const started = await spy.startWarMission({
    warId: "w",
    questId: "espionage",
    objectiveId: "spy",
  });
  expect(started.success, started.message).toBe(true);
  const attempt = (await db.query.userData.findFirst({
    where: eq(userData.userId, "spy"),
  }))!.warMission!;
  await db
    .update(userData)
    .set({
      warMission: { ...attempt, endsAt: new Date(Date.now() - 1000).toISOString() },
    })
    .where(eq(userData.userId, "spy"));
  return { db, spy, attempt };
};

describeWithDatabase("war mission completion", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(
      warActionReceipt,
      warContribution,
      warMercenary,
      warAlly,
      war,
      quest,
      village,
      userData,
    );
    await db.insert(village).values([
      { id: "a", name: "A", sector: 1, kageId: "kage-a" },
      { id: "b", name: "B", sector: 2, kageId: "kage-b" },
    ]);
    await insertUsers([{ userId: "spy", villageId: "a", rank: "JONIN", sector: 2 }]);
    await db.insert(war).values({
      id: "w",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      attackerVillageId: "a",
      defenderVillageId: "b",
      combatStartedAt: new Date(Date.now() - 3600000),
      rules: defaultWarRules,
      objectiveState: { attackerEspionage: 0, defenderEspionage: 0, objectives: [] },
    });
    await db.insert(quest).values({
      id: "espionage",
      name: "Spy",
      questType: "war",
      questRank: "C",
      hidden: false,
      content: {
        objectives: [
          SimpleObjective.parse({
            id: "spy",
            task: "espionage",
            durationSeconds: 1,
            value: 10,
          }),
        ],
        reward: ObjectiveReward.parse({}),
        sceneBackground: "",
        sceneCharacters: [],
      },
    });
  });

  it("reads the mission's war beside the actor before the claim", async () => {
    const { db, spy, attempt } = await startEspionage();
    const measured = await recordQueries(() =>
      spy.completeWarMission({ attemptId: attempt.id }),
    );
    expect(measured.result.success, measured.result.message).toBe(true);
    // Actor, settings, war and contract reads share the first wave; the rest is the claim.
    expect(measured.roundTrips).toBe(8);
    expect((await db.query.war.findFirst())?.objectiveState?.attackerEspionage).toBe(
      10,
    );
  });

  it("reads the attempt's war again when the first read resolved another war", async () => {
    const { db, attempt } = await startEspionage();
    let warReads = 0;
    const skewed = overrideQuery(db, "war", {
      findFirst: (read, ...args) => (warReads++ === 0 ? undefined : read(...args)),
    });
    const completed = await callerForDatabase(
      warRouter,
      "spy",
      skewed,
    ).completeWarMission({ attemptId: attempt.id });
    expect(completed.success, completed.message).toBe(true);
    expect(warReads).toBe(2);
    expect((await db.query.war.findFirst())?.objectiveState?.attackerEspionage).toBe(
      10,
    );
  });
});
