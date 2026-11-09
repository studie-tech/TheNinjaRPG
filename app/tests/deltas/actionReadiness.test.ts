import { expect, it } from "bun:test";
import { getActionRecoveryUpdate } from "@/deltas/actionReadiness";
import { CombatStatNames, MasteryNames } from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";

const now = new Date("2026-11-06T00:00:00Z");
const actor = () => {
  const user: Partial<NonNullable<UserWithRelations>> = {
    userId: "actor",
    status: "AWAKE",
    level: 50,
    rank: "JONIN",
    isOutlaw: true,
    regeneration: 5,
    baseRegeneration: 5,
    homeType: "NONE",
    village: null,
    userQuests: [],
    questData: [],
    queue: [],
    items: [],
    activePetId: "companion",
    experience: 110,
    petExperience: 35,
    earnedExperience: 0,
    curHealth: 100,
    curChakra: 90,
    curStamina: 80,
    curEnergy: 70,
    regenAt: now,
    ...Object.fromEntries(
      [...CombatStatNames, ...MasteryNames].map((field) => [field, 100]),
    ),
  };
  return user as NonNullable<UserWithRelations>;
};

it("includes the known companion bank from a raw reread after prior settlement", () => {
  const user = actor();
  const recovery = getActionRecoveryUpdate(
    { ...user, status: "ASLEEP" },
    user,
    ["status"],
    [],
    now,
  );
  expect(recovery.requiresUserRefresh).toBeUndefined();
  expect(recovery.userPatch).toMatchObject({ experience: 110, petExperience: 35 });
  user.petExperience = 50;
  expect(recovery.userPatch?.petExperience).toBe(35);
});

it("withholds the companion bank when recovery itself grants live eligible companion XP", () => {
  const user = actor();
  const recovery = getActionRecoveryUpdate(
    { ...user, status: "ASLEEP", experience: 100 },
    user,
    ["status", "petExperience"],
    [],
    now,
  );
  expect(recovery.requiresUserRefresh).toBe(true);
  expect(recovery.userPatch?.petExperience).toBeUndefined();
  expect(recovery.userPatch?.experience).toBe(110);
});

it("keeps hydrated SQL companion grants explicitly unknown even after the queue head advanced", () => {
  const user = { ...actor(), energyQueueHead: 1, requiresProgressionRefresh: true };
  const recovery = getActionRecoveryUpdate(
    { ...user, status: "ASLEEP" },
    user,
    ["status"],
    [],
    now,
  );
  expect(recovery.requiresUserRefresh).toBe(true);
  expect(recovery.userPatch?.petExperience).toBeUndefined();
  expect(recovery.userPatch).toMatchObject({
    experience: 110,
    energyQueueHead: 1,
    status: "AWAKE",
  });
});

it("captures settled cooking, elements and daily counters without sharing mutable job rows", () => {
  const user = {
    ...actor(),
    cookingExperience: 30,
    cookingJobs: [],
    primaryElement: "Fire" as const,
    secondaryElement: "Water" as const,
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyWarMissions: 0,
    dailyArenaFights: 0,
    dailyPvpMissions: 0,
    dailySageActivations: 0,
    dailyOverworldQuestRolls: 0,
  };
  const recovery = getActionRecoveryUpdate(
    { ...user, status: "ASLEEP" },
    user,
    ["status"],
    [],
    now,
  );
  expect(recovery.requiresUserRefresh).toBeUndefined();
  expect(recovery.userPatch).toMatchObject({
    cookingExperience: 30,
    cookingJobs: [],
    primaryElement: "Fire",
    secondaryElement: "Water",
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyWarMissions: 0,
    dailyArenaFights: 0,
    dailyPvpMissions: 0,
    dailySageActivations: 0,
    dailyOverworldQuestRolls: 0,
  });
  expect(recovery.userPatch?.cookingJobs).not.toBe(user.cookingJobs);
});
