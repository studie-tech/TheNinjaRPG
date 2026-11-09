import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ELEMENTAL_MASTERY_CAP,
  getUserCaps,
  MAX_MASTERY_CAP,
} from "@/drizzle/constants";
import { userData, userQueue } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import { queueEnergy } from "../../../../setup/queues";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** Assigning unused experience spends only the points that land under the rank caps. */
const USER_ID = "assigner";
const { stats_cap: GENIN_STATS_CAP } = getUserCaps("GENIN");

const assigner = async (over: Partial<typeof userData.$inferInsert>) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Assigner",
      rank: "GENIN",
      masteryRanks: { ninjutsuMastery: "MASTER" },
      experience: 5_000,
      earnedExperience: 100,
      offence: 1_000,
      defence: 1_000,
      ...over,
    } as never,
  ]);
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, USER_ID));
  if (!user) throw new Error("assigner missing");
  return user;
};

const assign = (offence: number, defence: number) => ({
  offence,
  defence,
  strength: 0,
  speed: 0,
  intelligence: 0,
  willpower: 0,
});

describeWithDatabase("profile useUnusedExperiencePoints against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userData);
  });

  it("rejects Elite Jonin assignment without spending XP or changing stats", async () => {
    await assigner({ rank: "ELITE JONIN", level: 101 });
    const before = await readUser();
    const result = await (
      await callerFor(profileRouter, USER_ID)
    ).useUnusedExperiencePoints({ offence: 10, ninjutsuMastery: 10, Wind: 10 });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Elite Jonin cannot assign experience");
    expect(result.userPatch).toBeUndefined();
    expect(await readUser()).toEqual(before);
  });

  it("assigns unused points to the four jutsu masteries without granting level XP", async () => {
    await assigner({
      ninjutsuMastery: 10,
      genjutsuMastery: 10,
      taijutsuMastery: 10,
      bukijutsuMastery: 10,
    });
    const api = await callerFor(profileRouter, USER_ID);
    const result = await api.useUnusedExperiencePoints({
      ...assign(0, 0),
      ninjutsuMastery: 10,
      genjutsuMastery: 20,
      taijutsuMastery: 30,
      bukijutsuMastery: 40,
    });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user).toMatchObject({
      ninjutsuMastery: 20,
      genjutsuMastery: 30,
      taijutsuMastery: 40,
      bukijutsuMastery: 50,
      earnedExperience: 0,
      experience: 5000,
    });
    expect(result.userPatch).toMatchObject({
      ninjutsuMastery: 20,
      earnedExperience: 0,
    });
  });

  it("assigns combat, discipline and multiple elements with one XP debit", async () => {
    await assigner({ ninjutsuMastery: 10, elementalMastery: { Wind: 10, Earth: 20 } });
    const result = await (
      await callerFor(profileRouter, USER_ID)
    ).useUnusedExperiencePoints({
      ...assign(10, 0),
      ninjutsuMastery: 20,
      Wind: 30,
      Earth: 40,
    });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user).toMatchObject({
      offence: 1010,
      ninjutsuMastery: 30,
      elementalMastery: { Wind: 40, Earth: 60 },
      earnedExperience: 0,
      experience: 5010,
    });
    expect(result.userPatch).toEqual(
      expect.objectContaining({
        offence: 1010,
        ninjutsuMastery: 30,
        elementalMastery: expect.objectContaining(user.elementalMastery),
        earnedExperience: 0,
        experience: 5010,
        updatedAt: user.updatedAt,
      }),
    );
  });

  it("clamps each element to its own cap independently of discipline capacity", async () => {
    await assigner({
      ninjutsuMastery: MAX_MASTERY_CAP,
      elementalMastery: {
        Wind: ELEMENTAL_MASTERY_CAP - 5,
        Earth: ELEMENTAL_MASTERY_CAP + 10,
      },
    });
    const result = await (
      await callerFor(profileRouter, USER_ID)
    ).useUnusedExperiencePoints({
      ninjutsuMastery: 10,
      Wind: 20,
      Earth: 20,
      Lightning: 20,
    });
    expect(result.success).toBe(true);
    expect(await readUser()).toMatchObject({
      ninjutsuMastery: MAX_MASTERY_CAP,
      elementalMastery: {
        Wind: ELEMENTAL_MASTERY_CAP,
        Earth: ELEMENTAL_MASTERY_CAP + 10,
        Lightning: 20,
      },
      earnedExperience: 75,
      experience: 5000,
    });
  });

  it("charges one whole XP point to finish fractional elemental room in a mixed allocation", async () => {
    await assigner({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 0.5 } });
    const result = await (
      await callerFor(profileRouter, USER_ID)
    ).useUnusedExperiencePoints({ offence: 10, ninjutsuMastery: 20, Wind: 10 });
    expect(result.success).toBe(true);
    expect(await readUser()).toMatchObject({
      offence: 1010,
      ninjutsuMastery: 30,
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP },
      earnedExperience: 69,
      experience: 5010,
    });
    expect(result.userPatch).toMatchObject({
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP },
      earnedExperience: 69,
    });
  });

  it("preserves queued training gains when elemental allocation wakes the owner", async () => {
    await assigner({
      status: "ASLEEP",
      autoWakeUp: true,
      curEnergy: 50,
      regeneration: 0,
      isOutlaw: true,
      primaryElement: "Fire",
      secondaryElement: "Water",
    });
    await queueEnergy(USER_ID, [{ stat: "offence", energy: 40 }]);
    const before = await readUser();
    const result = await (
      await callerFor(profileRouter, USER_ID)
    ).useUnusedExperiencePoints({ offence: 10, Wind: 1 });
    expect(result).toMatchObject({
      success: true,
      actionNotice: "This action woke you up.",
    });
    const after = await readUser();
    expect(after).toMatchObject({
      status: "AWAKE",
      curEnergy: 10,
      elementalMastery: { Wind: 1 },
      earnedExperience: 89,
    });
    expect(after.offence).toBeGreaterThan(before.offence + 10);
    expect(after.experience - before.experience).toBe(
      Math.round(after.offence - before.offence),
    );
  });

  it("keeps combat and discipline allocation available asleep while rejecting mixed elemental allocation", async () => {
    await assigner({ status: "ASLEEP", autoWakeUp: false });
    const api = await callerFor(profileRouter, USER_ID);
    const rejected = await api.useUnusedExperiencePoints({
      offence: 10,
      ninjutsuMastery: 10,
      Wind: 10,
    });
    expect(rejected.success).toBe(false);
    expect(rejected.message).toContain("asleep");
    expect(rejected.userPatch).toBeUndefined();
    expect(await readUser()).toMatchObject({
      offence: 1000,
      ninjutsuMastery: 10,
      elementalMastery: {},
      earnedExperience: 100,
      experience: 5000,
    });
    expect(
      (await api.useUnusedExperiencePoints({ offence: 10, ninjutsuMastery: 10 }))
        .success,
    ).toBe(true);
    expect(await readUser()).toMatchObject({
      offence: 1010,
      ninjutsuMastery: 20,
      earnedExperience: 80,
      experience: 5010,
      status: "ASLEEP",
    });
  });

  it.each([
    ["elemental progress", { elementalMastery: { Wind: 50 } }],
    ["primary element", { primaryElement: "Wind" }],
    ["secondary element", { secondaryElement: "Wind" }],
    ["bloodline", { bloodlineId: "new-line" }],
    ["status", { status: "ASLEEP" }],
  ] satisfies Array<[string, Partial<typeof userData.$inferInsert>]>)(
    "rejects all parts of a mixed allocation after concurrent %s changes",
    async (_name, change) => {
      await assigner({});
      const database = await getTestDatabase();
      const stale = callerForDatabase(
        profileRouter,
        USER_ID,
        beforeStatements(database, userData, [
          async () => {
            await database
              .update(userData)
              .set(change)
              .where(eq(userData.userId, USER_ID));
          },
        ]),
      );
      const result = await stale.useUnusedExperiencePoints({
        offence: 10,
        ninjutsuMastery: 10,
        Wind: 10,
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Please try again");
      expect(result.userPatch).toBeUndefined();
      expect(await readUser()).toMatchObject({
        offence: 1000,
        ninjutsuMastery: 10,
        earnedExperience: 100,
        experience: 5000,
        ...change,
      });
    },
  );

  it("preserves concurrent elemental progress when only combat and discipline points are assigned", async () => {
    await assigner({});
    const database = await getTestDatabase();
    const api = callerForDatabase(
      profileRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ elementalMastery: { Wind: 50 } })
            .where(eq(userData.userId, USER_ID));
        },
      ]),
    );
    const result = await api.useUnusedExperiencePoints({
      offence: 10,
      ninjutsuMastery: 10,
    });
    expect(result.success).toBe(true);
    expect(result.userPatch).not.toHaveProperty("elementalMastery");
    expect(await readUser()).toMatchObject({
      offence: 1010,
      ninjutsuMastery: 20,
      elementalMastery: { Wind: 50 },
      earnedExperience: 80,
      experience: 5010,
    });
  });

  it("spends only mastery cap room and guards concurrent mastery changes", async () => {
    await assigner({ ninjutsuMastery: MAX_MASTERY_CAP - 5 });
    const api = await callerFor(profileRouter, USER_ID);
    expect(
      (await api.useUnusedExperiencePoints({ ...assign(0, 0), ninjutsuMastery: 10 }))
        .success,
    ).toBe(true);
    expect(await readUser()).toMatchObject({
      ninjutsuMastery: MAX_MASTERY_CAP,
      earnedExperience: 95,
      experience: 5000,
    });
    const database = await getTestDatabase();
    const stale = callerForDatabase(
      profileRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ genjutsuMastery: 50 })
            .where(eq(userData.userId, USER_ID));
        },
      ]),
    );
    expect(
      (await stale.useUnusedExperiencePoints({ ...assign(0, 0), genjutsuMastery: 10 }))
        .success,
    ).toBe(false);
    expect(await readUser()).toMatchObject({
      genjutsuMastery: 50,
      earnedExperience: 95,
    });
  });

  it("spends only the points that fit under the cap", async () => {
    await assigner({ offence: GENIN_STATS_CAP - 5 });
    const api = await callerFor(profileRouter, USER_ID);
    const result = await api.useUnusedExperiencePoints(assign(10, 0));

    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user.offence).toBe(GENIN_STATS_CAP);
    expect(user.earnedExperience).toBe(95);
    expect(user.experience).toBe(5_005);
  });

  it("keeps a stat stored above the cap when assigning elsewhere", async () => {
    await assigner({ offence: GENIN_STATS_CAP + 500 });
    const api = await callerFor(profileRouter, USER_ID);
    const result = await api.useUnusedExperiencePoints(assign(0, 20));

    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user.offence).toBe(GENIN_STATS_CAP + 500);
    expect(user.defence).toBe(1_020);
    expect(user.earnedExperience).toBe(80);
  });

  it("rejects an assignment that lands nowhere without spending", async () => {
    await assigner({ offence: GENIN_STATS_CAP });
    const api = await callerFor(profileRouter, USER_ID);
    const result = await api.useUnusedExperiencePoints(assign(10, 0));

    expect(result.success).toBe(false);
    const user = await readUser();
    expect(user.earnedExperience).toBe(100);
    expect(user.experience).toBe(5_000);
  });

  it("rejects a stale assignment without overwriting a concurrent grant", async () => {
    await assigner({});
    const database = await getTestDatabase();
    const stale = callerForDatabase(
      profileRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ defence: 1_050, experience: 5_050 })
            .where(eq(userData.userId, USER_ID));
        },
      ]),
    );
    const result = await stale.useUnusedExperiencePoints(assign(20, 0));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Please try again");
    const user = await readUser();
    expect(user.offence).toBe(1_000);
    expect(user.defence).toBe(1_050);
    expect(user.experience).toBe(5_050);
    expect(user.earnedExperience).toBe(100);
  });
});

describeWithDatabase("whole-point mastery assignment", () => {
  beforeEach(async () => {
    await resetTables(userData);
  });
  it("charges every granted point across repeated fractional requests", async () => {
    await assigner({ ninjutsuMastery: 10 });
    const api = await callerFor(profileRouter, USER_ID);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await api.useUnusedExperiencePoints({
            ...assign(0, 0),
            ninjutsuMastery: 1.49,
          })
        ).success,
      ).toBe(true);
    expect(await readUser()).toMatchObject({
      ninjutsuMastery: 13,
      earnedExperience: 97,
    });
  });
  it("does not grant a fractional cap remainder for free", async () => {
    await assigner({ ninjutsuMastery: 1499999.6 });
    const api = await callerFor(profileRouter, USER_ID);
    expect(
      (await api.useUnusedExperiencePoints({ ...assign(0, 0), ninjutsuMastery: 1.49 }))
        .success,
    ).toBe(false);
    expect(await readUser()).toMatchObject({
      ninjutsuMastery: 1499999.6,
      earnedExperience: 100,
    });
  });
});
