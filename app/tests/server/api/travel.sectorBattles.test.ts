
import { beforeEach, expect, it } from "bun:test";
import { battle, overworldAiPlacement, sector, userData, village, war } from "@/drizzle/schema";
import { SECTOR_BATTLE_STALE_SECONDS } from "@/libs/travel";
import { travelRouter } from "@/server/api/routers/travel";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const SECTOR = 42;
const VIEWER = "sector-viewer";

const insertBattle = async (id: string, updatedAt: Date) => {
  const database = await getTestDatabase();
  await database.insert(battle).values({
    id,
    updatedAt,
    background: "ground",
    battleType: "COMBAT",
    usersState: [],
    usersEffects: [],
    groundEffects: [],
    extraState: {} as never,
  });
};

describeWithDatabase("travel.getSectorData battle markers", () => {
  beforeEach(async () => {
    await resetTables(userData, battle, village, sector, war, overworldAiPlacement);
    await insertUsers([
      { userId: VIEWER, username: "Viewer", status: "AWAKE", sector: SECTOR },
      // Fight still being played
      { userId: "live-fighter", username: "Live", status: "BATTLE", battleId: "live", sector: SECTOR },
      // Knocked out and never returned to settle: battle row frozen
      { userId: "abandoned-fighter", username: "Abandoned", status: "BATTLE", battleId: "abandoned", sector: SECTOR },
      // Battle row already deleted, status not yet cleaned up by the cron
      { userId: "orphaned-fighter", username: "Orphaned", status: "BATTLE", battleId: "deleted", sector: SECTOR },
    ]);
    await insertBattle("live", new Date());
    await insertBattle(
      "abandoned",
      new Date(Date.now() - (SECTOR_BATTLE_STALE_SECONDS + 60) * 1000),
    );
  });

  it("only returns fighters whose battle exists and is still being played", async () => {
    const api = await callerFor(travelRouter, VIEWER);
    const result = await api.getSectorData({ sector: SECTOR });
    expect(result.users.map((u) => u.userId).sort()).toEqual(["live-fighter", VIEWER].sort());
  });
});
