import {
  DUNGEON_MAX_GRANTED_ITEMS,
  DUNGEON_MAX_REWARD_AMOUNT,
} from "@/drizzle/constants";
import { postProcessRewards } from "@/libs/quest";
import { collapseRewards } from "@/libs/rewards";
import type { DungeonContent } from "@/validators/dungeon";
import { ObjectiveReward, REWARD_CHOICE_AMOUNT_FIELDS } from "@/validators/rewards";

/** Reward identity survives row reordering and quantity or chance edits. */
export const dungeonDropKey = (
  drop: Pick<DungeonContent["rewards"]["drops"][number], "type" | "id">,
) => JSON.stringify([drop.type, drop.id]);

/**
 * Roll each completion drop once, granting its entire quantity on success.
 * Package copies retain their nested item chances through the shared reward pipeline;
 * absent quantities on persisted runs represent one copy.
 * @param rewards Saved run rewards, checked with dungeonRewardError before rolling.
 * @param claimedDrops Successful drop identities from earlier claims in this dungeon.
 * @returns The grant payload and successful drop identities for the durable receipt.
 * @throws When a successful package drop has no saved catalog snapshot.
 */
export const rollDungeonRewards = (
  rewards: DungeonContent["rewards"],
  claimedDrops: ReadonlySet<string> = new Set(),
) => {
  const grantedDrops = new Set<string>();
  const grantedOnlyOnceDrops = new Set<string>();
  const drops = rewards.drops.filter((drop) => {
    const key = dungeonDropKey(drop);
    if (drop.onlyOnce && (claimedDrops.has(key) || grantedOnlyOnceDrops.has(key)))
      return false;
    if (Math.random() * 100 >= drop.chance) return false;
    grantedDrops.add(key);
    if (drop.onlyOnce) grantedOnlyOnceDrops.add(key);
    return true;
  });
  const rolled = postProcessRewards(
    collapseRewards([
      scalarRewards(rewards),
      ...drops.flatMap((drop) => {
        const quantity = drop.quantity ?? 1;
        if (drop.type === "package") {
          const snapshot = drop.package;
          if (!snapshot) throw new Error("Dungeon reward package snapshot is missing");
          return Array.from({ length: quantity }, () => snapshot.rewards);
        }
        // Caches remain item IDs; opening them belongs to the inventory flow.
        return [
          ObjectiveReward.parse(
            drop.type === "jutsu"
              ? { reward_jutsus: [drop.id] }
              : { reward_items: [{ ids: [drop.id], number: 100, quantity }] },
          ),
        ];
      }),
    ]),
  );
  return { ...rolled, grantedDrops: [...grantedDrops] };
};

/**
 * Bound every possible payout before expanding or rolling package quantities.
 * Run this on save and claim so persisted snapshots obey the same grant limits.
 * @param rewards Direct rewards and immutable package snapshots from a definition or run.
 * @returns A recoverable validation message, or null when all worst-case totals fit.
 */
export const dungeonRewardError = (
  rewards: DungeonContent["rewards"],
): string | null => {
  let total = 0;
  const amounts = scalarRewards(rewards);
  for (const drop of rewards.drops) {
    const quantity = drop.quantity ?? 1;
    if (drop.type === "package") {
      if (!drop.package)
        return "A dungeon reward package is missing. Save the dungeon again.";
      // Assume every drop succeeds; negative package amounts cannot offset payout bounds.
      for (const field of REWARD_CHOICE_AMOUNT_FIELDS) {
        amounts[field] =
          (amounts[field] ?? 0) + Math.abs(drop.package.rewards[field] ?? 0) * quantity;
        if (
          !Number.isFinite(amounts[field]) ||
          amounts[field] > DUNGEON_MAX_REWARD_AMOUNT
        )
          return `Dungeon rewards can grant at most ${DUNGEON_MAX_REWARD_AMOUNT.toLocaleString("en-US")} per scalar reward, including package contents.`;
      }
      // Match the shared item pipeline's minimum-one, integer quantity normalization.
      total +=
        quantity *
        drop.package.rewards.reward_items.reduce(
          (sum, entry) =>
            sum + entry.ids.length * Math.max(1, Math.floor(entry.quantity ?? 1)),
          0,
        );
    } else if (drop.type !== "jutsu") total += quantity;
    if (!Number.isFinite(total) || total > DUNGEON_MAX_GRANTED_ITEMS)
      return `Dungeon rewards can grant at most ${DUNGEON_MAX_GRANTED_ITEMS} items per player, including package contents.`;
  }
  return null;
};

/** A dungeon's guaranteed amounts as objective reward fields. */
const scalarRewards = (rewards: DungeonContent["rewards"]) =>
  ObjectiveReward.parse({
    reward_money: rewards.money,
    reward_exp: rewards.experience,
    reward_tokens: rewards.tokens,
    reward_prestige: rewards.prestige,
  });
