
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { getUserCaps } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/** Assigning unused experience spends only the points that land under the rank caps. */
const USER_ID = "assigner";
const { stats_cap: GENIN_STATS_CAP } = getUserCaps("GENIN");

const assigner = async (over: Record<string, number>) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Assigner",
      rank: "GENIN",
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
    await resetTables(userData);
  });

  it("assigns unused points to the four jutsu masteries without granting level XP", async () => {
    await assigner({ ninjutsuMastery: 10, genjutsuMastery: 10, taijutsuMastery: 10, bukijutsuMastery: 10 });
    const api = await callerFor(profileRouter, USER_ID);
    const result = await api.useUnusedExperiencePoints({ ...assign(0, 0), ninjutsuMastery: 10, genjutsuMastery: 20, taijutsuMastery: 30, bukijutsuMastery: 40 });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user).toMatchObject({ ninjutsuMastery: 20, genjutsuMastery: 30, taijutsuMastery: 40, bukijutsuMastery: 50, earnedExperience: 0, experience: 5000 });
    expect(result.userPatch).toMatchObject({ ninjutsuMastery: 20, earnedExperience: 0 });
  });

  it("spends only mastery cap room and guards concurrent mastery changes", async () => {
    const { mastery_cap } = getUserCaps("GENIN");
    await assigner({ ninjutsuMastery: mastery_cap - 5 });
    const api = await callerFor(profileRouter, USER_ID);
    expect((await api.useUnusedExperiencePoints({ ...assign(0, 0), ninjutsuMastery: 10 })).success).toBe(true);
    expect(await readUser()).toMatchObject({ ninjutsuMastery: mastery_cap, earnedExperience: 95, experience: 5000 });
    const database = await getTestDatabase();
    const stale = callerForDatabase(profileRouter, USER_ID, beforeStatements(database, userData, [async () => {
      await database.update(userData).set({ genjutsuMastery: 50 }).where(eq(userData.userId, USER_ID));
    }]));
    expect((await stale.useUnusedExperiencePoints({ ...assign(0, 0), genjutsuMastery: 10 })).success).toBe(false);
    expect(await readUser()).toMatchObject({ genjutsuMastery: 50, earnedExperience: 95 });
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
      beforeStatements(database, userData, [async () => {
        await database
          .update(userData)
          .set({ defence: 1_050, experience: 5_050 })
          .where(eq(userData.userId, USER_ID));
      }]),
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
