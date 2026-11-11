import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  raidParticipation,
  userData,
} from "@/drizzle/schema";
import {
  claimBattleQueue,
  deleteLeavingRaidQueueMember,
  deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  insertMpvpBattleUserForJoinRaidQueue,
  listMpvpBattleQueueForCheckAndCleanupExpiredRaid,
  listQuestForGetCompletedRaids,
  listQueueMembers,
  updateMpvpBattleQueueForStartRaidBattle,
} from "@/queries/raids";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { insertQuests, insertUsers } from "../setup/factories";
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
    await resetTables(
      raidParticipation,
      mpvpBattleUser,
      mpvpBattleQueue,
      quest,
      userData,
    );
  });

  it("allocates slots against the raid lobby snapshot and rejects admission after a claim", async () => {
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values([
      {
        id: "wide-raid-team",
        battleType: "RAID_BATTLE",
        attackerEntityId: "raid",
        defenderEntityId: "boss",
        raidMaxPlayers: 8,
      },
      {
        id: "closed-raid-team",
        battleType: "RAID_BATTLE",
        attackerEntityId: "raid",
        defenderEntityId: "boss",
        createdAt: hourAgo,
      },
    ]);
    const join = (teamId: string, userId: string) =>
      retryOnDeadlock(() =>
        insertMpvpBattleUserForJoinRaidQueue(db, teamId, { userId }),
      )
        .then((result) => result.rowsAffected)
        .catch((error: unknown) => {
          if (isMysqlDuplicateKeyError(error)) return 0;
          throw error;
        });
    for (let i = 0; i < 7; i++) {
      expect(await join("wide-raid-team", `raid-player-${i}`)).toBe(1);
    }
    const finalSeat = await Promise.all([
      join("wide-raid-team", "final-seat-a"),
      join("wide-raid-team", "final-seat-b"),
    ]);
    expect(finalSeat.sort()).toEqual([0, 1]);
    const roster = await listQueueMembers(db, "wide-raid-team");
    expect(roster.map((member) => member.slot).sort()).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(await join("wide-raid-team", "overflow-player")).toBe(0);

    expect(await join("closed-raid-team", "raid-starter")).toBe(1);
    expect(
      (await claimBattleQueue(db, "claiming-test", "closed-raid-team", new Date()))
        .rowsAffected,
    ).toBe(1);
    expect(
      (
        await updateMpvpBattleQueueForStartRaidBattle(db, {
          teamId: "closed-raid-team",
        })
      ).rowsAffected,
    ).toBe(0);
    expect(await join("closed-raid-team", "late-player")).toBe(0);
    const [starter] = await listQueueMembers(db, "closed-raid-team");
    await insertUsers([
      { userId: "raid-starter", status: "BATTLE", battleId: "raid-battle" },
    ]);
    expect((await deleteLeavingRaidQueueMember(db, starter!.id)).rowsAffected).toBe(0);
    await db
      .update(userData)
      .set({ status: "QUEUED", battleId: null })
      .where(eq(userData.userId, "raid-starter"));
    expect((await deleteLeavingRaidQueueMember(db, starter!.id)).rowsAffected).toBe(1);
    expect(await join("closed-raid-team", "late-player")).toBe(0);
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
