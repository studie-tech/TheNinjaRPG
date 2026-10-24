import { makeBattleUser, makeCompleteBattle } from "../libs/combat/helpers/battleScenario";
const competitor = { id: "village:home", name: "Home", villageId: "home", clanId: null };

/**
 * Decided one-to-three human victory with frozen competitor metadata. Explicit
 * persistence fields let SQL suites insert this same state into Battle unchanged.
 */
export const guardianVictory = (size = 1, id = "battle") => makeCompleteBattle({
  id, version: 0, background: "default", width: 12, height: 10, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(), rewardScaling: 1, forceKeepPools: false, activeUserId: "player-0", battleType: "TERRITORY_WAR",
  usersState: [
    ...Array.from({ length: size }, (_, index) => makeBattleUser(`player-${index}`, { direction: "left", isAi: false, isSummon: false, sector: 100 })),
    makeBattleUser("guardian", { direction: "right", isAi: true, isSummon: false, curHealth: 0, sector: 100 }),
  ],
  extraState: { territoryWar: { id: "event", competitors: Object.fromEntries(Array.from({ length: size }, (_, i) => [`player-${i}`, competitor])) } },
});
