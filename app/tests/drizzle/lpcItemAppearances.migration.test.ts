import { readFile } from "node:fs/promises";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, itemVariant, userItem } from "@/drizzle/schema";
import { resolveItemSprite } from "@/libs/lpc/appearance";
import { insertItems } from "../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../setup/testDatabase";

const migration = await readFile(new URL("../../drizzle/migrations/0130_lpc_item_appearances.sql", import.meta.url), "utf8");
const fixtures = [
  {
    "id": "TkLC13yWtETa5-Rep1QXG",
    "name": "Basic Shinobi Chest Plate",
    "image": "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJnOPEtDmojJ0EqeDCvBrNmZaXVdY97gSpOWiA",
    "itemType": "ARMOR",
    "slot": "CHEST",
    "weaponType": "NONE"
  },
  {
    "id": "88mJ_HVf-__u3YYPXzJE3",
    "name": "Veilrend",
    "image": "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJa4M35mYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk",
    "itemType": "WEAPON",
    "slot": "HAND",
    "weaponType": "SWORD"
  },
  {
    "id": "0B6U_HcjyM2wGwWW9gGxx",
    "name": "Duskborne Shroud",
    "image": "https://utfs.io/f/Hzww9EQvYURJtcvGelUYJDfpFXWm3nrcPluEtIZqyLkaSV1j",
    "itemType": "ARMOR",
    "slot": "CHEST",
    "weaponType": "NONE"
  },
  {
    "id": "T2suAUBwdOOCp3Yr6AaSV",
    "name": "Sash of the Crimson Court",
    "image": "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJDP3NCXzEwoh0WXMnscL279N8ayVQUCbRzS3p",
    "itemType": "ARMOR",
    "slot": "WAIST",
    "weaponType": "NONE"
  }
] as const;
const expected = {
  "TkLC13yWtETa5-Rep1QXG": {
    "lpcProfile": "shirt",
    "lpcColor": "black"
  },
  "88mJ_HVf-__u3YYPXzJE3": {
    "lpcProfile": "katana",
    "lpcColor": "blue"
  },
  "0B6U_HcjyM2wGwWW9gGxx": {
    "lpcProfile": "cloak",
    "lpcColor": "black"
  },
  "T2suAUBwdOOCp3Yr6AaSV": {
    "lpcProfile": "sash",
    "lpcColor": "red"
  }
} as const;
const variant = {
  "id": "v2cA1WAHUCgk25ypk9H1F",
  "itemId": "T2suAUBwdOOCp3Yr6AaSV",
  "name": "Sash of the Crimson Courtesan",
  "image": "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJAUxnIMoZUC4muiGcQNzjfEndY5y1w20B8hTW"
};

/** Execute the production backfill against real content IDs while guarding later staff edits. */
describeWithDatabase("LPC content appearance migration", () => {
  beforeEach(async () => {
    await resetTables(userItem, itemVariant, item);
    await insertItems([...fixtures]);
    const database = await getTestDatabase();
    await database.insert(itemVariant).values({ ...variant, costType: "MONEY" });
  });

  it("persists audited shapes and palettes without changing gameplay data, and is safe to rerun", async () => {
    const database = await getTestDatabase();
    const before = await database.query.item.findMany({ orderBy: item.id });
    const beforeVariant = (await database.query.itemVariant.findFirst())!;
    await runRawSql(migration);
    const after = await database.query.item.findMany({ orderBy: item.id });
    for (const row of before) expect(after.find((saved) => saved.id === row.id)).toEqual({ ...row, ...expected[row.id as keyof typeof expected] });
    expect(await database.query.itemVariant.findFirst()).toEqual({ ...beforeVariant, lpcProfile: "sash", lpcColor: "red" });
    await runRawSql(migration);
    expect(await database.query.item.findMany({ orderBy: item.id })).toEqual(after);
    expect(resolveItemSprite(after.find((row) => row.id === fixtures[1].id)!)).toEqual({ profile: "katana", color: "blue" });
  });

  it("preserves configured fields independently and skips artwork changed since inspection", async () => {
    const database = await getTestDatabase();
    await database.update(item).set({ lpcProfile: "leather", lpcColor: "red" }).where(eq(item.id, fixtures[0].id));
    await database.update(item).set({ lpcProfile: "sword" }).where(eq(item.id, fixtures[1].id));
    await database.update(item).set({ image: "https://example.com/replaced-art.png" }).where(eq(item.id, fixtures[2].id));
    await database.update(itemVariant).set({ lpcColor: "purple" }).where(eq(itemVariant.id, variant.id));
    const before = await database.query.item.findMany({ orderBy: item.id });
    await runRawSql(migration);
    const after = await database.query.item.findMany({ orderBy: item.id });
    expect(after.find((row) => row.id === fixtures[0].id)).toEqual(before.find((row) => row.id === fixtures[0].id));
    expect(after.find((row) => row.id === fixtures[1].id)).toMatchObject({ lpcProfile: "sword", lpcColor: "blue" });
    expect(after.find((row) => row.id === fixtures[2].id)).toEqual(before.find((row) => row.id === fixtures[2].id));
    expect(await database.query.itemVariant.findFirst()).toMatchObject({ lpcProfile: "sash", lpcColor: "purple" });
  });
});
