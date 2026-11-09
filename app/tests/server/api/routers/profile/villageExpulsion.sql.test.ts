import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import {
  actionLog,
  clan,
  mpvpBattleUser,
  userData,
  userRequest,
  village,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { insertClans, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("village expulsion clan cleanup", () => {
  beforeEach(async () => {
    await resetTables(actionLog, mpvpBattleUser, userRequest, clan, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      {
        id: "old-village",
        name: "Old village",
        sector: 1,
        kageId: "",
        type: "VILLAGE",
      },
      {
        id: VILLAGE_SYNDICATE_ID,
        name: "Syndicate",
        sector: 2,
        kageId: "",
        type: "OUTLAW",
      },
    ]);
    await insertUsers([
      {
        userId: "expelled",
        villageId: "old-village",
        villagePrestige: -100,
        clanId: "old-clan",
        rank: "JONIN",
        status: "BATTLE",
        battleId: "expulsion-battle",
        joinedVillageAt: new Date(0),
      },
      {
        userId: "remaining",
        villageId: "old-village",
        clanId: "old-clan",
        rank: "JONIN",
      },
    ]);
    await insertClans([
      {
        id: "old-clan",
        name: "Old clan",
        villageId: "old-village",
        leaderId: "expelled",
      },
    ]);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("retries clan cleanup after expulsion persisted and the first membership clear failed", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {},
      async () => {
        throw new Error("temporary clan cleanup failure");
      },
    ]);
    await expect(fetchUpdatedUser({ client, userId: "expelled" })).rejects.toThrow(
      "temporary clan cleanup failure",
    );
    const kicked = await db.query.userData.findFirst({
      where: eq(userData.userId, "expelled"),
    });
    expect(kicked).toMatchObject({
      isOutlaw: true,
      villageId: VILLAGE_SYNDICATE_ID,
      clanId: "old-clan",
    });
    const result = await fetchUpdatedUser({ client: db, userId: "expelled" });
    expect(result.user).toMatchObject({ isOutlaw: true, clanId: null, clan: null });
    expect(result.requiresUserRefresh).toBe(true);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "expelled") }),
    ).toEqual(
      expect.objectContaining({
        clanId: null,
        joinedVillageAt: kicked?.joinedVillageAt,
      }),
    );
    expect(
      await db.query.clan.findFirst({ where: eq(clan.id, "old-clan") }),
    ).toMatchObject({ leaderId: "remaining" });
  });

  it.each(["OUTLAW", "HIDEOUT", "STRONGHOLD"] as const)(
    "preserves an outlaw's %s faction",
    async (type) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ isOutlaw: true, villageId: VILLAGE_SYNDICATE_ID, villagePrestige: 0 })
        .where(eq(userData.userId, "expelled"));
      await db.update(village).set({ type }).where(eq(village.id, "old-village"));
      const result = await fetchUpdatedUser({ client: db, userId: "expelled" });
      expect(result.user?.clanId).toBe("old-clan");
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "expelled") }),
      ).toMatchObject({ clanId: "old-clan" });
    },
  );
});
