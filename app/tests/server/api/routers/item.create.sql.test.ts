import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import {
  DEFAULT_FURNITURE_DATA,
  FURNITURE_ITEM_DEFAULTS,
} from "@/validators/itemFurniture";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "item-creator";
const playerId = "item-player";

describeWithDatabase("item.create", () => {
  beforeEach(async () => {
    await resetTables(item, userData);
    await insertUsers([
      { userId: staffId, username: "ItemCreator", role: "CONTENT-ADMIN" },
      { userId: playerId, username: "ItemPlayer", role: "USER" },
    ]);
  });

  it("creates hidden furniture with the furniture defaults and no effects", async () => {
    const result = await (await callerFor(itemRouter, staffId)).create({
      type: "FURNITURE",
    });
    expect(result.success).toBe(true);
    const created = await (await getTestDatabase()).query.item.findFirst({
      where: eq(item.id, result.message),
    });
    expect(created).toMatchObject({
      itemType: "FURNITURE",
      hidden: true,
      effects: [],
      furnitureData: DEFAULT_FURNITURE_DATA,
      inShop: false,
      cost: 0,
      repsCost: 0,
      seichiSilverCost: 0,
      slot: FURNITURE_ITEM_DEFAULTS.slot,
      target: FURNITURE_ITEM_DEFAULTS.target,
    });
  });

  it("rejects players without content permissions and writes nothing", async () => {
    const result = await (await callerFor(itemRouter, playerId)).create({
      type: "WEAPON",
    });
    expect(result).toEqual({ success: false, message: "Not allowed to create item" });
    expect(await (await getTestDatabase()).query.item.findMany()).toHaveLength(0);
  });
});
