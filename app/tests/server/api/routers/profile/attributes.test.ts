import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userAttribute, userData } from "@/drizzle/schema";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { profileRouter } from "@/server/api/routers/profile";
import { getCharacterAttributes } from "@/validators/register";
import { insertUsers } from "../../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const userId = "attribute-owner";
const seedAttributes = ["Long Hair", "Hard features", "Full Beard", "Glasses", "Tattoo", "Gray hair", "Brown eyes", "Light skin"];

// Exercise the existing profile mutations and the same saved recipes consumed by every scene.
describeWithDatabase("character colors and exclusive traits", () => {
  beforeEach(async () => {
    await resetTables(userAttribute, userData);
    await insertUsers([{ userId }]);
    const database = await getTestDatabase();
    await database.insert(userAttribute).values(seedAttributes.map((attribute, index) => ({ id: `attribute-${index}`, userId, attribute })));
  });

  it.each([
    { attribute: "Hair", color: "Red", slot: "hair", expected: { color: "red" } },
    { attribute: "Eyes", color: "Blue", slot: "head", expected: { eyes: "blue" } },
    { attribute: "Skin", color: "Dark", slot: "body", expected: { color: "black" } },
  ] as const)("replaces $attribute color at the five-trait limit and updates its sprite", async ({ attribute, color, slot, expected }) => {
    const database = await getTestDatabase();
    const api = callerForDatabase(profileRouter, userId, database);
    expect((await api.insertAttribute({ attribute, color })).success).toBe(true);
    const rows = await api.getUserAttributes();
    expect(rows).toHaveLength(seedAttributes.length);
    const appearance = getCharacterAttributes(rows.map((row) => row.attribute));
    expect(appearance).toMatchObject({ [attribute]: color });
    // Attribute queries do not define row order; palette changes preserve the exact trait set.
    expect(appearance.traits.sort()).toEqual(seedAttributes.slice(0, 5).sort());
    expect(resolveSpriteAppearance({ attributes: rows }).layers.find((layer) => layer.slot === slot)).toMatchObject(expected);
  });

  it("replaces conflicting legacy styles at the limit and clears the whole group on removal", async () => {
    const database = await getTestDatabase();
    await database.insert(userAttribute).values({ id: "legacy-bald", userId, attribute: "Bald" });
    const api = callerForDatabase(profileRouter, userId, database);
    expect((await api.insertAttribute({ attribute: "Short Hair" })).success).toBe(true);
    let rows = await api.getUserAttributes();
    expect(rows.some((row) => ["Long Hair", "Bald"].includes(row.attribute))).toBe(false);
    expect(rows.some((row) => row.attribute === "Short Hair")).toBe(true);
    await database.insert(userAttribute).values({ id: "legacy-long", userId, attribute: "Long Hair" });
    expect((await api.deleteAttribute({ attribute: "Short Hair" })).success).toBe(true);
    rows = await api.getUserAttributes();
    expect(rows.some((row) => ["Short Hair", "Long Hair", "Bald"].includes(row.attribute))).toBe(false);
  });

  it("rejects a sixth independent trait without changing colors or rows", async () => {
    const database = await getTestDatabase();
    const api = callerForDatabase(profileRouter, userId, database);
    expect((await api.insertAttribute({ attribute: "Scar" })).success).toBe(false);
    expect((await api.getUserAttributes()).map((row) => row.attribute).sort()).toEqual([...seedAttributes].sort());
  });

  it.each([
    { attribute: "Hair" }, { attribute: "Skin", color: "Blue" },
    { attribute: "Hair", color: "Dark" }, { attribute: "Glasses", color: "Black" },
  ] as const)("rejects invalid color input $attribute/$color before writes", async (input) => {
    const database = await getTestDatabase();
    expect((await callerForDatabase(profileRouter, userId, database).insertAttribute(input)).success).toBe(false);
    const rows = await database.query.userAttribute.findMany({ where: eq(userAttribute.userId, userId) });
    expect(rows.map((row) => row.attribute).sort()).toEqual([...seedAttributes].sort());
  });

  it("repairs duplicate saved palettes even when the requested color already exists", async () => {
    const database = await getTestDatabase();
    await database.insert(userAttribute).values({ id: "extra-hair", userId, attribute: "Blue Hair" });
    const api = callerForDatabase(profileRouter, userId, database);
    expect((await api.insertAttribute({ attribute: "Hair", color: "Blue" })).success).toBe(true);
    const rows = await api.getUserAttributes();
    expect(rows.some((row) => row.attribute === "Gray hair")).toBe(false);
    expect(getCharacterAttributes(rows.map((row) => row.attribute)).Hair).toBe("Blue");
  });
});
