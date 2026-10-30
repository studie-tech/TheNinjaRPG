import { eq } from "drizzle-orm";
import type { UserData } from "@/drizzle/schema";
import { userItem } from "@/drizzle/schema";
import { dungeonEntryError, dungeonRequirements } from "@/libs/dungeon";
import {
  listDungeonEntryHistory,
  listDungeonEntryInventory,
  listDungeonPrerequisites,
  markDungeonFloorPublished,
} from "@/queries/dungeon";
import type { DrizzleClient } from "@/server/db";
import { updateUserItemQuantityAtomically } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getQuestEntryCharges } from "@/server/utils/questEntry";
import type { DungeonContent, DungeonRunState } from "@/validators/dungeon";

/** Allocate dungeon tickets with the quest allocator from one human's filtered inventory. */
export const getDungeonEntryCharges = (
  { requiredItemId, requiredItemQuantity }: ReturnType<typeof dungeonRequirements>,
  inventory: Parameters<typeof getQuestEntryCharges>[1],
) => {
  const entryItems = requiredItemId
    ? [{ ids: [requiredItemId], number: requiredItemQuantity }]
    : [];
  return getQuestEntryCharges(
    { entryPaid: false, quest: { content: { entryItems } } },
    inventory,
  );
};

/** Load independent personal admission evidence once, before any battle mutation. */
export const fetchDungeonEntryData = async (client: DrizzleClient, ids: string[]) => {
  const [history, quests, inventory] = await Promise.all([
    listDungeonEntryHistory(client, ids),
    listDungeonPrerequisites(client, ids),
    listDungeonEntryInventory(client, ids),
  ]);
  return { history, quests, inventory };
};

/** Derive one human's admission error and counts; companion slots consume no extra tickets. */
export const dungeonAdmission = (
  data: Awaited<ReturnType<typeof fetchDungeonEntryData>>,
  user: Pick<UserData, "userId" | "level">,
  dungeonId: string,
  content: DungeonContent,
) => {
  const requirements = dungeonRequirements(content);
  const history = data.history.filter(
    (row) => row.userId === user.userId && row.dungeonId === dungeonId,
  );
  const attempts = history.flatMap((row) => (row.entryPaidAt ? [row.entryPaidAt] : []));
  const completions = history.flatMap((row) =>
    row.hasReward ? [row.claimedAt ?? row.createdAt.getTime()] : [],
  );
  return {
    requirements,
    attempts,
    completions,
    error: dungeonEntryError({
      requirements,
      level: user.level,
      attempts,
      completions,
      questCompleted: data.quests.some(
        (row) =>
          row.userId === user.userId &&
          row.questId === requirements.prerequisiteQuestId,
      ),
      itemQuantity: data.inventory
        .filter(
          (row) =>
            row.userId === user.userId && row.itemId === requirements.requiredItemId,
        )
        .reduce((sum, row) => sum + row.quantity, 0),
    }),
  };
};

/**
 * Publish a playable floor with every participant claim and any first-entry charges.
 * MySQL cannot combine the battle/history INSERTs with guarded run/user/item UPDATEs.
 * Battle reads make inserted rows playable immediately, so separate publication would
 * expose an unpaid battle or leave a charged entry without a battle after an insert failure.
 * Every floor needs one commit with its publication marker to exclude destructive recovery.
 * Admission reads stay outside this short transaction; active membership serializes entry
 * attempts per account, and guarded debits reject inventory changes before committing.
 */
export const commitDungeonEntryBattle = async <T>({
  client,
  runId,
  dungeonId,
  battleId,
  version,
  state,
  content,
  data,
  users,
  createBattle,
  didClaim,
}: {
  client: DrizzleClient;
  runId: string;
  dungeonId: string;
  battleId: string;
  version: number;
  state: DungeonRunState;
  content: DungeonContent;
  data: Awaited<ReturnType<typeof fetchDungeonEntryData>> | null;
  users: Pick<UserData, "userId" | "level" | "username">[];
  createBattle: (client: DrizzleClient) => Promise<T>;
  didClaim: (result: T) => boolean;
}) => {
  const rejected = new Error("Dungeon admission changed");
  for (const user of data ? users : []) {
    const admission = dungeonAdmission(data!, user, dungeonId, content);
    if (admission.error)
      return {
        success: false as const,
        message: `${user.username}: ${admission.error}`,
      };
  }
  try {
    const result = await retryOnDeadlock(() =>
      client.transaction(async (transaction) => {
        const tx = transaction as unknown as DrizzleClient;
        const receipt = await markDungeonFloorPublished(
          tx,
          runId,
          battleId,
          version,
          state,
        );
        if (receipt.rowsAffected !== 1) throw rejected;
        const requirements = dungeonRequirements(content);
        for (const user of data ? users : []) {
          const charges = getDungeonEntryCharges(
            requirements,
            data!.inventory.filter((row) => row.userId === user.userId),
          );
          if (!charges) throw rejected;
          for (const charge of charges) {
            const paid = await updateUserItemQuantityAtomically({
              client: tx,
              userId: user.userId,
              userItemId: charge.id,
              expectedQuantity: charge.expectedQuantity,
              nextQuantity: charge.expectedQuantity - charge.quantity,
              where: [
                eq(userItem.itemId, charge.itemId),
                eq(userItem.storedAtHome, false),
                eq(userItem.isInAuction, false),
              ],
            });
            if (!paid) throw rejected;
          }
        }
        const created = await createBattle(tx);
        if (!didClaim(created)) throw rejected;
        return created;
      }),
    );
    return { success: true as const, result };
  } catch (error) {
    if (error === rejected)
      return {
        success: false as const,
        message:
          "Dungeon entry changed. Refresh and try again; no items or attempts were consumed.",
      };
    throw error;
  }
};
