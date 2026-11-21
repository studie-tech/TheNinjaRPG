import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  craftingServicePrice,
  craftingServiceRequest,
  item,
  userData,
  userItem,
  userItemImbuement,
  userVote,
} from "@/drizzle/schema";
import { fortifiedEffects, rollFortify } from "@/libs/fortify";
import { attemptFortify } from "@/queries/fortify";
import { itemRouter } from "@/server/api/routers/item";
import { occupationRouter } from "@/server/api/routers/occupation";
import { DamageTag } from "@/validators/combat";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const tag = DamageTag.parse({ power: 20, fortifyId: "damage", fortifyEnabled: true });
const input = {
  userItemId: "owned",
  tagId: "damage",
  expectedLevel: 0,
  expectedFailures: 0,
};
describeWithDatabase("Fortify guarded economy and ownership", () => {
  beforeEach(async () => {
    await resetTables(
      userVote,
      userItemImbuement,
      userItem,
      item,
      craftingServicePrice,
      craftingServiceRequest,
      userData,
    );
    await insertUsers([
      {
        userId: "hero",
        username: "Hero",
        level: 50,
        rank: "JONIN",
        status: "AWAKE",
        money: 20_000_000,
        regenAt: new Date(),
      },
      {
        userId: "crafter",
        username: "Crafter",
        occupation: "CRAFTING",
        status: "AWAKE",
        level: 50,
        rank: "JONIN",
        regenAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId: "hero" }, { userId: "crafter" }]);
    await insertItems([
      { id: "sword", itemType: "WEAPON", canBeEnhanced: true, effects: [tag] },
    ]);
    await insertUserItems([{ id: "owned", userId: "hero", itemId: "sword" }]);
  });
  it("atomically charges and upgrades a stored copy", async () => {
    const db = await getTestDatabase();
    await db
      .update(userItem)
      .set({ storedAtHome: true })
      .where(eq(userItem.id, "owned"));
    expect((await (await callerFor(itemRouter, "hero")).fortify(input)).success).toBe(
      true,
    );
    const owned = await db.query.userItem.findFirst({
      where: eq(userItem.id, "owned"),
    });
    expect(owned?.fortification?.damage).toEqual({
      type: "damage",
      level: 1,
      failures: 0,
    });
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(19_000_000);
  });
  it("resolves concurrent submissions against the same quote only once", async () => {
    const caller = await callerFor(itemRouter, "hero");
    const results = await Promise.all([caller.fortify(input), caller.fortify(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const db = await getTestDatabase();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(19_000_000);
  });
  it("charges a failed attempt and stores pity on just its selected tag", async () => {
    const db = await getTestDatabase();
    const state = { damage: { type: "damage", level: 1, failures: 0 } };
    await db
      .update(userItem)
      .set({ fortification: state })
      .where(eq(userItem.id, "owned"));
    const owned = (await db.query.userItem.findFirst({
      where: eq(userItem.id, "owned"),
      with: { item: true, imbuements: { with: { item: true } } },
    }))!;
    const user = (await db.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    }))!;
    const result = rollFortify(state, tag, false, 0.99);
    expect(
      (
        await attemptFortify(
          db,
          user,
          owned,
          result,
          new Date(owned.updatedAt.getTime() + 1),
        )
      ).rowsAffected,
    ).toBe(2);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "owned") }))
        ?.fortification?.damage,
    ).toEqual({ type: "damage", level: 1, failures: 1 });
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(18_800_000);
    expect(fortifiedEffects(owned.item.effects, result.state)[0]?.power).toBe(21);
  });
  it("restores merge claims when a candidate receives a paid upgrade after selection", async () => {
    const db = await getTestDatabase();
    await db
      .update(item)
      .set({ canStack: true, stackSize: 10 })
      .where(eq(item.id, "sword"));
    await insertUserItems([{ id: "a-plain", userId: "hero", itemId: "sword" }]);
    const fortifier = await callerFor(itemRouter, "hero");
    const raced = beforeStatements(
      db,
      userItem,
      [
        () => {},
        async () => expect((await fortifier.fortify(input)).success).toBe(true),
      ],
      { when: (values) => "updatedAt" in values },
    );
    const result = await callerForDatabase(itemRouter, "hero", raced).mergeStacks({
      itemId: "sword",
    });
    expect(result.success).toBe(false);
    expect(result.inventoryChanges).toBeUndefined();
    const rows = await db.query.userItem.findMany({ orderBy: userItem.id });
    expect(rows).toMatchObject([
      { id: "a-plain", quantity: 1, fortification: null },
      {
        id: "owned",
        quantity: 1,
        fortification: { damage: { level: 1, failures: 0 } },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(19_000_000);
  });

  it("counts hidden child evolutions and leaves money untouched", async () => {
    await insertItems([
      { id: "child", name: "Hidden child", parentItemId: "sword", hidden: true },
    ]);
    expect((await (await callerFor(itemRouter, "hero")).fortify(input)).success).toBe(
      false,
    );
    const db = await getTestDatabase();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(20_000_000);
  });
  it.each([
    { quantity: 2 },
    { isInAuction: true },
    { craftingFinishedAt: new Date(Date.now() + 60_000) },
    { userId: "crafter" },
  ])("rejects unavailable copy %j", async (patch) => {
    const db = await getTestDatabase();
    await db.update(userItem).set(patch).where(eq(userItem.id, "owned"));
    expect((await (await callerFor(itemRouter, "hero")).fortify(input)).success).toBe(
      false,
    );
  });
  it("offers instant Fortify with the crafter's rate and a separately paid fee", async () => {
    const db = await getTestDatabase();
    await db
      .insert(craftingServicePrice)
      .values({ userId: "crafter", service: "FORTIFY", rarity: "COMMON", fee: 100 });
    const result = await (
      await callerFor(occupationRouter, "hero")
    ).submitServiceRequest({
      crafterId: "crafter",
      service: "FORTIFY",
      userItemId: "owned",
      expectedFee: 100,
      fortifyTagId: "damage",
      expectedFortifyLevel: 0,
      expectedFortifyFailures: 0,
    });
    expect(result.success).toBe(true);
    const owned = await db.query.userItem.findFirst({
      where: eq(userItem.id, "owned"),
    });
    expect(owned?.userId).toBe("hero");
    expect(owned?.fortification?.damage?.level).toBe(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.money,
    ).toBe(18_999_900);
    expect(
      (
        await db.query.craftingServiceRequest.findFirst({
          where: eq(craftingServiceRequest.service, "FORTIFY"),
        })
      )?.status,
    ).toBe("COMPLETED");
  });
});
