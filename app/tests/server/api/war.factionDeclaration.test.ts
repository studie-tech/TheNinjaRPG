
import { eq, getTableName } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "bun:test";
import {
  ELDER_MIN_VOTING_COUNT,
  WAR_DECLARATION_COST,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
} from "@/drizzle/constants";
import {
  notification,
  userData,
  village,
  villageAlliance,
  villageElderVote,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { warRouter } from "@/routers/war";
import * as serverSentry from "@/server/utils/sentry";
import { startDeclaredWar } from "@/server/utils/war";
import { insertUsers } from "../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const FACTION = "faction-hideout";
const TARGET = "target-village";
const LEADER = "faction-leader";
const TARGET_KAGE = "target-kage";
const TOKENS = WAR_DECLARATION_COST * 2 + 500_000;

const declare = async (userId: string, userVillageId: string) =>
  (await callerFor(warRouter, userId)).declareVillageWarOrRaid({
    targetVillageId: TARGET,
    targetStructureRoute: "/townhall",
    userVillageId,
  });

/**
 * A faction hideout led by LEADER and an enemy village, each with enough members and
 * tokens to go to war. Factions never get elders, which is what used to block them.
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
  await database.insert(villageStructure).values({
    id: "target-townhall",
    name: "Town Hall",
    image: "/townhall.webp",
    villageId: TARGET,
    route: "/townhall",
  } as never);
  const members = (villageId: string, prefix: string, outlaw: boolean) =>
    Array.from({ length: WAR_MINIMUM_MEMBERS_REQUIRED }, (_, i) => ({
      userId: `${prefix}-${i}`,
      username: `${prefix}${i}`,
      villageId,
      isOutlaw: outlaw,
    }));
  const factionMembers = members(FACTION, "faction", attackerType === "HIDEOUT");
  const targetMembers = members(TARGET, "target", false);
  factionMembers[0] = { ...factionMembers[0]!, userId: LEADER, username: "FactionLeader" };
  targetMembers[0] = { ...targetMembers[0]!, userId: TARGET_KAGE, username: "TargetKage" };
  await insertUsers([...factionMembers, ...targetMembers] as never);
};

const readFaction = async () => {
  const database = await getTestDatabase();
  const [row] = await database.select().from(village).where(eq(village.id, FACTION));
  return row;
};

describeWithDatabase("faction war declarations", () => {
  beforeEach(async () => {
    await resetTables(
      notification,
      userData,
      village,
      villageAlliance,
      villageElderVote,
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
      targetStructureRoute: "/townhall",
    });
    expect((await readFaction())?.tokens).toBe(TOKENS - WAR_DECLARATION_COST);
    expect(await database.select().from(villageElderVote)).toHaveLength(0);
    const notified = (await database.select().from(notification)).map((n) => n.userId);
    expect(notified.sort()).toEqual([LEADER, TARGET_KAGE].sort());
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
        targetStructureRoute: "/townhall",
        userVillageId: FACTION,
      });
      expect(result.success).toBe(true);
      expect(await database.select().from(war)).toHaveLength(1);
      expect((await readFaction())?.tokens).toBe(TOKENS - WAR_DECLARATION_COST);
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
      .set({ tokens: WAR_DECLARATION_COST - 1 })
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
      });
      const declaration = {
        attackerVillageId: FACTION,
        attackerVillageName: "Akatsuki",
        defenderVillageId: TARGET,
        defenderVillageName: "Konoki",
        initiatedByUserId: LEADER,
        warType: "WAR_RAID" as const,
        targetStructureRoute: "/townhall",
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
        startingTokens - WAR_DECLARATION_COST,
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
});
