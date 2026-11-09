import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, clan, userData, village } from "@/drizzle/schema";
import * as clans from "@/server/api/routers/clan";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import * as deleteUserData from "@/server/utils/accountDeletion/deleteUserData";
import * as processors from "@/server/utils/accountDeletion/processors";
import { runDeletionStep } from "@/server/utils/accountDeletion/worker";
import * as storeIdentity from "@/server/utils/purchases/storeIdentity";
import { insertClans, insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const depart = clans.removeFromClan;

describeWithDatabase("account deletion clan departure retries", () => {
  beforeEach(async () => {
    await resetTables(userData, clan, village, actionLog);
    vi.spyOn(storeIdentity, "retireStoreUserId").mockResolvedValue(undefined);
    vi.spyOn(processors, "removeAccountProcessorData").mockResolvedValue(undefined);
    // Exercise clan cleanup without deleting the fixture character or calling processors.
    vi.spyOn(deleteUserData, "deleteUser").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps a rejected shared deletion retryable instead of completing account cleanup", async () => {
    await insertUsers([{ userId: "departing" }]);
    vi.spyOn(deleteUserData, "deleteUser").mockResolvedValueOnce({
      success: false,
      message: "This AI is used by an active hunting session. Wait for it to finish.",
    });
    const advance = vi.fn();
    const step = () =>
      runDeletionStep({
        phase: "IDENTITY_DELETED",
        removeIdentity: vi.fn(),
        removeGameData: () => removeAccountGameData("departing"),
        advance,
      });
    await expect(step()).rejects.toThrow("active hunting session");
    expect(advance).not.toHaveBeenCalled();
    await step();
    expect(advance).toHaveBeenCalledWith("COMPLETE", 0);
  });

  it.each([false, true])(
    "retries departure after membership was cleared (last member: %s)",
    async (lastMember) => {
      const db = await getTestDatabase();
      await insertUsers([
        {
          userId: "departing",
          clanId: "faction",
          villageId: "hideout",
          rank: "JONIN" as const,
          isOutlaw: true,
        },
        ...(!lastMember
          ? [
              {
                userId: "successor",
                clanId: "faction",
                villageId: "hideout",
                rank: "JONIN" as const,
                isOutlaw: true,
              },
            ]
          : []),
      ]);
      await db.insert(village).values({
        id: "hideout",
        name: "Hideout",
        kageId: "departing",
        type: "HIDEOUT",
      });
      await insertClans([
        {
          id: "faction",
          name: "Faction",
          villageId: "hideout",
          leaderId: "departing",
          coLeader1: lastMember ? null : "successor",
        },
      ]);
      vi.spyOn(clans, "removeFromClan").mockImplementationOnce(async (...args) => {
        await depart(...args);
        expect(
          (
            await args[0].query.userData.findFirst({
              where: eq(userData.userId, "departing"),
            })
          )?.clanId,
        ).toBeNull();
        throw new Error("departure write failed");
      });
      await expect(removeAccountGameData("departing")).rejects.toThrow(
        "departure write failed",
      );
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "departing") }))
          ?.clanId,
      ).toBe("faction");
      expect(
        (await db.query.clan.findFirst({ where: eq(clan.id, "faction") }))?.leaderId,
      ).toBe("departing");
      expect(
        await db.query.village.findFirst({ where: eq(village.id, "hideout") }),
      ).toBeDefined();

      await removeAccountGameData("departing");
      const remainingClan = await db.query.clan.findFirst({
        where: eq(clan.id, "faction"),
      });
      const remainingVillage = await db.query.village.findFirst({
        where: eq(village.id, "hideout"),
      });
      if (lastMember) {
        expect(remainingClan).toBeUndefined();
        expect(remainingVillage).toBeUndefined();
      } else {
        expect(remainingClan?.leaderId).toBe("successor");
        expect(remainingVillage?.kageId).toBe("successor");
      }
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "departing") }))
          ?.clanId,
      ).toBeNull();
    },
  );
});
