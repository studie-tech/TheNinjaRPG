import { beforeEach, expect, it } from "bun:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { jutsu } from "@/drizzle/schema";
import { jutsuDatabaseFilter } from "@/server/api/routers/jutsu";
import type { JutsuFilteringSchema } from "@/validators/jutsu";
import { insertJutsus, jutsuRow } from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const matching = async (input: Partial<JutsuFilteringSchema>) => {
  const db = await getTestDatabase();
  const rows = await db
    .select({ id: jutsu.id })
    .from(jutsu)
    .where(and(...jutsuDatabaseFilter({ limit: 50, ...input } as JutsuFilteringSchema)))
    .orderBy(asc(jutsu.id));
  return rows.map((row) => row.id);
};

/** Jutsu list filters: case-insensitive names and exclusions that drop every listed value. */
describeWithDatabase("jutsuDatabaseFilter", () => {
  beforeEach(async () => {
    await resetTables(jutsu);
    await insertJutsus([
      jutsuRow("fire", {
        name: "Great Fireball",
        jutsuType: "NORMAL",
        statClassification: "Ninjutsu",
        requiredRank: "GENIN",
        method: "SINGLE",
        target: "OPPONENT",
      }),
      jutsuRow("water", {
        name: "Water Wall",
        jutsuType: "CLAN",
        statClassification: "Genjutsu",
        requiredRank: "CHUNIN",
        method: "AOE_WALL_SHOOT",
        target: "GROUND",
      }),
      jutsuRow("pet", {
        name: "Pet Pounce",
        jutsuType: "PETS",
        statClassification: null,
        requiredRank: "JONIN",
        method: "COORDINATES",
        target: "CHARACTER",
      }),
      jutsuRow("hidden", { name: "Hidden Fire", hidden: true }),
    ]);
  });

  it("matches names regardless of case and hides hidden jutsu", async () => {
    expect(await matching({ name: "fire" })).toEqual(["fire"]);
    expect(await matching({ name: "WATER" })).toEqual(["water"]);
  });

  it("matches the name of a joined parent expression regardless of case", async () => {
    const db = await getTestDatabase();
    const parent = alias(jutsu, "parent");
    const rows = await db
      .select({ id: jutsu.id })
      .from(jutsu)
      .leftJoin(parent, eq(parent.id, "water"))
      .where(
        and(
          ...jutsuDatabaseFilter(
            { limit: 50, name: "wall" } as JutsuFilteringSchema,
            false,
            sql`${parent.name}`,
          ),
        ),
      )
      .orderBy(asc(jutsu.id));
    expect(rows.map((row) => row.id)).toEqual(["fire", "pet", "water"]);
  });

  it("drops every excluded value, including types and methods outside the old literal lists", async () => {
    expect(await matching({ excludedJutsuTypes: ["CLAN", "PETS"] })).toEqual(["fire"]);
    expect(
      await matching({ excludedMethods: ["AOE_WALL_SHOOT", "COORDINATES"] }),
    ).toEqual(["fire"]);
    expect(await matching({ excludedTargets: ["OPPONENT"] })).toEqual(["pet", "water"]);
    expect(await matching({ excludedRanks: ["GENIN", "JONIN"] })).toEqual(["water"]);
  });

  it("drops jutsu without a classification once any classification is excluded", async () => {
    expect(await matching({ excludedClassifications: ["Genjutsu"] })).toEqual(["fire"]);
  });
});
