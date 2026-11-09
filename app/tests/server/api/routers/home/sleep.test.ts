import { afterEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { homeRouter } from "@/server/api/routers/home";
import { insertUsers } from "../../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "sleep-account";
describeWithDatabase("sleep status concurrency", () => {
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });
  it.each(["AWAKE", "ASLEEP"] as const)(
    "does not overwrite combat that begins after reading %s",
    async (status) => {
      await resetTables(userData);
      const database = await getTestDatabase();
      await insertUsers([
        { userId, username: userId, status, curHealth: 100, maxHealth: 100 },
      ]);
      const user = await database.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      stubProfile(
        "fetchUpdatedUser",
        async () => ({ user: { ...user, sector: 1, village: { sector: 1 } } }) as never,
      );
      const trigger = vi
        .spyOn(Pusher.prototype, "trigger")
        .mockResolvedValue(undefined);
      // Interleave hospitalization after the profile read and before its guarded write.
      const client = beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ status: "HOSPITALIZED", curHealth: 0 })
            .where(eq(userData.userId, userId));
        },
      ]);
      const caller = await callerForDatabase(homeRouter, userId, client);
      expect(await caller.toggleSleep()).toEqual({
        success: false,
        message: "Your status changed. Refresh and try again.",
      });
      expect(
        (
          await database.query.userData.findFirst({
            where: eq(userData.userId, userId),
          })
        )?.status,
      ).toBe("HOSPITALIZED");
      expect(trigger).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: "AWAKE", sector: -1 },
    { status: "ASLEEP", sector: 1 },
  ] as const)(
    "broadcasts a player leaving %s with stealth cleared",
    async ({ status, sector }) => {
      await resetTables(userData);
      const database = await getTestDatabase();
      await insertUsers([
        {
          userId,
          username: userId,
          status,
          curHealth: 90,
          maxHealth: 100,
          level: 7,
          stealthActive: true,
          sector: 1,
          longitude: 3,
          latitude: 4,
          location: "Tavern",
        },
      ]);
      const user = await database.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      stubProfile(
        "fetchUpdatedUser",
        async () => ({ user: { ...user, sector: 1, village: { sector: 1 } } }) as never,
      );
      const trigger = vi
        .spyOn(Pusher.prototype, "trigger")
        .mockResolvedValue(undefined);
      expect(
        (await callerForDatabase(homeRouter, userId, database).toggleSleep()).success,
      ).toBe(true);
      expect(trigger).toHaveBeenCalledWith("1", "event", {
        userId,
        longitude: 3,
        latitude: 4,
        sector,
        status: status === "AWAKE" ? "ASLEEP" : "AWAKE",
        location: "",
        villageId: null,
        battleId: null,
        level: 7,
        experience: 0,
        rank: "STUDENT",
        stealthActive: false,
        curHealth: 90,
        maxHealth: 100,
      });
    },
  );
});
