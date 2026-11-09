import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, jutsu, petSpecies, userData } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { JutsuValidator } from "@/validators/combat";
import { petJutsuFixture } from "../../../../libs/pets/helpers/abilities";
import { petSpeciesFixture } from "../../../../libs/pets/helpers/species";
import { insertUsers } from "../../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("companion species requirements in jutsu editing", () => {
  beforeEach(async () => {
    await resetTables(actionLog, petSpecies, jutsu, userData);
    await insertUsers([{ userId: "staff", username: "Staff", role: "CONTENT" }]);
    const database = await getTestDatabase();
    await database.insert(jutsu).values(petJutsuFixture({ hidden: true }));
    await database
      .insert(petSpecies)
      .values([
        petSpeciesFixture({ id: "fox", name: "Fox", defaultJutsuIds: ["pet-strike"] }),
        petSpeciesFixture({ id: "cat", name: "Cat" }),
      ]);
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /** Exercise staff validation and persistence through the real jutsu update procedure. */
  const save = async (requiredPetSpeciesId: string | null, jutsuType = "PETS") => {
    const database = await getTestDatabase();
    const entry = await database.query.jutsu.findFirst({
      where: eq(jutsu.id, "pet-strike"),
    });
    return callerForDatabase(jutsuRouter, "staff", database).update({
      id: "pet-strike",
      data: JutsuValidator.parse({ ...entry, requiredPetSpeciesId, jutsuType }),
    });
  };

  it("rejects a restriction that removes another species' default without writing or logging", async () => {
    expect(await save("cat")).toMatchObject({
      success: false,
      message: "This jutsu is a default for another companion species",
    });
    const database = await getTestDatabase();
    expect(await database.query.jutsu.findFirst()).toMatchObject({
      requiredPetSpeciesId: null,
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("allows a matching restriction and allows clearing it back to any species", async () => {
    expect((await save("fox")).success).toBe(true);
    const database = await getTestDatabase();
    expect(await database.query.jutsu.findFirst()).toMatchObject({
      requiredPetSpeciesId: "fox",
    });
    expect((await save(null)).success).toBe(true);
    expect(await database.query.jutsu.findFirst()).toMatchObject({
      requiredPetSpeciesId: null,
    });
  });

  it("checks every species sharing the default, including retired species", async () => {
    const database = await getTestDatabase();
    await database
      .update(petSpecies)
      .set({ defaultJutsuIds: ["pet-strike"], isActive: false })
      .where(eq(petSpecies.id, "cat"));
    expect((await save("fox")).success).toBe(false);
    expect((await save(null)).success).toBe(true);
  });

  it("allows a new restriction once other species no longer use this default", async () => {
    const database = await getTestDatabase();
    await database
      .update(petSpecies)
      .set({ defaultJutsuIds: [] })
      .where(eq(petSpecies.id, "fox"));
    expect((await save("cat")).success).toBe(true);
  });

  it("requires an existing species on a PETS jutsu", async () => {
    expect((await save("missing")).success).toBe(false);
    expect((await save("fox", "NORMAL")).success).toBe(false);
  });
});
