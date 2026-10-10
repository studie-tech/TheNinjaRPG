import { describe, expect, it } from "bun:test";
import { getUserCaps } from "@/drizzle/constants";
import { isStreakContinuous, nextStreakRefreshAt } from "@/libs/activityStreak";
import { bankAccessBlockMessage } from "@/libs/bank";
import { calcLevelRequirements, levelUpBlockMessage } from "@/libs/profile";
import {
  questAlreadyActiveBlockMessage,
  questRequiresTravel,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
} from "@/libs/quest";
import { raidRewardBlockMessage } from "@/libs/raids";
import { statTrainingBlockMessage } from "@/libs/train";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { SectorVillage } from "@/utils/village";

const user = {
  status: "AWAKE",
  rank: "STUDENT",
  level: 5,
  experience: calcLevelRequirements(5),
  isOutlaw: false,
  isBanned: false,
  currentlyTraining: null,
  dailyTrainings: 0,
  dailyWarMissions: 0,
  trainingSpeed: "8hrs",
  longitude: 0,
  latitude: 0,
  sector: 1,
  villageId: "home",
  village: { name: "Home", sector: 1 },
  userQuests: [],
} as unknown as NonNullable<UserWithRelations>;

const village = {
  id: "ally",
  sector: 2,
  type: "VILLAGE",
  structures: [
    { route: "/missionhall", allyAccess: 1 },
    { route: "/adminbuilding", allyAccess: 1 },
  ],
  relationshipA: [{ villageIdA: "home", villageIdB: "ally", status: "ALLY" }],
  relationshipB: [],
} as unknown as SectorVillage;

describe("shared profile system contracts", () => {
  it("respects rank caps and Horizon progression for level-up previews", () => {
    expect(levelUpBlockMessage(user)).toBeNull();
    const cap = getUserCaps("STUDENT").lvl_cap;
    expect(
      levelUpBlockMessage({
        ...user,
        level: cap,
        experience: calcLevelRequirements(cap),
      }),
    ).toContain("max level");
    expect(
      levelUpBlockMessage({
        ...user,
        rank: "CHUNIN",
        level: 10,
        experience: calcLevelRequirements(10),
        village: { name: "Horizon" },
      }),
    ).toContain("Horizon");
  });

  it("rejects Energy spending for banned users", () => {
    expect(statTrainingBlockMessage({...user, isBanned: true})).toContain("banned");
  });

  it("recognizes allied structure access instead of sending every visitor home", () => {
    const visitor = { ...user, sector: 2 };
    expect(questRequiresTravel("mission", visitor, village)).toBe(false);
    expect(questRequiresTravel("event", visitor, village)).toBe(false);
    expect(
      questUiAccessBlockMessage(
        { questType: "event", questRank: "D" },
        visitor,
        village,
      ),
    ).toBeNull();
    const closed = {
      ...village,
      structures: village.structures.map((structure) => ({
        ...structure,
        allyAccess: 0,
      })),
    };
    expect(questRequiresTravel("mission", visitor, closed)).toBe(true);
    expect(
      questUiAccessBlockMessage(
        { questType: "event", questRank: "D" },
        visitor,
        closed,
      ),
    ).not.toBeNull();
  });

  it("rejects an already-active event even when the type has room for more", () => {
    const busy = { userQuests: [{ questId: "event", endAt: null }] } as unknown as Pick<
      NonNullable<UserWithRelations>,
      "userQuests"
    >;
    expect(
      questAlreadyActiveBlockMessage({ id: "event", name: "Event" }, busy),
    ).not.toBeNull();
    expect(
      questAlreadyActiveBlockMessage({ id: "other", name: "Other" }, busy),
    ).toBeNull();
  });

  it("keeps errands in the random-assignment concurrency slot", () => {
    const busy = {
      ...user,
      userQuests: [{ endAt: null, quest: { name: "Mission", questType: "mission" } }],
    } as unknown as NonNullable<UserWithRelations>;
    expect(
      questTypeConcurrentBlockMessage({ name: "Errand", questType: "errand" }, busy),
    ).not.toBeNull();
  });

  it("does not advertise bank claims or raid thresholds rejected by the server", () => {
    expect(
      bankAccessBlockMessage({ status: "BATTLE", isBanned: false }),
    ).not.toBeNull();
    expect(bankAccessBlockMessage({ status: "AWAKE", isBanned: true })).not.toBeNull();
    const threshold = { id: "reward", damageRequired: 100 };
    expect(
      raidRewardBlockMessage({ damageDealt: 99, rewardsClaimed: [] }, threshold),
    ).not.toBeNull();
    expect(
      raidRewardBlockMessage(
        { damageDealt: 100, rewardsClaimed: ["reward"] },
        threshold,
      ),
    ).not.toBeNull();
    expect(
      raidRewardBlockMessage({ damageDealt: 100, rewardsClaimed: [] }, threshold),
    ).toBeNull();
  });

  it("refreshes streaks at elapsed pass days and the exact continuity deadline", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const lastClaimDate = new Date("2026-09-30T00:00:00Z");
    expect(isStreakContinuous(lastClaimDate, new Date(now.getTime() - 1))).toBe(true);
    expect(isStreakContinuous(lastClaimDate, now)).toBe(false);
    expect(
      nextStreakRefreshAt(
        [{ lastClaimDate: now, startedAt: new Date("2026-09-30T14:00:00Z") }],
        now,
      ),
    ).toEqual(new Date("2026-10-01T14:00:00Z"));
    expect(nextStreakRefreshAt([], now)).toEqual(new Date("2026-10-02T00:00:00Z"));
  });
});
