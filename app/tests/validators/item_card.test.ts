import { describe, expect, it } from "bun:test";
import {
  KESSEN_AUCTION_FLOORS,
  KESSEN_FORBIDDEN_AUCTION_FLOOR,
  NonActionItemTypes,
  NonBattleItemTypes,
} from "@/drizzle/constants";
import { ItemValidator } from "@/validators/combat";
import { itemCreateSchema } from "@/validators/item";
import {
  CARD_ITEM_DEFAULTS,
  cardItemSchema,
  DEFAULT_CARD_DATA,
} from "@/validators/itemCard";

const card = {
  ...CARD_ITEM_DEFAULTS,
  itemType: "CARD",
  cardData: DEFAULT_CARD_DATA,
  name: "Moonprowler",
  image: "/images/cards/moonprowler.webp",
  description: "It hunts by the light it steals.",
  rarity: "COMMON",
  hidden: false,
  inShop: false,
  cost: 0,
  repsCost: 0,
  seichiSilverCost: 0,
  expireFromStoreAt: null,
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  bloodlineId: null,
};

const twoKeywords = [
  { k: "strike", x: 3, mode: "single" },
  { k: "rally", x: 1 },
];

describe("card item content", () => {
  it("joins the non-battle and non-action item types", () => {
    expect(NonBattleItemTypes).toContain("CARD");
    expect(NonActionItemTypes).toContain("CARD");
    expect(itemCreateSchema.parse({ type: "CARD" })).toEqual({ type: "CARD" });
  });

  it("accepts a card with stats and free grant-only cards outside the shop", () => {
    expect(ItemValidator.safeParse(card).success).toBe(true);
    expect(ItemValidator.safeParse({ ...card, cost: 1500 }).success).toBe(true);
    const forSale = ItemValidator.safeParse({ ...card, inShop: true });
    expect(forSale.success).toBe(false);
  });

  it("requires card stats on cards and forbids them elsewhere", () => {
    expect(cardItemSchema.parse({})).toEqual({ cardData: null });
    expect(ItemValidator.safeParse({ ...card, cardData: null }).success).toBe(false);
    expect(
      ItemValidator.safeParse({
        ...card,
        itemType: "MATERIAL",
        cost: 1,
        maxDurability: 100,
        maxImbueNumber: 1,
        canStack: false,
      }).success,
    ).toBe(false);
  });

  it.each([
    { slot: "ITEM" },
    { maxEquips: 1 },
    { preventBattleUsage: false },
    { battleUsageType: "PVP" },
    { canBeImbued: true },
    { canBeCrafted: true },
    { maxDurability: 100 },
    { canStack: false },
    { chakraCost: 1 },
    {
      effects: [
        {
          type: "increasemastery",
          masteryTypes: ["Ninjutsu"],
          calculation: "static",
          power: 10,
          powerPerLevel: 0,
        },
      ],
    },
  ])("rejects battle configuration %j", (patch) => {
    expect(ItemValidator.safeParse({ ...card, ...patch }).success).toBe(false);
  });

  it("counts repeated verbs as one keyword and limits keywords by rarity", () => {
    const withAbilities = (rarity: string, abilities: unknown[]) =>
      ItemValidator.safeParse({
        ...card,
        rarity,
        cardData: { ...DEFAULT_CARD_DATA, abilities },
      }).success;
    expect(
      withAbilities("COMMON", [
        { k: "strike", x: 3, mode: "single" },
        { k: "strike", x: 2, mode: "single" },
      ]),
    ).toBe(true);
    // Resilient and granting Resilient print the same keyword.
    expect(
      withAbilities("EPIC", [
        { k: "strike", x: 3, mode: "single" },
        { k: "resilient" },
        { k: "grantResilient" },
      ]),
    ).toBe(true);
    const common = ItemValidator.safeParse({
      ...card,
      cardData: { ...DEFAULT_CARD_DATA, abilities: twoKeywords },
    });
    expect(common.success).toBe(false);
    if (!common.success)
      expect(common.error.issues).toContainEqual(
        expect.objectContaining({ path: ["cardData", "abilities"] }),
      );
    expect(
      ItemValidator.safeParse({
        ...card,
        rarity: "EPIC",
        cardData: { ...DEFAULT_CARD_DATA, abilities: twoKeywords },
      }).success,
    ).toBe(true);
    expect(
      ItemValidator.safeParse({
        ...card,
        cardData: {
          ...DEFAULT_CARD_DATA,
          kind: "LEADER",
          row: null,
          provision: 0,
          abilities: [...twoKeywords, { k: "seal", mode: "single" }],
        },
      }).success,
    ).toBe(true);
  });

  it("trades only epic and legendary deck cards above their auction floors", () => {
    expect(ItemValidator.safeParse({ ...card, canBeTraded: true }).success).toBe(false);
    const epic = { ...card, rarity: "EPIC" };
    expect(ItemValidator.safeParse({ ...epic, canBeTraded: true }).success).toBe(false);
    expect(
      ItemValidator.safeParse({
        ...epic,
        canBeTraded: true,
        auctionMinPrice: KESSEN_AUCTION_FLOORS.EPIC,
      }).success,
    ).toBe(true);
    expect(
      ItemValidator.safeParse({
        ...epic,
        canBeTraded: true,
        auctionMinPrice: KESSEN_AUCTION_FLOORS.EPIC,
        cardData: {
          ...DEFAULT_CARD_DATA,
          variant: "FORBIDDEN",
          baseCardId: "kessen-moonprowler",
        },
      }).success,
    ).toBe(false);
    expect(
      ItemValidator.safeParse({
        ...epic,
        canBeTraded: true,
        auctionMinPrice: KESSEN_FORBIDDEN_AUCTION_FLOOR,
        cardData: {
          ...DEFAULT_CARD_DATA,
          variant: "FORBIDDEN",
          baseCardId: "kessen-moonprowler",
        },
      }).success,
    ).toBe(true);
    expect(
      ItemValidator.safeParse({
        ...epic,
        canBeTraded: true,
        auctionMinPrice: KESSEN_AUCTION_FLOORS.EPIC,
        cardData: { ...DEFAULT_CARD_DATA, kind: "LEADER", row: null, provision: 0 },
      }).success,
    ).toBe(false);
  });
});
