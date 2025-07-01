import { createTRPCRouter } from "./trpc";
import { anbuRouter } from "./routers/anbu";
import { avatarRouter } from "./routers/avatar";
import { aiRouter } from "./routers/ai";
import { badgeRouter } from "./routers/badge";
import { bankRouter } from "./routers/bank";
import { blackMarketRouter } from "./routers/blackmarket";
import { bloodlineRouter } from "./routers/bloodline";
import { combatRouter } from "./routers/combat";
import { commentsRouter } from "./routers/comments";
import { conceptartRouter } from "./routers/conceptart";
import { clanRouter } from "./routers/clan";
import { dataRouter } from "./routers/data";
import { forumRouter } from "./routers/forum";
import { gameAssetRouter } from "./routers/asset";
import { homeRouter } from "./routers/home";
import { hospitalRouter } from "./routers/hospital";
import { itemRouter } from "./routers/item";
import { jutsuRouter } from "./routers/jutsu";
import { kageRouter } from "./routers/kage";
import { logsRouter } from "./routers/logs";
import { miscRouter } from "./routers/misc";
import { openaiRouter } from "./routers/openai";
import { paypalRouter } from "./routers/paypal";
import { pollRouter } from "./routers/poll";
import { profileRouter } from "./routers/profile";
import { questsRouter } from "./routers/quests";
import { registerRouter } from "./routers/register";
import { reportsRouter } from "./routers/reports";
import { senseiRouter } from "./routers/sensei";
import { simulatorRouter } from "./routers/simulator";
import { sparringRouter } from "./routers/sparring";
import { travelRouter } from "./routers/travel";
import { trainRouter } from "./routers/train";
import { tournamentRouter } from "./routers/tournament";
import { villageRouter } from "./routers/village";
import { marriageRouter } from "./routers/marriage";
import { staffRouter } from "./routers/staff";
import { backgroundSchemaRouter } from "./routers/backgroundSchema";
import { linkPromotionRouter } from "./routers/linkpromotion";
import { warRouter } from "./routers/war";
import { pvpRankRouter } from "./routers/pvprank";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here
 */
export const appRouter = createTRPCRouter({
  ai: aiRouter,
  anbu: anbuRouter,
  avatar: avatarRouter,
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
  openai: openaiRouter,
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
  backgroundSchema: backgroundSchemaRouter,
  staff: staffRouter,
  linkPromotion: linkPromotionRouter,
  war: warRouter,
  pvpRank: pvpRankRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
