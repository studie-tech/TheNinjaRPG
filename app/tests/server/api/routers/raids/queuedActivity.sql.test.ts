import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  rankedPvpQueue,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { raidsRouter } from "@/server/api/routers/raids";
import { dungeonBattleState } from "../../../../setup/dungeon";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { resetServerModuleStubs } from "../../../../setup/serverModules";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

type BattleType = typeof mpvpBattleQueue.$inferInsert.battleType;

describeWithDatabase("queued activity", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      caravanParticipant,
      dungeonMember,
      dungeonRun,
      mpvpBattleQueue,
      mpvpBattleUser,
      quest,
      rankedPvpQueue,
      userData,
    );
    await insertUsers([{ userId: "queued", status: "QUEUED", sector: 7 }]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  const seat = async (battleType?: BattleType) => {
    const db = await getTestDatabase();
    await db.insert(mpvpBattleUser).values({
      id: "seat",
      clanBattleId: "lobby",
      userId: "queued",
      side: "ATTACKER",
      slot: 0,
    });
    if (battleType)
      await db.insert(mpvpBattleQueue).values({
        id: "lobby",
        battleType,
        attackerEntityId: "raid",
        defenderEntityId: "raid",
        sector: 7,
      });
  };
  const read = async () => (await callerFor(raidsRouter, "queued")).getQueuedActivity();

  it.each([
    ["RAID_BATTLE", { kind: "RAID", sector: 7 }],
    ["SHRINE_BATTLE", { kind: "SHRINE", lobbyId: "lobby", sector: 7 }],
    ["CLAN_BATTLE", { kind: "CLAN", lobbyId: "lobby" }],
    ["TERRITORY_WAR", { kind: "TERRITORY", lobbyId: "lobby" }],
  ] as const)("names a %s lobby", async (battleType, expected) => {
    await seat(battleType);
    expect(await read()).toEqual(expected);
  });

  it("names ranked, dungeon and caravan holds, and reports none", async () => {
    const db = await getTestDatabase();
    expect(await read()).toEqual({ kind: "UNKNOWN" });
    await db
      .insert(rankedPvpQueue)
      .values({ id: "ranked", userId: "queued", rankedLp: 1, hasClaimed: true });
    expect(await read()).toEqual({ kind: "RANKED" });
    await db.insert(caravanParticipant).values({
      caravanId: "caravan",
      userId: "queued",
      activeUserId: "queued",
      role: "GUARD",
      joinedAt: new Date(),
    });
    expect(await read()).toEqual({ kind: "CARAVAN" });
    const party = dungeonBattleState();
    await db.insert(dungeonRun).values({
      id: party.runId,
      dungeonId: party.dungeonId,
      leaderId: "queued",
      content: party.content,
      state: { ...party.runState, memberIds: ["queued"] },
      status: "LOBBY",
      createdAt: new Date(),
    });
    await db.insert(dungeonMember).values({
      runId: party.runId,
      userId: "queued",
      activeUserId: "queued",
    });
    expect(await read()).toEqual({ kind: "DUNGEON" });
    for (const status of ["COMPLETED", "ENDED"] as const) {
      await db.update(dungeonRun).set({ status }).where(eq(dungeonRun.id, party.runId));
      expect(await read()).toEqual({ kind: "CARAVAN" });
    }
  });

  it.each(["ended", "defeated", "hidden", "deleted", "orphaned"])(
    "offers a working exit when the raid is %s",
    async (state) => {
      const db = await getTestDatabase();
      await seat(state === "orphaned" ? undefined : "RAID_BATTLE");
      if (state !== "deleted")
        await insertQuests([
          {
            id: "raid",
            questType: "raid",
            hidden: state === "hidden",
            raidEndsAt: new Date(Date.now() + (state === "ended" ? -1000 : 60000)),
            raidBossCurrentHealth: state === "defeated" ? 0 : 100,
          },
        ]);
      expect((await read()).kind).toBe("RAID");
      const result = await (await callerFor(raidsRouter, "queued")).leaveRaidQueue();
      expect(result.success).toBe(true);
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "queued") }),
      ).toMatchObject({ status: "AWAKE" });
      expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
      expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
      expect(await read()).toEqual({ kind: "UNKNOWN" });
    },
  );
});
