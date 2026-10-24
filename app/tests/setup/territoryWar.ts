import { makeBattleUser, makeCompleteBattle } from "../libs/combat/helpers/battleScenario";
const competitor = { id: "village:home", name: "Home", villageId: "home", clanId: null };
const until = new Date("2026-10-24T13:00:00Z");

export const guardianVictory = (size = 1, id = "battle") => makeCompleteBattle({
  id, version: 0, background: "default", width: 12, height: 10, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(), rewardScaling: 1, forceKeepPools: false, activeUserId: "player-0", battleType: "TERRITORY_WAR",
  usersState: [
    ...Array.from({ length: size }, (_, index) => makeBattleUser(`player-${index}`, { direction: "left", isAi: false, isSummon: false, sector: 100 })),
    makeBattleUser("guardian", { direction: "right", isAi: true, isSummon: false, curHealth: 0, sector: 100 }),
  ],
  extraState: { territoryWar: { id: "event", sector: 100, endsAt: until.toISOString(), competitors: Object.fromEntries(Array.from({ length: size }, (_, i) => [`player-${i}`, competitor])) } },
});
