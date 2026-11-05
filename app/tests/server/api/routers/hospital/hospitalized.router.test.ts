import { beforeEach, expect, it } from "bun:test";
import { userData, village, villageAlliance } from "@/drizzle/schema";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const HEALER_ID = "hospitalized-healer";
const VILLAGE_ID = "hospitalized-village";
const ALLIED_VILLAGE_ID = "hospitalized-allied-village";
const DISABLED_VILLAGE_ID = "hospitalized-alliance-disabled-village";

const villageRow = (id: string, sector: number, allianceSystem: boolean) => ({
  id,
  name: id,
  mapName: id,
  sector,
  description: id,
  kageId: HEALER_ID,
  allianceSystem,
});

const allianceRow = (villageIdB: string) => ({
  id: `alliance-${villageIdB}`,
  villageIdA: VILLAGE_ID,
  villageIdB,
  status: "ALLY" as const,
});

describeWithDatabase("hospital.getHospitalizedUsers", () => {
  beforeEach(async () => {
    await resetTables(userData, village, villageAlliance);
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values([
        villageRow(VILLAGE_ID, 1, true),
        villageRow(ALLIED_VILLAGE_ID, 2, true),
        villageRow(DISABLED_VILLAGE_ID, 3, false),
      ]);
    await database
      .insert(villageAlliance)
      .values([allianceRow(ALLIED_VILLAGE_ID), allianceRow(DISABLED_VILLAGE_ID)]);
    await insertUsers([
      { userId: HEALER_ID, username: "Healer", villageId: VILLAGE_ID, sector: 1 },
      {
        userId: "hospitalized-ally",
        username: "Ally",
        villageId: ALLIED_VILLAGE_ID,
        sector: 1,
        status: "HOSPITALIZED",
        curHealth: 0,
        maxHealth: 100,
      },
      {
        userId: "hospitalized-disabled",
        username: "Disabled",
        villageId: DISABLED_VILLAGE_ID,
        sector: 1,
        status: "HOSPITALIZED",
        curHealth: 0,
        maxHealth: 100,
      },
    ]);
  });

  it("lists the patients userHeal can reach", async () => {
    const api = await callerFor(hospitalRouter, HEALER_ID);
    const patients = await api.getHospitalizedUsers();
    expect(patients.map((p) => p.userId)).toEqual(["hospitalized-ally"]);
  });
});
