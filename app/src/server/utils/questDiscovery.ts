import {
  and,
  asc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import type { LetterRank, QuestType } from "@/drizzle/constants";
import { quest, questHistory } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

interface QuestDiscoveryOptions {
  questTypes: QuestType[];
  villageId?: string;
  level?: number;
  ranks?: LetterRank[];
}

/**
 * Shared candidate query for quest discovery screens. Availability remains the caller's
 * responsibility because each destination adds its own contextual rules (war state, structure,
 * occupation, or NPC discovery). Keeping this join shared prevents dashboard discovery from
 * loading the full profile independently for every content category.
 */
export const fetchQuestDiscoveryCandidates = async (
  client: DrizzleClient,
  userId: string,
  options: QuestDiscoveryOptions,
) =>
  client
    .select({
      ...getTableColumns(quest),
      previousAttempts: questHistory.previousAttempts,
      previousCompletes: questHistory.previousCompletes,
      completed: questHistory.completed,
      periodCompletes: questHistory.periodCompletes,
      periodStartAt: questHistory.periodStartAt,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, userId)),
    )
    .where(buildQuestDiscoveryWhere(options))
    .orderBy(asc(quest.name));

/** The same discovery join without objective JSON or other full-definition fields. */
export const fetchQuestDiscoverySummaryCandidates = async (
  client: DrizzleClient,
  userId: string,
  options: QuestDiscoveryOptions,
) =>
  client
    .select({
      id: quest.id,
      name: quest.name,
      image: quest.image,
      description: quest.description,
      questRank: quest.questRank,
      medicalRank: quest.medicalRank,
      huntingRank: quest.huntingRank,
      gatheringRank: quest.gatheringRank,
      requiredLevel: quest.requiredLevel,
      requiredFarmingLevel: quest.requiredFarmingLevel,
      prerequisiteQuestId: quest.prerequisiteQuestId,
      questType: quest.questType,
      hidden: quest.hidden,
      requiredVillage: quest.requiredVillage,
      requiredBloodlineId: quest.requiredBloodlineId,
      requiredSageModeId: quest.requiredSageModeId,
      requiredSageRank: quest.requiredSageRank,
      maxLevel: quest.maxLevel,
      maxAttempts: quest.maxAttempts,
      maxCompletes: quest.maxCompletes,
      retryDelay: quest.retryDelay,
      startsAt: quest.startsAt,
      endsAt: quest.endsAt,
      previousAttempts: questHistory.previousAttempts,
      previousCompletes: questHistory.previousCompletes,
      completed: questHistory.completed,
      periodCompletes: questHistory.periodCompletes,
      periodStartAt: questHistory.periodStartAt,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, userId)),
    )
    .where(buildQuestDiscoveryWhere(options))
    .orderBy(asc(quest.name));

const buildQuestDiscoveryWhere = (options: QuestDiscoveryOptions) =>
  and(
    inArray(quest.questType, options.questTypes),
    options.villageId
      ? or(isNull(quest.requiredVillage), eq(quest.requiredVillage, options.villageId))
      : undefined,
    options.ranks?.length ? inArray(quest.questRank, options.ranks) : undefined,
    options.level !== undefined ? lte(quest.requiredLevel, options.level) : undefined,
    options.level !== undefined ? gte(quest.maxLevel, options.level) : undefined,
  );
