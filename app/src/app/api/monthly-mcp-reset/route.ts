import { inArray, notInArray } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  CoreVillages,
  STARTING_REPUTATION_POINTS,
  STEALTH_SENSORY_DEFAULT,
} from "@/drizzle/constants";
import {
  actionLog,
  anbuSquad,
  auctionBid,
  auctionListing,
  bankTransfers,
  battle,
  battleAction,
  battleHistory,
  bloodlineRolls,
  bounty,
  bountyContribution,
  bountySignup,
  clan,
  conceptImage,
  conversation,
  conversationComment,
  dailyBankInterest,
  damageSimulation,
  dataBattleAction,
  forumPost,
  forumThread,
  historicalAvatar,
  historicalIp,
  historicalSoundEffect,
  itemLoadout,
  jutsuLoadout,
  jutsuReskin,
  kageDefendedChallenges,
  logBattleLengths,
  logQueueLengths,
  logRankedPicks,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  poll,
  pollOption,
  questHistory,
  raidDamageThreshold,
  raidParticipation,
  rankedLoadout,
  rankedPvpQueue,
  rankedUserRewards,
  ryoTrade,
  sageModeRolls,
  supportTicket,
  supportTicketActivity,
  tournament,
  tournamentMatch,
  tournamentRecord,
  towerDefenseRun,
  trainingLog,
  user2conversation,
  userActivityEvent,
  userAssociation,
  userAttribute,
  userBadge,
  userBlackList,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  userLikes,
  userNindo,
  userPollVote,
  userRaidBuff,
  userRequest,
  userReview,
  userRewards,
  userSkill,
  userStreakProgress,
  userTowerDefenseUpgrade,
  userUpload,
  userVote,
  village,
  villageAlliance,
  villageStructure,
  war,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithMonthlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

export async function GET() {
  await cookies();

  // Environment check - only run on the MCP server at the expected domain
  const isMcpEnabled = process.env.NEXT_PUBLIC_MCP_ENABLED === "true";
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const isMcpDomain = new URL(baseUrl).hostname === "www.theninja-rpg.ai";
  if (!isMcpEnabled || !isMcpDomain) {
    return Response.json(
      "MCP reset only runs on the MCP server (www.theninja-rpg.ai)",
      {
        status: 200,
      },
    );
  }

  // Check monthly timer
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, "monthly-mcp-reset");
  if (!timerCheck.isNewMonth && timerCheck.response) {
    return timerCheck.response;
  }

  try {
    await runMcpReset();
    return Response.json("Monthly MCP reset completed successfully", { status: 200 });
  } catch (cause) {
    // Rollback timer on error
    await updateGameSetting(drizzleDB, "monthly-mcp-reset", 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}

const runMcpReset = async () => {
  // Batch 1: Identify Default Village IDs
  const defaultVillages = await drizzleDB.query.village.findMany({
    where: inArray(village.name, CoreVillages),
    columns: { id: true },
  });
  const defaultVillageIds = defaultVillages.map((v) => v.id);

  // Batch 2: Delete Village/Clan/Faction Data (Parallel)
  await Promise.all([
    // Delete non-default villages
    drizzleDB.delete(village).where(notInArray(village.id, defaultVillageIds)),

    // Delete all clans
    drizzleDB.delete(clan),

    // Delete all ANBU squads
    drizzleDB.delete(anbuSquad),

    // Delete village structures for non-default villages
    drizzleDB
      .delete(villageStructure)
      .where(notInArray(villageStructure.villageId, defaultVillageIds)),

    // Delete all village alliances
    drizzleDB.delete(villageAlliance),
  ]);

  // Batch 3: Delete Combat & Battle Data (Parallel)
  await Promise.all([
    drizzleDB.delete(battle),
    drizzleDB.delete(battleAction),
    drizzleDB.delete(battleHistory),
    drizzleDB.delete(rankedPvpQueue),
    drizzleDB.delete(rankedUserRewards),
    drizzleDB.delete(mpvpBattleQueue),
    drizzleDB.delete(mpvpBattleUser),
    drizzleDB.delete(damageSimulation),
  ]);

  // Batch 4: Delete User Progress & Abilities (Parallel)
  await Promise.all([
    drizzleDB.delete(userItem),
    drizzleDB.delete(userItemImbuement),
    drizzleDB.delete(userJutsu),
    drizzleDB.delete(userSkill),
    drizzleDB.delete(userAttribute),
    drizzleDB.delete(bloodlineRolls),
    drizzleDB.delete(sageModeRolls),
    drizzleDB.delete(jutsuLoadout),
    drizzleDB.delete(itemLoadout),
    drizzleDB.delete(rankedLoadout),
    drizzleDB.delete(userBadge),
    drizzleDB.delete(userStreakProgress),
  ]);

  // Batch 5: Delete Quest & Training Data (Parallel)
  await Promise.all([
    drizzleDB.delete(questHistory),
    drizzleDB.delete(trainingLog),
    drizzleDB.delete(raidParticipation),
    drizzleDB.delete(raidDamageThreshold),
    drizzleDB.delete(userRaidBuff),
  ]);

  // Batch 6: Delete Bounty System (Parallel)
  await Promise.all([
    drizzleDB.delete(bounty),
    drizzleDB.delete(bountySignup),
    drizzleDB.delete(bountyContribution),
  ]);

  // Batch 7: Delete Economy & Trading (Parallel)
  await Promise.all([
    drizzleDB.delete(auctionListing),
    drizzleDB.delete(auctionBid),
    drizzleDB.delete(bankTransfers),
    drizzleDB.delete(dailyBankInterest),
    drizzleDB.delete(ryoTrade),
    drizzleDB.delete(userRequest),
    drizzleDB.delete(userRewards),
  ]);

  // Batch 8: Delete Tournament & War Data (Parallel)
  await Promise.all([
    drizzleDB.delete(tournament),
    drizzleDB.delete(tournamentMatch),
    drizzleDB.delete(tournamentRecord),
    drizzleDB.delete(war),
    drizzleDB.delete(warAlly),
    drizzleDB.delete(warKill),
    drizzleDB.delete(kageDefendedChallenges),
  ]);

  // Batch 9: Delete Social & Communication (Parallel)
  await Promise.all([
    drizzleDB.delete(conversation),
    drizzleDB.delete(user2conversation),
    drizzleDB.delete(conversationComment),
    drizzleDB.delete(forumThread),
    drizzleDB.delete(forumPost),
    drizzleDB.delete(notification),
    drizzleDB.delete(userBlackList),
    drizzleDB.delete(userAssociation),
  ]);

  // Batch 10: Delete User Generated Content (Parallel)
  await Promise.all([
    drizzleDB.delete(conceptImage),
    drizzleDB.delete(userLikes),
    drizzleDB.delete(jutsuReskin),
    drizzleDB.delete(userUpload),
    drizzleDB.delete(historicalAvatar),
    drizzleDB.delete(historicalSoundEffect),
    drizzleDB.delete(historicalIp),
  ]);

  // Batch 11: Delete Analytics & Tracking (Parallel)
  await Promise.all([
    drizzleDB.delete(logBattleLengths),
    drizzleDB.delete(logQueueLengths),
    drizzleDB.delete(logRankedPicks),
    drizzleDB.delete(dataBattleAction),
    drizzleDB.delete(actionLog),
    drizzleDB.delete(userActivityEvent),
  ]);

  // Batch 12: Delete Miscellaneous User Data (Parallel)
  await Promise.all([
    drizzleDB.delete(userNindo),
    drizzleDB.delete(userReview),
    drizzleDB.delete(userVote),
    drizzleDB.delete(poll),
    drizzleDB.delete(pollOption),
    drizzleDB.delete(userPollVote),
    drizzleDB.delete(towerDefenseRun),
    drizzleDB.delete(userTowerDefenseUpgrade),
    drizzleDB.delete(supportTicket),
    drizzleDB.delete(supportTicketActivity),
  ]);

  // Batch 13: Reset UserData Fields (NOT Delete)
  await drizzleDB.update(userData).set({
    money: 1000,
    bank: 1000,
    experience: 0,
    earnedExperience: 2000,
    level: 1,
    rank: "STUDENT",
    bloodlineId: null,
    bloodlineReskinId: null,
    sageModeId: null,
    sageMasteryExperience: 0,
    villageId: null,
    clanId: null,
    anbuId: null,
    senseiId: null,
    jutsuLoadout: null,
    itemLoadout: null,
    rankedLoadout: null,
    curHealth: 100,
    curChakra: 100,
    curStamina: 100,
    maxHealth: 100,
    maxChakra: 100,
    maxStamina: 100,
    regeneration: 60,
    strength: 10,
    intelligence: 10,
    willpower: 10,
    speed: 10,
    ninjutsuOffence: 10,
    ninjutsuDefence: 10,
    genjutsuOffence: 10,
    genjutsuDefence: 10,
    taijutsuOffence: 10,
    taijutsuDefence: 10,
    bukijutsuOffence: 10,
    bukijutsuDefence: 10,
    statsMultiplier: 1,
    poolsMultiplier: 1,
    primaryElement: null,
    secondaryElement: null,
    reputationPoints: STARTING_REPUTATION_POINTS,
    reputationPointsTotal: STARTING_REPUTATION_POINTS,
    seichiSilver: 0,
    villagePrestige: 0,
    federalStatus: "NONE",
    isOutlaw: false,
    battleId: null,
    status: "AWAKE",
    inArena: false,
    inShrines: false,
    sector: 0,
    longitude: 10,
    latitude: 7,
    location: "",
    dailyArenaFights: 0,
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
    dailyTrainings: 0,
    dailySageActivations: 0,
    pvpActivity: 0,
    pvpFights: 0,
    pveFights: 0,
    pvpStreak: 0,
    errands: 0,
    missionsD: 0,
    missionsC: 0,
    missionsB: 0,
    missionsA: 0,
    missionsS: 0,
    missionsH: 0,
    crimesD: 0,
    crimesC: 0,
    crimesB: 0,
    crimesA: 0,
    crimesS: 0,
    crimesH: 0,
    rankedLp: 0,
    rankedBattles: 0,
    rankedWins: 0,
    rankedStreak: 0,
    skillPoints: 0,
    towerDefensePoints: 0,
    medicalExperience: 0,
    craftingExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    occupation: null,
    occupationSignupAt: null,
    homeType: "NONE",
    questData: null,
    trainingStartedAt: null,
    currentlyTraining: null,
    travelFinishAt: null,
    questFinishAt: new Date(),
    extraItemSlots: 0,
    extraJutsuSlots: 0,
    extraReskinSlots: 2,
    marriageSlots: 1,
    customTitle: "",
    nRecruited: 0,
    effects: [],
    stealth: STEALTH_SENSORY_DEFAULT,
    sensory: STEALTH_SENSORY_DEFAULT,
    stealthActive: false,
    stealthActivatedAt: null,
    stealthCooldownAt: null,
    lastSensoryAt: null,
    covertTrainingType: null,
    covertTrainingStartedAt: null,
    covertTrainingMinutes: null,
  });

  // Batch 14: Reset Default Village Stats
  await drizzleDB
    .update(village)
    .set({
      tokens: 0,
      populationCount: 0,
    })
    .where(inArray(village.id, defaultVillageIds));
};
