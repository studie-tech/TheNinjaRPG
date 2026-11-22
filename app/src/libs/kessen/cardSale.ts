import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import { isDropOnlyItem, isUnsellableCard } from "@/libs/item";
import { isKessenPackId } from "@/libs/kessen/packs";

/**
 * What the sell flow may do with one Kessen card stack. Only surplus copies, those beyond
 * the copy limit a deck can hold, are offered. Surplus is judged across every unlisted
 * stack of the card: the oldest stacks hold the copies decks use (`keptFirst`), and only
 * the copies after them are surplus, so two stacks of one card never both count as surplus.
 * Copies listed in the auction house cannot enter decks and do not count toward the limit.
 * Selling removes a whole stack, so a stack holding both deck copies and surplus is split
 * before its surplus can be sold.
 */
export const cardSale = (
  userItem: CardSaleRow & {
    item: Pick<Item, "id" | "itemType" | "rarity" | "cardData">;
  },
  allUserItems: CardSaleRow[],
): CardSale | null => {
  const { item } = userItem;
  if (item.itemType !== "CARD") return null;
  if (isUnsellableCard(item)) {
    return item.cardData?.kind === "LEADER"
      ? {
          kind: "unsellable",
          reason: "is a leader; never sold",
          detail: "is a leader. Leaders are never sold and stay in your collection",
        }
      : {
          kind: "unsellable",
          reason: "can only be auctioned",
          detail:
            "is a Forbidden card. It cannot be sold to the shop, but it can be listed in the auction house",
        };
  }
  if (userItem.isInAuction) return { kind: "listed" };
  const rows = allUserItems.some((row) => row.id === userItem.id)
    ? allUserItems
    : [...allUserItems, userItem];
  const stacks = rows
    .filter(
      (row) => row.itemId === userItem.itemId && row.quantity > 0 && !row.isInAuction,
    )
    .sort(keptFirst);
  const limit = KESSEN_COPY_LIMITS[item.rarity];
  const owned = stacks.reduce((sum, row) => sum + row.quantity, 0);
  // Deck copies fill the stacks in order; whatever a stack holds after them is surplus.
  let deckCopiesLeft = limit;
  for (const row of stacks) {
    const keep = Math.min(row.quantity, deckCopiesLeft);
    deckCopiesLeft -= keep;
    if (row.id !== userItem.id) continue;
    const surplus = row.quantity - keep;
    if (surplus === 0) {
      return { kind: "kept", owned, limit, surplusElsewhere: owned > limit };
    }
    if (keep === 0) return { kind: "surplus", copies: row.quantity, limit };
    return { kind: "mixed", surplus, keep, limit };
  }
  return { kind: "kept", owned, limit, surplusElsewhere: owned > limit };
};

/**
 * The stacks of a sale that would leave a card with fewer unlisted copies than a deck can
 * hold. The check runs on totals, not on stack order, so a split-then-sell of surplus passes
 * while any sale that eats into deck copies is refused. Stacks are taken in sale order.
 */
export const deckCopySaleRefusals = (
  sale: (Pick<CardSaleRow, "id" | "itemId" | "quantity"> & {
    item: Pick<Item, "itemType" | "rarity">;
  })[],
  ownedStacks: Pick<CardSaleRow, "itemId" | "quantity" | "isInAuction">[],
): Set<string> => {
  const copiesLeft = new Map<string, number>();
  for (const row of ownedStacks) {
    if (row.quantity <= 0 || row.isInAuction) continue;
    copiesLeft.set(row.itemId, (copiesLeft.get(row.itemId) ?? 0) + row.quantity);
  }
  const refused = new Set<string>();
  for (const stack of sale) {
    if (stack.item.itemType !== "CARD") continue;
    const left = (copiesLeft.get(stack.itemId) ?? 0) - stack.quantity;
    if (left < KESSEN_COPY_LIMITS[stack.item.rarity]) refused.add(stack.id);
    else copiesLeft.set(stack.itemId, left);
  }
  return refused;
};

/** Why a card sale was refused for taking deck copies, as a phrase after its name. */
export const DECK_COPIES_SALE_REASON =
  "holds your deck copies; only surplus copies sell";

/** Why a card stack cannot be ticked for a bulk sale, as a short phrase after its name. */
export const cardSaleBlockReason = (sale: CardSale | null): string | null => {
  if (!sale) return null;
  switch (sale.kind) {
    case "unsellable":
      return sale.reason;
    case "listed":
      return "is listed at auction";
    case "kept":
      return sale.surplusElsewhere ? "holds your deck copies" : "has no surplus";
    case "mixed":
    case "surplus":
      return null;
  }
};

/**
 * Kessen packs that no shop sells (the Lacquer Case) are earned, so the sell flow neither
 * sells nor drops them: opening them is their only use.
 */
export const isEarnedKessenPack = (
  item: Pick<Item, "id" | "itemType" | "isEventItem" | "inShop">,
) => isKessenPackId(item.id) && isDropOnlyItem(item);

/** Why an earned pack cannot be ticked for a bulk sale, as a phrase after its name. */
export const EARNED_PACK_BLOCK_REASON = "is an earned pack; open it instead";

/** A block reason short enough for a tile, such as "Leader" or "No surplus". */
export const shortBlockReason = (reason: string) =>
  SHORT_BLOCK_REASONS[reason] ?? reason.charAt(0).toUpperCase() + reason.slice(1);

const SHORT_BLOCK_REASONS: Record<string, string> = {
  "is a leader; never sold": "Leader",
  "can only be auctioned": "Auction only",
  "is listed at auction": "Listed",
  "holds your deck copies": "Deck copies",
  "has no surplus": "No surplus",
  "is equipped": "Equipped",
  [EARNED_PACK_BLOCK_REASON]: "Earned pack",
  [DECK_COPIES_SALE_REASON]: "Deck copies",
};

/** The other unlisted stack of a card that holds its surplus copies, if there is one. */
export const surplusStackOf = <T extends CardSaleRow & { item: Item }>(
  userItem: CardSaleRow,
  allUserItems: T[],
) =>
  allUserItems.find(
    (row) =>
      row.itemId === userItem.itemId &&
      row.id !== userItem.id &&
      cardSale(row, allUserItems)?.kind === "surplus",
  );

/** Whether a card the shop never buys can go to the auction house from this stack. */
export const canListAtAuction = (
  userItem: Pick<UserItemWithRelations, "isInAuction" | "equipped" | "quantity"> & {
    item: Pick<Item, "canBeTraded" | "itemType">;
  },
) =>
  userItem.item.itemType === "CARD" &&
  userItem.item.canBeTraded &&
  !userItem.isInAuction &&
  userItem.equipped === "NONE" &&
  userItem.quantity > 0;

/** The auction house with its new-listing dialog open on one stack. */
export const auctionListingHref = (userItemId: string) =>
  `/auctionhouse?list=${encodeURIComponent(userItemId)}`;

/** Kessen cards and card packs, which skip equipment-only controls and stats. */
export const isKessenGood = (item: Pick<Item, "id" | "itemType">) =>
  item.itemType === "CARD" || isKessenPackId(item.id);

/** Whether another unlisted backpack stack of the same item exists to merge with. */
export const hasOtherStack = (
  userItem: Pick<UserItemWithRelations, "id" | "itemId">,
  allUserItems: Pick<
    UserItemWithRelations,
    "id" | "itemId" | "quantity" | "isInAuction" | "equipped"
  >[],
) =>
  allUserItems.some(
    (row) =>
      row.itemId === userItem.itemId &&
      row.id !== userItem.id &&
      row.quantity > 0 &&
      !row.isInAuction &&
      row.equipped === "NONE",
  );

/** "1 surplus copy", "3 surplus copies". */
export const surplusCopiesLabel = (copies: number) =>
  `${copies} surplus ${copies === 1 ? "copy" : "copies"}`;

/** Oldest stack first, then by id, so every caller assigns deck copies the same way. */
const keptFirst = (a: CardSaleRow, b: CardSaleRow) => {
  const age = stackTime(a) - stackTime(b);
  return age !== 0 ? age : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const stackTime = (row: CardSaleRow) =>
  row.createdAt ? new Date(row.createdAt).getTime() : 0;

/** The stack fields surplus is judged by. */
type CardSaleRow = Pick<
  UserItemWithRelations,
  "id" | "itemId" | "quantity" | "isInAuction"
> & {
  createdAt?: Date | null;
};

/** The sale options of one card stack. */
export type CardSale =
  /** Leaders and Forbidden variants never sell to the shop. */
  | { kind: "unsellable"; reason: string; detail: string }
  /** The stack is listed in the auction house. */
  | { kind: "listed" }
  /** Every copy of the stack is a deck copy; `surplusElsewhere` when another stack holds surplus. */
  | { kind: "kept"; owned: number; limit: number; surplusElsewhere: boolean }
  /** The stack holds deck copies and `surplus` beyond them; `keep` stays on a split. */
  | { kind: "mixed"; surplus: number; keep: number; limit: number }
  /** Every copy of the stack is beyond the copy limit. */
  | { kind: "surplus"; copies: number; limit: number };
