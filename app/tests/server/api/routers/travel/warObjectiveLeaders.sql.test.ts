import { beforeEach, expect, it } from "bun:test";
import { userData, village, war, warAlly } from "@/drizzle/schema";
import { travelRouter } from "@/server/api/routers/travel";
import { warRouter } from "@/server/api/routers/war";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const objective = (sector: number, villageId: string) => ({
  id: `objective-${sector}`,
  sector,
  villageId,
  hp: 5000,
  maxHp: 5000,
  isReserve: false,
  destroyed: false,
});

describeWithDatabase("objective visibility across war endpoints", () => {
  beforeEach(async () => {
    await resetTables(warAlly, war, village, userData);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "A", sector: 1, kageId: "attacker-kage" },
      { id: "b", name: "B", sector: 2, kageId: "defender-kage" },
      { id: "c", name: "C", sector: 3, kageId: "ally-kage" },
    ]);
    await insertUsers(
      [
        { userId: "attacker-kage", villageId: "a", rank: "JONIN" as const },
        { userId: "ally-kage", villageId: "c", rank: "JONIN" as const },
        { userId: "ally-elder", villageId: "c", rank: "ELDER" as const },
        { userId: "ally-jonin", villageId: "c", rank: "JONIN" as const },
      ].map((user) => ({
        ...user,
        username: user.userId,
        status: "AWAKE",
        sector: 9,
      })),
    );
    await db.insert(war).values({
      id: "w",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      attackerVillageId: "a",
      defenderVillageId: "b",
      combatStartedAt: new Date(Date.now() - 3600000),
      rules: defaultWarRules,
      objectiveState: {
        attackerEspionage: 0,
        defenderEspionage: 0,
        objectives: [objective(101, "b"), objective(102, "a")],
      },
    });
    await db.insert(warAlly).values({
      id: "ally",
      warId: "w",
      villageId: "c",
      supportVillageId: "a",
      tokensPaid: 0,
      acceptedAt: new Date(),
    });
  });

  it.each([
    ["the Kage of a warring village", "attacker-kage", 2],
    ["the Kage of an allied village", "ally-kage", 2],
    ["an elder of an allied village", "ally-elder", 2],
    ["a regular ally without espionage", "ally-jonin", 0],
  ])("shows %s the same objectives everywhere", async (_label, userId, expected) => {
    const db = await getTestDatabase();
    const travel = callerForDatabase(travelRouter, userId, db);
    const wars = callerForDatabase(warRouter, userId, db);
    const sector = await travel.getSectorData({ sector: 9 });
    const active = await wars.getActiveWars({ villageId: "" });
    const info = await wars.getObjectiveWarInfo({ warId: "w" });

    expect(sector.warData?.[0]?.objectiveState?.objectives).toHaveLength(expected);
    expect(active[0]?.objectiveState?.objectives).toHaveLength(expected);
    expect(info?.war.objectiveState?.objectives).toHaveLength(expected);
  });
});
