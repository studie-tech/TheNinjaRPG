import { readFile } from "node:fs/promises";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  petSpecies,
  userData,
  userPet,
  userUpload,
  type UserPetInsert,
} from "@/drizzle/schema";
import { insertPetSpecies, insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const ownerId = "artwork-owner";
const savedAt = new Date("2026-01-01T00:00:00Z");
const fixtures = [
  {
    before: {
      id: "AqsIKC1oMOh9-2xaeS3un",
      speciesId: "pet-species-38",
      paletteIndex: 6,
      characteristicIndex: 4,
      auraIndex: 7,
      rank: 1,
      artRank: 1,
      avatar: "https://ui0arpl8sm.ufs.sh/f/pet-MZNrdOlmJovVYCkm6uybv.webp",
      avatarFacing: "left",
      generationStatus: "READY",
    },
    after: {
      avatar: "https://ui0arpl8sm.ufs.sh/f/content-HwQhCqffkPRnJI-pJ6587.webp",
      avatarFacing: "left",
    },
  },
  {
    before: {
      id: "MVIRJlnstuUn57Fl6b3Ts",
      speciesId: "pet-species-4",
      paletteIndex: 25,
      characteristicIndex: 6,
      auraIndex: 7,
      rank: 1,
      artRank: 0,
      avatar: null,
      avatarFacing: "left",
      generationStatus: "FAILED",
    },
    after: {
      avatar: "https://ui0arpl8sm.ufs.sh/f/content--Zlrhzl7U3KfYHxJ4S1En.webp",
      avatarFacing: "left",
    },
  },
] as const;
const migration = await readFile(
  new URL(
    "../../drizzle/migrations/0095_refresh_companion_artwork.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Exercise the actual data migration while protecting current pet and owner gameplay state. */
describeWithDatabase("companion artwork refresh migration", () => {
  beforeEach(async () => {
    await resetTables(userUpload, userPet, petSpecies, userData);
    await insertPetSpecies(
      fixtures.map(({ before }, index) => ({
        id: before.speciesId,
        name: `Artwork species ${index}`,
      })),
    );
    await insertUsers([
      {
        userId: ownerId,
        username: "ArtworkOwner",
        money: 1234,
        bank: 5678,
        reputationPoints: 91,
        petExperience: 777,
        petAcquisitions: 4,
        petSlots: 3,
        activePetId: "working-pet",
        status: "BATTLE",
        battleId: "existing-battle",
        petTask: {
          petId: "working-pet",
          questId: "existing-contract",
          questHistoryId: "existing-attempt",
          startedAt: 1000,
          questVersion: 500,
          finishesAt: 2000,
        },
      },
    ]);
  });

  it("refreshes accepted and missing artwork, records current ownership and preserves saved state on rerun", async () => {
    const database = await getTestDatabase();
    const currentOwnerId = "current-artwork-owner";
    await insertUsers([
      {
        userId: currentOwnerId,
        username: "CurrentArtworkOwner",
        activePetId: fixtures[0].before.id,
        petExperience: 456,
      },
    ]);
    const before = [
      await seedPet(fixtures[0], { userId: currentOwnerId }),
      await seedPet(fixtures[1]),
    ];
    await database.insert(userUpload).values([
      {
        id: "old-pet-upload",
        userId: ownerId,
        imageUrl: fixtures[0].before.avatar,
        createdAt: savedAt,
        updatedAt: savedAt,
      },
      {
        id: "other-upload",
        userId: ownerId,
        imageUrl: "https://example.com/gallery.webp",
        createdAt: savedAt,
        updatedAt: savedAt,
      },
    ]);
    const oldUploads = await database.query.userUpload.findMany();
    const owners = await database.query.userData.findMany();

    await runRawSql(migration);

    for (const [index, saved] of before.entries()) {
      const refreshed = await database.query.userPet.findFirst({
        where: eq(userPet.id, saved.id),
      });
      expect(refreshed).toEqual({
        ...saved,
        ...fixtures[index]!.after,
        generationStatus: "READY",
        artRank: saved.rank,
        revision: saved.revision + 1,
        updatedAt: expect.any(Date),
      });
      expect(refreshed!.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
    }
    expect(await database.query.userData.findMany()).toEqual(owners);
    const uploads = await database.query.userUpload.findMany({
      orderBy: (table, { asc }) => asc(table.id),
    });
    expect(uploads).toHaveLength(oldUploads.length + fixtures.length);
    for (const upload of oldUploads) expect(uploads).toContainEqual(upload);
    for (const [index, saved] of before.entries()) {
      expect(uploads).toContainEqual(
        expect.objectContaining({
          userId: saved.userId,
          imageUrl: fixtures[index]!.after.avatar,
        }),
      );
    }

    const refreshedPets = await database.query.userPet.findMany();
    await runRawSql(migration);
    expect(await database.query.userPet.findMany()).toEqual(refreshedPets);
    expect(
      await database.query.userUpload.findMany({
        orderBy: (table, { asc }) => asc(table.id),
      }),
    ).toEqual(uploads);
    expect(await database.query.userData.findMany()).toEqual(owners);
  });

  it.each([
    ["new accepted artwork", { avatar: "https://example.com/new-accepted-pet.webp" }],
    ["an evolved rank", { rank: 2 }],
    ["changed cosmetics", { paletteIndex: 7 }],
  ] satisfies [string, Partial<UserPetInsert>][])(
    "preserves %s while retaining the generated gallery candidate",
    async (_change, patch) => {
      const database = await getTestDatabase();
      const before = await seedPet(fixtures[0], patch);

      await runRawSql(migration);

      expect(await database.query.userPet.findFirst()).toEqual(before);
      expect(await database.query.userUpload.findMany()).toEqual([
        expect.objectContaining({
          userId: ownerId,
          imageUrl: fixtures[0].after.avatar,
        }),
      ]);
    },
  );

  it.each([
    [
      "a generating pet with no start time",
      { generationStatus: "GENERATING", generationStartedAt: null },
    ],
    ["an outstanding generation token", { generationToken: "current-generation" }],
  ] satisfies [string, Partial<UserPetInsert>][])(
    "does not replace %s",
    async (_change, patch) => {
      const database = await getTestDatabase();
      const before = await seedPet(fixtures[0], patch);

      await runRawSql(migration);

      expect(await database.query.userPet.findFirst()).toEqual(before);
    },
  );

  it("does not recreate a released pet or attach its candidate to the former owner", async () => {
    const database = await getTestDatabase();
    const pet = await seedPet();
    await database.delete(userPet).where(eq(userPet.id, pet.id));

    await runRawSql(migration);

    expect(await database.query.userPet.findMany()).toEqual([]);
    expect(await database.query.userUpload.findMany()).toEqual([]);
  });

  it("refreshes artwork after unrelated changes and increments the current revision without losing them", async () => {
    const database = await getTestDatabase();
    await seedPet();
    await database
      .update(userPet)
      .set({
        name: "Renamed companion",
        avatarFacing: "right",
        experience: 123,
        storedExperience: 456,
        lastFedAt: new Date("2026-10-18T00:00:00Z"),
        offence: 87,
        revision: 81,
        generationStartedAt: new Date("2026-10-17T00:00:00Z"),
      })
      .where(eq(userPet.id, fixtures[0].before.id));
    const before = (await database.query.userPet.findFirst())!;
    const owner = await database.query.userData.findFirst();

    await runRawSql(migration);

    expect(await database.query.userPet.findFirst()).toEqual({
      ...before,
      ...fixtures[0].after,
      revision: 82,
      updatedAt: expect.any(Date),
    });
    expect(await database.query.userData.findFirst()).toEqual(owner);
  });
});

const seedPet = async (
  fixture: (typeof fixtures)[number] = fixtures[0],
  patch: Partial<UserPetInsert> = {},
) => {
  const database = await getTestDatabase();
  const row: UserPetInsert = {
    ...fixture.before,
    userId: ownerId,
    name: "Test companion",
    experience: 42,
    storedExperience: 63,
    lastFedAt: savedAt,
    jutsuIds: ["saved-jutsu"],
    skillIds: ["saved-skill"],
    offence: 11,
    defence: 12,
    strength: 13,
    speed: 14,
    intelligence: 15,
    willpower: 16,
    battleEnabled: false,
    spawnPosition: "LEFT",
    aiRules: [{ conditions: [], action: { type: "end_turn", description: "Wait" } }],
    includeDefaultRules: false,
    generationToken: null,
    generationStartedAt: savedAt,
    generationAttempts: 2,
    revision: 7,
    createdAt: savedAt,
    updatedAt: savedAt,
    ...patch,
  };
  await database.insert(userPet).values(row);
  return (await database.query.userPet.findFirst({ where: eq(userPet.id, row.id) }))!;
};
