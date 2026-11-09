import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  WAR_DECLARATION_COST,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_VILLAGE_MAX_SECTORS,
} from "@/drizzle/constants";
import {
  clan,
  notification,
  sector,
  userData,
  village,
  villageAlliance,
  war,
  warAlly,
} from "@/drizzle/schema";
import { warRouter } from "@/routers/war";
import { insertClans, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const ATTACKER = "sector-attacker";
const DEFENDER = "sector-defender";
const LEADER = "sector-leader";
const TARGET_SECTOR = 105;
const OWN_SECTOR = 106;
const TOKENS = WAR_DECLARATION_COST * 2;

/** Satisfy sector-war prerequisites so rejection proves the faction purchase rule. */
const seedWorld = async (type: "VILLAGE" | "HIDEOUT" | "STRONGHOLD") => {
  const db = await getTestDatabase();
  await db.insert(village).values([
    {
      id: ATTACKER,
      name: "Attacker",
      sector: 101,
      kageId: LEADER,
      type,
      tokens: TOKENS,
    },
    {
      id: DEFENDER,
      name: "Defender",
      sector: 102,
      kageId: `${DEFENDER}-0`,
      type: "VILLAGE",
      tokens: TOKENS,
    },
  ]);
  if (type !== "VILLAGE") {
    await insertClans([
      {
        id: "sector-faction",
        name: "Sector Faction",
        villageId: ATTACKER,
        leaderId: LEADER,
        hasHideout: true,
      },
    ]);
  }
  await insertUsers(
    [ATTACKER, DEFENDER].flatMap((villageId) =>
      Array.from({ length: WAR_MINIMUM_MEMBERS_REQUIRED }, (_, index) => ({
        userId:
          villageId === ATTACKER && index === 0 ? LEADER : `${villageId}-${index}`,
        username: `${villageId}${index}`,
        villageId,
        clanId: villageId === ATTACKER && type !== "VILLAGE" ? "sector-faction" : null,
        isOutlaw: villageId === ATTACKER && type !== "VILLAGE",
      })),
    ),
  );
  await db.insert(villageAlliance).values({
    id: "sector-enemies",
    villageIdA: ATTACKER,
    villageIdB: DEFENDER,
    status: "ENEMY",
  });
  await db.insert(sector).values([
    { sector: TARGET_SECTOR, villageId: DEFENDER },
    { sector: OWN_SECTOR, villageId: ATTACKER },
  ]);
};

/** Verify rejected purchases preserve treasury tokens and both existing sector owners. */
const assertOwnershipAndBalance = async () => {
  const db = await getTestDatabase();
  const [attacker] = await db.select().from(village).where(eq(village.id, ATTACKER));
  expect(attacker?.tokens).toBe(TOKENS);
  const sectors = await db.select().from(sector);
  expect(sectors.find((row) => row.sector === OWN_SECTOR)?.villageId).toBe(ATTACKER);
  expect(sectors.find((row) => row.sector === TARGET_SECTOR)?.villageId).toBe(DEFENDER);
};

describeWithDatabase("faction sector purchases", () => {
  beforeEach(async () => {
    await resetTables(
      notification,
      clan,
      userData,
      village,
      villageAlliance,
      sector,
      war,
      warAlly,
    );
  });

  it.each(["HIDEOUT", "STRONGHOLD"] as const)(
    "rejects %s sector declarations without charging or changing existing ownership",
    async (type) => {
      await seedWorld(type);
      const result = await (await callerFor(warRouter, LEADER)).declareSectorWar({
        sectorId: TARGET_SECTOR,
        userVillageId: ATTACKER,
      });
      expect(result).toMatchObject({
        success: false,
        message: "Factions cannot purchase sectors",
      });
      const db = await getTestDatabase();
      expect(await db.select().from(war)).toHaveLength(0);
      expect(await db.select().from(notification)).toHaveLength(0);
      await assertOwnershipAndBalance();
    },
  );

  it.each(["HIDEOUT", "STRONGHOLD"] as const)(
    "rejects %s paid shrine completion of an existing sector war",
    async (type) => {
      await seedWorld(type);
      const db = await getTestDatabase();
      await db.insert(war).values({
        id: "sector-war",
        attackerVillageId: ATTACKER,
        defenderVillageId: DEFENDER,
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: TARGET_SECTOR,
        defenderShrineHp: 0,
      });
      const result = await (await callerFor(warRouter, LEADER)).buildShrine({
        warId: "sector-war",
      });
      expect(result).toMatchObject({
        success: false,
        message: "Factions cannot purchase sectors",
      });
      const [unchanged] = await db.select().from(war);
      expect(unchanged).toMatchObject({
        status: "ACTIVE",
        endedAt: null,
        settlement: null,
      });
      expect(await db.select().from(notification)).toHaveLength(0);
      await assertOwnershipAndBalance();
    },
  );

  it.each([ATTACKER, null])(
    "applies the sector cap to the leader's village (input village %p)",
    async (userVillageId) => {
      await seedWorld("VILLAGE");
      const db = await getTestDatabase();
      await db.insert(sector).values(
        Array.from({ length: WAR_VILLAGE_MAX_SECTORS - 1 }, (_, index) => ({
          sector: 200 + index,
          villageId: ATTACKER,
        })),
      );
      const result = await (await callerFor(warRouter, LEADER)).declareSectorWar({
        sectorId: TARGET_SECTOR,
        userVillageId,
      });
      expect(result).toMatchObject({
        success: false,
        message: `Your village has too many sectors. Can max own ${WAR_VILLAGE_MAX_SECTORS} sectors`,
      });
      expect(await db.select().from(war)).toHaveLength(0);
    },
  );

  it("preserves ordinary village declaration and paid sector claiming", async () => {
    await seedWorld("VILLAGE");
    const caller = await callerFor(warRouter, LEADER);
    expect(
      (
        await caller.declareSectorWar({
          sectorId: TARGET_SECTOR,
          userVillageId: ATTACKER,
        })
      ).success,
    ).toBe(true);
    const db = await getTestDatabase();
    const [declared] = await db.select().from(war);
    await db.update(war).set({ defenderShrineHp: 0 }).where(eq(war.id, declared!.id));
    expect((await caller.buildShrine({ warId: declared!.id })).success).toBe(true);
    const [settled] = await db.select().from(war);
    expect(settled?.status).toBe("ATTACKER_VICTORY");
    const [attacker] = await db.select().from(village).where(eq(village.id, ATTACKER));
    expect(attacker?.tokens).toBe(
      TOKENS - WAR_DECLARATION_COST - WAR_PURCHASE_SHRINE_TOKEN_COST,
    );
    const sectors = await db.select().from(sector);
    expect(sectors.every((row) => row.villageId === ATTACKER)).toBe(true);
  });
});
