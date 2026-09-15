// @vitest-environment node

import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import { userData, villageStructure } from "@/drizzle/schema";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { insertUsers } from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const USER_ID = "hospital-recovery-user";
const VILLAGE_ID = "hospital-recovery-village";

describeWithDatabase("hospital recovery with a village bonus", () => {
  beforeEach(async () => {
    await resetTables(userData, villageStructure);
    // The mutation's deferred push is outside the healing and balance contract.
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    const database = await getTestDatabase();
    await database.insert(villageStructure).values({
      id: "hospital",
      name: "Hospital",
      image: "/hospital.png",
      villageId: VILLAGE_ID,
      level: 10,
      hospitalSpeedupPerLvl: 2,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { secondsPastDeadline: -60, recovered: false },
    { secondsPastDeadline: 5, recovered: true },
  ])("recovers=$recovered at $secondsPastDeadline seconds past the deadline", async ({
    secondsPastDeadline,
    recovered,
  }) => {
    const admission = new Date(
      Date.now() - (HOSPITAL_BASE_HEAL_SECONDS * 0.8 + secondsPastDeadline) * 1000,
    );
    await insertUsers([
      {
        userId: USER_ID,
        username: "HospitalRecovery",
        villageId: VILLAGE_ID,
        status: "HOSPITALIZED",
        curHealth: 0,
        maxHealth: 100,
        money: 0,
        regenAt: admission,
      },
    ]);
    const api = await callerFor(hospitalRouter, USER_ID);
    const result = await api.npcHeal({ villageId: VILLAGE_ID });
    expect(result.success).toBe(recovered);
    if (!recovered) expect(result.message).toBe("You don't have enough money");
    const database = await getTestDatabase();
    const saved = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(saved?.status).toBe(recovered ? "AWAKE" : "HOSPITALIZED");
    expect(saved?.curHealth).toBe(recovered ? 100 : 0);
    expect(saved?.money).toBe(0);
  });
});
