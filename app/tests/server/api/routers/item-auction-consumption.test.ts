import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { auctionOffer, item, itemVariant, userData, userItem, userItemVariant } from "@/drizzle/schema";
import { auctionRouter } from "@/server/api/routers/auction";
import { itemRouter } from "@/server/api/routers/item";
import { IncreaseReskinSlots, UnlockItemVariantTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("item consumption preserves auction escrow", () => {
  beforeEach(async () => {
    await resetTables(userItemVariant, itemVariant, auctionOffer, userItem, item, userData);
    await insertUsers([{ userId: "owner", username: "Owner", level: 50, status: "AWAKE", isOutlaw: true, extraReskinSlots: 0 }]);
    await insertItems([
      { id: "token", name: "Token", itemType: "CONSUMABLE", canBeTraded: true, canStack: true, effects: [IncreaseReskinSlots.parse({ power: 1 })] },
      { id: "ore", name: "Ore", canBeTraded: true, canStack: true },
      { id: "weapon", name: "Weapon", itemType: "WEAPON", canStack: false },
    ]);
    await insertUserItems([{ id: "owner-weapon", userId: "owner", itemId: "weapon" }]);
    await (await getTestDatabase()).insert(itemVariant).values({ id: "variant", itemId: "weapon", name: "Variant", image: "/variant.png", costType: "VARIANT_TOKEN" });
  });

  it("requires both the token's selected variant and the variant's unlock item before consumption", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "owner-token", userId: "owner", itemId: "token", quantity: 2 }]);
    await db.update(item).set({ effects: [UnlockItemVariantTag.parse({ variantId: "other-variant" })] }).where(eq(item.id, "token"));
    const items = await callerFor(itemRouter, "owner");
    const consume = () => items.consumeVariantToken({ tokenUserItemId: "owner-token", variantId: "variant" });
    expect(await consume()).toMatchObject({ success: false, message: "This item cannot unlock this variant" });
    await db.update(item).set({ effects: [UnlockItemVariantTag.parse({ variantId: "variant" })] }).where(eq(item.id, "token"));
    await db.update(itemVariant).set({ requiredItemId: "ore" }).where(eq(itemVariant.id, "variant"));
    expect(await consume()).toMatchObject({ success: false, message: "This variant requires a different unlock item" });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-token")))[0]?.quantity).toBe(2);
    expect(await db.select().from(userItemVariant)).toHaveLength(0);
    await db.update(itemVariant).set({ requiredItemId: "token" }).where(eq(itemVariant.id, "variant"));
    expect(await consume()).toMatchObject({ success: true });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-token")))[0]?.quantity).toBe(1);
    expect(await db.select().from(userItemVariant)).toHaveLength(1);
  });

  for (const quantity of [1, 2]) {
    for (const isVariantToken of [false, true]) {
      for (const concurrentReservation of [false, true]) {
        it(`rejects ${isVariantToken ? "variant unlock" : "item effects"} from a ${quantity}-item stack ${concurrentReservation ? "reserved after the snapshot" : "already reserved"}, then allows use after cancellation`, async () => {
          const db = await getTestDatabase();
          if (isVariantToken) {
            await db.update(item).set({ effects: [UnlockItemVariantTag.parse({})] }).where(eq(item.id, "token"));
          }
          await insertUserItems([{ id: "owner-token", userId: "owner", itemId: "token", quantity }]);
          const auction = await callerFor(auctionRouter, "owner");
          const reserve = async () => {
            expect((await auction.createAuctionOffer({ offerType: "TRADE", requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "owner-token", offeredQuantity: quantity })).success).toBe(true);
          };
          if (!concurrentReservation) await reserve();
          const items = callerForDatabase(itemRouter, "owner", concurrentReservation ? beforeStatements(db, userItem, [reserve]) : db);
          const consume = () => isVariantToken
            ? items.consumeVariantToken({ tokenUserItemId: "owner-token", variantId: "variant" })
            : items.consume({ userItemId: "owner-token" });
          expect(await consume()).toMatchObject({ success: false, message: concurrentReservation
            ? isVariantToken ? "Token item was modified concurrently — please try again" : "Item no longer available — please refresh and try again"
            : isVariantToken ? "Cannot consume a Variant Token listed in an auction" : "Cannot consume an item listed in an auction" });
          expect((await db.select().from(userItem).where(eq(userItem.id, "owner-token")))[0]).toMatchObject({ quantity, isInAuction: true });
          expect(await db.select().from(userItemVariant)).toHaveLength(0);
          expect((await db.select().from(userData).where(eq(userData.userId, "owner")))[0]?.extraReskinSlots).toBe(0);
          const [offer] = await db.select().from(auctionOffer);
          expect(offer).toMatchObject({ status: "ACTIVE", offeredQuantity: quantity });
          expect((await auction.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(true);
          expect((await db.select().from(auctionOffer))[0]?.status).toBe("CANCELLED");
          expect((await consume()).success).toBe(true);
          const remaining = await db.select().from(userItem).where(eq(userItem.id, "owner-token"));
          expect(remaining).toHaveLength(quantity === 1 ? 0 : 1);
          if (quantity === 2) expect(remaining[0]).toMatchObject({ quantity: 1, isInAuction: false });
          expect(await db.select().from(userItemVariant)).toHaveLength(isVariantToken ? 1 : 0);
          expect((await db.select().from(userData).where(eq(userData.userId, "owner")))[0]?.extraReskinSlots).toBe(isVariantToken ? 0 : 1);
        });
      }
    }
  }
});
