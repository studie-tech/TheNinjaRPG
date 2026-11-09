import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_WAKE_ISLAND_SECTOR, PET_REPLACEMENT_COST } from "@/drizzle/constants";
import { actionLog, petSpecies, userData, userPet } from "@/drizzle/schema";
import { getPetAppearancePrompt } from "@/libs/pets/appearance";
import * as socials from "@/libs/socials";
import { petSpeciesRouter } from "@/server/api/routers/petSpecies";
import { petsRouter } from "@/server/api/routers/pets";
import {
  insertPetSpecies,
  insertUsers,
  insertUserPets,
} from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { overrideQuery } from "../../../setup/statements";

const ownerId = "species-integration-owner";
const species = {
  id: "authored-mist-fox",
  name: "Mist fox",
  description: "A silver fox with a curled misty tail",
  rarity: "RARE" as const,
  isActive: true,
};

describeWithDatabase("Authored species in companion flows", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userPet, petSpecies, userData);
    await insertUsers([
      {
        userId: ownerId,
        username: "SpeciesIntegration",
        role: "CONTENT",
        rank: "GENIN",
        sector: MAP_WAKE_ISLAND_SECTOR,
        status: "AWAKE",
        petAcquisitions: 1,
        reputationPoints: 2 * PET_REPLACEMENT_COST,
      },
    ]);
    // Content integration tests exercise saves without publishing fixture updates.
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps an empty catalogue readable and explains why adoption is unavailable", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petsRouter, ownerId, database);
    const view = await caller.getPet();
    expect(view.options.species).toEqual([]);
    expect(view.canAcquire).toBe(false);
    expect(view.unavailableReason).toContain("not offering new companions");
    const owner = await database.query.userData.findFirst();
    expect(
      (
        await caller.acquirePet({
          currency: "REPUTATION",
          name: "Miso",
          gender: "FEMALE",
          dayKey: view.dayKey,
          speciesId: "missing",
          paletteIndex: view.options.palettes[0]!.index,
          characteristicIndex: view.options.characteristics[0]!.index,
          auraIndex: view.options.auras[0]!.index,
        })
      ).success,
    ).toBe(false);
    expect(await database.query.userPet.findMany()).toEqual([]);
    expect(await database.query.userData.findFirst()).toEqual(owner);
  });

  it("uses staff edits in owned metadata and evolution prompts while preserving the accepted portrait", async () => {
    const database = await getTestDatabase();
    await insertPetSpecies([species]);
    await insertUserPets([
      {
        id: "owned-mist-fox",
        userId: ownerId,
        name: "Miso",
        speciesId: species.id,
        rank: 2,
        experience: 10000,
        avatar: "https://example.com/accepted-miso.webp",
        artRank: 2,
        generationStatus: "READY",
      },
    ]);
    const before = await database.query.userPet.findFirst();
    const data = {
      name: "Moon fox",
      description: "A moon fox with pearl ear tips and a ribbon-like tail",
      rarity: "LEGENDARY" as const,
      isActive: true,
    };
    expect(
      (
        await callerForDatabase(petSpeciesRouter, ownerId, database).update({
          id: species.id,
          data,
        })
      ).success,
    ).toBe(true);
    const view = await callerForDatabase(petsRouter, ownerId, database).getPet();
    expect(view.pet?.species).toMatchObject({ id: species.id, ...data });
    expect(view.options.species).toMatchObject([{ id: species.id, ...data }]);
    expect(await database.query.userPet.findFirst()).toEqual(before);
    if (!view.pet) throw new Error("Expected the owned companion");
    const prompt = getPetAppearancePrompt({ ...view.pet, rank: 3 }, "GPT");
    expect(prompt).toContain(data.description);
    expect(prompt).not.toContain(species.description);
    expect(prompt).toContain("SAME individual animal");
  });

  it("does not charge or grant a pet when its species retires after the acquisition catalogue read", async () => {
    const database = await getTestDatabase();
    await insertPetSpecies([species]);
    const caller = callerForDatabase(petsRouter, ownerId, database);
    const view = await caller.getPet();
    const owner = await database.query.userData.findFirst();
    const raced = overrideQuery(database, "petSpecies", {
      findMany: async (read) => {
        const offered = await read();
        // The request retains its offered snapshot, but payment must observe retirement.
        await database
          .update(petSpecies)
          .set({ isActive: false })
          .where(eq(petSpecies.id, species.id));
        return offered;
      },
    });
    expect(
      (
        await callerForDatabase(petsRouter, ownerId, raced).acquirePet({
          currency: "REPUTATION",
          name: "Miso",
          gender: "FEMALE",
          dayKey: view.dayKey,
          speciesId: species.id,
          paletteIndex: view.options.palettes[0]!.index,
          characteristicIndex: view.options.characteristics[0]!.index,
          auraIndex: view.options.auras[0]!.index,
        })
      ).success,
    ).toBe(false);
    expect(await database.query.petSpecies.findFirst()).toMatchObject({
      isActive: false,
    });
    expect(await database.query.userPet.findMany()).toEqual([]);
    expect(await database.query.userData.findFirst()).toEqual(owner);
  });
});
