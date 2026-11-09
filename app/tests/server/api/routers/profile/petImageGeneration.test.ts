import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  PET_GENERATION_LEASE_MS,
  PET_MAX_GENERATION_ATTEMPTS,
} from "@/drizzle/constants";
import { actionLog, type UserPetInsert, userData, userPet } from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import { insertUserPets, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const input = {
  userId: "pet-owner",
  petId: "support-pet",
  reason: "Restore attempts after an image generation bug",
};

/** A failed companion keeps all authored identity and progression during support recovery. */
const createPet = async (patch: Partial<UserPetInsert> = {}) => {
  const database = await getTestDatabase();
  await insertUserPets([
    {
      id: input.petId,
      userId: input.userId,
      name: "Kuro",
      speciesId: "crow",
      paletteIndex: 2,
      characteristicIndex: 3,
      auraIndex: 4,
      rank: 2,
      experience: 1000,
      generationStatus: "FAILED",
      generationAttempts: PET_MAX_GENERATION_ATTEMPTS,
      generationStartedAt: new Date(),
      ...patch,
    },
  ]);
  return (await database.query.userPet.findFirst({
    where: eq(userPet.id, input.petId),
  }))!;
};

describeWithDatabase("staff companion image recovery", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userPet, userData);
    await insertUsers([
      { userId: "support-staff", username: "SupportStaff", role: "MODERATOR" },
      { userId: input.userId, username: "PetOwner" },
    ]);
  });

  it("restores current-rank attempts and cooldown with an actor, player and companion audit", async () => {
    const database = await getTestDatabase();
    const before = await createPet();
    const api = callerForDatabase(profileRouter, "support-staff", database);
    expect((await api.resetPetImageGeneration(input)).success).toBe(true);
    const after = (await database.query.userPet.findFirst({
      where: eq(userPet.id, input.petId),
    }))!;
    expect(after).toEqual({
      ...before,
      generationAttempts: 0,
      generationStartedAt: null,
      generationToken: null,
      revision: 1,
      updatedAt: after.updatedAt,
    });
    expect(await api.getPetImageGenerationForStaff({ id: input.userId })).toEqual([
      {
        id: input.petId,
        name: "Kuro",
        generationStatus: "FAILED",
        generationAttempts: 0,
      },
    ]);
    const logs = await database.query.actionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: "support-staff",
      relatedId: input.userId,
      relatedMsg: input.reason,
    });
    expect(logs[0]?.changes).toEqual([
      `Reset companion image attempts for Kuro (${input.petId}) from ${PET_MAX_GENERATION_ATTEMPTS} to 0`,
    ]);
  });

  it("does not expose support data or allow players to restore their own attempts", async () => {
    const database = await getTestDatabase();
    const before = await createPet();
    const api = callerForDatabase(profileRouter, input.userId, database);
    expect(await api.getPetImageGenerationForStaff({ id: input.userId })).toEqual([]);
    expect((await api.resetPetImageGeneration(input)).success).toBe(false);
    expect(await database.query.userPet.findFirst()).toEqual(before);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rejects banned staff and a mismatched companion owner", async () => {
    const database = await getTestDatabase();
    await createPet();
    const api = callerForDatabase(profileRouter, "support-staff", database);
    expect(
      (await api.resetPetImageGeneration({ ...input, userId: "another-player" }))
        .success,
    ).toBe(false);
    await database
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, "support-staff"));
    expect((await api.resetPetImageGeneration(input)).success).toBe(false);
    expect(await api.getPetImageGenerationForStaff({ id: input.userId })).toEqual([]);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it.each([new Date(), null])(
    "keeps a running generation lease and token intact (%s)",
    async (startedAt) => {
      const database = await getTestDatabase();
      const before = await createPet({
        generationStatus: "GENERATING",
        generationStartedAt: startedAt,
        generationToken: "running-token",
      });
      const result = await callerForDatabase(
        profileRouter,
        "support-staff",
        database,
      ).resetPetImageGeneration(input);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/still generating/i);
      expect(await database.query.userPet.findFirst()).toEqual(before);
      expect(await database.query.actionLog.findMany()).toHaveLength(0);
    },
  );

  it("expires an abandoned lease while retaining the previous evolution image", async () => {
    const database = await getTestDatabase();
    await createPet({
      generationStatus: "GENERATING",
      generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1),
      generationToken: "expired-token",
      avatar: "https://example.com/accepted.webp",
      artRank: 1,
    });
    expect(
      (
        await callerForDatabase(
          profileRouter,
          "support-staff",
          database,
        ).resetPetImageGeneration(input)
      ).success,
    ).toBe(true);
    expect(await database.query.userPet.findFirst()).toMatchObject({
      generationStatus: "FAILED",
      generationToken: null,
      generationStartedAt: null,
      generationAttempts: 0,
      avatar: "https://example.com/accepted.webp",
      artRank: 1,
      rank: 2,
    });
  });

  it.each(["READY", "GENERATING"] as const)(
    "keeps accepted art ready when restoring attempts from %s",
    async (generationStatus) => {
      const database = await getTestDatabase();
      await createPet({
        generationStatus,
        generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1),
        avatar: "https://example.com/accepted.webp",
        artRank: 2,
      });
      expect(
        (
          await callerForDatabase(
            profileRouter,
            "support-staff",
            database,
          ).resetPetImageGeneration(input)
        ).success,
      ).toBe(true);
      expect(await database.query.userPet.findFirst()).toMatchObject({
        generationStatus: "READY",
        avatar: "https://example.com/accepted.webp",
        artRank: 2,
        rank: 2,
      });
    },
  );

  it("rejects an empty allowance without writing an audit", async () => {
    const database = await getTestDatabase();
    await createPet({ generationAttempts: 0 });
    const api = callerForDatabase(profileRouter, "support-staff", database);
    expect((await api.resetPetImageGeneration(input)).success).toBe(false);
    expect(
      (await api.getPetImageGenerationForStaff({ id: input.userId }))[0]
        ?.generationAttempts,
    ).toBe(0);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("cannot erase a generation claimed after the staff snapshot was read", async () => {
    const database = await getTestDatabase();
    await createPet();
    const stale = callerForDatabase(
      profileRouter,
      "support-staff",
      beforeStatements(database, userPet, [
        async () => {
          await database.update(userPet).set({
            generationStatus: "GENERATING",
            generationToken: "new-token",
            revision: sql`${userPet.revision} + 1`,
          });
        },
      ]),
    );
    expect((await stale.resetPetImageGeneration(input)).success).toBe(false);
    expect(await database.query.userPet.findFirst()).toMatchObject({
      generationStatus: "GENERATING",
      generationToken: "new-token",
      generationAttempts: PET_MAX_GENERATION_ATTEMPTS,
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });
});
