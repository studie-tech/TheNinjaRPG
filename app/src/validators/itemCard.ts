import { z } from "zod";
import { KESSEN_CARD_STACK_SIZE } from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";

/** Factions a Kessen card can belong to; NEUTRAL cards fit every deck. */
export const KessenFactions = [
  "SHIROHANA",
  "TSUKIMORI",
  "HYORIN",
  "AKASUMI",
  "AKIKAZE",
  "SYNDICATE",
  "NEUTRAL",
] as const;
export type KessenFaction = (typeof KessenFactions)[number];

/** Board rows, from the centre line outward: Taijutsu, Bukijutsu, Ninjutsu. */
export const KessenRows = ["CLOSE", "RANGED", "JUTSU"] as const;
export type KessenRow = (typeof KessenRows)[number];

export const KessenCardKinds = ["UNIT", "TACTIC", "LEADER"] as const;
export type KessenCardKind = (typeof KessenCardKinds)[number];

export const KessenCardVariants = ["STANDARD", "FORBIDDEN"] as const;
export type KessenCardVariant = (typeof KessenCardVariants)[number];

const amount = z.coerce.number().int().min(1).max(20);
const groupName = z.string().trim().min(1).max(40);

/**
 * One ability of a card, in printed order. The same list drives the engine and the
 * rendered card text, so they cannot diverge. Leader-only verbs (draw, fence, recall,
 * allHands, cycle) are rejected on deck cards by `cardDataSchema`.
 */
export const kessenAbilitySchema = z.discriminatedUnion("k", [
  z.strictObject({
    k: z.literal("strike"),
    x: amount,
    mode: z.enum(["single", "oppositeRow", "chosenRow", "allEnemies"]),
    sameTarget: z.literal(true).optional(),
  }),
  z.strictObject({
    k: z.literal("empower"),
    x: amount,
    mode: z.enum(["single", "ownRowOthers", "chosenRow", "allMine"]),
  }),
  z.strictObject({ k: z.literal("rally"), x: amount }),
  z.strictObject({ k: z.literal("bond"), group: groupName }),
  z.strictObject({ k: z.literal("meditate"), x: amount }),
  z.strictObject({ k: z.literal("summon"), group: groupName }),
  z.strictObject({ k: z.literal("infiltrator") }),
  z.strictObject({ k: z.literal("revive"), times: z.literal(2).optional() }),
  z.strictObject({ k: z.literal("substitution") }),
  z.strictObject({ k: z.literal("resilient") }),
  z.strictObject({ k: z.literal("grantResilient") }),
  z.strictObject({
    k: z.literal("purge"),
    mode: z.enum(["oppositeRow", "chosenRow", "eachEnemyRow"]),
  }),
  z.strictObject({
    k: z.literal("terrain"),
    row: z.enum(["CLOSE", "RANGED", "JUTSU", "chosen", "enemyMostUnits"]),
  }),
  z.strictObject({ k: z.literal("clearSkies") }),
  z.strictObject({ k: z.literal("unyielding") }),
  z.strictObject({
    k: z.literal("seal"),
    mode: z.enum(["single", "chosenEnemyRow", "joinRowOthers", "upTo2"]),
  }),
  z.strictObject({
    k: z.literal("draw"),
    x: amount,
    ifKilled: z.literal(true).optional(),
  }),
  z.strictObject({ k: z.literal("fence") }),
  z.strictObject({ k: z.literal("recall") }),
  z.strictObject({ k: z.literal("allHands") }),
  z.strictObject({ k: z.literal("cycle"), x: amount }),
]);
export type KessenAbility = z.output<typeof kessenAbilitySchema>;
export type KessenAbilityKind = KessenAbility["k"];

/** Verbs only a leader may carry. */
export const KESSEN_LEADER_ONLY_ABILITIES = [
  "draw",
  "fence",
  "recall",
  "allHands",
  "cycle",
] as const satisfies readonly KessenAbilityKind[];

/** Kessen card stats stored on `Item.cardData`; the item row keeps name, rarity and art. */
export const cardDataSchema = z
  .strictObject({
    kind: z.enum(KessenCardKinds),
    faction: z.enum(KessenFactions),
    /** Printed row; ANY lets the player choose on placement. Null for tactics and leaders. */
    row: z.enum([...KessenRows, "ANY"]).nullable(),
    power: z.coerce.number().int().min(0).max(30),
    /** Deck-building cost; leaders carry 0 and grant `leaderBonus` instead. */
    provision: z.coerce.number().int().min(0).max(20),
    abilities: z.array(kessenAbilitySchema).max(4),
    /** Summon groups this card belongs to, e.g. ["Crew"]. */
    summonGroups: z.array(groupName).max(3).prefault([]),
    leaderBonus: z.coerce.number().int().min(0).max(40).prefault(0),
    flavor: z.string().trim().max(240).prefault(""),
    /** Portrait illustration (5:7); `Item.image` stays the square inventory icon. */
    artUrl: z.string().max(512).prefault(""),
    focalX: z.coerce.number().int().min(0).max(100).prefault(50),
    focalY: z.coerce.number().int().min(0).max(100).prefault(35),
    variant: z.enum(KessenCardVariants).prefault("STANDARD"),
    /** Forbidden variants point at their standard card; both count as one name in decks. */
    baseCardId: z.string().max(191).nullable().prefault(null),
    /** Not collectible (boss leaders, tokens); never appears in packs, decks or shops. */
    isCollectible: z.coerce.boolean().prefault(true),
  })
  .superRefine((data, ctx) => {
    const leaderOnly = new Set<string>(KESSEN_LEADER_ONLY_ABILITIES);
    if (data.kind !== "LEADER") {
      for (const ability of data.abilities) {
        if (leaderOnly.has(ability.k)) {
          ctx.addIssue({
            code: "custom",
            message: `${ability.k} is a leader-only ability`,
            path: ["abilities"],
          });
        }
      }
    }
    if (data.kind === "UNIT" && data.row === null) {
      ctx.addIssue({ code: "custom", message: "Units need a row", path: ["row"] });
    }
    if (data.kind !== "UNIT" && data.row !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Only units have a row",
        path: ["row"],
      });
    }
    const hiddenChoice = hiddenChoiceIssue(data.abilities);
    if (hiddenChoice) {
      ctx.addIssue({ code: "custom", message: hiddenChoice, path: ["abilities"] });
    }
    if (data.variant === "FORBIDDEN" && !data.baseCardId) {
      ctx.addIssue({
        code: "custom",
        message: "Forbidden variants need a base card",
        path: ["baseCardId"],
      });
    }
  });
export type CardData = z.output<typeof cardDataSchema>;

/**
 * Why an ability list breaks the hidden-information rule, or null: no ability may ask for
 * a choice after revealing hidden information, so the client can compute every choice
 * from its own view. Summon and All Hands (and Revive,
 * whose revived card may Summon) put deck cards on your side; Draw and Infiltrator put
 * deck cards in your hand. A later choice must not depend on what they revealed.
 */
export const hiddenChoiceIssue = (abilities: readonly KessenAbility[]) => {
  let board: string | null = null;
  let hand: string | null = abilities.some((a) => a.k === "infiltrator")
    ? "infiltrator"
    : null;
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i] as KessenAbility;
    const next = abilities[i + 1];
    if (board !== null && readsOwnBoard(ability, next)) {
      return `${ability.k} cannot ask for a choice after ${board} reveals deck cards`;
    }
    if (hand !== null && ability.k === "cycle") {
      return `cycle cannot ask for a choice after ${hand} reveals deck cards`;
    }
    if (ability.k === "summon" || ability.k === "allHands" || ability.k === "revive") {
      board ??= ability.k;
    }
    if (ability.k === "draw") hand ??= "draw";
  }
  return null;
};

/** Choices whose options depend on the units or free slots on your own side. */
const readsOwnBoard = (ability: KessenAbility, next: KessenAbility | undefined) => {
  switch (ability.k) {
    case "empower":
      return ability.mode === "single" || ability.mode === "chosenRow";
    case "seal":
      return (
        ability.mode === "single" && !(next?.k === "strike" && next.sameTarget === true)
      );
    case "revive":
    case "fence":
    case "substitution":
    case "grantResilient":
      return true;
    default:
      return false;
  }
};

/** The card field of the item validator; `SuperRefineCardItem` requires it on cards only. */
export const cardItemSchema = z.object({
  cardData: cardDataSchema.nullable().prefault(null),
});

/** Cards are played only in Kessen; these defaults also normalize item-type changes in the editor. */
export const CARD_ITEM_DEFAULTS = {
  slot: "NONE",
  target: "SELF",
  method: "SINGLE",
  weaponType: "NONE",
  coordinateTargeting: null,
  methodSize: null,
  effects: [],
  battleDescription: "",
  maxEquips: 0,
  preventBattleUsage: true,
  battleUsageType: "BOTH",
  destroyOnUse: false,
  canStack: true,
  stackSize: KESSEN_CARD_STACK_SIZE,
  maxImbueNumber: 0,
  maxDurability: 0,
  canBeImbued: false,
  canBeCrafted: false,
  range: 0,
  cooldown: 0,
  chakraCost: 0,
  staminaCost: 0,
  healthCost: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  healthCostReducePerLvl: 0,
  actionCostPerc: 100,
  parentItemId: null,
  requiredSkillId: null,
  crystalTargetTypes: null,
  isFarmSeed: false,
  isFarmFertilizer: false,
  farmSellValue: 0,
  farmExtractSeedItemId: null,
  farmExtractSeedCount: 0,
} satisfies Partial<Item>;

/** Stats of a newly created card until staff replace them. */
export const DEFAULT_CARD_DATA: CardData = cardDataSchema.parse({
  kind: "UNIT",
  faction: "NEUTRAL",
  row: "CLOSE",
  power: 1,
  provision: 4,
  abilities: [],
});
