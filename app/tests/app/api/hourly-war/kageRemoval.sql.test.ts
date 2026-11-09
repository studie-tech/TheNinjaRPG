import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/hourly-war/route";
import { KAGE_PRESTIGE_REQUIREMENT } from "@/drizzle/constants";
import {
  clan,
  notification,
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
  villageStructure,
  war,
} from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const now = new Date("2026-10-12T12:00:00.000Z");

describeWithDatabase("expired elder kage removal protection", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(
      clan,
      notification,
      userData,
      village,
      villageElderVote,
      villageElderVoteEntry,
      villageStructure,
      war,
    );
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      isNewHour: true,
      prevTime: new Date(0),
      response: Response.json("Ready"),
    });
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      isClaimed: false,
      isNewDay: false,
      prevTime: now,
      response: Response.json("Wait"),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
    setSystemTime();
  });

  it.each([true, false])(
    "guards automatic removal using the current tenure (protected: %s)",
    async (isProtected) => {
      const db = await getTestDatabase();
      await db.insert(village).values({
        id: "expired-village",
        name: "Expired vote village",
        kageId: "expired-kage",
        leaderUpdatedAt: new Date(
          isProtected ? "2026-10-07T12:00:00.000Z" : "2026-09-28T12:00:00.000Z",
        ),
      });
      await insertUsers([
        {
          userId: "expired-kage",
          villageId: "expired-village",
          villagePrestige: KAGE_PRESTIGE_REQUIREMENT,
        },
        ...["expired-elder-1", "expired-elder-2", "expired-elder-3"].map((userId) => ({
          userId,
          villageId: "expired-village",
          rank: "ELDER" as const,
          villagePrestige: KAGE_PRESTIGE_REQUIREMENT,
        })),
      ]);
      await db.insert(villageElderVote).values({
        id: "expired-vote",
        villageId: "expired-village",
        type: "KAGE_REMOVAL",
        initiatedByUserId: "expired-elder-1",
        targetId: "expired-kage",
        endsAt: new Date("2026-10-12T11:00:00.000Z"),
      });
      await db.insert(villageElderVoteEntry).values(
        ["expired-elder-1", "expired-elder-2"].map((userId) => ({
          id: userId,
          voteId: "expired-vote",
          userId,
          vote: "YES" as const,
        })),
      );
      expect((await GET(new Request("http://localhost/api/hourly-war"))).status).toBe(
        200,
      );
      const [storedVillage, storedKage, vote, notices] = await Promise.all([
        db.query.village.findFirst(),
        db.query.userData.findFirst({ where: eq(userData.userId, "expired-kage") }),
        db.query.villageElderVote.findFirst(),
        db.query.notification.findMany(),
      ]);
      expect(vote?.status).toBe(isProtected ? "REJECTED" : "APPROVED");
      expect(storedKage?.villagePrestige).toBe(KAGE_PRESTIGE_REQUIREMENT);
      expect(notices.length).toBeGreaterThan(0);
      if (isProtected) {
        expect(storedVillage?.kageId).toBe("expired-kage");
      } else {
        expect(storedVillage?.kageId).not.toBe("expired-kage");
        expect(storedVillage?.leaderUpdatedAt).toEqual(now);
      }
    },
  );
});
