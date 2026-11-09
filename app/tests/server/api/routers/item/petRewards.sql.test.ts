import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  item,
  jutsu,
  petSpecies,
  questHistory,
  userData,
  userItem,
  userPet,
} from "@/drizzle/schema";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { itemRouter } from "@/server/api/routers/item";
import type { DrizzleClient } from "@/server/db";
import { AiRule } from "@/validators/ai";
import { ItemValidator, NonCombatConsumeRewardTag } from "@/validators/combat";
import { petJutsuFixture } from "../../../../libs/pets/helpers/abilities";
import {
  insertItems,
  insertUserItems,
  insertUserPets,
  insertUsers,
} from "../../../../setup/factories";
import {
  beforeStatements,
  failStatements,
  inTransactions,
} from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "pet-item-owner";
const input = { userItemId: "pet-gift-stack", requestId: "pet-gift-request" };
const rewardEffect = () =>
  NonCombatConsumeRewardTag.parse({ reward_pets: ["gift-species"], reward_money: 7 });

/** Force a catalog/account change after preload, immediately before the joined claim. */
const beforeClaim = (client: DrizzleClient, hook: () => Promise<unknown>) =>
  inTransactions(client, (tx) => beforeStatements(tx, userData, [hook]));

/** Fail the new collection row after the account and item debit, inside their transaction. */
const failPetInsert = (client: DrizzleClient) =>
  inTransactions(client, (tx) =>
    failStatements(tx, userPet, 1, { operations: ["insert"] }),
  );

const insertExistingPet = async (id = "existing-pet") => {
  await insertUserPets([
    {
      id,
      userId: USER,
      speciesId: "gift-species",
      name: "Existing",
      storedExperience: 99,
    },
  ]);
};

describeWithDatabase("consumable companion rewards", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      userPet,
      petSpecies,
      userItem,
      item,
      jutsu,
      questHistory,
      userData,
    );
    await insertUsers([
      {
        userId: USER,
        username: USER,
        rank: "GENIN",
        level: 20,
        status: "AWAKE",
        isOutlaw: true,
        regeneration: 0,
        money: 100,
        petSlots: 1,
      },
    ]);
    await getTestDatabase().then(async (db) => {
      await db.insert(jutsu).values(petJutsuFixture());
      await db.insert(petSpecies).values({
        id: "gift-species",
        name: "Gift Fox",
        description: "A small fox",
        defaultJutsuIds: ["pet-strike"],
        aiRules: [AiRule.parse({ conditions: [], action: { type: "end_turn" } })],
        includeDefaultRules: false,
      });
    });
    await insertItems([
      {
        id: "pet-gift",
        name: "Companion Contract",
        itemType: "CONSUMABLE",
        destroyOnUse: true,
        preventBattleUsage: true,
        effects: [rewardEffect()],
      },
    ]);
    await insertUserItems([
      { id: input.userItemId, userId: USER, itemId: "pet-gift", quantity: 2 },
    ]);
  });

  it("commits a pending individual with species defaults and replays its exact ID", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(itemRouter, USER, db);
    const response = await caller.consume(input);
    expect(response.success, response.message).toBe(true);
    if (!response.success || !("petRewards" in response))
      throw new Error(response.message);
    const pet = (await db.query.userPet.findFirst())!;
    expect(response.petRewards).toEqual([
      { id: pet.id, speciesId: "gift-species", name: pet.name },
    ]);
    expect(pet).toMatchObject({
      userId: USER,
      rank: 1,
      experience: 0,
      storedExperience: 0,
      avatar: null,
      artRank: 0,
      generationStatus: "PENDING",
      generationAttempts: 0,
      jutsuIds: ["pet-strike"],
      includeDefaultRules: false,
    });
    expect(pet.aiRules[0]?.action.type).toBe("end_turn");
    expect(await db.query.userData.findFirst()).toMatchObject({
      activePetId: pet.id,
      petAcquisitions: 1,
      petExperience: 0,
      money: 107,
    });
    expect(await caller.consume(input)).toEqual(response);
    expect(await db.query.userPet.findMany()).toHaveLength(1);
    expect((await db.query.userItem.findFirst())?.quantity).toBe(1);
    expect(await db.query.actionLog.findMany()).toHaveLength(1);
  });

  it("preserves an active companion and its bank when granting another individual of the same species", async () => {
    const db = await getTestDatabase();
    await insertExistingPet();
    await db
      .update(userData)
      .set({
        activePetId: "existing-pet",
        petExperience: 321,
        petSlots: 2,
        petAcquisitions: 7,
      })
      .where(eq(userData.userId, USER));
    expect((await callerForDatabase(itemRouter, USER, db).consume(input)).success).toBe(
      true,
    );
    expect(await db.query.userData.findFirst()).toMatchObject({
      activePetId: "existing-pet",
      petExperience: 321,
      petAcquisitions: 8,
    });
    expect(await db.query.userPet.findMany()).toHaveLength(2);
    expect(
      await db.query.userPet.findFirst({ where: eq(userPet.id, "existing-pet") }),
    ).toMatchObject({ storedExperience: 99 });
  });

  it("grants an authored species excluded from daily sanctuary offers", async () => {
    const db = await getTestDatabase();
    await db
      .update(petSpecies)
      .set({ isActive: false })
      .where(eq(petSpecies.id, "gift-species"));
    const response = await callerForDatabase(itemRouter, USER, db).consume(input);
    expect(response.success, response.message).toBe(true);
    expect(await db.query.userPet.findFirst()).toMatchObject({
      speciesId: "gift-species",
      jutsuIds: ["pet-strike"],
    });
    expect((await db.query.userItem.findFirst())?.quantity).toBe(1);
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: 107,
      petAcquisitions: 1,
    });
  });

  it("leaves the item and bundled money untouched when capacity is full", async () => {
    const db = await getTestDatabase();
    await insertExistingPet();
    expect(await callerForDatabase(itemRouter, USER, db).consume(input)).toMatchObject({
      success: false,
      message: expect.stringContaining("collection slot"),
    });
    expect((await db.query.userItem.findFirst())?.quantity).toBe(2);
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: 100,
      petAcquisitions: 0,
    });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("reserves the final collection slot only once across distinct simultaneous requests", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(itemRouter, USER, db);
    const responses = await Promise.all(
      ["pet-request-one", "pet-request-two"].map((requestId) =>
        caller.consume({ ...input, requestId }),
      ),
    );
    expect(responses.filter((response) => response.success)).toHaveLength(1);
    expect(await db.query.userPet.findMany()).toHaveLength(1);
    expect((await db.query.userItem.findFirst())?.quantity).toBe(1);
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: 107,
      petAcquisitions: 1,
    });
  });

  it("rolls back the debit, bundled rewards, counter and receipt if inserting the pet fails", async () => {
    const db = await getTestDatabase();
    await expect(
      callerForDatabase(itemRouter, USER, failPetInsert(db)).consume(input),
    ).rejects.toThrow("Statement failed on purpose");
    expect((await db.query.userItem.findFirst())?.quantity).toBe(2);
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: 100,
      petAcquisitions: 0,
      activePetId: null,
    });
    expect(await db.query.userPet.findMany()).toHaveLength(0);
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
    expect((await callerForDatabase(itemRouter, USER, db).consume(input)).success).toBe(
      true,
    );
  });

  it.each([
    "capacity",
    "species",
    "species defaults",
    "rank",
    "supporter",
    "active",
  ] as const)("rechecks live %s when it changes after preload", async (change) => {
    const db = await getTestDatabase();
    if (change === "supporter") {
      await db
        .update(userData)
        .set({ federalStatus: "GOLD" })
        .where(eq(userData.userId, USER));
      await insertExistingPet();
      await insertExistingPet("second-pet");
    }
    const raced = beforeClaim(db, async () => {
      if (change === "capacity") await insertExistingPet();
      else if (change === "species")
        await db.delete(petSpecies).where(eq(petSpecies.id, "gift-species"));
      else if (change === "species defaults")
        await db
          .update(petSpecies)
          .set({ defaultJutsuIds: [], updatedAt: new Date(Date.now() + 1000) })
          .where(eq(petSpecies.id, "gift-species"));
      else
        await db
          .update(userData)
          .set(
            change === "rank"
              ? { rank: "NONE" }
              : change === "supporter"
                ? { federalStatus: "NONE" }
                : { activePetId: "another-selection" },
          )
          .where(eq(userData.userId, USER));
    });
    expect(
      (await callerForDatabase(itemRouter, USER, raced).consume(input)).success,
    ).toBe(false);
    expect((await db.query.userItem.findFirst())?.quantity).toBe(2);
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: 100,
      petAcquisitions: 0,
    });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rejects malformed, missing-species and receipt-less grants before consuming", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(itemRouter, USER, db);
    expect((await caller.consume({ userItemId: input.userItemId })).success).toBe(
      false,
    );
    await db.delete(petSpecies).where(eq(petSpecies.id, "gift-species"));
    expect((await caller.consume(input)).success).toBe(false);
    await db
      .update(item)
      .set({ effects: [{ ...rewardEffect(), reward_pets: ["one", "two"] }] })
      .where(eq(item.id, "pet-gift"));
    expect((await caller.consume(input)).success).toBe(false);
    expect((await db.query.userItem.findFirst())?.quantity).toBe(2);
  });

  it("keeps companion rewards scoped to standard item tags and bounds the whole item", async () => {
    const db = await getTestDatabase();
    const row = (await db.query.item.findFirst())!;
    const valid = { ...row, cost: 1, target: "SELF", method: "SINGLE" };
    expect(ItemValidator.safeParse(valid).success).toBe(true);
    expect(
      ItemValidator.safeParse({ ...valid, effects: [rewardEffect(), rewardEffect()] })
        .success,
    ).toBe(false);
    expect(
      ItemValidator.safeParse({ ...valid, preventBattleUsage: false }).success,
    ).toBe(false);
    expect(
      NonCombatConsumeRewardTag.safeParse({
        reward_pets: ["gift-species"],
        rewardMode: "weightedCache",
      }).success,
    ).toBe(false);
  });

  it.each([true, false])(
    "lets Content save a reward species with daily offers %s",
    async (isActive) => {
      const db = await getTestDatabase();
      await db.update(userData).set({ role: "CODER" }).where(eq(userData.userId, USER));
      await db
        .update(petSpecies)
        .set({ isActive })
        .where(eq(petSpecies.id, "gift-species"));
      const row = await fetchItemWithCraftingRequirements(db, "pet-gift");
      if (!row) throw new Error("Missing companion reward item");
      const response = await callerForDatabase(itemRouter, USER, db).update({
        id: row.id,
        data: ItemValidator.parse({
          ...row,
          cost: 1,
          target: "SELF",
          method: "SINGLE",
        }),
      });
      expect(response.success, response.message).toBe(true);
    },
  );

  it("rejects a missing species when Content saves the reward item", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "CODER" }).where(eq(userData.userId, USER));
    await db.delete(petSpecies).where(eq(petSpecies.id, "gift-species"));
    const row = await fetchItemWithCraftingRequirements(db, "pet-gift");
    if (!row) throw new Error("Missing companion reward item");
    const response = await callerForDatabase(itemRouter, USER, db).update({
      id: row.id,
      data: ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE" }),
    });
    expect(response).toEqual({
      success: false,
      message: "Companion rewards must reference existing species.",
    });
  });
});
