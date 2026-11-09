import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
  villageAlliance,
  war,
  warAlly,
} from "@/drizzle/schema";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { shrineRouter } from "@/server/api/routers/shrine";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "shrine-recovery-player";
const lobbyId = "shrine-recovery-lobby";
const sectorNumber = 101;

describeWithDatabase("shrine recovery committed activity", () => {
  beforeEach(async () => {
    await resetTables(
      mpvpBattleUser,
      mpvpBattleQueue,
      warAlly,
      war,
      sector,
      userData,
      villageAlliance,
      village,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in shrine recovery tests",
    });
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "shrine-recovery-attacker", name: "Attacker", sector: 100, kageId: userId },
      { id: "shrine-recovery-defender", name: "Defender", sector: 200, kageId: "foe" },
    ]);
    await db.insert(villageAlliance).values({
      id: "shrine-recovery-enemy",
      villageIdA: "shrine-recovery-attacker",
      villageIdB: "shrine-recovery-defender",
      status: "ENEMY",
    });
    await db
      .insert(sector)
      .values({ sector: sectorNumber, villageId: "shrine-recovery-defender" });
    await db.insert(mpvpBattleQueue).values({
      id: lobbyId,
      battleType: "SHRINE_BATTLE",
      attackerEntityId: "shrine-recovery-attacker",
      defenderEntityId: "shrine-recovery-defender",
      sector: sectorNumber,
    });
    const now = new Date();
    await insertUsers([
      {
        userId,
        username: "ShrineRecovery",
        status: "ASLEEP",
        autoWakeUp: true,
        villageId: "shrine-recovery-attacker",
        rank: "JONIN",
        level: 50,
        sector: sectorNumber,
        updatedAt: now,
        regenAt: now,
        regeneration: 0,
      },
    ]);
    stubProfile("fetchUpdatedUser", async () => ({
      user: await fetchActionUser(db, userId),
      settings: [],
      requiresUserRefresh: true,
    }));
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it.each(["challengeShrine", "joinShrineBattle"] as const)(
    "%s projects QUEUED when the action patch is withheld",
    async (endpoint) => {
      const db = await getTestDatabase();
      const initial = {
        userData: await fetchActionUser(db, userId),
        notifications: [],
      };
      const client = new QueryClient();
      const key = ["shrine-recovery", endpoint];
      client.setQueryData(key, initial);
      try {
        const revision = prepareUserUpdate(client, key);
        const caller = callerForDatabase(shrineRouter, userId, db);
        const response =
          endpoint === "challengeShrine"
            ? await caller.challengeShrine({ sectorNumber })
            : await caller.joinShrineBattle({
                shrineBattleId: lobbyId,
                side: "ATTACKER",
              });
        expect(response).toMatchObject({
          success: true,
          actionNotice: AUTO_WAKE_MESSAGE,
          userRecovery: { activity: { status: "QUEUED" } },
        });
        expect(response.userPatch).toBeUndefined();
        await updateUserCache(client, key, response, { revision });
        expect(client.getQueryData<typeof initial>(key)?.userData.status).toBe(
          "QUEUED",
        );
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
        ).toMatchObject({ status: "QUEUED" });
      } finally {
        client.clear();
      }
    },
  );

  it.each([
    "existing entry",
    "compensated",
    "lost compensation",
    "concurrent battle",
  ] as const)(
    "reports only known duplicate-insert activity for %s",
    async (scenario) => {
      const db = await getTestDatabase();
      const racedInsert = beforeStatements(db, mpvpBattleUser, [
        async () => {
          await db.insert(mpvpBattleUser).values({
            id: "shrine-recovery-racer",
            userId: scenario === "existing entry" ? userId : "slot-racer",
            clanBattleId: lobbyId,
            side: "ATTACKER",
            slot: 0,
          });
          if (scenario === "concurrent battle") {
            await db
              .update(userData)
              .set({ status: "BATTLE", battleId: "concurrent-shrine-battle" })
              .where(eq(userData.userId, userId));
          }
        },
      ]);
      const client =
        scenario === "lost compensation"
          ? beforeStatements(racedInsert, userData, [
              async () => {},
              async () => {
                await db
                  .update(userData)
                  .set({ status: "BATTLE", battleId: "concurrent-shrine-battle" })
                  .where(eq(userData.userId, userId));
              },
            ])
          : racedInsert;
      const response = await callerForDatabase(
        shrineRouter,
        userId,
        client,
      ).joinShrineBattle({ shrineBattleId: lobbyId, side: "ATTACKER" });
      expect(response).toMatchObject({
        success: false,
        actionNotice: AUTO_WAKE_MESSAGE,
      });
      const expectedStatus =
        scenario === "existing entry"
          ? "QUEUED"
          : scenario === "compensated"
            ? "AWAKE"
            : "BATTLE";
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({ status: expectedStatus });
      if (expectedStatus === "BATTLE") expect(response.userRecovery).toBeUndefined();
      else expect(response.userRecovery?.activity?.status).toBe(expectedStatus);
    },
  );
});
