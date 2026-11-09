import { beforeEach, expect, it } from "bun:test";
import { mpvpBattleQueue, quest, raidParticipation } from "@/drizzle/schema";
import {
  deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  listMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  listQuestForGetCompletedRaids,
} from "@/queries/raids";
import { insertQuests } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const now = new Date();
const hourAgo = new Date(now.getTime() - 3_600_000);
const inAnHour = new Date(now.getTime() + 3_600_000);

/** Raid teams without a live battle and finished raids, as the raid queries select them. */
describeWithDatabase("raid queries", () => {
  beforeEach(async () => {
    await resetTables(raidParticipation, mpvpBattleQueue, quest);
  });

  it("selects and clears only raid teams that are open or held by a start claim", async () => {
    const db = await getTestDatabase();
    const team = (id: string, battleId: string | null, attackerEntityId = "raid") => ({
      id,
      battleId,
      battleType: "RAID_BATTLE" as const,
      attackerEntityId,
      defenderEntityId: "boss",
    });
    await db
      .insert(mpvpBattleQueue)
      .values([
        team("open", null),
        team("claimed", "claiming-team"),
        team("fighting", "battle-1"),
        team("elsewhere", null, "other-raid"),
      ]);
    const listed = await listMpvpBattleQueueForCheckAndCleanupExpiredRaid(db, "raid");
    expect(listed.map((row) => row.id).sort()).toEqual(["claimed", "open"]);
    await deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid(db, "raid");
    const remaining = await db.select({ id: mpvpBattleQueue.id }).from(mpvpBattleQueue);
    expect(remaining.map((row) => row.id).sort()).toEqual(["elsewhere", "fighting"]);
  });

  it("lists raids that ended or whose boss fell", async () => {
    const raid = {
      questType: "raid" as const,
      hidden: false,
      raidBossCurrentHealth: 100,
    };
    await insertQuests([
      { id: "ended", ...raid, raidEndsAt: hourAgo },
      { id: "defeated", ...raid, raidEndsAt: inAnHour, raidBossCurrentHealth: 0 },
      { id: "running", ...raid, raidEndsAt: inAnHour },
      { id: "hidden", ...raid, hidden: true, raidEndsAt: hourAgo },
    ]);
    const rows = await listQuestForGetCompletedRaids(
      await getTestDatabase(),
      now,
      { userId: "player" },
      10,
    );
    expect(rows.map((row) => row.id).sort()).toEqual(["defeated", "ended"]);
  });
});
