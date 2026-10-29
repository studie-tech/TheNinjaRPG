/**
 * Database access for quests; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  IMG_AVATAR_DEFAULT,
  type LetterRank,
  MAX_EXPERIENCE_LEVEL,
  NPC_ONLY_QUEST_TYPES,
  PET_TASK_MIN_RANK,
  type QuestType,
  type UserRole,
  UserRoles,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  badge,
  bankTransfers,
  bloodline,
  bloodlineRolls,
  clan,
  item,
  jutsu,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  type Quest,
  quest,
  questHistory,
  raidDamageThreshold,
  raidParticipation,
  recruitmentRewards,
  sageMode,
  sageModeRolls,
  title,
  type UserData,
  userBadge,
  userData,
  userItem,
  userJutsu,
  userPet,
  userQuestAttempt,
  userRaidBuff,
  userRewards,
  userTitle,
  village,
  war,
} from "@/drizzle/schema";
import { getFarmingLevel } from "@/libs/farming";
import { isSupportedOverworldBindingTask } from "@/libs/overworldAi";
import { filterQuestTrackersForDbPersist, getUserQuests } from "@/libs/quest";
import {
  buildRewardChoiceCards,
  type RewardChoiceOwnership,
} from "@/libs/rewardChoice";
import { getSageMasteryDisplayRank, sageRanksAtOrBelow } from "@/libs/sageMode";
import {
  extendWarParticipantSql,
  liftBracketImmunitySql,
  warRaidCombatGuard,
} from "@/queries/war";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { userRegenerationGainSql } from "@/server/utils/regeneration";
import { canPlayHiddenQuests } from "@/utils/permissions";
import type {
  AllObjectivesType,
  AllObjectiveTask,
  QuestContentType,
  ZodQuestType,
} from "@/validators/objectives";
import type { PetTask } from "@/validators/petTasks";
import type { RewardChoiceCard } from "@/validators/rewards";

/** Build the `quest` listing for `GET`, using predicates on `questType`, `content`, `hidden`. */
export const listQuestForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.quest.findMany({
    where: and(
      eq(quest.questType, "daily"),
      isNotNull(quest.content),
      eq(quest.hidden, false),
    ),
  });

/** Build the `userData` selection for `GET`, using predicates on `isAi` and `updatedAt`. */
export const selectUserDataForGET = (
  client: Pick<DrizzleClient, "select">,
  activeSince: Date,
) =>
  client
    .select({
      rank: userData.rank,
      villageId: userData.villageId,
      level: userData.level,
      count: sql`count(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .where(and(eq(userData.isAi, false), gte(userData.updatedAt, activeSince)))
    .groupBy(userData.rank, userData.villageId, userData.level);

/**
 * Build the `questHistory` update for `GET`, setting `completed` and `endAt`, using
 * predicates on `questType`, `completed`, `endAt`.
 */
export const updateQuestHistoryForGET = (client: Pick<DrizzleClient, "update">) =>
  client
    .update(questHistory)
    .set({ completed: 0, endAt: new Date() })
    .where(
      and(
        eq(questHistory.questType, "daily"),
        eq(questHistory.completed, 0),
        isNull(questHistory.endAt),
      ),
    );

/**
 * Fetch a quest by id
 * @param client - The database client
 * @param id - The id of the quest
 * @returns The quest
 */
export const fetchQuest = async (client: DrizzleClient, id: string) => {
  return await client.query.quest.findFirst({
    where: eq(quest.id, id),
  });
};

/**
 * Role of the (possibly signed-out) caller of a public content-browsing endpoint. Defaults to
 * "USER" so an unauthenticated visitor is redacted exactly like an ordinary player.
 */
export const fetchViewerRole = async (
  client: DrizzleClient,
  userId: string | null | undefined,
) => {
  if (!userId) return "USER" as UserRole;
  const viewer = await client.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, userId),
  });
  return viewer?.role ?? ("USER" as UserRole);
};

/**
 * Find quests whose objectives start `questId` through a new_quest consequence. Retyping a
 * referenced quest to an NPC-only or item-only type would strand the referring chain,
 * so the update endpoint rejects the retype until the reference is removed.
 */
export const fetchQuestsStartingQuest = async (
  client: DrizzleClient,
  questId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].newQuestIds[*]'), JSON_QUOTE(${questId})) = 1`,
  });

/** Resolve quests referenced by new_quest objectives whose acquisition flow cannot be bypassed. */
export const fetchRestrictedNewQuestTargets = async (
  client: DrizzleClient,
  objectives: AllObjectivesType[],
) => {
  const targetIds = [
    ...new Set(
      objectives.flatMap((objective) =>
        objective.task === "new_quest" && "newQuestIds" in objective
          ? objective.newQuestIds
          : [],
      ),
    ),
  ];
  if (targetIds.length === 0) return [];
  return client.query.quest.findMany({
    columns: { id: true, name: true },
    where: and(
      inArray(quest.id, targetIds),
      inArray(quest.questType, [...NPC_ONLY_QUEST_TYPES, "special"]),
    ),
  });
};

/** Load one account's quest tracker for a quest ID. */
export const fetchUserQuestByQuestId = async (
  client: DrizzleClient,
  userId: string,
  questId: string,
) => {
  return await client.query.questHistory.findFirst({
    where: and(eq(questHistory.userId, userId), eq(questHistory.questId, questId)),
  });
};

/**
 * Returns the DB state of every overworld placement referenced by the user's active objectives.
 * Each map value is `true` for an active placement and `false` for a deactivated placement; a
 * referenced id absent from the map was deleted. Callers pass the map to `getNewTrackers`.
 * Cheap-path: if no active objectives carry a bound placement id the DB is not
 * queried and an empty map is returned.
 */
export const fetchBoundPlacementStatus = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
): Promise<Map<string, boolean>> => {
  // Collect distinct placement ids referenced by the user's active objectives.
  const boundIds = new Set<string>();
  for (const q of getUserQuests(user)) {
    for (const obj of q.content.objectives) {
      if (obj.overworldPlacementId && isSupportedOverworldBindingTask(obj.task)) {
        boundIds.add(obj.overworldPlacementId);
      }
    }
  }

  // Cheap-path: no bound objectives → nothing to verify.
  if (boundIds.size === 0) return new Map();

  // One query with NO isActive filter so we can distinguish deleted vs deactivated.
  const rows = await client.query.overworldAiPlacement.findMany({
    where: inArray(overworldAiPlacement.id, [...boundIds]),
    columns: { id: true, isActive: true },
  });

  return new Map(rows.map((row) => [row.id, row.isActive]));
};

/**
 * Which of the offered jutsus, bloodlines, badges and sage modes the player already holds, using
 * the same ownership tables `updateRewards` checks before granting them. Package children
 * participate in those queries; stored mastery ranks supply promotion eligibility.
 */
export const fetchRewardChoiceOwnership = async (
  client: DrizzleClient,
  user: Pick<UserData, "userId" | "sageModeId" | "masteryRanks">,
  cards: RewardChoiceCard[],
): Promise<RewardChoiceOwnership> => {
  const expandedCards = cards.flatMap((card) =>
    card.rewards ? buildRewardChoiceCards(card.rewards) : [card],
  );
  const idsFor = (field: RewardChoiceCard["field"]) => [
    ...new Set(
      expandedCards.flatMap((card) =>
        card.field === field && card.contentId ? [card.contentId] : [],
      ),
    ),
  ];
  const jutsuIds = idsFor("reward_jutsus");
  const bloodlineIds = idsFor("reward_bloodlines");
  const badgeIds = idsFor("reward_badges");
  const titleIds = idsFor("reward_titles");
  const sageModeIds = idsFor("reward_sage_modes");
  const [jutsus, bloodlines, badges, sageModes, ownedTitles, availableTitles] =
    await Promise.all([
      jutsuIds.length > 0
        ? client
            .select({ id: userJutsu.jutsuId })
            .from(userJutsu)
            .where(
              and(
                eq(userJutsu.userId, user.userId),
                inArray(userJutsu.jutsuId, jutsuIds),
              ),
            )
        : [],
      bloodlineIds.length > 0
        ? client
            .select({ id: bloodlineRolls.bloodlineId })
            .from(bloodlineRolls)
            .where(
              and(
                eq(bloodlineRolls.userId, user.userId),
                inArray(bloodlineRolls.bloodlineId, bloodlineIds),
              ),
            )
        : [],
      badgeIds.length > 0
        ? client
            .select({ id: userBadge.badgeId })
            .from(userBadge)
            .where(
              and(
                eq(userBadge.userId, user.userId),
                inArray(userBadge.badgeId, badgeIds),
              ),
            )
        : [],
      sageModeIds.length > 0 && !user.sageModeId
        ? client
            .select({ id: sageModeRolls.sageModeId })
            .from(sageModeRolls)
            .where(
              and(
                eq(sageModeRolls.userId, user.userId),
                inArray(sageModeRolls.sageModeId, sageModeIds),
              ),
            )
        : [],
      titleIds.length
        ? client
            .select({ id: userTitle.titleId })
            .from(userTitle)
            .where(
              and(
                eq(userTitle.userId, user.userId),
                inArray(userTitle.titleId, titleIds),
              ),
            )
        : [],
      titleIds.length
        ? client
            .select({ id: title.id })
            .from(title)
            .where(
              and(
                inArray(title.id, titleIds),
                isNull(title.legacyOwnerId),
                eq(title.archived, false),
              ),
            )
        : [],
    ]);
  const toSet = (rows: { id: string | null }[]) =>
    new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  return {
    jutsuIds: toSet(jutsus),
    bloodlineIds: toSet(bloodlines),
    badgeIds: toSet(badges),
    titleIds: toSet(ownedTitles),
    unavailableTitleIds: new Set(
      titleIds.filter((id) => !availableTitles.some((entry) => entry.id === id)),
    ),
    sageModeIds: toSet(sageModes),
    hasSageMode: !!user.sageModeId,
    masteryRanks: user.masteryRanks,
  };
};

/** List quest names and types in name order; callers apply visibility and assignment rules. */
export const listQuestForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.quest.findMany({
    columns: { id: true, name: true, questType: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `quest` listing for `getAll`, including predicates on `name`, `content`, `questType`. */
export const listQuestForGetAll = (
  client: Pick<DrizzleClient, "query">,
  input: {
    name?: undefined | string;
    objectives?: undefined | AllObjectiveTask[];
    questType?: QuestType | undefined;
    rank?: LetterRank | undefined;
    village?: undefined | string;
    bloodline?: undefined | string;
    sageMode?: undefined | string;
    userLevel?: undefined | number;
    hidden?: undefined | false | true;
    limit: number;
  },
  skip: number,
) =>
  client.query.quest.findMany({
    with: { village: true },
    where: and(
      ...(input?.name ? [like(quest.name, `%${input.name}%`)] : []),
      ...(input?.objectives && input.objectives.length > 0
        ? [
            or(
              ...input.objectives.map(
                (e) => sql`JSON_SEARCH(${quest.content},'one',${e}) IS NOT NULL`,
              ),
            ),
          ]
        : []),
      ...(input?.questType ? [eq(quest.questType, input.questType)] : []),
      ...(input?.rank ? [eq(quest.questRank, input.rank)] : []),
      ...(input?.village ? [eq(quest.requiredVillage, input.village)] : []),
      ...(input?.bloodline ? [eq(quest.requiredBloodlineId, input.bloodline)] : []),
      ...(input?.sageMode ? [eq(quest.requiredSageModeId, input.sageMode)] : []),
      ...(input?.userLevel ? [...questLevelFilters(input.userLevel)] : []),
      ...(input?.hidden !== undefined ? [eq(quest.hidden, !!input.hidden)] : []),
    ),
    offset: skip,
    limit: input.limit,
    ...(input?.questType === "tier" ? { orderBy: asc(quest.tierLevel) } : {}),
  });

/** Build the `userData` lookup for `get`, using predicates on `userId`. */
export const findUserDataForGet = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: null | string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId ?? ""),
  });

/**
 * Build the `userItem` listing for `specificQuests`, selecting row fields `itemId` and
 * `quantity`, including predicates on `userId`, `storedAtHome`, `isInAuction`.
 */
export const listUserItemForSpecificQuests = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, ctx.userId),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, new Date()),
      ),
      gt(userItem.quantity, 0),
    ),
    columns: { itemId: true, quantity: true },
    with: { item: { columns: { name: true } } },
  });

/** Build the `quest` selection for `startRandom`, including predicates on `questType`, `questRank`, `startsAt`. */
export const selectQuestForStartRandom = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: {
    type: "medical" | "pvp" | "mission" | "errand" | "crime";
    rank: import("@/drizzle/schema").BloodlineRank;
    userLevel: number;
    userVillageId?: undefined | null | string;
  },
) =>
  client
    .select({
      ...getTableColumns(quest),
      previousAttempts: questHistory.previousAttempts,
      completed: questHistory.completed,
      periodCompletes: questHistory.periodCompletes,
      periodStartAt: questHistory.periodStartAt,
      // Extra history columns, aliased so they do NOT feed isAvailableUserQuests's flat
      // reads (esp. `previousCompletes`, which would change mission-hall availability).
      // Used only to reconstruct a prevEntry for upsertQuestEntry below, so it skips its
      // internal questHistory.findFirst on every random mission start.
      questHistoryId: questHistory.id,
      historyPreviousCompletes: questHistory.previousCompletes,
      historyStartedAt: questHistory.startedAt,
      historyEndAt: questHistory.endAt,
      historyPendingRewardChoice: questHistory.pendingRewardChoice,
      historyEntryPaid: questHistory.entryPaid,
      historyIsolated: questHistory.isolated,
      historyQuestVersion: questHistory.questVersion,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, ctx.userId)),
    )
    .where(
      and(
        eq(quest.questType, input.type),
        eq(quest.questRank, input.rank),
        ...questLevelFilters(input.userLevel),
        or(isNull(quest.startsAt), lte(quest.startsAt, new Date().toISOString())),
        or(isNull(quest.endsAt), gte(quest.endsAt, new Date().toISOString())),
        or(
          isNull(quest.requiredVillage),
          eq(quest.requiredVillage, input.userVillageId ?? VILLAGE_SYNDICATE_ID),
        ),
      ),
    );

/** Execute the database statement for `abandon`. */
export const executeResultForAbandon = (
  client: Pick<DrizzleClient, "execute">,
  user: Parameters<typeof userRegenerationGainSql>[0] &
    Pick<UserData, "updatedAt" | "maxEnergy">,
  now: Date,
  questData: import("@/validators/objectives").QuestTrackerType[],
  input: { id: string },
  ctx: { userId: string },
  current: { id: string },
) =>
  client.execute(sql`
            UPDATE ${userData}
            INNER JOIN ${questHistory}
              ON ${questHistory.userId} = ${userData.userId}
            SET ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
                ${userData.questFinishAt} = ${now},
                ${userData.questData} = CAST(${JSON.stringify(questData)} AS JSON),
                ${userData.curEnergy} = IF(${questHistory.isolated}, LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${userRegenerationGainSql(user, userData.regenAt, now)}), ${userData.curEnergy}),
                ${userData.regenAt} = IF(${questHistory.isolated}, ${now}, ${userData.regenAt}),
                ${userData.status} = IF(${questHistory.isolated}, 'AWAKE', ${userData.status}),
                ${userData.activeNpcQuestId} = IF(${userData.activeNpcQuestId} = ${input.id}, NULL, ${userData.activeNpcQuestId}),
                ${questHistory.completed} = 0,
                ${questHistory.endAt} = ${now}
            WHERE ${userData.userId} = ${ctx.userId}
              AND ${userData.updatedAt} = ${user.updatedAt}
              AND (${userData.status} <> 'BATTLE' OR (${questHistory.isolated} = TRUE AND ${userData.battleId} IS NULL))
              AND ${questHistory.id} = ${current.id}
              AND ${questHistory.endAt} IS NULL
              AND ${questHistory.completed} = 0
          `);

/**
 * Build the `questHistory` update for `abandon`, setting `completed` and `endAt`,
 * using predicates on `id`, `endAt`, `completed`.
 */
export const updateQuestHistoryForAbandon = (
  client: Pick<DrizzleClient, "update">,
  current: { id: string },
) =>
  client
    .update(questHistory)
    .set({ completed: 0, endAt: new Date() })
    .where(
      and(
        eq(questHistory.id, current.id),
        isNull(questHistory.endAt),
        eq(questHistory.completed, 0),
      ),
    );

/** Build the `userData` update for `abandon`, using predicates on `userId`. */
export const updateUserDataForAbandon = (
  client: Pick<DrizzleClient, "update">,
  questData: import("@/validators/objectives").QuestTrackerType[],
  input: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      questFinishAt: new Date(),
      questData,
      activeNpcQuestId: sql`IF(${userData.activeNpcQuestId} = ${input.id}, NULL, ${userData.activeNpcQuestId})`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `questHistory` listing for `getQuestHistory`, using predicates on `userId`. */
export const listQuestHistoryForGetQuestHistory = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  skip: number,
  input: { limit: number },
) =>
  client.query.questHistory.findMany({
    where: eq(questHistory.userId, ctx.userId),
    with: {
      quest: true,
    },
    offset: skip,
    limit: input.limit,
  });

/** Build the `quest` selection for `update`, using predicates on `questType`. */
export const selectQuestForUpdate = (client: Pick<DrizzleClient, "select">) =>
  client.select().from(quest).where(eq(quest.questType, "tier"));

/** Build the `rewardPackage` listing for `update`. */
export const listRewardPackageForUpdate = (client: Pick<DrizzleClient, "query">) =>
  client.query.rewardPackage.findMany();

/** Execute the database statement for `update`. */
export const executeDefinitionWriteForUpdate = (
  client: Pick<DrizzleClient, "execute">,
  entry: { updatedAt: Date; id: string },
  input: { data: Pick<ZodQuestType, "hidden" | "publicLocations" | "content"> },
  updatedAt: Date,
) =>
  client.execute(sql`
                UPDATE ${quest}
                LEFT JOIN ${questHistory}
                  ON ${questHistory.questId} = ${quest.id}
                  AND ${questHistory.questVersion} = ${entry.updatedAt}
                SET ${quest.hidden} = ${input.data.hidden},
                    ${quest.publicLocations} = ${input.data.publicLocations},
                    ${quest.content} = ${JSON.stringify(input.data.content)},
                    ${quest.updatedAt} = ${updatedAt},
                    ${questHistory.questVersion} = ${updatedAt}
                WHERE ${quest.id} = ${entry.id}
                  AND ${quest.updatedAt} = ${entry.updatedAt}
              `);

/** Update a content revision; restoring a defeated open raid advances its server-owned activation time. */
export const updateQuestForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/objectives").ZodQuestType },
  updatedAt: Date,
  entry: Pick<Quest, "id" | "updatedAt" | "raidBossCurrentHealth">,
) => {
  const restoresOpenRaid =
    input.data.questType === "raid" &&
    input.data.content.objectives[0]?.task === "open_raid" &&
    (input.data.raidBossCurrentHealth ?? 0) > 0;
  return client
    .update(quest)
    .set({
      ...input.data,
      updatedAt,
      ...(restoresOpenRaid &&
      entry.raidBossCurrentHealth !== null &&
      entry.raidBossCurrentHealth <= 0
        ? { raidStartedAt: updatedAt }
        : {}),
    })
    .where(
      and(
        eq(quest.id, entry.id),
        eq(quest.updatedAt, entry.updatedAt),
        // Combat changes HP without changing the content revision. Pin the restart decision.
        restoresOpenRaid
          ? sql`${quest.raidBossCurrentHealth} <=> ${entry.raidBossCurrentHealth}`
          : undefined,
      ),
    );
};

/** Build the `questHistory` update for `update`, setting `endAt`, using predicates on `questId`, `completed`, `endAt`. */
export const updateQuestHistoryForUpdate = (
  client: Pick<DrizzleClient, "update">,
  entry: { id: string },
) =>
  client
    .update(questHistory)
    .set({ endAt: new Date() })
    .where(
      and(
        eq(questHistory.questId, entry.id),
        eq(questHistory.completed, 0),
        isNull(questHistory.endAt),
      ),
    );

/** Build the `questHistory` update for `update`, setting `questType`, using predicates on `questId`. */
export const updateQuestHistoryForUpdate2 = (
  client: Pick<DrizzleClient, "update">,
  input: {
    data: {
      questType: QuestType;
    };
  },
  entry: {
    questType: QuestType;
    id: string;
  },
  updatedAt: Date,
) =>
  client
    .update(questHistory)
    .set({
      questType: input.data.questType,
      ...(entry.questType === "battlepyramid" &&
      input.data.questType !== "battlepyramid"
        ? {
            // Retire open runs without rewriting completed or abandoned history.
            endAt: sql`IF(${questHistory.endAt} IS NULL AND ${questHistory.completed} = 0, ${updatedAt}, ${questHistory.endAt})`,
          }
        : {}),
    })
    .where(eq(questHistory.questId, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "quest",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `quest` insert for `create`. */
export const insertQuestForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(quest).values({
    id: id,
    name: `New Quest - ${id}`,
    image: IMG_AVATAR_DEFAULT,
    description: "",
    questType: "mission",
    medicalRank: "NONE",
    huntingRank: "NONE",
    gatheringRank: "NONE",
    hidden: true,
    prerequisiteQuestId: "",
    content: {
      sceneBackground: "",
      sceneCharacters: [],
      objectives: [],
      reward: {
        reward_medical_experience: 0,
        reward_hunting_experience: 0,
        reward_crafting_experience: 0,
        reward_gathering_experience: 0,
        reward_sage_mastery_experience: 0,
        reward_seichi_silver: 0,
        reward_money: 0,
        reward_clanpoints: 0,
        reward_anbupoints: 0,
        reward_exp: 0,
        reward_tokens: 0,
        reward_prestige: 0,
        reward_reputation: 0,
        reward_skillpoints: 0,
        reward_jutsus: [],
        reward_bloodlines: [],
        reward_sage_modes: [],
        reward_badges: [],
        reward_titles: [],
        reward_items: [],
        reward_rank: "NONE",
        reward_village_membership: "NONE",
        reward_hunter_items: false,
        reward_gathering_items: false,
        reward_hunter_items_ids: [],
        reward_gathering_items_ids: [],
        reward_war_damage: 0,
        reward_war_healing: 0,
      },
    },
  });

/** Build the `quest` insert for `clone`. */
export const insertQuestForClone = (
  client: Pick<DrizzleClient, "insert">,
  questData: import("@/drizzle/schema").Quest,
) => client.insert(quest).values(questData);

/** Build the `quest` deletion for `delete`, using predicates on `id`. */
export const deleteQuestForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(quest).where(eq(quest.id, input.id));

/** Build the `questHistory` deletion for `delete`, using predicates on `questId`. */
export const deleteQuestHistoryForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(questHistory).where(eq(questHistory.questId, input.id));

/** Build the `raidParticipation` deletion for `delete`, using predicates on `questId`. */
export const deleteRaidParticipationForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(raidParticipation).where(eq(raidParticipation.questId, input.id));

/** Build the `raidDamageThreshold` deletion for `delete`, using predicates on `questId`. */
export const deleteRaidDamageThresholdForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) =>
  client.delete(raidDamageThreshold).where(eq(raidDamageThreshold.questId, input.id));

/** Build the `userRaidBuff` deletion for `delete`, using predicates on `questId`. */
export const deleteUserRaidBuffForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userRaidBuff).where(eq(userRaidBuff.questId, input.id));

/** Build the `overworldAiPlacementQuest` deletion for `delete`, using predicates on `questId`. */
export const deleteOverworldAiPlacementQuestForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) =>
  client
    .delete(overworldAiPlacementQuest)
    .where(eq(overworldAiPlacementQuest.questId, input.id));

/** Build the `userQuestAttempt` deletion for `delete`, using predicates on `questId`. */
export const deleteUserQuestAttemptForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userQuestAttempt).where(eq(userQuestAttempt.questId, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "quest",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `userData` lookup for `getPetTask`, using predicates on `userId`. */
export const findUserDataForGetPetTask = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    with: { pets: true },
  });

/** Build the `questHistory` lookup for `collectPetTask`, using predicates on `id` and `userId`. */
export const findQuestHistoryForCollectPetTask = (
  client: Pick<DrizzleClient, "query">,
  input: { questHistoryId: string },
  ctx: { userId: string },
) =>
  client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.id, input.questHistoryId),
      eq(questHistory.userId, ctx.userId),
    ),
    with: { quest: true },
  });

/** Execute the database statement for `cancelPetTask`. */
export const executeCancelledForCancelPetTask = (
  client: Pick<DrizzleClient, "execute">,
  task: import("@/validators/petTasks").PetTask,
  owner: { updatedAt: Date },
  now: Date,
  ctx: { userId: string },
) =>
  client.execute(sql`
        UPDATE ${userData}
        LEFT JOIN ${questHistory} ON ${questHistory.userId} = ${userData.userId}
          AND ${questHistory.id} = ${task.questHistoryId}
          AND ${questHistory.questId} = ${task.questId}
          AND ${questHistory.startedAt} = ${new Date(task.startedAt)}
          AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL
        SET ${userData.petTask} = NULL,
            ${userData.updatedAt} = ${getNextUserSnapshotAt(owner.updatedAt, now)},
            ${questHistory.endAt} = ${now}
        WHERE ${userData.userId} = ${ctx.userId}
          AND ${userData.updatedAt} = ${owner.updatedAt}
          AND ${petTaskReceiptCondition(task)}
      `);

/** Build the `questHistory` lookup for `checkRewards`, using predicates on `questId` and `userId`. */
export const findQuestHistoryForCheckRewards = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string },
  ctx: { userId: string },
) =>
  client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.questId, input.questId),
      eq(questHistory.userId, ctx.userId),
    ),
    // Hidden attempts are omitted from profile hydration; retain rejection metadata
    // in this already-parallel history read without loading the definition content.
    with: { quest: { columns: { hidden: true, updatedAt: true } } },
  });

/** Build the `userData` lookup for `getPendingRewardChoices`, using predicates on `userId`. */
export const findUserDataForGetPendingRewardChoices = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { userId: true, sageModeId: true, masteryRanks: true },
    where: eq(userData.userId, ctx.userId),
  });

/**
 * Build the `questHistory` listing for `getPendingRewardChoices`, selecting row fields
 * `questId` and `pendingRewardChoice`, using predicates on `userId` and
 * `pendingRewardChoice`.
 */
export const listQuestHistoryForGetPendingRewardChoices = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questHistory.findMany({
    columns: { questId: true, pendingRewardChoice: true },
    where: and(
      eq(questHistory.userId, ctx.userId),
      isNotNull(questHistory.pendingRewardChoice),
    ),
    with: { quest: { columns: { name: true } } },
  });

/**
 * Build the `questHistory` lookup for `claimRewardChoice`, selecting row fields `id`
 * and `pendingRewardChoice`, using predicates on `userId` and `questId`.
 */
export const findQuestHistoryForClaimRewardChoice = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { questId: string },
) =>
  client.query.questHistory.findFirst({
    columns: { id: true, pendingRewardChoice: true },
    where: and(
      eq(questHistory.userId, ctx.userId),
      eq(questHistory.questId, input.questId),
    ),
    with: { quest: { columns: { name: true } } },
  });

/**
 * Build the `questHistory` update for `claimRewardChoice`, setting
 * `pendingRewardChoice`, using predicates on `id`, `userId`, `pendingRewardChoice`.
 */
export const updateQuestHistoryForClaimRewardChoice = (
  client: Pick<DrizzleClient, "update">,
  history: { id: string },
  ctx: { userId: string },
  offer: { data: { id: string } },
) =>
  client
    .update(questHistory)
    .set({ pendingRewardChoice: null })
    .where(
      and(
        eq(questHistory.id, history.id),
        eq(questHistory.userId, ctx.userId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${questHistory.pendingRewardChoice}, '$.id')) = ${offer.data.id}`,
      ),
    );

/**
 * Build the `questHistory` update for `claimRewardChoice`, setting
 * `pendingRewardChoice`, using predicates on `id`, `userId`, `pendingRewardChoice`.
 */
export const updateQuestHistoryForClaimRewardChoice2 = (
  client: Pick<DrizzleClient, "update">,
  offer: { data: import("@/validators/rewards").PendingRewardChoice },
  history: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(questHistory)
    .set({ pendingRewardChoice: offer.data })
    .where(
      and(
        eq(questHistory.id, history.id),
        eq(questHistory.userId, ctx.userId),
        isNull(questHistory.pendingRewardChoice),
      ),
    );

/** Build the `questHistory` listing for `getUserQuests`, using predicates on `userId`. */
export const listQuestHistoryForGetUserQuests = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.questHistory.findMany({
    where: eq(questHistory.userId, input.userId),
    with: { quest: true },
    orderBy: [asc(questHistory.startedAt)],
  });

/** Build the `questHistory` deletion for `deleteUserQuest`, using predicates on `userId` and `questId`. */
export const deleteQuestHistoryForDeleteUserQuest = (
  client: Pick<DrizzleClient, "delete">,
  input: { userId: string; questId: string },
) =>
  client
    .delete(questHistory)
    .where(
      and(
        eq(questHistory.userId, input.userId),
        eq(questHistory.questId, input.questId),
      ),
    );

/** Build a quest tracker update for one user. */
export const updateUserQuestData = (
  client: Pick<DrizzleClient, "update">,
  questData: import("@/validators/objectives").QuestTrackerType[],
  userId: string,
) => client.update(userData).set({ questData }).where(eq(userData.userId, userId));

/** Build the `actionLog` insert for `deleteUserQuest`. */
export const insertActionLogForDeleteUserQuest = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { questId: string; userId: string },
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Deleted quest ${input.questId}`],
    relatedId: input.userId,
    relatedMsg: `Deleted quest ${input.questId}`,
    relatedImage: user.avatarLight,
  });

/** Build the `village` selection for `updateRewards`, using predicates on `name`. */
export const selectVillageForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  rewards: {
    reward_village_membership:
      | "SHIROHANA"
      | "TSUKIMORI"
      | "HYORIN"
      | "AKASUMI"
      | "AKIKAZE";
  },
) =>
  client
    .select({ id: village.id, name: village.name })
    .from(village)
    .where(eq(village.name, rewards.reward_village_membership));

/** Build the `item` selection for `updateRewards`, using predicates on `canBeHunted`. */
export const selectItemForUpdateRewards = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: item.id, name: item.name, rarity: item.rarity })
    .from(item)
    .where(eq(item.canBeHunted, true));

/** Build the `item` selection for `updateRewards`, using predicates on `canBeGathered`. */
export const selectItemForUpdateRewards2 = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: item.id, name: item.name, rarity: item.rarity })
    .from(item)
    .where(eq(item.canBeGathered, true));

/** Build the `item` selection for `updateRewards`, using predicates on `id`. */
export const selectItemForUpdateRewards3 = (
  client: Pick<DrizzleClient, "select">,
  uniqueItemIds: string[],
) =>
  client
    .select({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      canStack: item.canStack,
      stackSize: item.stackSize,
    })
    .from(item)
    .where(inArray(item.id, uniqueItemIds));

/** Build the `jutsu` selection for `updateRewards`, using predicates on `id` and `userId`. */
export const selectJutsuForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  rewards: { reward_jutsus: string[] },
) =>
  client
    .select({ id: jutsu.id, name: jutsu.name })
    .from(jutsu)
    .leftJoin(
      userJutsu,
      and(eq(jutsu.id, userJutsu.jutsuId), eq(userJutsu.userId, user.userId)),
    )
    .where(and(inArray(jutsu.id, rewards.reward_jutsus), isNull(userJutsu.userId)));

/** Build the `bloodline` selection for `updateRewards`, using predicates on `id` and `userId`. */
export const selectBloodlineForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  rewards: { reward_bloodlines: string[] },
) =>
  client
    .select({ id: bloodline.id, name: bloodline.name, rank: bloodline.rank })
    .from(bloodline)
    .leftJoin(
      bloodlineRolls,
      and(
        eq(bloodline.id, bloodlineRolls.bloodlineId),
        eq(bloodlineRolls.userId, user.userId),
      ),
    )
    .where(
      and(
        inArray(bloodline.id, rewards.reward_bloodlines),
        isNull(bloodlineRolls.userId),
      ),
    );

/** Build the `badge` selection for `updateRewards`, using predicates on `id` and `userId`. */
export const selectBadgeForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  rewards: { reward_badges: string[] },
) =>
  client
    .select({ id: badge.id, name: badge.name, image: badge.image })
    .from(badge)
    .leftJoin(
      userBadge,
      and(eq(badge.id, userBadge.badgeId), eq(userBadge.userId, user.userId)),
    )
    .where(and(inArray(badge.id, rewards.reward_badges), isNull(userBadge.userId)));

/** Build the `title` selection for `updateRewards`, including predicates on `id`, `archived`, `legacyOwnerId`. */
export const selectTitleForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  rewards: { reward_titles: string[] },
) =>
  client
    .select({ id: title.id, name: title.name, effects: title.effects })
    .from(title)
    .leftJoin(
      userTitle,
      and(eq(userTitle.titleId, title.id), eq(userTitle.userId, user.userId)),
    )
    .where(
      and(
        inArray(title.id, rewards.reward_titles),
        eq(title.archived, false),
        isNull(title.legacyOwnerId),
        isNull(userTitle.userId),
      ),
    );

/** Build the `sageMode` selection for `updateRewards`, using predicates on `id` and `userId`. */
export const selectSageModeForUpdateRewards = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  rewards: { reward_sage_modes: string[] },
) =>
  client
    .select({ id: sageMode.id, name: sageMode.name })
    .from(sageMode)
    .leftJoin(
      sageModeRolls,
      and(
        eq(sageMode.id, sageModeRolls.sageModeId),
        eq(sageModeRolls.userId, user.userId),
      ),
    )
    .where(
      and(
        inArray(sageMode.id, rewards.reward_sage_modes),
        isNull(sageModeRolls.userId),
      ),
    );

/** Build the `userData` update for `updateRewards`, using predicates on `userId`. */
export const updateUserDataForUpdateRewards = (
  client: Pick<DrizzleClient, "update">,
  updatedUserData: Record<string, unknown>,
  user: { userId: string },
) =>
  client.update(userData).set(updatedUserData).where(eq(userData.userId, user.userId));

/** Read the capped balance after the separate reward payout has committed. */
export const findQuestRewardSkillPoints = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: { skillPoints: true },
    where: eq(userData.userId, userId),
  });

/** Build the `recruitmentRewards` insert for `updateRewards`. */
export const insertRecruitmentRewardsForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  user: { recruiterId: string; userId: string },
  prestigeReward: number,
) =>
  client.insert(recruitmentRewards).values({
    id: nanoid(),
    userId: user.recruiterId,
    recruitedUserId: user.userId,
    amount: prestigeReward,
    type: "PRESTIGE",
  });

/** Build the `userRewards` insert for `updateRewards`. */
export const insertUserRewardsForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  rewards: { reward_reputation: number },
  reason: string,
) =>
  client.insert(userRewards).values({
    id: nanoid(),
    awardedById: user.userId,
    receiverId: user.userId,
    reputationAmount: rewards.reward_reputation,
    reason: reason,
  });

/** Build the `clan` update for `updateRewards`, setting `points` and `activityPoints`, using predicates on `id`. */
export const updateClanForUpdateRewards = (
  client: Pick<DrizzleClient, "update">,
  rewards: { reward_clanpoints: number },
  user: { clanId: string },
) =>
  client
    .update(clan)
    .set({
      points: sql`${clan.points} + ${rewards.reward_clanpoints}`,
      activityPoints: sql`${clan.activityPoints} + ${rewards.reward_clanpoints}`,
    })
    .where(eq(clan.id, user.clanId));

/** Build the `userJutsu` insert for `updateRewards`, updating duplicate keys. */
export const insertUserJutsuForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  jutsus: never[] | Pick<import("@/drizzle/schema").GameAsset, "id" | "name">[],
  user: { userId: string },
) =>
  client
    .insert(userJutsu)
    .values(
      jutsus.map(({ id }) => ({
        id: nanoid(),
        userId: user.userId,
        jutsuId: id,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `bloodlineRolls` insert for `updateRewards`. */
export const insertBloodlineRollsForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  bloodlines:
    | never[]
    | Pick<import("@/drizzle/schema").Bloodline, "id" | "name" | "rank">[],
  user: { userId: string },
) =>
  client.insert(bloodlineRolls).values(
    bloodlines.map(
      ({ id, rank }) =>
        ({
          id: nanoid(),
          userId: user.userId,
          type: "QUEST",
          bloodlineId: id,
          goal: rank,
          used: 1,
          pityRolls: 0,
        }) as const,
    ),
  );

/** Build the `sageModeRolls` insert for `updateRewards`. */
export const insertSageModeRollsForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  rolledSageMode: { id: string },
) =>
  client.insert(sageModeRolls).values({
    id: nanoid(),
    userId: user.userId,
    type: "QUEST",
    sageModeId: rolledSageMode.id,
  });

/** Build the `userItem` insert for `updateRewards`. */
export const insertUserItemForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  itemsToInsert: { id: string; name: string; quantity: number }[],
  user: { userId: string },
) =>
  client.insert(userItem).values(
    itemsToInsert.map(({ id, quantity }) => ({
      id: nanoid(),
      userId: user.userId,
      itemId: id,
      quantity: quantity,
    })),
  );

/** Build the `userBadge` insert for `updateRewards`. */
export const insertUserBadgeForUpdateRewards = (
  client: Pick<DrizzleClient, "insert">,
  badges:
    | never[]
    | Pick<import("@/drizzle/schema").GameAsset, "id" | "name" | "image">[],
  user: { userId: string },
) =>
  client.insert(userBadge).values(
    badges.map(({ id }) => ({
      id: nanoid(),
      userId: user.userId,
      badgeId: id,
    })),
  );

/** Build the `war` update for `updateRewards`, setting `defenderWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateRewards = (
  client: Pick<DrizzleClient, "update">,
  rewards: { reward_war_damage: number },
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      defenderWarHealth: sql`GREATEST(defenderWarHealth - ${rewards.reward_war_damage}, 0)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `war` update for `updateRewards`, setting `attackerWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateRewards2 = (
  client: Pick<DrizzleClient, "update">,
  rewards: { reward_war_damage: number },
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`GREATEST(attackerWarHealth - ${rewards.reward_war_damage}, 0)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `war` update for `updateRewards`, setting `attackerWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateRewards3 = (
  client: Pick<DrizzleClient, "update">,
  rewards: { reward_war_healing: number },
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      attackerWarHealth: sql`LEAST(attackerWarHealth + ${rewards.reward_war_healing}, attackerWarHealthMax)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt), warRaidCombatGuard()));

/** Build the `war` update for `updateRewards`, setting `defenderWarHealth`, using predicates on `id` and `endedAt`. */
export const updateWarForUpdateRewards4 = (
  client: Pick<DrizzleClient, "update">,
  rewards: { reward_war_healing: number },
  activeWar: { id: string },
) =>
  client
    .update(war)
    .set({
      defenderWarHealth: sql`LEAST(defenderWarHealth + ${rewards.reward_war_healing}, defenderWarHealthMax)`,
    })
    .where(and(eq(war.id, activeWar.id), isNull(war.endedAt), warRaidCombatGuard()));

/**
 * Build the `quest` selection for `fetchUncompletedQuests`, including predicates on
 * `questType`, `requiredFarmingLevel`, `startsAt`.
 */
export const selectQuestForFetchUncompletedQuests = (
  client: Pick<DrizzleClient, "select">,
  user: import("@/drizzle/schema").UserData,
  type: QuestType,
  now: string,
  availableLetters: import("@/drizzle/schema").BloodlineRank[],
) =>
  client
    .select()
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, user.userId)),
    )
    .where(
      and(
        eq(quest.questType, type),
        ...questLevelFilters(user.level),
        ...(type === "daily"
          ? []
          : [lte(quest.requiredFarmingLevel, getFarmingLevel(user.farmingExperience))]),
        or(isNull(quest.startsAt), lte(quest.startsAt, now)),
        or(isNull(quest.endsAt), gte(quest.endsAt, now)),
        ...(availableLetters.length > 0
          ? [inArray(quest.questRank, availableLetters)]
          : [eq(quest.questRank, "D")]),
        isNull(questHistory.completed),
        or(
          isNull(quest.requiredVillage),
          eq(quest.requiredVillage, user.villageId ?? ""),
        ),
        or(
          isNull(quest.requiredBloodlineId),
          eq(quest.requiredBloodlineId, user.bloodlineId ?? ""),
        ),
        ...sageQuestFilters(user),
      ),
    )
    .orderBy((table) => [asc(table.Quest.requiredLevel), asc(table.Quest.tierLevel)]);

/** Build the `userData` selection for `upsertQuestEntries`, using the configured predicates. */
export const selectUserDataForUpsertQuestEntries = (
  client: Pick<DrizzleClient, "select">,
  quest: { id: string },
  updateSelector: import("@/utils/typeutils").QueryCondition,
) =>
  client
    .select({ userId: userData.userId, historyId: questHistory.id })
    .from(userData)
    .leftJoin(
      questHistory,
      and(eq(questHistory.userId, userData.userId), eq(questHistory.questId, quest.id)),
    )
    .where(updateSelector);

/** Build the `questHistory` insert for `upsertQuestEntries`, updating duplicate keys. */
export const insertQuestHistoryForUpsertQuestEntries = (
  client: Pick<DrizzleClient, "insert">,
  missingHistory: { userId: string; historyId: null | string }[],
  quest: {
    id: string;
    questType: QuestType;
  },
) =>
  client
    .insert(questHistory)
    .values(
      missingHistory.map((row) => ({
        id: nanoid(),
        userId: row.userId,
        questId: quest.id,
        questType: quest.questType,
      })),
    )
    .onDuplicateKeyUpdate({
      set: { completed: 0, endAt: null, startedAt: new Date() },
    });

/** Build the `userData` update for `upsertQuestEntries`, setting `questData`, using predicates on `userId`. */
export const updateUserDataForUpsertQuestEntries = (
  client: Pick<DrizzleClient, "update">,
  trackerPath: SQL<unknown>,
  batchUserIds: string[],
) =>
  client
    .update(userData)
    .set({
      questData: sql`JSON_REMOVE(
                ${userData.questData},
                TRIM(TRAILING '.id' FROM ${trackerPath})
              )`,
    })
    .where(
      and(inArray(userData.userId, batchUserIds), sql`${trackerPath} IS NOT NULL`),
    );

/** Build the `questHistory` update for `upsertQuestEntries`, using predicates on `userId` and `questId`. */
export const updateQuestHistoryForUpsertQuestEntries = (
  client: Pick<DrizzleClient, "update">,
  startedAt: Date,
  batchUserIds: string[],
  questId: string,
) =>
  client
    .update(questHistory)
    .set({ completed: 0, endAt: null, startedAt })
    .where(
      and(
        inArray(questHistory.userId, batchUserIds),
        eq(questHistory.questId, questId),
      ),
    );

/** Build the `userData` update for `claimDailyQuestSlot`, setting `field`, using predicates on `userId`. */
export const updateUserDataForClaimDailyQuestSlot = (
  client: Pick<DrizzleClient, "update">,
  field:
    | "dailyMissions"
    | "dailyErrands"
    | "dailyMedicalMissions"
    | "dailyPvpMissions"
    | "dailyWarMissions",
  counter:
    | typeof import("@/drizzle/schema").userData["dailyMissions"]
    | typeof import("@/drizzle/schema").userData["dailyErrands"]
    | typeof import("@/drizzle/schema").userData["dailyMedicalMissions"]
    | typeof import("@/drizzle/schema").userData["dailyPvpMissions"]
    | typeof import("@/drizzle/schema").userData["dailyWarMissions"],
  questType: string,
  user: { userId: string },
  quota: { limit: number },
) =>
  client
    .update(userData)
    .set({
      [field]: sql`${counter} + 1`,
      ...(questType === "war"
        ? {
            warParticipantUntil: extendWarParticipantSql(),
            bracketImmunityLiftedUntil: liftBracketImmunitySql(),
            immunityUntil: new Date(0),
          }
        : {}),
    })
    .where(and(eq(userData.userId, user.userId), lt(counter, quota.limit)));

/**
 * Build the `overworldAiPlacementQuest` lookup for `assignQuestToUser`, selecting only
 * `questId`, using predicates on `placementId` and `questId`.
 */
export const findOverworldAiPlacementQuestForAssignQuestToUser = (
  client: Pick<DrizzleClient, "query">,
  overworldPlacementId: string,
  questData: { id: string },
) =>
  client.query.overworldAiPlacementQuest.findFirst({
    columns: { questId: true },
    where: and(
      eq(overworldAiPlacementQuest.placementId, overworldPlacementId),
      eq(overworldAiPlacementQuest.questId, questData.id),
    ),
  });

/** Build the `item` listing for `assignQuestToUser`, selecting only `id` and `name`, using predicates on `id`. */
export const listItemForAssignQuestToUser = (
  client: Pick<DrizzleClient, "query">,
  entryRequirements: Pick<
    import("@/drizzle/schema").ItemPurchaseCounter,
    "quantity" | "itemId"
  >[],
) =>
  client.query.item.findMany({
    columns: { id: true, name: true },
    where: inArray(
      item.id,
      entryRequirements.map((required) => required.itemId),
    ),
  });

/** Build the `questHistory` selection for `where`, including predicates on `userId`, `questType`, `endAt`. */
export const selectQuestHistoryForWhere = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
) =>
  client
    .select({ one: sql`1` })
    .from(questHistory)
    .where(
      and(
        eq(questHistory.userId, user.userId),
        eq(questHistory.questType, "battlepyramid"),
        isNull(questHistory.endAt),
        eq(questHistory.completed, 0),
      ),
    );

/** Build the `questHistory` lookup for `upsertQuestEntry`, using predicates on `questId`, `id`, `userId`. */
export const findQuestHistoryForUpsertQuestEntry = (
  client: Pick<DrizzleClient, "query">,
  quest: { id: string },
  user: { userId: string },
) =>
  client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.questId, quest.id),
      eq(questHistory.userId, user.userId),
    ),
  });

/** Build the `questHistory` update for `upsertQuestEntry`, using predicates on `id`. */
export const updateQuestHistoryForUpsertQuestEntry = (
  client: Pick<DrizzleClient, "update">,
  startedAt: Date,
  isOpenAttempt: false | true,
  quest: { content: { isolated?: undefined | false | true }; updatedAt: Date },
  entry: { id: string },
  professionContract: false | true,
  noDelegatedAttempt: SQL<unknown>,
) =>
  client
    .update(questHistory)
    .set({
      startedAt,
      endAt: null,
      completed: 0,
      // Atomic increment so a concurrent restart of the same row can't lose a count to a
      // stale JS-side base; matches the insert branch's onDuplicateKeyUpdate below.
      previousAttempts: sql`${questHistory.previousAttempts} + 1`,
      ...(!isOpenAttempt
        ? {
            entryPaid: false,
            isolated: quest.content.isolated ?? false,
            questVersion: quest.updatedAt,
          }
        : {}),
    })
    .where(
      and(
        eq(questHistory.id, entry.id),
        professionContract ? noDelegatedAttempt : undefined,
      ),
    );

/** Build the `questHistory` insert for `upsertQuestEntry`, updating duplicate keys. */
export const insertQuestHistoryForUpsertQuestEntry = (
  client: Pick<DrizzleClient, "insert">,
  entry: typeof questHistory.$inferSelect,
  duplicateUpdates: {
    startedAt: Date;
    endAt: null;
    completed: number;
    previousAttempts: SQL<unknown>;
    entryPaid: false | true;
    isolated: false | true;
    questVersion: Date;
  },
  professionContract: false | true,
  noDelegatedAttempt: SQL<unknown>,
) =>
  client
    .insert(questHistory)
    .values(entry)
    .onDuplicateKeyUpdate({
      set: Object.fromEntries(
        Object.entries(duplicateUpdates).map(([key, value]) => [
          key,
          professionContract
            ? sql`IF(${noDelegatedAttempt}, ${value}, ${questHistory[key as keyof typeof duplicateUpdates]})`
            : value,
        ]),
      ),
    });

/**
 * Build the `userData` update for `upsertQuestEntry`, setting `questData`, using
 * predicates on `userId`, `petTask`, `id`.
 */
export const updateUserDataForUpsertQuestEntry = (
  client: Pick<DrizzleClient, "update">,
  trackers: import("@/validators/objectives").QuestTrackerType[],
  user: NonNullable<UserWithRelations>,
  recoveryUpdate:
    | {
        curHealth: SQL<unknown>;
        curChakra: SQL<unknown>;
        curStamina: SQL<unknown>;
        curEnergy: SQL<unknown>;
        regenAt: SQL<unknown>;
      }
    | {
        curHealth?: undefined;
        curChakra?: undefined;
        curStamina?: undefined;
        curEnergy?: undefined;
        regenAt?: undefined;
      },
  entry: { isolated: false | true },
  professionContract: false | true,
  quest: { id: string },
) =>
  client
    .update(userData)
    .set({
      questData: filterQuestTrackersForDbPersist(trackers, user),
      ...recoveryUpdate,
      ...(entry.isolated ? { status: "BATTLE" as const } : {}),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        professionContract
          ? sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${userData.petTask}, '$.questId')), '') <> ${quest.id}`
          : undefined,
      ),
    );

/** Used by checkRewards when claimUserSnapshot fails after questHistory was marked completed. */
export const revertQuestCompletionAfterFailedClaim = async (
  client: DrizzleClient,
  userId: string,
  questId: string,
  completedEndAt: Date,
  wrotePeriodCounter: boolean,
  wroteRewardChoice: boolean,
) => {
  await client
    .update(questHistory)
    .set({
      completed: 0,
      previousCompletes: sql`GREATEST(${questHistory.previousCompletes} - 1, 0)`,
      // Only roll back the period counter when the completion CAS actually incremented it (it
      // writes periodCompletes only for retryDelay !== "none"). Decrementing it otherwise would
      // corrupt a stale non-zero counter the failed completion never touched.
      ...(wrotePeriodCounter
        ? { periodCompletes: sql`GREATEST(${questHistory.periodCompletes} - 1, 0)` }
        : {}),
      // The offer belongs to the reverted completion; the retry stores a fresh one.
      ...(wroteRewardChoice ? { pendingRewardChoice: null } : {}),
      endAt: null,
    })
    .where(
      and(
        eq(questHistory.questId, questId),
        eq(questHistory.userId, userId),
        eq(questHistory.completed, 1),
        eq(questHistory.endAt, completedEndAt),
      ),
    );
};

/** Build the user state lookup needed to calculate PvP rewards. */
export const findUserPvpRewardState = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: {
      pvpExperience: true,
      weeklyPvpKills: true,
      weeklyPvpKillsAt: true,
      isAi: true,
    },
    where: eq(userData.userId, userId),
  });

/** Build the `questHistory` insert for `commitQuestObjectiveRewards`, updating duplicate keys. */
export const insertQuestHistoryForCommitQuestObjectiveRewards = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  userQuest: {
    questId: string;
    quest: {
      questType: Exclude<QuestType, "village_mission">;
    };
  },
) =>
  client
    .insert(questHistory)
    .values({
      id: nanoid(),
      userId,
      questId: userQuest.questId,
      questType: userQuest.quest.questType,
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 0,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Execute the database statement for `commitQuestObjectiveRewards`. */
export const executeResultForCommitQuestObjectiveRewards = (
  client: Pick<DrizzleClient, "execute">,
  completedAt: Date,
  set: undefined | Record<string, unknown>,
  petTask: undefined | import("@/validators/petTasks").PetTask,
  rewardChoice: null | import("@/validators/rewards").PendingRewardChoice,
  cps: undefined | Date,
  startsNewPeriod: undefined | false | true,
  userId: string,
  user: { updatedAt: Date },
  managedRun: {
    id: string;
    periodCompletes?: undefined | number;
    periodStartAt?: undefined | null | Date;
  },
  completionConditions: undefined | SQL<unknown>,

  where: import("@/utils/typeutils").QueryCondition[],
) =>
  client.execute(sql`
            UPDATE ${userData}
            INNER JOIN ${questHistory} ON ${questHistory.userId} = ${userData.userId}
            SET ${userData.updatedAt} = ${completedAt},
                ${userData.questData} = CAST(${JSON.stringify(set?.questData ?? [])} AS JSON),
                ${petTask ? sql`${userData.petTask} = NULL,` : sql``}
                ${questHistory.completed} = 1,
                ${questHistory.previousCompletes} = ${questHistory.previousCompletes} + 1,
                ${questHistory.endAt} = ${completedAt}
                ${rewardChoice ? sql`, ${questHistory.pendingRewardChoice} = CAST(${JSON.stringify(rewardChoice)} AS JSON)` : sql``}
                ${
                  cps
                    ? sql`, ${questHistory.periodCompletes} = ${startsNewPeriod ? 1 : sql`${questHistory.periodCompletes} + 1`},
                  ${questHistory.periodStartAt} = ${startsNewPeriod ? cps : sql`${questHistory.periodStartAt}`}`
                    : sql``
                }
            WHERE ${userData.userId} = ${userId}
              AND ${userData.updatedAt} = ${user.updatedAt}
              AND ${questHistory.id} = ${managedRun.id}
              AND ${completionConditions}
              ${petTask ? sql`AND ${petTaskReceiptCondition(petTask)} AND ${questHistory.startedAt} = ${new Date(petTask.startedAt)} AND ${questHistory.questVersion} = ${new Date(petTask.questVersion)} AND ${petTaskOwnerReturnCondition(userId, petTask)}` : sql``}
              ${cps ? sql`AND ${questHistory.periodCompletes} = ${managedRun.periodCompletes ?? 0} AND ${questHistory.periodStartAt} <=> ${managedRun.periodStartAt ?? null}` : sql``}
              AND ${and(...where.filter(Boolean)) ?? sql`TRUE`}
          `);

/** Build the `questHistory` update for `commitQuestObjectiveRewards`, using the configured predicates. */
export const updateQuestHistoryForCommitQuestObjectiveRewards = (
  client: Pick<DrizzleClient, "update">,
  completedEndAt: Date,
  rewardChoice: null | import("@/validators/rewards").PendingRewardChoice,
  cps: undefined | Date,
  completionConditions: undefined | SQL<unknown>,
) =>
  client
    .update(questHistory)
    .set({
      completed: 1,
      previousCompletes: sql`${questHistory.previousCompletes} + 1`,
      endAt: completedEndAt,
      ...(rewardChoice ? { pendingRewardChoice: rewardChoice } : {}),
      // Reset the period counter when this completion opens a new period, else increment.
      ...(cps
        ? {
            periodCompletes: sql`CASE WHEN ${questHistory.periodStartAt} IS NULL OR ${questHistory.periodStartAt} < ${cps} THEN 1 ELSE ${questHistory.periodCompletes} + 1 END`,
            periodStartAt: sql`CASE WHEN ${questHistory.periodStartAt} IS NULL OR ${questHistory.periodStartAt} < ${cps} THEN ${cps} ELSE ${questHistory.periodStartAt} END`,
          }
        : {}),
    })
    .where(completionConditions);

/** Build the `bankTransfers` insert for `commitQuestObjectiveRewards`. */
export const insertBankTransfersForCommitQuestObjectiveRewards = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  senseiId: string,
  senseiReward: number,
) =>
  client.insert(bankTransfers).values({
    senderId: userId,
    receiverId: senseiId,
    amount: senseiReward,
    type: "sensei",
  });

/**
 * Build the `questHistory` update for `executeClaimedQuestConsequences`, setting
 * `completed` and `endAt`, using predicates on `questId`, `userId`, `completed`.
 */
export const updateQuestHistoryForExecuteClaimedQuestConsequences = (
  client: Pick<DrizzleClient, "update">,
  endedQuestIds: string[],
  user: { userId: string },
  partyQuestId: undefined | string,
) =>
  client
    .update(questHistory)
    .set({ completed: 0, endAt: new Date() })
    .where(
      and(
        inArray(questHistory.questId, endedQuestIds),
        eq(questHistory.userId, user.userId),
        // Team helpers and finished members retain their personal reward receipts.
        ...(partyQuestId
          ? [or(ne(questHistory.questId, partyQuestId), eq(questHistory.completed, 0))]
          : []),
      ),
    );

/** Build the `quest` listing, using predicates on `id`. */
export const listQuestsByIds = (
  client: Pick<DrizzleClient, "query">,
  startedQuestIds: string[],
) =>
  client.query.quest.findMany({
    where: inArray(quest.id, startedQuestIds),
  });

/** Build the `questHistory` selection for `where`, including predicates on `userId`, `questType`, `questId`. */
export const selectQuestHistoryForWhere2 = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  nextQuest: { id: string },
) =>
  client
    .select({ one: sql`1` })
    .from(questHistory)
    .where(
      and(
        eq(questHistory.userId, user.userId),
        eq(questHistory.questType, "battlepyramid"),
        ne(questHistory.questId, nextQuest.id),
        eq(questHistory.completed, 0),
        isNull(questHistory.endAt),
      ),
    );

/** Build the `userItem` insert for `executeClaimedQuestConsequences`. */
export const insertUserItemForExecuteClaimedQuestConsequences = (
  client: Pick<DrizzleClient, "insert">,
  collectedItems: string[],
  user: { userId: string },
) =>
  client.insert(userItem).values(
    collectedItems.map(
      (id) =>
        ({
          id: nanoid(),
          userId: user.userId,
          itemId: id,
          quantity: 1,
          equipped: "NONE",
        }) as const,
    ),
  );

/**
 * Build the `userItem` listing for `handleQuestConsequences`, selecting only `id` and
 * `itemId`, including predicates on `userId`, `itemId`, `quantity`.
 */
export const listUserItemForHandleQuestConsequences = (
  client: Pick<DrizzleClient, "query">,
  user: { userId: string },
  missingItemIds: string[],
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, user.userId),
      inArray(userItem.itemId, missingItemIds),
      gt(userItem.quantity, 0),
      eq(userItem.isInAuction, false),
      eq(userItem.storedAtHome, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, new Date()),
      ),
    ),
    columns: { id: true, itemId: true },
  });

/** Build the `overworldAiPlacement` listing for `prepareOverworldBindings`, using predicates on `id`. */
export const listOverworldAiPlacementForPrepareOverworldBindings = (
  client: Pick<DrizzleClient, "query">,
  placementIds: string[],
) =>
  client.query.overworldAiPlacement.findMany({
    columns: { id: true, aiTemplateUserId: true, interactionType: true },
    where: inArray(overworldAiPlacement.id, placementIds),
  });

/** Build the `item` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectItemForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  itemIds: string[],
) =>
  client
    .select({
      id: item.id,
      name: item.name,
      image: item.image,
      rarity: item.rarity,
      description: item.description,
    })
    .from(item)
    .where(inArray(item.id, itemIds));

/** Build the `jutsu` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectJutsuForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  jutsuIds: string[],
) =>
  client
    .select({
      id: jutsu.id,
      name: jutsu.name,
      image: jutsu.image,
      rarity: jutsu.jutsuRank,
      description: jutsu.description,
    })
    .from(jutsu)
    .where(inArray(jutsu.id, jutsuIds));

/** Build the `bloodline` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectBloodlineForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  bloodlineIds: string[],
) =>
  client
    .select({
      id: bloodline.id,
      name: bloodline.name,
      image: bloodline.image,
      rarity: bloodline.rank,
      description: bloodline.description,
    })
    .from(bloodline)
    .where(inArray(bloodline.id, bloodlineIds));

/** Build the `sageMode` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectSageModeForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  sageModeIds: string[],
) =>
  client
    .select({
      id: sageMode.id,
      name: sageMode.name,
      image: sageMode.image,
      description: sageMode.description,
    })
    .from(sageMode)
    .where(inArray(sageMode.id, sageModeIds));

/** Build the `badge` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectBadgeForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  badgeIds: string[],
) =>
  client
    .select({
      id: badge.id,
      name: badge.name,
      image: badge.image,
      description: badge.description,
    })
    .from(badge)
    .where(inArray(badge.id, badgeIds));

/** Build the `title` selection for `resolveRewardChoiceDisplays`, using predicates on `id`. */
export const selectTitleForResolveRewardChoiceDisplays = (
  client: Pick<DrizzleClient, "select">,
  titleIds: string[],
) =>
  client
    .select({
      id: title.id,
      name: title.name,
      description: title.description,
      image: sql<string>`''`.as("image"),
    })
    .from(title)
    .where(inArray(title.id, titleIds));

/** Build the `quest` listing, using predicates on `questType` and `hidden`. */
export const listVisibleRaidQuests = (client: Pick<DrizzleClient, "query">) =>
  client.query.quest.findMany({
    where: and(eq(quest.questType, "raid"), eq(quest.hidden, false)),
  });

/** Plain read: embedding this predicate in a mutation would lock QuestHistory ranges. */
export const fetchIsolatedPyramid = (client: DrizzleClient, userId: string) =>
  client.query.questHistory.findFirst({
    columns: { id: true },
    where: and(
      eq(questHistory.userId, userId),
      eq(questHistory.isolated, true),
      isNull(questHistory.endAt),
      eq(questHistory.completed, 0),
    ),
  });

/** Build the account's bloodline collection lookup for collection progress calculation. */
export const fetchBloodlineCollectionRolls = (client: DrizzleClient, userId: string) =>
  client.query.bloodlineRolls.findMany({
    columns: { bloodlineId: true },
    where: and(
      eq(bloodlineRolls.userId, userId),
      isNotNull(bloodlineRolls.bloodlineId),
    ),
  });

/** Build the bloodline collection catalogue query for caller-owned collection progress calculation. */
export const queryBloodlineCollectionCatalogue = (client: DrizzleClient) =>
  client.query.bloodline.findMany({
    columns: { id: true, rank: true, hidden: true },
    where: eq(bloodline.hidden, false),
  });

/** Candidate-query filters shared by discovery listings; destination-specific availability stays in callers. */
export interface QuestDiscoveryOptions {
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

/**
 * Discovery inputs without objective JSON. Authorize hidden summaries in the join,
 * because callers resolve display eligibility against the cached client profile.
 */
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
      requiredNinjutsuMastery: quest.requiredNinjutsuMastery,
      requiredGenjutsuMastery: quest.requiredGenjutsuMastery,
      requiredTaijutsuMastery: quest.requiredTaijutsuMastery,
      requiredBukijutsuMastery: quest.requiredBukijutsuMastery,
      requiredBloodlineMastery: quest.requiredBloodlineMastery,
      requiredSageMastery: quest.requiredSageMastery,
      // Eligibility needs the fixed promotion and reward mode, but not objective JSON.
      content:
        sql`JSON_OBJECT('reward', JSON_EXTRACT(${quest.content}, '$.reward'), 'rewardMode', JSON_EXTRACT(${quest.content}, '$.rewardMode'))`.mapWith(
          (value: string) =>
            quest.content.mapFromDriverValue(value) as Pick<
              QuestContentType,
              "reward" | "rewardMode"
            >,
        ),
      maxLevel: quest.maxLevel,
      maxAttempts: quest.maxAttempts,
      maxCompletes: quest.maxCompletes,
      retryDelay: quest.retryDelay,
      startsAt: quest.startsAt,
      endsAt: quest.endsAt,
      previousAttempts: questHistory.previousAttempts,
      previousCompletes: questHistory.previousCompletes,
      periodCompletes: questHistory.periodCompletes,
      periodStartAt: questHistory.periodStartAt,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, userId)),
    )
    .innerJoin(userData, eq(userData.userId, userId))
    .where(
      and(
        buildQuestDiscoveryWhere(options),
        or(
          eq(quest.hidden, false),
          inArray(userData.role, UserRoles.filter(canPlayHiddenQuests)),
        ),
      ),
    )
    .orderBy(asc(quest.name));

/** Build the `quest` selection for `questAttemptWhere`, using predicates on `id`, `updatedAt`, `hidden`. */
export const selectQuestForQuestAttemptWhere = (
  client: Pick<DrizzleClient, "select">,
  attempt: { questId: string; questVersion?: undefined | null | Date },
  role: UserRole,
) =>
  client
    .select({ one: sql`1` })
    .from(quest)
    .where(
      and(
        eq(quest.id, attempt.questId),
        attempt.questVersion ? eq(quest.updatedAt, attempt.questVersion) : undefined,
        canPlayHiddenQuests(role) ? undefined : eq(quest.hidden, false),
      ),
    );

/** Build the `questHistory` selection for `questAttemptIsActive`, using the configured predicates. */
export const selectQuestHistoryForQuestAttemptIsActive = (
  client: Pick<DrizzleClient, "select">,
  where: SQL<unknown> | undefined,
) => client.select({ one: sql`1` }).from(questHistory).where(where);

/** Inventory that can pay a quest entry: carried, not listed, and not still being crafted. */
export const fetchQuestEntryInventory = (client: DrizzleClient, userId: string) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, userId),
      gt(userItem.quantity, 0),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lt(userItem.craftingFinishedAt, new Date()),
      ),
    ),
  });

/**
 * Build the `questHistory` update for `payQuestEntryAtStart`, setting `entryPaid`,
 * including predicates on `userId`, `questId`, `entryPaid`.
 */
export const updateQuestHistoryForPayQuestEntryAtStart = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  questId: string,
) =>
  client
    .update(questHistory)
    .set({ entryPaid: true })
    .where(
      and(
        eq(questHistory.userId, userId),
        eq(questHistory.questId, questId),
        eq(questHistory.entryPaid, false),
        isNull(questHistory.endAt),
        eq(questHistory.completed, 0),
      ),
    );

/**
 * Build the `questHistory` update for `commitQuestEntryBattle`, setting `entryPaid`,
 * guarded by the receipt id, unpaid state and caller's attempt predicate.
 */
export const updateQuestHistoryForCommitQuestEntryBattle = (
  client: Pick<DrizzleClient, "update">,
  attempt: { id: string },
  where: SQL<unknown> | undefined,
) =>
  client
    .update(questHistory)
    .set({ entryPaid: true })
    .where(
      and(eq(questHistory.id, attempt.id), eq(questHistory.entryPaid, false), where),
    );

/**
 * Include legacy endgame content in SQL candidates above the XP cap. The availability
 * layer still enforces each milestone's exact level and rank requirements.
 */
export const questLevelFilters = (level: number) => [
  lte(quest.requiredLevel, level),
  or(
    gte(quest.maxLevel, level),
    level > MAX_EXPERIENCE_LEVEL ? eq(quest.maxLevel, MAX_EXPERIENCE_LEVEL) : undefined,
  ),
];

/** Build the shared discovery filters; destination-specific availability stays in callers. */
const buildQuestDiscoveryWhere = (options: QuestDiscoveryOptions) =>
  and(
    inArray(quest.questType, options.questTypes),
    options.villageId
      ? or(isNull(quest.requiredVillage), eq(quest.requiredVillage, options.villageId))
      : undefined,
    options.ranks?.length ? inArray(quest.questRank, options.ranks) : undefined,
    ...(options.level !== undefined ? questLevelFilters(options.level) : []),
  );

/** Compare the complete accepted receipt, including its deadline and content revision. */
const petTaskReceiptCondition = (task: PetTask) =>
  sql`${userData.petTask} = CAST(${JSON.stringify(task)} AS JSON)`;

/**
 * SQL predicates shared by mission-hall and uncompleted-quest fetches: exact
 * `requiredSageModeId` (or unset) and minimum `requiredSageRank` (or unset).
 *
 * @param user - Equipped mode and mastery experience from the questing player.
 */
const sageQuestFilters = (
  user: Pick<UserData, "sageModeId" | "sageMasteryExperience">,
) => [
  or(
    isNull(quest.requiredSageModeId),
    eq(quest.requiredSageModeId, user.sageModeId ?? ""),
  ),
  or(
    isNull(quest.requiredSageRank),
    inArray(
      quest.requiredSageRank,
      sageRanksAtOrBelow(
        getSageMasteryDisplayRank(user.sageMasteryExperience, !!user.sageModeId),
      ),
    ),
  ),
];

/**
 * Guard return and terminal history in the same account claim; occupation may change
 * while away. As at dispatch, accepted current-rank art remains usable during redraws.
 */
const petTaskOwnerReturnCondition = (userId: string, task: PetTask) =>
  sql`${and(
    eq(userData.status, "AWAKE"),
    isNull(userData.battleId),
    eq(userData.isBanned, false),
    eq(userData.isAi, false),
  )} AND ${task.finishesAt} <= ${Date.now()}
    AND EXISTS (SELECT 1 FROM ${userPet} WHERE ${and(
      eq(userPet.id, task.petId),
      eq(userPet.userId, userId),
      gte(userPet.rank, PET_TASK_MIN_RANK),
      inArray(userPet.generationStatus, ["READY", "GENERATING"]),
      eq(userPet.artRank, userPet.rank),
      isNotNull(userPet.avatar),
      ne(userPet.avatar, ""),
    )})`;

/** Confirm reward counters whose SQL grants include live caps and pet eligibility. */
export const findRewardUserSnapshot = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: {
      money: true,
      seichiSilver: true,
      earnedExperience: true,
      petExperience: true,
      villagePrestige: true,
      reputationPoints: true,
      reputationPointsTotal: true,
      skillPoints: true,
      medicalExperience: true,
      huntingExperience: true,
      craftingExperience: true,
      gatheringExperience: true,
      sageMasteryExperience: true,
      ninjutsuMastery: true,
      genjutsuMastery: true,
      taijutsuMastery: true,
      bukijutsuMastery: true,
      bloodlineMastery: true,
      sageMastery: true,
      masteryRanks: true,
    },
    with: { village: { columns: { id: true, tokens: true } } },
    where: eq(userData.userId, userId),
  });
