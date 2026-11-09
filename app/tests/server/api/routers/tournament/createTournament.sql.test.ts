import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { clan, tournament, userData } from "@/drizzle/schema";
import { tournamentRouter } from "@/server/api/routers/tournament";
import { insertUsers, insertClans } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const input = {
  id: "clan",
  name: "Clan cup",
  image: "/cup.webp",
  description: "A clan tournament",
  type: "CLAN" as const,
  rewards: {},
};

describeWithDatabase("Clan tournament prize funding", () => {
  beforeEach(async () => {
    await resetTables(clan, tournament, userData);
    await insertUsers([{ userId: "leader", username: "leader", clanId: "clan" }]);
    await insertClans([
      {
        id: "clan",
        name: "Clan",
        villageId: "village",
        leaderId: "leader",
        bank: 1000,
      },
    ]);
  });

  it("keeps a deposit made after the treasury was read", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, clan, [
      async () => {
        await db
          .update(clan)
          .set({ bank: sql`${clan.bank} + 500` })
          .where(eq(clan.id, "clan"));
      },
    ]);
    const result = await callerForDatabase(
      tournamentRouter,
      "leader",
      raced,
    ).createTournament(input);
    expect(result.success).toBe(true);
    const [treasury, created] = await Promise.all([
      db.query.clan.findFirst({ where: eq(clan.id, "clan") }),
      db.query.tournament.findFirst({ where: eq(tournament.id, "clan") }),
    ]);
    expect({ bank: treasury?.bank, prize: created?.rewards.reward_money }).toEqual({
      bank: 500,
      prize: 1000,
    });
  });

  it("does not create a tournament whose prize was spent after the treasury was read", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, clan, [
      async () => {
        await db
          .update(clan)
          .set({ bank: sql`${clan.bank} - 400` })
          .where(eq(clan.id, "clan"));
      },
    ]);
    const result = await callerForDatabase(
      tournamentRouter,
      "leader",
      raced,
    ).createTournament(input);
    expect(result.success).toBe(false);
    expect((await db.query.clan.findFirst({ where: eq(clan.id, "clan") }))?.bank).toBe(
      600,
    );
    expect(await db.query.tournament.findFirst()).toBeUndefined();
  });
});
