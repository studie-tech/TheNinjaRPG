import { TRPCError } from "@trpc/server";
import { and, lte, sql, eq, lt, isNull, isNotNull } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { forumPost, forumThread, questHistory, userAttribute } from "@/drizzle/schema";
import { bankTransfers, bloodlineRolls, conceptImage } from "@/drizzle/schema";
import { userData, battle, userJutsu, jutsu } from "@/drizzle/schema";
import { userItem, mpvpBattleQueue, mpvpBattleUser } from "@/drizzle/schema";
import { trainingLog, village, captcha, userRequest } from "@/drizzle/schema";
import { battleHistory, battleAction, historicalAvatar, clan } from "@/drizzle/schema";
import { conversation, user2conversation, conversationComment } from "@/drizzle/schema";
import { rankedPvpQueue, warKill, dataBattleAction } from "@/drizzle/schema";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { secondsFromNow } from "@/utils/time";
import { updateGameSetting, checkGameTimer } from "@/libs/gamesettings";
import { automatedModeration, dailyBankInterest } from "@/drizzle/schema";
import { paypalSubscription } from "@/drizzle/schema";
import { historicalIp, userActivityEvent } from "@/drizzle/schema";

export async function GET() {
  // Check timer
  const frequency = 1;
  const response = await checkGameTimer(drizzleDB, frequency);
  if (response) return response;

  try {
    // Update timer
    await updateGameSetting(drizzleDB, `timer-${frequency}h`, 0, new Date());

    // Step 1: Delete from battle table where updatedAt is older than 1 day
    await drizzleDB
      .delete(battle)
      .where(lte(battle.updatedAt, new Date(Date.now() - 1000 * 60 * 60 * 24)));

    // Step 2: Update users who are in battle where the battle no longer exists to be awake and not in battle
    await drizzleDB.execute(
      sql`UPDATE ${userData} a SET a.battleId=NULL, a.status="AWAKE", a.travelFinishAt=NULL WHERE NOT EXISTS (SELECT id FROM ${battle} b WHERE b.id = a.battleId) AND a.battleId IS NOT NULL`,
    );

    // Step 2.5: Complete travel for users whose travel time has expired
    await drizzleDB
      .update(userData)
      .set({ status: "AWAKE", travelFinishAt: null })
      .where(
        and(
          eq(userData.status, "TRAVEL"),
          isNotNull(userData.travelFinishAt),
          lt(userData.travelFinishAt, new Date()),
        ),
      );

    // Time constants
    const oneHour = 1000 * 60 * 60;
    const oneDay = oneHour * 24;

    // Battle retention periods:
    // - PVP (72 hours): Explicit PVP types that we want longer retention for
    // - Everything else (12 hours): All other battle types default to short retention
    const pvpTypes = [
      "SPARRING",
      "CLAN_BATTLE",
      "TOURNAMENT",
      "RANKED_SPARRING",
      "KAGE_PVP",
      "COMBAT",
      "RANKED_PVP",
    ] as const;

    // Step 3: Delete from battle action based on battle type (matching battleHistory retention)
    // Join with battleHistory to get the battleType for each battleAction
    // Delete PVP battle actions older than 72 hours
    await drizzleDB.execute(
      sql`DELETE a FROM ${battleAction} a
          INNER JOIN ${battleHistory} h ON a.battleId = h.battleId
          WHERE h.battleType IN (${sql.join(
            pvpTypes.map((t) => sql`${t}`),
            sql`, `,
          )})
          AND a.updatedAt < DATE_SUB(NOW(), INTERVAL 72 HOUR) LIMIT 99999`,
    );

    // Delete all other battle actions older than 12 hours (including new/unknown types)
    await drizzleDB.execute(
      sql`DELETE a FROM ${battleAction} a
          INNER JOIN ${battleHistory} h ON a.battleId = h.battleId
          WHERE (h.battleType NOT IN (${sql.join(
            pvpTypes.map((t) => sql`${t}`),
            sql`, `,
          )}) OR h.battleType IS NULL)
          AND a.updatedAt < DATE_SUB(NOW(), INTERVAL 12 HOUR) LIMIT 99999`,
    );

    // Delete orphaned battle actions (no matching battle AND no matching history) older than 12 hours
    await drizzleDB.execute(
      sql`DELETE FROM ${battleAction} a WHERE
          NOT EXISTS (SELECT id FROM ${battle} b WHERE b.id = a.battleId) AND
          NOT EXISTS (SELECT battleId FROM ${battleHistory} h WHERE h.battleId = a.battleId) AND
          a.updatedAt < DATE_SUB(NOW(), INTERVAL 12 HOUR) LIMIT 99999`,
    );

    // Step 5: Delete battle history based on battle type

    // Delete PVP battles older than 72 hours
    await drizzleDB.execute(
      sql`DELETE FROM ${battleHistory}
          WHERE battleType IN (${sql.join(
            pvpTypes.map((t) => sql`${t}`),
            sql`, `,
          )})
          AND createdAt < DATE_SUB(NOW(), INTERVAL 72 HOUR)`,
    );

    // Delete all other battles older than 12 hours (including null/unknown types)
    await drizzleDB.execute(
      sql`DELETE FROM ${battleHistory}
          WHERE (battleType NOT IN (${sql.join(
            pvpTypes.map((t) => sql`${t}`),
            sql`, `,
          )}) OR battleType IS NULL)
          AND createdAt < DATE_SUB(NOW(), INTERVAL 12 HOUR)`,
    );

    // Step 6: Delete conversations older than 14 days
    await drizzleDB
      .delete(conversation)
      .where(
        and(
          lte(conversation.updatedAt, new Date(Date.now() - oneDay * 14)),
          eq(conversation.isPublic, false),
          eq(conversation.isStaffAvailable, false),
        ),
      );

    // Step 7: Conversation comments where the conversation does not exist anymore
    await drizzleDB.execute(
      sql`DELETE FROM ${conversationComment} a WHERE NOT EXISTS (SELECT id FROM ${conversation} b WHERE b.id = a.conversationId)`,
    );

    // Step 8a: Delete conversation comments older than 14 days
    await drizzleDB.execute(
      sql`
        DELETE a FROM ${conversationComment} a
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 14 DAY AND b.isStaffAvailable = false
      `,
    );

    // Step 8b: Delete global tavern conversation comments older than 2 hours
    await drizzleDB.execute(
      sql`
        DELETE a FROM ${conversationComment} a 
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE b.isPublic AND b.title = 'Global' AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR`,
    );

    // Step 8c: Delete other public conversation comments older than 1 days
    await drizzleDB.execute(
      sql`
        DELETE a FROM ${conversationComment} a 
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE b.isPublic AND b.title != 'Global' AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY AND b.isStaffAvailable = false`,
    );

    // Step 9: Delete user2conversation where the conversation does not exist anymore
    await drizzleDB.execute(
      sql`DELETE FROM ${user2conversation} a WHERE NOT EXISTS (SELECT id FROM ${conversation} b WHERE b.id = a.conversationId)`,
    );
    await drizzleDB.execute(
      sql`DELETE FROM ${user2conversation} a WHERE NOT EXISTS (SELECT userId FROM ${userData} b WHERE b.userId = a.userId)`,
    );

    // Step 10: Remove user jutsus where the jutsu ID no longer exists
    await drizzleDB.execute(
      sql`DELETE FROM ${userJutsu} a WHERE NOT EXISTS (SELECT id FROM ${jutsu} b WHERE b.id = a.jutsuId)`,
    );

    // Step 11: Clearing historical avatars that failed more than 3 hours ago
    await drizzleDB
      .delete(historicalAvatar)
      .where(
        and(
          lt(historicalAvatar.createdAt, secondsFromNow(-3600 * 3)),
          isNull(historicalAvatar.avatar),
        ),
      );

    // Step 12: Update users who have a clanId by no clan
    await drizzleDB.execute(
      sql`UPDATE ${userData} a SET a.clanId=NULL WHERE NOT EXISTS (SELECT id FROM ${clan} b WHERE b.id = a.clanId) AND a.clanId IS NOT NULL`,
    );

    // Step 13: Bank transfers from deleted users
    await drizzleDB.execute(
      sql`DELETE a FROM ${bankTransfers} a LEFT JOIN ${userData} b ON a.senderId = b.userId WHERE b.userId IS NULL`,
    );
    await drizzleDB.execute(
      sql`DELETE a FROM ${bankTransfers} a LEFT JOIN ${userData} b ON a.receiverId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 14: Clear users older than 60 days
    await drizzleDB.execute(
      sql`DELETE FROM ${userData} WHERE experience < 100 AND isAi = 0 AND updatedAt < CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY AND reputationPointsTotal <= 5`,
    );
    await drizzleDB.execute(
      sql`DELETE FROM ${userData} WHERE experience < 10000 AND isAi = 0 AND updatedAt < CURRENT_TIMESTAMP(3) - INTERVAL 60 DAY AND reputationPointsTotal <= 5`,
    );

    // Step 15: Clear bloodline rolls without a user
    await drizzleDB.execute(
      sql`DELETE a FROM ${bloodlineRolls} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 16: Clear concept images without a user
    await drizzleDB.execute(
      sql`DELETE a FROM ${conceptImage} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 17: Clear forums without a user
    await drizzleDB.execute(
      sql`DELETE a FROM ${forumThread} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );
    await drizzleDB.execute(
      sql`DELETE a FROM ${forumPost} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );
    await drizzleDB.execute(
      sql`DELETE a FROM ${forumPost} a LEFT JOIN ${forumThread} b ON a.threadId = b.id WHERE b.id IS NULL`,
    );

    // Step 18: Historical avatars
    await drizzleDB.execute(
      sql`DELETE a FROM ${historicalAvatar} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 19: Historical avatars
    await drizzleDB.execute(
      sql`DELETE a FROM ${questHistory} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 20: User attributes
    await drizzleDB.execute(
      sql`DELETE a FROM ${userAttribute} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 21: User jutsu & items
    await drizzleDB.execute(
      sql`DELETE a FROM ${userJutsu} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );
    await drizzleDB.execute(
      sql`DELETE a FROM ${userItem} a LEFT JOIN ${userData} b ON a.userId = b.userId WHERE b.userId IS NULL`,
    );

    // Step 22: Clear training log entries
    await drizzleDB.execute(
      sql`DELETE FROM ${trainingLog} WHERE trainingFinishedAt < CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`,
    );

    // Step 23: Clear mpvp battle queue entries
    await drizzleDB.execute(
      sql`DELETE FROM ${mpvpBattleQueue} WHERE createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`,
    );

    // Step 24: Clear mpvp battle user entries
    await drizzleDB.execute(
      sql`DELETE FROM ${mpvpBattleUser} a WHERE NOT EXISTS (SELECT id FROM ${mpvpBattleQueue} b WHERE b.id = a.clanBattleId)`,
    );

    // Step 25: Set status to AWAKE for users who are QUEUED if they are not in any active battle systems
    // This covers mpvp battles and ranked PVP (kage challenges now use KAGE_QUEUED status)
    await drizzleDB.execute(
      sql`UPDATE ${userData} a SET a.status="AWAKE" WHERE a.status="QUEUED" 
          AND NOT EXISTS (SELECT id FROM ${mpvpBattleUser} b WHERE b.userId = a.userId)
          AND NOT EXISTS (SELECT id FROM ${rankedPvpQueue} d WHERE d.userId = a.userId)`,
    );

    // Step 25b: Set status to AWAKE for users who are KAGE_QUEUED if their challenge has expired
    // Kage challenges expire after 10 minutes (600 seconds)
    await drizzleDB.execute(
      sql`UPDATE ${userData} a SET a.status="AWAKE" WHERE a.status="KAGE_QUEUED"
          AND NOT EXISTS (SELECT id FROM ${userRequest} c WHERE c.senderId = a.userId AND c.type = 'KAGE' AND c.status = 'PENDING' AND c.createdAt > NOW() - INTERVAL 10 MINUTE)`,
    );

    // Step 26: Update the population of each village
    await drizzleDB.execute(
      sql`UPDATE ${village} a SET a.populationCount = (SELECT COUNT(*) FROM ${userData} b WHERE b.villageId = a.id)`,
    );

    // Step 27: Clear old captcha checks
    await drizzleDB.execute(
      sql`DELETE FROM ${captcha} WHERE createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`,
    );

    // Step 28: Clear old challenges:
    await drizzleDB
      .delete(userRequest)
      .where(lt(userRequest.createdAt, secondsFromNow(-3600 * 24)));

    // Step 29: Wrong village wrt. clan
    await drizzleDB.execute(
      sql`UPDATE ${userData} u INNER JOIN ${clan} c ON u.clanId = c.id SET u.villageId = c.villageId WHERE c.hasHideout = true AND u.villageId != c.villageId`,
    );

    // Step 30: Reduce tavern activity every day by 50%
    await drizzleDB.execute(
      sql`UPDATE ${userData} SET tavernMessages = FLOOR(tavernMessages * 0.95)`,
    );

    // Step 31: Clear automatedModeration older than  3 months
    await drizzleDB.execute(
      sql`DELETE FROM ${automatedModeration} WHERE createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 3 MONTH`,
    );

    // Step 32: Clear old paypal subscriptions
    await drizzleDB.execute(
      sql`UPDATE ${userData} u SET u.federalStatus = 'NONE' WHERE u.federalStatus != 'NONE' AND NOT EXISTS (
        SELECT 1 FROM ${paypalSubscription} p WHERE p.affectedUserId = u.userId AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY
      )`,
    );

    // Step 33: Activate users with active subscriptions
    await drizzleDB.execute(
      sql`UPDATE ${userData} u
          INNER JOIN ${paypalSubscription} ps ON u.userId = ps.affectedUserId
          SET u.federalStatus = ps.federalStatus
          WHERE 
            u.federalStatus = 'NONE'
            AND ps.status = 'ACTIVE'
            AND ps.updatedAt > DATE_SUB(NOW(), INTERVAL 31 DAY)`,
    );

    // Step 34: Clear daily bank interest older than 7 days
    await drizzleDB.execute(
      sql`DELETE FROM ${dailyBankInterest} WHERE updatedAt < CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`,
    );

    // Step 35: Clear daily bank interest older than 2 days which are already claimed
    await drizzleDB.execute(
      sql`DELETE FROM ${dailyBankInterest} WHERE claimed = 1 AND updatedAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY`,
    );

    // Delete historical ips older than 90 days
    await drizzleDB.execute(
      sql`DELETE FROM ${historicalIp} WHERE usedAt < CURRENT_TIMESTAMP(3) - INTERVAL 90 DAY`,
    );

    // Clean activity events older than 10 days
    await drizzleDB.execute(
      sql`DELETE FROM ${userActivityEvent} WHERE createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 10 DAY`,
    );

    // Clear rankedPvpQueue entries older than 1 day
    await drizzleDB.execute(
      sql`DELETE FROM ${rankedPvpQueue} WHERE createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY`,
    );

    // Clear war kills older than 10 days
    await drizzleDB.execute(
      sql`DELETE FROM ${warKill} WHERE killedAt < CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`,
    );

    // Clear dataBattleAction entries older than 30 days
    await drizzleDB.execute(
      sql`DELETE FROM ${dataBattleAction} WHERE updatedAt < CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`,
    );

    return Response.json(`OK`);
  } catch (cause) {
    console.error(cause);
    if (cause instanceof TRPCError) {
      // An error from tRPC occured
      const httpCode = getHTTPStatusCodeFromError(cause);
      return Response.json(cause, { status: httpCode });
    }
    // Another error occured
    return Response.json("Internal server error", { status: 500 });
  }
}
