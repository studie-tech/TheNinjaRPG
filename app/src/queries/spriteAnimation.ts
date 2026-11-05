import { and, asc, eq } from "drizzle-orm";
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
      spriteAnimationBindings: true,
      jutsus: { with: { jutsu: true } },
      items: { with: { item: true } },
    },
  });
export const listSpriteAnimations = (client: DrizzleClient) =>
  client.query.spriteAnimation.findMany({ orderBy: asc(spriteAnimation.name) });
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
export const copyAiSpriteAnimationBindings = (
  client: DrizzleClient,
  bindings: (typeof aiSpriteAnimation.$inferInsert)[],
) => client.insert(aiSpriteAnimation).values(bindings);
/** Library sheets survive deletion of a referencing AI. */
export const deleteAiSpriteAnimationBindings = (
  client: DrizzleClient,
  userId: string,
) => client.delete(aiSpriteAnimation).where(eq(aiSpriteAnimation.userId, userId));
