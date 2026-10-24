import { getReward } from "@/libs/quest";
import { QuestValidator } from "@/validators/objectives";
import { describe, expect, it } from "bun:test";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { getCookingSeconds } from "@/libs/cooking";
import { getTerritoryCompetitor, getTerritoryWarBoost, getTerritoryWarPeriodBoost } from "@/libs/territoryWar";
import { calcJutsuTrainTime, trainingBoost } from "@/libs/train";
import { territoryWarAwards } from "@/server/utils/territoryWar";
import { guardianVictory } from "../setup/territoryWar";

const start = new Date("2026-10-24T12:00:00Z");
const until = new Date("2026-10-24T13:00:00Z");
const competitor = { id: "village:home", name: "Home", villageId: "home", clanId: null };
const citizen = { isOutlaw: false, villageId: "home", clanId: null, village: { id: "home", name: "Home", territoryWarBoostUntil: until } };


describe("Territory War membership and bonuses", () => {
  it("uses village membership for citizens, any clan for outlaws and Syndicate for unaffiliated outlaws", () => {
    expect(getTerritoryCompetitor(citizen)).toEqual(competitor);
    expect(getTerritoryCompetitor({ ...citizen, isOutlaw: true, clanId: "faction", clan: { id: "faction", name: "Faction", hasHideout: false, villageId: VILLAGE_SYNDICATE_ID } })).toEqual({ id: "clan:faction", name: "Faction", villageId: null, clanId: "faction" });
    expect(getTerritoryCompetitor({ ...citizen, isOutlaw: true }).id).toBe(`village:${VILLAGE_SYNDICATE_ID}`);
    expect(getTerritoryCompetitor({ ...citizen, clanId: "ordinary-clan", clan: { id: "ordinary-clan", name: "Clan", hasHideout: false, villageId: "home" } })).toEqual(competitor);
  });
  it("applies the bonus only within its one-hour window, with clan identity taking precedence for outlaws", () => {
    expect(getTerritoryWarBoost(citizen, start)).toBe(0.15);
    expect(getTerritoryWarBoost(citizen, new Date(start.getTime() - 1))).toBe(0);
    expect(getTerritoryWarBoost(citizen, until)).toBe(0);
    expect(getTerritoryWarBoost({ ...citizen, isOutlaw: true, clanId: "faction", clan: { territoryWarBoostUntil: null } }, start)).toBe(0);
    expect(getTerritoryWarPeriodBoost(citizen, new Date("2026-10-24T11:30:00Z"), new Date("2026-10-24T13:30:00Z"))).toBeCloseTo(0.075);
  });
  it("counts both victory windows when eight hours of training settle offline", () => {
    const user = { ...citizen, village: { ...citizen.village, territoryWarBoostUntil: new Date("2026-10-24T19:00:00Z") }, territoryWarBoostWindows: [{ startsAt: start.toISOString(), endsAt: until.toISOString() }, { startsAt: "2026-10-24T18:00:00Z", endsAt: "2026-10-24T19:00:00Z" }] };
    expect(getTerritoryWarPeriodBoost(user, start, new Date("2026-10-24T20:00:00Z"))).toBeCloseTo(0.15 * 2 / 8);
    expect(getTerritoryWarBoost(user, new Date("2026-10-24T12:30:00Z"))).toBe(0.15);
  });
  it("boosts profession XP contained in quest rewards and stacks clan percentages", () => {
    const quest = { id: "bonus-quest", ...QuestValidator.parse({ name: "Bonus quest", description: null, successDescription: null, tierLevel: null, questType: "daily", hidden: false, consecutiveObjectives: false, startsAt: null, endsAt: null, content: { objectives: [0,1,2].map(index => ({ id: `goal-${index}`, task: "win_quest", description: "Win", successDescription: "" })), reward: { reward_hunting_experience: 1000, reward_gathering_experience: 1000, reward_crafting_experience: 1000, reward_medical_experience: 1000 } } }) };
    const user = { ...citizen, village: { ...citizen.village, territoryWarBoostUntil: new Date(Date.now() + 3600000), structures: [], sectors: [] }, userId: "player", level: 50, rank: "JONIN", role: "USER", clan: { hunterExpBoost: 10, gathererExpBoost: 10, craftingExpBoost: 10 }, activeWars: [], completedQuests: [], dailyMissions: 0, senseiId: null, questData: [{ id: quest.id, goals: [0,1,2].map(index => ({ id: `goal-${index}`, value: 1, done: true })) }], userQuests: [{ id: "history", questId: quest.id, completed: 0, previousAttempts: 0, previousCompletes: 0, quest }] } as unknown as Parameters<typeof getReward>[0];
    expect(getReward(user, quest.id).rewards).toMatchObject({ reward_hunting_experience: 1250, reward_gathering_experience: 1250, reward_crafting_experience: 1250, reward_medical_experience: 1150 });
  });
  it("stacks training percentages and shortens jutsu training and cooking", () => {
    const user = { ...citizen, clan: { trainingBoost: 10 }, isOutlaw: false, rank: "JONIN", joinedVillageAt: start, villagePrestige: 0 } as unknown as NonNullable<UserWithRelations>;
    const baseline = trainingBoost({ ...user, village: null }, [], "STATS", start);
    expect(trainingBoost(user, [], "STATS", start) / baseline).toBeCloseTo(1.25 / 1.1);
    const jutsu = { jutsuRank: "D", requiredRank: "GENIN" } as const;
    expect(calcJutsuTrainTime(jutsu, 0, { ...citizen, senseiId: null, rank: "JONIN" }, start)).toBeCloseTo(60000 / 1.15);
    expect(getCookingSeconds({ cookingTimeSeconds: 100, cookingOutputQuantity: 1 }, 1, 0, 0.15)).toBe(85);
  });
});

describe("Territory War combat scoring", () => {
  it.each([1, 2, 3])("awards five points per winning member of a %s-player guardian team", size => {
    expect(territoryWarAwards(guardianVictory(size))).toEqual([{ competitor, points: size * 5 }]);
  });
  it("excludes summons, defeated and fled teammates and unfinished encounters", () => {
    const battle = guardianVictory(3);
    battle.usersState[1]!.curHealth = 0;
    battle.usersState[2]!.fledBattle = true;
    expect(territoryWarAwards(battle)[0]?.points).toBe(5);
    battle.usersState.at(-1)!.curHealth = 100;
    expect(territoryWarAwards(battle)).toEqual([]);
  });
  it("credits only open-world wins against opposing human competitors, including repeat opponents", () => {
    const battle = guardianVictory();
    battle.battleType = "COMBAT";
    const victim = battle.usersState.at(-1)!;
    victim.isAi = false;
    battle.extraState.territoryWar!.competitors[victim.userId] = { id: "village:enemy", name: "Enemy", villageId: "enemy", clanId: null };
    expect(territoryWarAwards(battle)[0]?.points).toBe(3);
    expect(territoryWarAwards({ ...battle, id: "repeat-battle" })[0]?.points).toBe(3);
    victim.fledBattle = true;
    expect(territoryWarAwards(battle)).toEqual([]);
    victim.fledBattle = false;
    battle.extraState.territoryWar!.competitors[victim.userId] = competitor;
    expect(territoryWarAwards(battle)).toEqual([]);
    battle.battleType = "SPARRING";
    expect(territoryWarAwards(battle)).toEqual([]);
  });
});
