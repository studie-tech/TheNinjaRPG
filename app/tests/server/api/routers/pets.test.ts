import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { ItemRarities, PetRarities, PET_ABILITY_SLOTS_BY_RARITY, type ItemRarity, MAP_WAKE_ISLAND_SECTOR, PET_BATTLE_CONFIG, PET_COLLECTION_SLOT_COST, PET_FEED_COOLDOWN_HOURS, PET_FEED_EXPERIENCE_BY_RARITY, PET_GENERATION_LEASE_MS, PET_GENERATION_RETRY_MS, PET_MAX_COLLECTION_SLOTS, PET_MAX_GENERATION_ATTEMPTS, PET_REPLACEMENT_COST, PET_SEICHI_SILVER_COST, PET_ART_PROVIDER_SETTING, PetArtProviders } from "@/drizzle/constants";
import { gameSetting, item, jutsu, skillTree, userData, userItem, userJutsu, userPet, petSpecies, userSkill, userUpload } from "@/drizzle/schema";
import * as appearance from "@/libs/pets/appearance";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import * as creation from "@/libs/pets/creation";
import { AiRule } from "@/validators/ai";
import type { PetTask } from "@/validators/petTasks";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { petsRouter } from "@/server/api/routers/pets";
import type { DrizzleClient } from "@/server/db";
import * as sentry from "@/server/utils/sentry";
import { getPetDayKey, HOUR_S, secondsFromNow } from "@/utils/time";
import { initialPetSpecies } from "../../../libs/pets/helpers/species";
import { petJutsuFixture, petSkillFixture } from "../../../libs/pets/helpers/abilities";
import { insertItems, insertPetSpecies, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const userId = "pet-owner";
const petId = "owned-pet";
const avatar = "https://example.com/accepted-pet.webp";
const stats = { offence: 10, defence: 0, strength: 0, speed: 0, intelligence: 0, willpower: 0 };
const task = (patch: Partial<PetTask> = {}): PetTask => ({ petId, questId: "hunting-contract",
  questHistoryId: "profession-attempt", startedAt: 1, questVersion: 1, finishesAt: Date.now() + 60000, ...patch });

it("loads adoption choices and valid meals when an inventory item's definition is missing", async () => {
  const database = { query: {
    userData: { findFirst: async () => ({ userId, rank: "GENIN", status: "AWAKE",
      sector: MAP_WAKE_ISLAND_SECTOR, federalStatus: "NONE", staffAccount: false,
      petSlots: 1, petAcquisitions: 0, petExperience: 0, activePetId: null }) },
    userPet: { findMany: async () => [] },
    petSpecies: { findMany: async () => initialPetSpecies },
    jutsu: { findMany: async () => [] },
    userSkill: { findMany: async () => [] },
    userItem: { findMany: async () => [
      { id: "orphaned-stack", quantity: 1, item: null },
      { id: "weapon-stack", quantity: 1, item: { itemType: "WEAPON" } },
      { id: "meal-stack", quantity: 2, item: { itemType: "MEAL", name: "Rice Bowl", rarity: "COMMON" } },
    ] },
  } } as unknown as DrizzleClient;
  const result = await callerForDatabase(petsRouter, userId, database).getPet();
  expect(result.canAcquire).toBe(true);
  expect(result.options.species.length).toBeGreaterThan(0);
  expect(result.feedMeals).toEqual([{ id: "meal-stack", quantity: 2, name: "Rice Bowl",
    rarity: "COMMON", experience: PET_FEED_EXPERIENCE_BY_RARITY.COMMON }]);
});

it("rejects feeding an orphaned inventory stack before changing companion experience", async () => {
  const database = { query: {
    userData: { findFirst: async () => ({ userId, rank: "GENIN", status: "AWAKE", activePetId: petId }) },
    userPet: { findMany: async () => [{ id: petId, rank: 1, artRank: 1, avatar,
      generationStatus: "READY", lastFedAt: null }] },
    userItem: { findFirst: async () => ({ id: "orphaned-stack", quantity: 1, item: null }) },
  } } as unknown as DrizzleClient;
  const result = await callerForDatabase(petsRouter, userId, database).feedPet({
    petId, userItemId: "orphaned-stack", expectedQuantity: 1,
  });
  expect(result).toMatchObject({ success: false,
    message: "Carry a finished meal in your inventory to feed your companion." });
});

it("explains exhausted daily offers before collection capacity, even after a companion is released", async () => {
  const owner = {
    userId, rank: "GENIN", status: "AWAKE", sector: MAP_WAKE_ISLAND_SECTOR,
    federalStatus: "NONE", staffAccount: false, petSlots: 1, petAcquisitions: 1,
    petExperience: 0, activePetId: petId, petDailyClaims: null as null | { dayKey: string; speciesIds: string[] },
  };
  let pets = [{ id: petId, rank: 1, generationStatus: "FAILED", generationAttempts: 0, storedExperience: 0 }];
  const database = { query: {
    userData: { findFirst: async () => owner },
    userPet: { findMany: async () => pets },
    petSpecies: { findMany: async () => initialPetSpecies },
    jutsu: { findMany: async () => [] },
    userSkill: { findMany: async () => [] },
    userItem: { findMany: async () => [] },
  } } as unknown as DrizzleClient;
  const caller = callerForDatabase(petsRouter, userId, database);
  const available = await caller.getPet();
  expect(available.options.species.length).toBeGreaterThan(0);
  expect(available.unavailableReason).toContain("Unlock another collection slot");
  owner.petDailyClaims = { dayKey: available.dayKey, speciesIds: available.options.species.map(({ id }) => id) };
  const exhausted = await caller.getPet();
  expect(exhausted).toMatchObject({ options: { species: [] }, canAcquire: false,
    unavailableReason: "You have adopted all of today's companion species. New choices arrive at midnight UTC." });
  pets = [];
  expect(await caller.getPet()).toMatchObject({ options: { species: [] }, canAcquire: false,
    unavailableReason: exhausted.unavailableReason });
});

describeWithDatabase("Companion ownership, economy and generation", () => {
  beforeEach(async () => {
    await resetTables(gameSetting, petSpecies, userUpload, userPet, userSkill, userJutsu, userItem, skillTree, jutsu, item, userData);
    await insertPetSpecies(initialPetSpecies);
    await insertUsers([{ userId, username: "PetOwner", rank: "GENIN", sector: MAP_WAKE_ISLAND_SECTOR, status: "AWAKE", reputationPoints: 200 }]);
  });
  afterEach(() => { vi.restoreAllMocks(); PET_BATTLE_CONFIG.enabled = true; setSystemTime(); });

  it("lets only one concurrent request claim the first free companion", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petSlots: 2 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.acquirePet(input), caller.acquirePet(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await database.query.userPet.findMany()).toHaveLength(1);
    const owner = await readOwner(database);
    expect(owner?.petAcquisitions).toBe(1);
    expect(owner?.reputationPoints).toBe(200);
    expect(owner?.petDailyClaims).toEqual({ dayKey: input.dayKey, speciesIds: [input.speciesId] });
    expect(results.find((result) => result.success)?.userPatch).toMatchObject({
      activePetId: owner?.activePetId, petExperience: 0, petAcquisitions: 1,
      petDailyClaims: owner?.petDailyClaims,
    });
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect((await caller.getPet()).options.species.some(({ id }) => id === input.speciesId)).toBe(false);
  });

  it("stores the adoption gender and allows free gender edits only until the cutoff", async () => {
    setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const database = await getTestDatabase();
    const input = await adoptionInput(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.acquirePet({ ...input, gender: "FEMALE" })).success).toBe(true);
    const adopted = await database.query.userPet.findFirst();
    expect(adopted?.gender).toBe("FEMALE");
    await database.update(userPet).set({ generationStatus: "READY", avatar, artRank: 1, gender: null }).where(eq(userPet.id, adopted!.id));
    expect((await caller.updatePet({ petId: adopted!.id, gender: "MALE" })).success).toBe(true);
    expect(await readPet(database, adopted!.id)).toMatchObject({ gender: "MALE", generationAttempts: 0, avatar, artRank: 1, generationStatus: "READY" });
    await database.update(userPet).set({ generationStatus: "GENERATING" }).where(eq(userPet.id, adopted!.id));
    expect((await caller.updatePet({ petId: adopted!.id, gender: "FEMALE" })).success).toBe(false);
    await database.update(userPet).set({ generationStatus: "READY" }).where(eq(userPet.id, adopted!.id));
    setSystemTime(new Date("2026-11-26T00:00:00Z"));
    expect(await caller.updatePet({ petId: adopted!.id, gender: "FEMALE" })).toMatchObject({ success: false, message: "Companion gender can no longer be changed." });
    expect((await caller.updatePet({ petId: adopted!.id, name: "Still renamable" })).success).toBe(true);
    expect(await readPet(database, adopted!.id)).toMatchObject({ gender: "MALE", name: "Still renamable" });
  });

  it("copies eligible species defaults on sanctuary adoption without sharing mutable loadout state", async () => {
    const database = await getTestDatabase(); const input = await adoptionInput(database);
    const rules = [AiRule.parse({ conditions: [], action: { type: "end_turn" } })];
    await database.insert(jutsu).values([petJutsuFixture(), petJutsuFixture({ id: "hidden-default", name: "Hidden Default", hidden: true })]);
    await database.update(petSpecies).set({ defaultJutsuIds: ["pet-strike", "hidden-default"], aiRules: rules, includeDefaultRules: false }).where(eq(petSpecies.id, input.speciesId));
    expect((await callerForDatabase(petsRouter, userId, database).acquirePet(input)).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ name: input.name, speciesId: input.speciesId,
      jutsuIds: ["pet-strike"], aiRules: rules, includeDefaultRules: false,
      rank: 1, experience: 0, storedExperience: 0, generationStatus: "PENDING", avatar: null, artRank: 0,
    });
    await database.update(petSpecies).set({ aiRules: [], defaultJutsuIds: [] }).where(eq(petSpecies.id, input.speciesId));
    expect(await readPet(database)).toMatchObject({ jutsuIds: ["pet-strike"], aiRules: rules });
  });

  it("requires release before replacement and atomically debits one replacement", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petsRouter, userId, database);
    const input = await adoptionInput(database);
    expect((await caller.acquirePet(input)).success).toBe(true);
    expect((await caller.acquirePet(input)).success).toBe(false);
    const acquiredPet = await readPet(database);
    expect((await caller.releasePet({ petId: acquiredPet!.id })).success).toBe(true);
    expect((await caller.acquirePet(input)).success).toBe(false);
    const replacementInput = await adoptionInput(database);
    const racing = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([racing.acquirePet(replacementInput), racing.acquirePet(replacementInput)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const owner = await readOwner(database);
    expect(owner?.petAcquisitions).toBe(2);
    expect(owner?.reputationPoints).toBe(200 - PET_REPLACEMENT_COST);
  });

  it("consumes each offered species once while preserving the remaining daily offers", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petSlots: 2 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    const original = await caller.getPet();
    const first = await adoptionInput(database);
    expect((await caller.acquirePet(first)).success).toBe(true);
    const remaining = await caller.getPet();
    expect(remaining.options).toEqual({ ...original.options, species: original.options.species.slice(1) });
    const second = await adoptionInput(database);
    expect((await caller.acquirePet(second)).success).toBe(true);
    expect((await readOwner(database))?.petDailyClaims).toEqual({ dayKey: first.dayKey, speciesIds: [first.speciesId, second.speciesId] });
    expect((await readOwner(database))?.reputationPoints).toBe(200 - PET_REPLACEMENT_COST);
  });

  it("keeps released daily offers consumed until midnight UTC and resets the claim ledger", async () => {
    setSystemTime(new Date("2026-10-18T23:59:59Z"));
    const database = await getTestDatabase();
    const caller = callerForDatabase(petsRouter, userId, database);
    await database.update(petSpecies).set({ isActive: false });
    await database.update(petSpecies).set({ isActive: true }).where(eq(petSpecies.id, initialPetSpecies[0]!.id));
    const input = await adoptionInput(database);
    const adopted = await caller.acquirePet(input);
    expect(adopted.success).toBe(true);
    expect((await caller.releasePet({ petId: adopted.petId! })).success).toBe(true);
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect(await caller.getPet()).toMatchObject({ options: { species: [] }, canAcquire: false, unavailableReason: expect.stringContaining("midnight UTC") });
    setSystemTime(new Date("2026-10-19T00:00:01Z"));
    const nextDay = await adoptionInput(database);
    expect(nextDay.speciesId).toBe(input.speciesId);
    expect((await caller.acquirePet(nextDay)).success).toBe(true);
    expect((await readOwner(database))?.petDailyClaims).toEqual({ dayKey: "2026-10-19", speciesIds: [input.speciesId] });
  });

  it("does not consume a daily offer or charge its owner when the pet insertion fails", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petSlots: 2, petAcquisitions: 1 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const before = await readOwner(database);
    const create = creation.createPetFromSpecies;
    vi.spyOn(creation, "createPetFromSpecies").mockImplementation((args) => ({ ...create(args), id: petId }));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect(await readOwner(database)).toEqual(before);
    expect((await caller.getPet()).options.species.some(({ id }) => id === input.speciesId)).toBe(true);
    expect(await database.query.userPet.findMany()).toHaveLength(1);
  });

  it("does not create a replacement without its full guarded payment", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petAcquisitions: 1, reputationPoints: PET_REPLACEMENT_COST - 1 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    expect((await callerForDatabase(petsRouter, userId, database).acquirePet(input)).success).toBe(false);
    expect(await database.query.userPet.findMany()).toHaveLength(0);
    expect((await readOwner(database))?.reputationPoints).toBe(PET_REPLACEMENT_COST - 1);
    expect((await readOwner(database))?.petDailyClaims).toBeNull();
  });

  it("keeps the first adoption free when Seichi Silver is selected", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ reputationPoints: 0, seichiSilver: 0 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    expect((await callerForDatabase(petsRouter, userId, database).acquirePet({ ...input, currency: "SEICHI_SILVER" })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ reputationPoints: 0, seichiSilver: 0, petAcquisitions: 1 });
    expect(await database.query.userPet.findMany()).toHaveLength(1);
  });

  it.each(["adoption", "slot"] as const)("pays for a companion %s with exactly its Silver price without spending reputation", async (purchase) => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petAcquisitions: 1, seichiSilver: PET_SEICHI_SILVER_COST }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    const result = purchase === "adoption"
      ? await caller.acquirePet({ ...input, currency: "SEICHI_SILVER" })
      : await caller.unlockSlot({ currency: "SEICHI_SILVER" });
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ seichiSilver: -PET_SEICHI_SILVER_COST });
    expect(await readOwner(database)).toMatchObject({ reputationPoints: 200, seichiSilver: 0, petSlots: purchase === "slot" ? 2 : 1, petAcquisitions: purchase === "adoption" ? 2 : 1 });
    expect(await database.query.userPet.findMany()).toHaveLength(purchase === "adoption" ? 1 : 0);
  });

  it.each(["adoption", "slot"] as const)("does not fall back to reputation when Silver cannot cover a companion %s", async (purchase) => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petAcquisitions: 1, seichiSilver: PET_SEICHI_SILVER_COST - 1 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const before = await readOwner(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    const result = purchase === "adoption"
      ? await caller.acquirePet({ ...input, currency: "SEICHI_SILVER" })
      : await caller.unlockSlot({ currency: "SEICHI_SILVER" });
    expect(result.success).toBe(false);
    expect(await readOwner(database)).toEqual(before);
    expect(await database.query.userPet.findMany()).toHaveLength(0);
  });

  it("adopts newly authored species and retains their identity for generation after retirement", async () => {
    const database = await getTestDatabase();
    await database.update(petSpecies).set({ isActive: false });
    const species = { id: "authored-spirit-fox", name: "Spirit fox", description: "A fox with translucent ears", rarity: "RARE" as const, isActive: true };
    await insertPetSpecies([species]);
    const caller = callerForDatabase(petsRouter, userId, database);
    const input = await adoptionInput(database);
    expect(input.speciesId).toBe(species.id);
    expect((await caller.acquirePet(input)).success).toBe(true);
    const pet = (await readPet(database))!;
    expect(pet.speciesId).toBe(species.id);
    await database.update(petSpecies).set({ isActive: false }).where(eq(petSpecies.id, species.id));
    const view = await caller.getPet();
    expect(view.options.species).toEqual([]);
    expect(view.pet?.species).toMatchObject({ ...species, isActive: false });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId: pet.id })).success).toBe(true);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ species: expect.objectContaining({ id: species.id, description: species.description, isActive: false }) }), "GPT", expect.any(Function));
  });

  it("rejects a species retired after today's menu was loaded without granting a pet or charging reputation", async () => {
    const database = await getTestDatabase();
    const input = await adoptionInput(database);
    await database.update(petSpecies).set({ isActive: false }).where(eq(petSpecies.id, input.speciesId));
    const before = await readOwner(database);
    expect((await callerForDatabase(petsRouter, userId, database).acquirePet(input)).success).toBe(false);
    expect(await database.query.userPet.findMany()).toEqual([]);
    expect(await readOwner(database)).toEqual(before);
  });

  it("rejects tampered options, stale days and adoption away from Wake Island", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petsRouter, userId, database);
    const view = await caller.getPet();
    const input = await adoptionInput(database);
    const unavailable = initialPetSpecies.find(({ id }) => !view.options.species.some((option) => option.id === id))!;
    expect((await caller.acquirePet({ ...input, speciesId: unavailable.id })).success).toBe(false);
    expect((await caller.acquirePet({ ...input, dayKey: "2000-01-01" })).success).toBe(false);
    await database.update(userData).set({ sector: 1 }).where(eq(userData.userId, userId));
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect(await database.query.userPet.findMany()).toHaveLength(0);
    expect((await readOwner(database))?.petAcquisitions).toBe(0);
  });

  it("enforces live capacity when parallel reads observe a fresh owner and stale collection", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petSlots: 2, petAcquisitions: 1 }).where(eq(userData.userId, userId));
    const stalePets = await database.query.userPet.findMany();
    const input = await adoptionInput(database);
    expect((await callerForDatabase(petsRouter, userId, database).acquirePet(input)).success).toBe(true);
    const nextInput = await adoptionInput(database);
    const petQueries = new Proxy(database.query.userPet, { get(target, property, receiver) {
      return property === "findMany" ? async () => stalePets : Reflect.get(target, property, receiver);
    } });
    const skewed = new Proxy(database, { get(target, property, receiver) {
      return property === "query" ? { ...target.query, userPet: petQueries } : Reflect.get(target, property, receiver);
    } });
    const before = await readOwner(database);
    expect((await callerForDatabase(petsRouter, userId, skewed).acquirePet(nextInput)).success).toBe(false);
    expect(await database.query.userPet.findMany()).toHaveLength(2);
    expect(await readOwner(database)).toEqual(before);
  });

  it("charges only the winning currency when concurrent slot purchases reach the permanent collection limit", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petSlots: PET_MAX_COLLECTION_SLOTS - 1, seichiSilver: PET_SEICHI_SILVER_COST }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.unlockSlot({ currency: "REPUTATION" }), caller.unlockSlot({ currency: "SEICHI_SILVER" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const balances = { reputationPoints: results[0]!.success ? 200 - PET_COLLECTION_SLOT_COST : 200, seichiSilver: results[1]!.success ? 0 : PET_SEICHI_SILVER_COST };
    expect(await readOwner(database)).toMatchObject({ petSlots: PET_MAX_COLLECTION_SLOTS, ...balances });
    expect((await caller.unlockSlot()).success).toBe(false);
    expect(await readOwner(database)).toMatchObject(balances);
    await database.update(userData).set({ petSlots: 1, reputationPoints: PET_COLLECTION_SLOT_COST - 1 }).where(eq(userData.userId, userId));
    expect((await caller.unlockSlot()).success).toBe(false);
    expect((await readOwner(database))?.petSlots).toBe(1);
  });

  it("charges only the winning currency when adopting into the last free slot without moving active XP", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petSlots: 2, petAcquisitions: 1, petExperience: 75, seichiSilver: PET_SEICHI_SILVER_COST }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.acquirePet({ ...input, currency: "REPUTATION" }), caller.acquirePet({ ...input, currency: "SEICHI_SILVER" })]);
    const acquired = results.find((result) => result.success)!;
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 75, petAcquisitions: 2, reputationPoints: results[0]!.success ? 200 - PET_REPLACEMENT_COST : 200, seichiSilver: results[1]!.success ? 0 : PET_SEICHI_SILVER_COST });
    expect(await database.query.userPet.findMany()).toHaveLength(2);
    expect(await readPet(database, acquired.petId!)).toMatchObject({ generationStatus: "PENDING", storedExperience: 0, experience: 0 });
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { federalStatus: "NONE" as const, staffAccount: false, bonus: 0 },
    { federalStatus: "NORMAL" as const, staffAccount: false, bonus: 1 },
    { federalStatus: "SILVER" as const, staffAccount: false, bonus: 2 },
    { federalStatus: "GOLD" as const, staffAccount: false, bonus: 3 },
    { federalStatus: "NONE" as const, staffAccount: true, bonus: 3 },
  ])("reports effective supporter capacity without writing bonus slots: %j", async ({ federalStatus, staffAccount, bonus }) => {
    const database = await getTestDatabase();
    await database.update(userData).set({ federalStatus, staffAccount, petSlots: 2 }).where(eq(userData.userId, userId));
    const before = await readOwner(database);
    expect(await callerForDatabase(petsRouter, userId, database).getPet()).toMatchObject({ permanentSlots: 2, bonusSlots: bonus, slots: 2 + bonus, maxSlots: PET_MAX_COLLECTION_SLOTS + bonus });
    expect(await readOwner(database)).toEqual(before);
  });

  it("adds Gold's three bonus slots above all six permanent slots without letting them be purchased again", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await Promise.all(Array.from({ length: 7 }, (_, index) => parkedPet(database, { id: `gold-parked-${index}` })));
    await database.update(userData).set({ federalStatus: "GOLD", petSlots: PET_MAX_COLLECTION_SLOTS, petAcquisitions: 8 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    const input = await adoptionInput(database);
    expect(await caller.getPet()).toMatchObject({ permanentSlots: 6, bonusSlots: 3, slots: 9, maxSlots: 9, canAcquire: true });
    expect((await caller.acquirePet(input)).success).toBe(true);
    expect(await database.query.userPet.findMany()).toHaveLength(9);
    expect(await caller.getPet()).toMatchObject({ permanentSlots: 6, slots: 9, canAcquire: false });
    const before = await readOwner(database);
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect((await caller.unlockSlot()).success).toBe(false);
    expect(await readOwner(database)).toEqual(before);
  });

  it.each(["supporter", "staff"] as const)("rejects adoption after %s bonus capacity disappears without an updatedAt change", async (source) => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ federalStatus: source === "supporter" ? "GOLD" : "NONE", staffAccount: source === "staff", petAcquisitions: 1 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const before = (await readOwner(database))!;
    const companionBefore = await readPet(database);
    const hooked = beforeTransaction(database, async () => {
      await database.update(userData).set({ federalStatus: "NONE", staffAccount: false, updatedAt: before.updatedAt }).where(eq(userData.userId, userId));
    });
    expect((await callerForDatabase(petsRouter, userId, hooked).acquirePet(input)).success).toBe(false);
    expect(await readOwner(database)).toEqual({ ...before, federalStatus: "NONE", staffAccount: false });
    expect(await readPet(database)).toEqual(companionBefore);
    expect(await database.query.userPet.findMany()).toHaveLength(1);
  });

  it("rechecks the selected Silver balance before granting an adoption from a stale snapshot", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ petAcquisitions: 1, seichiSilver: PET_SEICHI_SILVER_COST }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    const before = (await readOwner(database))!;
    const hooked = beforeTransaction(database, async () => {
      await database.update(userData).set({ seichiSilver: PET_SEICHI_SILVER_COST - 1, updatedAt: before.updatedAt }).where(eq(userData.userId, userId));
    });
    expect((await callerForDatabase(petsRouter, userId, hooked).acquirePet({ ...input, currency: "SEICHI_SILVER" })).success).toBe(false);
    expect(await readOwner(database)).toEqual({ ...before, seichiSilver: PET_SEICHI_SILVER_COST - 1 });
    expect(await database.query.userPet.findMany()).toHaveLength(0);
  });

  it("retains companions, progress, activation and feeding above capacity after supporter loss", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { experience: 200 });
    await parkedPet(database, { experience: 100, storedExperience: 30 });
    await mealStack();
    await database.update(userData).set({ federalStatus: "NORMAL", petExperience: 10, petAcquisitions: 2 }).where(eq(userData.userId, userId));
    const input = await adoptionInput(database);
    await database.update(userData).set({ federalStatus: "NONE" }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    const before = await readOwner(database);
    expect(await caller.getPet({ petId: "parked" })).toMatchObject({ slots: 1, bonusSlots: 0, canAcquire: false, unusedExperience: 30, pet: { id: "parked", experience: 100 } });
    expect((await caller.acquirePet(input)).success).toBe(false);
    expect(await readOwner(database)).toEqual(before);
    expect(await caller.activatePet({ petId: "parked" })).toMatchObject({ success: true,
      userPatch: { activePetId: "parked", petExperience: 30 } });
    expect(await caller.feedPet({ petId: "parked", userItemId: "meal-stack", expectedQuantity: 2 })).toMatchObject({ success: true,
      userDelta: { petExperience: PET_FEED_EXPERIENCE_BY_RARITY.COMMON } });
    expect(await readOwner(database)).toMatchObject({ activePetId: "parked", petSlots: 1, petExperience: 30 + PET_FEED_EXPERIENCE_BY_RARITY.COMMON, reputationPoints: 200 });
    expect(await readPet(database, petId)).toMatchObject({ storedExperience: 10, experience: 200 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 0, experience: 100 });
    expect(await database.query.userPet.findMany()).toHaveLength(2);
  });

  it("moves each XP bank with its companion, including XP earned immediately before the swap", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "parked", storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userData).set({ petExperience: petExperienceGainSql(25, petId) }).where(eq(userData.userId, userId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).activatePet({ petId: "parked" })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ activePetId: "parked", petExperience: 30 });
    expect(await readPet(database, petId)).toMatchObject({ storedExperience: 35 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 0 });
    await database.update(userData).set({ petExperience: petExperienceGainSql(100, petId) }).where(eq(userData.userId, userId));
    expect((await readOwner(database))?.petExperience).toBe(30);
    await database.update(userData).set({ petExperience: petExperienceGainSql(7, "parked") }).where(eq(userData.userId, userId));
    expect((await callerForDatabase(petsRouter, userId, database).activatePet({ petId })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 35 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 37 });
  });

  it("preserves all XP when two companions compete to become active", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "second", storedExperience: 20 });
    await parkedPet(database, { id: "third", storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.activatePet({ petId: "second" }), caller.activatePet({ petId: "third" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const owner = (await readOwner(database))!;
    const pets = await database.query.userPet.findMany();
    expect(owner.activePetId === "second" || owner.activePetId === "third").toBe(true);
    expect(pets.find((pet) => pet.id === owner.activePetId)?.storedExperience).toBe(0);
    expect(owner.petExperience + pets.reduce((total, pet) => total + pet.storedExperience, 0)).toBe(60);
  });

  it("rolls back both XP transfers if the selected companion changes before activation", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "parked", storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, "parked"));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).activatePet({ petId: "parked" })).success).toBe(false);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 10 });
    expect((await readPet(database, petId))?.storedExperience).toBe(0);
    expect((await readPet(database, "parked"))?.storedExperience).toBe(30);
  });

  it("keeps both XP banks unchanged when the previous companion changes before activation", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).activatePet({ petId: "parked" })).success).toBe(false);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 10 });
    expect(await readPet(database, petId)).toMatchObject({ storedExperience: 0, revision: 1 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 30, revision: 0 });
  });

  it("refuses a swap when a skewed collection snapshot omits the active companion", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const pets = await database.query.userPet.findMany({ where: eq(userPet.id, "parked") });
    const petQueries = new Proxy(database.query.userPet, { get(target, property, receiver) {
      return property === "findMany" ? async () => pets : Reflect.get(target, property, receiver);
    } });
    const skewed = new Proxy(database, { get(target, property, receiver) {
      return property === "query" ? { ...target.query, userPet: petQueries } : Reflect.get(target, property, receiver);
    } });
    expect((await callerForDatabase(petsRouter, userId, skewed).activatePet({ petId: "parked" })).success).toBe(false);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 10 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 30, revision: 0 });
  });

  it("activates a parked companion when no companion is currently selected", async () => {
    const database = await getTestDatabase();
    await parkedPet(database, { storedExperience: 30 });
    expect((await callerForDatabase(petsRouter, userId, database).activatePet({ petId: "parked" })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ activePetId: "parked", petExperience: 30 });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 0, revision: 1 });
  });

  it("serializes allocation with swapping so XP is either spent or parked exactly once", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "parked", storedExperience: 20 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.assignExperience({ ...stats, petId }), caller.activatePet({ petId: "parked" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const owner = (await readOwner(database))!;
    const pets = await database.query.userPet.findMany();
    expect(owner.petExperience + pets.reduce((total, pet) => total + pet.storedExperience + pet.experience, 0)).toBe(30);
    expect((await readPet(database, petId))?.offence).toBe(results[0]!.success ? 20 : 10);
  });

  it("trains and releases parked companions without using the active companion's bank", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "parked", storedExperience: 20 });
    await database.update(userData).set({ petExperience: 99 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect(await caller.assignExperience({ ...stats, petId: "parked" })).toMatchObject({ success: true, userPatch: {} });
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 10, experience: 10, offence: 20 });
    expect((await caller.assignExperience({ ...stats, offence: 11, petId: "parked" })).success).toBe(false);
    expect((await caller.releasePet({ petId: "parked" })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 99 });
    expect(await readPet(database, "parked")).toBeUndefined();
  });

  it("serializes inactive release against activation of the same companion", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { storedExperience: 30 });
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.releasePet({ petId: "parked" }), caller.activatePet({ petId: "parked" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    if (results[0]!.success) {
      expect(await readPet(database, "parked")).toBeUndefined();
      expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 10 });
      expect((await readPet(database, petId))?.storedExperience).toBe(0);
    } else {
      expect(await readOwner(database)).toMatchObject({ activePetId: "parked", petExperience: 30 });
      expect((await readPet(database, "parked"))?.storedExperience).toBe(0);
      expect((await readPet(database, petId))?.storedExperience).toBe(10);
    }
  });

  it("preserves an inactive companion if its revision changes before release", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { storedExperience: 30 });
    const before = await readOwner(database);
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, "parked"));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).releasePet({ petId: "parked" })).success).toBe(false);
    expect(await readOwner(database)).toEqual(before);
    expect(await readPet(database, "parked")).toMatchObject({ storedExperience: 30, revision: 1 });
  });

  it("rejects foreign companion reads and mutations without spending or dispatching generation", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await insertUsers([{ userId: "other-owner", username: "OtherOwner" }]);
    await parkedPet(database, { id: "foreign", userId: "other-owner", generationStatus: "PENDING", artRank: 0, avatar: null, generationToken: "private" });
    await mealStack();
    const before = await readOwner(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, database);
    const selection = { petId: "foreign" };
    const results = await Promise.all([
      caller.activatePet(selection), caller.releasePet(selection), caller.rankUp(selection),
      caller.updateAbilities({ ...selection, jutsuIds: [], skillIds: [] }),
      caller.assignExperience({ ...selection, ...stats }), caller.updatePet({ ...selection, name: "Stolen" }),
      caller.updateAiConfig({ ...selection, rules: [], includeDefaultRules: true }),
      caller.feedPet({ ...selection, userItemId: "meal-stack", expectedQuantity: 2 }),
      caller.generateAppearance(selection),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect((await caller.getPet(selection)).pet).toBeNull();
    expect((await caller.getCollection()).pets.map((pet) => pet.id)).toEqual([petId]);
    expect((await caller.getCollection()).pets[0]).not.toHaveProperty("generationToken");
    expect(await readOwner(database)).toEqual(before);
    expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([{ status: "BATTLE" as const, battleId: null }, { status: "AWAKE" as const, battleId: "frozen-battle" }])("blocks collection, build, XP and meal mutations during combat: %j", async (state) => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 4, artRank: 4, experience: 105000 });
    await parkedPet(database, { id: "parked" });
    await mealStack();
    const input = await adoptionInput(database);
    await database.update(userData).set({ rank: "ELITE JONIN", petSlots: 3, petExperience: 100, ...state }).where(eq(userData.userId, userId));
    const before = await readOwner(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    const results = await Promise.all([
      caller.unlockSlot(), caller.acquirePet(input), caller.activatePet({ petId: "parked" }),
      caller.releasePet({ petId }), caller.rankUp({ petId }),
      caller.updateAbilities({ petId, jutsuIds: [], skillIds: [] }), caller.assignExperience({ petId, ...stats }),
      caller.updatePet({ petId, battleEnabled: false }), caller.updateAiConfig({ petId, rules: [], includeDefaultRules: false }),
      caller.feedPet({ petId, userItemId: "meal-stack", expectedQuantity: 2 }),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(await readOwner(database)).toEqual(before);
    expect((await readPet(database, petId))?.revision).toBe(0);
    expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
  });

  it("consumes one meal and grants one feeding reward under concurrent requests, then allows another after its cooldown", async () => {
    PET_BATTLE_CONFIG.enabled = false;
    const database = await getTestDatabase();
    await readyPet(database);
    await mealStack();
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const input = { petId, userItemId: "meal-stack", expectedQuantity: 2 };
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.feedPet(input), caller.feedPet(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await readOwner(database))?.petExperience).toBe(10 + PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
    expect((await readPet(database))?.lastFedAt).toBeInstanceOf(Date);
    expect((await database.query.userItem.findFirst())?.quantity).toBe(1);
    expect((await caller.feedPet({ ...input, expectedQuantity: 1 })).success).toBe(false);
    await database.update(userPet).set({ lastFedAt: secondsFromNow(-PET_FEED_COOLDOWN_HOURS * HOUR_S) }).where(eq(userPet.id, petId));
    expect((await caller.feedPet({ ...input, expectedQuantity: 1 })).success).toBe(true);
    expect(await database.query.userItem.findFirst()).toBeUndefined();
    expect((await readOwner(database))?.petExperience).toBe(10 + 2 * PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
  });

  for (const rank of [1, 2]) it.each([...ItemRarities])(`feeds the configured %s meal reward independently of pet rank ${rank}`, async (rarity) => {
    const database = await getTestDatabase(); await readyPet(database, { rank, artRank: rank }); await mealStack(rarity);
    const caller = callerForDatabase(petsRouter, userId, database);
    const view = await caller.getPet();
    expect(view.feedMeals).toMatchObject([{ id: "meal-stack", rarity, experience: PET_FEED_EXPERIENCE_BY_RARITY[rarity] }]);
    expect(view).not.toHaveProperty("feedExperience");
    expect((await caller.feedPet({ petId, userItemId: "meal-stack", expectedQuantity: 2 })).success).toBe(true);
    expect((await readOwner(database))?.petExperience).toBe(PET_FEED_EXPERIENCE_BY_RARITY[rarity]);
  });

  // Midnight cannot shorten a cooldown or delay a companion's second meal that day.
  for (const [fedAt, nextFeedAt, duringCooldown] of [
    ["2026-10-18T01:00:00.000Z", "2026-10-18T04:00:00.000Z", "2026-10-18T02:00:00.000Z"],
    ["2026-10-17T23:30:00.000Z", "2026-10-18T02:30:00.000Z", "2026-10-18T00:30:00.000Z"],
  ] as const) it.each([false, true])(`enforces the three-hour deadline after ${fedAt} with companion combat enabled=%s`, async (battleEnabled) => {
    const previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
    try {
      PET_BATTLE_CONFIG.enabled = battleEnabled;
      const lastFedAt = new Date(fedAt);
      const availableAt = new Date(nextFeedAt);
      setSystemTime(new Date(duringCooldown));
      const database = await getTestDatabase();
      await readyPet(database, { lastFedAt });
      await mealStack();
      const caller = callerForDatabase(petsRouter, userId, database);
      const input = { petId, userItemId: "meal-stack", expectedQuantity: 2 };
      expect(await caller.getPet()).toMatchObject({ canFeed: false, feedAvailableAt: availableAt });
      const original = await readPet(database);
      expect(await caller.feedPet(input)).toMatchObject({ success: false,
        message: `Feed this companion once every ${PET_FEED_COOLDOWN_HOURS} hours. Wait until its next feeding is available.` });
      setSystemTime(new Date(availableAt.getTime() - 1));
      expect((await caller.feedPet(input)).success).toBe(false);
      expect(await readPet(database)).toEqual(original);
      expect((await readOwner(database))?.petExperience).toBe(0);
      expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
      setSystemTime(availableAt);
      expect(await caller.getPet()).toMatchObject({ canFeed: true, feedAvailableAt: null });
      expect((await caller.feedPet(input)).success).toBe(true);
      expect((await readPet(database))?.lastFedAt).toEqual(availableAt);
      expect((await readOwner(database))?.petExperience).toBe(PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
      expect((await database.query.userItem.findFirst())?.quantity).toBe(1);
      expect((await caller.feedPet({ ...input, expectedQuantity: 1 })).success).toBe(false);
    } finally {
      PET_BATTLE_CONFIG.enabled = previousBattleEnabled;
      setSystemTime();
    }
  });

  it("feeds a parked companion into its own bank, which follows it when activated", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await parkedPet(database, { id: "parked", rank: 2, artRank: 2, storedExperience: 11 });
    await mealStack();
    await database.update(userData).set({ petExperience: 99 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.feedPet({ petId: "parked", userItemId: "meal-stack", expectedQuantity: 2 })).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ activePetId: petId, petExperience: 99 });
    expect((await readPet(database, "parked"))?.storedExperience).toBe(11 + PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
    expect((await caller.activatePet({ petId: "parked" })).success).toBe(true);
    expect((await readOwner(database))?.petExperience).toBe(11 + PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
    expect((await readPet(database, petId))?.storedExperience).toBe(99);
  });

  it("keeps a committed feed successful when zero-stack cleanup fails", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await mealStack();
    await database.update(userItem).set({ quantity: 1 }).where(eq(userItem.id, "meal-stack"));
    const hooked = beforeStatements(database, userItem, [async () => {}, async () => {
      throw new Error("Meal cleanup failed");
    }]);
    const caller = callerForDatabase(petsRouter, userId, hooked);
    const input = { petId, userItemId: "meal-stack", expectedQuantity: 1 };
    expect((await caller.feedPet(input)).success).toBe(true);
    expect((await readOwner(database))?.petExperience).toBe(PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
    expect((await readPet(database))?.lastFedAt).toBeInstanceOf(Date);
    expect((await database.query.userItem.findFirst())?.quantity).toBe(0);
    expect((await caller.getPet()).feedMeals).toEqual([]);
    expect((await caller.feedPet(input)).success).toBe(false);
    await database.update(userPet).set({ lastFedAt: secondsFromNow(-PET_FEED_COOLDOWN_HOURS * HOUR_S) }).where(eq(userPet.id, petId));
    expect((await caller.feedPet(input)).success).toBe(false);
    expect((await readOwner(database))?.petExperience).toBe(PET_FEED_EXPERIENCE_BY_RARITY.COMMON);
  });

  it.each(["stack", "pet"] as const)("rolls back feeding's meal and XP if its %s snapshot changes", async (changed) => {
    const database = await getTestDatabase();
    await readyPet(database);
    await mealStack();
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      if (changed === "stack")
        await database.update(userItem).set({ quantity: 1 }).where(eq(userItem.id, "meal-stack"));
      else
        await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).feedPet({ petId, userItemId: "meal-stack", expectedQuantity: 2 })).success).toBe(false);
    expect((await readOwner(database))?.petExperience).toBe(10);
    expect((await readPet(database))?.lastFedAt).toBeNull();
    expect((await database.query.userItem.findFirst())?.quantity).toBe(changed === "stack" ? 1 : 2);
  });

  it("requires an owned, carried, finished meal and accepted pet art before consuming anything", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await mealStack();
    await insertUsers([{ userId: "meal-owner", username: "MealOwner" }]);
    const caller = callerForDatabase(petsRouter, userId, database);
    const input = { petId, userItemId: "meal-stack", expectedQuantity: 2 };
    const unavailable = [
      { userId: "meal-owner" }, { storedAtHome: true }, { isInAuction: true },
      { equipped: "CHEST" as const }, { craftingFinishedAt: secondsFromNow(60) },
    ];
    for (const patch of unavailable) {
      await database.update(userItem).set({ userId, storedAtHome: false, isInAuction: false, equipped: "NONE", craftingFinishedAt: null, ...patch }).where(eq(userItem.id, "meal-stack"));
      expect((await caller.feedPet(input)).success).toBe(false);
    }
    await database.update(userItem).set({ craftingFinishedAt: null }).where(eq(userItem.id, "meal-stack"));
    await database.update(userPet).set({ generationStatus: "PENDING" }).where(eq(userPet.id, petId));
    expect((await caller.feedPet(input)).success).toBe(false);
    expect((await readOwner(database))?.petExperience).toBe(0);
    expect((await readPet(database))?.lastFedAt).toBeNull();
    expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
  });

  it("uses single statements for routine pet writes and preserves JSON patches", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 4, artRank: 4 });
    await parkedPet(database, { storedExperience: 30, experience: 7500 });
    await mealStack();
    await database.update(userData).set({ rank: "CHUNIN", petExperience: 20 }).where(eq(userData.userId, userId));
    const withoutTransactions = new Proxy(database, { get(target, property, receiver) {
      if (property === "transaction") return () => { throw new Error("Routine pet writes must not use a transaction"); };
      return Reflect.get(target, property, receiver);
    } });
    const caller = callerForDatabase(petsRouter, userId, withoutTransactions);
    const rules = [{ conditions: [], action: { type: "end_turn" as const, description: 'Wait for "Kumo"' } }];
    expect((await caller.updatePet({ petId, name: 'Kumo "守"', battleEnabled: false, spawnPosition: "LEFT" })).success).toBe(true);
    expect((await caller.updateAiConfig({ petId, rules, includeDefaultRules: false })).success).toBe(true);
    expect((await caller.updateAbilities({ petId, jutsuIds: [], skillIds: [] })).success).toBe(true);
    expect((await caller.assignExperience({ petId, ...stats })).success).toBe(true);
    expect((await caller.feedPet({ petId, userItemId: "meal-stack", expectedQuantity: 2 })).success).toBe(true);
    expect(await readPet(database, petId)).toMatchObject({ name: 'Kumo "守"', battleEnabled: false, spawnPosition: "LEFT", aiRules: rules, includeDefaultRules: false, jutsuIds: [], skillIds: [], offence: 20 });
    expect((await caller.activatePet({ petId: "parked" })).success).toBe(true);
    expect((await caller.rankUp({ petId: "parked" })).success).toBe(true);
    expect(await readPet(database, "parked")).toMatchObject({ rank: 2, generationStatus: "PENDING", generationToken: null, generationStartedAt: null });
    expect((await caller.releasePet({ petId })).success).toBe(true);
    expect((await readOwner(database))?.reputationPoints).toBe(200);
  });

  it("rejects a settings change when the owner enters battle before its joined write", async () => {
    const database = await getTestDatabase(); await readyPet(database);
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userData).set({ status: "BATTLE", battleId: "new-battle" }).where(eq(userData.userId, userId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).updatePet({ petId, name: "Changed" })).success).toBe(false);
    expect(await readPet(database)).toMatchObject({ name: "Kumo", revision: 0 });
    expect((await readOwner(database))?.reputationPoints).toBe(200);
  });

  it.each([...PetRarities])("exposes every %s species slot without buying upgrades", async (rarity) => {
    const database = await getTestDatabase(); await readyPet(database, { rank: 10, artRank: 10, experience: 2000000 });
    await database.update(userData).set({ rank: "ELITE JONIN" }).where(eq(userData.userId, userId));
    await database.update(petSpecies).set({ rarity }).where(eq(petSpecies.id, "pet-species-0"));
    const jutsus = Array.from({ length: 6 }, (_, index) => petJutsuFixture({ id: `slot-jutsu-${index}`, name: `Slot Jutsu ${index}` }));
    await database.insert(jutsu).values(jutsus);
    const caller = callerForDatabase(petsRouter, userId, database);
    const slots = PET_ABILITY_SLOTS_BY_RARITY[rarity];
    expect((await caller.getPet()).abilityCapacity?.maxSlots).toBe(slots);
    const ids = jutsus.slice(0, slots).map((entry) => entry.id);
    expect((await caller.updateAbilities({ petId, jutsuIds: ids, skillIds: [] })).success).toBe(true);
    if (slots < jutsus.length) expect((await caller.updateAbilities({ petId, jutsuIds: jutsus.slice(0, slots + 1).map((entry) => entry.id), skillIds: [] })).success).toBe(false);
    expect((await readPet(database))?.jutsuIds).toEqual(ids);
    expect((await readOwner(database))?.reputationPoints).toBe(200);
  });

  it("keeps an away companion immutable and prevents its active passive XP gain", async () => {
    const database = await getTestDatabase(); await readyPet(database, { rank: 5, artRank: 5, experience: 232500 });
    await mealStack();
    await database.update(userData).set({ rank: "ELITE JONIN", petExperience: 100, petTask: task() }).where(eq(userData.userId, userId));
    const beforeOwner = await readOwner(database); const beforePet = await readPet(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, database);
    const results = await Promise.all([
      caller.activatePet({ petId }), caller.releasePet({ petId }), caller.rankUp({ petId }),
      caller.updateAbilities({ petId, jutsuIds: [], skillIds: [] }), caller.assignExperience({ petId, ...stats }),
      caller.updatePet({ petId, name: "Changed" }), caller.updateAiConfig({ petId, rules: [], includeDefaultRules: false }),
      caller.feedPet({ petId, userItemId: "meal-stack", expectedQuantity: 2 }), caller.generateAppearance({ petId }),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(await readOwner(database)).toEqual(beforeOwner); expect(await readPet(database)).toEqual(beforePet);
    expect(generate).not.toHaveBeenCalled(); expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
    await database.update(userData).set({ petExperience: petExperienceGainSql(50) }).where(eq(userData.userId, userId));
    expect((await readOwner(database))?.petExperience).toBe(100);
    await database.update(userData).set({ petTask: null }).where(eq(userData.userId, userId));
    await database.update(userData).set({ petExperience: petExperienceGainSql(50) }).where(eq(userData.userId, userId));
    expect((await readOwner(database))?.petExperience).toBe(150);
  });

  it.each([false, true])("rejects an owner mutation after the task receipt changes (existing=%s)", async (existing) => {
    const database = await getTestDatabase(); await readyPet(database);
    if (existing) await database.update(userData).set({ petTask: task({ petId: "other-pet" }) }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userData).set({ petTask: task({ petId: existing ? "other-pet" : petId, startedAt: 2 }) }).where(eq(userData.userId, userId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).updatePet({ petId, name: "Changed" })).success).toBe(false);
    expect(await readPet(database)).toMatchObject({ name: "Kumo", revision: 0 });
  });

  it("keeps settings and evolution free when no reputation remains", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { experience: 7500 });
    await database.update(userData).set({ reputationPoints: 0 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.updatePet({ petId, name: "Still free" })).success).toBe(true);
    expect((await caller.updateAiConfig({ petId, rules: [], includeDefaultRules: false })).success).toBe(true);
    expect((await caller.updateAbilities({ petId, jutsuIds: [], skillIds: [] })).success).toBe(true);
    expect((await caller.rankUp({ petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ name: "Still free", rank: 2, includeDefaultRules: false });
    expect((await readOwner(database))?.reputationPoints).toBe(0);
  });

  it("offers published pet jutsus without learned copies and excludes incompatible content", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    const originalPet = await readPet(database);
    const foreignSpeciesId = initialPetSpecies.find(({ id }) => id !== originalPet!.speciesId)!.id;
    await database.insert(jutsu).values([
      petJutsuFixture(),
      petJutsuFixture({ id: "matching-species-strike", name: "Matching Species Strike", requiredPetSpeciesId: originalPet!.speciesId }),
      petJutsuFixture({ id: "foreign-species-strike", name: "Foreign Species Strike", requiredPetSpeciesId: foreignSpeciesId }),
      petJutsuFixture({ id: "human-strike", name: "Human Strike", jutsuType: "NORMAL" }),
      petJutsuFixture({ id: "hidden-strike", name: "Hidden Strike", hidden: true }),
      petJutsuFixture({ id: "injected-strike", name: "Injected Strike", injectableInBattle: true }),
      petJutsuFixture({ id: "elemental-strike", name: "Elemental Strike", elementClassification: "Fire" }),
    ]);
    await database.insert(userJutsu).values({ id: "learned-human-strike", userId, jutsuId: "human-strike" });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.getPet()).abilities.jutsus.map((entry) => entry.id).sort())
      .toEqual(["matching-species-strike", "pet-strike"]);
    const originalOwner = await readOwner(database);
    for (const id of ["human-strike", "hidden-strike", "injected-strike", "elemental-strike", "missing-strike"]) {
      expect((await caller.updateAbilities({ petId, jutsuIds: [id], skillIds: [] })).success).toBe(false);
      expect(await readPet(database)).toEqual(originalPet);
      expect(await readOwner(database)).toEqual(originalOwner);
    }
  });

  it("equips published pet jutsus and activated owned skills within rarity slots and the shared budget", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 4, artRank: 4, experience: 100000 });
    await database.update(userData).set({ rank: "CHUNIN", petExperience: 75 }).where(eq(userData.userId, userId));
    await insertUsers([{ userId: "ability-owner", username: "AbilityOwner" }]);
    await database.insert(jutsu).values([
      petJutsuFixture(), petJutsuFixture({ id: "expensive-strike", name: "Expensive Strike", jutsuRank: "S" }),
    ]);
    await database.insert(skillTree).values([
      petSkillFixture(), petSkillFixture({ id: "inactive-skill", name: "Inactive Skill" }),
      petSkillFixture({ id: "foreign-skill", name: "Foreign Skill" }),
    ]);
    await database.insert(userSkill).values([
      { id: "owned-skill", userId, skillId: "pet-muscle" },
      { id: "inactive-owned", userId, skillId: "inactive-skill", activated: false },
      { id: "foreign-owned", userId: "ability-owner", skillId: "foreign-skill" },
    ]);
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.getPet()).abilities.skills.map((entry) => entry.id)).toEqual(["pet-muscle"]);
    const valid = { petId, jutsuIds: ["pet-strike"], skillIds: ["pet-muscle"] };
    expect((await caller.updateAbilities(valid)).success).toBe(true);
    const saved = await readPet(database);
    for (const loadout of [
      { ...valid, skillIds: ["foreign-skill"] },
      { ...valid, skillIds: ["inactive-skill"] },
      { ...valid, jutsuIds: ["expensive-strike"] },
      { ...valid, jutsuIds: ["pet-strike", "pet-strike"], skillIds: [] },
    ]) expect((await caller.updateAbilities(loadout)).success).toBe(false);
    await database.update(userSkill).set({ activated: false }).where(eq(userSkill.id, "owned-skill"));
    expect((await caller.updateAbilities(valid)).success).toBe(false);
    expect(await readPet(database)).toEqual(saved);
    expect(await readOwner(database)).toMatchObject({ reputationPoints: 200, petExperience: 75 });
    expect(await database.query.userJutsu.findMany()).toHaveLength(0);
    expect(await database.query.userSkill.findMany()).toHaveLength(3);
  });

  it.each([
    { state: "retired", patch: { hidden: true } },
    { state: "retyped", patch: { jutsuType: "NORMAL" as const } },
    { state: "injected", patch: { injectableInBattle: true } },
  ])("excludes a saved jutsu after it is $state and rejects it without altering companion or XP", async ({ patch }) => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 75 }).where(eq(userData.userId, userId));
    await database.insert(jutsu).values(petJutsuFixture());
    const caller = callerForDatabase(petsRouter, userId, database);
    const input = { petId, jutsuIds: ["pet-strike"], skillIds: [] };
    expect((await caller.updateAbilities(input)).success).toBe(true);
    const savedPet = await readPet(database);
    const owner = await readOwner(database);
    await database.update(jutsu).set(patch).where(eq(jutsu.id, "pet-strike"));
    expect((await caller.getPet()).abilities.jutsus).toEqual([]);
    expect((await caller.updateAbilities(input)).success).toBe(false);
    expect(await readPet(database)).toEqual(savedPet);
    expect(await readOwner(database)).toEqual(owner);
  });

  it("resets XP gained before release and excludes the released identity from later rewards", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 15, petAcquisitions: 1 }).where(eq(userData.userId, userId));
    const hooked = beforeTransaction(database, async () => {
      await database.update(userData).set({ petExperience: petExperienceGainSql(25, petId) }).where(eq(userData.userId, userId));
    });
    expect((await callerForDatabase(petsRouter, userId, hooked).releasePet({ petId })).success).toBe(true);
    expect((await readOwner(database))?.petExperience).toBe(0);
    await database.update(userData).set({ petExperience: petExperienceGainSql(100, petId) }).where(eq(userData.userId, userId));
    expect((await readOwner(database))?.petExperience).toBe(0);
    expect((await readOwner(database))?.petAcquisitions).toBe(1);
  });

  it("rolls back XP reset when release loses its pet snapshot", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 50 }).where(eq(userData.userId, userId));
    const hooked = beforeTransaction(database, async () => {
      await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
    });
    expect((await callerForDatabase(petsRouter, userId, hooked).releasePet({ petId })).success).toBe(false);
    expect((await readOwner(database))?.petExperience).toBe(50);
    expect(await database.query.userPet.findMany()).toHaveLength(1);
  });

  it("cannot allocate the same XP twice under concurrent requests", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 10 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.assignExperience({ ...stats, petId }), caller.assignExperience({ ...stats, petId })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => result.success)).toMatchObject({ userPatch: { petExperience: 0 } });
    expect(results.find((result) => !result.success)?.userDelta).toBeUndefined();
    expect(results.find((result) => !result.success)?.userPatch).toBeUndefined();
    expect((await readOwner(database))?.petExperience).toBe(0);
    const pet = await readPet(database);
    expect(pet?.offence).toBe(20);
    expect(pet?.experience).toBe(10);
  });

  it("rolls back the XP debit when allocation loses its pet snapshot", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 50 }).where(eq(userData.userId, userId));
    const hooked = beforeStatements(database, userData, [async () => {
      await database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
    }]);
    expect((await callerForDatabase(petsRouter, userId, hooked).assignExperience({ ...stats, petId })).success).toBe(false);
    expect((await readOwner(database))?.petExperience).toBe(50);
    expect((await readPet(database))?.offence).toBe(10);
    expect((await readPet(database))?.experience).toBe(0);
  });

  it("returns the authoritative active bank after allocating newly earned experience", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    await database.update(userData).set({ petExperience: 100.5 }).where(eq(userData.userId, userId));
    const result = await callerForDatabase(petsRouter, userId, database).assignExperience({ ...stats, petId });
    expect(result).toMatchObject({ success: true, userPatch: { petExperience: 90.5 } });
    expect((await readOwner(database))?.petExperience).toBe(90.5);
    expect(await readPet(database)).toMatchObject({ offence: 20, experience: 10 });
  });

  it.each([true, false])("rejects a changed XP bank without spending it or returning a stale balance, active: %s", async (isActive) => {
    const database = await getTestDatabase();
    await readyPet(database);
    if (!isActive) await parkedPet(database, { storedExperience: 50 });
    await database.update(userData).set({ petExperience: 50 }).where(eq(userData.userId, userId));
    const selectedPetId = isActive ? petId : "parked";
    const hooked = beforeStatements(database, userData, [async () => {
      // Reward grants can increment the bank without advancing either snapshot revision.
      if (isActive) {
        await database.update(userData).set({ petExperience: sql`${userData.petExperience} + 5` }).where(eq(userData.userId, userId));
      } else {
        await database.update(userPet).set({ storedExperience: sql`${userPet.storedExperience} + 5` }).where(eq(userPet.id, selectedPetId));
      }
    }]);
    const rejected = await callerForDatabase(petsRouter, userId, hooked).assignExperience({ ...stats, petId: selectedPetId });
    expect(rejected.success).toBe(false);
    expect(rejected.userPatch).toBeUndefined();
    expect(rejected.userDelta).toBeUndefined();
    expect((await readOwner(database))?.petExperience).toBe(isActive ? 55 : 50);
    expect(await readPet(database, selectedPetId)).toMatchObject({ offence: 10, experience: 0, storedExperience: isActive ? 0 : 55 });

    const accepted = await callerForDatabase(petsRouter, userId, database).assignExperience({ ...stats, petId: selectedPetId });
    expect(accepted).toMatchObject({ success: true, userPatch: isActive ? { petExperience: 45 } : {} });
    expect((await readOwner(database))?.petExperience).toBe(isActive ? 45 : 50);
    expect(await readPet(database, selectedPetId)).toMatchObject({ offence: 20, experience: 10, storedExperience: isActive ? 0 : 45 });
  });

  it("uses allocated XP and owner rank for evolution and requires finished art before another", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { experience: 7500 });
    const caller = callerForDatabase(petsRouter, userId, database);
    await database.update(userData).set({ rank: "STUDENT", petExperience: 100000 }).where(eq(userData.userId, userId));
    expect((await caller.rankUp({ petId })).success).toBe(false);
    await database.update(userData).set({ rank: "GENIN" }).where(eq(userData.userId, userId));
    expect((await caller.rankUp({ petId })).success).toBe(true);
    expect((await readPet(database))?.rank).toBe(2);
    expect((await readPet(database))?.artRank).toBe(1);
    expect((await readPet(database))?.generationStatus).toBe("PENDING");
    expect((await caller.rankUp({ petId })).success).toBe(false);
  });

  it("starts a fresh rank allowance on evolution even after exhausting the previous rank", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 3, artRank: 3, experience: 60000, generationAttempts: PET_MAX_GENERATION_ATTEMPTS });
    await database.update(userData).set({ rank: "CHUNIN" }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.rankUp({ petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ rank: 4, artRank: 3, generationStatus: "PENDING", avatar, generationAttempts: 0 });
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS);
    vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ rank: 4, artRank: 4, generationAttempts: 1 });
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS - 1);
  });

  it.each([false, true])("rejects enabling combat while battles are disabled without changing the saved %s preference", async (battleEnabled) => {
    PET_BATTLE_CONFIG.enabled = false;
    const database = await getTestDatabase();
    await readyPet(database, { battleEnabled });
    const original = await readPet(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    expect(await caller.updatePet({ petId, battleEnabled: true, name: "Rejected" })).toMatchObject({
      success: false, message: "Companion battles are not available yet.",
    });
    expect(await readPet(database)).toEqual(original);
    expect((await caller.updatePet({ petId, battleEnabled: false, name: "Still configurable" })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ battleEnabled: false, name: "Still configurable" });
  });

  it("lets a companion join supported battles and opt out again", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { battleEnabled: false });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.updatePet({ petId, battleEnabled: true, name: "Quest companion" })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ battleEnabled: true, name: "Quest companion" });
    expect((await caller.updatePet({ petId, battleEnabled: false })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ battleEnabled: false, name: "Quest companion" });
  });

  it("preserves a downgraded owner's pet while preventing enable, training, AI edits and evolution", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 2, artRank: 2, battleEnabled: false });
    await database.update(userData).set({ rank: "STUDENT", petExperience: 100 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.updatePet({ petId, battleEnabled: true })).success).toBe(false);
    expect((await caller.assignExperience({ ...stats, petId })).success).toBe(false);
    expect((await caller.updateAiConfig({ petId, rules: [], includeDefaultRules: true })).success).toBe(false);
    expect((await caller.rankUp({ petId })).success).toBe(false);
    expect((await caller.updatePet({ petId, name: "StillMine", battleEnabled: false })).success).toBe(true);
    expect((await readPet(database))?.name).toBe("StillMine");
    expect((await caller.releasePet({ petId })).success).toBe(true);
  });

  it.each([1, 3])("regenerates accepted rank %s artwork with its saved traits without changing progression or charging adoption", async (rank) => {
    const database = await getTestDatabase();
    await readyPet(database, { rank, artRank: rank, experience: 100, generationAttempts: 1 });
    const caller = callerForDatabase(petsRouter, userId, database);
    const beforeOwner = await readOwner(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockImplementation(async (candidate) => {
      expect(candidate).toMatchObject({ rank, artRank: rank, avatar, paletteIndex: 0, characteristicIndex: 0, auraIndex: 0 });
      expect(await readPet(database)).toMatchObject({ avatar, paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, generationStatus: "GENERATING" });
      return { avatar: "https://example.com/redrawn.webp", avatarFacing: "left" };
    });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await readPet(database)).toMatchObject({ paletteIndex: 0, characteristicIndex: 0, auraIndex: 0,
      avatar: "https://example.com/redrawn.webp", generationStatus: "READY", generationAttempts: 2,
      rank, artRank: rank, experience: 100, speciesId: "pet-species-0" });
    expect(await readOwner(database)).toEqual(beforeOwner);
  });

  it.each([1, 3])("rejects cosmetic changes to an accepted rank %s companion before spending an attempt", async (rank) => {
    const database = await getTestDatabase();
    await readyPet(database, { rank, artRank: rank });
    const caller = callerForDatabase(petsRouter, userId, database);
    const before = await readPet(database);
    const data = await caller.getPet();
    const generate = vi.spyOn(appearance, "generatePetAppearance");
    expect((await caller.generateAppearance({ petId, appearance: { dayKey: data.dayKey,
      paletteIndex: data.options.palettes[1]!.index, characteristicIndex: data.options.characteristics[1]!.index, auraIndex: data.options.auras[1]!.index } })).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(await readPet(database)).toEqual(before);
  });

  it("keeps accepted artwork and traits usable after a failed regeneration", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    const caller = callerForDatabase(petsRouter, userId, database);
    vi.spyOn(sentry, "logError").mockImplementation(() => {});
    vi.spyOn(appearance, "generatePetAppearance").mockRejectedValue(new Error("Provider failed"));
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    expect(await readPet(database)).toMatchObject({ avatar, artRank: 1, paletteIndex: 0, characteristicIndex: 0, auraIndex: 0,
      generationStatus: "READY", generationToken: null, generationAttempts: 0 });
    expect(await caller.getPet()).toMatchObject({ canFeed: true, remainingGenerations: PET_MAX_GENERATION_ATTEMPTS });
  });

  it("refunds a failed evolution image so its free retry does not use an attempt", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 2, artRank: 1, generationStatus: "PENDING" });
    const caller = callerForDatabase(petsRouter, userId, database);
    vi.spyOn(sentry, "logError").mockImplementation(() => {});
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockRejectedValueOnce(new Error("Provider failed"));
    expect(await caller.generateAppearance({ petId })).toMatchObject({ success: false, message: expect.stringContaining("No image attempt was used") });
    expect(await readPet(database)).toMatchObject({ avatar, rank: 2, artRank: 1, generationStatus: "FAILED", generationAttempts: 0 });
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS);
    setSystemTime(secondsFromNow(PET_GENERATION_RETRY_MS / 1000 + 1));
    generate.mockResolvedValueOnce({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ rank: 2, artRank: 2, generationStatus: "READY", generationAttempts: 1 });
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS - 1);
  });

  it("keeps an evolving pet's previous look at its new rank once its free retry also fails", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 2, artRank: 1, generationStatus: "PENDING" });
    const caller = callerForDatabase(petsRouter, userId, database);
    vi.spyOn(sentry, "logError").mockImplementation(() => {});
    vi.spyOn(appearance, "generatePetAppearance").mockRejectedValue(new Error("The generated pet did not pass visual quality review"));
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    expect(await readPet(database)).toMatchObject({ avatar, rank: 2, artRank: 1, generationStatus: "FAILED", generationAttempts: 0 });
    setSystemTime(secondsFromNow(PET_GENERATION_RETRY_MS / 1000 + 1));
    const final = await caller.generateAppearance({ petId });
    expect(final).toMatchObject({ success: false, message: expect.stringContaining("kept its previous look") });
    expect(await readPet(database)).toMatchObject({ avatar, rank: 2, artRank: 2, generationStatus: "READY",
      generationToken: null, generationAttempts: 0 });
    expect(await caller.getPet()).toMatchObject({ canFeed: true, remainingGenerations: PET_MAX_GENERATION_ATTEMPTS });
  });

  it("never exhausts a founder's attempts through failed generations", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", artRank: 0, avatar: null });
    const caller = callerForDatabase(petsRouter, userId, database);
    vi.spyOn(sentry, "logError").mockImplementation(() => {});
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockRejectedValue(new Error("Provider failed"));
    for (let attempt = 1; attempt <= PET_MAX_GENERATION_ATTEMPTS + 1; attempt++) {
      expect((await caller.generateAppearance({ petId })).success).toBe(false);
      expect(await readPet(database)).toMatchObject({ generationStatus: "FAILED", generationAttempts: 0 });
      setSystemTime(secondsFromNow(PET_GENERATION_RETRY_MS / 1000 + 1));
    }
    expect(generate).toHaveBeenCalledTimes(PET_MAX_GENERATION_ATTEMPTS + 1);
    generate.mockResolvedValueOnce({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ artRank: 1, generationStatus: "READY", generationAttempts: 1 });
  });

  it("keeps accepted art usable after the final redraw lease expires without requiring another attempt", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "GENERATING", generationToken: "abandoned-redraw",
      generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1), generationAttempts: PET_MAX_GENERATION_ATTEMPTS });
    const caller = callerForDatabase(petsRouter, userId, database);
    // The abandoned claim produced no image, so its attempt is not charged.
    expect(await caller.getPet()).toMatchObject({ canFeed: true, remainingGenerations: 1 });
    const before = await readPet(database);
    await database.update(userData).set({ petExperience: 100 }).where(eq(userData.userId, userId));
    expect((await caller.assignExperience({ ...stats, petId })).success).toBe(true);
    expect(await readPet(database)).toMatchObject({ avatar, artRank: 1, offence: before!.offence + stats.offence });
  });

  it("allows exactly three images at one rank, including the first image", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", artRank: 0, avatar: null });
    const caller = callerForDatabase(petsRouter, userId, database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockImplementation(async () => ({ avatar, avatarFacing: "left" }));
    for (let attempt = 1; attempt <= PET_MAX_GENERATION_ATTEMPTS; attempt++) {
      expect((await caller.generateAppearance({ petId })).success).toBe(true);
      expect((await readPet(database))?.generationAttempts).toBe(attempt);
      expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS - attempt);
      setSystemTime(secondsFromNow(PET_GENERATION_RETRY_MS / 1000 + 1));
    }
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(PET_MAX_GENERATION_ATTEMPTS);
  });

  it.each([true, false])("keeps exhausted rank attempts across midnight with accepted artwork: %s", async (hasArtwork) => {
    setSystemTime(new Date("2030-01-01T23:59:59Z"));
    const database = await getTestDatabase();
    await readyPet(database, { generationAttempts: PET_MAX_GENERATION_ATTEMPTS,
      ...(hasArtwork ? {} : { generationStatus: "FAILED", artRank: 0, avatar: null }) });
    const caller = callerForDatabase(petsRouter, userId, database);
    const generate = vi.spyOn(appearance, "generatePetAppearance");
    const before = await readPet(database);
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    setSystemTime(new Date("2030-01-02T00:00:01Z"));
    expect((await caller.getPet()).remainingGenerations).toBe(0);
    expect(await caller.generateAppearance({ petId })).toEqual({ success: false,
      message: `You have used all ${PET_MAX_GENERATION_ATTEMPTS} image attempts for this rank. Your companion is still yours.` });
    expect(generate).not.toHaveBeenCalled();
    expect(await readPet(database)).toEqual(before);
  });

  it("lets only one simultaneous redraw of accepted artwork spend an attempt", async () => {
    const database = await getTestDatabase();
    await readyPet(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.generateAppearance({ petId }), caller.generateAppearance({ petId })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await readPet(database))?.generationAttempts).toBe(1);
  });

  it("customizes a rewarded species outside daily offers without changing species or charging adoption", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", avatar: null, artRank: 0 });
    await database.update(petSpecies).set({ isActive: false }).where(eq(petSpecies.id, "pet-species-0"));
    await database.update(userData).set({ sector: 1 }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(petsRouter, userId, database);
    const data = await caller.getPet();
    const selected = { dayKey: data.dayKey, paletteIndex: data.options.palettes[1]!.index,
      characteristicIndex: data.options.characteristics[1]!.index, auraIndex: data.options.auras[1]!.index };
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId, appearance: selected })).success).toBe(true);
    const { dayKey: _, ...traits } = selected;
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ ...traits, speciesId: "pet-species-0" }), "GPT", expect.any(Function));
    expect(await readPet(database)).toMatchObject({ ...traits, speciesId: "pet-species-0", avatar, avatarFacing: "left", generationAttempts: 1 });
    expect(await readOwner(database)).toMatchObject({ reputationPoints: 200, petAcquisitions: 0 });
  });

  it.each(["dayKey", "paletteIndex", "characteristicIndex", "auraIndex"] as const)("rejects unavailable founder %s before changing traits or spending an attempt", async (field) => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", avatar: null, artRank: 0 });
    const caller = callerForDatabase(petsRouter, userId, database);
    const data = await caller.getPet(); const before = await readPet(database);
    const appearanceInput = { dayKey: data.dayKey, paletteIndex: 0, characteristicIndex: 0, auraIndex: 0 };
    if (field === "dayKey") appearanceInput.dayKey = "2000-01-01";
    else {
      const all = field === "paletteIndex" ? PET_PALETTES : field === "characteristicIndex" ? PET_CHARACTERISTICS : PET_AURAS;
      const offered = field === "paletteIndex" ? data.options.palettes : field === "characteristicIndex" ? data.options.characteristics : data.options.auras;
      appearanceInput[field] = all.find((option) => option.index !== 0 && !offered.some((entry) => entry.index === option.index))!.index;
    }
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId, appearance: appearanceInput })).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(await readPet(database)).toEqual(before);
  });

  it("allows keeping a founder's saved cosmetics after daily offerings change", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "FAILED", avatar: null, artRank: 0 });
    const caller = callerForDatabase(petsRouter, userId, database);
    const data = await caller.getPet();
    const paletteIndex = PET_PALETTES.find((entry) => !data.options.palettes.some((option) => option.index === entry.index))!.index;
    await database.update(userPet).set({ paletteIndex }).where(eq(userPet.id, petId));
    vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId, appearance: { dayKey: data.dayKey, paletteIndex, characteristicIndex: 0, auraIndex: 0 } })).success).toBe(true);
    expect((await readPet(database))?.paletteIndex).toBe(paletteIndex);
  });

  it("does not restyle an accepted identity while generating its evolution", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 2, artRank: 1, generationStatus: "PENDING" });
    const caller = callerForDatabase(petsRouter, userId, database); const before = await readPet(database);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId, appearance: { dayKey: getPetDayKey(), paletteIndex: 0, characteristicIndex: 0, auraIndex: 0 } })).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(await readPet(database)).toEqual(before);
  });

  it("does not save stale supporter choices if the owner's tier changes before the lease claim", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", avatar: null, artRank: 0 });
    await database.update(userData).set({ federalStatus: "GOLD" }).where(eq(userData.userId, userId));
    const data = await callerForDatabase(petsRouter, userId, database).getPet(); const before = await readPet(database);
    const hooked = beforeStatements(database, userPet, [() => database.update(userData).set({ federalStatus: "NONE" }).where(eq(userData.userId, userId))]);
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    expect((await callerForDatabase(petsRouter, userId, hooked).generateAppearance({ petId, appearance: {
      dayKey: data.dayKey, paletteIndex: data.options.palettes.at(-1)!.index,
      characteristicIndex: data.options.characteristics.at(-1)!.index, auraIndex: data.options.auras.at(-1)!.index,
    } })).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(await readPet(database)).toEqual(before);
  });

  it("keeps an adopted pet on provider failure and retries without charging again", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.acquirePet(await adoptionInput(database))).success).toBe(true);
    const petId = (await readPet(database))!.id;
    const error = new Error("Provider unavailable");
    const report = vi.spyOn(sentry, "logError").mockImplementation(() => {});
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockRejectedValueOnce(error);
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    expect(report).toHaveBeenCalledWith(error, "Companion appearance generation failed", { petId, rank: 1 });
    expect((await readPet(database))?.generationStatus).toBe("FAILED");
    expect((await readOwner(database))?.petAcquisitions).toBe(1);
    expect((await readOwner(database))?.reputationPoints).toBe(200);
    await database.update(userPet).set({ generationStartedAt: new Date(Date.now() - PET_GENERATION_RETRY_MS - 1000) }).where(eq(userPet.userId, userId));
    generate.mockImplementation(async (_pet, _provider, onUpload) => { await onUpload(avatar); return { avatar, avatarFacing: "left" }; });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect((await readPet(database))?.generationStatus).toBe("READY");
    expect((await readPet(database))?.generationAttempts).toBe(1);
    expect((await readOwner(database))?.reputationPoints).toBe(200);
    expect((await database.query.userUpload.findFirst())?.imageUrl).toBe(avatar);
    expect((await caller.generateAppearance({ petId })).success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("generates with the provider stored in the art provider game setting", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", avatar: null, artRank: 0 });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    await database.insert(gameSetting).values({ id: "pet-art-provider", name: PET_ART_PROVIDER_SETTING, time: new Date(), value: PetArtProviders.indexOf("NANO_BANANA") });
    expect((await callerForDatabase(petsRouter, userId, database).generateAppearance({ petId })).success).toBe(true);
    expect(generate).toHaveBeenCalledWith(expect.any(Object), "NANO_BANANA", expect.any(Function));
  });

  it("lets only one generation claim reach the provider", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", avatar: null, artRank: 0 });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.generateAppearance({ petId }), caller.generateAppearance({ petId })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await readPet(database))?.generationAttempts).toBe(1);
  });

  it("recovers a stale lease without accepting the old token's completion", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "GENERATING", artRank: 0, avatar: null, generationToken: "abandoned-token", generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1000), generationAttempts: 1 });
    vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect((await readPet(database))?.generationToken).toBeNull();
    // The abandoned claim's attempt is replaced, not added to: one accepted image, one attempt.
    expect((await readPet(database))?.generationAttempts).toBe(1);
    expect((await caller.getPet()).pet).not.toHaveProperty("generationToken");
  });

  it("does not charge a timed-out claim: its retry replaces the attempt and a failed retry refunds it", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { rank: 2, artRank: 1, generationStatus: "GENERATING", generationToken: "timed-out",
      generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1000), generationAttempts: 1 });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS);
    vi.spyOn(sentry, "logError").mockImplementation(() => {});
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockRejectedValueOnce(new Error("The generated pet did not pass visual quality review"));
    // A failed retry after an abandoned evolution claim keeps the previous look, like a second failure.
    expect(await caller.generateAppearance({ petId })).toMatchObject({ success: false, message: expect.stringContaining("No image attempt was used") });
    expect(await readPet(database)).toMatchObject({ avatar, rank: 2, artRank: 2, generationStatus: "READY", generationToken: null, generationAttempts: 0 });
    expect((await caller.getPet()).remainingGenerations).toBe(PET_MAX_GENERATION_ATTEMPTS);
    setSystemTime(secondsFromNow(PET_GENERATION_RETRY_MS / 1000 + 1));
    generate.mockResolvedValueOnce({ avatar, avatarFacing: "left" });
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect((await readPet(database))?.generationAttempts).toBe(1);
  });

  it("lets a player with every attempt held by abandoned or failed claims still generate", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "GENERATING", artRank: 0, avatar: null, generationToken: "timed-out",
      generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1000), generationAttempts: PET_MAX_GENERATION_ATTEMPTS });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.getPet()).remainingGenerations).toBe(1);
    expect((await caller.generateAppearance({ petId })).success).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await readPet(database)).toMatchObject({ artRank: 1, generationStatus: "READY", generationAttempts: PET_MAX_GENERATION_ATTEMPTS });
  });

  it("lets only one of two simultaneous retries of an abandoned claim spend its replaced attempt", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "GENERATING", artRank: 0, avatar: null, generationToken: "timed-out",
      generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1000), generationAttempts: 1 });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const caller = callerForDatabase(petsRouter, userId, holdOwnerSnapshots(database, 2));
    const results = await Promise.all([caller.generateAppearance({ petId }), caller.generateAppearance({ petId })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await readPet(database))?.generationAttempts).toBe(1);
  });

  it("does not let an old generation overwrite a replacement identity or new lease", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", artRank: 0, avatar: null });
    vi.spyOn(appearance, "generatePetAppearance").mockImplementation(async () => {
      await database.update(userPet).set({ generationToken: "newer-token", avatar: "/newer.webp", avatarFacing: "right", revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
      return { avatar, avatarFacing: "left" };
    });
    const result = await callerForDatabase(petsRouter, userId, database).generateAppearance({ petId });
    expect(result.success).toBe(false);
    expect((await readPet(database))?.avatar).toBe("/newer.webp");
    expect((await readPet(database))?.avatarFacing).toBe("right");
    expect((await readPet(database))?.generationToken).toBe("newer-token");
  });

  it("does not let an old provider failure stamp a newer generation failed", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", artRank: 0, avatar: null });
    vi.spyOn(appearance, "generatePetAppearance").mockImplementation(async () => {
      await database.update(userPet).set({ generationToken: "newer-token", revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId));
      throw new Error("Old provider failed after lease replacement");
    });
    expect((await callerForDatabase(petsRouter, userId, database).generateAppearance({ petId })).success).toBe(false);
    expect((await readPet(database))?.generationStatus).toBe("GENERATING");
    expect((await readPet(database))?.generationToken).toBe("newer-token");
  });

  it("blocks release during an active lease but permits abandoned generation recovery", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "GENERATING", generationToken: "current", generationStartedAt: new Date() });
    const caller = callerForDatabase(petsRouter, userId, database);
    expect((await caller.releasePet({ petId })).success).toBe(false);
    await database.update(userPet).set({ generationStartedAt: new Date(Date.now() - PET_GENERATION_LEASE_MS - 1000) }).where(eq(userPet.id, petId));
    expect((await caller.releasePet({ petId })).success).toBe(true);
    expect(await database.query.userPet.findMany()).toHaveLength(0);
  });

  it("rejects generation if its pet snapshot changes before the provider claim", async () => {
    const database = await getTestDatabase();
    await readyPet(database, { generationStatus: "PENDING", artRank: 0, avatar: null });
    const generate = vi.spyOn(appearance, "generatePetAppearance").mockResolvedValue({ avatar, avatarFacing: "left" });
    const hooked = beforeStatements(database, userPet, [() => database.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, petId))]);
    expect((await callerForDatabase(petsRouter, userId, hooked).generateAppearance({ petId })).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});

const adoptionInput = async (database: DrizzleClient) => {
  const data = await callerForDatabase(petsRouter, userId, database).getPet();
  return { name: "Kumo", gender: "MALE" as const, dayKey: data.dayKey, speciesId: data.options.species[0]!.id, paletteIndex: data.options.palettes[0]!.index, characteristicIndex: data.options.characteristics[0]!.index, auraIndex: data.options.auras[0]!.index };
};

const readyPet = async (database: DrizzleClient, overrides: Partial<typeof userPet.$inferInsert> = {}) => {
  await database.update(userData).set({ activePetId: overrides.id ?? petId }).where(eq(userData.userId, userId));
  await database.insert(userPet).values({ id: petId, userId, name: "Kumo", speciesId: "pet-species-0", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, avatar, artRank: 1, generationStatus: "READY", ...overrides });
};
const parkedPet = (database: DrizzleClient, overrides: Partial<typeof userPet.$inferInsert> = {}) =>
  database.insert(userPet).values({ id: "parked", userId, name: "Haru", speciesId: "pet-species-0", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, avatar, artRank: 1, generationStatus: "READY", ...overrides });

const mealStack = async (rarity: ItemRarity = "COMMON") => {
  await insertItems([{ id: "pet-meal", name: "Companion Meal", itemType: "MEAL", rarity }]);
  await insertUserItems([{ id: "meal-stack", itemId: "pet-meal", userId, quantity: 2 }]);
};
const readOwner = (database: DrizzleClient) => database.query.userData.findFirst({ where: eq(userData.userId, userId) });
const readPet = (database: DrizzleClient, id?: string) => database.query.userPet.findFirst({ where: and(eq(userPet.userId, userId), id ? eq(userPet.id, id) : undefined) });

/** Hold owner snapshots so competing requests share the same version before their SQL writes race. */
const holdOwnerSnapshots = (database: DrizzleClient, count: number): DrizzleClient => {
  let pending = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const ownerQueries = new Proxy(database.query.userData, {
    get(target, property, receiver) {
      if (property !== "findFirst") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof target.findFirst>) => {
        const result = await target.findFirst(...args);
        pending += 1;
        if (pending >= count) release();
        await barrier;
        return result;
      };
    },
  });
  return new Proxy(database, { get(target, property, receiver) { return property === "query" ? { ...target.query, userData: ownerQueries } : Reflect.get(target, property, receiver); } });
};

/** Inject a state change after preloading but before adoption or active release starts its paired writes. */
const beforeTransaction = (database: DrizzleClient, hook: () => Promise<void>): DrizzleClient => {
  let pending = true;
  return new Proxy(database, { get(target, property, receiver) {
    if (property !== "transaction") return Reflect.get(target, property, receiver);
    return async (...args: Parameters<typeof target.transaction>) => {
      if (pending) { pending = false; await hook(); }
      return target.transaction(...args);
    };
  } });
};
