import { and, asc, count, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  actionLog,
  aiSpriteAnimation,
  spriteAnimation,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Load validation inputs alongside the editor's other upfront reads. */
export const fetchAnimationAi = (client: DrizzleClient, id: string) =>
  client.query.userData.findFirst({
    where: and(eq(userData.userId, id), eq(userData.isAi, true)),
    with: {
      spriteAnimationBindings: { with: { animation: true } },
      jutsus: { with: { jutsu: true } },
      items: { with: { item: true } },
    },
  });
/** Every AI with only the fields that determine its actions and their sheet bindings. */
export const listAiAnimationCoverage = (client: DrizzleClient) =>
  client.query.userData.findMany({
    where: eq(userData.isAi, true),
    columns: { userId: true, username: true, level: true, rank: true },
    with: {
      spriteAnimationBindings: { columns: { actionKey: true } },
      jutsus: {
        columns: { jutsuId: true },
        with: { jutsu: { columns: { name: true } } },
      },
      items: {
        columns: { itemId: true },
        with: { item: { columns: { name: true, itemType: true } } },
      },
    },
    orderBy: asc(userData.username),
  });
/** One AI's own sheets are named after it or already bound to it. */
const spriteSheetFilter = (client: DrizzleClient, input: SpriteSheetSearch) =>
  and(
    input.ai
      ? or(
          like(spriteAnimation.name, `%${input.ai.username}%`),
          inArray(
            spriteAnimation.id,
            client
              .select({ id: aiSpriteAnimation.animationId })
              .from(aiSpriteAnimation)
              .where(eq(aiSpriteAnimation.userId, input.ai.userId)),
          ),
        )
      : undefined,
    ...input.tokens.map((token) => like(spriteAnimation.name, `%${token}%`)),
  );
export const searchSpriteAnimations = (
  client: DrizzleClient,
  input: SpriteSheetSearch & { limit: number; offset: number },
) =>
  client.query.spriteAnimation.findMany({
    where: spriteSheetFilter(client, input),
    // Sheets with a status prefix, such as "[Held]", stay findable but never lead.
    orderBy: [
      asc(sql`${spriteAnimation.name} LIKE '[%'`),
      asc(spriteAnimation.name),
      asc(spriteAnimation.id),
    ],
    limit: input.limit,
    offset: input.offset,
  });
export const countSpriteAnimations = (
  client: DrizzleClient,
  input: SpriteSheetSearch,
) =>
  client
    .select({ total: count() })
    .from(spriteAnimation)
    .where(spriteSheetFilter(client, input));
export const findSpriteAnimation = (client: DrizzleClient, id: string) =>
  client.query.spriteAnimation.findFirst({ where: eq(spriteAnimation.id, id) });
export const insertSpriteAnimation = (
  client: DrizzleClient,
  input: typeof spriteAnimation.$inferInsert,
) => client.insert(spriteAnimation).values(input);
export const insertSpriteAnimationLog = (
  client: DrizzleClient,
  input: typeof actionLog.$inferInsert,
) => client.insert(actionLog).values(input);
export const touchAnimationAi = (client: DrizzleClient, id: string) =>
  client.update(userData).set({ updatedAt: new Date() }).where(eq(userData.userId, id));
/** One statement changes the binding; concurrent reversible staff edits remain last-write-wins. */
export const saveSpriteAnimationBinding = (
  client: DrizzleClient,
  userId: string,
  actionKey: string,
  animationId: string | null,
) =>
  animationId
    ? client
        .insert(aiSpriteAnimation)
        .values({ userId, actionKey, animationId })
        .onDuplicateKeyUpdate({ set: { animationId } })
    : client
        .delete(aiSpriteAnimation)
        .where(
          and(
            eq(aiSpriteAnimation.userId, userId),
            eq(aiSpriteAnimation.actionKey, actionKey),
          ),
        );
export const listAiSpriteAnimationBindings = (client: DrizzleClient, userId: string) =>
  client.query.aiSpriteAnimation.findMany({
    where: eq(aiSpriteAnimation.userId, userId),
  });
export const fetchAnimationAiName = (client: DrizzleClient, id: string) =>
  client.query.userData.findFirst({
    where: and(eq(userData.userId, id), eq(userData.isAi, true)),
    columns: { userId: true, username: true },
  });
export const copyAiSpriteAnimationBindings = (
  client: DrizzleClient,
  bindings: (typeof aiSpriteAnimation.$inferInsert)[],
) => client.insert(aiSpriteAnimation).values(bindings);
/** Library sheets survive deletion of a referencing AI. */
export const deleteAiSpriteAnimationBindings = (
  client: DrizzleClient,
  userId: string,
) => client.delete(aiSpriteAnimation).where(eq(aiSpriteAnimation.userId, userId));

type SpriteSheetSearch = {
  ai?: { userId: string; username: string };
  tokens: string[];
};
