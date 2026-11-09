import { beforeEach, expect, it } from "bun:test";
import { CRAFTING_REQUIRED_EXP } from "@/drizzle/constants";
import { item, userData, userItem, userItemImbuement } from "@/drizzle/schema";
import { occupationRouter } from "@/server/api/routers/occupation";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("crystal imbuing rank requirement", () => {
  beforeEach(async () => {
    await resetTables(userItemImbuement, userItem, item, userData);
  });

  it.each(["PVP", "BOTH"] as const)(
    "rejects PvE-only crystals on %s items",
    async (battleUsageType) => {
      await insertUsers([
        {
          userId: "imbuer",
          username: "Imbuer",
          status: "AWAKE",
          occupation: "CRAFTING",
        },
      ]);
      await insertItems([
        {
          id: "armor",
          itemType: "ARMOR",
          slot: "CHEST",
          canBeImbued: true,
          battleUsageType,
        },
        { id: "crystal", itemType: "CRYSTAL", battleUsageType: "PVE" },
      ]);
      await insertUserItems([
        { id: "armor-item", userId: "imbuer", itemId: "armor" },
        { id: "crystal-item", userId: "imbuer", itemId: "crystal" },
      ]);
      const caller = await callerFor(occupationRouter, "imbuer");
      expect(
        await caller.imbueItem({
          userItemId: "armor-item",
          userCrystalItemId: "crystal-item",
        }),
      ).toMatchObject({
        success: false,
        message: "PvE-only crystals can only be imbued on PvE-only items",
      });
    },
  );

  it.each([
    ["APPRENTICE", "EPIC", "Master"],
    ["APPRENTICE", "LEGENDARY", "Forgemaster"],
    ["MASTER", "LEGENDARY", "Forgemaster"],
  ] as const)(
    "tells a %s crafter which rank imbues %s crystals",
    async (rank, rarity, required) => {
      await insertUsers([
        {
          userId: "imbuer",
          username: "Imbuer",
          status: "AWAKE",
          occupation: "CRAFTING",
          craftingExperience: CRAFTING_REQUIRED_EXP[rank],
        },
      ]);
      await insertItems([
        { id: "armor", itemType: "ARMOR", slot: "CHEST", canBeImbued: true },
        { id: "crystal", itemType: "CRYSTAL", rarity, stackSize: 10 },
      ]);
      await insertUserItems([
        { id: "armor-item", userId: "imbuer", itemId: "armor" },
        { id: "crystal-item", userId: "imbuer", itemId: "crystal" },
      ]);
      const caller = await callerFor(occupationRouter, "imbuer");
      expect(
        await caller.imbueItem({
          userItemId: "armor-item",
          userCrystalItemId: "crystal-item",
        }),
      ).toMatchObject({
        success: false,
        message: `You need to be at least ${required} rank to imbue ${rarity} crystals`,
      });
    },
  );
});
