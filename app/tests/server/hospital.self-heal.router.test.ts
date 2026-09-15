// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDNIN_REQUIRED_EXP } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { insertUsers } from "../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../setup/serverModules";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const USER_ID = "hospital-self-heal-user";

describe("hospital self-heal loading", () => {
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("reuses the healer snapshot instead of fetching the same user twice", async () => {
    const fetchUpdatedUser = vi.fn().mockResolvedValue({
      user: {
        userId: USER_ID,
        username: "HospitalSelfHealer",
        rank: "JONIN",
        status: "HOSPITALIZED",
        isBanned: false,
        sector: 1,
        villageId: null,
        curHealth: 0,
        maxHealth: 100,
        curChakra: 7100,
        maxChakra: 8000,
        curStamina: 100,
        maxStamina: 100,
        medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
      },
    });
    stubProfile("fetchUpdatedUser", fetchUpdatedUser as never);
    const database = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
          })),
        })),
      })),
    };
    const api = callerForDatabase(hospitalRouter, USER_ID, database as never);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(false);
    expect(fetchUpdatedUser).toHaveBeenCalledTimes(1);
    expect(fetchUpdatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, forceRegen: true }),
    );
  });
});

const insertLegendaryHealer = async (status: "AWAKE" | "HOSPITALIZED" = "AWAKE") =>
  insertUsers([
    {
      userId: USER_ID,
      username: "HospitalSelfHealer",
      rank: "JONIN",
      status,
      curHealth: 100,
      maxHealth: 100,
      curChakra: 7100,
      maxChakra: 8000,
      curStamina: 100,
      maxStamina: 100,
      regeneration: 0,
      regenAt: new Date(),
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
    },
  ]);

describeWithDatabase("hospital self-healing", () => {
  beforeEach(async () => {
    await resetTables(userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("charges chakra and restores the same user's chakra in one relative update", async () => {
    await insertLegendaryHealer();
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(true);
    expect(result.chakraCost).toBeCloseTo(135);
    expect(result.expGain).toBe(45);

    const database = await getTestDatabase();
    const saved = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(saved?.curChakra).toBe(7865);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY + 45);
  });

  it("does not let a hospitalized user self-heal", async () => {
    await insertLegendaryHealer("HOSPITALIZED");
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(false);
    const database = await getTestDatabase();
    const saved = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(saved?.curChakra).toBe(7100);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY);
  });
});
