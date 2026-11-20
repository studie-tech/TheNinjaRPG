/** Pin inventory and jutsu list definitions: revision-keyed, cached, live ownership state. */
import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  bloodline,
  item,
  jutsu,
  jutsuReskin,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
} from "@/drizzle/schema";
import {
  listUserItemWithDefinitionsForFetchUserItems,
  listUserItemWithDefinitionsForFetchUserItemsWithVariants,
} from "@/queries/item";
import { selectUserJutsuWithDefinitionsForFetchUserJutsus } from "@/queries/jutsu";
import { fetchUserItems, fetchUserItemsWithVariants } from "@/server/api/routers/item";
import { fetchUserJutsus } from "@/server/api/routers/jutsu";
import {
  insertItems,
  insertJutsus,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import { aroundStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "definition-owner";

describeWithDatabase("inventory and jutsu list definitions", () => {
  beforeEach(async () => {
    await resetTables(
      userItemImbuement,
      userItem,
      item,
      userJutsu,
      jutsuReskin,
      jutsu,
      bloodline,
      userData,
    );
    await insertUsers([{ userId: USER_ID, username: USER_ID }]);
    await insertItems([
      { id: "blade", name: "Blade", itemType: "WEAPON", slot: "HAND" },
      { id: "scroll", name: "Imbue scroll", itemType: "CONSUMABLE" },
    ]);
    await insertUserItems([
      { id: "owned-blade", userId: USER_ID, itemId: "blade", equipped: "HAND_1" },
      { id: "owned-scroll", userId: USER_ID, itemId: "scroll", quantity: 3 },
    ]);
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({
      id: "imbuement",
      userItemId: "owned-blade",
      imbuementItemId: "scroll",
      craftingFinishedAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    await db.insert(bloodline).values({
      id: "line",
      name: "Line",
      image: "/line.png",
      description: "A bloodline",
      effects: [],
      rank: "B",
    });
    await insertJutsus([
      { id: "plain", name: "Plain" },
      { id: "inherited", name: "Inherited", bloodlineId: "line" },
    ]);
    await db.insert(userJutsu).values([
      { id: "owned-plain", userId: USER_ID, jutsuId: "plain", level: 3 },
      { id: "owned-inherited", userId: USER_ID, jutsuId: "inherited", level: 2 },
    ]);
  });

  it("matches the joined inventory, then serves definitions without reading Item rows", async () => {
    const db = await getTestDatabase();
    const joined = await listUserItemWithDefinitionsForFetchUserItems(db, USER_ID);
    const joinedVariants =
      await listUserItemWithDefinitionsForFetchUserItemsWithVariants(db, USER_ID);
    const cold = await recordQueries(() => fetchUserItems(db, USER_ID));
    expect(byId(cold.result)).toEqual(byId(joined));
    expect(cold.statements).toHaveLength(2);
    expect(cold.statements[0]).toContain("SHA2(JSON_ARRAY(");
    expect(cold.statements[1]).toMatch(/from `Item` where `Item`.`id` in/i);

    const warm = await recordQueries(() => fetchUserItems(db, USER_ID));
    expect(warm.statements).toHaveLength(1);
    expect(byId(warm.result)).toEqual(byId(joined));
    const variants = await recordQueries(() => fetchUserItemsWithVariants(db, USER_ID));
    expect(variants.statements).toHaveLength(1);
    expect(byId(variants.result)).toEqual(byId(joinedVariants));
  });

  it("reads ownership live and any content write's new revision", async () => {
    const db = await getTestDatabase();
    await fetchUserItems(db, USER_ID);
    await db
      .update(userItem)
      .set({ quantity: 7, durability: 40 })
      .where(eq(userItem.id, "owned-scroll"));
    // Migrations and console fixes rewrite content without moving `updatedAt`.
    await db.execute(
      sql`UPDATE \`Item\` SET \`name\` = 'Edited blade' WHERE \`id\` = 'blade'`,
    );

    const { result, statements } = await recordQueries(() =>
      fetchUserItems(db, USER_ID),
    );
    const rows = Object.fromEntries(result.map((row) => [row.id, row]));
    expect(rows["owned-scroll"]).toMatchObject({ quantity: 7, durability: 40 });
    expect(rows["owned-blade"]?.item.name).toBe("Edited blade");
    expect(rows["owned-blade"]?.imbuements[0]?.item.name).toBe("Imbue scroll");
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("in ('blade')");
  });

  it("repeats the read with joined definitions when an edit races the definition read", async () => {
    const db = await getTestDatabase();
    let definitionReads = 0;
    const client = aroundStatements(
      db,
      item,
      async (read) => {
        definitionReads++;
        await db.update(item).set({ name: "Raced blade" }).where(eq(item.id, "blade"));
        return read();
      },
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() =>
      fetchUserItems(client, USER_ID),
    );
    expect(definitionReads).toBe(1);
    expect(result.find((row) => row.id === "owned-blade")?.item.name).toBe(
      "Raced blade",
    );
    const reads = statements.filter((statement) => /^select /i.test(statement));
    expect(reads).toHaveLength(3);
    expect(reads[2]).not.toContain("SHA2(JSON_ARRAY(");
  });

  it("hands every read its own copy and drops deleted definitions as the join does", async () => {
    const db = await getTestDatabase();
    const first = await fetchUserItems(db, USER_ID);
    const blade = first.find((row) => row.id === "owned-blade");
    if (blade) blade.item.name = "Rewritten for one player";
    await db.delete(item).where(eq(item.id, "scroll"));

    const second = await fetchUserItems(db, USER_ID);
    expect(second.map((row) => row.id)).toEqual(["owned-blade"]);
    expect(second[0]?.item.name).toBe("Blade");
    expect(second[0]?.imbuements[0]?.item).toBeNull();
  });

  it("matches the joined jutsu list and caches jutsu and bloodline definitions", async () => {
    const db = await getTestDatabase();
    const joined = await selectUserJutsuWithDefinitionsForFetchUserJutsus(
      db,
      USER_ID,
      undefined,
    );
    const cold = await recordQueries(() => fetchUserJutsus(db, USER_ID));
    const owned = Object.fromEntries(cold.result.map((row) => [row.id, row]));
    for (const row of joined) {
      expect(owned[row.UserJutsu.id]?.jutsu).toEqual({
        ...row.Jutsu,
        bloodline: row.Bloodline,
      });
    }
    expect(owned["owned-plain"]?.jutsu.bloodline).toBeNull();
    expect(owned["owned-inherited"]?.jutsu.bloodline?.name).toBe("Line");
    const reads = cold.statements.filter((statement) =>
      /from `(Jutsu|Bloodline)` where `(Jutsu|Bloodline)`.`id` in/i.test(statement),
    );
    expect(reads).toHaveLength(2);

    await db.update(userJutsu).set({ level: 9 }).where(eq(userJutsu.id, "owned-plain"));
    await db.execute(
      sql`UPDATE \`Bloodline\` SET \`name\` = 'Edited line' WHERE \`id\` = 'line'`,
    );
    const warm = await recordQueries(() => fetchUserJutsus(db, USER_ID));
    const edited = Object.fromEntries(warm.result.map((row) => [row.id, row]));
    expect(edited["owned-plain"]?.level).toBe(9);
    expect(edited["owned-inherited"]?.jutsu.bloodline?.name).toBe("Edited line");
    // Only the edited bloodline is read again.
    expect(
      warm.statements.filter((statement) => /`Jutsu`.`id` in/i.test(statement)),
    ).toHaveLength(0);
    expect(
      warm.statements.filter((statement) => /`Bloodline`.`id` in/i.test(statement)),
    ).toHaveLength(1);
  });

  it("repeats the jutsu list with joined definitions when an edit races it", async () => {
    const db = await getTestDatabase();
    let definitionReads = 0;
    const client = aroundStatements(
      db,
      jutsu,
      async (read) => {
        definitionReads++;
        await db.update(jutsu).set({ name: "Raced" }).where(eq(jutsu.id, "plain"));
        return read();
      },
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() =>
      fetchUserJutsus(client, USER_ID),
    );
    expect(definitionReads).toBe(1);
    expect(result.find((row) => row.id === "owned-plain")?.jutsu.name).toBe("Raced");
    const lists = statements.filter((statement) => /from `UserJutsu`/i.test(statement));
    expect(lists).toHaveLength(2);
    expect(lists[1]).not.toContain("SHA2(JSON_ARRAY(");
  });
});

/** Inventory rows keyed by id; ties in the read order are not part of the contract. */
const byId = <Row extends { id: string }>(rows: Row[]) =>
  Object.fromEntries(rows.map((row) => [row.id, row]));
