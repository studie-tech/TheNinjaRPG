import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { CombatStatNames } from "@/drizzle/constants";
import { actionLog, gameSetting, petSpecies, userData, userPet, userQueue } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { petsRouter } from "@/server/api/routers/pets";
import { insertPetSpecies, insertUsers } from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import { beforeStatements, failStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const ownerId = "potential-owner";
const sourceId = "potential-source";
const targetId = "potential-target";
const zero = { offence: 0, defence: 0, strength: 0, speed: 0, intelligence: 0, willpower: 0 };

describeWithDatabase("companion potential and transfers", () => {
  beforeEach(async () => {
    await resetTables(gameSetting, userQueue, actionLog, userPet, petSpecies, userData);
    await insertPetSpecies([{ id: "species", name: "Wolf", potentialMode: "RANDOM" }, { id: "other-species", name: "Fox" }]);
    await insertUsers([{ userId: ownerId, username: "PotentialOwner", rank: "JONIN", status: "AWAKE", activePetId: sourceId, money: 3_000_000, petExperience: 500 }]);
    const db = await getTestDatabase();
    await db.insert(userPet).values([
      { id: sourceId, userId: ownerId, name: "Source", speciesId: "species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, experience: 1000, offence: 610, defence: 110, strength: 310, potentialValue: 3, potentialRevealed: false, generationStatus: "READY", avatar: "https://example.com/pet.webp", artRank: 1 },
      { id: targetId, userId: ownerId, name: "Target", speciesId: "species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, storedExperience: 100 },
    ]);
  });
  it.each([
    { status: "ASLEEP", autoWakeUp: true, succeeds: true },
    { status: "ASLEEP", autoWakeUp: false, succeeds: false },
    { status: "HOSPITALIZED", autoWakeUp: false, succeeds: true },
    { status: "TRAVEL", autoWakeUp: true, succeeds: false },
    { status: "QUEUED", autoWakeUp: true, succeeds: false },
  ] as const)("recovers reveal only when allowed: $status / autoWakeUp $autoWakeUp", async ({ status, autoWakeUp, succeeds }) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status, autoWakeUp, curHealth: 100, maxHealth: 100 }).where(eq(userData.userId, ownerId));
    const result = await callerForDatabase(petsRouter, ownerId, db).revealPotential({ petId: sourceId });
    expect(result.success).toBe(succeeds);
    const owner = await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) });
    expect(owner?.status).toBe(succeeds ? "AWAKE" : status);
    const pet = await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) });
    expect(pet?.potentialRevealed).toBe(succeeds);
  });
  it.each([false, true])("recovers and transfers into the correct bank atomically (destination active: %s)", async (active) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "ASLEEP", autoWakeUp: true, activePetId: active ? targetId : sourceId }).where(eq(userData.userId, ownerId));
    const result = await callerForDatabase(petsRouter, ownerId, db).transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 700 });
    expect(result.success).toBe(true);
    expect(result.actionNotice).toBeTruthy();
    const owner = await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) });
    expect(owner).toMatchObject({ status: "AWAKE", money: 2_000_000, petExperience: active ? 1200 : 500 });
    expect(result.userPatch?.updatedAt).toEqual(owner?.updatedAt);
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, targetId) })).toMatchObject({ storedExperience: active ? 100 : 800 });
  });
  it.each([false, true])("preserves queued training XP while recovering a transfer (destination active: %s)", async (active) => {
    const db = await getTestDatabase();
    await db.update(userPet).set({ generationStatus: "READY", avatar: "https://example.com/pet.webp", artRank: 1 }).where(eq(userPet.id, targetId));
    await db.update(userData).set({ status: "ASLEEP", autoWakeUp: true, isOutlaw: true, curEnergy: 50,
      regeneration: 0, regenAt: new Date(), experience: 1000, petExperience: 500,
      activePetId: active ? targetId : sourceId }).where(eq(userData.userId, ownerId));
    await db.insert(gameSetting).values({ id: "queue-gain", name: "trainingGainMultiplier", value: 2, time: new Date(Date.now() + 60_000) });
    await queueEnergy(ownerId, [{ stat: "offence", energy: 40 }]);
    const result = await callerForDatabase(petsRouter, ownerId, db).transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 700 });
    expect(result.success).toBe(true);
    const owner = (await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) }))!;
    const gained = owner.experience - 1000;
    expect(gained).toBeGreaterThan(0);
    expect(owner).toMatchObject({ status: "AWAKE", curEnergy: 10, energyQueueHead: 1, money: 2_000_000 });
    expect(owner.petExperience).toBe(500 + gained + (active ? 700 : 0));
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, targetId) })).toMatchObject({ storedExperience: active ? 100 : 800 });
  });
  it("does not wake or charge a sleeping owner when a transfer fails its domain guards", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "ASLEEP", autoWakeUp: true }).where(eq(userData.userId, ownerId));
    const result = await callerForDatabase(petsRouter, ownerId, db).transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 701 });
    expect(result.success).toBe(false);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, ownerId) })).toMatchObject({ status: "ASLEEP", money: 3_000_000 });
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
  it("supports baseline training while hidden and activates only bounded rank caps on reveal", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    expect((await caller.assignExperience({ petId: sourceId, ...zero, speed: 20 })).success).toBe(true);
    await db.update(userPet).set({ offence: 20_000 }).where(eq(userPet.id, sourceId));
    expect((await caller.assignExperience({ petId: sourceId, ...zero, offence: 1 })).success).toBe(false);
    await caller.revealPotential({ petId: sourceId });
    expect((await caller.assignExperience({ petId: sourceId, ...zero, offence: 1 })).success).toBe(true);
    await db.update(userPet).set({ offence: 20_500 }).where(eq(userPet.id, sourceId));
    expect((await caller.assignExperience({ petId: sourceId, ...zero, offence: 1 })).success).toBe(false);
    // A support downgrade must not prevent training other stats with zero gains on the over-cap stat.
    await db.update(userPet).set({ potentialValue: 1 }).where(eq(userPet.id, sourceId));
    expect((await caller.assignExperience({ petId: sourceId, ...zero, speed: 1 })).success).toBe(true);
  });
  it("reveals a saved roll exactly once under concurrent requests", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    const results = await Promise.all(Array.from({ length: 4 }, () => caller.revealPotential({ petId: sourceId })));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) })).toMatchObject({ potentialValue: 3, potentialRevealed: true, revision: 1 });
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
  it("settles only one simultaneous transfer and returns the committed owner timestamp", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(petsRouter, ownerId, db);
    const results = await Promise.all(Array.from({ length: 4 }, () => caller.transferExperience({ petId: sourceId, destinationPetId: targetId, amount: 700 })));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const [owner, source, destination] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, ownerId) }),
      db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }),
      db.query.userPet.findFirst({ where: eq(userPet.id, targetId) }),
    ]);
    expect(owner?.money).toBe(2_000_000);
    expect(source?.experience).toBe(300);
    expect(destination?.storedExperience).toBe(800);
    expect(results.find((result) => result.success)?.userPatch?.updatedAt).toEqual(owner?.updatedAt);
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
    expect(await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) })).toMatchObject({ potentialValue: 3, potentialRevealed: false, revision: 0 });
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
    expect((await db.query.userPet.findFirst({ where: eq(userPet.id, sourceId) }))).toMatchObject({ potentialValue: 5, potentialRevealed: true, });
    const logs = await db.query.actionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.relatedMsg?.length).toBeLessThanOrEqual(191);
    expect(logs[0]?.changes).toContain(`Reason: ${input.reason.trim()}`);
  });
});
