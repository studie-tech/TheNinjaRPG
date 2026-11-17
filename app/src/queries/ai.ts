/**
 * Database access for ai; authorization and transaction scopes stay in callers.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { aiProfile, aiTransformation, jutsuLoadout } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { AiTransformationInput, updateAiProfileSchema } from "@/validators/ai";

/** Every boss link; the table holds a handful of rows, read whole so chains need one query. */
export const listAiTransformations = (client: Pick<DrizzleClient, "query">) =>
  client.query.aiTransformation.findMany();

/** Save or replace an AI's next form in one statement; staff edits are last-write-wins. */
export const saveAiTransformation = (
  client: DrizzleClient,
  userId: string,
  { nextAiId, announce, log, tier, color, glow }: AiTransformationInput,
) =>
  client
    .insert(aiTransformation)
    .values({ userId, nextAiId, announce, log, tier, color, glow })
    .onDuplicateKeyUpdate({ set: { nextAiId, announce, log, tier, color, glow } });

/** Stop an AI transforming, leaving any forms that lead into it. */
export const deleteAiTransformation = (client: DrizzleClient, userId: string) =>
  client.delete(aiTransformation).where(eq(aiTransformation.userId, userId));

/** A deleted AI leaves no link to or from it. */
export const deleteAiTransformationsFor = (client: DrizzleClient, userId: string) =>
  client
    .delete(aiTransformation)
    .where(
      or(eq(aiTransformation.userId, userId), eq(aiTransformation.nextAiId, userId)),
    );

/** What the boss editor shows for each form, including its readiness to fight. */
export const listAiForBossFight = (client: DrizzleClient, userIds: string[]) =>
  client.query.userData.findMany({
    where: and(inArray(userData.userId, userIds), eq(userData.isAi, true)),
    columns: { userId: true, username: true, avatar: true },
    with: {
      spriteAnimationBindings: { columns: { actionKey: true } },
      jutsus: { columns: { jutsuId: true } },
    },
  });

/**
 * Fetches an AI profile from the database using the provided client and profile ID.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param id - The unique identifier of the AI profile to fetch.
 * @returns The AI profile object, including its associated rules, or undefined when no
 * profile has the given ID.
 */
export const fetchAiProfileById = async (client: DrizzleClient, id: string) => {
  const profile = await client.query.aiProfile.findFirst({
    where: eq(aiProfile.id, id),
  });
  return profile;
};

/** The AI profile of a staff AI, which belongs to no jutsu loadout, or undefined when none exists. */
export const fetchUnlinkedAiProfileByUserId = (client: DrizzleClient, userId: string) =>
  client.query.aiProfile.findFirst({
    where: and(eq(aiProfile.userId, userId), isNull(aiProfile.jutsuLoadoutId)),
  });

/** A player's active jutsu loadout, whether it fights with its own rules, and the rules pointer. */
export const fetchAiLoadoutStateForToggleAiProfile = (
  client: DrizzleClient,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { jutsuLoadout: true, aiProfileId: true },
    with: { loadout: { columns: { customAi: true } } },
  });

/**
 * Build the no-op upsert giving one of the player's own jutsu loadouts its AI profile row, once.
 */
export const upsertAiProfileForToggleAiProfile = (
  client: Pick<DrizzleClient, "execute">,
  id: string,
  userId: string,
  loadoutId: string,
) =>
  client.execute(sql`
    INSERT INTO ${aiProfile} (id, userId, jutsuLoadoutId, rules, includeDefaultRules)
    SELECT ${id}, ${jutsuLoadout.userId}, ${jutsuLoadout.id}, JSON_ARRAY(), true
    FROM ${jutsuLoadout}
    WHERE ${jutsuLoadout.id} = ${loadoutId} AND ${jutsuLoadout.userId} = ${userId}
    ON DUPLICATE KEY UPDATE \`AiProfile\`.\`id\` = \`AiProfile\`.\`id\`
  `);

/**
 * Build the update switching the player's active jutsu loadout between its own AI rules and the
 * Default ones, and pointing the profile at them, in one statement guarded on that loadout.
 */
export const executeRowsForToggleAiProfile = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  loadoutId: string,
  custom: boolean,
) =>
  client.execute(
    custom
      ? sql`
    UPDATE ${userData}
    JOIN ${jutsuLoadout} ON ${jutsuLoadout.id} = ${userData.jutsuLoadout}
      AND ${jutsuLoadout.userId} = ${userData.userId}
    JOIN ${aiProfile} ON ${aiProfile.jutsuLoadoutId} = ${jutsuLoadout.id}
      AND ${aiProfile.userId} = ${userData.userId}
    SET ${jutsuLoadout.customAi} = true, ${userData.aiProfileId} = ${aiProfile.id}
    WHERE ${userData.userId} = ${userId} AND ${userData.jutsuLoadout} = ${loadoutId}
  `
      : sql`
    UPDATE ${userData}
    JOIN ${jutsuLoadout} ON ${jutsuLoadout.id} = ${userData.jutsuLoadout}
      AND ${jutsuLoadout.userId} = ${userData.userId}
    SET ${jutsuLoadout.customAi} = false, ${userData.aiProfileId} = NULL
    WHERE ${userData.userId} = ${userId} AND ${userData.jutsuLoadout} = ${loadoutId}
  `,
  );

import { inArray, sql } from "drizzle-orm";
import { item, jutsu, quest, userData } from "@/drizzle/schema";

/** Build the `jutsu` listing for `updateAiProfile`, using predicates on `id`. */
export const listJutsuForUpdateAiProfile = (
  client: Pick<DrizzleClient, "query">,
  input: { rules: import("@/validators/ai").AiRuleType[] },
) =>
  client.query.jutsu.findMany({
    where: inArray(
      jutsu.id,
      input.rules
        .filter((r) => "jutsuId" in r.action)
        .map((r) => (r.action as { jutsuId: string }).jutsuId),
    ),
  });

/** Build the `item` listing for `updateAiProfile`, using predicates on `id`. */
export const listItemForUpdateAiProfile = (
  client: Pick<DrizzleClient, "query">,
  input: { rules: import("@/validators/ai").AiRuleType[] },
) =>
  client.query.item.findMany({
    where: inArray(
      item.id,
      input.rules
        .filter((r) => "itemId" in r.action)
        .map((r) => (r.action as { itemId: string }).itemId),
    ),
  });

/**
 * Build the `aiProfile` update for `updateAiProfile`, setting `rules` and
 * `includeDefaultRules`, using predicates on `id`.
 */
export const updateAiProfileForUpdateAiProfile = (
  client: Pick<DrizzleClient, "update">,
  input: z.infer<typeof updateAiProfileSchema>,
) =>
  client
    .update(aiProfile)
    .set({ rules: input.rules, includeDefaultRules: input.includeDefaultRules })
    .where(eq(aiProfile.id, input.id));

/** Build the `userData` update for `toggleAiProfile`, setting `aiProfileId`, using predicates on `userId`. */
export const updateUserDataForToggleAiProfile = (
  client: Pick<DrizzleClient, "update">,
  target: { userId: string },
) =>
  client
    .update(userData)
    .set({ aiProfileId: null })
    .where(eq(userData.userId, target.userId));

/** Build an AI profile assignment for one user. */
export const setUserAiProfile = (
  client: Pick<DrizzleClient, "update">,
  profileId: string,
  userId: string,
) =>
  client
    .update(userData)
    .set({ aiProfileId: profileId })
    .where(eq(userData.userId, userId));

/** Build the `aiProfile` insert for `toggleAiProfile`. */
export const insertAiProfileForToggleAiProfile = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  target: { userId: string },
) => client.insert(aiProfile).values({ id, userId: target.userId, rules: [] });

/** Build the `quest` listing for `getAiRelations`, selecting only `id` and `name`, using predicates on `content`. */
export const listQuestForGetAiRelations = (
  client: Pick<DrizzleClient, "query">,
  aiId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`(
      JSON_SEARCH(${quest.content}, 'one', ${aiId}, NULL, '$.objectives[*].opponentAIs[*].ids[*]') IS NOT NULL
      OR JSON_SEARCH(${quest.content}, 'one', ${aiId}, NULL, '$.objectives[*].allyAIs[*].ids[*]') IS NOT NULL
      OR JSON_SEARCH(${quest.content}, 'one', ${aiId}, NULL, '$.objectives[*].attackers[*].ids[*]') IS NOT NULL
    )`,
  });

/** Build the `userData` listing, selecting only `userId`, using predicates on `userId` and `isAi`. */
export const listAiUserIds = (client: Pick<DrizzleClient, "query">, aiIds: string[]) =>
  client.query.userData.findMany({
    where: and(inArray(userData.userId, aiIds), eq(userData.isAi, true)),
    columns: { userId: true },
  });
