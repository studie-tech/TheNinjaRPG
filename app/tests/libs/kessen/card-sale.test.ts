import { describe, expect, it } from "bun:test";
import type { UserItemWithRelations } from "@/drizzle/schema";
import {
  auctionListingHref,
  canListAtAuction,
  cardSale,
  cardSaleBlockReason,
  deckCopySaleRefusals,
  hasOtherStack,
  isKessenGood,
  shortBlockReason,
} from "@/libs/kessen/cardSale";
import { DEFAULT_CARD_DATA } from "@/validators/itemCard";

const stack = (
  id: string,
  quantity: number,
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" = "COMMON",
  overrides: Partial<UserItemWithRelations> = {},
  cardData: Partial<typeof DEFAULT_CARD_DATA> = {},
) =>
  ({
    id,
    itemId: "kessen-moonprowler",
    quantity,
    isInAuction: false,
    equipped: "NONE",
    ...overrides,
    item: {
      id: "kessen-moonprowler",
      itemType: "CARD",
      rarity,
      cardData: { ...DEFAULT_CARD_DATA, ...cardData },
    },
  }) as unknown as UserItemWithRelations;

describe("cardSale", () => {
  it("offers no sale while every copy is within the copy limit", () => {
    const only = stack("a", 3);
    expect(cardSale(only, [only])).toEqual({
      kind: "kept",
      owned: 3,
      limit: 3,
      surplusElsewhere: false,
    });
    const epic = stack("e", 1, "EPIC");
    expect(cardSale(epic, [epic])).toEqual({
      kind: "kept",
      owned: 1,
      limit: 1,
      surplusElsewhere: false,
    });
    expect(cardSaleBlockReason(cardSale(only, [only]))).toBe("has no surplus");
  });

  it("offers the surplus of a stack that also holds deck copies", () => {
    const mixed = stack("a", 5);
    expect(cardSale(mixed, [mixed])).toEqual({
      kind: "mixed",
      surplus: 2,
      keep: 3,
      limit: 3,
    });
    expect(cardSaleBlockReason(cardSale(mixed, [mixed]))).toBeNull();
  });

  it("sells a whole stack once the other stacks hold the copy limit", () => {
    const kept = stack("a", 3);
    const surplus = stack("b", 2);
    const rows = [kept, surplus];
    expect(cardSale(surplus, rows)).toEqual({ kind: "surplus", copies: 2, limit: 3 });
    expect(cardSale(kept, rows)).toEqual({
      kind: "kept",
      owned: 5,
      limit: 3,
      surplusElsewhere: true,
    });
    expect(cardSaleBlockReason(cardSale(surplus, rows))).toBeNull();
    expect(cardSaleBlockReason(cardSale(kept, rows))).toBe("holds your deck copies");
  });

  it("counts surplus once across equal stacks, keeping the oldest for decks", () => {
    // A split leaves the deck copies on the older stack and the surplus on the new one.
    const older = stack("z", 3, "COMMON", { createdAt: new Date("2026-01-01") });
    const newer = stack("a", 3, "COMMON", { createdAt: new Date("2026-02-01") });
    const rows = [newer, older];
    expect(cardSale(older, rows)?.kind).toBe("kept");
    expect(cardSale(newer, rows)).toEqual({ kind: "surplus", copies: 3, limit: 3 });
    const kinds = rows.map((row) => cardSale(row, rows)?.kind);
    expect(kinds.filter((kind) => kind === "surplus")).toHaveLength(1);
  });

  it("splits the deck copies across stacks before any surplus", () => {
    const first = stack("a", 1, "COMMON", { createdAt: new Date("2026-01-01") });
    const second = stack("b", 5, "COMMON", { createdAt: new Date("2026-02-01") });
    const rows = [first, second];
    expect(cardSale(first, rows)?.kind).toBe("kept");
    expect(cardSale(second, rows)).toEqual({
      kind: "mixed",
      surplus: 3,
      keep: 2,
      limit: 3,
    });
  });

  it("leaves auction listings out of the copies decks can use", () => {
    const listed = stack("listed", 2, "COMMON", { isInAuction: true });
    const carried = stack("carried", 3);
    expect(cardSale(carried, [listed, carried])).toEqual({
      kind: "kept",
      owned: 3,
      limit: 3,
      surplusElsewhere: false,
    });
    expect(cardSale(listed, [listed, carried])).toEqual({ kind: "listed" });
  });

  it("never sells leaders or Forbidden variants", () => {
    const leader = stack("l", 3, "EPIC", {}, { kind: "LEADER", row: null });
    const forbidden = stack(
      "f",
      2,
      "LEGENDARY",
      {},
      { variant: "FORBIDDEN", baseCardId: "kessen-x" },
    );
    expect(cardSale(leader, [leader])?.kind).toBe("unsellable");
    expect(cardSale(forbidden, [forbidden])?.kind).toBe("unsellable");
    // Forbidden cards cannot go to the shop but can be auctioned.
    expect(cardSaleBlockReason(cardSale(forbidden, [forbidden]))).toBe(
      "can only be auctioned",
    );
  });

  it("ignores other items", () => {
    const gear = {
      ...stack("g", 1),
      item: { id: "sword", itemType: "WEAPON", rarity: "COMMON", cardData: null },
    } as unknown as UserItemWithRelations;
    expect(cardSale(gear, [gear])).toBeNull();
    expect(isKessenGood(gear.item)).toBe(false);
    expect(isKessenGood({ id: "kessen-pack-paper", itemType: "CONSUMABLE" })).toBe(
      true,
    );
  });
});

describe("hasOtherStack", () => {
  it("counts only other unlisted, unequipped stacks of the same item", () => {
    const a = stack("a", 1);
    expect(hasOtherStack(a, [a])).toBe(false);
    expect(hasOtherStack(a, [a, stack("b", 1, "COMMON", { isInAuction: true })])).toBe(
      false,
    );
    expect(hasOtherStack(a, [a, stack("b", 1)])).toBe(true);
  });
});

describe("tile reasons and auction links", () => {
  it("shortens block reasons for tiles and keeps unknown ones readable", () => {
    expect(shortBlockReason("is a leader; never sold")).toBe("Leader");
    expect(shortBlockReason("can only be auctioned")).toBe("Auction only");
    expect(shortBlockReason("has no surplus")).toBe("No surplus");
    expect(shortBlockReason("needs 5 farm coins to buy back")).toBe(
      "Needs 5 farm coins to buy back",
    );
  });

  it("offers an auction listing only for carried, tradeable, unlisted cards", () => {
    const row = {
      isInAuction: false,
      equipped: "NONE",
      quantity: 1,
      item: { canBeTraded: true, itemType: "CARD" },
    } as const;
    expect(canListAtAuction(row)).toBe(true);
    expect(canListAtAuction({ ...row, isInAuction: true })).toBe(false);
    expect(
      canListAtAuction({ ...row, item: { ...row.item, canBeTraded: false } }),
    ).toBe(false);
    expect(auctionListingHref("a b")).toBe("/auctionhouse?list=a%20b");
  });
});

describe("deckCopySaleRefusals", () => {
  it("refuses sales that leave fewer copies than a deck holds, judged on totals", () => {
    const deck = stack("deck", 3);
    const surplus = stack("surplus", 2);
    const listed = stack("listed", 4, "COMMON", { isInAuction: true });
    const owned = [deck, surplus, listed];
    expect(deckCopySaleRefusals([surplus], owned)).toEqual(new Set());
    // Selling the oldest stack would leave 2 of 3, however surplus is stacked.
    expect(deckCopySaleRefusals([deck], owned)).toEqual(new Set(["deck"]));
    expect(deckCopySaleRefusals([deck, surplus], owned)).toEqual(new Set(["deck"]));
  });

  it("takes stacks in sale order while the copies left stay at the limit", () => {
    const rows = [stack("a", 2), stack("b", 1), stack("c", 2), stack("d", 1)];
    // Seven copies: after a and b four are left, so c (2) is refused and d (1) still sells.
    expect(deckCopySaleRefusals(rows, [...rows, stack("e", 1)])).toEqual(
      new Set(["c"]),
    );
  });

  it("leaves other items alone", () => {
    const potion = {
      ...stack("potion", 5),
      item: { itemType: "CONSUMABLE", rarity: "COMMON" },
    } as unknown as UserItemWithRelations;
    expect(deckCopySaleRefusals([potion], [potion])).toEqual(new Set());
  });
});
