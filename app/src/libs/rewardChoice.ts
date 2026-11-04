import { QUEST_REWARD_PICK_MAX } from "@/drizzle/constants";
import {
  canPromoteMastery,
  type MasteryProgressionSource,
} from "@/libs/masteryProgression";
import { collapseRewards } from "@/libs/rewards";
import type { QuestContentType } from "@/validators/objectives";
import { QuestReward, type QuestRewardType } from "@/validators/rewardPackages";
import {
  hasReward,
  ObjectiveReward,
  type ObjectiveRewardType,
  type PendingRewardChoice,
  REWARD_CHOICE_AMOUNT_FIELDS,
  REWARD_CHOICE_CONTENT_FIELDS,
  type RewardChoiceAmountField,
  type RewardChoiceCard,
  hasMasteryPromotion,
} from "@/validators/rewards";

/**
 * Reward choice ("choose N") for quest completion rewards.
 *
 * Pickable units: every scalar reward (ryo, exp, prestige, ...) whose floored amount is
 * positive is one card. Every reward item id in a `reward_items` entry is one card carrying
 * that entry's quantity, and every jutsu, bloodline, sage mode and badge id is one card.
 * Rank promotion, village membership and the hunter/gathering material drops in direct
 * rewards are structural outcomes rather than loot,
 * so they are granted alongside the picked cards. Direct item cards are guaranteed. Package cards
 * retain their full payload, including structural outcomes and item chances, until that bundle
 * is picked. Cards for content the player already holds stay on
 * the offer but cannot be picked, and one selection holds at most one sage mode and one
 * mastery promotion.
 */

/** Whether the quest grants a player-picked subset of its completion reward. */
export const isRewardChoiceQuest = (
  content: Pick<QuestContentType, "rewardMode"> | null | undefined,
) => content?.rewardMode === "choose";

/** Configured pick count, clamped to the supported range for content saved without one. */
export const getRewardPickCount = (
  content: Pick<QuestContentType, "rewardPickCount"> | null | undefined,
) => {
  const count = Math.floor(Number(content?.rewardPickCount ?? 1));
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(count, 1), QUEST_REWARD_PICK_MAX);
};

/** The always-granted part of a "choose" quest reward (everything that is not a card). */
export const getFixedChoiceRewards = (
  reward: ObjectiveRewardType,
): ObjectiveRewardType =>
  ObjectiveReward.parse({
    reward_rank: reward.reward_rank,
    reward_mastery_stat: reward.reward_mastery_stat,
    reward_mastery_rank: reward.reward_mastery_rank,
    reward_village_membership: reward.reward_village_membership,
    reward_hunter_items: reward.reward_hunter_items,
    reward_hunter_items_ids: reward.reward_hunter_items_ids,
    reward_gathering_items: reward.reward_gathering_items,
    reward_gathering_items_ids: reward.reward_gathering_items_ids,
  });

/** Split direct fields into cards and each saved package into one bundle, with stable ids/order. */
export const buildRewardChoiceCards = (reward: QuestRewardType): RewardChoiceCard[] => {
  const cards: RewardChoiceCard[] = [];
  for (const field of REWARD_CHOICE_AMOUNT_FIELDS) {
    const amount = Math.floor(Number(reward[field] ?? 0));
    if (amount > 0) cards.push({ id: field, field, amount });
  }
  (reward.reward_items ?? []).forEach((entry, entryIndex) => {
    const quantity = Math.max(1, Math.floor(entry.quantity ?? 1));
    for (const contentId of new Set(entry.ids ?? [])) {
      cards.push({
        id: `reward_items:${entryIndex}:${contentId}`,
        field: "reward_items",
        amount: quantity,
        contentId,
      });
    }
  });
  for (const field of REWARD_CHOICE_CONTENT_FIELDS) {
    if (field === "reward_items") continue;
    for (const contentId of new Set(reward[field] ?? [])) {
      cards.push({ id: `${field}:${contentId}`, field, amount: 1, contentId });
    }
  }
  for (const pack of reward.reward_packages ?? []) {
    if (!hasReward(pack.rewards)) continue;
    cards.push({
      id: `reward_package:${pack.id}`,
      field: "reward_package",
      amount: 1,
      packageName: pack.name,
      rewards: pack.rewards,
    });
  }
  return cards;
};

/** Sage modes fill the single equipped slot, so one pick holds at most one of them. */
export const isSageModeCard = (card: Pick<RewardChoiceCard, "field" | "rewards">) =>
  card.field === "reward_sage_modes" ||
  (card.rewards?.reward_sage_modes.length ?? 0) > 0;

/** The reward payload carries one mastery promotion, so promotion bundles are alternatives. */
export const isMasteryPromotionCard = (card: Pick<RewardChoiceCard, "rewards">) =>
  !!card.rewards && hasMasteryPromotion(card.rewards);

/** Most compatible cards: unrestricted cards plus one sage mode and one mastery promotion. */
export const maxRewardPicks = (
  cards: Pick<RewardChoiceCard, "field" | "rewards">[],
) => {
  const sageModes = cards.filter(isSageModeCard);
  const promotions = cards.filter(isMasteryPromotionCard);
  const both = sageModes.filter(isMasteryPromotionCard).length;
  // A bundle occupying both slots competes with a separate card for each slot.
  return (
    cards.length -
    sageModes.length -
    promotions.length +
    both +
    Math.max(
      Math.min(sageModes.length - both, 1) + Math.min(promotions.length - both, 1),
      Math.min(both, 1),
    )
  );
};

/** Owned content and stored progression used to find unavailable cards. */
export type RewardChoiceOwnership = {
  jutsuIds: ReadonlySet<string>;
  bloodlineIds: ReadonlySet<string>;
  badgeIds: ReadonlySet<string>;
  /** All collected titles, including archived ones, are unavailable as duplicate choices. */
  titleIds?: ReadonlySet<string>;
  /** Missing, archived or private catalog references cannot be claimed even when unowned. */
  unavailableTitleIds?: ReadonlySet<string>;
  /** Sage modes in the player's roll history. */
  sageModeIds: ReadonlySet<string>;
  /** The player has a sage mode equipped, so no sage mode card can be granted. */
  hasSageMode: boolean;
  /** Stored discipline ranks used to enforce each bundle's immediately preceding promotion rank. */
  masteryRanks?: MasteryProgressionSource["masteryRanks"];
};

export const REWARD_CHOICE_OWNED_REASON = "Already owned";
export const REWARD_CHOICE_SAGE_EQUIPPED_REASON = "Sage mode already equipped";

/**
 * Cards this player cannot receive, keyed by card id with the reason shown on the card. Mirrors
 * the guards in `updateRewards`: owned content is skipped, sage modes need an empty slot and
 * mastery promotions require the immediately preceding stored rank.
 */
export const getUnavailableRewardCards = (
  cards: RewardChoiceCard[],
  ownership: RewardChoiceOwnership,
): Map<string, string> => {
  const unavailable = new Map<string, string>();
  for (const card of cards) {
    if (card.field === "reward_package" && card.rewards) {
      const { rewards } = card;
      if (
        hasMasteryPromotion(rewards) &&
        !canPromoteMastery(
          ownership,
          rewards.reward_mastery_stat,
          rewards.reward_mastery_rank,
        )
      ) {
        unavailable.set(card.id, "Requires the previous mastery rank");
        continue;
      }
      if (!hasReward(card.rewards)) {
        unavailable.set(card.id, "No rewards available");
        continue;
      }
      const childCards = buildRewardChoiceCards(card.rewards);
      const blocked = getUnavailableRewardCards(childCards, ownership);
      const fixed = getFixedChoiceRewards(card.rewards);
      if (
        childCards.length > 0 &&
        blocked.size === childCards.length &&
        !hasReward(fixed)
      )
        unavailable.set(card.id, REWARD_CHOICE_OWNED_REASON);
      continue;
    }
    const id = card.contentId;
    if (!id) continue;
    if (card.field === "reward_titles" && ownership.unavailableTitleIds?.has(id)) {
      unavailable.set(card.id, "Title is no longer available");
    } else if (card.field === "reward_sage_modes" && ownership.hasSageMode) {
      unavailable.set(card.id, REWARD_CHOICE_SAGE_EQUIPPED_REASON);
    } else if (
      (card.field === "reward_jutsus" && ownership.jutsuIds.has(id)) ||
      (card.field === "reward_bloodlines" && ownership.bloodlineIds.has(id)) ||
      (card.field === "reward_badges" && ownership.badgeIds.has(id)) ||
      (card.field === "reward_titles" && ownership.titleIds?.has(id)) ||
      (card.field === "reward_sage_modes" && ownership.sageModeIds.has(id))
    ) {
      unavailable.set(card.id, REWARD_CHOICE_OWNED_REASON);
    }
  }
  return unavailable;
};

type CardIdLookup = Pick<ReadonlySet<string>, "has">;

/**
 * How many cards the player must pick: the configured count, capped by what can still be
 * granted (unavailable cards are left out, with one sage mode and one mastery promotion).
 * Zero means nothing on the offer can be granted any more; claiming it with no picks clears it.
 */
export const requiredRewardPicks = (
  choice: Pick<PendingRewardChoice, "pickCount" | "cards">,
  unavailable: CardIdLookup = new Set<string>(),
) =>
  Math.min(
    choice.pickCount,
    maxRewardPicks(choice.cards.filter((card) => !unavailable.has(card.id))),
  );

/**
 * Validates a pick against the frozen offer: distinct ids, all offered, none the player cannot
 * receive, at most one sage mode and one mastery promotion, exactly the required count.
 * Returns the picked cards in offer order; run this before consuming the offer's CAS.
 */
export const validateRewardPicks = (
  choice: PendingRewardChoice,
  cardIds: string[],
  unavailable: ReadonlyMap<string, string> = new Map<string, string>(),
):
  | { success: true; cards: RewardChoiceCard[] }
  | { success: false; message: string } => {
  const picked = new Set(cardIds);
  if (picked.size !== cardIds.length) {
    return { success: false, message: "Each reward can only be picked once" };
  }
  const cards = choice.cards.filter((card) => picked.has(card.id));
  if (cards.length !== picked.size) {
    return { success: false, message: "That reward is not part of this offer" };
  }
  const blocked = cards.find((card) => unavailable.has(card.id));
  if (blocked) {
    return {
      success: false,
      message: `${unavailable.get(blocked.id)}: pick a different reward`,
    };
  }
  if (cards.filter(isSageModeCard).length > 1) {
    return { success: false, message: "Only one sage mode can be picked" };
  }
  if (cards.filter(isMasteryPromotionCard).length > 1) {
    return { success: false, message: "Only one mastery promotion can be picked" };
  }
  const required = requiredRewardPicks(choice, unavailable);
  if (picked.size !== required) {
    return {
      success: false,
      message: `Pick exactly ${required} reward${required === 1 ? "" : "s"}`,
    };
  }
  return { success: true, cards };
};

/**
 * Next selection after the player clicks a card: clicking a selected card deselects it, a
 * single-pick offer swaps the selection, a sage mode or mastery promotion replaces conflicting
 * cards, and a full compatible multi-pick selection ignores new cards.
 */
export const toggleRewardPick = (
  selected: string[],
  cardId: string,
  required: number,
  cards: Pick<RewardChoiceCard, "id" | "field" | "rewards">[] = [],
): string[] => {
  if (selected.includes(cardId)) return selected.filter((id) => id !== cardId);
  if (required === 1) return [cardId];
  const card = cards.find((candidate) => candidate.id === cardId);
  const conflicts = new Set(
    cards
      .filter(
        (candidate) =>
          card &&
          ((isSageModeCard(card) && isSageModeCard(candidate)) ||
            (isMasteryPromotionCard(card) && isMasteryPromotionCard(candidate))),
      )
      .map((candidate) => candidate.id),
  );
  const firstConflict = selected.find((id) => conflicts.has(id));
  if (firstConflict) {
    return selected
      .filter((id) => !conflicts.has(id) || id === firstConflict)
      .map((id) => (id === firstConflict ? cardId : id));
  }
  if (selected.length >= required) return selected;
  return [...selected, cardId];
};

/** Merge picked bundles unchanged; only individually picked item cards receive a 100% chance. */
export const rewardFromChoiceCards = (
  cards: RewardChoiceCard[],
): ObjectiveRewardType => {
  let reward = ObjectiveReward.parse({});
  for (const card of cards) {
    switch (card.field) {
      case "reward_package":
        if (card.rewards) reward = collapseRewards([reward, card.rewards]);
        break;
      case "reward_items":
        if (card.contentId) {
          reward.reward_items.push({
            ids: [card.contentId],
            number: 100,
            quantity: card.amount,
          });
        }
        break;
      case "reward_jutsus":
      case "reward_bloodlines":
      case "reward_sage_modes":
      case "reward_badges":
      case "reward_titles":
        if (card.contentId) reward[card.field].push(card.contentId);
        break;
      default:
        // Optional XP fields are absent from an empty reward until their card is picked.
        reward[card.field] = (reward[card.field] ?? 0) + card.amount;
    }
  }
  return reward;
};

/**
 * Save-time check for "choose" quests: the player must have more cards to choose from than
 * picks, otherwise the mode would just grant everything. Sage modes and mastery promotions
 * each occupy a single slot; a bundle containing both occupies both slots.
 */
export const verifyRewardChoiceForSave = (
  content: Pick<QuestContentType, "reward" | "rewardMode" | "rewardPickCount">,
): { check: boolean; message: string } => {
  if (!isRewardChoiceQuest(content)) return { check: true, message: "" };
  const pickable = maxRewardPicks(
    buildRewardChoiceCards(QuestReward.parse(content.reward)),
  );
  const pickCount = getRewardPickCount(content);
  if (pickable <= pickCount) {
    return {
      check: false,
      message: `Reward choice needs more pickable rewards than picks (one sage mode and one mastery promotion): ${pickable} reward${pickable === 1 ? "" : "s"} for ${pickCount} pick${pickCount === 1 ? "" : "s"}`,
    };
  }
  return { check: true, message: "" };
};

/** Shown when a "choose" quest is completed again before the previous offer was picked. */
export const REWARD_CHOICE_PENDING_MESSAGE =
  "Choose your reward from the previous completion of this quest first";

/** Appended to a completion's notifications when its reward waits to be picked. */
export const REWARD_CHOICE_READY_MESSAGE = "Choose your reward to claim it.";

/** Player-facing names of the scalar reward cards. */
export const REWARD_CHOICE_AMOUNT_LABELS: Record<RewardChoiceAmountField, string> = {
  reward_ninjutsu_experience: "Ninjutsu Mastery XP",
  reward_genjutsu_experience: "Genjutsu Mastery XP",
  reward_taijutsu_experience: "Taijutsu Mastery XP",
  reward_bukijutsu_experience: "Bukijutsu Mastery XP",
  reward_bloodline_experience: "Bloodline Mastery XP",
  reward_sage_stat_experience: "Sage Mastery XP",
  reward_money: "Ryo",
  reward_seichi_silver: "Seichi Silver",
  reward_clanpoints: "Clan Points",
  reward_anbupoints: "Anbu Points",
  reward_exp: "Experience",
  reward_pet_experience: "Pet Experience",
  reward_tokens: "Village Tokens",
  reward_prestige: "Prestige",
  reward_reputation: "Reputation Points",
  reward_skillpoints: "Skill Points",
  reward_medical_experience: "Medical Experience",
  reward_hunting_experience: "Hunting Experience",
  reward_crafting_experience: "Crafting Experience",
  reward_gathering_experience: "Gathering Experience",
  reward_sage_mastery_experience: "Sage Mastery Experience",
  reward_war_damage: "War Damage to Enemy",
  reward_war_healing: "War Health Restored",
};

/** Player-facing category of each card kind. */
export const REWARD_CHOICE_CATEGORY_LABELS: Record<RewardChoiceCard["field"], string> =
  {
    ...Object.fromEntries(
      REWARD_CHOICE_AMOUNT_FIELDS.map((field) => [field, "Currency"]),
    ),
    reward_exp: "Experience",
    reward_pet_experience: "Experience",
    reward_medical_experience: "Experience",
    reward_hunting_experience: "Experience",
    reward_crafting_experience: "Experience",
    reward_gathering_experience: "Experience",
    reward_sage_mastery_experience: "Experience",
    reward_skillpoints: "Progression",
    reward_war_damage: "War Effort",
    reward_war_healing: "War Effort",
    reward_items: "Item",
    reward_jutsus: "Jutsu",
    reward_bloodlines: "Bloodline",
    reward_sage_modes: "Sage Mode",
    reward_badges: "Badge",
    reward_titles: "Title",
    reward_package: "Reward Package",
  } as Record<RewardChoiceCard["field"], string>;
