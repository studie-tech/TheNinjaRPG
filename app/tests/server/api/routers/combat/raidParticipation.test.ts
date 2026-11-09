import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  notification,
  quest,
  raidParticipation,
  userData,
} from "@/drizzle/schema";
import { updateRaidProgress } from "@/libs/combat/database";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import {
  insertDefaultAiProfile,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const raidId = "snapshot-raid";

describeWithDatabase("raid participation battle snapshots", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battleHistory,
      battle,
      aiProfile,
      notification,
      raidParticipation,
      quest,
      userData,
    );
    await insertUsers([
      { userId: "human", username: "Human", rank: "GENIN", level: 5, status: "QUEUED" },
      {
        userId: "enemy",
        username: "Boss",
        rank: "GENIN",
        level: 5,
        status: "AWAKE",
        isAi: true,
        inArena: true,
      },
    ]);
    await insertQuests([
      {
        id: raidId,
        questType: "raid",
        raidBossCurrentHealth: 1000,
        raidBossMaxHealth: 1000,
      },
    ]);
    await insertDefaultAiProfile();
  }, 60_000);
  afterEach(() => vi.restoreAllMocks());

  it("preloads and persists only current participants from a raid with 10,000 historical participants", async () => {
    const database = await getTestDatabase();
    const history = Array.from({ length: 10_000 }, (_, index) => ({
      id: `participation-${index}`,
      questId: raidId,
      userId: index === 0 ? "human" : `unrelated-${index}`,
      battleCount: index + 1,
    }));
    for (let offset = 0; offset < history.length; offset += 1000) {
      await database
        .insert(raidParticipation)
        .values(history.slice(offset, offset + 1000));
    }

    const { result, statements } = await recordQueries(() =>
      initiateBattle(
        {
          client: database,
          userIds: ["human"],
          targetIds: ["enemy"],
          raidQuestId: raidId,
        },
        "RAID",
      ),
    );
    expect(result.success, result.message).toBe(true);
    const saved = (await database.query.battle.findFirst({
      where: eq(battle.id, result.battleId!),
    }))!;
    expect(Object.keys(saved.extraState.raidStartBattleCount ?? {})).toHaveLength(1);
    expect(saved.extraState.raidStartBattleCount).toEqual({ human: 1 });
    expect(
      statements.filter((statement) => statement.includes("from `RaidParticipation`")),
    ).toHaveLength(1);
    expect(JSON.stringify(saved.extraState.raidStartBattleCount)).toHaveLength(11);
  }, 60_000);

  it("retains both teams' counts, scopes them to the raid, and settles new and returning participants once", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      {
        userId: "newcomer",
        username: "Newcomer",
        rank: "GENIN",
        level: 5,
        status: "QUEUED",
      },
      {
        userId: "defender",
        username: "Defender",
        rank: "GENIN",
        level: 5,
        status: "QUEUED",
      },
    ]);
    await database.insert(raidParticipation).values([
      {
        id: "returning",
        questId: raidId,
        userId: "human",
        battleCount: 7,
        damageDealt: 100,
      },
      {
        id: "defending",
        questId: raidId,
        userId: "defender",
        battleCount: 3,
        damageDealt: 50,
      },
      { id: "unrelated", questId: raidId, userId: "outsider", battleCount: 10 },
      { id: "other-raid", questId: "other-raid", userId: "human", battleCount: 99 },
    ]);
    const result = await initiateBattle(
      {
        client: database,
        userIds: ["human", "newcomer"],
        targetIds: ["enemy", "defender"],
        raidQuestId: raidId,
      },
      "RAID",
    );
    expect(result.success, result.message).toBe(true);
    const saved = (await database.query.battle.findFirst({
      where: eq(battle.id, result.battleId!),
    }))!;
    expect(saved.extraState.raidStartBattleCount).toEqual({ human: 7, defender: 3 });
    expect(saved.extraState.raidStartBattleCount?.newcomer).toBeUndefined();
    expect(saved.extraState.raidInitialBossHp).toBe(1000);
    saved.usersState.find((actor) => actor.isAi && !actor.isSummon)!.curHealth = 400;
    // Raid credit is capped at the damage the attackers actually dealt
    saved.usersState.find((actor) => actor.userId === "human")!.damageDealt = 600;

    for (const userId of ["human", "newcomer", "defender"]) {
      await Promise.all([
        updateRaidProgress(database, saved, userId),
        updateRaidProgress(database, saved, userId),
      ]);
    }

    const rows = await database.query.raidParticipation.findMany({
      where: eq(raidParticipation.questId, raidId),
    });
    expect(rows.find((row) => row.userId === "human")).toMatchObject({
      battleCount: 8,
      damageDealt: 300,
    });
    expect(rows.find((row) => row.userId === "defender")).toMatchObject({
      battleCount: 4,
      damageDealt: 250,
    });
    expect(rows.find((row) => row.userId === "newcomer")).toMatchObject({
      battleCount: 1,
      damageDealt: 200,
    });
    expect(rows.find((row) => row.userId === "outsider")).toMatchObject({
      battleCount: 10,
      damageDealt: 0,
    });
    expect(
      await database.query.quest.findFirst({ where: eq(quest.id, raidId) }),
    ).toMatchObject({ raidBossCurrentHealth: 400 });
    expect(
      await database.query.raidParticipation.findFirst({
        where: eq(raidParticipation.id, "other-raid"),
      }),
    ).toMatchObject({ battleCount: 99 });
  }, 60_000);

  it.each([
    { battleType: "ARENA" as const, raidQuestId: raidId },
    { battleType: "RAID" as const, raidQuestId: undefined },
  ])(
    "skips participation reads for $battleType with raid ID $raidQuestId",
    async ({ battleType, raidQuestId }) => {
      const database = await getTestDatabase();
      if (battleType !== "RAID") {
        await database.update(userData).set({ status: "AWAKE" });
      }
      const reads = vi.spyOn(database.query.raidParticipation, "findMany");
      const result = await initiateBattle(
        {
          client: database,
          userIds: ["human"],
          targetIds: ["enemy"],
          raidQuestId,
        },
        battleType,
      );
      expect(result.success, result.message).toBe(true);
      expect(reads).not.toHaveBeenCalled();
      const saved = (await database.query.battle.findFirst({
        where: eq(battle.id, result.battleId!),
      }))!;
      expect(saved.extraState.raidStartBattleCount).toEqual({});
    },
    60_000,
  );
});
