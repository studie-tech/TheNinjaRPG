import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import type { UserCache } from "@/deltas/profile";
import {
  HOSPITAL_BASE_HEAL_SECONDS,
  MEDNIN_REQUIRED_EXP,
  REGEN_SECONDS,
  SENSEI_GENIN_MED_EXP_SHARE_PERC,
} from "@/drizzle/constants";
import {
  bloodline,
  quest,
  questHistory,
  title,
  userData,
  userTitle,
} from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { fetchUpdatedUser } from "@/routers/profile";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import {
  DialogObjective,
  QuestTracker,
  SimpleObjective,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { deferred } from "../../../../setup/deferred";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import {
  aroundStatements,
  beforeStatements,
  inTransactions,
  interceptExecute,
} from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  lockWaitObserved,
  resetTables,
} from "../../../../setup/testDatabase";
import { readUser } from "../../../../setup/userReads";

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
      query: { questHistory: { findFirst: vi.fn().mockResolvedValue(undefined) } },
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
    expect(database.select).not.toHaveBeenCalled();
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

const readHealer = (userId = USER_ID) => readUser(userId);

/** Assigns a real isolated run through its router so healing exercises persisted isolation. */
const startTargetPyramid = async (client?: DrizzleClient) => {
  await insertQuests([
    {
      id: "hospital-isolated-pyramid",
      questType: "battlepyramid",
      hidden: false,
      maxAttempts: 100,
      maxCompletes: 100,
      content: {
        isolated: true,
        entryItems: [],
        reward: ObjectiveReward.parse({}),
        sceneBackground: "",
        sceneCharacters: [],
        objectives: [
          DialogObjective.parse({ id: "enter", task: "dialog", nextObjectiveId: [] }),
        ],
      },
    },
  ]);
  const target = await readHealer(TARGET_ID);
  const api = callerForDatabase(
    questsRouter,
    TARGET_ID,
    client ?? (await getTestDatabase()),
  );
  const result = await api.startQuest({
    questId: "hospital-isolated-pyramid",
    userSector: target!.sector,
  });
  expect(result.success).toBe(true);
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

  it("preserves free checkout health while self-healing missing stamina", async () => {
    await insertLegendaryHealer({
      status: "HOSPITALIZED",
      curHealth: 1,
      curStamina: 60,
      regenAt: new Date(Date.now() - (HOSPITAL_BASE_HEAL_SECONDS + 5) * 1000),
    });
    const initial = await fetchActionUser(await getTestDatabase(), USER_ID);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["profile", USER_ID];
    cache.setQueryData(key, { userData: initial, notifications: [] });
    let reads = 0;
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return { userData: initial, notifications: [] };
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    const revision = prepareUserUpdate(cache, key);
    const api = await callerFor(hospitalRouter, USER_ID);
    const result = await api.userHeal({ userId: USER_ID, healPercentage: 100 });
    try {
      await updateUserCache(cache, key, result.healer, {
        revision,
        userRecovery: result.userRecovery,
      });
      expect(reads).toBe(0);
      const saved = await readHealer();
      expect(cache.getQueryData<UserCache>(key)?.userData).toMatchObject({
        status: "AWAKE",
        curHealth: saved?.curHealth,
        curChakra: saved?.curChakra,
        curStamina: saved?.curStamina,
        curEnergy: saved?.curEnergy,
        medicalExperience: saved?.medicalExperience,
        questData: saved?.questData,
      });
    } finally {
      unsubscribe();
      cache.clear();
    }

    expect(result).toMatchObject({
      success: true,
      actionNotice: AUTO_CHECKOUT_MESSAGE,
    });
    const saved = await readHealer();
    expect(saved).toMatchObject({ status: "AWAKE", curHealth: 1000, curStamina: 100 });
    expect(saved?.curChakra).toBeCloseTo(8000 - (result.chakraCost ?? 0));
    expect(result.healer).toMatchObject({
      curHealth: saved?.curHealth,
      curChakra: saved?.curChakra,
      curStamina: saved?.curStamina,
      medicalExperience: saved?.medicalExperience,
    });
    expect(result.healer?.regenAt.getTime()).toBe(saved?.regenAt.getTime());
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

    const { promise: secondRegenReached, resolve: releaseFirstRegen } =
      deferred<void>();
    const { promise: firstHealFinished, resolve: releaseSecondRegen } =
      deferred<void>();
    let regenWrites = 0;
    const delayedDatabase = aroundStatements(
      database,
      userData,
      async (run) => {
        regenWrites++;
        if (regenWrites === 1) await secondRegenReached;
        else if (regenWrites === 2) {
          releaseFirstRegen();
          await firstHealFinished;
        }
        return run();
      },
      { when: (set) => "primaryElement" in set },
    );
    const api = callerForDatabase(hospitalRouter, USER_ID, delayedDatabase);

    const first = api
      .userHeal({ userId: USER_ID, healPercentage: 100 })
      .finally(releaseSecondRegen);
    // Either request can reach the first regeneration write; release the delayed
    // write when either heal finishes, independent of request launch order.
    const second = api
      .userHeal({ userId: USER_ID, healPercentage: 100 })
      .finally(releaseSecondRegen);
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
    await resetTables(userData, quest, questHistory, userTitle, title);
    trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertLegendaryHealer({
      curHealth: 1000,
      questData: [
        QuestTracker.parse({
          id: "hospital-medical-quest",
          goals: [{ id: "heal", value: 0 }],
        }),
      ],
    });
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
    await insertQuests([
      {
        id: "hospital-medical-quest",
        questType: "daily",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content: {
          objectives: [
            SimpleObjective.parse({
              id: "heal",
              task: "medical_experience_gained",
              value: 1000,
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([
      { userId: USER_ID, questId: "hospital-medical-quest", questType: "daily" },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects a recipient entering isolation before delivery without charging or sharing experience", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ status: "AWAKE", isOutlaw: true })
      .where(eq(userData.userId, TARGET_ID));
    const api = callerForDatabase(
      hospitalRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => {},
        async () => {},
        async () => {
          await startTargetPyramid();
        },
      ]),
    );

    const result = await api.userHeal({ userId: TARGET_ID, healPercentage: 30 });

    expect(result.success).toBe(false);
    const [healer, target, student, run] = await Promise.all([
      readHealer(),
      readHealer(TARGET_ID),
      readHealer(STUDENT_ID),
      database.query.questHistory.findFirst({
        where: eq(questHistory.userId, TARGET_ID),
      }),
    ]);
    expect(run).toMatchObject({ isolated: true, completed: 0, endAt: null });
    expect(target?.curHealth).toBe(100);
    expect(healer?.curChakra).toBe(8000);
    expect(healer?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY);
    expect(student?.medicalExperience).toBe(0);
    expect(
      healer?.questData?.find((q) => q.id === "hospital-medical-quest")?.goals,
    ).toMatchObject([{ id: "heal", value: 0 }]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects an already isolated recipient without payment, experience or notifications", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ status: "AWAKE", isOutlaw: true })
      .where(eq(userData.userId, TARGET_ID));
    await startTargetPyramid();
    const api = await callerFor(hospitalRouter, USER_ID);

    const result = await api.userHeal({ userId: TARGET_ID, healPercentage: 30 });

    expect(result.success).toBe(false);
    expect(result.message).toContain("awake or hospitalized");
    expect((await readHealer(TARGET_ID))?.curHealth).toBe(100);
    expect(await readHealer()).toMatchObject({
      curChakra: 8000,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
    });
    expect((await readHealer(STUDENT_ID))?.medicalExperience).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("observes isolation committed while healing waits for the recipient account lock", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ status: "AWAKE", isOutlaw: true })
      .where(eq(userData.userId, TARGET_ID));
    const { promise: release, resolve: releaseAssignment } = deferred<void>();
    const { promise: locked, resolve: markLocked } = deferred<void>();
    const { promise: healingSent, resolve: markHealingSent } = deferred<void>();
    const assignmentClient = inTransactions(database, (tx) =>
      beforeStatements(tx, questHistory, [
        async () => {
          markLocked();
          await release;
        },
      ]),
    );
    let assignment: Promise<void> | undefined;
    const healingClient = interceptExecute(database, async (_query, run) => {
      assignment = startTargetPyramid(assignmentClient);
      await Promise.race([locked, assignment]);
      const pending = run();
      markHealingSent();
      return pending;
    });
    const api = callerForDatabase(hospitalRouter, USER_ID, healingClient);
    const heal = api.userHeal({ userId: TARGET_ID, healPercentage: 30 });
    let isWaiting = false;
    try {
      await healingSent;
      isWaiting = await lockWaitObserved({
        table: "UserData",
        heldLockData: TARGET_ID,
      });
    } finally {
      releaseAssignment();
    }
    const [result] = await Promise.all([heal, assignment]);
    expect(isWaiting).toBe(true);
    expect(result.success).toBe(false);
    const [healer, target, student, run] = await Promise.all([
      readHealer(),
      readHealer(TARGET_ID),
      readHealer(STUDENT_ID),
      database.query.questHistory.findFirst({
        where: eq(questHistory.userId, TARGET_ID),
      }),
    ]);
    expect(run).toMatchObject({ isolated: true, completed: 0, endAt: null });
    expect(target?.curHealth).toBe(100);
    expect(healer).toMatchObject({
      curChakra: 8000,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
    });
    expect(
      healer?.questData?.find((q) => q.id === "hospital-medical-quest")?.goals,
    ).toMatchObject([{ id: "heal", value: 0 }]);
    expect(student?.medicalExperience).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  }, 20_000);

  it.each(["snapshot", "status", "chakra", "recipient", "sql error"] as const)(
    "rejects a late %s change without payment, trackers or student shares",
    async (change) => {
      const database = await getTestDatabase();
      const api = callerForDatabase(
        hospitalRouter,
        USER_ID,
        beforeStatements(database, userData, [
          async () => {},
          async () => {
            if (change === "sql error")
              throw new Error("Healing delivery failed on purpose");
            if (change === "recipient") {
              await database.delete(userData).where(eq(userData.userId, TARGET_ID));
            } else {
              await database
                .update(userData)
                .set(
                  change === "snapshot"
                    ? { updatedAt: new Date(Date.now() + 1000) }
                    : change === "status"
                      ? { status: "ASLEEP" }
                      : { curChakra: 0 },
                )
                .where(eq(userData.userId, USER_ID));
            }
          },
        ]),
      );

      const heal = api.userHeal({ userId: TARGET_ID, healPercentage: 30 });
      if (change === "sql error") {
        await expect(heal).rejects.toThrow("Healing delivery failed on purpose");
      } else {
        const result = await heal;
        expect(result.success).toBe(false);
        expect(result.message).toContain("changed");
      }
      const [healer, target, student] = await Promise.all([
        readHealer(),
        readHealer(TARGET_ID),
        readHealer(STUDENT_ID),
      ]);
      expect(target?.curHealth).toBe(change === "recipient" ? undefined : 100);
      expect(healer?.curChakra).toBe(change === "chakra" ? 0 : 8000);
      expect(healer?.medicalExperience).toBe(MEDNIN_REQUIRED_EXP.LEGENDARY);
      expect(
        healer?.questData?.find((q) => q.id === "hospital-medical-quest")?.goals,
      ).toMatchObject([{ id: "heal", value: 0 }]);
      expect(student?.medicalExperience).toBe(0);
      expect(trigger).not.toHaveBeenCalled();
    },
  );

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
    expect(
      healer?.questData?.find((q) => q.id === "hospital-medical-quest")?.goals,
    ).toMatchObject([{ id: "heal", value: 90 }]);
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
    // The map receives the healed state, not the pre-heal snapshot.
    expect(trigger).toHaveBeenCalledWith(
      expect.any(String),
      "event",
      expect.objectContaining({ userId: TARGET_ID, curHealth: 1000 }),
    );
  });

  it("settles a hospitalized target's Energy before resetting its recovery clock", async () => {
    const database = await getTestDatabase();
    await database.insert(bloodline).values({
      id: "hospital-regen-line",
      name: "Hospital Regen Line",
      rank: "D",
      image: "",
      description: "",
      effects: [],
      regenIncrease: 100,
    });
    await database
      .update(userData)
      .set({
        level: 100,
        bloodlineId: "hospital-regen-line",
        curEnergy: 20,
        regeneration: 60,
        regenAt: new Date(Date.now() - 75000),
      })
      .where(eq(userData.userId, TARGET_ID));
    const api = await callerFor(hospitalRouter, USER_ID);
    const result = await api.userHeal({ userId: TARGET_ID, healPercentage: 100 });
    expect(result.success).toBe(true);
    const saved = await readHealer(TARGET_ID);
    const expectedEnergy = 20 + 160 * Math.floor(75 / REGEN_SECONDS);
    expect(saved?.curEnergy).toBeGreaterThanOrEqual(expectedEnergy);
    expect(saved?.curEnergy).toBeLessThan(expectedEnergy + 5);
    expect(saved?.status).toBe("HOSPITALIZED");
    expect(saved?.regenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("rejects healing across title acquisition and preserves its Energy tick on retry", async () => {
    const database = await getTestDatabase();
    const nextTick = new Date(Date.now() + 1000);
    const regenAt = new Date(nextTick.getTime() - REGEN_SECONDS * 1000);
    await database
      .update(userData)
      .set({
        curEnergy: 0,
        regeneration: 10,
        regenAt,
        joinedVillageAt: new Date(0),
      })
      .where(eq(userData.userId, TARGET_ID));
    await database.insert(title).values({
      id: "hospital-regen-title",
      name: "Hospital Recovery",
      effects: [{ type: "increaseregeneration", power: 7 }],
    });
    await insertQuests([{ id: "hospital-title-choice", questType: "story" }]);
    await insertQuestHistory([
      {
        userId: TARGET_ID,
        questId: "hospital-title-choice",
        completed: 1,
        endAt: new Date(),
        pendingRewardChoice: {
          id: "hospital-title-offer",
          pickCount: 1,
          cards: [
            {
              id: "hospital-title-card",
              field: "reward_titles",
              amount: 1,
              contentId: "hospital-regen-title",
            },
          ],
        },
      },
    ]);
    const api = callerForDatabase(
      hospitalRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => {},
        async () => {
          // The recipient is still hospitalized when its pending title-only reward is claimed.
          const claim = await (
            await callerFor(questsRouter, TARGET_ID)
          ).claimRewardChoice({
            questId: "hospital-title-choice",
            choiceId: "hospital-title-offer",
            cardIds: ["hospital-title-card"],
          });
          expect(claim.success).toBe(true);
          expect(claim.rewards?.reward_titles).toEqual(["Hospital Recovery"]);
          const owned = await database.query.userTitle.findFirst({
            where: eq(userTitle.userId, TARGET_ID),
          });
          expect(owned?.createdAt.getTime()).toBeLessThan(nextTick.getTime());
          // Delivery's SQL NOW(3) crosses the first complete tick after acquisition.
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, nextTick.getTime() - Date.now() + 20)),
          );
        },
      ]),
    );

    const rejected = await api.userHeal({ userId: TARGET_ID, healPercentage: 100 });

    expect(rejected.success).toBe(false);
    expect(rejected.message).toContain("changed");
    const [healer, target, student] = await Promise.all([
      readHealer(),
      readHealer(TARGET_ID),
      readHealer(STUDENT_ID),
    ]);
    expect(healer).toMatchObject({
      curChakra: 8000,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
    });
    expect(
      healer?.questData?.find((q) => q.id === "hospital-medical-quest")?.goals,
    ).toMatchObject([{ id: "heal", value: 0 }]);
    expect(target).toEqual(
      expect.objectContaining({
        curHealth: 100,
        curEnergy: 0,
        regenAt,
        status: "HOSPITALIZED",
      }),
    );
    expect(student?.medicalExperience).toBe(0);
    expect(trigger).not.toHaveBeenCalled();

    const retry = await api.userHeal({ userId: TARGET_ID, healPercentage: 100 });

    expect(retry.success).toBe(true);
    expect(await readHealer(TARGET_ID)).toMatchObject({
      curHealth: 1000,
      curEnergy: 17,
      status: "HOSPITALIZED",
    });
    expect((await readHealer(TARGET_ID))?.regenAt.getTime()).toBeGreaterThan(
      nextTick.getTime(),
    );
    expect(await readHealer()).toMatchObject({
      curChakra: 7865,
      medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY + 90,
    });
    expect((await readHealer(STUDENT_ID))?.medicalExperience).toBe(
      Math.floor((90 * SENSEI_GENIN_MED_EXP_SHARE_PERC) / 100),
    );
  });

  it.each([
    { max: 1000, expected: 300 },
    { max: 250, expected: 250 },
  ])(
    "adds healing to live pools and caps at $max after another write follows the snapshot",
    async ({ max, expected }) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ curChakra: 100, maxChakra: 1000, curStamina: 100, maxStamina: 1000 })
        .where(eq(userData.userId, TARGET_ID));
      const api = callerForDatabase(
        hospitalRouter,
        USER_ID,
        beforeStatements(database, userData, [
          async () => {},
          async () => {
            await database
              .update(userData)
              .set({
                curHealth: 200,
                curChakra: 200,
                curStamina: 200,
                maxHealth: max,
                maxChakra: max,
                maxStamina: max,
              })
              .where(eq(userData.userId, TARGET_ID));
          },
        ]),
      );

      const result = await api.userHeal({ userId: TARGET_ID, healPercentage: 10 });

      expect(result.success).toBe(true);
      expect(await readHealer(TARGET_ID)).toMatchObject({
        curHealth: expected,
        curChakra: expected,
        curStamina: expected,
      });
    },
  );
});
