import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { PET_MAX_GENERATION_ATTEMPTS } from "@/drizzle/constants";
import {
  gameSetting,
  petSpecies,
  quest,
  questHistory,
  trainingLog,
  userData,
  userPet,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import { petExperienceGainSql } from "@/libs/pets/experience";
import type { PusherClient } from "@/libs/pusher";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import { updateRewards } from "@/server/utils/questRewards";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { createAssignedExperienceSchema } from "@/validators/user";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import {
  insertPetSpecies,
  insertUserPets,
  insertUsers,
  insertUserVotes,
} from "../../setup/factories";
import { queueEnergy } from "../../setup/queues";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { initialPetSpecies } from "./helpers/species";

const userId = "pet-owner";
const petId = "owned-pet";
/** The pet task that keeps the companion away on a contract. */
const awayTask = {
  petId,
  questId: "contract",
  questHistoryId: "attempt",
  startedAt: 1,
  questVersion: 1,
  finishesAt: 2,
};
const readUser = async () => {
  const user = await (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (!user) throw new Error("Missing pet owner");
  return user;
};
const insertPet = async (patch: Partial<typeof userPet.$inferInsert> = {}) => {
  await insertUserPets([
    {
      id: petId,
      userId,
      name: "Nami",
      rank: 1,
      artRank: 1,
      avatar: "/pet.png",
      generationStatus: "READY",
      ...patch,
    },
  ]);
  await (await getTestDatabase())
    .update(userData)
    .set({ activePetId: patch.id ?? petId })
    .where(eq(userData.userId, userId));
};
const grantExperience = async (amount: number, identity?: string | null) => {
  await (await getTestDatabase())
    .update(userData)
    .set({
      earnedExperience: sql`${userData.earnedExperience} + ${amount}`,
      petExperience: petExperienceGainSql(amount, identity),
    })
    .where(eq(userData.userId, userId));
};

describeWithDatabase("accompanying pet experience against real MySQL", () => {
  beforeEach(async () => {
    await resetTables(
      petSpecies,
      userPet,
      userQueue,
      userVote,
      trainingLog,
      questHistory,
      quest,
      userData,
      gameSetting,
    );
    await insertPetSpecies(initialPetSpecies);
    await insertUsers([
      {
        userId,
        username: "PetOwner",
        rank: "GENIN",
        status: "AWAKE",
        isOutlaw: true,
        curEnergy: 100,
        regeneration: 0,
        trainingSpeed: "15min",
        petExperience: 23,
        earnedExperience: 0,
      },
    ]);
    await insertUserVotes([{ userId }]);
  });

  it("increments the bank without losing concurrent XP awards", async () => {
    await insertPet();
    await Promise.all([grantExperience(11), grantExperience(17), grantExperience(23)]);
    expect((await readUser()).petExperience).toBe(74);
    expect((await readUser()).earnedExperience).toBe(51);
  });

  it.each([
    { battleEnabled: false },
    { generationStatus: "PENDING" },
    { generationStatus: "GENERATING", artRank: 0 },
    { generationStatus: "FAILED" },
    { artRank: 0 },
    { avatar: null },
    { avatar: "" },
    { rank: 4, artRank: 4 },
  ] satisfies Partial<typeof userPet.$inferInsert>[])(
    "grants normal player XP without pet XP when the pet is unavailable: %j",
    async (patch) => {
      await insertPet(patch);
      await grantExperience(17);
      expect((await readUser()).earnedExperience).toBe(17);
      expect((await readUser()).petExperience).toBe(23);
    },
  );

  it("keeps earning XP from accepted art during an abandoned redraw with no attempts left", async () => {
    await insertPet({
      generationStatus: "GENERATING",
      generationStartedAt: new Date(0),
      generationAttempts: PET_MAX_GENERATION_ATTEMPTS,
    });
    await grantExperience(17);
    expect((await readUser()).petExperience).toBe(40);
  });

  it("checks the owner's live rank including NONE rather than a stale eligibility snapshot", async () => {
    const database = await getTestDatabase();
    await insertPet({ rank: 3, artRank: 3 });
    await grantExperience(7);
    await database
      .update(userData)
      .set({ rank: "STUDENT" })
      .where(eq(userData.userId, userId));
    await grantExperience(11);
    await database
      .update(userData)
      .set({ rank: "NONE" })
      .where(eq(userData.userId, userId));
    await grantExperience(13);
    expect((await readUser()).petExperience).toBe(30);
    expect((await readUser()).earnedExperience).toBe(31);
  });

  it("withholds accompanying XP while the active pet is away and resumes on its return", async () => {
    const database = await getTestDatabase();
    await insertPet();
    await database
      .update(userData)
      .set({ petTask: awayTask })
      .where(eq(userData.userId, userId));
    await grantExperience(17);
    expect((await readUser()).petExperience).toBe(23);
    await database
      .update(userData)
      .set({ petTask: null })
      .where(eq(userData.userId, userId));
    await grantExperience(11);
    expect((await readUser()).petExperience).toBe(34);
    expect((await readUser()).earnedExperience).toBe(28);
  });

  it("does not transfer a former pet's battle XP to its replacement", async () => {
    const database = await getTestDatabase();
    await insertPet();
    await database.delete(userPet).where(eq(userPet.id, petId));
    await database
      .update(userData)
      .set({ petExperience: 0 })
      .where(eq(userData.userId, userId));
    await grantExperience(5, petId);
    await insertPet({ id: "replacement-pet" });
    await grantExperience(11, petId);
    await grantExperience(13, null);
    expect((await readUser()).petExperience).toBe(0);
    await grantExperience(17, "replacement-pet");
    expect((await readUser()).petExperience).toBe(17);
    expect((await readUser()).earnedExperience).toBe(46);
  });

  it("matches a training grant and refuses a failed training request", async () => {
    await insertPet();
    const before = await readUser();
    const caller = await callerFor(trainRouter, userId);
    expect((await caller.startTraining({ stat: "offence", energy: 10 })).success).toBe(
      true,
    );
    const after = await readUser();
    expect(after.petExperience - before.petExperience).toBeCloseTo(
      after.experience - before.experience,
    );
    expect((await caller.startTraining({ stat: "offence", energy: 100 })).success).toBe(
      false,
    );
    expect((await readUser()).petExperience).toBe(after.petExperience);
  });

  it("settles queued training once and awards only the newly trained XP", async () => {
    await insertPet();
    await queueEnergy(userId, [
      { stat: "offence", energy: 10 },
      { stat: "speed", energy: 20 },
    ]);
    const before = await readUser();
    const database = await getTestDatabase();
    await fetchUpdatedUser({ client: database, userId, forceRegen: true });
    const after = await readUser();
    expect(after.petExperience - before.petExperience).toBeCloseTo(
      after.experience - before.experience,
    );
    expect(after.petExperience).toBeGreaterThan(before.petExperience);
    await fetchUpdatedUser({ client: database, userId, forceRegen: true });
    expect((await readUser()).petExperience).toBe(after.petExperience);
  });

  it("awards quest XP immediately without awarding it again when assigned to stats", async () => {
    await insertPet();
    await updateRewards({
      client: await getTestDatabase(),
      user: await readUser(),
      reason: "Quest complete",
      rewards: PostProcessedRewardSchema.parse({ reward_exp: 100 }),
    });
    const rewarded = await readUser();
    expect(rewarded.earnedExperience).toBe(100);
    expect(rewarded.petExperience).toBe(123);
    const caller = await callerFor(profileRouter, userId);
    const result = await caller.useUnusedExperiencePoints(
      createAssignedExperienceSchema().schema.parse({ offence: 50 }),
    );
    expect(result.success).toBe(true);
    const assigned = await readUser();
    expect(assigned.experience - rewarded.experience).toBe(50);
    expect(assigned.earnedExperience).toBe(50);
    expect(assigned.petExperience).toBe(123);
  });

  it("grants pet-only rewards atomically alongside ordinary XP without changing player XP", async () => {
    await insertPet();
    const before = await readUser();
    const client = await getTestDatabase();
    const grant = (rewards: object) =>
      updateRewards({
        client,
        user: before,
        reason: "Quest complete",
        rewards: PostProcessedRewardSchema.parse(rewards),
      });
    await Promise.all([
      grant({ reward_pet_experience: 100 }),
      grant({ reward_pet_experience: 50 }),
    ]);
    const petOnly = await readUser();
    expect(petOnly.petExperience).toBe(173);
    expect(petOnly.earnedExperience).toBe(before.earnedExperience);
    expect(petOnly.experience).toBe(before.experience);
    await grant({ reward_exp: 10.4, reward_pet_experience: 20.4 });
    const mixed = await readUser();
    expect(mixed.petExperience).toBe(203);
    expect(mixed.earnedExperience).toBe(10);
    expect(mixed.experience).toBe(before.experience);
    await grant({ reward_exp: -5, reward_pet_experience: 50 });
    expect((await readUser()).petExperience).toBe(253);
  });

  it.each(["missing", "disabled", "away"])(
    "withholds pet-only rewards when the active pet is %s",
    async (state) => {
      const client = await getTestDatabase();
      if (state !== "missing") await insertPet({ battleEnabled: state !== "disabled" });
      if (state === "away")
        await client
          .update(userData)
          .set({ petTask: awayTask })
          .where(eq(userData.userId, userId));
      const before = await readUser();
      await updateRewards({
        client,
        user: before,
        reason: "Quest complete",
        rewards: PostProcessedRewardSchema.parse({ reward_pet_experience: 100 }),
      });
      const after = await readUser();
      expect(after.petExperience).toBe(before.petExperience);
      expect(after.earnedExperience).toBe(before.earnedExperience);
      expect(after.experience).toBe(before.experience);
    },
  );

  it("settles both combat XP kinds once against the frozen accompanying pet", async () => {
    const database = await getTestDatabase();
    await insertPet();
    await database
      .update(userData)
      .set({ battleId: "pet-fight", status: "BATTLE" })
      .where(eq(userData.userId, userId));
    const state = makeCompleteBattle({
      id: "pet-fight",
      battleType: "QUEST",
      rewardScaling: 1,
      usersState: [
        makeBattleUser(userId, {
          ...(await readUser()),
          villageId: "owner-village",
          direction: "left",
          isAi: false,
          isSummon: false,
          curHealth: 100,
          sector: 1,
        }),
        makeBattleUser("enemy", {
          direction: "right",
          isAi: true,
          curHealth: 0,
          leftBattle: true,
          sector: 1,
        }),
      ],
      extraState: { petIdsByOwner: { [userId]: petId } },
    });
    const result = calcBattleResult(state, userId, [])!;
    // Each player integer column rounds independently, rather than their sum.
    result.experience = 7.4;
    result.earnedExperience = 11.4;
    const pusher = { trigger: async () => {} } as unknown as PusherClient;
    await updateUser(database, pusher, state, result, userId);
    expect((await readUser()).petExperience).toBe(41);
    expect((await readUser()).earnedExperience).toBe(11);
    await updateUser(database, pusher, state, result, userId);
    expect((await readUser()).petExperience).toBe(41);
  });
});
