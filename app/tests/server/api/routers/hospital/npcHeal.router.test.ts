import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import { HOSPITAL_RYO_PER_100_HP } from "@/drizzle/constants";
import { userData, villageStructure } from "@/drizzle/schema";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER_ID = "npc-heal-patient";
const VILLAGE_ID = "npc-heal-village";
const JUST_ADMITTED = () => new Date(Date.now() - 1000);
const LONG_AGO = () => new Date(Date.now() - 86_400_000);

const patient = (patch: Record<string, unknown>) => ({
  userId: USER_ID,
  username: "NpcHealPatient",
  villageId: VILLAGE_ID,
  status: "HOSPITALIZED" as const,
  curHealth: 0,
  maxHealth: 100,
  regeneration: 60,
  ...patch,
});

const saved = async () =>
  (await (
    await getTestDatabase()
  ).query.userData.findFirst({ where: eq(userData.userId, USER_ID) }))!;

describeWithDatabase("hospital npc checkout", () => {
  beforeEach(async () => {
    await resetTables(userData, villageStructure);
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("charges an early checkout", async () => {
    await insertUsers([
      patient({ money: HOSPITAL_RYO_PER_100_HP + 7, regenAt: JUST_ADMITTED() }),
    ]);
    const result = await (await callerFor(hospitalRouter, USER_ID)).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({
      success: true,
      message: "You have been healed",
      data: { curHealth: 100, money: 7 },
    });
    expect(await saved()).toMatchObject({ status: "AWAKE", curHealth: 100, money: 7 });
  });

  it("rejects an early checkout the player cannot afford", async () => {
    await insertUsers([
      patient({ money: HOSPITAL_RYO_PER_100_HP - 1, regenAt: JUST_ADMITTED() }),
    ]);
    const result = await (await callerFor(hospitalRouter, USER_ID)).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({
      success: false,
      message: "You don't have enough money",
    });
    expect(await saved()).toMatchObject({
      status: "HOSPITALIZED",
      money: HOSPITAL_RYO_PER_100_HP - 1,
    });
  });

  it("releases a finished recovery for free, even from a negative balance", async () => {
    await insertUsers([patient({ money: -50, regenAt: LONG_AGO() })]);
    const result = await (await callerFor(hospitalRouter, USER_ID)).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({ success: true, data: { money: -50 } });
    expect(await saved()).toMatchObject({
      status: "AWAKE",
      curHealth: 100,
      money: -50,
    });
  });

  it("rejects a zero-cost early checkout from a negative balance", async () => {
    await insertUsers([
      patient({ money: -50, curHealth: 100, regenAt: JUST_ADMITTED() }),
    ]);
    const result = await (await callerFor(hospitalRouter, USER_ID)).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({
      success: false,
      message: "You don't have enough money",
    });
  });

  it("does not spend money that left the account after the read", async () => {
    await insertUsers([
      patient({ money: HOSPITAL_RYO_PER_100_HP, regenAt: JUST_ADMITTED() }),
    ]);
    const database = await getTestDatabase();
    const client = beforeStatements(database, userData, [
      () =>
        database.update(userData).set({ money: 0 }).where(eq(userData.userId, USER_ID)),
    ]);
    const result = await callerForDatabase(hospitalRouter, USER_ID, client).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({
      success: false,
      message: "You don't have enough money",
    });
    expect(await saved()).toMatchObject({ status: "HOSPITALIZED", money: 0 });
  });

  it("does not release a patient who already left", async () => {
    await insertUsers([patient({ money: 0, regenAt: LONG_AGO() })]);
    const database = await getTestDatabase();
    const client = beforeStatements(database, userData, [
      () =>
        database
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, USER_ID)),
    ]);
    const result = await callerForDatabase(hospitalRouter, USER_ID, client).npcHeal({
      villageId: VILLAGE_ID,
    });
    expect(result).toMatchObject({
      success: false,
      message: "You are not hospitalized",
    });
  });
});
