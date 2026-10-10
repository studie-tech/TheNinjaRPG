import { describe, expect, it } from "bun:test";
import { MAP_WAKE_ISLAND_SECTOR, MISSIONS_PER_DAY } from "@/drizzle/constants";
import { resolveDashboardContent } from "@/libs/profileDashboard";

type Candidate = Parameters<typeof resolveDashboardContent>[0][number];
type User = Parameters<typeof resolveDashboardContent>[1];

const candidate = (patch: Partial<Candidate> = {}): Candidate => ({
  id: "story",
  name: "Story",
  image: null,
  description: null,
  questRank: "D",
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  requiredLevel: 1,
  requiredFarmingLevel: 0,
  prerequisiteQuestId: null,
  questType: "story",
  hidden: false,
  requiredVillage: null,
  requiredBloodlineId: null,
  requiredSageModeId: null,
  requiredSageRank: null,
  maxLevel: 100,
  maxAttempts: 0,
  maxCompletes: 0,
  retryDelay: "none",
  startsAt: null,
  endsAt: null,
  previousAttempts: null,
  previousCompletes: null,
  periodCompletes: null,
  periodStartAt: null,
  ...patch,
});

const user = (patch: Partial<User> = {}): User =>
  ({
    role: "USER",
    rank: "CHUNIN",
    level: 20,
    sector: MAP_WAKE_ISLAND_SECTOR,
    villageId: "village",
    village: {
      name: "Home",
      type: "VILLAGE",
      sector: MAP_WAKE_ISLAND_SECTOR,
      structures: [
        { route: "/globalanbuhq", allyAccess: 1 },
        { route: "/missionhall", allyAccess: 1 },
      ],
      relationshipA: [],
      relationshipB: [],
    },
    isOutlaw: false,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    farmingExperience: 0,
    sageMasteryExperience: 0,
    sageModeId: null,
    completedQuests: [],
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
    dailyWarMissions: 0,
    ...patch,
  }) as User;

describe("dashboard discovery from shared profile data", () => {
  it("unlocks cached candidates when getUser supplies a completed prerequisite", () => {
    const candidates = [candidate({ prerequisiteQuestId: "prerequisite" })];
    expect(resolveDashboardContent(candidates, user())).toEqual([]);
    expect(
      resolveDashboardContent(
        candidates,
        user({
          completedQuests: [{ id: "history", questId: "prerequisite", completed: 1 }],
        }),
      ),
    ).toEqual([expect.objectContaining({ id: "story", availability: "available" })]);
  });

  it("excludes ranks the player cannot start instead of building locked cards", () => {
    expect(
      resolveDashboardContent(
        [candidate({ questRank: "A" })],
        user({ rank: "STUDENT" }),
      ),
    ).toEqual([]);
  });

  it("does not recommend an event that is already active", () => {
    expect(
      resolveDashboardContent(
        [candidate({ id: "event", questType: "event" })],
        user({
          userQuests: [
            { questId: "event", endAt: null, quest: { questType: "event" } },
          ] as User["userQuests"],
        }),
      ),
    ).toEqual([]);
  });

  it("updates travel guidance from the current user sector", () => {
    const candidates = [candidate()];
    expect(
      resolveDashboardContent(candidates, user({ sector: -1 }))[0]?.availability,
    ).toBe("travel");
    expect(resolveDashboardContent(candidates, user())[0]?.availability).toBe(
      "available",
    );
  });

  it("removes daily assignments once the shared profile reaches its daily limit", () => {
    const candidates = [candidate({ questType: "mission" })];
    expect(resolveDashboardContent(candidates, user())).toHaveLength(1);
    expect(
      resolveDashboardContent(candidates, user({ dailyMissions: MISSIONS_PER_DAY })),
    ).toEqual([]);
  });

  it("does not expose expired or hidden candidates to ordinary users", () => {
    expect(
      resolveDashboardContent(
        [candidate({ hidden: true }), candidate({ endsAt: "2000-01-01T00:00:00Z" })],
        user(),
      ),
    ).toEqual([]);
  });

  it("uses war status as well as membership for war mission discovery", () => {
    const candidates = [candidate({ questType: "war" })];
    const war = {
      status: "ACTIVE",
      attackerVillageId: "village",
      warAllies: [],
    } as unknown as NonNullable<User["activeWars"]>[number];
    expect(
      resolveDashboardContent(candidates, user({ activeWars: [war] })),
    ).toHaveLength(1);
    expect(
      resolveDashboardContent(
        candidates,
        user({ activeWars: [{ ...war, status: "ENDED" }] }),
      ),
    ).toEqual([]);
  });
});


it("marks a banned player's content as view-only and preserves location guidance away from it", () => {
  expect(resolveDashboardContent([candidate()], user({ isBanned: true }))[0]).toMatchObject({ availability: "blocked", availabilityReason: "You are banned and cannot start quests" });
  expect(resolveDashboardContent([candidate()], user({ isBanned: true, sector: -1 }))[0]).toMatchObject({ availability: "travel", availabilityReason: expect.stringContaining("You are banned") });
});
