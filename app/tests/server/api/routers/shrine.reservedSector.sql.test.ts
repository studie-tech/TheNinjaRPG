import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { MAP_RESERVED_SECTORS, WAR_ESPIONAGE_TARGET } from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
  villageAlliance,
  war,
} from "@/drizzle/schema";
import { shrineRouter } from "@/server/api/routers/shrine";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const RESERVED = MAP_RESERVED_SECTORS[0]!;

const objectiveWar = (objectiveSector: number, espionage = WAR_ESPIONAGE_TARGET) => ({
  id: "w",
  type: "VILLAGE_WAR" as const,
  status: "ACTIVE" as const,
  attackerVillageId: "a",
  defenderVillageId: "b",
  combatStartedAt: new Date(Date.now() - 3600000),
  rules: defaultWarRules,
  objectiveState: {
    attackerEspionage: espionage,
    defenderEspionage: 0,
    objectives: [
      {
        id: "objective",
        sector: objectiveSector,
        villageId: "b",
        hp: 5000,
        maxHp: 5000,
        isReserve: true,
        destroyed: false,
      },
    ],
  },
});

describeWithDatabase("challengeShrine on reserved sectors", () => {
  beforeEach(async () => {
    await resetTables(
      mpvpBattleUser,
      mpvpBattleQueue,
      villageAlliance,
      war,
      sector,
      village,
      userData,
    );
    stubRateLimitTransport({ answerOtherRequests: true });
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "a", sector: 100, kageId: "kage-a" },
      { id: "b", name: "b", sector: 200, kageId: "kage-b" },
    ]);
    await db
      .insert(villageAlliance)
      .values({ id: "enemy", villageIdA: "a", villageIdB: "b", status: "ENEMY" });
    await db.insert(sector).values({ sector: RESERVED, villageId: "b" });
    await insertUsers([
      {
        userId: "hero",
        username: "hero",
        villageId: "a",
        status: "AWAKE",
        sector: RESERVED,
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  const challenge = async () =>
    callerForDatabase(shrineRouter, "hero", await getTestDatabase()).challengeShrine({
      sectorNumber: RESERVED,
    });

  it("opens a revealed enemy objective", async () => {
    await (await getTestDatabase()).insert(war).values(objectiveWar(RESERVED));
    const result = await challenge();
    expect(result.success, result.message).toBe(true);
    expect(
      await (await getTestDatabase()).query.mpvpBattleQueue.findMany(),
    ).toHaveLength(1);
  });

  it.each([
    ["no war", null],
    ["an objective war elsewhere", objectiveWar(RESERVED + 1)],
    ["an unrevealed objective", objectiveWar(RESERVED, 0)],
    [
      "a war without objective rules",
      { ...objectiveWar(RESERVED), rules: null, objectiveState: null },
    ],
  ])("stays reserved with %s", async (_label, row) => {
    if (row) await (await getTestDatabase()).insert(war).values(row);
    expect(await challenge()).toMatchObject({
      success: false,
      message: "This sector is reserved and cannot be attacked",
    });
    expect(
      await (await getTestDatabase()).query.mpvpBattleQueue.findMany(),
    ).toHaveLength(0);
  });
});
