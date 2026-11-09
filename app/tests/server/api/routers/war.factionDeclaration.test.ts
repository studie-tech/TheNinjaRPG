import { fetchActiveWar, warRaidCombatGuard } from "@/queries/war";

import { and, eq, getTableName, inArray, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "bun:test";
import mysql from "mysql2/promise";
import { setTimeout } from "node:timers/promises";
import {
  ELDER_MIN_VOTING_COUNT,
  WAR_DECLARATION_COST,
  FACTION_RAID_COST,
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_MIN_MEMBERS,
  FACTION_RAID_REWARD,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
} from "@/drizzle/constants";
import {
  notification,
  clan,
  gameSetting,
  userData,
  village,
  villageAlliance,
  villageElderVote,
  villageElderVoteEntry,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { warRouter } from "@/routers/war";
import * as serverSentry from "@/server/utils/sentry";
import { applyVillageMissionShrineDamage } from "@/server/utils/villageMission";
import {
  startDeclaredWar,
  handleWarEnd,
  applyRaidHealthDecay,
} from "@/server/utils/war";
import { insertUsers, insertClans } from "../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  lockWaitObserved,
} from "../../../setup/testDatabase";
import { beforeTransaction } from "../../../setup/statements";

const FACTION = "faction-hideout";
const TARGET = "target-village";
const LEADER = "faction-leader";
const TARGET_KAGE = "target-kage";
const TOKENS = WAR_DECLARATION_COST * 2 + 500_000;

const declare = async (userId: string, userVillageId: string) =>
  (await callerFor(warRouter, userId)).declareVillageWarOrRaid({
    targetVillageId: TARGET,
    targetStructureRoute: "/traininggrounds",
    userVillageId,
  });

/**
 * A faction hideout led by LEADER and an enemy village, each with enough members and
 * tokens to go to war. Factions never get elders, so a faction's leader declares alone.
 */
const seedWorld = async (attackerType: "HIDEOUT" | "VILLAGE" = "HIDEOUT") => {
  const database = await getTestDatabase();
  await database.insert(village).values([
    {
      id: FACTION,
      name: "Akatsuki",
      sector: 101,
      kageId: LEADER,
      type: attackerType,
      tokens: TOKENS,
    },
    {
      id: TARGET,
      name: "Konoki",
      sector: 102,
      kageId: TARGET_KAGE,
      type: "VILLAGE",
      tokens: WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
    },
  ]);
  await database.insert(villageAlliance).values({
    id: "faction-target-enemies",
    villageIdA: FACTION,
    villageIdB: TARGET,
    status: "ENEMY",
  });
  if (attackerType === "HIDEOUT") {
    await insertClans([
      {
        id: "raiding-faction",
        name: "Raiding Faction",
        villageId: FACTION,
        leaderId: LEADER,
        hasHideout: true,
      },
    ]);
  }
  await database.insert(villageStructure).values([
    {
      id: "target-training",
      name: "Training Grounds",
      image: "/townhall.webp",
      villageId: TARGET,
      route: "/traininggrounds",
    },
    {
      id: "own-training",
      name: "Training Grounds",
      image: "/training.webp",
      villageId: FACTION,
      route: "/traininggrounds",
      trainBoostPerLvl: 2,
    },
  ] as never);
  const members = (villageId: string, prefix: string, outlaw: boolean) =>
    Array.from({ length: FACTION_RAID_MIN_MEMBERS }, (_, i) => ({
      userId: `${prefix}-${i}`,
      username: `${prefix}${i}`,
      villageId,
      isOutlaw: outlaw,
    }));
  const factionMembers = members(FACTION, "faction", attackerType === "HIDEOUT");
  const targetMembers = members(TARGET, "target", false);
  factionMembers[0] = {
    ...factionMembers[0]!,
    userId: LEADER,
    username: "FactionLeader",
  };
  targetMembers[0] = {
    ...targetMembers[0]!,
    userId: TARGET_KAGE,
    username: "TargetKage",
  };
  await insertUsers([
    ...factionMembers.map((member) => ({
      ...member,
      clanId: attackerType === "HIDEOUT" ? "raiding-faction" : null,
    })),
    ...targetMembers,
  ] as never);
};

/** The target's Town Hall and enough faction elders to vote on a declaration against it. */
const seedElderVote = async () => {
  const database = await getTestDatabase();
  await database.insert(villageStructure).values({
    id: "target-townhall",
    name: "Town Hall",
    image: "/townhall.webp",
    villageId: TARGET,
    route: "/townhall",
  });
  const elders = Array.from({ length: ELDER_MIN_VOTING_COUNT }, (_, index) => ({
    userId: `elder-${index}`,
    username: `Elder${index}`,
    villageId: FACTION,
    rank: "ELDER" as const,
  }));
  await insertUsers(elders);
  return elders;
};

const readFaction = async () => {
  const database = await getTestDatabase();
  const [row] = await database.select().from(village).where(eq(village.id, FACTION));
  return row;
};

describeWithDatabase("faction war declarations", () => {
  beforeEach(async () => {
    await resetTables(
      gameSetting,
      notification,
      clan,
      userData,
      village,
      villageAlliance,
      villageElderVote,
      villageElderVoteEntry,
      villageStructure,
      war,
      warAlly,
    );
  });

  it("starts the raid on the faction leader's declaration alone", async () => {
    await seedWorld();
    const result = await declare(LEADER, FACTION);
    expect(result.success).toBe(true);

    const database = await getTestDatabase();
    const wars = await database.select().from(war);
    expect(wars).toHaveLength(1);
    expect(wars[0]).toMatchObject({
      attackerVillageId: FACTION,
      defenderVillageId: TARGET,
      status: "ACTIVE",
      type: "WAR_RAID",
      targetStructureRoute: "/traininggrounds",
    });
    expect((await readFaction())?.tokens).toBe(TOKENS - FACTION_RAID_COST);
    expect(await database.select().from(villageElderVote)).toHaveLength(0);
    // One global feed row authored by the declaring leader; both leaders get an unread count.
    const announcements = await database.select().from(notification);
    expect(announcements.map((n) => n.userId)).toEqual([LEADER]);
    const leaders = await database
      .select({ userId: userData.userId, unread: userData.unreadNotifications })
      .from(userData)
      .where(inArray(userData.userId, [LEADER, TARGET_KAGE]));
    expect(leaders.map((l) => l.unread)).toEqual([1, 1]);
  });

  it("reports success when leader notifications fail after the war commits", async () => {
    await seedWorld();
    const database = await getTestDatabase();
    const failure = new Error("Notification storage unavailable");
    const report = vi.spyOn(serverSentry, "logError").mockImplementation(() => {});
    const failingNotifications = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "insert") {
          return ((table) => {
            if (getTableName(table) === getTableName(notification)) throw failure;
            return target.insert(table);
          }) as typeof database.insert;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    try {
      const result = await callerForDatabase(
        warRouter,
        LEADER,
        failingNotifications,
      ).declareVillageWarOrRaid({
        targetVillageId: TARGET,
        targetStructureRoute: "/traininggrounds",
        userVillageId: FACTION,
      });
      expect(result.success).toBe(true);
      expect(await database.select().from(war)).toHaveLength(1);
      expect((await readFaction())?.tokens).toBe(TOKENS - FACTION_RAID_COST);
      expect(report).toHaveBeenCalledWith(
        failure,
        "Failed to notify leaders about a started war",
        { attackerVillageId: FACTION, defenderVillageId: TARGET },
      );
    } finally {
      report.mockRestore();
    }
  });

  it("still refuses a faction member who is not the leader", async () => {
    await seedWorld();
    const result = await declare("faction-1", FACTION);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/only the leader/i);
    const database = await getTestDatabase();
    expect(await database.select().from(war)).toHaveLength(0);
    expect((await readFaction())?.tokens).toBe(TOKENS);
  });

  it("does not start a raid the faction cannot afford", async () => {
    await seedWorld();
    const database = await getTestDatabase();
    await database
      .update(village)
      .set({ tokens: FACTION_RAID_COST - 1 })
      .where(eq(village.id, FACTION));
    const result = await declare(LEADER, FACTION);
    expect(result.success).toBe(false);
    expect(await database.select().from(war)).toHaveLength(0);
  });

  it.each(["attacker", "defender"] as const)(
    "starts only one overlapping declaration sharing the %s",
    async (sharedSide) => {
      await seedWorld();
      const database = await getTestDatabase();
      await database.insert(village).values({
        id: "other-village",
        name: "Other",
        sector: 103,
        kageId: LEADER,
        tokens: TOKENS,
        type: "HIDEOUT",
      });
      await insertClans([
        {
          id: "other-faction",
          name: "Other Faction",
          villageId: "other-village",
          leaderId: LEADER,
          hasHideout: true,
        },
      ]);
      await insertUsers(
        Array.from({ length: FACTION_RAID_MIN_MEMBERS }, (_, i) => ({
          userId: `other-${i}`,
          username: `Other${i}`,
          villageId: "other-village",
          clanId: "other-faction",
          isOutlaw: true,
        })) as never,
      );
      await database.insert(villageStructure).values({
        id: "other-training",
        name: "Training Grounds",
        route: "/traininggrounds",
        image: "/training.webp",
        villageId: "other-village",
      });
      const declaration = {
        attackerVillageId: FACTION,
        attackerVillageName: "Akatsuki",
        defenderVillageId: TARGET,
        defenderVillageName: "Konoki",
        initiatedByUserId: LEADER,
        warType: "WAR_RAID" as const,
        targetStructureRoute: "/traininggrounds",
      };
      const results = await Promise.all([
        startDeclaredWar(database, declaration),
        startDeclaredWar(database, {
          ...declaration,
          ...(sharedSide === "attacker"
            ? { defenderVillageId: "other-village", defenderVillageName: "Other" }
            : { attackerVillageId: "other-village", attackerVillageName: "Other" }),
        }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await database.select().from(war)).toHaveLength(1);
      const balances = await database.select().from(village);
      const startingTokens = TOKENS * 2 + WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE;
      expect(balances.reduce((sum, row) => sum + row.tokens, 0)).toBe(
        startingTokens - FACTION_RAID_COST,
      );
    },
  );

  it("keeps requiring elders for a village declaration", async () => {
    await seedWorld("VILLAGE");
    const result = await declare(LEADER, FACTION);
    expect(result.success).toBe(false);
    expect(result.message).toContain(`${ELDER_MIN_VOTING_COUNT} elders`);
    const database = await getTestDatabase();
    expect(await database.select().from(war)).toHaveLength(0);
    expect((await readFaction())?.tokens).toBe(TOKENS);
  });

  it("charges a village declaration the configured objective-war cost", async () => {
    await seedWorld("VILLAGE");
    const database = await getTestDatabase();
    await seedElderVote();
    const declarationCost = TOKENS + 1;
    await database.insert(gameSetting).values([
      {
        id: "OBJECTIVE_WAR_enabled",
        name: "OBJECTIVE_WAR_enabled",
        time: new Date(),
        value: 1,
      },
      {
        id: "OBJECTIVE_WAR_declarationCost",
        name: "OBJECTIVE_WAR_declarationCost",
        time: new Date(),
        value: declarationCost,
      },
    ]);
    const result = await declare(LEADER, FACTION);
    expect(result).toMatchObject({
      success: false,
      message: `Your village needs ${declarationCost.toLocaleString()} tokens to declare war`,
    });
    expect(await database.select().from(villageElderVote)).toHaveLength(0);
  });

  it("preserves the Town Hall through a village declaration and elder approval", async () => {
    await seedWorld("VILLAGE");
    const database = await getTestDatabase();
    const elders = await seedElderVote();
    const result = await (await callerFor(warRouter, LEADER)).declareVillageWarOrRaid({
      userVillageId: FACTION,
      targetVillageId: TARGET,
      targetStructureRoute: "/townhall",
    });
    expect(result.success).toBe(true);
    const [vote] = await database.select().from(villageElderVote);
    expect(vote).toMatchObject({
      status: "PENDING",
      targetStructureRoute: "/townhall",
      warType: "VILLAGE_WAR",
    });
    const announcements = await database.select().from(notification);
    expect(announcements.map((n) => n.userId)).toEqual([LEADER]);
    const notified = await database
      .select({ unread: userData.unreadNotifications })
      .from(userData)
      .where(inArray(userData.userId, [LEADER, ...elders.map((e) => e.userId)]));
    expect(notified.every((row) => row.unread === 1)).toBe(true);
    for (const elder of elders.slice(0, Math.floor(elders.length / 2) + 1)) {
      const voted = await (
        await callerFor(warRouter, elder.userId)
      ).voteOnWarDeclaration({
        voteId: vote!.id,
        userVillageId: FACTION,
        vote: "YES",
      });
      expect(voted.success).toBe(true);
    }
    const wars = await database.select().from(war);
    expect(wars).toHaveLength(1);
    expect(wars[0]).toMatchObject({
      status: "ACTIVE",
      type: "VILLAGE_WAR",
      targetStructureRoute: "/townhall",
    });
    expect((await readFaction())?.tokens).toBe(TOKENS - WAR_DECLARATION_COST);
  });
  it("releases the approved vote back to pending when the war start throws", async () => {
    await seedWorld("VILLAGE");
    const database = await getTestDatabase();
    const elders = await seedElderVote();
    await (await callerFor(warRouter, LEADER)).declareVillageWarOrRaid({
      userVillageId: FACTION,
      targetVillageId: TARGET,
      targetStructureRoute: "/townhall",
    });
    const [vote] = await database.select().from(villageElderVote);
    const majority = elders.slice(0, Math.floor(elders.length / 2) + 1);
    for (const elder of majority.slice(0, -1)) {
      await (await callerFor(warRouter, elder.userId)).voteOnWarDeclaration({
        voteId: vote!.id,
        userVillageId: FACTION,
        vote: "YES",
      });
    }
    // Simulate the driver rejecting the war-start transaction after the vote is claimed.
    const failingTransactions = beforeTransaction(database, () => {
      throw new Error("transaction in use");
    });
    await expect(
      callerForDatabase(
        warRouter,
        majority.at(-1)!.userId,
        failingTransactions,
      ).voteOnWarDeclaration({
        voteId: vote!.id,
        userVillageId: FACTION,
        vote: "YES",
      }),
    ).rejects.toThrow();
    const [after] = await database
      .select()
      .from(villageElderVote)
      .where(eq(villageElderVote.id, vote!.id));
    expect(after?.status).toBe("PENDING");
    expect(await database.select().from(war)).toHaveLength(0);
    expect((await readFaction())?.tokens).toBe(TOKENS);
  });
  it("requires 20 raiders and rejects unsupported structures without charging", async () => {
    await seedWorld();
    const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId, "faction-19"));
    expect((await declare(LEADER, FACTION)).message).toContain("20 members");
    expect((await readFaction())?.tokens).toBe(TOKENS);
    const result = await (await callerFor(warRouter, LEADER)).declareVillageWarOrRaid({
      userVillageId: FACTION,
      targetVillageId: TARGET,
      targetStructureRoute: "/townhall",
    });
    expect(result.success).toBe(false);
  });

  it("excludes unaffiliated residents and AI members from every raid membership gate", async () => {
    await seedWorld();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ clanId: null })
      .where(eq(userData.userId, "faction-19"));
    await insertUsers([
      {
        userId: "ai-raider",
        username: "AiRaider",
        villageId: FACTION,
        clanId: "raiding-faction",
        isAi: true,
      },
    ]);
    const caller = await callerFor(warRouter, LEADER);
    expect(
      (
        await caller.getRaidOptions({ userVillageId: FACTION, targetVillageId: TARGET })
      ).every((option) => option.block?.includes("20 members")),
    ).toBe(true);
    expect((await declare(LEADER, FACTION)).message).toContain("20 members");
    expect(
      await startDeclaredWar(db, {
        attackerVillageId: FACTION,
        attackerVillageName: "Akatsuki",
        defenderVillageId: TARGET,
        defenderVillageName: "Konoki",
        initiatedByUserId: LEADER,
        warType: "WAR_RAID",
        targetStructureRoute: "/traininggrounds",
      }),
    ).toBe(false);
    expect(await db.select().from(war)).toHaveLength(0);
    expect((await readFaction())?.tokens).toBe(TOKENS);
    await db
      .update(userData)
      .set({ clanId: "raiding-faction" })
      .where(eq(userData.userId, "faction-19"));
    expect((await declare(LEADER, FACTION)).success).toBe(true);
  });

  it("pays an attacking victory exactly once with no ordinary war effects", async () => {
    await seedWorld();
    await declare(LEADER, FACTION);
    const db = await getTestDatabase();
    const [raid] = await db.select().from(war);
    expect(raid).toMatchObject({ attackerWarHealth: 2000, defenderWarHealth: 2000 });
    await db.update(war).set({ defenderWarHealth: 0 }).where(eq(war.id, raid!.id));
    const active = (await fetchActiveWar(db, raid!.id))!;
    await Promise.all([handleWarEnd(active, db), handleWarEnd(active, db)]);
    expect((await readFaction())?.tokens).toBe(
      TOKENS - FACTION_RAID_COST + FACTION_RAID_REWARD,
    );
    expect((await readFaction())?.warExhaustionEndedAt).toBeNull();
    const structures = await db.select().from(villageStructure);
    expect(
      structures.find((row) => row.villageId === FACTION)?.raidBoostExpiresAt,
    ).toBeInstanceOf(Date);
    expect(
      structures.find((row) => row.villageId === TARGET)?.raidProtectedUntil,
    ).toBeInstanceOf(Date);
    expect(structures.every((row) => row.temporaryLevelBonus === 0)).toBe(true);
    expect((await declare(LEADER, FACTION)).success).toBe(false);
  });

  it("times out in favor of the defender without draining treasuries and blocks the pair for 72 hours", async () => {
    await seedWorld();
    await declare(LEADER, FACTION);
    const db = await getTestDatabase();
    const [raid] = await db.select().from(war);
    await db
      .update(war)
      .set({
        startedAt: new Date(Date.now() - 49 * 3600_000),
        attackerWarHealth: 1900,
        defenderWarHealth: 100,
      })
      .where(eq(war.id, raid!.id));
    const lateHit = await db
      .update(war)
      .set({ defenderWarHealth: 0 })
      .where(and(eq(war.id, raid!.id), warRaidCombatGuard()));
    expect(lateHit.rowsAffected).toBe(0);
    await (await callerFor(warRouter, LEADER)).getActiveWars({ villageId: FACTION });
    const [ended] = await db.select().from(war);
    expect(ended?.status).toBe("DEFENDER_VICTORY");
    expect((await readFaction())?.tokens).toBe(TOKENS - FACTION_RAID_COST);
    expect((await readFaction())?.raidRetryCooldowns[TARGET]).toBeDefined();
    expect((await readFaction())?.warExhaustionEndedAt).toBeNull();
    const [target] = await db.select().from(village).where(eq(village.id, TARGET));
    expect(target?.tokens).toBe(WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE);
    const [structure] = await db
      .select()
      .from(villageStructure)
      .where(eq(villageStructure.villageId, TARGET));
    expect(structure?.raidBoostExpiresAt).toBeInstanceOf(Date);
  });

  it("allows tiny, penniless hideout defenders and ignores empty treasury during an active raid", async () => {
    await seedWorld();
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ type: "HIDEOUT", tokens: 0 })
      .where(eq(village.id, TARGET));
    await db.delete(userData).where(eq(userData.villageId, TARGET));
    expect((await declare(LEADER, FACTION)).success).toBe(true);
    expect(
      await (await callerFor(warRouter, LEADER)).getActiveWars({ villageId: FACTION }),
    ).toHaveLength(1);
  });

  it("does not settle a stale defeated snapshot after the structure has recovered", async () => {
    await seedWorld();
    await declare(LEADER, FACTION);
    const db = await getTestDatabase();
    const [raid] = await db.select().from(war);
    const active = (await fetchActiveWar(db, raid!.id))!;
    const stale = { ...active, attackerWarHealth: 0 };
    const result = await handleWarEnd(stale, db);
    expect(result.status).toBe("ACTIVE");
    expect(result.endedAt).toBeNull();
    expect((await readFaction())?.tokens).toBe(TOKENS - FACTION_RAID_COST);
    expect((await readFaction())?.raidRetryCooldowns).toEqual({});
  });

  it("preserves a victory achieved before the deadline when settlement runs later", async () => {
    await seedWorld();
    await declare(LEADER, FACTION);
    const db = await getTestDatabase();
    const [raid] = await db.select().from(war);
    const hit = await db
      .update(war)
      .set({ defenderWarHealth: 0 })
      .where(and(eq(war.id, raid!.id), warRaidCombatGuard()));
    expect(hit.rowsAffected).toBe(1);
    const healing = await db
      .update(war)
      .set({ defenderWarHealth: 100 })
      .where(and(eq(war.id, raid!.id), warRaidCombatGuard()));
    expect(healing.rowsAffected).toBe(0);
    await db
      .update(war)
      .set({ startedAt: new Date(Date.now() - 49 * 3600_000) })
      .where(eq(war.id, raid!.id));
    await (await callerFor(warRouter, LEADER)).getActiveWars({ villageId: FACTION });
    const [ended] = await db.select().from(war);
    expect(ended?.status).toBe("ATTACKER_VICTORY");
    expect((await readFaction())?.tokens).toBe(
      TOKENS - FACTION_RAID_COST + FACTION_RAID_REWARD,
    );
  });

  it.each([false, true])(
    "resolves a blocked killing shrine hit using the write time (deadline passes=%s)",
    async (expiresWhileBlocked) => {
      await seedWorld();
      await declare(LEADER, FACTION);
      const db = await getTestDatabase();
      const [raid] = await db.select().from(war);
      await db
        .update(war)
        .set({
          startedAt: sql`SYSDATE(3) - INTERVAL ${FACTION_RAID_MAX_DAYS * 24} HOUR + INTERVAL 3 SECOND`,
          defenderWarHealth: 100,
          defenderShrineHp: 10,
        })
        .where(eq(war.id, raid!.id));
      const blocker = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
      let hit: Promise<boolean> | undefined;
      try {
        // Hold the row only in the test to exercise the production helper's lock wait.
        await blocker.beginTransaction();
        await blocker.query("SELECT id FROM War WHERE id = ? FOR UPDATE", [raid!.id]);
        hit = applyVillageMissionShrineDamage(
          db,
          null,
          LEADER,
          raid!.id,
          "defenderShrineHp",
          20,
          true,
        );
        expect(await lockWaitObserved({ table: getTableName(war) })).toBe(true);
        const [clock] = await blocker.query<mysql.RowDataPacket[]>(
          `
        SELECT TIMESTAMPDIFF(MICROSECOND, SYSDATE(3), startedAt + INTERVAL ? HOUR) / 1000 AS remainingMs
        FROM War WHERE id = ?
      `,
          [FACTION_RAID_MAX_DAYS * 24, raid!.id],
        );
        const remainingMs = Number(clock[0]?.remainingMs);
        expect(remainingMs).toBeGreaterThan(0);
        if (expiresWhileBlocked) await setTimeout(remainingMs + 250);
        await blocker.commit();
        expect(await hit).toBe(!expiresWhileBlocked);
      } finally {
        await blocker.rollback();
        await hit?.catch(() => {});
        await blocker.end();
      }
      const [damaged] = await db.select().from(war).where(eq(war.id, raid!.id));
      expect(damaged).toMatchObject({
        defenderWarHealth: expiresWhileBlocked ? 100 : 0,
        defenderShrineHp: expiresWhileBlocked ? 10 : 0,
        defenderShrineStatus: expiresWhileBlocked ? "ACTIVE" : "CAPTURED",
      });
      // Settle later, after the deadline, to preserve an on-time victory only.
      await db
        .update(war)
        .set({
          startedAt: new Date(Date.now() - (FACTION_RAID_MAX_DAYS * 24 + 1) * 3600_000),
        })
        .where(eq(war.id, raid!.id));
      const ended = await handleWarEnd((await fetchActiveWar(db, raid!.id))!, db);
      expect(ended.status).toBe(
        expiresWhileBlocked ? "DEFENDER_VICTORY" : "ATTACKER_VICTORY",
      );
      expect((await readFaction())?.tokens).toBe(
        TOKENS - FACTION_RAID_COST + (expiresWhileBlocked ? 0 : FACTION_RAID_REWARD),
      );
    },
    10_000,
  );

  it("drains both structures by 300 per day once without touching treasury balances", async () => {
    await seedWorld();
    await declare(LEADER, FACTION);
    const db = await getTestDatabase();
    const [raid] = await db.select().from(war);
    await db
      .update(war)
      .set({ lastTokenReductionAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(war.id, raid!.id));
    const active = (await fetchActiveWar(db, raid!.id))!;
    await Promise.all([
      applyRaidHealthDecay(db, active),
      applyRaidHealthDecay(db, active),
    ]);
    const [updated] = await db.select().from(war);
    expect(updated).toMatchObject({ attackerWarHealth: 1700, defenderWarHealth: 1700 });
    expect((await readFaction())?.tokens).toBe(TOKENS - FACTION_RAID_COST);
  });
});
