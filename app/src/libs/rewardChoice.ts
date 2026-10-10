import { QUEST_REWARD_PICK_MAX } from "@/drizzle/constants";
import type { QuestContentType } from "@/validators/objectives";
import {
  ObjectiveReward,
  type ObjectiveRewardType,
  type PendingRewardChoice,
  REWARD_CHOICE_AMOUNT_FIELDS,
  REWARD_CHOICE_CONTENT_FIELDS,
  type RewardChoiceAmountField,
  type RewardChoiceCard,
} from "@/validators/rewards";

/**
 * Reward choice ("choose N") for quest completion rewards.
 *
 * Pickable units: every non-zero scalar reward (ryo, exp, prestige, ...) is one card, every
 * reward item id in a `reward_items` entry is one card carrying that entry's quantity, and every
 * jutsu, bloodline, sage mode and badge id is one card. Rank promotion, village membership and
 * the hunter/gathering material drops are structural outcomes rather than loot, so they are always
 * granted alongside the picked cards. Picked items are guaranteed: the editor's drop chance only
 * applies to quests that grant every reward. Cards for content the player already holds stay on
 * the offer but cannot be picked, and one pick holds at most one sage mode.
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

/** Splits a reward into pickable cards, in a stable order with stable ids. */
export const buildRewardChoiceCards = (
  reward: ObjectiveRewardType,
): RewardChoiceCard[] => {
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
  return cards;
};

/** Sage modes fill the single equipped slot, so one pick holds at most one of them. */
export const isSageModeCard = (card: Pick<RewardChoiceCard, "field">) =>
  card.field === "reward_sage_modes";

/** Most cards one pick can hold: every non-sage card plus a single sage mode. */
export const maxRewardPicks = (cards: Pick<RewardChoiceCard, "field">[]) => {
  const sageModes = cards.filter(isSageModeCard).length;
  return cards.length - sageModes + Math.min(sageModes, 1);
};

/** Content the player already holds, used to find cards that would grant nothing. */
export type RewardChoiceOwnership = {
  jutsuIds: ReadonlySet<string>;
  bloodlineIds: ReadonlySet<string>;
  badgeIds: ReadonlySet<string>;
  /** Sage modes in the player's roll history. */
  sageModeIds: ReadonlySet<string>;
  /** The player has a sage mode equipped, so no sage mode card can be granted. */
  hasSageMode: boolean;
};

export const REWARD_CHOICE_OWNED_REASON = "Already owned";
export const REWARD_CHOICE_SAGE_EQUIPPED_REASON = "Sage mode already equipped";

/**
 * Cards this player cannot receive, keyed by card id with the reason shown on the card. Mirrors
 * the skips in `updateRewards`, which never inserts an owned jutsu, bloodline or badge and only
 * rolls a sage mode for a player without one.
 */
export const getUnavailableRewardCards = (
  cards: RewardChoiceCard[],
  ownership: RewardChoiceOwnership,
): Map<string, string> => {
  const unavailable = new Map<string, string>();
  for (const card of cards) {
    const id = card.contentId;
    if (!id) continue;
    if (card.field === "reward_sage_modes" && ownership.hasSageMode) {
      unavailable.set(card.id, REWARD_CHOICE_SAGE_EQUIPPED_REASON);
    } else if (
      (card.field === "reward_jutsus" && ownership.jutsuIds.has(id)) ||
      (card.field === "reward_bloodlines" && ownership.bloodlineIds.has(id)) ||
      (card.field === "reward_badges" && ownership.badgeIds.has(id)) ||
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
 * granted (cards the player cannot receive are left out and at most one sage mode counts).
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
 * receive, at most one sage mode, exactly the required count. Returns the picked cards in
 * offer order.
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
 * single-pick offer swaps the selection, a second sage mode replaces the selected one, and a
 * full multi-pick selection ignores new cards.
 */
export const toggleRewardPick = (
  selected: string[],
  cardId: string,
  required: number,
  cards: Pick<RewardChoiceCard, "id" | "field">[] = [],
): string[] => {
  if (selected.includes(cardId)) return selected.filter((id) => id !== cardId);
  if (required === 1) return [cardId];
  const sageIds = new Set(cards.filter(isSageModeCard).map((card) => card.id));
  const selectedSage = selected.find((id) => sageIds.has(id));
  if (selectedSage && sageIds.has(cardId)) {
    return selected.map((id) => (id === selectedSage ? cardId : id));
  }
  if (selected.length >= required) return selected;
  return [...selected, cardId];
};

/** Turns picked cards into a reward; items carry a 100% drop chance. */
export const rewardFromChoiceCards = (
  cards: RewardChoiceCard[],
): ObjectiveRewardType => {
  const reward = ObjectiveReward.parse({});
  for (const card of cards) {
    switch (card.field) {
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
        if (card.contentId) reward[card.field].push(card.contentId);
        break;
      default:
        reward[card.field] += card.amount;
    }
  }
  return reward;
};

/**
 * Save-time check for "choose" quests: the player must have more cards to choose from than
 * picks, otherwise the mode would just grant everything. Several sage mode cards are allowed
 * (choose one of them) but count as a single pickable reward.
 */
export const verifyRewardChoiceForSave = (
  content: Pick<QuestContentType, "reward" | "rewardMode" | "rewardPickCount">,
): { check: boolean; message: string } => {
  if (!isRewardChoiceQuest(content)) return { check: true, message: "" };
  const pickable = maxRewardPicks(
    buildRewardChoiceCards(ObjectiveReward.parse(content.reward)),
  );
  const pickCount = getRewardPickCount(content);
  if (pickable <= pickCount) {
    return {
      check: false,
      message: `Reward choice needs more pickable rewards than picks (sage modes count once): ${pickable} reward${pickable === 1 ? "" : "s"} for ${pickCount} pick${pickCount === 1 ? "" : "s"}`,
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
  } as Record<RewardChoiceCard["field"], string>;
