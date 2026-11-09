import { afterAll, afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  IMG_AVATAR_DEFAULT,
  SHRINE_BATTLE_LOBBY_SECONDS,
  VILLAGE_SYNDICATE_ID,
  WAR_ESPIONAGE_TARGET,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  jutsuLoadout,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  sector,
  userData,
  village,
  villageAlliance,
  war,
  warActionReceipt,
  warAlly,
  warCamp,
  warContribution,
  warKill,
  warMercenary,
} from "@/drizzle/schema";
import { updateWars } from "@/libs/combat/database";
import { settleObjectiveWarCombat } from "@/libs/combat/objectiveWar";
import { calcBattleResult, getBattleTeamWars } from "@/libs/combat/settlement";
import type {
  CombatQueryUser,
  CombatResult,
  CompleteBattle,
} from "@/libs/combat/types";
import { getWarSide } from "@/libs/objectiveWar";
import { Pusher } from "@/libs/pusher";
import { isWarMissionAvailable } from "@/libs/quest/missionHall";
import { fetchBattleEssentials } from "@/queries/combat";
import { combatRouter } from "@/server/api/routers/combat";
import { fetchUpdatedUser, type UserWithRelations } from "@/server/api/routers/profile";
import { shrineRouter } from "@/server/api/routers/shrine";
import { travelRouter } from "@/server/api/routers/travel";
import { fetchActiveWars, warRouter } from "@/server/api/routers/war";
import type { DrizzleClient } from "@/server/db";
import { updateRewards } from "@/server/utils/questRewards";
import { canEnterWarCampSector } from "@/server/utils/warMercenary";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import { defaultWarRules } from "@/validators/war";
import { insertLobbyBattle, preloadLobby } from "../../../libs/combat/helpers/preload";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const seed = async () => {
  const db = await getTestDatabase();
  await resetTables(
    warActionReceipt,
    warContribution,
    warKill,
    quest,
    warMercenary,
    warCamp,
    warAlly,
    war,
    village,
    userData,
  );
  await db.insert(village).values([
    { id: "a", name: "A", sector: 1, kageId: "kage", tokens: 20 },
    { id: "b", kageId: "enemy-kage", name: "B", sector: 2 },
    { id: "c", kageId: "neutral-kage", name: "C", sector: 3 },
  ]);
  await insertUsers([
    { userId: "kage", villageId: "a" },
    ...["merc", "merc2", "merc3", "merc4"].map((userId) => ({
      userId,
      villageId: "c",
      money: 10,
    })),
    { userId: "enemy", villageId: "b" },
  ]);
  await db.insert(war).values({
    id: "w",
    type: "VILLAGE_WAR",
    status: "ACTIVE",
    attackerVillageId: "a",
    defenderVillageId: "b",
    combatStartedAt: new Date(Date.now() - 3600000),
    rules: defaultWarRules,
    objectiveState: { attackerEspionage: 0, defenderEspionage: 0, objectives: [] },
  });
  return db;
};
/** `merc` accepts a paid contract from `kage`. */
const hireMerc = async (db: DrizzleClient, tokens: number) => {
  const invited = await callerForDatabase(warRouter, "kage", db).inviteMercenary({
    warId: "w",
    userId: "merc",
    tokens,
  });
  expect(invited.success).toBe(true);
  const contract = (await db.query.warMercenary.findFirst())!;
  expect(
    (
      await callerForDatabase(warRouter, "merc", db).acceptMercenary({
        contractId: contract.id,
      })
    ).success,
  ).toBe(true);
  return contract;
};
const insertEspionageQuest = async (db: DrizzleClient) => {
  await db.insert(quest).values({
    id: "espionage",
    name: "Spy",
    questType: "war",
    questRank: "C",
    hidden: false,
    content: {
      objectives: [
        SimpleObjective.parse({
          id: "spy",
          task: "espionage",
          durationSeconds: 1,
          value: 10,
        }),
      ],
      reward: ObjectiveReward.parse({}),
      sceneBackground: "",
      sceneCharacters: [],
    },
  });
};
afterAll(async () => {
  await resetTables(warMercenary);
});

describeWithDatabase("war mercenary contracts", () => {
  beforeEach(seed);

  it("loads camp notices in one statement with village, ally and mercenary authorization intact", async () => {
    const db = await getTestDatabase();
    await db.insert(warCamp).values({
      id: "camp",
      warId: "w",
      sector: 5,
      guardianId: "guardian",
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 3600000),
    });
    const kage = callerForDatabase(warRouter, "kage", db);
    const merc = callerForDatabase(warRouter, "merc", db);
    const measured = await recordQueries(() => kage.getWarCampNotices());
    expect(measured.statements).toHaveLength(1);
    expect(measured.result.map(({ id }) => id)).toEqual(["camp"]);
    expect(await merc.getWarCampNotices()).toEqual([]);
    await db.insert(warAlly).values({
      id: "ally",
      warId: "w",
      villageId: "c",
      supportVillageId: "a",
      tokensPaid: 0,
      acceptedAt: new Date(),
    });
    expect((await merc.getWarCampNotices()).map(({ id }) => id)).toEqual(["camp"]);
    await db.update(warAlly).set({ endedAt: new Date() }).where(eq(warAlly.id, "ally"));
    expect(await merc.getWarCampNotices()).toEqual([]);
    await db
      .update(userData)
      .set({ villageId: null })
      .where(eq(userData.userId, "merc"));
    await db.insert(warMercenary).values({
      id: "contract",
      warId: "w",
      sideVillageId: "a",
      userId: "merc",
      invitedById: "kage",
      tokens: 0,
      slot: 0,
      acceptedAt: new Date(),
    });
    expect((await merc.getWarCampNotices()).map(({ id }) => id)).toEqual(["camp"]);
    await db
      .update(warCamp)
      .set({ resolvedAt: new Date() })
      .where(eq(warCamp.id, "camp"));
    expect(await merc.getWarCampNotices()).toEqual([]);
  });

  it("accepts and pays once across concurrent retries, then releases the slot on resignation", async () => {
    const db = await getTestDatabase();
    const kage = callerForDatabase(warRouter, "kage", db);
    expect(
      (await kage.inviteMercenary({ warId: "w", userId: "merc", tokens: 4 })).success,
    ).toBe(true);
    const contract = (await db.query.warMercenary.findFirst())!;
    const merc = callerForDatabase(warRouter, "merc", db);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        merc.acceptMercenary({ contractId: contract.id }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
        ?.money,
    ).toBe(4010);
    expect(
      (await db.query.village.findFirst({ where: eq(village.id, "a") }))?.tokens,
    ).toBe(16);
    expect(
      (await merc.getObjectiveWarInfo({ warId: "w" }))?.war.warMercenaries,
    ).toHaveLength(1);
    await db
      .update(userData)
      .set({
        warMission: {
          id: "mission",
          warId: "w",
          questId: "q",
          objectiveId: "o",
          villageId: "c",
          sideVillageId: "a",
          sector: 1,
          task: "espionage",
          value: 1,
          endsAt: new Date().toISOString(),
        },
      })
      .where(eq(userData.userId, "merc"));
    expect((await merc.leaveMercenary({ contractId: contract.id })).success).toBe(true);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
        ?.warMission,
    ).toBeNull();
    expect((await db.query.warMercenary.findFirst())?.activeUserId).toBeNull();
    expect(await merc.getObjectiveWarInfo({ warId: "w" })).toBeNull();
  });
  it("closes contracts and missions when staff end the war", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "staff", username: "Staff", role: "OWNER" }]);
    await db.insert(warMercenary).values({
      id: "contract",
      warId: "w",
      sideVillageId: "a",
      userId: "merc",
      invitedById: "kage",
      tokens: 0,
      slot: 0,
      acceptedAt: new Date(),
    });
    await db
      .update(userData)
      .set({
        warMission: {
          id: "mission",
          warId: "w",
          questId: "q",
          objectiveId: "o",
          villageId: "c",
          sideVillageId: "a",
          sector: 1,
          task: "espionage",
          value: 1,
          endsAt: new Date().toISOString(),
        },
      })
      .where(eq(userData.userId, "merc"));
    expect(
      (await callerForDatabase(warRouter, "staff", db).adminEndWar({ warId: "w" }))
        .success,
    ).toBe(true);
    const contract = await db.query.warMercenary.findFirst();
    expect(contract?.endedAt).not.toBeNull();
    expect(contract?.activeUserId).toBeNull();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
        ?.warMission,
    ).toBeNull();
  });
  it.each(["kage", "merc"])(
    "preserves an ally mission when %s closes an unaccepted invitation",
    async (actor) => {
      const db = await getTestDatabase();
      await db.insert(warAlly).values({
        id: "ally",
        warId: "w",
        villageId: "c",
        supportVillageId: "a",
        tokensPaid: 1,
        acceptedAt: new Date(),
      });
      await db
        .update(userData)
        .set({ rank: "JONIN", sector: 2 })
        .where(eq(userData.userId, "merc"));
      await insertEspionageQuest(db);
      const merc = callerForDatabase(warRouter, "merc", db);
      expect(
        (
          await merc.startWarMission({
            warId: "w",
            questId: "espionage",
            objectiveId: "spy",
          })
        ).success,
      ).toBe(true);
      const mission = (await db.query.userData.findFirst({
        where: eq(userData.userId, "merc"),
      }))!.warMission;
      expect(
        (
          await callerForDatabase(warRouter, "kage", db).inviteMercenary({
            warId: "w",
            userId: "merc",
            tokens: 1,
          })
        ).success,
      ).toBe(true);
      const offer = (await db.query.warMercenary.findFirst())!;
      expect(offer.acceptedAt).toBeNull();
      expect(
        (
          await callerForDatabase(warRouter, actor, db).leaveMercenary({
            contractId: offer.id,
          })
        ).success,
      ).toBe(true);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
          ?.warMission,
      ).toEqual(mission);
      expect((await db.query.warMercenary.findFirst())?.endedAt).not.toBeNull();
    },
  );
  it("reserves at most three slots even when invitations race", async () => {
    const db = await getTestDatabase();
    const kage = callerForDatabase(warRouter, "kage", db);
    await Promise.all(
      ["merc", "merc2", "merc3", "merc4"].map((userId) =>
        kage.inviteMercenary({ warId: "w", userId, tokens: 1 }),
      ),
    );
    for (const userId of ["merc", "merc2", "merc3", "merc4"])
      await kage.inviteMercenary({ warId: "w", userId, tokens: 1 });
    expect(await db.query.warMercenary.findMany()).toHaveLength(3);
  });
  it("carries the existing identity mask into contributions and sector profiles, except for self", async () => {
    const db = await getTestDatabase();
    await db.insert(warMercenary).values([
      {
        id: "contract",
        warId: "w",
        sideVillageId: "a",
        userId: "merc",
        invitedById: "kage",
        tokens: 1,
        slot: 0,
        acceptedAt: new Date(),
      },
      {
        id: "contract2",
        warId: "w",
        sideVillageId: "a",
        userId: "merc2",
        invitedById: "kage",
        tokens: 1,
        slot: 1,
        acceptedAt: new Date(),
      },
    ]);
    await db.insert(warContribution).values([
      { warId: "w", userId: "merc", damage: 100 },
      { warId: "w", userId: "merc2", damage: 75 },
      { warId: "w", userId: "kage", damage: 50 },
    ]);
    await db.insert(warKill).values(
      ["merc", "merc", "merc2"].map((killerId, index) => ({
        id: `kill-${index}`,
        warId: "w",
        killerId,
        victimId: "enemy",
        killerVillageId: "a",
        victimVillageId: "b",
      })),
    );
    await db
      .update(userData)
      .set({ status: "AWAKE", sector: 1, updatedAt: new Date() });
    for (const viewer of ["kage", "enemy", "merc"]) {
      const info = (await callerForDatabase(warRouter, viewer, db).getObjectiveWarInfo({
        warId: "w",
      }))!;
      for (const rows of [info.contributions, info.combatContributions]) {
        expect(rows).toHaveLength(3);
        expect(rows.filter((row) => row.userId === null)).toHaveLength(
          viewer === "merc" ? 1 : 2,
        );
        const mercenary = rows.find((row) =>
          "damage" in row ? row.damage === 100 : row.kills === 2,
        )!;
        expect(mercenary.userId).toBe(viewer === "merc" ? "merc" : null);
        expect(mercenary.isMasked).toBe(viewer !== "merc");
        expect(mercenary.username === "Mercenary").toBe(viewer !== "merc");
        expect(
          rows.find((row) => row.userId === ("damage" in mercenary ? "kage" : "enemy")),
        ).toMatchObject({
          isMasked: false,
          userId: "damage" in mercenary ? "kage" : "enemy",
        });
      }
      const sectorData = await callerForDatabase(
        travelRouter,
        viewer,
        db,
      ).getSectorData({ sector: 1 });
      const mercenary = sectorData.users.find((row) => row.userId === "merc")!;
      expect(mercenary.isMasked).toBe(viewer !== "merc");
      expect(mercenary.username === "Mercenary").toBe(viewer !== "merc");
    }
    const kage = callerForDatabase(warRouter, "kage", db);
    expect(
      (await kage.getMercenaries({ warId: "w" })).roster[0]!.user?.username,
    ).not.toBe("Mercenary");
    await kage.leaveMercenary({ contractId: "contract" });
    expect(
      (await kage.getObjectiveWarInfo({ warId: "w" }))!.contributions.find(
        (row) => row.damage === 100,
      ),
    ).toMatchObject({ isMasked: true, username: "Mercenary", userId: null });
  });
  it("masks accepted mercenary kill history while preserving self, ordinary players and credited sides", async () => {
    const db = await getTestDatabase();
    for (const userId of ["merc", "merc2", "merc3", "kage", "enemy"]) {
      await db
        .update(userData)
        .set({
          username: `Real_${userId}`,
          avatar: `https://example.com/${userId}.png`,
        })
        .where(eq(userData.userId, userId));
    }
    await db.insert(warMercenary).values([
      {
        id: "killer-contract",
        warId: "w",
        sideVillageId: "a",
        userId: "merc",
        invitedById: "kage",
        tokens: 1,
        slot: 0,
        acceptedAt: new Date(),
      },
      {
        id: "victim-contract",
        warId: "w",
        sideVillageId: "b",
        userId: "merc2",
        invitedById: "enemy",
        tokens: 1,
        slot: 0,
        acceptedAt: new Date(),
      },
      {
        id: "pending-contract",
        warId: "w",
        sideVillageId: "a",
        userId: "merc3",
        invitedById: "kage",
        tokens: 1,
        slot: 1,
      },
    ]);
    await db.insert(warKill).values([
      {
        id: "merc-kill",
        warId: "w",
        killerId: "merc",
        victimId: "merc2",
        killerVillageId: "a",
        victimVillageId: "b",
        townhallHpChange: 15,
        shrineHpChange: 8,
        killedAt: new Date(3000),
      },
      {
        id: "native-kill",
        warId: "w",
        killerId: "kage",
        victimId: "enemy",
        killerVillageId: "a",
        victimVillageId: "b",
        townhallHpChange: -5,
        shrineHpChange: -5,
        killedAt: new Date(2000),
      },
      {
        id: "pending-kill",
        warId: "w",
        killerId: "merc3",
        victimId: "enemy",
        killerVillageId: "c",
        victimVillageId: "b",
        killedAt: new Date(1000),
      },
    ]);
    for (const dismissed of [false, true]) {
      if (dismissed) await db.update(warMercenary).set({ endedAt: new Date() });
      for (const viewer of ["kage", "merc4", "merc", "merc2"]) {
        const caller = callerForDatabase(warRouter, viewer, db);
        const kills = await caller.getWarKills({ warId: "w" });
        expect(kills.map((kill) => kill.id)).toEqual([
          "merc-kill",
          "native-kill",
          "pending-kill",
        ]);
        const kill = kills[0]!;
        expect(kill.killer).toEqual({
          userId: viewer === "merc" ? "merc" : null,
          username: viewer === "merc" ? "Real_merc" : "Mercenary",
          avatar:
            viewer === "merc" ? "https://example.com/merc.png" : IMG_AVATAR_DEFAULT,
        });
        expect(kill.victim).toEqual({
          userId: viewer === "merc2" ? "merc2" : null,
          username: viewer === "merc2" ? "Real_merc2" : "Mercenary",
          avatar:
            viewer === "merc2" ? "https://example.com/merc2.png" : IMG_AVATAR_DEFAULT,
        });
        expect(kill.killerId).toBe(viewer === "merc" ? "merc" : null);
        expect(kill.victimId).toBe(viewer === "merc2" ? "merc2" : null);
        expect(kill.killerVillage).toEqual({ id: "a", name: "A" });
        expect(kill.victimVillage).toEqual({ id: "b", name: "B" });
        expect(kills[1]!).toMatchObject({
          killerId: "kage",
          victimId: "enemy",
          killer: { userId: "kage" },
          victim: { userId: "enemy" },
        });
        expect(kills[1]!.killer.username).toBe("Real_kage");
        expect(kills[1]!.killer.avatar).toBe("https://example.com/kage.png");
        expect(kills[2]!).toMatchObject({
          killerId: "merc3",
          killer: { userId: "merc3", username: "Real_merc3" },
        });
        for (const aggregateBy of [
          "totalKills",
          "townhallHpChange",
          "shrineHpChange",
        ] as const) {
          const stats = await caller.getWarKillStats({ warId: "w", aggregateBy });
          const row = stats.find(
            (entry) => entry.killerId === (viewer === "merc" ? "merc" : null),
          )!;
          expect(row).toMatchObject({
            killerId: viewer === "merc" ? "merc" : null,
            killerUsername: viewer === "merc" ? "Real_merc" : "Mercenary",
            killerAvatar:
              viewer === "merc" ? "https://example.com/merc.png" : IMG_AVATAR_DEFAULT,
            villageId: viewer === "merc" ? "c" : null,
            villageName: viewer === "merc" ? "C" : null,
          });
          expect(Number(row.count)).toBe(
            aggregateBy === "totalKills"
              ? 1
              : aggregateBy === "townhallHpChange"
                ? 15
                : 8,
          );
          expect(stats.find((entry) => entry.killerId === "kage")).toMatchObject({
            killerUsername: "Real_kage",
            killerAvatar: "https://example.com/kage.png",
            villageId: "a",
            villageName: "A",
          });
          expect(stats.find((entry) => entry.killerId === "merc3")).toMatchObject({
            killerUsername: "Real_merc3",
            villageId: "c",
            villageName: "C",
          });
        }
      }
    }
  });
  it("rechecks funds, leadership, war lifetime and enemy eligibility before payment", async () => {
    const db = await getTestDatabase();
    const kage = callerForDatabase(warRouter, "kage", db);
    expect(
      (await kage.inviteMercenary({ warId: "w", userId: "enemy", tokens: 1 })).success,
    ).toBe(false);
    expect(
      (await kage.inviteMercenary({ warId: "w", userId: "merc", tokens: 4 })).success,
    ).toBe(true);
    const offer = (await db.query.warMercenary.findFirst())!;
    const merc = callerForDatabase(warRouter, "merc", db);
    await db.update(village).set({ tokens: 0 }).where(eq(village.id, "a"));
    expect((await merc.acceptMercenary({ contractId: offer.id })).success).toBe(false);
    await db
      .update(village)
      .set({ tokens: 20, kageId: "replacement" })
      .where(eq(village.id, "a"));
    expect((await merc.acceptMercenary({ contractId: offer.id })).success).toBe(false);
    await db.update(village).set({ kageId: "kage" }).where(eq(village.id, "a"));
    await db
      .update(userData)
      .set({ villageId: "b" })
      .where(eq(userData.userId, "merc"));
    expect((await merc.acceptMercenary({ contractId: offer.id })).success).toBe(false);
    await db
      .update(userData)
      .set({ villageId: "c" })
      .where(eq(userData.userId, "merc"));
    await db
      .update(war)
      .set({ endedAt: new Date(), status: "DRAW" })
      .where(eq(war.id, "w"));
    expect((await merc.acceptMercenary({ contractId: offer.id })).success).toBe(false);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
        ?.money,
    ).toBe(10);
  });
  it("permits camp entry only for participants and keeps existing occupants free to leave", async () => {
    const db = await getTestDatabase();
    await db.insert(warCamp).values({
      id: "camp",
      warId: "w",
      sector: 12,
      guardianId: "guardian",
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
    });
    const outsider = { userId: "merc", villageId: "c", sector: 11 };
    expect(await canEnterWarCampSector(db, outsider, 12)).toBe(false);
    expect(
      await canEnterWarCampSector(
        db,
        { userId: "kage", villageId: "a", sector: 11 },
        12,
      ),
    ).toBe(true);
    expect(await canEnterWarCampSector(db, { ...outsider, sector: 12 }, 11)).toBe(true);
    await hireMerc(db, 1);
    expect(await canEnterWarCampSector(db, outsider, 12)).toBe(true);
  });
});

describeWithDatabase("mercenary exclusivity", () => {
  beforeEach(seed);
  it("accepts only one war contract even when different offers are accepted together", async () => {
    const db = await getTestDatabase();
    const activeWar = (await db.query.war.findFirst())!;
    await db.insert(war).values({ ...activeWar, id: "w2" });
    await db.insert(warMercenary).values(
      ["w", "w2"].map((warId) => ({
        id: warId,
        warId,
        sideVillageId: "a",
        userId: "merc",
        invitedById: "kage",
        tokens: 2,
        slot: 0,
      })),
    );
    const caller = callerForDatabase(warRouter, "merc", db);
    const results = await Promise.all(
      ["w", "w2"].map((contractId) => caller.acceptMercenary({ contractId })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
        ?.money,
    ).toBe(2010);
  });
});

describeWithDatabase("mercenary strategic participation", () => {
  beforeEach(seed);
  afterEach(() => vi.restoreAllMocks());
  it.each([false, true])(
    "requires village-less shrine parties to belong to the hired war (objective: %s)",
    async (isObjective) => {
      const db = await getTestDatabase();
      await resetTables(mpvpBattleUser, mpvpBattleQueue, sector);
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await db
        .update(userData)
        .set({ villageId: null, status: "AWAKE", sector: isObjective ? 102 : 101 })
        .where(eq(userData.userId, "merc"));
      await db.insert(warMercenary).values({
        id: "contract",
        warId: "w",
        sideVillageId: "a",
        userId: "merc",
        invitedById: "kage",
        tokens: 1,
        slot: 0,
        acceptedAt: new Date(),
      });
      await db
        .update(war)
        .set({
          objectiveState: {
            attackerEspionage: WAR_ESPIONAGE_TARGET,
            defenderEspionage: 0,
            objectives: [
              {
                sector: 102,
                villageId: "b",
                hp: 100,
                maxHp: 100,
                destroyed: false,
                isReserve: false,
              },
            ],
          },
        })
        .where(eq(war.id, "w"));
      await db.insert(sector).values({
        sector: isObjective ? 102 : 101,
        villageId: isObjective ? "b" : VILLAGE_SYNDICATE_ID,
        shrineLevel: 1,
      });
      const result = await callerForDatabase(shrineRouter, "merc", db).challengeShrine({
        sectorNumber: isObjective ? 102 : 101,
      });
      expect(result.success).toBe(isObjective);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "merc") }))
          ?.status,
      ).toBe(isObjective ? "QUEUED" : "AWAKE");
      expect((await db.query.mpvpBattleQueue.findFirst())?.attackerEntityId).toBe(
        isObjective ? "a" : undefined,
      );
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(
        isObjective ? 1 : 0,
      );
    },
  );
  it.each([false, true])(
    "restricts village-less mercenary joins to their objective war and preserves village joins (objective: %s)",
    async (isObjective) => {
      const db = await getTestDatabase();
      await resetTables(mpvpBattleUser, mpvpBattleQueue, sector, villageAlliance);
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await db.update(userData).set({ status: "AWAKE", sector: 101 });
      await db
        .update(userData)
        .set({ villageId: null })
        .where(eq(userData.userId, "merc"));
      await db
        .update(userData)
        .set({ villageId: null })
        .where(eq(userData.userId, "merc2"));
      await db
        .update(userData)
        .set({ villageId: "a" })
        .where(eq(userData.userId, "merc3"));
      await db.insert(warMercenary).values([
        {
          id: "attacker-contract",
          warId: "w",
          sideVillageId: "a",
          userId: "merc",
          invitedById: "kage",
          tokens: 1,
          slot: 0,
          acceptedAt: new Date(),
        },
        {
          id: "defender-contract",
          warId: "w",
          sideVillageId: "b",
          userId: "merc2",
          invitedById: "enemy",
          tokens: 1,
          slot: 0,
          acceptedAt: new Date(),
        },
      ]);
      await db
        .update(war)
        .set({
          objectiveState: {
            attackerEspionage: WAR_ESPIONAGE_TARGET,
            defenderEspionage: WAR_ESPIONAGE_TARGET,
            objectives: [
              {
                sector: isObjective ? 101 : 102,
                villageId: "b",
                hp: 100,
                maxHp: 100,
                destroyed: false,
                isReserve: false,
              },
            ],
          },
        })
        .where(eq(war.id, "w"));
      await db
        .insert(villageAlliance)
        .values({ id: "enemy", villageIdA: "a", villageIdB: "b", status: "ENEMY" });
      await db.insert(sector).values({ sector: 101, villageId: "b", shrineLevel: 1 });
      const hero = callerForDatabase(shrineRouter, "kage", db);
      expect((await hero.challengeShrine({ sectorNumber: 101 })).success).toBe(true);
      const lobby = (await db.query.mpvpBattleQueue.findFirst())!;
      for (const [userId, side] of [
        ["merc", "ATTACKER"],
        ["merc2", "DEFENDER"],
      ] as const) {
        const caller = callerForDatabase(shrineRouter, userId, db);
        expect(
          (await caller.getShrineBattles({ sectorNumber: 101 }))[0]!.viewerSide,
        ).toBe(isObjective ? side : null);
        const joined = await caller.joinShrineBattle({
          shrineBattleId: lobby.id,
          side,
        });
        expect(joined.success, joined.message).toBe(isObjective);
        expect(
          (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!
            .status,
        ).toBe(isObjective ? "QUEUED" : "AWAKE");
        expect(
          !!(await db.query.mpvpBattleUser.findFirst({
            where: eq(mpvpBattleUser.userId, userId),
          })),
        ).toBe(isObjective);
      }
      for (const [userId, side] of [
        ["merc3", "ATTACKER"],
        ["enemy", "DEFENDER"],
      ] as const) {
        const caller = callerForDatabase(shrineRouter, userId, db);
        expect(
          (await caller.getShrineBattles({ sectorNumber: 101 }))[0]!.viewerSide,
        ).toBe(side);
        expect(
          (await caller.joinShrineBattle({ shrineBattleId: lobby.id, side })).success,
        ).toBe(true);
      }
    },
  );
  it("completes a village-less mercenary mission and retains battle credit after dismissal", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ villageId: null, rank: "JONIN", sector: 2 })
      .where(eq(userData.userId, "merc"));
    const kage = callerForDatabase(warRouter, "kage", db);
    const offer = await hireMerc(db, 2);
    const merc = callerForDatabase(warRouter, "merc", db);
    await insertEspionageQuest(db);
    const started = await merc.startWarMission({
      warId: "w",
      questId: "espionage",
      objectiveId: "spy",
    });
    expect(started.success, started.message).toBe(true);
    const attempt = (await db.query.userData.findFirst({
      where: eq(userData.userId, "merc"),
    }))!.warMission!;
    await db
      .update(userData)
      .set({
        warMission: { ...attempt, endsAt: new Date(Date.now() - 1000).toISOString() },
      })
      .where(eq(userData.userId, "merc"));
    const completed = await merc.completeWarMission({ attemptId: attempt.id });
    expect(completed.success, completed.message).toBe(true);
    expect((await db.query.war.findFirst())?.objectiveState?.attackerEspionage).toBe(
      10,
    );
    const w = (await db.query.war.findFirst())!;
    const winner = {
      userId: "merc",
      villageId: null,
      direction: "left",
      sector: 2,
      curHealth: 100,
    };
    const snapshot = {
      id: "fight",
      battleType: "COMBAT",
      usersState: [
        winner,
        { userId: "enemy", villageId: "b", direction: "right", curHealth: 0 },
      ],
      extraState: {
        villages: {},
        clans: {},
        wars: {
          w: {
            ...w,
            warAllies: [],
            warMercenaries: [{ userId: "merc", sideVillageId: "a" }],
          },
        },
      },
    } as unknown as CompleteBattle;
    expect((await kage.leaveMercenary({ contractId: offer.id })).success).toBe(true);
    await settleObjectiveWarCombat(
      db,
      snapshot,
      { didWin: 1 } as CombatResult,
      snapshot.usersState[0]!,
    );
    expect((await db.query.warContribution.findFirst())?.damage).toBe(
      defaultWarRules.anbuDamage,
    );
    expect((await db.query.warKill.findFirst())?.killerVillageId).toBe("a");
  });
  it("blocks a newly declared home-village war while the hired contract is live", async () => {
    const db = await getTestDatabase();
    await hireMerc(db, 2);
    const merc = callerForDatabase(warRouter, "merc", db);
    const w = (await db.query.war.findFirst())!;
    await db
      .insert(war)
      .values({ ...w, id: "home-war", attackerVillageId: "c", defenderVillageId: "b" });
    expect(await merc.getObjectiveWarInfo({ warId: "home-war" })).toBeNull();
    const activeWars = await fetchActiveWars(db, "c", "merc");
    expect(activeWars.map((w) => w.id)).toEqual(["w"]);
    const { user } = await fetchUpdatedUser({ client: db, userId: "merc" });
    expect((user as UserWithRelations)?.activeWars).toEqual([]);
    expect(
      isWarMissionAvailable({
        questType: "war",
        villageId: "c",
        dailyWarMissions: 0,
        activeWars,
      }),
    ).toBe(false);
    await updateRewards({
      client: db,
      user: user!,
      rewards: PostProcessedRewardSchema.parse({ reward_war_damage: 10 }),
      reason: "QUEST",
    });
    const homeWar = (await db.query.war.findFirst({ where: eq(war.id, "home-war") }))!;
    const hiredWar = (await db.query.war.findFirst({ where: eq(war.id, "w") }))!;
    expect(homeWar.defenderWarHealth).toBe(w.defenderWarHealth);
    expect(hiredWar.defenderWarHealth).toBe(w.defenderWarHealth - 10);
    await db.insert(warCamp).values({
      id: "home-camp",
      warId: "home-war",
      sector: 22,
      guardianId: "guardian",
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
    });
    expect(
      await canEnterWarCampSector(
        db,
        { userId: "merc", villageId: "c", sector: 11 },
        22,
      ),
    ).toBe(false);
  });
  it.each(["none", "merc", "enemy"])(
    "preserves dismissed mercenary allegiance and ANBU credit with loadout switch by %s",
    async (switchingUserId) => {
      const db = await getTestDatabase();
      await resetTables(battle, aiProfile, jutsuLoadout);
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await db.update(userData).set({
        rank: "JONIN",
        level: 20,
        experience: 1000,
        sector: 10,
        curHealth: 100,
        maxHealth: 100,
        curChakra: 100,
        maxChakra: 100,
        curStamina: 100,
        maxStamina: 100,
      });
      await db.update(war).set({ attackerWarHealth: 9000 }).where(eq(war.id, "w"));
      await insertDefaultAiProfile();
      const kage = callerForDatabase(warRouter, "kage", db);
      const offer = await hireMerc(db, 1);
      const essentials = await fetchBattleEssentials(db);
      const users = await db.query.userData.findMany();
      const combatants = users
        .filter((user) => ["merc", "enemy"].includes(user.userId))
        .map((user) => ({
          ...user,
          items: [],
          jutsus: [],
          userSkills: [],
          bloodline: null,
          village:
            essentials.villages.find((village) => village.id === user.villageId) ??
            null,
          aiProfile: essentials.defaultProfile,
        })) as CombatQueryUser[];
      const processed = await preloadLobby(db, combatants, essentials, "COMBAT", {
        leftSideUserIds: ["merc"],
      });
      await insertLobbyBattle(db, "lobby", "COMBAT", processed);
      const before = (await db.query.battle.findFirst({
        where: eq(battle.id, "lobby"),
      }))!;
      expect(getWarSide(before.extraState.wars.w!, "c", "merc")).toBe("a");
      expect((await kage.leaveMercenary({ contractId: offer.id })).success).toBe(true);
      expect((await fetchBattleEssentials(db)).activeWars[0]?.warMercenaries).toEqual(
        [],
      );
      if (switchingUserId !== "none") {
        await db
          .insert(jutsuLoadout)
          .values({ id: "new-loadout", userId: switchingUserId, jutsuIds: [] });
        const switched = await callerForDatabase(
          combatRouter,
          switchingUserId,
          db,
        ).updateCombatLoadout({ battleId: "lobby", jutsuLoadoutId: "new-loadout" });
        expect(switched.success, switched.message).toBe(true);
      }
      const snapshot = (await db.query.battle.findFirst({
        where: eq(battle.id, "lobby"),
      }))!;
      if (switchingUserId !== "none") {
        expect(
          snapshot.usersState.find((user) => user.userId === switchingUserId)
            ?.jutsuLoadout,
        ).toBe("new-loadout");
      }
      const mercenary = snapshot.usersState.find((user) => user.userId === "merc")!;
      expect(mercenary.username).toBe("Mercenary");
      expect(mercenary.isMasked).toBe(true);
      expect(snapshot.extraState.wars).toEqual(before.extraState.wars);
      expect(
        getWarSide(snapshot.extraState.wars.w!, mercenary.villageId, mercenary.userId),
      ).toBe("a");
      expect(getBattleTeamWars(snapshot, mercenary).map(({ war }) => war.id)).toEqual([
        "w",
      ]);
      snapshot.usersState.find((user) => user.userId === "enemy")!.curHealth = 0;
      await settleObjectiveWarCombat(
        db,
        snapshot,
        { didWin: 1 } as CombatResult,
        mercenary,
      );
      const contribution = (await db.query.warContribution.findFirst())!;
      expect(contribution.damage).toBe(defaultWarRules.anbuDamage);
      expect(contribution.recovery).toBe(defaultWarRules.anbuRecovery);
      expect((await db.query.warKill.findFirst())?.killerVillageId).toBe("a");
    },
  );
  it("keeps a native shrine teammate from granting mercenary credit in another war after dismissal", async () => {
    const db = await getTestDatabase();
    await resetTables(
      battleHistory,
      battle,
      mpvpBattleUser,
      mpvpBattleQueue,
      aiProfile,
      sector,
      villageAlliance,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({ answerOtherRequests: true });
    const kage = callerForDatabase(warRouter, "kage", db);
    const offer = await hireMerc(db, 1);
    await db
      .insert(village)
      .values({ id: "d", name: "D", sector: 4, kageId: "d-kage", tokens: 1000 });
    await db.update(village).set({ tokens: 1000 }).where(eq(village.id, "c"));
    await db.update(userData).set({
      status: "AWAKE",
      rank: "JONIN",
      experience: 1000,
      curHealth: 100,
      maxHealth: 100,
      curStamina: 100,
      maxStamina: 100,
      curChakra: 100,
      maxChakra: 100,
      sector: 101,
    });
    await db
      .update(userData)
      .set({ villageId: "d" })
      .where(eq(userData.userId, "enemy"));
    await db.insert(war).values({
      id: "home-war",
      type: "SECTOR_WAR",
      status: "ACTIVE",
      attackerVillageId: "c",
      defenderVillageId: "d",
      sector: 101,
      defenderShrineHp: 100,
      defenderShrineMaxHp: 100,
    });
    await db.insert(sector).values({ sector: 101, villageId: "d", shrineLevel: 1 });
    await db
      .insert(villageAlliance)
      .values({ id: "enemies", villageIdA: "c", villageIdB: "d", status: "ENEMY" });
    await insertDefaultAiProfile();
    const shrineMerc = callerForDatabase(shrineRouter, "merc", db);
    expect((await shrineMerc.challengeShrine({ sectorNumber: 101 })).success).toBe(
      true,
    );
    const queue = (await db.query.mpvpBattleQueue.findFirst())!;
    for (const [userId, side] of [
      ["merc2", "ATTACKER"],
      ["enemy", "DEFENDER"],
    ] as const) {
      expect(
        (
          await callerForDatabase(shrineRouter, userId, db).joinShrineBattle({
            shrineBattleId: queue.id,
            side,
          })
        ).success,
      ).toBe(true);
    }
    await db
      .update(mpvpBattleQueue)
      .set({
        createdAt: new Date(Date.now() - (SHRINE_BATTLE_LOBBY_SECONDS + 1) * 1000),
      })
      .where(eq(mpvpBattleQueue.id, queue.id));
    const started = await shrineMerc.initiateShrineBattle({ shrineBattleId: queue.id });
    expect(started.success, started.message).toBe(true);
    const snapshot = (await db.query.battle.findFirst({
      where: eq(battle.id, started.battleId!),
    }))!;
    expect((await kage.leaveMercenary({ contractId: offer.id })).success).toBe(true);
    const merc = snapshot.usersState.find((u) => u.userId === "merc")!;
    const native = snapshot.usersState.find((u) => u.userId === "merc2")!;
    snapshot.usersState.find((u) => u.userId === "enemy")!.curHealth = 0;
    expect(
      getWarSide(snapshot.extraState.wars["home-war"]!, merc.villageId, merc.userId),
    ).toBeNull();
    expect(getBattleTeamWars(snapshot, merc).map(({ war }) => war.id)).toEqual(["w"]);
    const result = calcBattleResult(snapshot, merc.userId)!;
    expect(result.shrineChangeHp).toBe(0);
    await updateWars(db, {} as never, snapshot, result, merc.userId);
    expect(
      (await db.query.war.findFirst({ where: eq(war.id, "home-war") }))
        ?.defenderShrineHp,
    ).toBe(100);
    const nativeResult = calcBattleResult(snapshot, native.userId)!;
    expect(nativeResult.shrineChangeHp).toBeLessThan(0);
    await updateWars(db, {} as never, snapshot, nativeResult, native.userId);
    expect(
      (await db.query.war.findFirst({ where: eq(war.id, "home-war") }))
        ?.defenderShrineHp,
    ).toBe(100 + nativeResult.shrineChangeHp);
  });
});
