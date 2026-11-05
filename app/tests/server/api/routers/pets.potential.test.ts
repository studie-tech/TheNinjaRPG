import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { CombatStatNames } from "@/drizzle/constants";
import { actionLog, petSpecies, userData, userPet } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { petsRouter } from "@/server/api/routers/pets";
import { insertPetSpecies, insertUsers } from "../../../setup/factories";
import { beforeStatements, failStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const ownerId = "potential-owner";
const sourceId = "potential-source";
const targetId = "potential-target";
const zero = { offence: 0, defence: 0, strength: 0, speed: 0, intelligence: 0, willpower: 0 };

describeWithDatabase("companion potential and transfers", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userPet, petSpecies, userData);
    await insertPetSpecies([{ id: "species", name: "Wolf", potentialMode: "RANDOM" }, { id: "other-species", name: "Fox" }]);
    await insertUsers([{ userId: ownerId, username: "PotentialOwner", rank: "JONIN", status: "AWAKE", activePetId: sourceId, money: 3_000_000, petExperience: 500 }]);
    const db = await getTestDatabase();
    await db.insert(userPet).values([
      { id: sourceId, userId: ownerId, name: "Source", speciesId: "species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, experience: 1000, offence: 610, defence: 110, strength: 310, potentialValue: 3, potentialRevealed: false, generationStatus: "READY", avatar: "https://example.com/pet.webp", artRank: 1 },
      { id: targetId, userId: ownerId, name: "Target", speciesId: "species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, storedExperience: 100 },
    ]);
  });
  it("hides a saved roll until reveal and never rerolls after species edits", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    expect((await caller.getCollection()).pets.find((pet) => pet.id === sourceId)?.potentialValue).toBeNull();
    expect((await caller.getPet({ petId: sourceId })).pet?.potentialValue).toBeNull();
    await db.update(petSpecies).set({ potentialValue: 5, potentialMode: "FIXED" }).where(eq(petSpecies.id, "species"));
    expect((await caller.revealPotential({ petId: sourceId })).success).toBe(true);
    expect((await caller.revealPotential({ petId: sourceId })).success).toBe(false);
    expect((await caller.getPet({ petId: sourceId })).pet?.potentialValue).toBe(3);
  });
  it("supports unrevealed training and enforces caps and remaining points atomically", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    expect((await caller.assignExperience({ petId: sourceId, ...zero, speed: 20 })).success).toBe(true);
    expect((await caller.allocatePotential({ petId: sourceId, stat: "offence" })).success).toBe(false);
    await caller.revealPotential({ petId: sourceId });
    const results = await Promise.all(Array.from({ length: 6 }, () => caller.allocatePotential({ petId: sourceId, stat: "offence" })));
    expect(results.filter((result) => result.success).length).toBeGreaterThan(0);
    const pet = await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) });
    expect(pet?.potentialAllocations.offence).toBeLessThanOrEqual(3);
    await db.update(userPet).set({ offence: 150_000, potentialAllocations: {} }).where(eq(userPet.id, sourceId));
    expect((await caller.assignExperience({ petId: sourceId, ...zero, offence: 1 })).success).toBe(false);
  });
  it.each([false, true])("moves 70%% assigned XP without losing or duplicating banks (destination active: %s)", async (active) => {
    const db = await getTestDatabase();
    if (active) await db.update(userData).set({ activePetId: targetId }).where(eq(userData.userId, ownerId));
    const caller = callerForDatabase(petsRouter, ownerId, db);
    expect((await caller.transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 700 })).success).toBe(true);
    const [owner, source, target] = await Promise.all([db.query.userData.findFirst({ where: eq(userData.userId, ownerId) }), db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }), db.query.userPet.findFirst({ where: eq(userPet.id, targetId) })]);
    expect(owner?.money).toBe(2_000_000); expect(owner?.petExperience).toBe(active ? 1200 : 500);
    expect(source).toMatchObject({ experience: 300, offence: 190, defence: 40, strength: 100, rank: 1 });
    expect(target?.storedExperience).toBe(active ? 100 : 800);
  });
  it.each([
    { active: true, bank: 1000 }, { active: false, bank: 1000 },
    { active: true, bank: 1 }, { active: false, bank: 1 },
  ])("spends the exact XP bank after a proportional transfer (active: $active, bank: $bank)", async ({ active, bank }) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ activePetId: active ? sourceId : targetId, petExperience: active ? bank : 500 }).where(eq(userData.userId, ownerId));
    await db.update(userPet).set({ experience: 6622, strength: 5932, storedExperience: active ? 0 : bank }).where(eq(userPet.id, sourceId));
    const caller = callerForDatabase(petsRouter, ownerId, db);
    expect((await caller.transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 4635 })).success).toBe(true);
    const source = (await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))!;
    expect(Number.isInteger(source.offence)).toBe(false);
    const gains = bank === 1000
      ? { ...zero, offence: 250, defence: 250, strength: 250, speed: 250 }
      : { ...zero, offence: 1 };
    const result = await caller.assignExperience({ petId: sourceId, ...gains });
    expect(result).toMatchObject({ success: true, message: `${bank.toLocaleString("en-US")} companion experience assigned.` });
    expect(result.petUpdate).toBeUndefined();
    expect(result.userPatch).toEqual(active ? undefined : {});
    const saved = (await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))!;
    for (const stat of CombatStatNames) expect(saved[stat]).toBeCloseTo(source[stat] + gains[stat], 8);
    expect(saved.experience).toBe(6622 - 4635 + bank);
    expect(saved.storedExperience).toBe(0);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) }))?.petExperience).toBe(active ? 0 : 500 + 4635);
    expect(await caller.assignExperience({ petId: sourceId, ...zero, offence: 1 })).toMatchObject({ success: false, message: "Not enough unused companion experience." });
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) })).toEqual(saved);
  });
  it("does not charge or move XP when the destination changes after the read", async () => {
    const db = await getTestDatabase();
    const hooked = beforeStatements(db, userData, [async () => { await db.update(userPet).set({ revision: sql`${userPet.revision} + 1` }).where(eq(userPet.id, targetId)); }]);
    const result = await callerForDatabase(petsRouter, ownerId, hooked).transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 700 });
    expect(result.success).toBe(false);
    expect((await db.query.userData.findFirst())?.money).toBe(3_000_000);
    expect((await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))?.experience).toBe(1000);
    expect((await db.query.userPet.findFirst({ where: eq(userPet.id, targetId) }))?.storedExperience).toBe(100);
  });
  it("rejects excess transfers, other species, other owners and insufficient funds", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    const input = { petId: sourceId, destinationPetId: targetId, amount: 700 };
    expect((await caller.transferExperience({ ...input, amount: 701 })).success).toBe(false);
    await db.update(userPet).set({ speciesId: "other-species" }).where(eq(userPet.id, targetId));
    expect((await caller.transferExperience(input)).success).toBe(false);
    await db.update(userPet).set({ speciesId: "species", userId: "other-owner" }).where(eq(userPet.id, targetId));
    expect((await caller.transferExperience(input)).success).toBe(false);
    await db.update(userPet).set({ userId: ownerId }).where(eq(userPet.id, targetId));
    await db.update(userData).set({ money: 999_999 }).where(eq(userData.userId, ownerId));
    expect((await caller.transferExperience(input)).success).toBe(false);
    expect((await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))?.experience).toBe(1000);
  });
  it("rolls back the override and account revision if its audit insert fails", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "HEAD_CONTENT" }).where(eq(userData.userId, ownerId));
    const before = await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) });
    const hooked = new Proxy(db, { get(target, property, receiver) {
      if (property === "transaction") return (callback: (client: DrizzleClient) => Promise<unknown>) =>
        target.transaction((tx) => callback(failStatements(tx as unknown as DrizzleClient, actionLog)));
      return Reflect.get(target, property, receiver);
    } });
    await expect(callerForDatabase(petsRouter, ownerId, hooked).setPotentialForStaff({ userId: ownerId, petId: sourceId, value: 5, reason: "Approved companion support adjustment" })).rejects.toThrow("Statement failed on purpose");
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) })).toMatchObject({ potentialValue: 3, potentialRevealed: false, potentialAllocations: {}, revision: 0 });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) }))?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });
  it("restricts and audits staff overrides", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    const input = { userId: ownerId, petId: sourceId, value: 5, reason: "Approved companion support adjustment. ".repeat(10) };
    expect((await caller.setPotentialForStaff(input)).success).toBe(false);
    expect(await caller.getPotentialsForStaff({ userId: ownerId })).toEqual([]);
    await db.update(userData).set({ role: "HEAD_CONTENT" }).where(eq(userData.userId, ownerId));
    expect((await caller.setPotentialForStaff(input)).success).toBe(true);
    expect((await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))).toMatchObject({ potentialValue: 5, potentialRevealed: true, potentialAllocations: {} });
    const logs = await db.query.actionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.relatedMsg?.length).toBeLessThanOrEqual(191);
    expect(logs[0]?.changes).toContain(`Reason: ${input.reason.trim()}`);
  });
});
