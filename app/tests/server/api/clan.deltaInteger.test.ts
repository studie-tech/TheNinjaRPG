// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, clan, userData } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("clan donation integer treasury projection", () => {
  beforeEach(async () => {
    await resetTables(actionLog, clan, userData);
    await insertUsers([
      {
        userId: "fractional-donor",
        clanId: "fractional-faction",
        reputationPoints: 100,
        isOutlaw: true,
      },
    ]);
    const database = await getTestDatabase();
    await database
      .insert(clan)
      .values({
        id: "fractional-faction",
        name: "Fractional Faction",
        image: "/clan.png",
        founderId: "fractional-donor",
        leaderId: "fractional-donor",
        leaderOrderId: "fractional-order",
        villageId: "fractional-village",
        repTreasury: 0,
      });
  });

  it.each([0.4, 0.5, 1.5])(
    "projects fractional donation %s after an independent integer treasury grant",
    async (donation) => {
      const database = await getTestDatabase();
      const raced = beforeStatements(database, clan, [
        async () =>
          database
            .update(clan)
            .set({ repTreasury: sql`${clan.repTreasury} + 3` })
            .where(eq(clan.id, "fractional-faction")),
      ]);
      const api = callerForDatabase(clanRouter, "fractional-donor", raced);
      const result = await api.clanDonate({
        clanId: "fractional-faction",
        reputationPoints: donation,
      });
      const [storedUser, storedClan] = await Promise.all([
        database.query.userData.findFirst({
          where: eq(userData.userId, "fractional-donor"),
        }),
        database.query.clan.findFirst({ where: eq(clan.id, "fractional-faction") }),
      ]);
      expect(result.success).toBe(true);
      expect(storedUser?.reputationPoints).toBeCloseTo(100 - donation);
      expect(storedClan?.repTreasury).toBe(3 + Math.round(donation));
      expect(result.userDelta?.reputationPoints).toBe(-donation);
      expect(result.userDelta?.clan?.repTreasury).toBe(
        (storedClan?.repTreasury ?? 0) - 3,
      );
    },
  );
});
