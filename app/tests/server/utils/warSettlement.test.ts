import { afterEach, beforeEach, expect, it, spyOn, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { eq, type SQL } from "drizzle-orm";
import mysql from "mysql2/promise";
import {
  FACTION_RAID_REWARD,
  VILLAGE_SYNDICATE_ID,
  WAR_DECLARATION_COST,
  WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_SECTOR_LOSS_TOWNHALL_DAMAGE,
  WAR_VICTORY_BOOSTED_STRUCTURES,
  WAR_VICTORY_STRUCTURE_BOOST_LEVELS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_BOOST_DAYS,
  WAR_WINNING_BOOST_REGEN_PERC,
  WAR_WINNING_BOOST_TRAINING_PERC,
  type WarType,
} from "@/drizzle/constants";
import {
  gameSetting,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  questHistory,
  sector,
  userData,
  userRequest,
  village,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchActiveWar, fetchEndedWars } from "@/queries/war";
import { shrineRouter } from "@/server/api/routers/shrine";
import { villageRouter } from "@/server/api/routers/village";
import { fetchActiveWars, warRouter } from "@/server/api/routers/war";
import type { DrizzleClient } from "@/server/db";
import * as warPush from "@/server/utils/push/war";
import { handleWarEnd, startDeclaredWar, startSectorWar } from "@/server/utils/war";
import { acceptWarAllyOffer, withdrawWarAlly } from "@/server/utils/warAlly";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { interceptExecute, sqlText, withoutTransactions } from "../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  runRawSql,
} from "../../setup/testDatabase";

const warId = "settlement-war";
const sectorId = 205;
const tokens = WAR_PURCHASE_SHRINE_TOKEN_COST * 3;
const intercept = (db: DrizzleClient, run: Parameters<typeof interceptExecute>[1]) =>
  interceptExecute(
    withoutTransactions(db, "Settlement must not open a transaction"),
    run,
  );
/** Resolve the acting Kage as a minimal profile of their village's live row. */
const stubKage = (db: DrizzleClient, villageId: string | (() => string)) =>
  stubProfile("fetchUpdatedUser", async () => {
    const id = typeof villageId === "string" ? villageId : villageId();
    return {
      user: {
        userId: `${id}-kage`,
        villageId: id,
        village: await db.query.village.findFirst({ where: eq(village.id, id) }),
      },
      requiresUserRefresh: false,
    };
  });
/** Resolve the acting user as their live row with the relations the procedure reads. */
const stubUser = (
  db: DrizzleClient,
  userId: string,
  relations: NonNullable<
    Parameters<DrizzleClient["query"]["userData"]["findFirst"]>[0]
  >["with"],
) =>
  stubProfile("fetchUpdatedUser", async () => ({
    user: await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: relations,
    }),
    requiresUserRefresh: false,
  }));
const seed = async (type: WarType = "VILLAGE_WAR") => {
  const db = await getTestDatabase();
  await db.insert(village).values(
    ["attacker", "defender", "ally", "other"].map((id, i) => ({
      id,
      name: id,
      sector: 101 + i,
      kageId: `${id}-kage`,
      tokens,
    })),
  );
  await db.insert(war).values({
    id: warId,
    type,
    status: "ACTIVE",
    sector: sectorId,
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    attackerWarHealth: 100,
    defenderWarHealth: type === "SECTOR_WAR" ? 100 : 0,
    defenderShrineHp: 0,
  });
  await db.insert(sector).values({ sector: sectorId, villageId: "defender" });
  await insertUsers([
    { userId: "attacker-user", villageId: "attacker" },
    { userId: "defender-user", villageId: "defender" },
  ]);
  await db.insert(gameSetting).values(
    ["war-attacker-regen", "war-ally-regen", "war-attacker-train"].map((name) => ({
      id: name,
      name,
      value: 0,
      time: new Date(0),
    })),
  );
  await db.insert(villageStructure).values(
    ["attacker", "defender"].flatMap((id) =>
      ["/townhall", ...WAR_VICTORY_BOOSTED_STRUCTURES]
        .filter((route, index, all) => all.indexOf(route) === index)
        .map((route) => ({
          id: `${id}${route}`,
          name: route,
          route,
          image: "",
          villageId: id,
          curSp: WAR_SECTOR_LOSS_TOWNHALL_DAMAGE * 2,
        })),
    ),
  );
  return db;
};
const snapshot = async (db: DrizzleClient) => {
  const value = await fetchActiveWar(db, warId);
  if (!value) throw new Error("Missing seeded war");
  return value;
};
const savedWar = (db: DrizzleClient) =>
  db.query.war.findFirst({ where: eq(war.id, warId) });
const balance = async (db: DrizzleClient, id: string) =>
  (await db.query.village.findFirst({ where: eq(village.id, id) }))?.tokens;
const addAlly = (db: DrizzleClient) =>
  db.insert(warAlly).values({
    id: "ally-membership",
    warId,
    villageId: "ally",
    supportVillageId: "attacker",
    tokensPaid: 0,
  });
const offer = {
  offerId: "offer",
  warId,
  villageId: "ally",
  supportVillageId: "attacker",
  userId: "ally-kage",
};
const addOffer = (db: DrizzleClient, value = 100) =>
  db.insert(userRequest).values({
    id: offer.offerId,
    type: "WAR_ALLY",
    status: "PENDING",
    senderId: "attacker-kage",
    receiverId: offer.userId,
    relatedId: warId,
    value,
  });

describeWithDatabase("guarded war settlement and delivery", () => {
  const nativeWar = vi.fn();
  beforeEach(async () => {
    nativeWar.mockReset();
    spyOn(warPush, "notifyWarVillages").mockImplementation(nativeWar);
    await resetTables(
      notification,
      gameSetting,
      mpvpBattleUser,
      mpvpBattleQueue,
      questHistory,
      sector,
      userData,
      userRequest,
      villageStructure,
      warAlly,
      war,
      village,
    );
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("settles overdue objective wars at the deadline with final decay, camps and allied bonuses", async () => {
    const db = await seed();
    await addAlly(db);
    const start = new Date(Date.now() - 8 * 86400000);
    await db
      .update(war)
      .set({
        rules: { ...defaultWarRules, enabled: true },
        combatStartedAt: start,
        lastTokenReductionAt: start,
        attackerWarHealth: 10000,
        defenderWarHealth: 9500,
      })
      .where(eq(war.id, warId));
    await db.insert(villageStructure).values({
      id: "ally-extra",
      name: "extra",
      route: "/townhall",
      image: "",
      villageId: "ally",
    });
    const ended = await handleWarEnd(await snapshot(db), db);
    expect(ended.status).toBe("ATTACKER_VICTORY");
    expect(ended.endedAt!.getTime()).toBe(start.getTime() + 7 * 86400000);
    expect(ended.attackerWarHealth).toBe(7900);
    expect(ended.defenderWarHealth).toBe(7400);
    expect(await balance(db, "ally")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS / 2);
    const allyVillage = (await db.query.village.findFirst({
      where: eq(village.id, "ally"),
    }))!;
    expect(allyVillage.lastWarEndedAt!.getTime()).toBe(ended.endedAt!.getTime());
    const allyStructure = (await db.query.villageStructure.findFirst({
      where: eq(villageStructure.id, "ally-extra"),
    }))!;
    expect(allyStructure.temporaryLevelBonus).toBe(3);
    expect(allyStructure.temporaryLevelBonusExpiresAt!.getTime()).toBe(
      ended.endedAt!.getTime() + 5 * 86400000,
    );
    const boosts = await db.query.gameSetting.findMany();
    expect(boosts.find((b) => b.name === "war-ally-train")!.value).toBe(20);
    expect(boosts.find((b) => b.name === "war-ally-regen")!.value).toBe(40);
    const loser = (await db.query.village.findFirst({
      where: eq(village.id, "defender"),
    }))!;
    expect(loser.warExhaustionEndedAt!.getTime()).toBe(
      ended.endedAt!.getTime() + 4 * 86400000,
    );
    const loserStructure = (await db.query.villageStructure.findFirst({
      where: eq(villageStructure.id, "defender/townhall"),
    }))!;
    expect(loserStructure.temporaryLevelBonus).toBe(-2);
    expect(loserStructure.temporaryLevelBonusExpiresAt!.getTime()).toBe(
      ended.endedAt!.getTime() + 3 * 86400000,
    );
  });

  it("withdrawal overlapping settlement either leaves before rewards or loses its claim", async () => {
    const db = await seed();
    await addAlly(db);
    const initial = await snapshot(db);
    const [settled, withdrawn] = await Promise.all([
      handleWarEnd(initial, db),
      withdrawWarAlly(db, warId, "ally", "ally-kage"),
    ]);
    expect(settled.status).toBe("ATTACKER_VICTORY");
    expect(await balance(db, "ally")).toBe(
      tokens + (withdrawn.success ? 0 : WAR_VICTORY_TOKEN_BONUS / 2),
    );
    expect((await savedWar(db))?.settlement?.winningVillageIds.includes("ally")).toBe(
      !withdrawn.success,
    );
  });

  it("acceptance overlapping settlement cannot deliver a late membership or partial payment", async () => {
    const db = await seed();
    await addOffer(db);
    const initial = await snapshot(db);
    const [settled, admitted] = await Promise.all([
      handleWarEnd(initial, db),
      acceptWarAllyOffer(db, offer),
    ]);
    expect(settled.status).toBe("ATTACKER_VICTORY");
    const receipt = (await savedWar(db))?.settlement;
    expect(receipt?.winningVillageIds.includes("ally")).toBe(admitted.success);
    expect(await balance(db, "ally")).toBe(
      tokens + (admitted.success ? 100 + WAR_VICTORY_TOKEN_BONUS / 2 : 0),
    );
  });

  it("the uniqueness migration retains one active legacy membership and preserves history", async () => {
    const db = await seed();
    await runRawSql("ALTER TABLE WarAlly DROP INDEX WarAlly_active_village_key");
    try {
      await db.insert(warAlly).values([
        ...["legacy-a", "legacy-b", "legacy-c"].map((id) => ({
          id,
          warId,
          villageId: "ally",
          supportVillageId: "attacker",
          tokensPaid: 0,
        })),
        {
          id: "other-war-a",
          warId: "other-war",
          villageId: "ally",
          supportVillageId: "attacker",
          tokensPaid: 0,
        },
      ]);
      const migration = readFileSync(
        new URL("../../../drizzle/migrations/0073_classy_ink.sql", import.meta.url),
        "utf8",
      );
      const deduplicate = migration.match(/UPDATE `WarAlly`[\s\S]+?;/)?.[0];
      if (!deduplicate) throw new Error("Missing membership migration");
      await runRawSql(deduplicate);
      const memberships = await db.select().from(warAlly);
      expect(memberships).toHaveLength(4);
      expect(memberships.every((row) => row.acceptedAt !== null)).toBe(true);
      expect(memberships.filter((row) => row.endedAt !== null)).toHaveLength(2);
      expect(
        memberships.filter((row) => row.warId === warId && row.villageId === "ally"),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "legacy-a", endedAt: null }),
          expect.objectContaining({ id: "legacy-b", activeVillageId: null }),
          expect.objectContaining({ id: "legacy-c", activeVillageId: null }),
        ]),
      );
      expect((await snapshot(db)).warAllies).toHaveLength(1);
    } finally {
      await runRawSql(
        "ALTER TABLE WarAlly ADD CONSTRAINT WarAlly_active_village_key UNIQUE(warId, activeVillageId)",
      );
    }
    await expect(
      Promise.resolve(
        db.insert(warAlly).values({
          id: "conflicting-membership",
          warId,
          villageId: "ally",
          supportVillageId: "attacker",
          tokensPaid: 0,
        }),
      ),
    ).rejects.toThrow();
    expect(await db.select().from(warAlly)).toHaveLength(4);
  });

  it("pays the winning side once across concurrent claims and stale retries, without transactions", async () => {
    const db = await seed();
    await addAlly(db);
    await db.insert(warAlly).values({
      id: "losing-membership",
      warId,
      villageId: "other",
      supportVillageId: "defender",
      tokensPaid: 0,
    });
    const initial = await snapshot(db);
    const client = intercept(db, (_query, execute) => execute());
    const recorded = await recordQueries(() =>
      Promise.all([handleWarEnd(initial, client), handleWarEnd(initial, client)]),
    );
    expect(recorded.result.every((row) => row.status === "ATTACKER_VICTORY")).toBe(
      true,
    );
    await handleWarEnd(initial, client);
    expect(nativeWar).toHaveBeenCalledTimes(1);
    expect(nativeWar).toHaveBeenCalledWith(
      client,
      expect.arrayContaining(["attacker", "defender", "ally", "other"]),
      warId,
    );
    expect(await balance(db, "attacker")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS / 2);
    expect(await balance(db, "ally")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS / 2);
    expect(await balance(db, "defender")).toBe(tokens);
    expect(await balance(db, "other")).toBe(tokens);
    expect(await db.select().from(notification)).toHaveLength(1);
    expect(
      (await db.select().from(userData)).every(
        (user) => user.unreadNotifications === 1,
      ),
    ).toBe(true);
    expect(await savedWar(db)).toMatchObject({
      settlementPending: false,
      settlement: { boostsDelivered: true, structuresDelivered: true, notified: true },
    });
    expect(
      recorded.statements.some((query) => /^(begin|start transaction)/i.test(query)),
    ).toBe(false);
    const settings = await db.select().from(gameSetting);
    expect(settings.find((row) => row.name === "war-ally-regen")?.value).toBe(
      WAR_WINNING_BOOST_REGEN_PERC,
    );
    expect(settings.find((row) => row.name === "war-attacker-train")?.value).toBe(
      WAR_WINNING_BOOST_TRAINING_PERC,
    );
  });

  it("seeds missing boost rows for a war without rules", async () => {
    const db = await seed();
    await addAlly(db);
    await db.delete(gameSetting);
    const initial = await snapshot(db);
    const recorded = await recordQueries(() => handleWarEnd(initial, db));
    expect(
      recorded.statements.filter(
        (query) => /^select\b/i.test(query) && /\bfrom `GameSetting`/i.test(query),
      ),
    ).toHaveLength(0);
    expect(
      recorded.statements.filter((query) =>
        /^insert ignore into `GameSetting`/i.test(query),
      ),
    ).toHaveLength(1);
    const settings = await db.select().from(gameSetting);
    expect(settings.map((row) => [row.name, row.value]).sort()).toEqual([
      ["war-ally-regen", WAR_WINNING_BOOST_REGEN_PERC],
      ["war-attacker-regen", WAR_WINNING_BOOST_REGEN_PERC],
      ["war-attacker-train", WAR_WINNING_BOOST_TRAINING_PERC],
    ]);
  });

  it("preserves an existing boost with a generated ID and a later expiry", async () => {
    const db = await seed();
    const expiry = new Date(Date.now() + (WAR_WINNING_BOOST_DAYS + 1) * 86400000);
    await db
      .update(gameSetting)
      .set({ id: "legacy-regen", value: 99, time: expiry })
      .where(eq(gameSetting.name, "war-attacker-regen"));
    await handleWarEnd(await snapshot(db), db);
    const settings = await db.select().from(gameSetting);
    expect(settings.filter((row) => row.name === "war-attacker-regen")).toEqual([
      expect.objectContaining({ id: "legacy-regen", value: 99, time: expiry }),
    ]);
    expect(settings.find((row) => row.name === "war-attacker-train")?.value).toBe(
      WAR_WINNING_BOOST_TRAINING_PERC,
    );
    expect((await savedWar(db))?.settlementPending).toBe(false);
  });

  it("rolls back every balance and the claim if the core SQL update fails", async () => {
    const db = await seed();
    await addAlly(db);
    await db
      .update(village)
      .set({ tokens: 2_147_483_647 })
      .where(eq(village.id, "ally"));
    const initial = await snapshot(db);
    await expect(handleWarEnd(initial, db)).rejects.toThrow();
    expect(nativeWar).not.toHaveBeenCalled();
    expect(await savedWar(db)).toMatchObject({
      status: "ACTIVE",
      endedAt: null,
      settlement: null,
    });
    expect(await balance(db, "attacker")).toBe(tokens);
    expect(await db.select().from(notification)).toHaveLength(0);
    await db.update(village).set({ tokens }).where(eq(village.id, "ally"));
    await handleWarEnd(initial, db);
    expect(await balance(db, "attacker")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS / 2);
  });

  it("resumes failed cleanup through active-war reads without paying or notifying twice", async () => {
    const db = await seed();
    const client = intercept(db, async (query, execute) => {
      if (sqlText(query).includes("DELETE qh"))
        throw new Error("Quest cleanup unavailable");
      return execute();
    });
    expect((await handleWarEnd(await snapshot(db), client)).status).toBe(
      "ATTACKER_VICTORY",
    );
    expect(await savedWar(db)).toMatchObject({ settlementPending: true });
    expect(await fetchActiveWars(db, "attacker")).toHaveLength(0);
    expect(await savedWar(db)).toMatchObject({ settlementPending: false });
    expect(await balance(db, "attacker")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS);
    expect(await db.select().from(notification)).toHaveLength(1);
    expect(
      (await db.select().from(userData)).every(
        (user) => user.unreadNotifications === 1,
      ),
    ).toBe(true);
  });

  it("excludes a withdrawn ally when the supplied roster is stale", async () => {
    const db = await seed();
    await addAlly(db);
    const initial = await snapshot(db);
    expect((await withdrawWarAlly(db, warId, "ally", "ally-kage")).success).toBe(true);
    await handleWarEnd(initial, db);
    expect(await balance(db, "ally")).toBe(tokens);
    expect(await balance(db, "attacker")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS);
    expect(
      (
        await db.query.gameSetting.findFirst({
          where: eq(gameSetting.name, "war-ally-regen"),
        })
      )?.value,
    ).toBe(0);
    expect((await savedWar(db))?.settlement?.winningVillageIds).toEqual(["attacker"]);
    expect((await db.select().from(warAlly))[0]?.endedAt).not.toBeNull();
    expect(await fetchEndedWars(db, "ally")).toHaveLength(0);
  });

  it("includes an ally accepted after the supplied roster was read", async () => {
    const db = await seed();
    const initial = await snapshot(db);
    await addOffer(db);
    expect((await acceptWarAllyOffer(db, offer)).success).toBe(true);
    await handleWarEnd(initial, db);
    expect(await balance(db, "attacker")).toBe(
      tokens - 100 + WAR_VICTORY_TOKEN_BONUS / 2,
    );
    expect(await balance(db, "ally")).toBe(tokens + 100 + WAR_VICTORY_TOKEN_BONUS / 2);
  });

  it("conserves the complete reward pool when the recipient count does not divide it", async () => {
    const db = await seed();
    for (let i = 0; i < 6; i++) {
      await db.insert(village).values({
        id: `recipient-${i}`,
        name: `recipient-${i}`,
        sector: 110 + i,
        kageId: `recipient-${i}-kage`,
        tokens,
      });
      await db.insert(warAlly).values({
        id: `membership-${i}`,
        warId,
        villageId: `recipient-${i}`,
        supportVillageId: "attacker",
        tokensPaid: 0,
      });
    }
    await handleWarEnd(await snapshot(db), db);
    expect(
      (await db.select().from(village)).reduce(
        (sum, row) => sum + row.tokens - tokens,
        0,
      ),
    ).toBe(WAR_VICTORY_TOKEN_BONUS);
    expect(await balance(db, "attacker")).toBe(
      tokens + Math.floor(WAR_VICTORY_TOKEN_BONUS / 7) + (WAR_VICTORY_TOKEN_BONUS % 7),
    );
  });

  it("a draw pays no rewards and penalizes both villages", async () => {
    const db = await seed();
    await db.update(war).set({ attackerWarHealth: 0 }).where(eq(war.id, warId));
    expect((await handleWarEnd(await snapshot(db), db)).status).toBe("DRAW");
    expect(
      (await db.select().from(village)).every((row) => row.tokens === tokens),
    ).toBe(true);
    expect(
      (await db.select().from(villageStructure)).every(
        (row) => row.temporaryLevelBonus === -WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
      ),
    ).toBe(true);
  });

  it("a raid pays only the attacking treasury and applies percentage effects without war penalties", async () => {
    const db = await seed("WAR_RAID");
    await db.update(war).set({ targetStructureRoute: "/traininggrounds" });
    await handleWarEnd(await snapshot(db), db);
    expect(await balance(db, "attacker")).toBe(tokens + FACTION_RAID_REWARD);
    expect(await balance(db, "defender")).toBe(tokens);
    const structures = await db.select().from(villageStructure);
    expect(structures.every((row) => row.temporaryLevelBonus === 0)).toBe(true);
    expect(
      structures.find((row) => row.id === "attacker/traininggrounds")
        ?.raidBoostExpiresAt,
    ).toBeInstanceOf(Date);
    expect(
      structures.find((row) => row.id === "defender/traininggrounds")
        ?.raidProtectedUntil,
    ).toBeInstanceOf(Date);
    expect(
      (await db.select().from(gameSetting)).every((setting) => setting.value === 0),
    ).toBe(true);
    expect((await savedWar(db))?.settlementPending).toBe(false);
  });

  it("closing sibling sector wars clears participation after all their outcomes commit", async () => {
    const db = await seed("SECTOR_WAR");
    await db.update(sector).set({ shrineLevel: 3, capturedAt: new Date(0) });
    await db.insert(war).values({
      id: "other-war",
      type: "SECTOR_WAR",
      status: "ACTIVE",
      sector: sectorId,
      attackerVillageId: "other",
      defenderVillageId: "defender",
    });
    await db.update(userData).set({
      warParticipantUntil: new Date(Date.now() + 86_400_000),
      status: "QUEUED",
    });
    await db.insert(mpvpBattleQueue).values({
      id: "queue",
      battleType: "SHRINE_BATTLE",
      sector: sectorId,
      attackerEntityId: "attacker",
      defenderEntityId: "defender",
    });
    await db.insert(mpvpBattleUser).values({
      id: "queued-user",
      clanBattleId: "queue",
      userId: "attacker-user",
      side: "ATTACKER",
      slot: 0,
    });
    const ended = await handleWarEnd(await snapshot(db), db, {
      shrineBuilderId: "attacker-kage",
    });
    expect((await db.select().from(war)).every((row) => row.status !== "ACTIVE")).toBe(
      true,
    );
    expect(
      (await db.select().from(userData)).every(
        (user) => user.warParticipantUntil.getTime() === 0,
      ),
    ).toBe(true);
    expect(
      (
        await db.query.userData.findFirst({
          where: eq(userData.userId, "attacker-user"),
        })
      )?.status,
    ).toBe("AWAKE");
    expect(await db.select().from(mpvpBattleQueue)).toHaveLength(0);
    expect(await db.select().from(mpvpBattleUser)).toHaveLength(0);
    expect(await db.query.sector.findFirst()).toEqual(
      expect.objectContaining({
        villageId: "attacker",
        shrineLevel: 1,
        capturedAt: ended.endedAt,
      }),
    );
    expect(
      (
        await db.query.villageStructure.findFirst({
          where: eq(villageStructure.id, "defender/townhall"),
        })
      )?.curSp,
    ).toBe(WAR_SECTOR_LOSS_TOWNHALL_DAMAGE);
  });

  it("serializes competing objective and sector declarations without selecting disputed land", async () => {
    const db = await seed();
    await db.delete(war);
    const declarationTokens = WAR_DECLARATION_COST + defaultWarRules.declarationCost;
    await db.update(village).set({ tokens: declarationTokens });
    await db.update(sector).set({ shrineLevel: 1 });
    await db.insert(gameSetting).values({
      id: "OBJECTIVE_WAR_enabled",
      name: "OBJECTIVE_WAR_enabled",
      time: new Date(),
      value: 1,
    });
    await db.insert(sector).values([
      { sector: 301, villageId: "attacker", shrineLevel: 1 },
      { sector: 302, villageId: "attacker", shrineLevel: 1 },
      { sector: 206, villageId: "defender", shrineLevel: 1 },
    ]);
    const [objectiveStarted, sectorStarted] = await Promise.all([
      startDeclaredWar(db, {
        attackerVillageId: "attacker",
        attackerVillageName: "attacker",
        defenderVillageId: "defender",
        defenderVillageName: "defender",
        initiatedByUserId: "attacker-kage",
        warType: "VILLAGE_WAR",
        targetStructureRoute: "/townhall",
      }),
      startSectorWar(db, {
        id: "competing-sector",
        attackerVillageId: "other",
        defenderVillageId: "defender",
        initiatedByUserId: "other-kage",
        sectorId,
      }),
    ]);
    expect(Number(objectiveStarted) + Number(sectorStarted)).toBe(1);
    const objective = (await db.query.war.findMany()).find((w) => w.rules);
    if (objectiveStarted) expect(objective?.objectiveState?.objectives).toHaveLength(4);
    if (sectorStarted) expect(objective).toBeUndefined();
    expect(await balance(db, "other")).toBe(
      declarationTokens - (sectorStarted ? WAR_DECLARATION_COST : 0),
    );
    expect(await balance(db, "attacker")).toBe(
      declarationTokens - (objectiveStarted ? defaultWarRules.declarationCost : 0),
    );
  });

  it("rejects a stale sector owner without charging or creating a war", async () => {
    const db = await seed();
    await db.delete(war);
    await db
      .update(sector)
      .set({ villageId: "ally" })
      .where(eq(sector.sector, sectorId));
    expect(
      await startSectorWar(db, {
        id: "stale-sector",
        attackerVillageId: "attacker",
        defenderVillageId: "defender",
        initiatedByUserId: "attacker-kage",
        sectorId,
      }),
    ).toBe(false);
    expect(await balance(db, "attacker")).toBe(tokens);
    expect(await db.query.war.findMany()).toHaveLength(0);
  });

  it("rejects a deleted sector with a stale owner without recreating ownership", async () => {
    const db = await seed();
    await db.delete(war);
    await db.delete(sector).where(eq(sector.sector, sectorId));
    expect(
      await startSectorWar(db, {
        id: "deleted-sector",
        attackerVillageId: "attacker",
        defenderVillageId: "defender",
        initiatedByUserId: "attacker-kage",
        sectorId,
      }),
    ).toBe(false);
    expect(await balance(db, "attacker")).toBe(tokens);
    expect(await db.query.war.findMany()).toHaveLength(0);
    expect(await db.query.sector.findMany()).toHaveLength(0);
  });

  it("treats missing sectors as Syndicate land when declaring sector wars", async () => {
    const db = await seed();
    await db.delete(war);
    await db.insert(village).values({
      id: VILLAGE_SYNDICATE_ID,
      name: "Syndicate",
      sector: 99,
      kageId: "syndicate-kage",
    });
    await db
      .update(village)
      .set({ tokens: WAR_DECLARATION_COST })
      .where(eq(village.id, "attacker"));
    await db.delete(sector).where(eq(sector.sector, sectorId));
    expect(
      await startSectorWar(db, {
        id: "unowned-sector",
        attackerVillageId: "attacker",
        defenderVillageId: VILLAGE_SYNDICATE_ID,
        initiatedByUserId: "attacker-kage",
        sectorId,
      }),
    ).toBe(true);
    expect(await balance(db, "attacker")).toBe(0);
    expect((await db.query.war.findFirst())?.defenderVillageId).toBe(
      VILLAGE_SYNDICATE_ID,
    );
  });

  it("preserves selected objectives when a Kage attempts to release their sector", async () => {
    const db = await seed();
    await db
      .update(war)
      .set({
        rules: { ...defaultWarRules, enabled: true },
        objectiveState: {
          attackerEspionage: 0,
          defenderEspionage: 0,
          objectives: [
            {
              sector: sectorId,
              villageId: "defender",
              hp: 5000,
              maxHp: 5000,
              isReserve: false,
              destroyed: false,
            },
          ],
        },
      })
      .where(eq(war.id, warId));
    await insertUsers([
      { userId: "defender-kage", username: "release-kage", villageId: "defender" },
    ]);
    stubUser(db, "defender-kage", { village: true });
    const caller = callerForDatabase(villageRouter, "defender-kage", db);
    const blocked = await caller.releaseSector({ sector: sectorId });
    expect(blocked.success).toBe(false);
    expect(blocked.message).toBe(
      "Sector ownership or leadership changed, or this is an active war objective. Refresh and try again.",
    );
    expect((await db.query.sector.findFirst())?.villageId).toBe("defender");
    await db
      .update(war)
      .set({ endedAt: new Date(), status: "DRAW" })
      .where(eq(war.id, warId));
    expect((await caller.releaseSector({ sector: sectorId })).success).toBe(true);
    expect(await db.query.sector.findMany()).toHaveLength(0);
  });

  it("a declaration consuming the attacker's last tokens preserves the defending shrine", async () => {
    const db = await seed("SECTOR_WAR");
    await db.delete(war);
    await db
      .update(village)
      .set({ tokens: WAR_DECLARATION_COST })
      .where(eq(village.id, "attacker"));
    await db.update(sector).set({ shrineLevel: 3, capturedAt: new Date(0) });
    await insertUsers(
      ["attacker", "defender"].flatMap((id) =>
        Array.from({ length: WAR_MINIMUM_MEMBERS_REQUIRED }, (_, i) => ({
          userId: i ? `${id}-member-${i}` : `${id}-kage`,
          username: `${id}-member-${i}`,
          villageId: id,
        })),
      ),
    );
    stubUser(db, "attacker-kage", { village: { with: { sectors: true } } });
    expect(
      (
        await callerForDatabase(warRouter, "attacker-kage", db).declareSectorWar({
          sectorId,
          userVillageId: "attacker",
        })
      ).success,
    ).toBe(true);
    expect(await balance(db, "attacker")).toBe(0);
    expect(await fetchActiveWars(db)).toHaveLength(0);
    expect((await db.query.war.findFirst())?.status).toBe("DEFENDER_VICTORY");
    expect(await db.query.sector.findFirst()).toEqual(
      expect.objectContaining({
        villageId: "defender",
        shrineLevel: 3,
        capturedAt: new Date(0),
      }),
    );
  });

  for (const waitForLock of [false, true])
    it(`includes a sector declaration ${waitForLock ? "committed while capture waits on a row lock" : "committed after the sibling snapshot"}`, async () => {
      const db = await seed("SECTOR_WAR");
      await db
        .update(village)
        .set({ tokens: WAR_DECLARATION_COST * 2 })
        .where(eq(village.id, "other"));
      await insertUsers([
        ...Array.from({ length: WAR_MINIMUM_MEMBERS_REQUIRED }, (_, index) => ({
          userId: index === 0 ? "other-kage" : `other-member-${index}`,
          username: `other-member-${index}`,
          villageId: "other",
        })),
        ...Array.from({ length: WAR_MINIMUM_MEMBERS_REQUIRED - 1 }, (_, index) => ({
          userId: `defender-member-${index}`,
          username: `defender-member-${index}`,
          villageId: "defender",
        })),
      ]);
      stubUser(db, "other-kage", { village: { with: { sectors: true } } });
      const connection = waitForLock
        ? await mysql.createConnection(process.env.TEST_MYSQL_URL!)
        : undefined;
      if (connection) {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM War WHERE id = ? FOR UPDATE", [warId]);
      }
      let declaredWarId: string | undefined;
      const client = intercept(db, async (query, execute) => {
        if (!declaredWarId && sqlText(query).trimStart().startsWith("UPDATE `War`")) {
          const pending = connection ? execute() : undefined;
          if (connection) await new Promise((resolve) => setTimeout(resolve, 50));
          expect((await savedWar(db))?.status).toBe("ACTIVE");
          const declared = await callerForDatabase(
            warRouter,
            "other-kage",
            db,
          ).declareSectorWar({
            sectorId,
            userVillageId: "other",
          });
          expect(declared.success).toBe(true);
          declaredWarId = (await db.query.war.findMany()).find(
            (row) => row.id !== warId,
          )?.id;
          expect(declaredWarId).toBeDefined();
          await db
            .update(userData)
            .set({ warParticipantUntil: new Date(Date.now() + 86_400_000) })
            .where(eq(userData.villageId, "other"));
          await db.insert(questHistory).values({
            id: "sibling-quest",
            userId: "other-kage",
            questId: "war-quest",
            questType: "war",
          });
          await connection?.commit();
          if (pending) return pending;
        }
        return execute();
      });
      try {
        const initial = await snapshot(db);
        const ended = await handleWarEnd(initial, client, {
          shrineBuilderId: "attacker-kage",
        });
        expect(ended.status).toBe("ATTACKER_VICTORY");
        expect((await db.query.sector.findFirst())?.villageId).toBe("attacker");
        expect(
          await db.query.war.findFirst({ where: eq(war.id, declaredWarId!) }),
        ).toEqual(
          expect.objectContaining({
            status: "DEFENDER_VICTORY",
            endedAt: ended.endedAt,
          }),
        );
        expect(ended.settlement?.warIds).toContain(declaredWarId!);
        expect(ended.settlement?.villageIds).toContain("other");
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, "other-kage"),
            })
          )?.warParticipantUntil.getTime(),
        ).toBe(0);
        expect(await db.select().from(questHistory)).toHaveLength(0);
        await handleWarEnd(initial, db, { shrineBuilderId: "attacker-kage" });
        expect(await balance(db, "attacker")).toBe(
          tokens - WAR_PURCHASE_SHRINE_TOKEN_COST,
        );
        expect(await balance(db, "other")).toBe(WAR_DECLARATION_COST);
      } finally {
        await connection?.rollback();
        await connection?.end();
      }
    });

  it("retains participation in an unrelated active war", async () => {
    const db = await seed();
    const until = new Date(Date.now() + 86_400_000);
    await db.update(userData).set({ warParticipantUntil: until });
    await db.insert(war).values({
      id: "other-war",
      type: "SECTOR_WAR",
      status: "ACTIVE",
      sector: 206,
      attackerVillageId: "attacker",
      defenderVillageId: "other",
    });
    await handleWarEnd(await snapshot(db), db);
    expect(
      (
        await db.query.userData.findFirst({
          where: eq(userData.userId, "attacker-user"),
        })
      )?.warParticipantUntil,
    ).toEqual(until);
    expect(
      (
        await db.query.userData.findFirst({
          where: eq(userData.userId, "defender-user"),
        })
      )?.warParticipantUntil.getTime(),
    ).toBe(0);
  });

  it("a failed shrine claim leaves tokens intact; overlapping requests charge once", async () => {
    const db = await seed("SECTOR_WAR");
    stubKage(db, "attacker");
    const fail = intercept(db, async (query, execute) => {
      if (sqlText(query).trimStart().startsWith("UPDATE `War`"))
        throw new Error("Claim unavailable");
      return execute();
    });
    await expect(
      callerForDatabase(warRouter, "attacker-kage", fail).buildShrine({ warId }),
    ).rejects.toThrow("Claim unavailable");
    expect(await balance(db, "attacker")).toBe(tokens);
    expect(await savedWar(db)).toMatchObject({ status: "ACTIVE", endedAt: null });
    const caller = callerForDatabase(warRouter, "attacker-kage", db);
    const results = await Promise.all([
      caller.buildShrine({ warId }),
      caller.buildShrine({ warId }),
    ]);
    expect(results.some((row) => row.success)).toBe(true);
    expect(await balance(db, "attacker")).toBe(tokens - WAR_PURCHASE_SHRINE_TOKEN_COST);
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  it("acceptance creates one membership and moves a payment once under concurrent retries", async () => {
    const db = await seed();
    await addOffer(db);
    expect(
      (
        await Promise.all([
          acceptWarAllyOffer(db, offer),
          acceptWarAllyOffer(db, offer),
        ])
      ).every((row) => row.success),
    ).toBe(true);
    expect(await db.select().from(warAlly)).toHaveLength(1);
    expect(await balance(db, "attacker")).toBe(tokens - 100);
    expect(await balance(db, "ally")).toBe(tokens + 100);
    expect((await db.query.userRequest.findFirst())?.status).toBe("ACCEPTED");
  });

  it("an interrupted payment leaves a hidden receipt that retry can deliver", async () => {
    const db = await seed();
    await addOffer(db);
    const client = intercept(db, async (query, execute) => {
      if (sqlText(query).includes("UPDATE `UserRequest` r"))
        throw new Error("Payment unavailable");
      return execute();
    });
    await expect(acceptWarAllyOffer(client, offer)).rejects.toThrow(
      "Payment unavailable",
    );
    expect((await snapshot(db)).warAllies).toHaveLength(0);
    expect(await balance(db, "ally")).toBe(tokens);
    expect((await acceptWarAllyOffer(db, offer)).success).toBe(true);
    expect((await snapshot(db)).warAllies).toHaveLength(1);
    expect(await balance(db, "ally")).toBe(tokens + 100);
  });

  for (const operation of ["cancel", "reject"] as const) {
    const closingVillageId = operation === "cancel" ? "attacker" : "ally";
    const closedStatus = operation === "cancel" ? "CANCELLED" : "REJECTED";
    const closeOffer = (db: DrizzleClient, userId = `${closingVillageId}-kage`) => {
      const caller = callerForDatabase(warRouter, userId, db);
      return operation === "cancel"
        ? caller.cancelAllyOffer({ offerId: offer.offerId })
        : caller.rejectAllyOffer({ id: offer.offerId });
    };

    for (const failure of ["write", "response"] as const)
      it(`${operation} keeps closure and reservation release atomic after a failed ${failure}`, async () => {
        const db = await seed();
        await db.update(war).set({ defenderWarHealth: 100 });
        await addOffer(db);
        let actorVillageId = "ally";
        stubKage(db, () => actorVillageId);
        const paymentFailure = intercept(db, async (query, execute) => {
          if (sqlText(query).includes("UPDATE `UserRequest` r"))
            throw new Error("Payment unavailable");
          return execute();
        });
        await expect(
          callerForDatabase(warRouter, "ally-kage", paymentFailure).acceptAllyOffer({
            offerId: offer.offerId,
          }),
        ).rejects.toThrow("Payment unavailable");
        const closeFailure = intercept(db, async (_query, execute) => {
          if (failure === "response") await execute();
          throw new Error("Closure unavailable");
        });
        actorVillageId = closingVillageId;
        await expect(closeOffer(closeFailure)).rejects.toThrow("Closure unavailable");
        const refreshed = await callerForDatabase(
          warRouter,
          `${closingVillageId}-kage`,
          db,
        ).getAllyOffers();
        expect(refreshed[0]?.status).toBe(
          failure === "write" ? "PENDING" : closedStatus,
        );
        const reservation = await db.query.warAlly.findFirst();
        expect(reservation?.acceptedAt).toBeNull();
        expect(reservation?.endedAt !== null).toBe(failure === "response");
        expect(reservation?.activeVillageId).toBe(failure === "write" ? "ally" : null);
        expect((await snapshot(db)).warAllies).toHaveLength(0);
        expect(await balance(db, "ally")).toBe(tokens);
        expect(await balance(db, "attacker")).toBe(tokens);

        actorVillageId = "other";
        expect((await closeOffer(db, "other-kage")).success).toBe(false);
        expect(await db.select().from(warAlly)).toHaveLength(1);
        actorVillageId = closingVillageId;
        if (failure === "write") expect((await closeOffer(db)).success).toBe(true);
        expect((await closeOffer(db)).success).toBe(false);
        expect((await db.query.warAlly.findFirst())?.endedAt).not.toBeNull();

        await db.insert(userRequest).values({
          id: "replacement-offer",
          type: "WAR_ALLY",
          status: "PENDING",
          senderId: "attacker-kage",
          receiverId: "ally-kage",
          relatedId: warId,
          value: 100,
        });
        actorVillageId = "ally";
        expect(
          (
            await callerForDatabase(warRouter, "ally-kage", db).acceptAllyOffer({
              offerId: "replacement-offer",
            })
          ).success,
        ).toBe(true);
        expect(await balance(db, "ally")).toBe(tokens + 100);
        expect(await balance(db, "attacker")).toBe(tokens - 100);
        expect((await snapshot(db)).warAllies).toHaveLength(1);
      });

    it(`${operation} overlapping acceptance commits either closure or the complete payment`, async () => {
      const db = await seed();
      await addOffer(db);
      stubKage(db, closingVillageId);
      const [closed, accepted] = await Promise.all([
        closeOffer(db),
        acceptWarAllyOffer(db, offer),
      ]);
      expect(closed.success).toBe(!accepted.success);
      expect((await db.query.userRequest.findFirst())?.status).toBe(
        closed.success ? closedStatus : "ACCEPTED",
      );
      expect((await snapshot(db)).warAllies).toHaveLength(accepted.success ? 1 : 0);
      expect(
        (await db.select().from(warAlly)).some(
          (row) => !row.acceptedAt && !row.endedAt,
        ),
      ).toBe(false);
      expect(await balance(db, "ally")).toBe(tokens + (accepted.success ? 100 : 0));
      expect(await balance(db, "attacker")).toBe(tokens - (accepted.success ? 100 : 0));
    });

    it(`${operation} cannot remove membership or payment when acceptance wins its status claim`, async () => {
      const db = await seed();
      await addOffer(db);
      stubKage(db, closingVillageId);
      const acceptanceFirst = intercept(db, async (_query, execute) => {
        expect((await acceptWarAllyOffer(db, offer)).success).toBe(true);
        return execute();
      });
      expect((await closeOffer(acceptanceFirst)).success).toBe(false);
      expect((await closeOffer(db)).success).toBe(false);
      expect(await db.query.warAlly.findFirst()).toMatchObject({
        tokensPaid: 100,
        endedAt: null,
      });
      expect((await snapshot(db)).warAllies).toHaveLength(1);
      expect(await balance(db, "ally")).toBe(tokens + 100);
      expect(await balance(db, "attacker")).toBe(tokens - 100);
      expect((await db.query.userRequest.findFirst())?.status).toBe("ACCEPTED");

      // Closed requests preserve paid history and cannot claim closure again.
      await db.update(userRequest).set({ status: closedStatus });
      await db.update(warAlly).set({ endedAt: new Date(0) });
      expect((await closeOffer(db)).success).toBe(false);
      expect(await db.query.warAlly.findFirst()).toEqual(
        expect.objectContaining({
          tokensPaid: 100,
          endedAt: new Date(0),
        }),
      );
      expect(await balance(db, "ally")).toBe(tokens + 100);
      expect(await balance(db, "attacker")).toBe(tokens - 100);
    });

    for (const phase of ["reservation", "payment"] as const)
      it(`${operation} before delayed ${phase} cannot leave an unpaid reservation`, async () => {
        const db = await seed();
        await addOffer(db);
        stubKage(db, closingVillageId);
        const delayed = intercept(db, async (query, execute) => {
          if (
            sqlText(query).includes(
              phase === "reservation"
                ? "INSERT IGNORE INTO `WarAlly`"
                : "UPDATE `UserRequest` r",
            )
          )
            expect((await closeOffer(db)).success).toBe(true);
          return execute();
        });
        expect((await acceptWarAllyOffer(delayed, offer)).success).toBe(false);
        expect(await db.select().from(warAlly)).toHaveLength(0);
        expect((await db.query.userRequest.findFirst())?.status).toBe(closedStatus);
        expect(await balance(db, "ally")).toBe(tokens);
        expect(await balance(db, "attacker")).toBe(tokens);
      });
  }

  it("insufficient funds and an ended war reject admission without moving tokens", async () => {
    const db = await seed();
    await addOffer(db, tokens + 1);
    expect((await acceptWarAllyOffer(db, offer)).success).toBe(false);
    expect(await db.select().from(warAlly)).toHaveLength(0);
    expect(await balance(db, "ally")).toBe(tokens);
    await db.update(userRequest).set({ value: 100 });
    await handleWarEnd(await snapshot(db), db);
    expect((await acceptWarAllyOffer(db, offer)).success).toBe(false);
    expect(await balance(db, "ally")).toBe(tokens);
  });

  it("keeps a successful claim retryable when its receipt cannot be reloaded", async () => {
    const db = await seed();
    const initial = await snapshot(db);
    const read = spyOn(db.query.war, "findFirst").mockRejectedValueOnce(
      new Error("Receipt read unavailable"),
    );
    try {
      const ended = await handleWarEnd(initial, db);
      expect(ended.status).toBe("ATTACKER_VICTORY");
      expect(ended.settlementPending).toBe(true);
    } finally {
      read.mockRestore();
    }
    expect((await savedWar(db))?.settlementPending).toBe(true);
    await fetchActiveWars(db);
    expect((await savedWar(db))?.settlementPending).toBe(false);
    expect(await balance(db, "attacker")).toBe(tokens + WAR_VICTORY_TOKEN_BONUS);
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  for (const waitForLock of [false, true])
    it(`cleans preclaim shrine queues and quests ${waitForLock ? "while the terminal update waits on a row lock" : "before the terminal update"}`, async () => {
      const db = await seed("SECTOR_WAR");
      stubUser(db, "attacker-user", { village: true });
      const trigger = spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      const connection = waitForLock
        ? await mysql.createConnection(process.env.TEST_MYSQL_URL!)
        : undefined;
      if (connection) {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM War WHERE id = ? FOR UPDATE", [warId]);
      }
      let admittedAt: Date | undefined;
      const client = intercept(db, async (query, execute) => {
        if (!admittedAt && sqlText(query).trimStart().startsWith("UPDATE `War`")) {
          const pending = connection ? execute() : undefined;
          await new Promise((resolve) => setTimeout(resolve, 50));
          expect((await savedWar(db))?.status).toBe("ACTIVE");
          expect(
            (
              await callerForDatabase(
                shrineRouter,
                "attacker-user",
                db,
              ).challengeShrine({
                sectorNumber: sectorId,
              })
            ).success,
          ).toBe(true);
          admittedAt = (await db.query.mpvpBattleQueue.findFirst())?.createdAt;
          await db.insert(questHistory).values({
            id: "preclaim-quest",
            userId: "attacker-user",
            questId: "war-quest",
            questType: "war",
            startedAt: admittedAt,
          });
          await connection?.commit();
          if (pending) return pending;
        }
        return execute();
      });
      try {
        const ended = await handleWarEnd(await snapshot(db), client, {
          shrineBuilderId: "attacker-kage",
        });
        expect(ended.status).toBe("ATTACKER_VICTORY");
        expect((await savedWar(db))?.settlementPending).toBe(false);
        expect(await db.select().from(mpvpBattleQueue)).toHaveLength(0);
        expect(await db.select().from(mpvpBattleUser)).toHaveLength(0);
        expect(await db.select().from(questHistory)).toHaveLength(0);
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, "attacker-user"),
            })
          )?.status,
        ).toBe("AWAKE");
        expect(ended.settlement?.cleanupCutoff).toBeGreaterThanOrEqual(
          admittedAt?.getTime() ?? 0,
        );
        expect((await savedWar(db))?.endedAt).toEqual(ended.endedAt);
        expect((await db.query.sector.findFirst())?.capturedAt).toEqual(ended.endedAt);
      } finally {
        trigger.mockRestore();
        await connection?.rollback();
        await connection?.end();
      }
    });

  it("delayed delivery preserves quests and shrine queues created after the settlement", async () => {
    const db = await seed();
    const client = intercept(db, async (query, execute) => {
      if (sqlText(query).includes("DELETE qh")) throw new Error("Cleanup unavailable");
      return execute();
    });
    const ended = await handleWarEnd(await snapshot(db), client);
    if (!ended.settlement?.cleanupCutoff) throw new Error("Missing cleanup cutoff");
    const cutoff = ended.settlement.cleanupCutoff;
    const later = new Date(cutoff + 60_000);
    await db.insert(questHistory).values([
      {
        id: "old-quest",
        userId: "attacker-user",
        questId: "old",
        questType: "war",
        startedAt: new Date(0),
      },
      {
        id: "new-quest",
        userId: "attacker-user",
        questId: "new",
        questType: "war",
        startedAt: later,
      },
    ]);
    await db.insert(mpvpBattleQueue).values({
      id: "new-queue",
      battleType: "SHRINE_BATTLE",
      attackerEntityId: "attacker",
      defenderEntityId: "defender",
      createdAt: later,
    });
    await db.insert(mpvpBattleUser).values({
      id: "new-user",
      userId: "attacker-user",
      clanBattleId: "new-queue",
      side: "ATTACKER",
      slot: 0,
    });
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "attacker-user"));
    await fetchActiveWars(db);
    expect((await savedWar(db))?.settlement?.cleanupCutoff).toBe(cutoff);
    expect((await db.select().from(questHistory)).map((row) => row.id)).toEqual([
      "new-quest",
    ]);
    expect(await db.select().from(mpvpBattleQueue)).toHaveLength(1);
    expect(await db.select().from(mpvpBattleUser)).toHaveLength(1);
    expect(
      (
        await db.query.userData.findFirst({
          where: eq(userData.userId, "attacker-user"),
        })
      )?.status,
    ).toBe("QUEUED");
  });
});
