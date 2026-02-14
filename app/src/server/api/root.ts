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
import { dataRouter } from "./routers/data";
import { forumRouter } from "./routers/forum";
import { homeRouter } from "./routers/home";
import { hospitalRouter } from "./routers/hospital";
import { itemRouter } from "./routers/item";
import { jutsuRouter } from "./routers/jutsu";
import { kageRouter } from "./routers/kage";
import { linkPromotionRouter } from "./routers/linkpromotion";
import { logsRouter } from "./routers/logs";
import { marriageRouter } from "./routers/marriage";
import { miscRouter } from "./routers/misc";
import { occupationRouter } from "./routers/occupation";
import { generativeAiRouter } from "./routers/openai";
import { paypalRouter } from "./routers/paypal";
import { pollRouter } from "./routers/poll";
import { profileRouter } from "./routers/profile";
import { pvpRankRouter } from "./routers/pvprank";
import { questsRouter } from "./routers/quests";
import { raidsRouter } from "./routers/raids";
import { registerRouter } from "./routers/register";
import { reportsRouter } from "./routers/reports";
import { senseiRouter } from "./routers/sensei";
import { shrineRouter } from "./routers/shrine";
import { simulatorRouter } from "./routers/simulator";
import { skillTreeRouter } from "./routers/skillTree";
import { sparringRouter } from "./routers/sparring";
import { staffRouter } from "./routers/staff";
import { stealthRouter } from "./routers/stealth";
import { supportRouter } from "./routers/support";
import { tournamentRouter } from "./routers/tournament";
import { towerDefenseRouter } from "./routers/towerDefense";
import { trainRouter } from "./routers/train";
import { travelRouter } from "./routers/travel";
import { villageRouter } from "./routers/village";
import { warRouter } from "./routers/war";
import { createTRPCRouter } from "./trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here
 */
export const appRouter = createTRPCRouter({
  activityStreak: activityStreakRouter,
  ai: aiRouter,
  anbu: anbuRouter,
  avatar: avatarRouter,
  audio: audioRouter,
  badge: badgeRouter,
  bank: bankRouter,
  blackmarket: blackMarketRouter,
  bloodline: bloodlineRouter,
  combat: combatRouter,
  comments: commentsRouter,
  conceptart: conceptartRouter,
  clan: clanRouter,
  data: dataRouter,
  forum: forumRouter,
  gameAsset: gameAssetRouter,
  home: homeRouter,
  hospital: hospitalRouter,
  item: itemRouter,
  jutsu: jutsuRouter,
  kage: kageRouter,
  logs: logsRouter,
  misc: miscRouter,
  generativeAi: generativeAiRouter,
  paypal: paypalRouter,
  poll: pollRouter,
  profile: profileRouter,
  quests: questsRouter,
  register: registerRouter,
  reports: reportsRouter,
  sensei: senseiRouter,
  simulator: simulatorRouter,
  sparring: sparringRouter,
  travel: travelRouter,
  train: trainRouter,
  tournament: tournamentRouter,
  village: villageRouter,
  marriage: marriageRouter,
  staff: staffRouter,
  linkPromotion: linkPromotionRouter,
  war: warRouter,
  shrine: shrineRouter,
  pvpRank: pvpRankRouter,
  bounty: bountyRouter,
  skillTree: skillTreeRouter,
  occupation: occupationRouter,
  auction: auctionRouter,
  support: supportRouter,
  applications: applicationsRouter,
  towerDefense: towerDefenseRouter,
  stealth: stealthRouter,
  raids: raidsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
