import { item } from "@/drizzle/schema";
import type { ItemRarity } from "@/drizzle/constants";
import { FISHING_EQUIPMENT, FISHING_SPECIES } from "@/libs/fishing";
import { sql } from "drizzle-orm";
import { promises as fs } from "fs";
import type { DrizzleClient } from "@/server/db";

// Delete anything not in above list, and insert those missing
export const seedItems = async (client: DrizzleClient) => {
  const file = await fs.readFile(process.cwd() + "/data/item.sql", "utf8");
  console.log("\nClearing old items...");
  await client.delete(item);
  console.log("Syncing items...");
  await client.execute(sql.raw(`${file}`));
  await client
    .insert(item)
    .values(
      [
        ...FISHING_SPECIES.map((fish) => ({
          id: fish.itemId,
          name: fish.name,
          description: `A freshly caught ${fish.name.toLowerCase()}.`,
          effects: [],
          itemType: "COOKING" as const,
          rarity: (fish.rarity === "Common" ? "COMMON" : "RARE") as ItemRarity,
          slot: "NONE" as const,
          target: "CHARACTER" as const,
          image: "",
          canStack: true,
          stackSize: 99,
          hidden: false,
          inShop: false,
          canBeTraded: true,
          cost:
            fish.rarity === "Rare" ? 20 : fish.rarity === "Uncommon" ? 10 : 5,
        })),
        ...FISHING_EQUIPMENT.map((equipment) => ({
          id: equipment.itemId,
          name: equipment.name,
          description: `Fishing ${equipment.kind.toLowerCase()} — +${equipment.attractionBonus}% attraction, +${equipment.controlBonus} control, +${equipment.experienceBonus}% XP.`,
          effects: [],
          itemType: "OTHER" as const,
          rarity: "COMMON" as ItemRarity,
          slot: "NONE" as const,
          target: "CHARACTER" as const,
          image: "",
          canStack: equipment.kind === "BAIT",
          stackSize: equipment.kind === "BAIT" ? 99 : 1,
          hidden: false,
          inShop: !equipment.starter,
          canBeTraded: !equipment.starter,
          cost: equipment.starter
            ? 0
            : equipment.kind === "ROD"
              ? equipment.itemId === "fishing-river-rod"
                ? 5000
                : 1500
              : equipment.kind === "TACKLE"
                ? 800
                : 25,
        })),
      ],
    )
    .onDuplicateKeyUpdate({
      set: { updatedAt: sql`VALUES(${item.updatedAt})` },
    });
};
