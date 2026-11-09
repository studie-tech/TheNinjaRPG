import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, jutsu, petSpecies, userData, userPet } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { petSpeciesRouter } from "@/server/api/routers/petSpecies";
import { ActionEndTurn } from "@/validators/ai";
import { BarrierTag, DamageTag } from "@/validators/combat";
import { petJutsuFixture } from "../../../libs/pets/helpers/abilities";
import { insertUserPets, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "species-content";
const species = {
  name: "Cloud fox",
  description: "A fox with a flowing cloud-shaped tail",
  rarity: "RARE" as const,
  isActive: true,
  role: "ASSAULT" as const,
  defaultJutsuIds: [],
  aiRules: [],
  includeDefaultRules: true,
  effects: [],
};

describeWithDatabase("Manual companion species", () => {
  beforeEach(async () => {
    // Keep public-query middleware active without requiring Redis in SQL tests.
    stubRateLimitTransport();
    await resetTables(actionLog, userPet, petSpecies, userData, jutsu);
    await insertUsers([
      { userId: staffId, username: "SpeciesContent", role: "CONTENT" },
    ]);
    // Content fixtures must never deliver updates to a configured Discord webhook.
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates a species with a stable identity and records the authored content", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    const result = await caller.create({
      ...species,
      name: "  Cloud fox  ",
      description: ` ${species.description} `,
    });
    expect(result.success).toBe(true);
    expect(await caller.get({ id: result.message })).toMatchObject({
      id: result.message,
      ...species,
    });
    expect(await database.query.actionLog.findMany()).toMatchObject([
      {
        tableName: "petSpecies",
        relatedId: result.message,
        relatedMsg: "Create: Cloud fox",
      },
    ]);
    expect((await caller.update({ id: result.message, data: species })).success).toBe(
      true,
    );
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it.each([
    { role: "USER", isBanned: false },
    { role: "CONTENT", isBanned: true },
  ] as const)("prevents writes by $role with banned=$isBanned", async (permissions) => {
    const database = await getTestDatabase();
    await database.insert(petSpecies).values({ id: "original", ...species });
    await database
      .update(userData)
      .set(permissions)
      .where(eq(userData.userId, staffId));
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    expect(
      (await caller.create({ ...species, name: "Forbidden species" })).success,
    ).toBe(false);
    expect(
      (await caller.update({ id: "original", data: { ...species, isActive: false } }))
        .success,
    ).toBe(false);
    expect(await caller.getAll()).toMatchObject([{ id: "original", isActive: true }]);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("retires and edits species without changing owned companions or their artwork", async () => {
    const database = await getTestDatabase();
    await database.insert(petSpecies).values({ id: "owned-species", ...species });
    await insertUserPets([
      {
        id: "companion",
        userId: staffId,
        name: "Miso",
        speciesId: "owned-species",
        rank: 3,
        experience: 30000,
        storedExperience: 500,
        avatar: "https://example.com/miso.webp",
        artRank: 3,
        generationStatus: "READY",
      },
    ]);
    const before = await database.query.userPet.findFirst();
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    const data = {
      ...species,
      name: "Mist fox",
      description: "A fox with a long misty tail",
      rarity: "EPIC" as const,
      isActive: false,
    };
    expect((await caller.update({ id: "owned-species", data })).success).toBe(true);
    expect(await caller.get({ id: "owned-species" })).toMatchObject(data);
    expect(await database.query.userPet.findFirst()).toEqual(before);
    expect(
      await database.query.userPet.findFirst({ with: { species: true } }),
    ).toMatchObject({
      species: { id: "owned-species", ...data },
    });
    expect(await caller.getAll()).toMatchObject([
      { id: "owned-species", isActive: false },
    ]);
    expect(
      (await caller.update({ id: "owned-species", data: { ...data, isActive: true } }))
        .success,
    ).toBe(true);
  });

  it("rejects duplicate names including concurrent creates without logging a failed write", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    const results = await Promise.all([caller.create(species), caller.create(species)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await database.query.petSpecies.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
    await database
      .insert(petSpecies)
      .values({ id: "other", ...species, name: "Other fox" });
    expect((await caller.update({ id: "other", data: species })).success).toBe(false);
    expect(await caller.get({ id: "other" })).toMatchObject({ name: "Other fox" });
  });

  it("validates content and reports a missing species without writing", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    await expect(caller.create({ ...species, name: " " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.create({ ...species, description: "a".repeat(1001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.update({ id: "missing", data: species })).success).toBe(false);
    await expect(caller.get({ id: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await database.query.petSpecies.findMany()).toHaveLength(0);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("stores authored role, compatible pet jutsu, instructions and independently targeted passive skills", async () => {
    const database = await getTestDatabase();
    await database
      .insert(jutsu)
      .values(petJutsuFixture({ id: "pet-strike", name: "Pet strike" }));
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    const input = {
      ...species,
      role: "SUPPORT" as const,
      defaultJutsuIds: ["pet-strike"],
      includeDefaultRules: false,
      aiRules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
      effects: [{ ...DamageTag.parse({ rounds: 3 }), skillTarget: "ENEMIES" as const }],
    };
    const created = await caller.create(input);
    expect(created.success).toBe(true);
    expect(await caller.get({ id: created.message })).toMatchObject(input);
    expect(
      (await caller.update({ id: created.message, data: { ...input, role: "HEALER" } }))
        .success,
    ).toBe(true);
    expect(await caller.get({ id: created.message })).toMatchObject({
      role: "HEALER",
      defaultJutsuIds: ["pet-strike"],
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
  });

  it.each(["SELF", "ENEMIES"] as const)(
    "rejects occupied-cell barrier skills on %s species before writing",
    async (skillTarget) => {
      const database = await getTestDatabase();
      await database.insert(petSpecies).values({ id: "original", ...species });
      const caller = callerForDatabase(petSpeciesRouter, staffId, database);
      const data = {
        ...species,
        effects: [{ ...BarrierTag.parse({ staticAssetPath: "barrier" }), skillTarget }],
      };
      await expect(caller.create(data)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.update({ id: "original", data })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(await database.query.petSpecies.findMany()).toMatchObject([
        { id: "original", effects: [] },
      ]);
      expect(await database.query.actionLog.findMany()).toHaveLength(0);
    },
  );

  it("allows species-locked defaults only on their matching companion", async () => {
    const database = await getTestDatabase();
    await database.insert(petSpecies).values({ id: "original", ...species });
    await database
      .insert(jutsu)
      .values(petJutsuFixture({ requiredPetSpeciesId: "original" }));
    const caller = callerForDatabase(petSpeciesRouter, staffId, database);
    const data = { ...species, defaultJutsuIds: ["pet-strike"] };
    expect((await caller.create({ ...data, name: "Another species" })).success).toBe(
      false,
    );
    expect((await caller.update({ id: "original", data })).success).toBe(true);
    await database.update(jutsu).set({ requiredPetSpeciesId: "other-species" });
    expect((await caller.update({ id: "original", data })).success).toBe(false);
  });

  it.each(["missing", "hidden", "normal", "dependent"] as const)(
    "rejects %s default jutsu on both create and update without content writes",
    async (state) => {
      const database = await getTestDatabase();
      await database.insert(petSpecies).values({ id: "original", ...species });
      if (state !== "missing")
        await database.insert(jutsu).values(
          petJutsuFixture({
            id: "invalid",
            name: "Invalid",
            ...(state === "hidden"
              ? { hidden: true }
              : state === "normal"
                ? { jutsuType: "NORMAL" as const }
                : { requiredSkillId: "other-content" }),
          }),
        );
      const caller = callerForDatabase(petSpeciesRouter, staffId, database);
      const data = { ...species, defaultJutsuIds: ["invalid"] };
      expect((await caller.create({ ...data, name: "Rejected" })).success).toBe(false);
      expect((await caller.update({ id: "original", data })).success).toBe(false);
      expect(await database.query.petSpecies.findMany()).toMatchObject([
        { id: "original", defaultJutsuIds: [] },
      ]);
      expect(await database.query.actionLog.findMany()).toHaveLength(0);
    },
  );

  it("lists active and retired species in the manual's alphabetical order", async () => {
    const database = await getTestDatabase();
    await database.insert(petSpecies).values([
      { id: "z", ...species, name: "Zebra" },
      { id: "a", ...species, name: "Axolotl", isActive: false },
    ]);
    expect(
      (await callerForDatabase(petSpeciesRouter, staffId, database).getAll()).map(
        (entry) => entry.id,
      ),
    ).toEqual(["a", "z"]);
  });
});
