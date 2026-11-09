import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { HomeTypeDetails } from "@/drizzle/constants";
import { item, userData, userHome, userItem } from "@/drizzle/schema";
import { calcMaxHouseSpecialItems } from "@/libs/item";
import { homeRouter } from "@/server/api/routers/home";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "downgrading-owner";
const target = HomeTypeDetails.STUDIO_APARTMENT.storage;
const specialCap = calcMaxHouseSpecialItems(target);

const store = (itemId: string, count: number) =>
  insertUserItems(
    Array.from({ length: count }, (_, index) => ({
      id: `${itemId}-${index}`,
      userId,
      itemId,
      storedAtHome: true,
    })),
  );

const downgrade = async () =>
  (await callerFor(homeRouter, userId)).upgradeHome({ homeType: "STUDIO_APARTMENT" });
const homeType = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) })
  )?.homeType;

describeWithDatabase("home downgrade storage limits", () => {
  beforeEach(async () => {
    await resetTables(userHome, userItem, item, userData);
    await insertUsers([
      { userId, username: "Downgrader", homeType: "PALACE", status: "AWAKE" },
    ]);
    await insertItems([
      { id: "gear", itemType: "WEAPON" },
      { id: "ore", itemType: "MATERIAL" },
      { id: "broth", itemType: "COOKING" },
    ]);
  });

  it.each([
    {
      label: "normal items",
      itemId: "gear",
      count: target + 1,
      message: `You need to remove some items from storage first (max ${target})`,
    },
    {
      label: "materials",
      itemId: "ore",
      count: specialCap + 1,
      message: `You need to remove some materials from storage first (max ${specialCap})`,
    },
    {
      label: "cooking items",
      itemId: "broth",
      count: specialCap + 1,
      message: `You need to remove some cooking items from storage first (max ${specialCap})`,
    },
  ])("refuses too many stored $label", async ({ itemId, count, message }) => {
    await store(itemId, count);
    expect(await downgrade()).toEqual({ success: false, message });
    expect(await homeType()).toBe("PALACE");
  });

  it("reports normal items before materials and materials before cooking items", async () => {
    await store("broth", specialCap + 1);
    await store("ore", specialCap + 1);
    expect((await downgrade()).message).toContain("some materials");
    await store("gear", target + 1);
    expect((await downgrade()).message).toContain("some items");
  });

  it("allows a downgrade with every bucket at its limit", async () => {
    await store("gear", target);
    await store("ore", specialCap);
    await store("broth", specialCap);
    expect((await downgrade()).success).toBe(true);
    expect(await homeType()).toBe("STUDIO_APARTMENT");
  });
});
