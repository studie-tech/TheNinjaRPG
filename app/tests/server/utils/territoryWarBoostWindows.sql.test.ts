import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { Client } from "@planetscale/database";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { drizzle as planetScaleDrizzle } from "drizzle-orm/planetscale-serverless";
import mysql from "mysql2/promise";
import { TERRITORY_WAR_BOOST_PERCENT, TERRITORY_WAR_TARGET_POINTS, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import * as schema from "@/drizzle/schema";
import { clan, notification, territoryWar, territoryWarScore, userData, village } from "@/drizzle/schema";
import { getTerritoryWarBoost, getTerritoryWarPeriodBoost } from "@/libs/territoryWar";
import { resolveTerritoryWar, territoryWarBoostWindowsSql } from "@/server/utils/territoryWar";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const activityStart = new Date("2026-01-01T10:00:00.000Z");
const victory = new Date("2026-01-01T11:00:00.000Z");
const checkAt = new Date("2026-01-01T11:30:00.000Z");
const boost = TERRITORY_WAR_BOOST_PERCENT / 100;
const subjects = [
  { userId: "citizen-winner", villageId: "winning-village", isOutlaw: false, clanId: null },
  { userId: "citizen-other", villageId: "other-village", isOutlaw: false, clanId: null },
  { userId: "outlaw-winner", villageId: VILLAGE_SYNDICATE_ID, isOutlaw: true, clanId: "winning-clan" },
  { userId: "outlaw-other", villageId: VILLAGE_SYNDICATE_ID, isOutlaw: true, clanId: "other-clan" },
  { userId: "outlaw-clanless", villageId: VILLAGE_SYNDICATE_ID, isOutlaw: true, clanId: null },
] as const;

// Production's subquery relations rewrite extras differently from default-mode lateral joins.
const createReadDatabase = (pool: mysql.Pool) => drizzle(pool, { schema, mode: "planetscale" });
// Generate the actual production adapter's SQL without ever making a network request.
const productionDatabase = planetScaleDrizzle(new Client({
  host: "unused.invalid", username: "unused", password: "unused",
  fetch: async () => { throw new Error("SQL generation must not access a network"); },
}), { schema });

describeWithDatabase("Territory War bonus history competitor scope", () => {
  let pool: mysql.Pool;
  let readDatabase: ReturnType<typeof createReadDatabase>;
  beforeAll(() => {
    pool = mysql.createPool({ uri: process.env.TEST_MYSQL_URL });
    readDatabase = createReadDatabase(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await resetTables(territoryWarScore, territoryWar, notification, clan, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "winning-village", name: "Winning Village", kageId: "guardian", sector: 1 },
      { id: "other-village", name: "Other Village", kageId: "guardian", sector: 2 },
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", kageId: "guardian", sector: 3 },
    ]);
    await db.insert(clan).values(["winning-clan", "other-clan"].map(id => ({ id, name: id, image: "image", villageId: VILLAGE_SYNDICATE_ID, founderId: "guardian", leaderId: "guardian", leaderOrderId: "guardian" })));
    await insertUsers([{ userId: "guardian", isAi: true }, ...subjects.map(subject => ({ ...subject, username: subject.userId, regenAt: activityStart }))]);
  });

  const seedWinner = async (kind: "village" | "clan" | "syndicate") => {
    const db = await getTestDatabase();
    const scope = kind === "clan"
      ? { competitorId: "clan:winning-clan", clanId: "winning-clan", villageId: null }
      : { competitorId: `village:${kind === "syndicate" ? VILLAGE_SYNDICATE_ID : "winning-village"}`, clanId: null, villageId: kind === "syndicate" ? VILLAGE_SYNDICATE_ID : "winning-village" };
    await db.insert(territoryWar).values({ id: "scope-event", predecessorId: "initial", sector: 100, guardianId: "guardian", startsAt: activityStart, endsAt: checkAt });
    await db.insert(territoryWarScore).values({ warId: "scope-event", name: "Winner", points: TERRITORY_WAR_TARGET_POINTS, ...scope });
    await resolveTerritoryWar(db, "scope-event", victory);
    expect((await db.query.territoryWarScore.findFirst())?.rewarded).toBe(true);
  };
  const readSubject = async (userId: string, since?: Date) => {
    const config = {
      where: eq(userData.userId, userId),
      with: { village: true, clan: true } as const,
      extras: (table: Parameters<typeof territoryWarBoostWindowsSql>[0]) => ({ territoryWarBoostWindows: territoryWarBoostWindowsSql(table, since).as("territoryWarBoostWindows") }),
    };
    const query = readDatabase.query.userData.findFirst(config);
    expect(query.toSQL()).toEqual(productionDatabase.query.userData.findFirst(config).toSQL());
    return (await query)!;
  };

  it.each([
    ["village", "citizen-winner", 1], ["village", "citizen-other", 0],
    ["clan", "outlaw-winner", 1], ["clan", "outlaw-other", 0],
    ["clan", "outlaw-clanless", 0], ["syndicate", "outlaw-clanless", 1],
    ["syndicate", "outlaw-other", 0], ["clan", "citizen-other", 0],
  ] as const)("%s victory gives %s %s history window(s)", async (kind, userId, expected) => {
    await seedWinner(kind);
    const user = await readSubject(userId);
    expect(user.territoryWarBoostWindows).toHaveLength(expected);
    expect(getTerritoryWarBoost(user, checkAt)).toBe(expected ? boost : 0);
    expect(getTerritoryWarPeriodBoost(user, victory, checkAt)).toBe(expected ? boost : 0);
  });

  it("preserves competitor scope in the combat findMany preload", async () => {
    await seedWinner("village");
    const users = await readDatabase.query.userData.findMany({
      with: { village: true, clan: true },
      extras: table => ({ territoryWarBoostWindows: territoryWarBoostWindowsSql(table).as("territoryWarBoostWindows") }),
    });
    expect(users.find(user => user.userId === "citizen-winner")?.territoryWarBoostWindows).toHaveLength(1);
    expect(users.find(user => user.userId === "citizen-other")?.territoryWarBoostWindows).toHaveLength(0);
  });

  it("uses queued work's earlier start without broadening competitor scope", async () => {
    await seedWinner("village");
    const db = await getTestDatabase();
    await db.update(userData).set({ regenAt: new Date(checkAt.getTime() + 3600000) });
    expect((await readSubject("citizen-winner")).territoryWarBoostWindows).toHaveLength(0);
    expect((await readSubject("citizen-winner", victory)).territoryWarBoostWindows).toHaveLength(1);
    expect((await readSubject("citizen-other", victory)).territoryWarBoostWindows).toHaveLength(0);
  });
});
