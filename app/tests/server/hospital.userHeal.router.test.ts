// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEDNIN_REQUIRED_EXP,
  SENSEI_GENIN_MED_EXP_SHARE_PERC,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/routers/profile";
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
const TARGET_ID = "hospital-heal-target";
const STUDENT_ID = "hospital-heal-student";

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

const insertLegendaryHealer = async (
  overrides: Partial<typeof userData.$inferInsert> = {},
) =>
  insertUsers([
    {
      userId: USER_ID,
      username: "HospitalSelfHealer",
      rank: "JONIN",
      status: "AWAKE",
      curHealth: 100,
      maxHealth: 1000,
      curChakra: 8000,
      maxChakra: 8000,
      curStamina: 100,
      maxStamina: 100,
      regeneration: 0,
      regenAt: new Date(),
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
      ...overrides,
    },
  ]);

const readHealer = async (userId = USER_ID) => {
  const database = await getTestDatabase();
  return database.query.userData.findFirst({ where: eq(userData.userId, userId) });
};

// LEGENDARY heal factor is 0.15 and MEDNIN_HEAL_TO_EXP is 0.1, so healing 900 HP costs
// 135 chakra and pays 90 exp to another user, 45 to yourself.
describeWithDatabase("hospital self-healing", () => {
  let trigger: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetTables(userData);
    trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("charges chakra, restores health and awards half experience in one update", async () => {
    await insertLegendaryHealer();
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(true);
    expect(result.message).toContain("healed yourself");
    expect(result.chakraCost).toBeCloseTo(135);
    expect(result.expGain).toBe(45);
    const saved = await readHealer();
    expect(saved?.curHealth).toBe(1000);
    expect(saved?.curChakra).toBe(7865);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY + 45);
    // The returned row lets the client patch its cache instead of refetching the profile
    expect(result.healer).toMatchObject({
      curHealth: 1000,
      curChakra: 7865,
      curStamina: 100,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY + 45,
    });
    expect(result.healer?.regenAt.getTime()).toBe(saved?.regenAt.getTime());
  });

  it("never restores chakra on a self-heal, so the heal cannot refund its own cost", async () => {
    await insertLegendaryHealer({ curChakra: 7100 });
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(true);
    expect(result.chakraCost).toBeCloseTo(135);
    const saved = await readHealer();
    expect(saved?.curHealth).toBe(1000);
    expect(saved?.curChakra).toBe(6965);
  });

  it("rejects a self-heal when only chakra is missing", async () => {
    await insertLegendaryHealer({ curHealth: 1000, curChakra: 4000 });
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(false);
    const saved = await readHealer();
    expect(saved?.curChakra).toBe(4000);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY);
  });

  it("does not notify the healer about their own heal", async () => {
    await insertLegendaryHealer();
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(true);
    expect(trigger).not.toHaveBeenCalledWith(
      USER_ID,
      "event",
      expect.objectContaining({ type: "userMessage" }),
    );
  });

  it("allows only one of two concurrent self-heals from the same snapshot", async () => {
    await insertLegendaryHealer();
    const api = await callerFor(hospitalRouter, USER_ID);

    const results = await Promise.all([
      api.userHeal({ userId: USER_ID, healPercentage: 100 }),
      api.userHeal({ userId: USER_ID, healPercentage: 100 }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const saved = await readHealer();
    expect(saved?.curHealth).toBe(1000);
    expect(saved?.curChakra).toBe(7865);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY + 45);
  });

  it("does not let a delayed regeneration reopen an already completed self-heal", async () => {
    await insertLegendaryHealer();
    const database = await getTestDatabase();
    // Bootstrap profile rows before both requests read the same user concurrently.
    await fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true });

    let releaseFirstRegen!: () => void;
    let releaseSecondRegen!: () => void;
    const secondRegenReached = new Promise<void>((resolve) => {
      releaseFirstRegen = resolve;
    });
    const firstHealFinished = new Promise<void>((resolve) => {
      releaseSecondRegen = resolve;
    });
    let regenWrites = 0;
    const delayedDatabase = new Proxy(database, {
      get(target, property) {
        if (property !== "update") return Reflect.get(target, property);
        return (table: typeof userData) => {
          const builder = target.update(table);
          return {
            set(values: Record<string, unknown>) {
              const update = builder.set(values);
              return {
                async where(condition: Parameters<typeof update.where>[0]) {
                  if ("primaryElement" in values) {
                    regenWrites++;
                    if (regenWrites === 1) await secondRegenReached;
                    else if (regenWrites === 2) {
                      releaseFirstRegen();
                      await firstHealFinished;
                    }
                  }
                  return await update.where(condition);
                },
              };
            },
          };
        };
      },
    });
    const api = callerForDatabase(hospitalRouter, USER_ID, delayedDatabase);

    const first = api
      .userHeal({ userId: USER_ID, healPercentage: 100 })
      .finally(releaseSecondRegen);
    const second = api.userHeal({ userId: USER_ID, healPercentage: 100 });
    const results = await Promise.all([first, second]);

    expect(regenWrites).toBe(2);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const saved = await readHealer();
    expect(saved?.curHealth).toBe(1000);
    expect(saved?.curChakra).toBe(7865);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY + 45);
  }, 20_000);

  it("does not let a hospitalized user self-heal", async () => {
    await insertLegendaryHealer({ status: "HOSPITALIZED" });
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });

    expect(result.success).toBe(false);
    const saved = await readHealer();
    expect(saved?.curHealth).toBe(100);
    expect(saved?.curChakra).toBe(8000);
    expect(saved?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY);
  });
});

describeWithDatabase("hospital healing another user", () => {
  let trigger: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetTables(userData);
    trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertLegendaryHealer({ curHealth: 1000 });
    await insertUsers([
      {
        userId: TARGET_ID,
        username: "HospitalHealTarget",
        rank: "GENIN",
        status: "HOSPITALIZED",
        curHealth: 100,
        maxHealth: 1000,
        regeneration: 0,
        regenAt: new Date(),
      },
      {
        userId: STUDENT_ID,
        username: "HospitalHealStudent",
        rank: "GENIN",
        level: 1,
        senseiId: USER_ID,
        medicalExperience: 0,
      },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("charges the healer, heals the target, shares experience and notifies the target", async () => {
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: TARGET_ID, healPercentage: 100 });

    expect(result.success).toBe(true);
    expect(result.message).toContain("healed the target user");
    expect(result.chakraCost).toBeCloseTo(135);
    expect(result.expGain).toBe(90);
    expect(result.healer).toMatchObject({
      curHealth: 1000,
      curChakra: 7865,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY + 90,
    });
    const [healer, target, student] = await Promise.all([
      readHealer(),
      readHealer(TARGET_ID),
      readHealer(STUDENT_ID),
    ]);
    expect(healer?.curChakra).toBe(7865);
    expect(healer?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY + 90);
    expect(target?.curHealth).toBe(1000);
    expect(target?.status).toBe("HOSPITALIZED");
    expect(student?.medicalExperience).toBe(
      Math.floor((90 * SENSEI_GENIN_MED_EXP_SHARE_PERC) / 100),
    );
    expect(trigger).toHaveBeenCalledWith(
      TARGET_ID,
      "event",
      expect.objectContaining({ type: "userMessage" }),
    );
  });
});
