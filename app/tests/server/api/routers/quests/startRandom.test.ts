import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { questsRouter } from "@/routers/quests";
import { deferred } from "../../../../setup/deferred";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

const input = {
  type: "crime" as const,
  rank: "A" as const,
  userLevel: 50,
  userSector: 0,
  userVillageId: null,
};

const user = {
  userId: "hero",
  role: "USER",
  rank: "JONIN",
  level: 50,
  sector: 0,
  villageId: null,
  isOutlaw: true,
  status: "AWAKE",
  bloodlineId: null,
  sageModeId: null,
  sageMasteryExperience: 0,
  farmingExperience: 0,
  medicalExperience: 0,
  huntingExperience: 0,
  gatheringExperience: 0,
  completedQuests: [],
  userQuests: [],
} as unknown as Parameters<typeof isAvailableUserQuests>[1];

const candidate = {
  id: "assignment",
  name: "Assignment",
  questType: "crime",
  questRank: "A",
  requiredFarmingLevel: 0,
  requiredVillage: null,
  requiredBloodlineId: null,
  requiredSageModeId: null,
  requiredSageRank: null,
  hidden: false,
  maxAttempts: 1,
  maxCompletes: 1,
  retryDelay: "none",
  content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
} as unknown as Quest;

const makeClient = (rows: Quest[] = []) => {
  const findVillage = vi.fn().mockResolvedValue(null);
  const candidates = vi.fn().mockResolvedValue(rows);
  const update = vi.fn();
  const insert = vi.fn();
  return {
    client: {
      query: { village: { findFirst: findVillage } },
      select: () => ({ from: () => ({ leftJoin: () => ({ where: candidates }) }) }),
      update,
      insert,
    },
    findVillage,
    candidates,
    update,
    insert,
  };
};

describe("random assignment reads", () => {
  afterEach(resetServerModuleStubs);

  it("loads the village and candidates while user regeneration is pending", async () => {
    const refresh = deferred<{ user: typeof user }>();
    const started = deferred<void>();
    stubProfile("fetchUpdatedUser", (() => {
      started.resolve();
      return refresh.promise;
    }) as never);
    const { client, findVillage, candidates } = makeClient();
    const pending = callerForDatabase(
      questsRouter,
      user.userId,
      client as never,
    ).startRandom(input);

    await started.promise;
    const villageReads = findVillage.mock.calls.length;
    const candidateReads = candidates.mock.calls.length;
    refresh.resolve({ user });
    const result = await pending;

    expect(villageReads).toBe(1);
    expect(candidateReads).toBe(1);
    expect(result).toEqual({
      success: false,
      message: "No assignments at this level could be found",
    });
  });

  it.each([
    { requiredBloodlineId: "other-bloodline" },
    { requiredSageModeId: "other-mode" },
    { requiredSageRank: "MASTER" as const },
    { requiredFarmingLevel: 2 },
  ])(
    "rejects an ineligible candidate from the widened pool: %j",
    async (requirement) => {
      // The baseline is available, so each requirement is what prevents assignment.
      expect(isAvailableUserQuests(candidate, user).check).toBe(true);
      stubProfile("fetchUpdatedUser", (async () => ({ user })) as never);
      const { client, update, insert } = makeClient([{ ...candidate, ...requirement }]);
      const result = await callerForDatabase(
        questsRouter,
        user.userId,
        client as never,
      ).startRandom(input);

      expect(result).toEqual({
        success: false,
        message: "No assignments at this level could be found",
      });
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );
});
