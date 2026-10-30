/**
 * Database access for staff; authorization and transaction scopes stay in callers.
 */
import type { Client as PlanetScaleClient } from "@planetscale/database";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  aiProfile,
  anbuSquad,
  auctionOffer,
  automatedModeration,
  bankTransfers,
  bloodlineRolls,
  captcha,
  conceptImage,
  contentBackup,
  conversation,
  conversationComment,
  damageSimulation,
  discordLink,
  discordLinkHistory,
  farmCollectionLog,
  farmExtraction,
  farmPlot,
  forumPost,
  forumThread,
  historicalAvatar,
  historicalIp,
  huntingSession,
  itemLoadout,
  jutsuLoadout,
  kageDefendedChallenges,
  linkPromotion,
  moderationScan,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  parentalControl,
  paypalSubscription,
  paypalTransaction,
  poll,
  pollOption,
  questHistory,
  raidParticipation,
  rankedUserRewards,
  recruitReferral,
  reportLog,
  ryoTrade,
  staffApplication,
  storePurchase,
  storeUserIdAlias,
  stripeCheckout,
  stripePayment,
  supportReview,
  title,
  trainingLog,
  user2conversation,
  userActivityEvent,
  userAttribute,
  userBadge,
  userBlackList,
  userCookingJob,
  userData,
  userDevice,
  userHome,
  userItem,
  userJutsu,
  userLikes,
  userLiveActivity,
  userNindo,
  userPet,
  userPollVote,
  userPushPreference,
  userQuestAttempt,
  userQueue,
  userRaidBuff,
  userReport,
  userReportComment,
  userRequest,
  userReview,
  userRewards,
  userTitle,
  userUpload,
  userVote,
  village,
  warKill,
  webStoreOrder,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { DELETED_STORE_USER_PREFIX } from "@/server/utils/purchases/grant";

/** Build the `contentBackup` listing for `getBackups`. */
export const listContentBackupForGetBackups = (client: Pick<DrizzleClient, "query">) =>
  client.query.contentBackup.findMany({
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: 200,
  });

/** Execute the database statement for `createBackup`. */
export const executeSelectSqlForCreateBackup = (
  client: Pick<DrizzleClient, "execute">,
  input: { type: "item" | "jutsu" | "bloodline" | "ai" },
  tableName: string,
) =>
  client.execute(
    input.type === "ai"
      ? sql`SELECT * FROM ${sql.raw(tableName)} WHERE isAi = true`
      : sql`SELECT * FROM ${sql.raw(tableName)}`,
  );

/** Build the `contentBackup` insert for `createBackup`. */
export const insertContentBackupForCreateBackup = (
  client: Pick<DrizzleClient, "insert">,
  input: { type: "item" | "jutsu" | "bloodline" | "ai" },
  tableName: string,
) =>
  client.insert(contentBackup).values({
    id: nanoid(),
    type: input.type,
    sqlText: `/* Empty backup for ${tableName} at ${new Date().toISOString()} */`,
  });

/** Build the `contentBackup` insert for `createBackup`. */
export const insertContentBackupForCreateBackup2 = (
  client: Pick<DrizzleClient, "insert">,
  input: { type: "item" | "jutsu" | "bloodline" | "ai" },
  insertSql: string,
) =>
  client.insert(contentBackup).values({
    id: nanoid(),
    type: input.type,
    sqlText: insertSql,
  });

/** Build the `contentBackup` lookup for `pushBackupToDev`, using predicates on `id`. */
export const findContentBackupForPushBackupToDev = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.contentBackup.findFirst({
    where: eq(contentBackup.id, input.id),
  });

/**
 * Build the `userJutsu` update for `unequipAllJutsus`, setting `equipped`, using
 * predicates on `equipped`, `userId`, `isAi`.
 */
export const updateUserJutsuForUnequipAllJutsus = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(
      and(
        ne(userJutsu.equipped, false),
        sql`${userJutsu.userId} NOT IN (
                SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
              )`,
      ),
    );

/** Build the `jutsuLoadout` update for `unequipAllJutsus`, setting `jutsuIds`, using predicates on `userId` and `isAi`. */
export const updateJutsuLoadoutForUnequipAllJutsus = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(jutsuLoadout)
    .set({ jutsuIds: [] })
    .where(
      sql`${jutsuLoadout.userId} NOT IN (
              SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
            )`,
    );

/**
 * Build the `userItem` update for `unequipAllGear`, setting `equipped`, including
 * predicates on `equipped`, `quantity`, `userId`.
 */
export const updateUserItemForUnequipAllGear = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(userItem)
    .set({ equipped: "NONE" })
    .where(
      and(
        ne(userItem.equipped, "NONE"),
        // Skip rows held by a stack-merge claim (negative quantity) so this bulk write
        // cannot change a claimed row's equipped slot mid-merge-publish.
        gt(userItem.quantity, 0),
        sql`${userItem.userId} NOT IN (
                SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
              )`,
      ),
    );

/** Build the `itemLoadout` update for `unequipAllGear`, setting `itemData`, using predicates on `userId` and `isAi`. */
export const updateItemLoadoutForUnequipAllGear = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(itemLoadout)
    .set({ itemData: [] })
    .where(
      sql`${itemLoadout.userId} NOT IN (
              SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
            )`,
    );

/** Build the `mpvpBattleUser` lookup for `forceAwake`, using predicates on `userId`. */
export const findMpvpBattleUserForForceAwake = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.mpvpBattleUser.findFirst({
    where: eq(mpvpBattleUser.userId, input.userId),
  });

/**
 * Recover the captured account/battle/session snapshot with one guarded UPDATE; reuse
 * the caller-captured endedAt across retries.
 */
export const executeRecoverySqlForForceAwake = (
  client: Pick<DrizzleClient, "execute">,
  targetUser: { userId: string; battleId: string | null },
  hunt:
    | Pick<typeof huntingSession.$inferSelect, "id" | "battleId" | "version">
    | undefined,
  endedAt: Date,
) =>
  client.execute(sql`
          UPDATE ${userData}
          LEFT JOIN ${questHistory} ON ${and(
            eq(questHistory.userId, userData.userId),
            eq(questHistory.questType, "battlepyramid"),
            eq(questHistory.completed, 0),
            isNull(questHistory.endAt),
          )}
          LEFT JOIN ${huntingSession} ON ${huntingSession.userId} = ${userData.userId}
          SET ${userData.status} = 'AWAKE', ${userData.travelFinishAt} = NULL,
              ${huntingSession.battleId} = NULL, ${huntingSession.version} = COALESCE(${huntingSession.version}, 0) + 1,
              ${userData.bracketImmunityLiftedUntil} = ${resumeBracketImmunitySql()}, ${userData.bracketImmunityPausedAt} = NULL, ${userData.battleId} = NULL, ${questHistory.completed} = 0,
              ${questHistory.endAt} = ${endedAt},
              ${userData.updatedAt} = GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))
          WHERE ${userData.userId} = ${targetUser.userId}
            AND ${userData.battleId} <=> ${targetUser.battleId}
            AND ${huntingSession.id} <=> ${hunt?.id ?? null}
            AND ${huntingSession.battleId} <=> ${hunt?.battleId ?? null}
            AND ${huntingSession.version} <=> ${hunt?.version ?? null}
        `);

/** Build the `actionLog` insert for `forceAwake`. */
export const insertActionLogForForceAwake = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string; reason: string },
  targetUser: {
    status: import("@/drizzle/schema").UserStatus;
    battleId: null | string;
  },
  queueEntry:
    | undefined
    | (Pick<
        import("@/drizzle/schema").WarMercenary,
        "id" | "createdAt" | "userId" | "slot"
      > & { clanBattleId: string; side: "ATTACKER" | "DEFENDER" }),
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    relatedId: input.userId,
    relatedMsg: `Force updated status to awake from status: ${targetUser.status}`,
    changes: [
      `Previous BattleId: ${targetUser.battleId}`,
      `Reason: ${input.reason}`,
      `Cleared queue entries: mpvpBattleUser=${queueEntry ? "yes" : "no"}`,
    ],
  });

/** Build the `mpvpBattleQueue` lookup for `forceAwake`, using predicates on `id`. */
export const findMpvpBattleQueueForForceAwake = (
  client: Pick<DrizzleClient, "query">,
  queueEntry: { clanBattleId: string },
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: eq(mpvpBattleQueue.id, queueEntry.clanBattleId),
  });

/** Build the `userBadge` insert for `insertUserBadge`. */
export const insertUserBadgeForInsertUserBadge = (
  client: Pick<DrizzleClient, "insert">,
  input: { userId: string; badgeId: string },
) =>
  client.insert(userBadge).values([{ userId: input.userId, badgeId: input.badgeId }]);

/** Build the `actionLog` insert for `insertUserBadge`. */
export const insertActionLogForInsertUserBadge = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  badge: { name: string },
  input: { userId: string },
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Insert badge: ${badge.name}`],
    relatedId: input.userId,
    relatedMsg: `Insert badge: ${badge.name}`,
    relatedImage: user.avatarLight,
  });

/** Build the `userBadge` lookup for `removeUserBadge`, using predicates on `userId` and `badgeId`. */
export const findUserBadgeForRemoveUserBadge = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string; badgeId: string },
) =>
  client.query.userBadge.findFirst({
    where: and(
      eq(userBadge.userId, input.userId),
      eq(userBadge.badgeId, input.badgeId),
    ),
  });

/** Build the `userBadge` deletion for `removeUserBadge`, using predicates on `userId` and `badgeId`. */
export const deleteUserBadgeForRemoveUserBadge = (
  client: Pick<DrizzleClient, "delete">,
  input: { userId: string; badgeId: string },
) =>
  client
    .delete(userBadge)
    .where(
      and(eq(userBadge.userId, input.userId), eq(userBadge.badgeId, input.badgeId)),
    );

/** Build the `actionLog` insert for `removeUserBadge`. */
export const insertActionLogForRemoveUserBadge = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  badge: { name: string },
  input: { userId: string },
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Remove badge: ${badge.name}`],
    relatedId: input.userId,
    relatedMsg: `Remove badge: ${badge.name}`,
    relatedImage: user.avatarLight,
  });

/** Build the `questHistory` listing for `cloneUserForDebug`, using predicates on `userId`. */
export const listQuestHistoryForCloneUserForDebug = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.questHistory.findMany({
    where: eq(questHistory.userId, input.userId),
  });

/** Build the `rankedUserRewards` listing for `cloneUserForDebug`, using predicates on `userId`. */
export const listRankedUserRewardsForCloneUserForDebug = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.rankedUserRewards.findMany({
    where: eq(rankedUserRewards.userId, input.userId),
  });

/** Build the `anbuSquad` update for `cloneUserForDebug`, setting `memberCount`, using predicates on `id`. */
export const updateAnbuSquadForCloneUserForDebug = (
  client: Pick<DrizzleClient, "update">,
  user: { anbuId: string },
) =>
  client
    .update(anbuSquad)
    .set({
      memberCount: sql`GREATEST(${anbuSquad.memberCount} - 1, 0)`,
    })
    .where(eq(anbuSquad.id, user.anbuId));

/** Build the `userData` update for `cloneUserForDebug`, using predicates on `userId`. */
export const updateUserDataForCloneUserForDebug = (
  client: Pick<DrizzleClient, "update">,
  target: {
    curHealth: number;
    maxHealth: number;
    curStamina: number;
    maxStamina: number;
    curChakra: number;
    maxChakra: number;
    money: number;
    bank: number;
    seichiSilver: number;
    bloodright: { skillId: string; cost: number }[];
    bloodrightSpent: number;
    experience: number;
    earnedExperience: number;
    rank: import("@/drizzle/schema").UserRank;
    level: number;
    status: import("@/drizzle/schema").UserStatus;
    villageId: null | string;
    bloodlineId: null | string;
    strength: number;
    speed: number;
    intelligence: number;
    willpower: number;
    gender: string;
    offence: number;
    defence: number;
    ninjutsuMastery: number;
    genjutsuMastery: number;
    taijutsuMastery: number;
    bukijutsuMastery: number;
    bloodlineMastery: number;
    sageMastery: number;
    questData: null | import("@/validators/objectives").QuestTrackerType[];
    isOutlaw: false | true;
    sector: number;
    latitude: number;
    longitude: number;
    location: null | string;
    tutorialStep: number;
    tutorialOn: false | true;
    battleId: null | string;
    clanId: null | string;
    anbuId: null | string;
  },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      curHealth: target.curHealth,
      maxHealth: target.maxHealth,
      curStamina: target.curStamina,
      maxStamina: target.maxStamina,
      curChakra: target.curChakra,
      maxChakra: target.maxChakra,
      money: target.money,
      bank: target.bank,
      // Clone the balance and saved purchase prices together, replacing the staff path.
      seichiSilver: target.seichiSilver,
      bloodright: target.bloodright,
      bloodrightSpent: target.bloodrightSpent,
      experience: target.experience,
      earnedExperience: target.earnedExperience,
      rank: target.rank,
      level: target.level,
      status: target.status,
      villageId: target.villageId,
      bloodlineId: target.bloodlineId,
      strength: target.strength,
      speed: target.speed,
      intelligence: target.intelligence,
      willpower: target.willpower,
      gender: target.gender,
      offence: target.offence,
      defence: target.defence,
      ninjutsuMastery: target.ninjutsuMastery,
      genjutsuMastery: target.genjutsuMastery,
      taijutsuMastery: target.taijutsuMastery,
      bukijutsuMastery: target.bukijutsuMastery,
      bloodlineMastery: target.bloodlineMastery,
      sageMastery: target.sageMastery,
      questData: target.questData,
      isOutlaw: target.isOutlaw,
      sector: target.sector,
      latitude: target.latitude,
      longitude: target.longitude,
      location: target.location,
      tutorialStep: target.tutorialStep,
      tutorialOn: target.tutorialOn,
      battleId: target.battleId,
      clanId: target.clanId,
      anbuId: target.anbuId,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `userJutsu` insert for `cloneUserForDebug`. */
export const insertUserJutsuForCloneUserForDebug = (
  client: Pick<DrizzleClient, "insert">,
  targetJutsus: import("@/drizzle/schema").UserJutsu[],
  ctx: { userId: string },
) =>
  client.insert(userJutsu).values(
    targetJutsus.map((userjutsu) => ({
      ...userjutsu,
      userId: ctx.userId,
      id: nanoid(),
    })),
  );

/** Build the `userItem` insert for `cloneUserForDebug`. */
export const insertUserItemForCloneUserForDebug = (
  client: Pick<DrizzleClient, "insert">,
  targetItems: import("@/drizzle/schema").UserItem[],
  ctx: { userId: string },
) =>
  client.insert(userItem).values(
    targetItems.map((useritem) => ({
      ...useritem,
      userId: ctx.userId,
      id: nanoid(),
    })),
  );

/** Build the `questHistory` insert for `cloneUserForDebug`. */
export const insertQuestHistoryForCloneUserForDebug = (
  client: Pick<DrizzleClient, "insert">,
  targetQuestHistory: (typeof questHistory.$inferSelect)[],
  ctx: { userId: string },
) =>
  client.insert(questHistory).values(
    targetQuestHistory.map((questhistory) => ({
      ...questhistory,
      userId: ctx.userId,
      id: nanoid(),
    })),
  );

/** Build the `rankedUserRewards` insert for `cloneUserForDebug`. */
export const insertRankedUserRewardsForCloneUserForDebug = (
  client: Pick<DrizzleClient, "insert">,
  targetRankedUserRewards: import("@/drizzle/schema").RankedUserRewards[],
  ctx: { userId: string },
) =>
  client.insert(rankedUserRewards).values(
    targetRankedUserRewards.map((rankedUserReward) => ({
      ...rankedUserReward,
      userId: ctx.userId,
      id: nanoid(),
    })),
  );

/** Build the `userAttribute` insert for `cloneUserForDebug`. */
export const insertUserAttributeForCloneUserForDebug = (
  client: Pick<DrizzleClient, "insert">,
  targetAttributes: { id: string; userId: string; attribute: string }[],
  ctx: { userId: string },
) =>
  client.insert(userAttribute).values(
    targetAttributes.map((attribute) => ({
      ...attribute,
      userId: ctx.userId,
      id: nanoid(),
    })),
  );

/** Build the `historicalIp` listing for `getUserHistoricalIps`, using predicates on `userId`. */
export const listHistoricalIpForGetUserHistoricalIps = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.historicalIp.findMany({
    where: eq(historicalIp.userId, input.userId),
    orderBy: [desc(historicalIp.usedAt)],
    limit: 100, // Limit to last 100 IP records
  });

/** Build the `userActivityEvent` listing for `getUserActivityEvents`, using predicates on `userId`. */
export const listUserActivityEventForGetUserActivityEvents = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userActivityEvent.findMany({
    where: eq(userActivityEvent.userId, input.userId),
    orderBy: [desc(userActivityEvent.createdAt)],
    limit: 100, // Limit to last 100 activity events
  });

/** Build the `userData` update for `updateUserId`, setting `userId`, using predicates on `userId`, `status`, `battleId`. */
export const updateUserDataForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userData)
    .set({ userId: input.newUserId })
    .where(
      and(
        eq(userData.userId, input.userId),
        ne(userData.status, "BATTLE"),
        isNull(userData.battleId),
      ),
    );

/** Build the `userTitle` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserTitleForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userTitle)
    .set({ userId: input.newUserId })
    .where(eq(userTitle.userId, input.userId));

/** Build the `title` update for `updateUserId`, setting `legacyOwnerId`, using predicates on `legacyOwnerId`. */
export const updateTitleForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(title)
    .set({ legacyOwnerId: input.newUserId })
    .where(eq(title.legacyOwnerId, input.userId));

/** Build the `auctionOffer` update for `updateUserId`, setting `ownerId`, using predicates on `ownerId`. */
export const updateAuctionOfferForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(auctionOffer)
    .set({ ownerId: input.newUserId })
    .where(eq(auctionOffer.ownerId, input.userId));

/** Build the `auctionOffer` update for `updateUserId`, setting `accepterId`, using predicates on `accepterId`. */
export const updateAuctionOfferForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(auctionOffer)
    .set({ accepterId: input.newUserId })
    .where(eq(auctionOffer.accepterId, input.userId));

/** Build the `aiProfile` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateAiProfileForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(aiProfile)
    .set({ userId: input.newUserId })
    .where(eq(aiProfile.userId, input.userId));

/** Build the `discordLink` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateDiscordLinkForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(discordLink)
    .set({ userId: input.newUserId })
    .where(eq(discordLink.userId, input.userId));

/** Build the `discordLinkHistory` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateDiscordLinkHistoryForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(discordLinkHistory)
    .set({ userId: input.newUserId })
    .where(eq(discordLinkHistory.userId, input.userId));

/** Build the `userBlackList` update for `updateUserId`, setting `creatorUserId`, using predicates on `creatorUserId`. */
export const updateUserBlackListForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userBlackList)
    .set({ creatorUserId: input.newUserId })
    .where(eq(userBlackList.creatorUserId, input.userId));

/** Build the `userBlackList` update for `updateUserId`, setting `targetUserId`, using predicates on `targetUserId`. */
export const updateUserBlackListForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userBlackList)
    .set({ targetUserId: input.newUserId })
    .where(eq(userBlackList.targetUserId, input.userId));

/** Build the `bloodlineRolls` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateBloodlineRollsForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(bloodlineRolls)
    .set({ userId: input.newUserId })
    .where(eq(bloodlineRolls.userId, input.userId));

/** Build the `captcha` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateCaptchaForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(captcha)
    .set({ userId: input.newUserId })
    .where(eq(captcha.userId, input.userId));

/** Build the `mpvpBattleUser` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateMpvpBattleUserForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(mpvpBattleUser)
    .set({ userId: input.newUserId })
    .where(eq(mpvpBattleUser.userId, input.userId));

/** Build the `conversation` update for `updateUserId`, setting `createdById`, using predicates on `createdById`. */
export const updateConversationForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(conversation)
    .set({ createdById: input.newUserId })
    .where(eq(conversation.createdById, input.userId));

/** Build the `user2conversation` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUser2conversationForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(user2conversation)
    .set({ userId: input.newUserId })
    .where(eq(user2conversation.userId, input.userId));

/** Build the `conversationComment` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateConversationCommentForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(conversationComment)
    .set({ userId: input.newUserId })
    .where(eq(conversationComment.userId, input.userId));

/** Build the `damageSimulation` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateDamageSimulationForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(damageSimulation)
    .set({ userId: input.newUserId })
    .where(eq(damageSimulation.userId, input.userId));

/** Build the `forumPost` update for `umPostForUpdateUserId`, setting `userId`, using predicates on `userId`. */
export const updateForumPostForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(forumPost)
    .set({ userId: input.newUserId })
    .where(eq(forumPost.userId, input.userId));

/** Build the `forumThread` update for `umThreadForUpdateUserId`, setting `userId`, using predicates on `userId`. */
export const updateForumThreadForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(forumThread)
    .set({ userId: input.newUserId })
    .where(eq(forumThread.userId, input.userId));

/** Build the `historicalAvatar` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateHistoricalAvatarForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(historicalAvatar)
    .set({ userId: input.newUserId })
    .where(eq(historicalAvatar.userId, input.userId));

/** Build the `historicalIp` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateHistoricalIpForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(historicalIp)
    .set({ userId: input.newUserId })
    .where(eq(historicalIp.userId, input.userId));

/** Build the `userActivityEvent` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserActivityEventForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userActivityEvent)
    .set({ userId: input.newUserId })
    .where(eq(userActivityEvent.userId, input.userId));

/** Build the `jutsuLoadout` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateJutsuLoadoutForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(jutsuLoadout)
    .set({ userId: input.newUserId })
    .where(eq(jutsuLoadout.userId, input.userId));

/** Build the `notification` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateNotificationForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(notification)
    .set({ userId: input.newUserId })
    .where(eq(notification.userId, input.userId));

/** Build the `stripeCheckout` update for `updateUserId`, setting `createdById`, using predicates on `createdById`. */
export const updateStripeCheckoutForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(stripeCheckout)
    .set({ createdById: input.newUserId })
    .where(eq(stripeCheckout.createdById, input.userId));

/** Build the `stripeCheckout` update for `updateUserId`, setting `affectedUserId`, using predicates on `affectedUserId`. */
export const updateStripeCheckoutForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(stripeCheckout)
    .set({ affectedUserId: input.newUserId })
    .where(eq(stripeCheckout.affectedUserId, input.userId));

/** Build the `stripePayment` update for `updateUserId`, setting `createdById`, using predicates on `createdById`. */
export const updateStripePaymentForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(stripePayment)
    .set({ createdById: input.newUserId })
    .where(eq(stripePayment.createdById, input.userId));

/** Build the `stripePayment` update for `updateUserId`, setting `affectedUserId`, using predicates on `affectedUserId`. */
export const updateStripePaymentForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(stripePayment)
    .set({ affectedUserId: input.newUserId })
    .where(eq(stripePayment.affectedUserId, input.userId));

/** Build the `paypalSubscription` update for `updateUserId`, setting `createdById`, using predicates on `createdById`. */
export const updatePaypalSubscriptionForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(paypalSubscription)
    .set({ createdById: input.newUserId })
    .where(eq(paypalSubscription.createdById, input.userId));

/**
 * Build the `paypalSubscription` update for `updateUserId`, setting `affectedUserId`,
 * using predicates on `affectedUserId`.
 */
export const updatePaypalSubscriptionForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(paypalSubscription)
    .set({ affectedUserId: input.newUserId })
    .where(eq(paypalSubscription.affectedUserId, input.userId));

/** Build the `webStoreOrder` update for `updateUserId`, setting `buyerId`, using predicates on `buyerId`. */
export const updateWebStoreOrderForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(webStoreOrder)
    .set({ buyerId: input.newUserId })
    .where(eq(webStoreOrder.buyerId, input.userId));

/** Build the `webStoreOrder` update for `updateUserId`, setting `recipientId`, using predicates on `recipientId`. */
export const updateWebStoreOrderForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(webStoreOrder)
    .set({ recipientId: input.newUserId })
    .where(eq(webStoreOrder.recipientId, input.userId));

/**
 * Build the `paypalTransaction` update for `updateUserId`, setting `affectedUserId`,
 * using predicates on `affectedUserId`.
 */
export const updatePaypalTransactionForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(paypalTransaction)
    .set({ affectedUserId: input.newUserId })
    .where(eq(paypalTransaction.affectedUserId, input.userId));

/** Build the `paypalTransaction` update for `updateUserId`, setting `createdById`, using predicates on `createdById`. */
export const updatePaypalTransactionForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(paypalTransaction)
    .set({ createdById: input.newUserId })
    .where(eq(paypalTransaction.createdById, input.userId));

/** Build the `ryoTrade` update for `updateUserId`, setting `creatorUserId`, using predicates on `creatorUserId`. */
export const updateRyoTradeForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(ryoTrade)
    .set({ creatorUserId: input.newUserId })
    .where(eq(ryoTrade.creatorUserId, input.userId));

/** Build the `ryoTrade` update for `updateUserId`, setting `purchaserUserId`, using predicates on `purchaserUserId`. */
export const updateRyoTradeForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(ryoTrade)
    .set({ purchaserUserId: input.newUserId })
    .where(eq(ryoTrade.purchaserUserId, input.userId));

/**
 * Build the `ryoTrade` update for `updateUserId`, setting `allowedPurchaserId`, using
 * predicates on `allowedPurchaserId`.
 */
export const updateRyoTradeForUpdateUserId3 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(ryoTrade)
    .set({ allowedPurchaserId: input.newUserId })
    .where(eq(ryoTrade.allowedPurchaserId, input.userId));

/** Build the `reportLog` update for `updateUserId`, setting `targetUserId`, using predicates on `targetUserId`. */
export const updateReportLogForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(reportLog)
    .set({ targetUserId: input.newUserId })
    .where(eq(reportLog.targetUserId, input.userId));

/** Build the `reportLog` update for `updateUserId`, setting `staffUserId`, using predicates on `staffUserId`. */
export const updateReportLogForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(reportLog)
    .set({ staffUserId: input.newUserId })
    .where(eq(reportLog.staffUserId, input.userId));

/** Build the `actionLog` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateActionLogForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(actionLog)
    .set({ userId: input.newUserId })
    .where(eq(actionLog.userId, input.userId));

/** Build the `trainingLog` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateTrainingLogForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(trainingLog)
    .set({ userId: input.newUserId })
    .where(eq(trainingLog.userId, input.userId));

/** Build the `userAttribute` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserAttributeForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userAttribute)
    .set({ userId: input.newUserId })
    .where(eq(userAttribute.userId, input.userId));

/** Build the `userReview` update for `updateUserId`, setting `authorUserId`, using predicates on `authorUserId`. */
export const updateUserReviewForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userReview)
    .set({ authorUserId: input.newUserId })
    .where(eq(userReview.authorUserId, input.userId));

/** Build the `userRewards` update for `updateUserId`, setting `awardedById`, using predicates on `awardedById`. */
export const updateUserRewardsForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userRewards)
    .set({ awardedById: input.newUserId })
    .where(eq(userRewards.awardedById, input.userId));

/** Build the `userRewards` update for `updateUserId`, setting `receiverId`, using predicates on `receiverId`. */
export const updateUserRewardsForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userRewards)
    .set({ receiverId: input.newUserId })
    .where(eq(userRewards.receiverId, input.userId));

/** Build the `userReview` update for `updateUserId`, setting `targetUserId`, using predicates on `targetUserId`. */
export const updateUserReviewForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userReview)
    .set({ targetUserId: input.newUserId })
    .where(eq(userReview.targetUserId, input.userId));

/** Build the `userNindo` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserNindoForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userNindo)
    .set({ userId: input.newUserId })
    .where(eq(userNindo.userId, input.userId));

/** Build the `userItem` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserItemForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userItem)
    .set({ userId: input.newUserId })
    .where(eq(userItem.userId, input.userId));

/** Build the `userHome` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserHomeForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userHome)
    .set({ userId: input.newUserId })
    .where(eq(userHome.userId, input.userId));

/** Build the `table` update for `updateUserId`, setting `userId`, using the configured predicates. */
export const updateTableForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  table: import("drizzle-orm/mysql-core").MySqlTable & {
    userId: import("drizzle-orm/mysql-core").AnyMySqlColumn;
  },
  input: { newUserId: string; userId: string },
) =>
  client
    .update(table)
    .set({ userId: input.newUserId })
    .where(eq(table.userId, input.userId));

/** Build the `userJutsu` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserJutsuForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userJutsu)
    .set({ userId: input.newUserId })
    .where(eq(userJutsu.userId, input.userId));

/** Build the `userReport` update for `updateUserId`, setting `reporterUserId`, using predicates on `reporterUserId`. */
export const updateUserReportForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userReport)
    .set({ reporterUserId: input.newUserId })
    .where(eq(userReport.reporterUserId, input.userId));

/** Build the `userReport` update for `updateUserId`, setting `reportedUserId`, using predicates on `reportedUserId`. */
export const updateUserReportForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userReport)
    .set({ reportedUserId: input.newUserId })
    .where(eq(userReport.reportedUserId, input.userId));

/** Build the `userReportComment` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserReportCommentForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userReportComment)
    .set({ userId: input.newUserId })
    .where(eq(userReportComment.userId, input.userId));

/** Build the `bankTransfers` update for `updateUserId`, setting `senderId`, using predicates on `senderId`. */
export const updateBankTransfersForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(bankTransfers)
    .set({ senderId: input.newUserId })
    .where(eq(bankTransfers.senderId, input.userId));

/** Build the `bankTransfers` update for `updateUserId`, setting `receiverId`, using predicates on `receiverId`. */
export const updateBankTransfersForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(bankTransfers)
    .set({ receiverId: input.newUserId })
    .where(eq(bankTransfers.receiverId, input.userId));

/** Build the `moderationScan` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateModerationScanForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(moderationScan)
    .set({ userId: input.newUserId })
    .where(eq(moderationScan.userId, input.userId));

/** Build the `automatedModeration` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateAutomatedModerationForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(automatedModeration)
    .set({ userId: input.newUserId })
    .where(eq(automatedModeration.userId, input.userId));

/** Build the `supportReview` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateSupportReviewForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(supportReview)
    .set({ userId: input.newUserId })
    .where(eq(supportReview.userId, input.userId));

/** Build the `kageDefendedChallenges` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateKageDefendedChallengesForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ userId: input.newUserId })
    .where(eq(kageDefendedChallenges.userId, input.userId));

/** Build the `kageDefendedChallenges` update for `updateUserId`, setting `kageId`, using predicates on `kageId`. */
export const updateKageDefendedChallengesForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ kageId: input.newUserId })
    .where(eq(kageDefendedChallenges.kageId, input.userId));

/** Build the `questHistory` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateQuestHistoryForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(questHistory)
    .set({ userId: input.newUserId })
    .where(eq(questHistory.userId, input.userId));

/** Build the `userLikes` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserLikesForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userLikes)
    .set({ userId: input.newUserId })
    .where(eq(userLikes.userId, input.userId));

/** Build the `conceptImage` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateConceptImageForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(conceptImage)
    .set({ userId: input.newUserId })
    .where(eq(conceptImage.userId, input.userId));

/** Build the `userBadge` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserBadgeForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userBadge)
    .set({ userId: input.newUserId })
    .where(eq(userBadge.userId, input.userId));

/** Build the `userRequest` update for `updateUserId`, setting `senderId`, using predicates on `senderId`. */
export const updateUserRequestForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userRequest)
    .set({ senderId: input.newUserId })
    .where(eq(userRequest.senderId, input.userId));

/** Build the `userRequest` update for `updateUserId`, setting `receiverId`, using predicates on `receiverId`. */
export const updateUserRequestForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userRequest)
    .set({ receiverId: input.newUserId })
    .where(eq(userRequest.receiverId, input.userId));

/** Build the `linkPromotion` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateLinkPromotionForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(linkPromotion)
    .set({ userId: input.newUserId })
    .where(eq(linkPromotion.userId, input.userId));

/** Build the `linkPromotion` update for `updateUserId`, setting `reviewedBy`, using predicates on `reviewedBy`. */
export const updateLinkPromotionForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(linkPromotion)
    .set({ reviewedBy: input.newUserId })
    .where(eq(linkPromotion.reviewedBy, input.userId));

/** Build the `userVote` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserVoteForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userVote)
    .set({ userId: input.newUserId })
    .where(eq(userVote.userId, input.userId));

/** Build the `poll` update for `updateUserId`, setting `createdByUserId`, using predicates on `createdByUserId`. */
export const updatePollForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(poll)
    .set({ createdByUserId: input.newUserId })
    .where(eq(poll.createdByUserId, input.userId));

/** Build the `pollOption` update for `updateUserId`, setting `targetUserId`, using predicates on `targetUserId`. */
export const updatePollOptionForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(pollOption)
    .set({ targetUserId: input.newUserId })
    .where(eq(pollOption.targetUserId, input.userId));

/** Build the `pollOption` update for `updateUserId`, setting `createdByUserId`, using predicates on `createdByUserId`. */
export const updatePollOptionForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(pollOption)
    .set({ createdByUserId: input.newUserId })
    .where(eq(pollOption.createdByUserId, input.userId));

/** Build the `village` update for `updateUserId`, setting `kageId`, using predicates on `kageId`. */
export const updateVillageForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(village)
    .set({ kageId: input.newUserId })
    .where(eq(village.kageId, input.userId));

/** Build the `userPollVote` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserPollVoteForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userPollVote)
    .set({ userId: input.newUserId })
    .where(eq(userPollVote.userId, input.userId));

/** Build the `userUpload` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserUploadForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userUpload)
    .set({ userId: input.newUserId })
    .where(eq(userUpload.userId, input.userId));

/** Build the `userPet` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserPetForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userPet)
    .set({ userId: input.newUserId })
    .where(eq(userPet.userId, input.userId));

/** Build the `parentalControl` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateParentalControlForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(parentalControl)
    .set({ userId: input.newUserId })
    .where(eq(parentalControl.userId, input.userId));

/** Build the `userDevice` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserDeviceForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userDevice)
    .set({ userId: input.newUserId })
    .where(eq(userDevice.userId, input.userId));

/** Build the `userPushPreference` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserPushPreferenceForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userPushPreference)
    .set({ userId: input.newUserId })
    .where(eq(userPushPreference.userId, input.userId));

/** Build the `userLiveActivity` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserLiveActivityForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userLiveActivity)
    .set({ userId: input.newUserId })
    .where(eq(userLiveActivity.userId, input.userId));

/**
 * Build the `storeUserIdAlias` update for `updateUserId`, setting `newUserId` and
 * `updatedAt`, using predicates on `newUserId`.
 */
export const updateStoreUserIdAliasForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(storeUserIdAlias)
    .set({ newUserId: input.newUserId, updatedAt: new Date() })
    .where(eq(storeUserIdAlias.newUserId, input.userId));

/** Build the `storePurchase` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateStorePurchaseForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(storePurchase)
    .set({ userId: input.newUserId })
    .where(eq(storePurchase.userId, input.userId));

/** Build the `storePurchase` update for `updateUserId`, setting `originalUserId`, using predicates on `originalUserId`. */
export const updateStorePurchaseForUpdateUserId2 = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(storePurchase)
    .set({ originalUserId: input.newUserId })
    .where(eq(storePurchase.originalUserId, input.userId));

/** Build the `userQueue` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserQueueForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userQueue)
    .set({ userId: input.newUserId })
    .where(eq(userQueue.userId, input.userId));

/** Build the `userCookingJob` update for `updateUserId`, setting `userId`, using predicates on `userId`. */
export const updateUserCookingJobForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userCookingJob)
    .set({ userId: input.newUserId })
    .where(eq(userCookingJob.userId, input.userId));

/** Build the `userRaidBuff` update for `updateUserId`, setting `userId` and `id`, using predicates on `userId`. */
export const updateUserRaidBuffForUpdateUserId = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) =>
  client
    .update(userRaidBuff)
    .set({
      userId: input.newUserId,
      id: sql`CASE WHEN ${userRaidBuff.itemId} IS NOT NULL THEN ${`meal-${input.newUserId}`} ELSE ${userRaidBuff.id} END`,
    })
    .where(eq(userRaidBuff.userId, input.userId));

/** Build the `userData` update for `deleteReferral`, setting `recruiterId`, using predicates on `userId`. */
export const updateUserDataForDeleteReferral = (
  client: Pick<DrizzleClient, "update">,
  input: { userId: string },
) =>
  client
    .update(userData)
    .set({ recruiterId: null })
    .where(eq(userData.userId, input.userId));

/** Build the `userData` update for `deleteReferral`, setting `nRecruited`, using predicates on `userId`. */
export const updateUserDataForDeleteReferral2 = (
  client: Pick<DrizzleClient, "update">,
  target: { recruiterId: string },
) =>
  client
    .update(userData)
    .set({ nRecruited: sql`${userData.nRecruited} - 1` })
    .where(eq(userData.userId, target.recruiterId));

/** Build the `actionLog` insert for `deleteReferral`. */
export const insertActionLogForDeleteReferral = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  target: { username: string; avatarLight: null | string },
  input: { userId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Removed referral: ${target.username}`],
    relatedId: input.userId,
    relatedMsg: `Referral has been removed`,
    relatedImage: target.avatarLight,
  });

/**
 * Build the `huntingSession` lookup for `deleteUser`, selecting only `userId`, using
 * predicates on `content` and `contractId`.
 */
export const findHuntingSessionForDeleteUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.huntingSession.findFirst({
    columns: { userId: true },
    where: sql`JSON_CONTAINS(${huntingSession.content}, JSON_OBJECT('id', ${huntingSession.contractId}, 'aiId', ${userId}), '$.contracts') = 1`,
  });

/** Build the `userDevice` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserDeviceForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userDevice).where(eq(userDevice.userId, userId));

/** Build the `userLiveActivity` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserLiveActivityForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userLiveActivity).where(eq(userLiveActivity.userId, userId));

/** Build the `userPushPreference` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserPushPreferenceForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userPushPreference).where(eq(userPushPreference.userId, userId));

/** Build the `webStoreOrder` update for `deleteUserInternal`, setting `recipientId`, using predicates on `recipientId`. */
export const updateWebStoreOrderForDeleteUserInternal = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(webStoreOrder)
    .set({ recipientId: `${DELETED_STORE_USER_PREFIX}${nanoid()}` })
    .where(eq(webStoreOrder.recipientId, userId));

/**
 * Build the `auctionOffer` update for `deleteUserInternal`, setting `status` and
 * `updatedAt`, using predicates on `ownerId` and `status`.
 */
export const updateAuctionOfferForDeleteUserInternal = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(auctionOffer)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(auctionOffer.ownerId, userId), eq(auctionOffer.status, "ACTIVE")));

/** Build the `overworldAiPlacement` selection for `deleteUserInternal`, using predicates on `aiTemplateUserId`. */
export const selectOverworldAiPlacementForDeleteUserInternal = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ id: overworldAiPlacement.id })
    .from(overworldAiPlacement)
    .where(eq(overworldAiPlacement.aiTemplateUserId, userId));

/** Build the `userData` update for `deleteUserInternal`, setting `senseiId`, using predicates on `senseiId`. */
export const updateUserDataForDeleteUserInternal = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client.update(userData).set({ senseiId: null }).where(eq(userData.senseiId, userId));

/** Build the `conversation` deletion for `deleteUserInternal`, using predicates on `createdById`. */
export const deleteConversationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(conversation).where(eq(conversation.createdById, userId));

/** Build the `user2conversation` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUser2conversationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(user2conversation).where(eq(user2conversation.userId, userId));

/** Build the `conversationComment` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteConversationCommentForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(conversationComment).where(eq(conversationComment.userId, userId));

/** Build the `notification` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteNotificationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(notification).where(eq(notification.userId, userId));

/** Build the `userBlackList` deletion for `deleteUserInternal`, using predicates on `creatorUserId`. */
export const deleteUserBlackListForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userBlackList).where(eq(userBlackList.creatorUserId, userId));

/** Build the `userBlackList` deletion for `deleteUserInternal`, using predicates on `targetUserId`. */
export const deleteUserBlackListForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userBlackList).where(eq(userBlackList.targetUserId, userId));

/** Build the `forumPost` deletion for `umPostForDeleteUserInternal`, using predicates on `userId`. */
export const deleteForumPostForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(forumPost).where(eq(forumPost.userId, userId));

/** Build the `forumThread` deletion for `umThreadForDeleteUserInternal`, using predicates on `userId`. */
export const deleteForumThreadForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(forumThread).where(eq(forumThread.userId, userId));

/** Build the `poll` deletion for `deleteUserInternal`, using predicates on `createdByUserId`. */
export const deletePollForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(poll).where(eq(poll.createdByUserId, userId));

/** Build the `userPollVote` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserPollVoteForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userPollVote).where(eq(userPollVote.userId, userId));

/** Build the `pollOption` deletion for `deleteUserInternal`, using predicates on `targetUserId`. */
export const deletePollOptionForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(pollOption).where(eq(pollOption.targetUserId, userId));

/** Build the `pollOption` deletion for `deleteUserInternal`, using predicates on `createdByUserId`. */
export const deletePollOptionForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(pollOption).where(eq(pollOption.createdByUserId, userId));

/** Build deletion of all inventory rows belonging to one user. */
export const deleteUserItems = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userItem).where(eq(userItem.userId, userId));

/** Build the `farmPlot` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteFarmPlotForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(farmPlot).where(eq(farmPlot.userId, userId));

/** Build the `farmExtraction` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteFarmExtractionForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(farmExtraction).where(eq(farmExtraction.userId, userId));

/** Build the `farmCollectionLog` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteFarmCollectionLogForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(farmCollectionLog).where(eq(farmCollectionLog.userId, userId));

/** Build deletion of all jutsus belonging to one user. */
export const deleteUserJutsus = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userJutsu).where(eq(userJutsu.userId, userId));

/** Build deletion of all queue rows belonging to one user. */
export const deleteUserQueues = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userQueue).where(eq(userQueue.userId, userId));

/** Build deletion of all cooking jobs belonging to one user. */
export const deleteUserCookingJobs = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userCookingJob).where(eq(userCookingJob.userId, userId));

/** Build the `jutsuLoadout` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteJutsuLoadoutForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(jutsuLoadout).where(eq(jutsuLoadout.userId, userId));

/** Build deletion of all quest history belonging to one user. */
export const deleteUserQuestHistory = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(questHistory).where(eq(questHistory.userId, userId));

/** Build the `userQuestAttempt` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserQuestAttemptForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userQuestAttempt).where(eq(userQuestAttempt.userId, userId));

/** Build the `bloodlineRolls` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteBloodlineRollsForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(bloodlineRolls).where(eq(bloodlineRolls.userId, userId));

/** Build the `historicalAvatar` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteHistoricalAvatarForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(historicalAvatar).where(eq(historicalAvatar.userId, userId));

/** Build the `historicalIp` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteHistoricalIpForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(historicalIp).where(eq(historicalIp.userId, userId));

/** Build the `recruitReferral` deletion for `deleteUserInternal`, using predicates on `recruitUserId`. */
export const deleteRecruitReferralForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(recruitReferral).where(eq(recruitReferral.recruitUserId, userId));

/** Build the `userActivityEvent` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserActivityEventForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userActivityEvent).where(eq(userActivityEvent.userId, userId));

/** Build the `actionLog` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteActionLogForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(actionLog).where(eq(actionLog.userId, userId));

/** Build the `trainingLog` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteTrainingLogForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(trainingLog).where(eq(trainingLog.userId, userId));

/** Build the `aiProfile` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteAiProfileForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(aiProfile).where(eq(aiProfile.userId, userId));

/** Build the `overworldAiPlacementQuest` deletion for `deleteUserInternal`, using predicates on `placementId`. */
export const deleteOverworldAiPlacementQuestForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  aiPlacementIds: string[],
) =>
  client
    .delete(overworldAiPlacementQuest)
    .where(inArray(overworldAiPlacementQuest.placementId, aiPlacementIds));

/** Build the `overworldAiPlacement` deletion for `deleteUserInternal`, using predicates on `id`. */
export const deleteOverworldAiPlacementForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  aiPlacementIds: string[],
) =>
  client
    .delete(overworldAiPlacement)
    .where(inArray(overworldAiPlacement.id, aiPlacementIds));

/** Build the `captcha` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteCaptchaForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(captcha).where(eq(captcha.userId, userId));

/** Build the `reportLog` deletion for `deleteUserInternal`, using predicates on `targetUserId`. */
export const deleteReportLogForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(reportLog).where(eq(reportLog.targetUserId, userId));

/** Build the `reportLog` deletion for `deleteUserInternal`, using predicates on `staffUserId`. */
export const deleteReportLogForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(reportLog).where(eq(reportLog.staffUserId, userId));

/** Build the `userReport` deletion for `deleteUserInternal`, using predicates on `reporterUserId`. */
export const deleteUserReportForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userReport).where(eq(userReport.reporterUserId, userId));

/** Build the `userReport` deletion for `deleteUserInternal`, using predicates on `reportedUserId`. */
export const deleteUserReportForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userReport).where(eq(userReport.reportedUserId, userId));

/** Build the `userReportComment` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserReportCommentForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userReportComment).where(eq(userReportComment.userId, userId));

/** Build the `automatedModeration` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteAutomatedModerationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(automatedModeration).where(eq(automatedModeration.userId, userId));

/** Build the `moderationScan` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteModerationScanForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(moderationScan).where(eq(moderationScan.userId, userId));

/** Build the `staffApplication` deletion for `deleteUserInternal`, using predicates on `applicantUserId`. */
export const deleteStaffApplicationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client.delete(staffApplication).where(eq(staffApplication.applicantUserId, userId));

/** Build the `supportReview` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteSupportReviewForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(supportReview).where(eq(supportReview.userId, userId));

/** Build the `bankTransfers` deletion for `deleteUserInternal`, using predicates on `senderId`. */
export const deleteBankTransfersForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(bankTransfers).where(eq(bankTransfers.senderId, userId));

/** Build the `bankTransfers` deletion for `deleteUserInternal`, using predicates on `receiverId`. */
export const deleteBankTransfersForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(bankTransfers).where(eq(bankTransfers.receiverId, userId));

/** Build the `userRewards` deletion for `deleteUserInternal`, using predicates on `awardedById`. */
export const deleteUserRewardsForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userRewards).where(eq(userRewards.awardedById, userId));

/** Build the `userRewards` deletion for `deleteUserInternal`, using predicates on `receiverId`. */
export const deleteUserRewardsForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userRewards).where(eq(userRewards.receiverId, userId));

/** Build the `userVote` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserVoteForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userVote).where(eq(userVote.userId, userId));

/** Build the `userReview` deletion for `deleteUserInternal`, using predicates on `authorUserId`. */
export const deleteUserReviewForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userReview).where(eq(userReview.authorUserId, userId));

/** Build the `userReview` deletion for `deleteUserInternal`, using predicates on `targetUserId`. */
export const deleteUserReviewForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userReview).where(eq(userReview.targetUserId, userId));

/** Build the `userHome` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserHomeForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userHome).where(eq(userHome.userId, userId));

/** Build the `userLikes` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserLikesForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userLikes).where(eq(userLikes.userId, userId));

/** Build the `userRequest` deletion for `deleteUserInternal`, using predicates on `senderId`. */
export const deleteUserRequestForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userRequest).where(eq(userRequest.senderId, userId));

/** Build the `userRequest` deletion for `deleteUserInternal`, using predicates on `receiverId`. */
export const deleteUserRequestForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userRequest).where(eq(userRequest.receiverId, userId));

/** Build deletion of all ranked rewards belonging to one user. */
export const deleteUserRankedRewards = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(rankedUserRewards).where(eq(rankedUserRewards.userId, userId));

/** Build the `kageDefendedChallenges` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteKageDefendedChallengesForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client
    .delete(kageDefendedChallenges)
    .where(eq(kageDefendedChallenges.userId, userId));

/** Build the `kageDefendedChallenges` deletion for `deleteUserInternal`, using predicates on `kageId`. */
export const deleteKageDefendedChallengesForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client
    .delete(kageDefendedChallenges)
    .where(eq(kageDefendedChallenges.kageId, userId));

/** Build the `warKill` deletion for `deleteUserInternal`, using predicates on `killerId`. */
export const deleteWarKillForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(warKill).where(eq(warKill.killerId, userId));

/** Build the `warKill` deletion for `deleteUserInternal`, using predicates on `victimId`. */
export const deleteWarKillForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(warKill).where(eq(warKill.victimId, userId));

/** Build the `raidParticipation` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteRaidParticipationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(raidParticipation).where(eq(raidParticipation.userId, userId));

/** Build the `userRaidBuff` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserRaidBuffForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userRaidBuff).where(eq(userRaidBuff.userId, userId));

/** Build the `damageSimulation` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteDamageSimulationForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(damageSimulation).where(eq(damageSimulation.userId, userId));

/** Build the `conceptImage` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteConceptImageForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(conceptImage).where(eq(conceptImage.userId, userId));

/** Build the `userBadge` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserBadgeForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userBadge).where(eq(userBadge.userId, userId));

/** Build the `userTitle` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserTitleForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userTitle).where(eq(userTitle.userId, userId));

/** Build the `title` deletion for `deleteUserInternal`, using predicates on `legacyOwnerId`. */
export const deleteTitleForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(title).where(eq(title.legacyOwnerId, userId));

/** Build the `linkPromotion` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteLinkPromotionForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(linkPromotion).where(eq(linkPromotion.userId, userId));

/** Build the `linkPromotion` deletion for `deleteUserInternal`, using predicates on `reviewedBy`. */
export const deleteLinkPromotionForDeleteUserInternal2 = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(linkPromotion).where(eq(linkPromotion.reviewedBy, userId));

/** Build the `userUpload` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserUploadForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userUpload).where(eq(userUpload.userId, userId));

/** Build the `userPet` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserPetForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userPet).where(eq(userPet.userId, userId));

/** Build the `userData` deletion for `deleteUserInternal`, using predicates on `userId`. */
export const deleteUserDataForDeleteUserInternal = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userData).where(eq(userData.userId, userId));

/** Run EXPLAIN on a development-backup statement; the staff caller owns authorization and statement validation. */
export const validateDevelopmentBackup = (
  client: Pick<PlanetScaleClient, "execute">,
  sqlText: string,
) => client.execute(`EXPLAIN ${sqlText}`);

/** Delete the validated development table or its AI rows; the staff caller must restrict the table and database. */
export const clearDevelopmentBackupTarget = (
  client: Pick<PlanetScaleClient, "execute">,
  tableName: string,
  isAi: boolean,
) =>
  client.execute(
    isAi
      ? `DELETE FROM \`${tableName}\` WHERE isAi = 1`
      : `DELETE FROM \`${tableName}\``,
  );

/** Execute a validated development-backup statement; database and staff authorization remain with the caller. */
export const applyDevelopmentBackup = (
  client: Pick<PlanetScaleClient, "execute">,
  sqlText: string,
) => client.execute(sqlText);
