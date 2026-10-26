import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq, type SQL } from "drizzle-orm";
import { MySqlDialect, QueryBuilder } from "drizzle-orm/mysql-core";
import {
  mpvpBattleUser,
  battle,
  huntingSession,
  quest,
  questHistory,
  rankedPvpQueue,
  userData,
  userRequest,
  village,
  war,
  warAlly,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { acceptWarAllyOffer } from "@/server/utils/warAlly";
import * as cleanerUtils from "@/server/utils/cleaner";
import * as contentReviewCleanup from "@/libs/contentReview/cleanup";
import * as gamesettings from "@/libs/gamesettings";
import * as travel from "@/routers/travel";
import * as raids from "@/routers/raids";
import * as grant from "@/server/utils/purchases/grant";
import * as processor from "@/server/utils/accountDeletion/process";
import { stubDatabase, resetServerModuleStubs } from "../../../setup/serverModules";
import { actualGameSettings } from "../../../setup/preload";
import { GET } from "@/app/api/cleaner/route";
import { insertQuestHistory, insertQuests, insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const originalEnv = { ...process.env };

const mocks = { process: vi.fn(), lock: vi.fn(), reset: vi.fn(), execute: vi.fn() };

const request = (secret = "test-cron") => new Request("https://example.com/api/cleaner", {
  headers: { authorization: `Bearer ${secret}` },
});

const dialect = new MySqlDialect();
const queryBuilder = new QueryBuilder();
const skipDelete = () => ({
  where: vi.fn(() => Object.assign(Promise.resolve(undefined), {
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(undefined),
  })),
});
const offer = {
  offerId: "expiring-offer",
  warId: "expiry-war",
  villageId: "joining",
  supportVillageId: "supporting",
  userId: "joining-kage",
};
const addOffer = (db: DrizzleClient, offerId = offer.offerId) => db.insert(userRequest).values({
  id: offerId,
  type: "WAR_ALLY",
  status: "PENDING",
  senderId: "supporting-kage",
  receiverId: offer.userId,
  relatedId: offer.warId,
  value: 100,
  createdAt: new Date(Date.now() - 25 * 3_600_000),
});

const expireRequests = async (db: DrizzleClient) => {
  vi.spyOn(cleanerUtils, "deleteCleanupCandidates").mockResolvedValue(undefined);
  stubDatabase({
    execute: (query: SQL) => {
      const statement = dialect.sqlToQuery(query).sql;
      return statement.includes("DELETE") && statement.includes("UserRequest")
        ? db.execute(query)
        : Promise.resolve({ rowsAffected: 0 });
    },
    select: db.select.bind(db),
    delete: (table: object) => table === userRequest ? db.delete(userRequest) : skipDelete(),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }),
  });
  vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({ ...timerClaimFixture(), release: mocks.reset, isNewHour: true, prevTime: new Date(0), response: Response.json(null) });
  vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ isNewDay: false } as Awaited<ReturnType<typeof gamesettings.lockWithDailyTimer>>);
  vi.spyOn(travel, "completeExpiredGlobalTravel").mockResolvedValue(undefined);
  vi.spyOn(raids, "cleanupExpiredExclusiveRaids").mockResolvedValue(0);
  vi.spyOn(contentReviewCleanup, "cleanupContentProposals").mockResolvedValue({ removed: 0, filesDeleted: 0 });
  vi.spyOn(grant, "reconcileFederalStatuses").mockImplementation(vi.fn());
  vi.spyOn(processor, "processAccountDeletions").mockResolvedValue({ processed: 0, failed: 0 });
  process.env["CRON_SECRET"] = "test-cron";
  expect((await GET(request())).status).toBe(200);
};

describeWithDatabase("war ally reservations during request expiry", () => {
  beforeEach(async () => {
    await resetTables(userRequest, warAlly, war, village);
    const db = await getTestDatabase();
    await db.insert(village).values(["supporting", "joining", "defending"].map((id, index) => ({
      id, name: id, sector: 101 + index, kageId: `${id}-kage`, tokens: 1000,
    })));
    await db.insert(war).values({ id: offer.warId, type: "VILLAGE_WAR", status: "ACTIVE", attackerVillageId: "supporting", defenderVillageId: "defending" });
    await addOffer(db);
  });

  it("releases an interrupted reservation so a replacement offer can pay once", async () => {
    const db = await getTestDatabase();
    const interrupted = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "execute") return (query: SQL) => {
          if (dialect.sqlToQuery(query).sql.includes("UPDATE `UserRequest` r")) throw new Error("Payment interrupted");
          return target.execute(query);
        };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(acceptWarAllyOffer(interrupted, offer)).rejects.toThrow("Payment interrupted");
    expect(await db.select().from(warAlly)).toHaveLength(1);
    await expireRequests(db);
    expect(await db.select().from(userRequest)).toHaveLength(0);
    expect(await db.select().from(warAlly)).toHaveLength(0);
    await addOffer(db, "replacement-offer");
    const replacement = { ...offer, offerId: "replacement-offer" };
    expect((await Promise.all([acceptWarAllyOffer(db, replacement), acceptWarAllyOffer(db, replacement)])).every((row) => row.success)).toBe(true);
    expect(await db.select().from(warAlly)).toHaveLength(1);
    expect((await db.query.village.findFirst({ where: eq(village.id, "supporting") }))?.tokens).toBe(900);
    expect((await db.query.village.findFirst({ where: eq(village.id, "joining") }))?.tokens).toBe(1100);
  });

  it("keeps accepted home access while expiring old pending and terminal invitations", async () => {
    const db = await getTestDatabase();
    const createdAt = new Date(Date.now() - 25 * 3_600_000);
    await db.insert(userRequest).values([
      ...(["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"] as const).map((status) => ({ id: `home-${status}`, type: "HOME" as const, senderId: "host", receiverId: `guest-${status}`, status, createdAt })),
      { id: "home-fresh", type: "HOME", senderId: "host", receiverId: "new-guest", status: "PENDING" },
    ]);
    await expireRequests(db);
    expect((await db.select({ id: userRequest.id }).from(userRequest)).map(({ id }) => id).sort()).toEqual(["home-ACCEPTED", "home-fresh"]);
  });

  it("preserves an accepted membership and its payment after the request expires", async () => {
    const db = await getTestDatabase();
    expect((await acceptWarAllyOffer(db, offer)).success).toBe(true);
    const accepted = await db.query.warAlly.findFirst();
    await expireRequests(db);
    expect(await db.select().from(userRequest)).toHaveLength(0);
    expect(await db.query.warAlly.findFirst()).toEqual(accepted);
    expect((await db.query.village.findFirst({ where: eq(village.id, "supporting") }))?.tokens).toBe(900);
    expect((await db.query.village.findFirst({ where: eq(village.id, "joining") }))?.tokens).toBe(1100);
  });

  it("expiry overlapping interrupted admission leaves neither reservation nor payment", async () => {
    const db = await getTestDatabase();
    const overlapping = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "execute") return async (query: SQL) => {
          if (dialect.sqlToQuery(query).sql.includes("UPDATE `UserRequest` r")) {
            await expireRequests(db);
            throw new Error("Payment interrupted after expiry");
          }
          return target.execute(query);
        };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(acceptWarAllyOffer(overlapping, offer)).rejects.toThrow("Payment interrupted after expiry");
    expect(await db.select().from(userRequest)).toHaveLength(0);
    expect(await db.select().from(warAlly)).toHaveLength(0);
    expect((await db.select().from(village)).every((row) => row.tokens === 1000)).toBe(true);
  });
});

afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); resetServerModuleStubs(); });
describe("account deletion in the existing cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cleanerUtils, "deleteCleanupCandidates").mockResolvedValue(undefined);
    vi.spyOn(cleanerUtils, "cleanupOrphanRows").mockResolvedValue(undefined);
    stubDatabase({
      execute: mocks.execute,
      select: queryBuilder.select.bind(queryBuilder),
      delete: skipDelete,
      insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => ({ rowsAffected: 1 }) }) }),
      query: { userDataJob: { findFirst: async () => undefined } },
      update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }),
    });
    // Bun retains other cron suites' module mocks; keep the error response real.
    vi.spyOn(gamesettings, "handleEndpointError").mockImplementation(actualGameSettings.handleEndpointError);
    vi.spyOn(gamesettings, "lockWithHourlyTimer").mockImplementation(mocks.lock);
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ isNewDay: false } as Awaited<ReturnType<typeof gamesettings.lockWithDailyTimer>>);
    vi.spyOn(travel, "completeExpiredGlobalTravel").mockResolvedValue(undefined);
    vi.spyOn(raids, "cleanupExpiredExclusiveRaids").mockImplementation(vi.fn());
    vi.spyOn(contentReviewCleanup, "cleanupContentProposals").mockResolvedValue({ removed: 0, filesDeleted: 0 });
    vi.spyOn(grant, "reconcileFederalStatuses").mockImplementation(vi.fn());
    vi.spyOn(processor, "processAccountDeletions").mockImplementation(mocks.process);
    process.env["CRON_SECRET"] = "test-cron";
    mocks.execute.mockResolvedValue([]);
    mocks.process.mockResolvedValue({ processed: 1, failed: 0 });
    mocks.lock.mockResolvedValue({ isNewHour: false, response: Response.json("hourly work already ran") });
  });
  it("skips deletion cleanup with the rest of hourly maintenance", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("processes due deletions as part of the hourly cleanup", async () => {
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalled();
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(travel.completeExpiredGlobalTravel).toHaveBeenCalledTimes(1);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("runs orphan sweeps only after claiming daily maintenance", async () => {
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
    expect((await GET(request())).status).toBe(200);
    expect(cleanerUtils.cleanupOrphanRows).not.toHaveBeenCalled();
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ ...timerClaimFixture(), prevTime: new Date(0), isNewDay: true, response: Response.json(null), release: mocks.reset });
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
    expect((await GET(request())).status).toBe(200);
    expect(cleanerUtils.cleanupOrphanRows).toHaveBeenCalledTimes(1);
  });
  it("releases both timers when daily orphan cleanup fails", async () => {
    const dailyRelease = vi.fn();
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ ...timerClaimFixture(), prevTime: new Date(0), isNewDay: true, response: Response.json(null), release: dailyRelease });
    vi.spyOn(cleanerUtils, "cleanupOrphanRows").mockRejectedValue(new Error("Orphan cleanup failed"));
    expect((await GET(request())).status).toBe(500);
    expect(dailyRelease).toHaveBeenCalledTimes(1);
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });
  it("still processes deletions when content review cleanup fails", async () => {
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
    vi.spyOn(contentReviewCleanup, "cleanupContentProposals").mockRejectedValue(new Error("storage down"));
    expect((await GET(request())).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });
  it("uses the standard cleaner failure and timer rollback for deletion failures", async () => {
    const previous = new Date(0);
    mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: previous });
    mocks.process.mockResolvedValue({ processed: 0, failed: 1 });
    expect((await GET(request())).status).toBe(500);
    expect(mocks.reset).toHaveBeenCalledWith();
  });
  describeWithDatabase("ranked queue status repair", () => {
    it("releases an orphan with a provisional ranked row while preserving a claimed queue", async () => {
      const db = await getTestDatabase();
      await resetTables(mpvpBattleUser, rankedPvpQueue, userData);
      await insertUsers([
        { userId: "provisional", username: "provisional", status: "QUEUED" },
        { userId: "claimed", username: "claimed", status: "QUEUED" },
      ]);
      await db.insert(rankedPvpQueue).values([
        { id: "provisional", userId: "provisional", rankedLp: 1000, hasClaimed: false },
        { id: "claimed", userId: "claimed", rankedLp: 1000, hasClaimed: true },
      ]);
      let repairs = 0;
      stubDatabase({
        execute: mocks.execute,
        select: db.select.bind(db),
        delete: skipDelete,
        update: (table: object) => ({
          set: (values: Record<string, unknown>) => ({
            // Only the queue repair runs against SQL; unrelated maintenance stays stubbed.
            where: (condition: SQL) => {
              if (table === userData && values.status === "AWAKE") {
                repairs += 1;
                return db.update(userData).set(values).where(condition);
              }
              return Promise.resolve(undefined);
            },
          }),
        }),
      });
      mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
      expect((await GET(request())).status).toBe(200);
      expect(repairs).toBe(1);
      expect(
        (await db.query.userData.findFirst({
          where: eq(userData.userId, "provisional"),
        }))?.status,
      ).toBe("AWAKE");
      expect(
        (await db.query.userData.findFirst({
          where: eq(userData.userId, "claimed"),
        }))?.status,
      ).toBe("QUEUED");
    });
  });
  describeWithDatabase("abandoned hunting reservations", () => {
    const huntingBattleRow = (id: string, updatedAt = new Date()) => ({
      id, background: "default" as const, battleType: "HUNTING" as const, usersState: [], usersEffects: [], groundEffects: [],
      extraState: {} as (typeof battle.$inferInsert)["extraState"], createdAt: updatedAt, updatedAt, roundStartAt: updatedAt,
    });
    afterEach(async () => { await resetTables(battle, huntingSession); });
    it("releases reservations whose battle expired in the same run and keeps live fights", async () => {
      const db = await getTestDatabase();
      await resetTables(battle, huntingSession);
      await db.insert(battle).values([
        huntingBattleRow("expired", new Date(Date.now() - 2 * 86_400_000)),
        huntingBattleRow("live"),
      ]);
      await db.insert(huntingSession).values(["expired", "live", "gone"].map((battleId) => ({
        userId: battleId, id: battleId, habitatId: "forest", contractId: "contract", sector: 1,
        version: 3, battleId, readyAt: new Date(0), startedAt: new Date(0),
      })));
      stubDatabase({
        execute: mocks.execute,
        select: db.select.bind(db),
        // Only battle expiry and the reservation repair run against SQL.
        delete: (table: object) => table === battle ? db.delete(battle) : skipDelete(),
        update: (table: object) => table === huntingSession
          ? db.update(huntingSession)
          : { set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) },
      });
      mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
      expect((await GET(request())).status).toBe(200);
      expect((await db.query.battle.findMany()).map((b) => b.id)).toEqual(["live"]);
      const sessions = await db.query.huntingSession.findMany();
      expect(Object.fromEntries(sessions.map((s) => [s.id, [s.battleId, s.version]]))).toEqual({
        expired: [null, 4],
        gone: [null, 4],
        live: ["live", 3],
      });
    });
  });
  describeWithDatabase("isolated Pyramid status repair", () => {
    afterEach(async () => { await resetTables(questHistory); });
    it("clears missing fights while keeping isolated runs in BATTLE and preserving their pools", async () => {
      const db = await getTestDatabase();
      await resetTables(battle, questHistory, quest, userData);
      await insertUsers(["isolated", "ordinary", "ended", "between"].map((userId) => ({
        userId, username: userId, status: "BATTLE", battleId: userId === "between" ? null : `missing-${userId}`,
        curHealth: 37, curChakra: 45, curStamina: 55, curEnergy: 10, maxEnergy: 100,
        regeneration: 10, regenAt: new Date(Date.now() - 125_000),
      })));
      await insertQuests([{ id: "pyramid", questType: "battlepyramid" }]);
      await insertQuestHistory(["isolated", "ended", "between"].map((userId) => ({
        userId, questId: "pyramid", questType: "battlepyramid", isolated: true,
        ...(userId === "ended" ? { endAt: new Date() } : {}),
      })));
      stubDatabase({
        execute: mocks.execute,
        select: db.select.bind(db),
        delete: skipDelete,
        update: (table: object) => ({
          set: (values: Record<string, unknown>) => ({
            // Only the missing-fight repair runs against SQL; other cron work stays stubbed.
            where: (condition: SQL) => table === userData && values.battleId === null
              ? db.update(userData).set(values).where(condition)
              : Promise.resolve(undefined),
          }),
        }),
      });
      mocks.lock.mockResolvedValueOnce({ release: mocks.reset, isNewHour: true, prevTime: new Date(0) });
      expect((await GET(request())).status).toBe(200);
      const users = await db.query.userData.findMany();
      for (const user of users) {
        expect(user).toMatchObject({ battleId: null, curHealth: 37, curChakra: 45, curStamina: 55 });
        expect(user.status).toBe(["isolated", "between"].includes(user.userId) ? "BATTLE" : "AWAKE");
        if (user.userId === "between") expect(user.curEnergy).toBe(10);
        else expect(user.curEnergy).toBeGreaterThan(10);
      }
    });
  });
});
