import { describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import type { DungeonContent } from "@/validators/dungeon";
import { dungeonContent } from "../../../setup/dungeon";
import { callerForDatabase } from "../../../setup/testDatabase";

const dialect = new MySqlDialect();
const drop = (type: "item" | "cache" | "jutsu", id: string) => ({
  type,
  id,
  chance: 25,
  quantity: 1,
});

const catalogueCaller = (definitions: { id: string; content: DungeonContent }[]) => {
  const itemNames = vi.fn(async (_config?: { where?: SQL }) => [
    { id: "item", name: "Medicine" },
    { id: "cache", name: "Supply cache" },
  ]);
  const jutsuNames = vi.fn(async (_config?: { where?: SQL }) => [
    { id: "jutsu", name: "Technique" },
  ]);
  const caller = callerForDatabase(dungeonRouter, "reader", {
    query: {
      dungeon: { findMany: vi.fn(async () => definitions) },
      item: { findMany: itemNames },
      jutsu: { findMany: jutsuNames },
    },
  } as never);
  return { caller, itemNames, jutsuNames };
};

describe("dungeon catalogue reward names", () => {
  it("fetches unique visible item/cache and jutsu IDs and preserves unresolved names", async () => {
    const content = dungeonContent();
    content.rewards.drops = [
      drop("item", "item"),
      drop("cache", "cache"),
      drop("jutsu", "jutsu"),
      drop("item", "missing"),
    ];
    const hidden = dungeonContent();
    hidden.hidden = true;
    hidden.rewards.drops = [drop("item", "hidden-item"), drop("jutsu", "hidden-jutsu")];
    const expired = dungeonContent();
    expired.expiresAt = new Date(0);
    expired.rewards.drops = [drop("item", "expired-item")];
    const { caller, itemNames, jutsuNames } = catalogueCaller([
      { id: "visible", content },
      { id: "also-visible", content },
      { id: "hidden", content: hidden },
      { id: "expired", content: expired },
    ]);
    const result = await caller.getCatalogue();
    expect(itemNames).toHaveBeenCalledTimes(1);
    expect(jutsuNames).toHaveBeenCalledTimes(1);
    const itemWhere = itemNames.mock.calls[0]?.[0]?.where;
    const jutsuWhere = jutsuNames.mock.calls[0]?.[0]?.where;
    if (!itemWhere || !jutsuWhere) throw new Error("Missing reward ID filters");
    expect(dialect.sqlToQuery(itemWhere).params).toEqual(["item", "cache", "missing"]);
    expect(dialect.sqlToQuery(jutsuWhere).params).toEqual(["jutsu"]);
    expect(result).toHaveLength(2);
    expect(result[0]?.rewards.drops.map(({ name }) => name)).toEqual([
      "Medicine",
      "Supply cache",
      "Technique",
      "Unavailable reward",
    ]);
  });

  it.each([
    { drops: [] },
    { drops: [drop("item", "item")] },
    { drops: [drop("jutsu", "jutsu")] },
  ])("skips name lookups for reward kinds without IDs: %j", async ({ drops }) => {
    const content = dungeonContent();
    content.rewards.drops = [...drops];
    const { caller, itemNames, jutsuNames } = catalogueCaller([
      { id: "visible", content },
    ]);
    await caller.getCatalogue();
    expect(itemNames).toHaveBeenCalledTimes(
      drops.some((entry) => entry.type === "item") ? 1 : 0,
    );
    expect(jutsuNames).toHaveBeenCalledTimes(
      drops.some((entry) => entry.type === "jutsu") ? 1 : 0,
    );
  });
});
