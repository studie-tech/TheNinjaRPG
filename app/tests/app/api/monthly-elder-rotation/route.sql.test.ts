import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { GET } from "@/app/api/monthly-elder-rotation/route";
import { actionLog, clan, userData, village } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { insertUsers, insertClans } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const now = new Date("2026-10-28T12:00:00.000Z");
const request = () => new Request("https://example.com/api/monthly-elder-rotation");

describeWithDatabase("monthly elder rotation log", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(actionLog, clan, userData, village);
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithMonthlyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      isNewMonth: true,
      prevTime: new Date(0),
      response: Response.json("Ready"),
    });
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "rotation-village",
      name: "Rotation village",
      kageId: "rotation-kage",
    });
    await insertClans(
      [
        {
          id: "kept",
          leaderId: "stays-leader",
          elderNomineeId: "renominated",
          rank: 1,
        },
        {
          id: "banned",
          leaderId: "stays-leader",
          elderNomineeId: "banned-nominee",
          rank: 2,
        },
        { id: "anbu", leaderId: "anbu-leader", elderNomineeId: null, rank: 3 },
      ].map(({ rank, ...entry }) => ({
        ...entry,
        name: `Clan ${entry.id}`,
        founderId: entry.leaderId,
        villageId: "rotation-village",
        elderCutoffRank: rank,
        activityPoints: 10,
      })),
    );
    await insertUsers(
      [
        { userId: "renominated", rank: "ELDER" as const, clanId: "kept" },
        { userId: "retiring", rank: "ELDER" as const, clanId: "kept" },
        {
          userId: "banned-nominee",
          rank: "JONIN" as const,
          clanId: "banned",
          isBanned: true,
        },
        {
          userId: "anbu-leader",
          rank: "JONIN" as const,
          clanId: "anbu",
          anbuId: "squad",
        },
      ].map((user) => ({
        ...user,
        username: user.userId,
        villageId: "rotation-village",
      })),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
    setSystemTime();
  });

  it("logs demotions, promotions and skipped nominees with the rank changes", async () => {
    expect((await GET(request())).status).toBe(200);
    const db = await getTestDatabase();
    const users = await db.query.userData.findMany({
      columns: { userId: true, rank: true },
    });
    expect(Object.fromEntries(users.map((user) => [user.userId, user.rank]))).toEqual({
      renominated: "ELDER",
      retiring: "JONIN",
      "banned-nominee": "JONIN",
      "anbu-leader": "JONIN",
    });
    const rows = await db.query.actionLog.findMany({
      where: eq(actionLog.tableName, "village"),
    });
    expect(rows.every((row) => row.relatedId === "rotation-village")).toBe(true);
    expect(rows.map((row) => `${row.userId}: ${row.relatedMsg}`).sort()).toEqual([
      "anbu-leader: anbu-leader skipped as elder nominee",
      "banned-nominee: banned-nominee skipped as elder nominee",
      "renominated: renominated demoted from elder",
      "renominated: renominated promoted to elder",
      "retiring: retiring demoted from elder",
    ]);
    const skipped = rows.filter(
      (row) => row.userId === "anbu-leader" || row.userId === "banned-nominee",
    );
    expect(
      skipped
        .flatMap((row) => row.changes as string[])
        .filter((line) => line.startsWith("Reason: "))
        .sort(),
    ).toEqual(["Reason: Banned", "Reason: In ANBU"]);
    const clans = await db.query.clan.findMany({
      where: inArray(clan.id, ["kept", "banned", "anbu"]),
    });
    expect(
      clans.every(
        (entry) => entry.elderNomineeId === null && entry.activityPoints === 0,
      ),
    ).toBe(true);
  });
});
