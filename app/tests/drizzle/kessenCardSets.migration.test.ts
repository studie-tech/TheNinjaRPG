import { beforeEach, expect, it } from "bun:test";
import { eq, like, sql } from "drizzle-orm";
import { item, kessenMatch } from "@/drizzle/schema";
import { itemToKessenCard, kessenCardToCardData } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";
import { cardDataSchema } from "@/validators/itemCard";
import { KESSEN_SEED_CATALOG } from "../libs/kessen/fixtures/catalog";
import { readMigration } from "../setup/migrations";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

// The seed migration stores summon groups; this migration turns them, with each card's
// Bond groups, into its sets on card items and on the card snapshots of stored matches.
const seedFile = await readMigration("0190_wakeful_dreadnoughts.sql");
const seed = seedFile.slice(seedFile.indexOf("-- Kessen cards"));
const migration = await readMigration("0195_kessen_card_sets.sql");

/** A card as matches stored it before sets: summon groups, Bond groups only on the Bond. */
const legacyCard = ({ sets, ...card }: KessenCard) => ({
  ...card,
  summonGroups: sets.filter(
    (set) =>
      !card.abilities.some((ability) => ability.k === "bond" && ability.group === set),
  ),
});

const legacyState = (cards: readonly KessenCard[]) => ({
  engine: {
    step: 7,
    cards: Object.fromEntries(cards.map((card) => [card.id, legacyCard(card)])),
  },
  mode: "standard",
  pool: cards.map(legacyCard),
  plays: [2, 1],
});

const matchRow = (id: string, state: Record<string, unknown>) => ({
  id,
  userId: `user-${id}`,
  npcKey: "lemu",
  engineVersion: 3,
  seed: `seed-${id}`,
  state,
});

describeWithDatabase("Kessen card sets migration", () => {
  beforeEach(async () => {
    await resetTables(item, kessenMatch);
    await runRawSql(seed);
  });

  it("gives every seed card its summon and Bond groups as sets", async () => {
    await runRawSql(migration);
    const client = await getTestDatabase();
    const rows = await client.select().from(item).where(like(item.id, "kessen-%"));
    const cards = rows.filter((row) => row.itemType === "CARD");
    expect(cards).toHaveLength(KESSEN_SEED_CATALOG.length);
    for (const row of cards) {
      expect(row.cardData).not.toHaveProperty("summonGroups");
      const data = cardDataSchema.parse(row.cardData);
      const expected = KESSEN_SEED_CATALOG.find((card) => card.id === row.id);
      if (!expected) throw new Error(`${row.id} is not a seed card`);
      expect(data.sets).toEqual(expected.sets);
      expect(itemToKessenCard(row)).toEqual(expected);
    }
    expect(
      cards
        .filter((row) => cardDataSchema.parse(row.cardData).sets.length > 0)
        .map((row) => row.id)
        .sort(),
    ).toEqual(
      KESSEN_SEED_CATALOG.filter((card) => card.sets.length > 0)
        .map((card) => card.id)
        .sort(),
    );
  });

  it("moves the cards and the ordered pool of stored matches to sets", async () => {
    const client = await getTestDatabase();
    const bySet = KESSEN_SEED_CATALOG.filter((card) => card.sets.length > 0);
    const plain = KESSEN_SEED_CATALOG.filter((card) => card.sets.length === 0).slice(
      0,
      4,
    );
    // Pools keep their stored order, which is not the id order.
    const first = [...plain, ...bySet].reverse();
    const second = [...bySet.slice(2), ...plain.slice(1)];
    const current = {
      engine: {
        cards: Object.fromEntries(bySet.map((card) => [card.id, card])),
      },
      pool: bySet,
    };
    await client
      .insert(kessenMatch)
      .values([
        matchRow("legacy-a", legacyState(first)),
        matchRow("legacy-b", legacyState(second)),
        matchRow("current", current),
      ]);
    await runRawSql(migration);
    // A second run changes nothing.
    await runRawSql(migration);
    const stateOf = async (id: string) => {
      const [row] = await client
        .select()
        .from(kessenMatch)
        .where(eq(kessenMatch.id, id));
      return row?.state;
    };
    for (const [id, cards] of [
      ["legacy-a", first],
      ["legacy-b", second],
    ] as const) {
      expect(await stateOf(id)).toEqual({
        engine: {
          step: 7,
          cards: Object.fromEntries(cards.map((card) => [card.id, card])),
        },
        mode: "standard",
        pool: cards,
        plays: [2, 1],
      });
    }
    expect(await stateOf("current")).toEqual(current);
  });

  it("preserves seven affiliations including case and accent differences", async () => {
    const client = await getTestDatabase();
    const base = KESSEN_SEED_CATALOG[0];
    if (!base) throw new Error("No seed card");
    // The engine matches set names exactly, even when MySQL's default collation does not.
    const summonGroups = ["Crew", "crew", "Crëw"];
    const bonds = ["CREW", "Crèw", "Bond C", "Bond D"];
    const sets = [...summonGroups, ...bonds];
    const card: KessenCard = {
      ...base,
      abilities: bonds.map((group) => ({ k: "bond", group })),
      sets,
    };
    const { sets: _sets, ...data } = kessenCardToCardData(card);
    await client
      .update(item)
      .set({
        cardData: sql`CAST(${JSON.stringify({ ...data, summonGroups })} AS JSON)`,
      })
      .where(eq(item.id, card.id));
    await client
      .insert(kessenMatch)
      .values(matchRow("custom-sets", legacyState([card])));

    await runRawSql(migration);

    const [saved] = await client.select().from(item).where(eq(item.id, card.id));
    expect(saved).toBeDefined();
    if (!saved) throw new Error("Missing migrated card");
    const migrated = itemToKessenCard(saved);
    expect(migrated?.sets.slice().sort()).toEqual(sets.slice().sort());
    expect(migrated?.abilities).toEqual(card.abilities);
    const [match] = await client
      .select()
      .from(kessenMatch)
      .where(eq(kessenMatch.id, "custom-sets"));
    const expected = { ...card, sets: expect.arrayContaining(sets) };
    expect(match?.state).toEqual({
      engine: { step: 7, cards: { [card.id]: expected } },
      mode: "standard",
      pool: [expected],
      plays: [2, 1],
    });
  });
});
