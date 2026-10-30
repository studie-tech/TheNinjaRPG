/**
 * Database access for overworld ai; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { OVERWORLD_QUEST_ROLLS_PER_DAY } from "@/drizzle/constants";
import {
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  userData,
  userQuestAttempt,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `overworldAiPlacement` listing for `GET`, using predicates on `isActive`, `sectorType`, `locationType`. */
export const listOverworldAiPlacementForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.overworldAiPlacement.findMany({
    where: and(
      eq(overworldAiPlacement.isActive, true),
      or(
        ne(overworldAiPlacement.sectorType, "specific"),
        ne(overworldAiPlacement.locationType, "specific"),
      ),
    ),
  });

/** Build the `overworldAiPlacement` update for `GET`, using predicates on `id`. */
export const updateOverworldAiPlacementForGET = (
  client: Pick<DrizzleClient, "update">,
  pos: { sector: number; longitude: number; latitude: number },
  placement: { id: string },
) =>
  client
    .update(overworldAiPlacement)
    .set({
      sector: pos.sector,
      longitude: pos.longitude,
      latitude: pos.latitude,
      positionVersion: sql`${overworldAiPlacement.positionVersion} + 1`,
    })
    .where(eq(overworldAiPlacement.id, placement.id));

/** Load a placement with its quest pool and the AI template identity/isAi flag. */
export const fetchPlacement = async (client: DrizzleClient, placementId: string) =>
  client.query.overworldAiPlacement.findFirst({
    where: eq(overworldAiPlacement.id, placementId),
    columns: {
      id: true,
      isActive: true,
      aiTemplateUserId: true,
      interactionType: true,
      sector: true,
      longitude: true,
      latitude: true,
      positionVersion: true,
    },
    with: {
      questPool: { columns: { questId: true, chance: true } },
      aiTemplate: { columns: { isAi: true } },
    },
  });

/** Build the `overworldAiPlacement` listing for `getPlacementsForAi`, using predicates on `aiTemplateUserId`. */
export const listOverworldAiPlacementForGetPlacementsForAi = (
  client: Pick<DrizzleClient, "query">,
  input: { aiTemplateUserId: string },
) =>
  client.query.overworldAiPlacement.findMany({
    where: eq(overworldAiPlacement.aiTemplateUserId, input.aiTemplateUserId),
    with: { questPool: true },
  });

/** Build the `overworldAiPlacement` listing for `getAllPlacementNames`. */
export const listOverworldAiPlacementForGetAllPlacementNames = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.overworldAiPlacement.findMany({
    columns: {
      id: true,
      aiTemplateUserId: true,
      interactionType: true,
      sector: true,
      isActive: true,
    },
    with: { aiTemplate: { columns: { username: true } } },
  });

/** Build the `userData` lookup for `upsertPlacement`, selecting only `userId` and `isAi`, using predicates on `userId`. */
export const findUserDataForUpsertPlacement = (
  client: Pick<DrizzleClient, "query">,
  cfg: { aiTemplateUserId: string },
) =>
  client.query.userData.findFirst({
    columns: { userId: true, isAi: true },
    where: eq(userData.userId, cfg.aiTemplateUserId),
  });

/**
 * Build the `overworldAiPlacement` lookup for `upsertPlacement`, selecting only `id`
 * and `aiTemplateUserId`, using predicates on `id`.
 */
export const findOverworldAiPlacementForUpsertPlacement = (
  client: Pick<DrizzleClient, "query">,
  placementId: string,
) =>
  client.query.overworldAiPlacement.findFirst({
    columns: { id: true, aiTemplateUserId: true },
    where: eq(overworldAiPlacement.id, placementId),
  });

/** Build the `quest` listing for `upsertPlacement`, using predicates on `id`. */
export const listQuestForUpsertPlacement = (
  client: Pick<DrizzleClient, "query">,
  quests: Pick<
    import("@/drizzle/schema").OverworldAiPlacementQuest,
    "chance" | "questId"
  >[],
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true, questType: true },
    where: inArray(
      quest.id,
      quests.map((q) => q.questId),
    ),
  });

/** Build the `overworldAiPlacement` update for `upsertPlacement`, using predicates on `id`. */
export const updateOverworldAiPlacementForUpsertPlacement = (
  client: Pick<DrizzleClient, "update">,
  row: Pick<
    import("@/drizzle/schema").OverworldAiPlacement,
    | "id"
    | "sector"
    | "longitude"
    | "latitude"
    | "aiTemplateUserId"
    | "interactionType"
    | "isActive"
    | "sectorType"
    | "locationType"
    | "sectorList"
  > & { positionVersion: number | SQL<unknown> },
  input: { id: string },
) =>
  client
    .update(overworldAiPlacement)
    .set(row)
    .where(eq(overworldAiPlacement.id, input.id));

/** Build deletion of the quest assignments for an overworld AI placement. */
export const deleteOverworldAiPlacementQuests = (
  client: Pick<DrizzleClient, "delete">,
  placementId: string,
) =>
  client
    .delete(overworldAiPlacementQuest)
    .where(eq(overworldAiPlacementQuest.placementId, placementId));

/** Build the `overworldAiPlacement` insert for `upsertPlacement`. */
export const insertOverworldAiPlacementForUpsertPlacement = (
  client: Pick<DrizzleClient, "insert">,
  row: Pick<
    import("@/drizzle/schema").OverworldAiPlacement,
    | "id"
    | "sector"
    | "longitude"
    | "latitude"
    | "aiTemplateUserId"
    | "interactionType"
    | "isActive"
    | "sectorType"
    | "locationType"
    | "sectorList"
  > & { positionVersion: number | SQL<unknown> },
) => client.insert(overworldAiPlacement).values(row);

/** Build the `overworldAiPlacementQuest` insert for `upsertPlacement`. */
export const insertOverworldAiPlacementQuestForUpsertPlacement = (
  client: Pick<DrizzleClient, "insert">,
  quests: Pick<
    import("@/drizzle/schema").OverworldAiPlacementQuest,
    "chance" | "questId"
  >[],
  id: string,
) =>
  client.insert(overworldAiPlacementQuest).values(
    quests.map((q) => ({
      placementId: id,
      questId: q.questId,
      chance: q.chance,
    })),
  );

/** Build the `overworldAiPlacement` deletion for `deletePlacement`, using predicates on `id`. */
export const deleteOverworldAiPlacementForDeletePlacement = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(overworldAiPlacement).where(eq(overworldAiPlacement.id, input.id));

/** Build the `questHistory` listing for `interactWithOverworldAi`, using predicates on `userId` and `questId`. */
export const listQuestHistoryForInteractWithOverworldAi = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  poolQuestIds: string[],
) =>
  client.query.questHistory.findMany({
    where: and(
      eq(questHistory.userId, ctx.userId),
      inArray(questHistory.questId, poolQuestIds),
    ),
  });

/** Build the `userQuestAttempt` selection for `interactWithOverworldAi`, using predicates on `userId` and `questId`. */
export const selectUserQuestAttemptForInteractWithOverworldAi = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  poolQuestIds: string[],
) =>
  client
    .select()
    .from(userQuestAttempt)
    .where(
      and(
        eq(userQuestAttempt.userId, ctx.userId),
        inArray(userQuestAttempt.questId, poolQuestIds),
      ),
    );

/**
 * Build the `userData` update for `interactWithOverworldAi`, setting
 * `dailyOverworldQuestRolls`, using predicates on `userId` and
 * `dailyOverworldQuestRolls`.
 */
export const updateUserDataForInteractWithOverworldAi = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      dailyOverworldQuestRolls: sql`${userData.dailyOverworldQuestRolls} + 1`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        sql`${userData.dailyOverworldQuestRolls} < ${OVERWORLD_QUEST_ROLLS_PER_DAY}`,
      ),
    );

/** Build the `userQuestAttempt` insert for `interactWithOverworldAi`, updating duplicate keys. */
export const insertUserQuestAttemptForInteractWithOverworldAi = (
  client: Pick<DrizzleClient, "insert">,
  attemptRowsToInsert: import("@/drizzle/schema").UserQuestAttempt[],
  now: Date,
) =>
  client
    .insert(userQuestAttempt)
    .values(attemptRowsToInsert)
    .onDuplicateKeyUpdate({ set: { lastAttemptAt: now } });

/** Quests (id + name only) whose objective content binds this placement — for name-only guards.
 *  Skips the potentially large `content` JSON the deactivate/delete callers never inspect. */
export const fetchQuestNamesBindingPlacement = async (
  client: DrizzleClient,
  placementId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: questBindsPlacementWhere(placementId),
  });

/** Same binding set, plus objective content for friendly interaction and fixed structure guards. */
export const fetchQuestsBindingPlacement = async (
  client: DrizzleClient,
  placementId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true, content: true },
    where: questBindsPlacementWhere(placementId),
  });

/** Exact JSON membership predicate: a quest's objective content binds this placement
 *  (overworldPlacementId). Shared by the name-only and content-bearing fetches. */
const questBindsPlacementWhere = (placementId: string) =>
  sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].overworldPlacementId'), JSON_QUOTE(${placementId})) = 1`;
