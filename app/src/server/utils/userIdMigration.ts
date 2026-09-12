import { sql } from "drizzle-orm";
import type { DrizzleClient } from "@/server/db";
import {
  migrateStoreEntitlementRevocations,
  migrateStoreEntitlementStates,
  migrateStorePurchaseTransfers,
} from "@/server/utils/purchases/grant";

/**
 * Application columns which store a UserData.userId (or the corresponding Clerk id).
 *
 * This list is deliberately explicit. Table and column identifiers are trusted constants, while
 * both ids remain bound parameters. When a new user-id reference is added to the schema it must be
 * added here as well; the coverage test compares this inventory to the schema.
 *
 * Store entitlement/transfer tables are excluded because their composite unique keys require
 * semantic merges. StoreUserIdAlias.oldUserId is intentionally retained as the durable redirect.
 */
export const USER_ID_REFERENCE_COLUMNS = [
  ["GameAsset", "createdByUserId"],
  ["GuideArticle", "updatedByUserId"],
  ["AiProfile", "userId"],
  ["OverworldAiPlacement", "aiTemplateUserId"],
  ["AnbuSquad", "leaderId"],
  ["Battle", "activeUserId"],
  ["BattleAction", "userId"],
  ["BattleHistory", "attackedId"],
  ["BattleHistory", "defenderId"],
  ["EmailReminder", "userId"],
  ["UserBlackList", "creatorUserId"],
  ["UserBlackList", "targetUserId"],
  ["BloodlineReskin", "createdBy"],
  ["UserSkill", "userId"],
  ["BloodlineRolls", "userId"],
  ["SageModeRolls", "userId"],
  ["Captcha", "userId"],
  ["Clan", "founderId"],
  ["Clan", "leaderId"],
  ["Clan", "coLeader1"],
  ["Clan", "coLeader2"],
  ["Clan", "coLeader3"],
  ["Clan", "assassin1"],
  ["Clan", "assassin2"],
  ["Clan", "assassin3"],
  ["Clan", "assassin4"],
  ["Clan", "assassin5"],
  ["Clan", "assassin6"],
  ["Clan", "assassin7"],
  ["Clan", "assassin8"],
  ["Clan", "assassin9"],
  ["Clan", "assassin10"],
  ["Clan", "elderNomineeId"],
  ["MpvpBattleUser", "userId"],
  ["TournamentMatch", "winnerId"],
  ["TournamentMatch", "userId1"],
  ["TournamentMatch", "userId2"],
  ["TournamentRecord", "winnerId"],
  ["Conversation", "createdById"],
  ["UsersInConversation", "userId"],
  ["ConversationComment", "userId"],
  ["ConversationComment", "authorId"],
  ["DamageCalculation", "userId"],
  ["ForumPost", "userId"],
  ["ForumPost", "authorId"],
  ["ForumThread", "userId"],
  ["HistoricalAvatar", "userId"],
  ["HistoricalSoundEffect", "userId"],
  ["UserItemVariant", "userId"],
  ["JutsuReskin", "userId"],
  ["JutsuLoadout", "userId"],
  ["ItemLoadout", "userId"],
  ["RankedLoadout", "userId"],
  ["RankedUserRewards", "userId"],
  ["RankedPvpQueue", "userId"],
  ["RecruitmentRewards", "userId"],
  ["RecruitmentRewards", "recruitedUserId"],
  ["Notification", "userId"],
  ["PaypalSubscription", "createdById"],
  ["PaypalSubscription", "affectedUserId"],
  ["PaypalTransaction", "createdById"],
  ["PaypalTransaction", "affectedUserId"],
  ["RyoTrade", "creatorUserId"],
  ["RyoTrade", "purchaserUserId"],
  ["RyoTrade", "allowedPurchaserId"],
  ["ReportLog", "targetUserId"],
  ["ReportLog", "staffUserId"],
  ["ActionLog", "userId"],
  ["TrainingLog", "userId"],
  ["UserAttribute", "userId"],
  ["UserAssociation", "userOne"],
  ["UserAssociation", "userTwo"],
  ["UserData", "recruiterId"],
  ["UserData", "senseiId"],
  ["UserActivityEvent", "userId"],
  ["HistoricalIp", "userId"],
  ["UserReview", "authorUserId"],
  ["UserReview", "targetUserId"],
  ["UserNindo", "userId"],
  ["UserItem", "userId"],
  ["AuctionListing", "sellerId"],
  ["AuctionListing", "buyerId"],
  ["AuctionListing", "targetUserId"],
  ["AuctionBid", "bidderId"],
  ["UserJutsu", "userId"],
  ["UserReport", "reporterUserId"],
  ["UserReport", "reportedUserId"],
  ["UserReportComment", "userId"],
  ["AutomatedModeration", "userId"],
  ["SectorMap", "publishedByUserId"],
  ["MapAsset", "createdByUserId"],
  ["MapTerrain", "createdByUserId"],
  ["SupportReview", "userId"],
  ["Village", "kageId"],
  ["KageDefendedChallenges", "userId"],
  ["KageDefendedChallenges", "kageId"],
  ["QuestHistory", "userId"],
  ["UserQuestAttempt", "userId"],
  ["RaidParticipation", "userId"],
  ["UserRaidBuff", "userId"],
  ["UserLikes", "userId"],
  ["ConceptImage", "userId"],
  ["BankTransfers", "senderId"],
  ["BankTransfers", "receiverId"],
  ["DailyBankInterest", "userId"],
  ["UserBadge", "userId"],
  ["UserRequest", "senderId"],
  ["UserRequest", "receiverId"],
  ["UserRewards", "awardedById"],
  ["UserRewards", "receiverId"],
  ["LinkPromotion", "userId"],
  ["LinkPromotion", "reviewedBy"],
  ["UserVote", "userId"],
  ["VillageElderVote", "initiatedByUserId"],
  ["VillageElderVoteEntry", "userId"],
  ["WarKill", "killerId"],
  ["WarKill", "victimId"],
  ["Poll", "createdByUserId"],
  ["PollOption", "targetUserId"],
  ["PollOption", "createdByUserId"],
  ["UserPollVote", "userId"],
  ["UserUpload", "userId"],
  ["Bounty", "targetUserId"],
  ["Bounty", "creatorUserId"],
  ["Bounty", "claimedByUserId"],
  ["BountySignup", "hunterUserId"],
  ["BountyContribution", "contributorUserId"],
  ["SupportTicket", "createdByUserId"],
  ["SupportTicket", "assignedToUserId"],
  ["SupportTicketActivity", "authorId"],
  ["CannedResponse", "createdByUserId"],
  ["StaffApplication", "applicantUserId"],
  ["StaffApplicationApproval", "approverUserId"],
  ["ReferralSource", "userId"],
  ["AbEvent", "userId"],
  ["UserTowerDefenseUpgrade", "userId"],
  ["TowerDefenseRun", "userId"],
  ["ActivityStreakConfig", "createdByUserId"],
  ["UserStreakProgress", "userId"],
  ["FarmPlot", "userId"],
  ["FarmCollectionLog", "userId"],
  ["FarmExtraction", "userId"],
  ["UserDevice", "userId"],
  ["UserPushPreference", "userId"],
  ["UserLiveActivity", "userId"],
  ["StorePurchase", "userId"],
  ["StorePurchase", "originalUserId"],
  ["StoreUserIdAlias", "newUserId"],
] as const;

const identifier = (value: string) => sql.raw(`\`${value}\``);

const referencesByTable = new Map<string, string[]>();
for (const [tableName, columnName] of USER_ID_REFERENCE_COLUMNS) {
  const columns = referencesByTable.get(tableName) ?? [];
  columns.push(columnName);
  referencesByTable.set(tableName, columns);
}

type ReferenceProbeRow = { tableName: string };

const extractProbeRows = (result: unknown): ReferenceProbeRow[] => {
  if (Array.isArray(result)) {
    const rows = result[0];
    return Array.isArray(rows) ? (rows as ReferenceProbeRow[]) : [];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as ReferenceProbeRow[]) : [];
  }
  return [];
};

/**
 * Identify tables which currently contain the source id in one round trip.
 *
 * PlanetScale interactive transactions are short lived. Issuing one empty UPDATE for every
 * schema column can exhaust the transaction even for a user with only a handful of references.
 * The EXISTS probes preserve the explicit schema inventory while keeping the write phase bounded
 * by the user's actual relation graph. Each matching table is then updated once, even when it has
 * several user-id columns.
 */
const findReferencedTables = async (client: DrizzleClient, oldUserId: string) => {
  const probes = [...referencesByTable].map(([tableName, columnNames]) => {
    const predicates = columnNames.map(
      (columnName) => sql`${identifier(columnName)} = ${oldUserId}`,
    );
    return sql`SELECT ${tableName} AS tableName WHERE EXISTS (SELECT 1 FROM ${identifier(tableName)} WHERE ${sql.join(predicates, sql` OR `)} LIMIT 1)`;
  });
  const result = await client.execute(sql.join(probes, sql` UNION ALL `));
  return new Set(extractProbeRows(result).map((row) => row.tableName));
};

/** Move every application reference. The caller must provide a transaction-bound client. */
export const migrateUserIdReferences = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
) => {
  const referencedTables = await findReferencedTables(client, oldUserId);

  // Transactions use one connection; execute sequentially instead of racing its response parser.
  // Multiple columns on the same table are changed together so constraints see the final row.
  for (const [tableName, columnNames] of referencesByTable) {
    if (!referencedTables.has(tableName)) continue;
    const assignments = columnNames.map(
      (columnName) =>
        sql`${identifier(columnName)} = IF(${identifier(columnName)} = ${oldUserId}, ${newUserId}, ${identifier(columnName)})`,
    );
    const predicates = columnNames.map(
      (columnName) => sql`${identifier(columnName)} = ${oldUserId}`,
    );
    await client.execute(
      sql`UPDATE ${identifier(tableName)} SET ${sql.join(assignments, sql`, `)} WHERE ${sql.join(predicates, sql` OR `)}`,
    );
  }

  // These tables have composite identity keys and require lossless collision merges.
  await migrateStoreEntitlementStates(client, oldUserId, newUserId);
  await migrateStoreEntitlementRevocations(client, oldUserId, newUserId);
  await migrateStorePurchaseTransfers(client, oldUserId, newUserId);
};
