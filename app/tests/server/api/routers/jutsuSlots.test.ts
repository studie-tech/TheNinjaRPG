import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { COST_EXTRA_JUTSU_SLOT, MAX_EXTRA_JUTSU_SLOTS } from "@/drizzle/constants";
import {
  actionLog,
  item,
  userData,
  userItem,
  userItemImbuement,
  userVote,
} from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { itemRouter } from "@/server/api/routers/item";
import { IncreaseJutsuSlots, NonCombatConsumeRewardTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "slot-owner";
const readUser = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
const readScroll = async () =>
  (await getTestDatabase()).query.userItem.findFirst({
    where: eq(userItem.id, "owned-scroll"),
  });

describeWithDatabase("purchased and consumed jutsu slots", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userItemImbuement, userItem, item, userVote, userData);
    await insertUsers([
      {
        userId,
        level: 50,
        rank: "JONIN",
        status: "AWAKE",
        isOutlaw: true,
        reputationPoints: COST_EXTRA_JUTSU_SLOT * 3,
      },
    ]);
    await insertItems([
      {
        id: "slot-scroll",
        name: "Slot scroll",
        itemType: "CONSUMABLE",
        target: "SELF",
        method: "SINGLE",
        preventBattleUsage: true,
        destroyOnUse: true,
        effects: [IncreaseJutsuSlots.parse({ power: 1 })],
      },
    ]);
    await insertUserItems([
      { id: "owned-scroll", itemId: "slot-scroll", userId, quantity: 3 },
    ]);
  });

  it.each(["purchase first", "consume first"])(
    "shares the cap in either order: %s",
    async (order) => {
      const market = await callerFor(blackMarketRouter, userId);
      const items = await callerFor(itemRouter, userId);
      if (order === "purchase first") {
        expect((await market.buyJutsuSlot()).success).toBe(true);
        expect((await items.consume({ userItemId: "owned-scroll" })).success).toBe(
          true,
        );
      } else {
        expect((await items.consume({ userItemId: "owned-scroll" })).success).toBe(
          true,
        );
        expect((await market.buyJutsuSlot()).success).toBe(true);
      }
      expect((await readUser())?.extraJutsuSlots).toBe(MAX_EXTRA_JUTSU_SLOTS);
      expect(await items.consume({ userItemId: "owned-scroll" })).toMatchObject({
        success: false,
        message: expect.stringContaining("maximum of 2 extra jutsu slots"),
      });
      expect((await readScroll())?.quantity).toBe(2);
      expect((await market.buyJutsuSlot()).success).toBe(false);
    },
  );

  it("retains the item and all sibling rewards after two purchases", async () => {
    const db = await getTestDatabase();
    const market = await callerFor(blackMarketRouter, userId);
    expect((await market.buyJutsuSlot()).success).toBe(true);
    expect((await market.buyJutsuSlot()).success).toBe(true);
    await db
      .update(item)
      .set({
        effects: [
          IncreaseJutsuSlots.parse({}),
          NonCombatConsumeRewardTag.parse({ reward_money: 100 }),
        ],
      })
      .where(eq(item.id, "slot-scroll"));
    const before = await readUser();
    expect(
      await (await callerFor(itemRouter, userId)).consume({
        userItemId: "owned-scroll",
      }),
    ).toMatchObject({ success: false, message: expect.stringContaining("maximum") });
    expect((await readUser())?.money).toBe(before?.money);
    expect((await readScroll())?.quantity).toBe(3);
  });

  it("checks the total grant and rejects partial capacity", async () => {
    const db = await getTestDatabase();
    await db
      .update(item)
      .set({ effects: [IncreaseJutsuSlots.parse({}), IncreaseJutsuSlots.parse({})] })
      .where(eq(item.id, "slot-scroll"));
    await db
      .update(userData)
      .set({ extraJutsuSlots: 1 })
      .where(eq(userData.userId, userId));
    const items = await callerFor(itemRouter, userId);
    expect((await items.consume({ userItemId: "owned-scroll" })).success).toBe(false);
    expect((await readScroll())?.quantity).toBe(3);
    await db
      .update(userData)
      .set({ extraJutsuSlots: 0 })
      .where(eq(userData.userId, userId));
    expect((await items.consume({ userItemId: "owned-scroll" })).success).toBe(true);
    expect((await readUser())?.extraJutsuSlots).toBe(2);
    expect((await readScroll())?.quantity).toBe(2);
  });

  it("retains the item when a purchase fills the final slot after consumption preloads", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ extraJutsuSlots: 1 })
      .where(eq(userData.userId, userId));
    const market = await callerFor(blackMarketRouter, userId);
    const client = beforeStatements(db, userItem, [
      async () => {
        expect((await market.buyJutsuSlot()).success).toBe(true);
      },
    ]);
    expect(
      await callerForDatabase(itemRouter, userId, client).consume({
        userItemId: "owned-scroll",
      }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining("maximum of 2 extra jutsu slots"),
    });
    expect((await readUser())?.extraJutsuSlots).toBe(2);
    expect((await readScroll())?.quantity).toBe(3);
  });

  it("preserves both valid increments when a purchase and consumption fit", async () => {
    const db = await getTestDatabase();
    const market = await callerFor(blackMarketRouter, userId);
    const client = beforeStatements(db, userItem, [
      async () => {
        expect((await market.buyJutsuSlot()).success).toBe(true);
      },
    ]);
    expect(
      (
        await callerForDatabase(itemRouter, userId, client).consume({
          userItemId: "owned-scroll",
        })
      ).success,
    ).toBe(true);
    expect((await readUser())?.extraJutsuSlots).toBe(2);
    expect((await readScroll())?.quantity).toBe(2);
  });

  it("grants only the last remaining slot when consumptions race", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ extraJutsuSlots: 1 })
      .where(eq(userData.userId, userId));
    const items = await callerFor(itemRouter, userId);
    // Let the competing consumption finish after this request has preloaded its
    // account and stack, so the test exercises the stale claim deterministically.
    const client = beforeStatements(db, userItem, [
      async () => {
        expect((await items.consume({ userItemId: "owned-scroll" })).success).toBe(
          true,
        );
      },
    ]);
    const result = await callerForDatabase(itemRouter, userId, client).consume({
      userItemId: "owned-scroll",
    });
    expect(result.success).toBe(false);
    expect((await readUser())?.extraJutsuSlots).toBe(2);
    expect((await readScroll())?.quantity).toBe(2);
  });
});
