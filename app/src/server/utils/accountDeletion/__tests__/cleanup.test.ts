import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actionLog, clan, userData, village } from "@/drizzle/schema";
import * as clans from "@/server/api/routers/clan";
import * as staff from "@/server/api/routers/staff";
import * as grant from "@/server/utils/purchases/grant";
import { insertUsers } from "../../../../../tests/setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../../tests/setup/testDatabase";
import { removeAccountGameData } from "../cleanup";
import * as processors from "../processors";

const depart = clans.removeFromClan;

describeWithDatabase("account deletion clan departure retries", () => {
  beforeEach(async () => {
    await resetTables(userData, clan, village, actionLog);
    vi.spyOn(grant, "retireStoreUserId").mockResolvedValue(undefined);
    vi.spyOn(processors, "removeAccountProcessorData").mockResolvedValue(undefined);
    // Exercise clan cleanup without deleting the fixture character or calling processors.
    vi.spyOn(staff, "deleteUser").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

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
      await db.insert(clan).values({
        id: "faction",
        name: "Faction",
        image: "",
        villageId: "hideout",
        founderId: "departing",
        leaderId: "departing",
        leaderOrderId: "",
        coLeader1: lastMember ? null : "successor",
      });
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
