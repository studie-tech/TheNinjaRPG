import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  actionLog,
  aiProfile,
  battle,
  battleHistory,
  clan,
  dungeon,
  dungeonMember,
  dungeonRun,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  petSpecies,
  questHistory,
  rankedPvpQueue,
  sector,
  territoryWar,
  userData,
  userPet,
  userRequest,
  village,
  war,
  warAlly,
} from "@/drizzle/schema";
import { CLAN_LOBBY_SECONDS, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { shrineRouter } from "@/server/api/routers/shrine";
import { clanRouter } from "@/server/api/routers/clan";
import { territoryWarRouter } from "@/server/api/routers/territoryWar";
import { petsRouter } from "@/server/api/routers/pets";
import { wakeQueuedUser } from "@/queries/profile";
import { updateUserDataForInitiateClanBattle } from "@/queries/clan";
import { updateUserDataForGET3 } from "@/queries/cleaner";
import { runStaleShrineLobbyCleanup } from "@/app/api/shrine-maintenance/route";
import { resumePendingWarSettlements } from "@/server/utils/war";
import { cleanupTerritoryWarTeams } from "@/server/utils/territoryWar";
import { Pusher } from "@/libs/pusher";
import { dungeonContent } from "../../setup/dungeon";
import { initialPetSpecies } from "../../libs/pets/helpers/species";
import { insertPetSpecies, insertUsers } from "../../setup/factories";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const owner = async () =>
  (await (
    await getTestDatabase()
  ).query.userData.findFirst({ where: eq(userData.userId, "a") }))!;
const createDungeon = async () => {
  const result = await (await callerFor(dungeonRouter, "a")).create({
    id: "definition",
    petIds: ["one", "two"],
  });
  expect(result.success).toBe(true);
  expect((await owner()).status).toBe("QUEUED");
  expect(
    (
      await (
        await callerFor(petsRouter, "a")
      ).updatePet({ petId: "one", battleEnabled: false })
    ).success,
  ).toBe(false);
  return result;
};
const verifyReservedDungeon = async (status = "LOBBY") => {
  const db = await getTestDatabase();
  expect(await db.query.dungeonRun.findFirst()).toMatchObject({ status });
  expect(await db.query.dungeonMember.findFirst()).toMatchObject({ activeUserId: "a" });
  expect((await owner()).status).toBe("QUEUED");
  expect(
    (
      await (
        await callerFor(petsRouter, "a")
      ).updatePet({ petId: "one", battleEnabled: false })
    ).success,
  ).toBe(false);
};
const expiredShrineLeave = async () => {
  const db = await getTestDatabase();
  await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "a"));
  await db
    .insert(mpvpBattleQueue)
    .values({
      id: "expired-shrine",
      battleType: "SHRINE_BATTLE",
      attackerEntityId: "v",
      defenderEntityId: "enemy",
      sector: 205,
      createdAt: new Date(0),
    });
  await db
    .insert(mpvpBattleUser)
    .values({
      id: "shrine-member",
      clanBattleId: "expired-shrine",
      userId: "a",
      side: "ATTACKER",
      slot: 0,
    });
  expect(
    await (await callerFor(shrineRouter, "a")).leaveShrineBattle({
      shrineBattleId: "expired-shrine",
    }),
  ).toMatchObject({ success: false, message: "Shrine battle expired" });
  expect((await owner()).status).toBe("AWAKE");
  expect(await db.query.mpvpBattleUser.findFirst()).toBeDefined();
};

describeWithDatabase("queue cleanup preserves dungeon reservations", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const db = await getTestDatabase();
    await resetTables(
      actionLog,
      aiProfile,
      battle,
      battleHistory,
      clan,
      dungeon,
      dungeonMember,
      dungeonRun,
      mpvpBattleQueue,
      mpvpBattleUser,
      notification,
      petSpecies,
      questHistory,
      rankedPvpQueue,
      sector,
      territoryWar,
      userData,
      userPet,
      userRequest,
      village,
      war,
      warAlly,
    );
    await db.insert(village).values([
      { id: "v", name: "V", sector: 1, kageId: "x" },
      { id: "enemy", name: "Enemy", sector: 2, kageId: "y" },
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 3, kageId: "s" },
    ]);
    await db.insert(clan).values([
      {
        id: "c",
        name: "C",
        image: "/c.webp",
        villageId: "v",
        founderId: "x",
        leaderId: "x",
        leaderOrderId: "order",
      },
      {
        id: "d",
        name: "D",
        image: "/d.webp",
        villageId: "enemy",
        founderId: "y",
        leaderId: "y",
        leaderOrderId: "order2",
      },
    ]);
    await insertUsers([
      {
        userId: "a",
        username: "A",
        villageId: "v",
        clanId: "c",
        rank: "JONIN",
        status: "AWAKE",
        sector: 1,
      },
      {
        userId: "x",
        username: "X",
        villageId: "v",
        clanId: "c",
        rank: "JONIN",
        status: "AWAKE",
        sector: 1,
      },
      {
        userId: "y",
        username: "Y",
        villageId: "enemy",
        clanId: "d",
        rank: "JONIN",
        status: "AWAKE",
        sector: 1,
      },
    ]);
    await db.insert(aiProfile).values({ id: "Default", userId: "x", rules: [] });
    await insertPetSpecies(initialPetSpecies);
    await db
      .insert(userPet)
      .values(
        ["one", "two"].map((id) => ({
          id,
          userId: "a",
          name: id,
          speciesId: initialPetSpecies[0]!.id,
          paletteIndex: 0,
          characteristicIndex: 0,
          auraIndex: 0,
          rank: 1,
          artRank: 1,
          generationStatus: "READY" as const,
          battleEnabled: true,
          avatar: "https://example.com/pet.webp",
        })),
      );
    await db
      .insert(dungeon)
      .values({ id: "definition", content: dungeonContent(), updatedAt: new Date() });
  });
  afterEach(() => vi.restoreAllMocks());

  for (const cleanup of ["maintenance", "war settlement"] as const) {
    for (const mode of ["live", "ordinary", "COMPLETED", "ENDED"] as const) {
      it(`${cleanup} after expired shrine leave: ${mode}`, async () => {
        const db = await getTestDatabase();
        await expiredShrineLeave();
        if (mode !== "ordinary") await createDungeon();
        if (mode === "COMPLETED" || mode === "ENDED")
          await db.update(dungeonRun).set({ status: mode });
        if (mode === "ordinary")
          await db
            .update(userData)
            .set({ status: "QUEUED" })
            .where(eq(userData.userId, "a"));
        if (cleanup === "maintenance")
          expect(await runStaleShrineLobbyCleanup(new Date(), db)).toMatchObject({
            usersReset: mode === "live" ? 0 : 1,
            lobbiesCleared: 1,
          });
        else {
          await db
            .insert(war)
            .values({
              id: "ended-war",
              type: "VILLAGE_WAR",
              status: "ATTACKER_VICTORY",
              attackerVillageId: "v",
              defenderVillageId: "enemy",
              endedAt: new Date(),
              settlementPending: true,
              settlement: {
                villageIds: ["v", "enemy"],
                winningVillageIds: ["v"],
                warIds: ["ended-war"],
                notificationContent: "Ended war",
                cleanupCutoff: Date.now(),
                boostsDelivered: true,
                structuresDelivered: true,
                notified: true,
              },
            });
          await resumePendingWarSettlements(db);
          expect(await db.query.war.findFirst()).toMatchObject({
            settlementPending: false,
          });
        }
        expect((await owner()).status).toBe(mode === "live" ? "QUEUED" : "AWAKE");
        expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
        expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
        if (mode === "live") await verifyReservedDungeon();
      });
    }
  }

  it("preserves a dungeon admitted before failed shrine creation rolls back", async () => {
    const db = await getTestDatabase();
    await db
      .insert(sector)
      .values({ sector: 205, villageId: VILLAGE_SYNDICATE_ID, shrineLevel: 1 });
    let interposed = false;
    const delayed = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "insert")
          return (table: unknown) =>
            table === mpvpBattleQueue
              ? {
                  values: async () => {
                    interposed = true;
                    await updateUserDataForGET3(db);
                    expect((await owner()).status).toBe("AWAKE");
                    await createDungeon();
                    throw new Error("Injected unavailable queue insert");
                  },
                }
              : target.insert(table as never);
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(
      callerForDatabase(shrineRouter, "a", delayed).challengeShrine({
        sectorNumber: 205,
      }),
    ).rejects.toThrow("Injected unavailable queue insert");
    expect(interposed).toBe(true);
    await verifyReservedDungeon();
  });

  it("preserves a dungeon admitted while territory team membership is provisional", async () => {
    const db = await getTestDatabase();
    const endsAt = new Date(Date.now() + 1200);
    await db
      .insert(territoryWar)
      .values({
        id: "event",
        predecessorId: "initial",
        sector: 1,
        guardianId: "guardian",
        startsAt: new Date(Date.now() - 10000),
        endsAt,
      });
    let interposed = false;
    const dialect = new MySqlDialect();
    const delayed = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "execute")
          return async (query: Parameters<typeof target.execute>[0]) => {
            const isInsert = dialect
              .sqlToQuery(query as never)
              .sql.includes("INSERT IGNORE INTO MpvpBattleUser");
            const result = await target.execute(query);
            if (isInsert && !interposed) {
              interposed = true;
              await createDungeon();
              await new Promise((resolve) =>
                setTimeout(resolve, Math.max(0, endsAt.getTime() - Date.now() + 30)),
              );
              await cleanupTerritoryWarTeams(db);
            }
            return result;
          };
        return Reflect.get(target, key, receiver);
      },
    });
    const result = await callerForDatabase(territoryWarRouter, "a", delayed).createTeam(
      { eventId: "event" },
    );
    expect(interposed).toBe(true);
    expect(result.success).toBe(false);
    expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
    await verifyReservedDungeon();
  });

  it("preserves an admitted dungeon when clan battle startup releases surplus members", async () => {
    const db = await getTestDatabase();
    // This lobby and both existing participants represent ordinary earlier joins.
    await db
      .insert(mpvpBattleQueue)
      .values({
        id: "clan-lobby",
        battleType: "CLAN_BATTLE",
        attackerEntityId: "c",
        defenderEntityId: "d",
        createdAt: new Date(Date.now() - (CLAN_LOBBY_SECONDS + 5) * 1000),
      });
    await db.insert(mpvpBattleUser).values([
      {
        id: "x-member",
        clanBattleId: "clan-lobby",
        userId: "x",
        side: "ATTACKER",
        slot: 0,
        createdAt: new Date(Date.now() - 5000),
      },
      {
        id: "y-member",
        clanBattleId: "clan-lobby",
        userId: "y",
        side: "DEFENDER",
        slot: 0,
        createdAt: new Date(Date.now() - 5000),
      },
    ]);
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "x"));
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "y"));
    let interposed = false;
    const delayed = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "insert")
          return (table: unknown) =>
            table === mpvpBattleUser
              ? {
                  values: async (values: typeof mpvpBattleUser.$inferInsert) => {
                    interposed = true;
                    await updateUserDataForGET3(db);
                    expect((await owner()).status).toBe("AWAKE");
                    await createDungeon();
                    return await target.insert(mpvpBattleUser).values(values);
                  },
                }
              : target.insert(table as never);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      (
        await callerForDatabase(clanRouter, "a", delayed).joinClanBattle({
          clanBattleId: "clan-lobby",
        })
      ).success,
    ).toBe(true);
    expect(interposed).toBe(true);
    expect((await owner()).status).toBe("QUEUED");
    const started = await (await callerFor(clanRouter, "x")).initiateClanBattle({
      clanBattleId: "clan-lobby",
    });
    expect(started.success).toBe(true);
    await verifyReservedDungeon();
  });

  for (const release of [
    "shrine rollback",
    "territory cleanup",
    "clan surplus",
  ] as const) {
    for (const mode of [
      "LOBBY",
      "BETWEEN",
      "PAUSED",
      "FIGHTING",
      "ordinary",
      "COMPLETED",
      "ENDED",
    ] as const) {
      it(`${release} respects ${mode} dungeon reservations`, async () => {
        const db = await getTestDatabase();
        if (mode === "ordinary")
          await db
            .update(userData)
            .set({ status: "QUEUED" })
            .where(eq(userData.userId, "a"));
        else {
          await createDungeon();
          await db.update(dungeonRun).set({ status: mode });
        }
        if (release === "shrine rollback") await wakeQueuedUser(db, "a");
        else if (release === "territory cleanup") {
          await db
            .insert(territoryWar)
            .values({
              id: "event",
              predecessorId: "initial",
              sector: 1,
              guardianId: "guardian",
              startsAt: new Date(0),
              endsAt: new Date(1),
            });
          await db
            .insert(mpvpBattleQueue)
            .values({
              id: "control",
              battleType: "TERRITORY_WAR",
              territoryWarId: "event",
              attackerEntityId: "village:v",
              defenderEntityId: "guardian",
              sector: 1,
            });
          await db
            .insert(mpvpBattleUser)
            .values({
              id: "member",
              clanBattleId: "control",
              userId: "a",
              side: "ATTACKER",
              slot: 0,
            });
          await cleanupTerritoryWarTeams(db);
        } else {
          await db
            .insert(mpvpBattleQueue)
            .values({
              id: "control",
              battleId: "fight",
              battleType: "CLAN_BATTLE",
              attackerEntityId: "c",
              defenderEntityId: "d",
            });
          await db
            .insert(mpvpBattleUser)
            .values({
              id: "member",
              clanBattleId: "control",
              userId: "a",
              side: "ATTACKER",
              slot: 0,
            });
          await updateUserDataForInitiateClanBattle(
            db,
            ["a"],
            { clanBattleId: "control" },
            "fight",
          );
        }
        const isLive = mode !== "ordinary" && mode !== "COMPLETED" && mode !== "ENDED";
        expect((await owner()).status).toBe(isLive ? "QUEUED" : "AWAKE");
        if (isLive) await verifyReservedDungeon(mode);
        if (release === "territory cleanup") {
          expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
          expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
        }
      });
    }
  }
});
