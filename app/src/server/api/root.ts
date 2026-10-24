import { bloodrightRouter } from "@/server/api/routers/bloodright";
import { rewardPackagesRouter } from "@/server/api/routers/rewardPackages";
import { accountDeletionRouter } from "./routers/accountDeletion";
import { activityStreakRouter } from "./routers/activityStreak";
import { aiRouter } from "./routers/ai";
import { anbuRouter } from "./routers/anbu";
import { applicationsRouter } from "./routers/applications";
import { gameAssetRouter } from "./routers/asset";
import { auctionRouter } from "./routers/auction";
import { audioRouter } from "./routers/audio";
import { avatarRouter } from "./routers/avatar";
import { badgeRouter } from "./routers/badge";
import { bankRouter } from "./routers/bank";
import { blackMarketRouter } from "./routers/blackmarket";
import { bloodlineRouter } from "./routers/bloodline";
import { bountyRouter } from "./routers/bounty";
import { clanRouter } from "./routers/clan";
import { combatRouter } from "./routers/combat";
import { commentsRouter } from "./routers/comments";
import { conceptartRouter } from "./routers/conceptart";
import { contentReviewRouter } from "./routers/contentReview";
import { coopRouter } from "./routers/coop";
import { dataRouter } from "./routers/data";
import { discordRouter } from "./routers/discord";
import { farmingRouter } from "./routers/farming";
import { forumRouter } from "./routers/forum";
import { guideRouter } from "./routers/guide";
import { homeRouter } from "./routers/home";
import { hospitalRouter } from "./routers/hospital";
import { huntingRouter } from "./routers/hunting";
import { itemRouter } from "./routers/item";
import { jutsuRouter } from "./routers/jutsu";
import { kageRouter } from "./routers/kage";
import { linkPromotionRouter } from "./routers/linkpromotion";
import { logsRouter } from "./routers/logs";
import { mapAssetRouter } from "./routers/mapAsset";
import { mapTerrainRouter } from "./routers/mapTerrain";
import { marriageRouter } from "./routers/marriage";
import { merchRouter } from "./routers/merch";
import { miscRouter } from "./routers/misc";
import { nativeAuthRouter } from "./routers/nativeAuth";
import { occupationRouter } from "./routers/occupation";
import { generativeAiRouter } from "./routers/openai";
import { overworldAiRouter } from "./routers/overworldAi";
import { parentalControlsRouter } from "./routers/parentalControls";
import { paypalRouter } from "./routers/paypal";
import { petSpeciesRouter } from "./routers/petSpecies";
import { petsRouter } from "./routers/pets";
import { pollRouter } from "./routers/poll";
import { profileRouter } from "./routers/profile";
import { purchasesRouter } from "./routers/purchases";
import { pushRouter } from "./routers/push";
import { pvpRankRouter } from "./routers/pvprank";
import { questsRouter } from "./routers/quests";
import { raidsRouter } from "./routers/raids";
import { registerRouter } from "./routers/register";
import { reportsRouter } from "./routers/reports";
import { sageModeRouter } from "./routers/sageMode";
import { senseiRouter } from "./routers/sensei";
import { shrineRouter } from "./routers/shrine";
import { simulatorRouter } from "./routers/simulator";
import { skillTreeRouter } from "./routers/skillTree";
import { sparringRouter } from "./routers/sparring";
import { staffRouter } from "./routers/staff";
import { stealthRouter } from "./routers/stealth";
import { stripeRouter } from "./routers/stripe";
import { supportRouter } from "./routers/support";
import { titleRouter } from "./routers/title";
import { tournamentRouter } from "./routers/tournament";
import { towerDefenseRouter } from "./routers/towerDefense";
import { trainRouter } from "./routers/train";
import { travelRouter } from "./routers/travel";
import { villageRouter } from "./routers/village";
import { villageMissionRouter } from "./routers/villageMission";
import { warRouter } from "./routers/war";
import { worldMapRouter } from "./routers/worldMap";
import { createTRPCRouter, type ProcedureMeta } from "./trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here
 */
export const appRouter = createTRPCRouter({
  accountDeletion: accountDeletionRouter,
  activityStreak: activityStreakRouter,
  ai: aiRouter,
  anbu: anbuRouter,
  avatar: avatarRouter,
  audio: audioRouter,
  badge: badgeRouter,
  title: titleRouter,
  bank: bankRouter,
  blackmarket: blackMarketRouter,
  bloodline: bloodlineRouter,
  combat: combatRouter,
  comments: commentsRouter,
  conceptart: conceptartRouter,
  contentReview: contentReviewRouter,
  clan: clanRouter,
  data: dataRouter,
  discord: discordRouter,
  coop: coopRouter,
  forum: forumRouter,
  gameAsset: gameAssetRouter,
  guide: guideRouter,
  home: homeRouter,
  hunting: huntingRouter,
  hospital: hospitalRouter,
  item: itemRouter,
  jutsu: jutsuRouter,
  kage: kageRouter,
  logs: logsRouter,
  mapAsset: mapAssetRouter,
  mapTerrain: mapTerrainRouter,
  misc: miscRouter,
  merch: merchRouter,
  generativeAi: generativeAiRouter,
  paypal: paypalRouter,
  stripe: stripeRouter,
  parentalControls: parentalControlsRouter,

  poll: pollRouter,
  profile: profileRouter,
  pets: petsRouter,
  petSpecies: petSpeciesRouter,
  push: pushRouter,
  nativeAuth: nativeAuthRouter,
  purchases: purchasesRouter,
  quests: questsRouter,
  rewardPackages: rewardPackagesRouter,
  register: registerRouter,
  reports: reportsRouter,
  sensei: senseiRouter,
  simulator: simulatorRouter,
  sparring: sparringRouter,
  travel: travelRouter,
  train: trainRouter,
  tournament: tournamentRouter,
  village: villageRouter,
  villageMission: villageMissionRouter,
  marriage: marriageRouter,
  staff: staffRouter,
  linkPromotion: linkPromotionRouter,
  war: warRouter,
  shrine: shrineRouter,
  pvpRank: pvpRankRouter,
  bounty: bountyRouter,
  skillTree: skillTreeRouter,
  bloodright: bloodrightRouter,
  occupation: occupationRouter,
  farming: farmingRouter,
  auction: auctionRouter,
  support: supportRouter,
  applications: applicationsRouter,
  towerDefense: towerDefenseRouter,
  stealth: stealthRouter,
  overworldAi: overworldAiRouter,
  raids: raidsRouter,
  worldMap: worldMapRouter,
  sageMode: sageModeRouter,
});

/**
 * The queries built with cdnCachedProcedure, keyed as the client's `op.path`. The shell
 * layout hands them to TrpcClientProvider, which sends them to /api/trpc/cdn.
 */
export const CDN_CACHED_QUERY_PATHS: readonly string[] = Object.entries(
  appRouter._def.procedures,
)
  .filter(([, procedure]) => {
    const def = (procedure as { _def?: { type?: string; meta?: ProcedureMeta } })._def;
    return def?.type === "query" && def.meta?.cdnCached === true;
  })
  .map(([path]) => path);

// export type definition of API
export type AppRouter = typeof appRouter;
