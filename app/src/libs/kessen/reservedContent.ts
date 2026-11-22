import { KESSEN_ACADEMY_GRADUATION_PACK_ID } from "@/drizzle/constants";
import { KESSEN_ACADEMY_LESSONS } from "./academyLessons";
import { KESSEN_ALT_LEADERS, KESSEN_DECK_FACTIONS, starterDeck } from "./deck";
import { KESSEN_NPCS } from "./npcs";
import { KESSEN_PACK_IDS } from "./packs";
import { TOKEN_CARD_ID } from "./rules";

/** Item definitions named by starter decks, Academy positions, NPC decks and rewards. */
export const KESSEN_RESERVED_ITEM_IDS: readonly string[] = [
  ...new Set([
    TOKEN_CARD_ID,
    KESSEN_PACK_IDS.first,
    KESSEN_PACK_IDS.paper,
    KESSEN_PACK_IDS.lacquer,
    KESSEN_ACADEMY_GRADUATION_PACK_ID,
    ...KESSEN_DECK_FACTIONS.flatMap((faction) => {
      const deck = starterDeck(faction);
      return [
        deck.leaderId,
        ...deck.cards.map(({ itemId }) => itemId),
        KESSEN_ALT_LEADERS[faction],
        KESSEN_PACK_IDS.village(faction),
      ];
    }),
    ...KESSEN_NPCS.flatMap((npc) => [
      ...(npc.aiProfile.signatures ?? []).map(({ cardId }) => cardId),
      ...[npc.standard, npc.ascended].flatMap((variant) =>
        variant
          ? [
              variant.deck.leaderId,
              ...variant.deck.cards.map(({ itemId }) => itemId),
              ...variant.firstWin.items.map(({ itemId }) => itemId),
              ...(variant.firstWin.choice?.kind === "items"
                ? variant.firstWin.choice.itemIds
                : []),
            ]
          : [],
      ),
    ]),
    ...KESSEN_ACADEMY_LESSONS.flatMap((lesson) =>
      lesson.position.seats.flatMap((side) => [
        ...(side.leader ? [side.leader] : []),
        ...side.hand,
        ...(side.deck ?? []),
        ...(side.discard ?? []),
        ...Object.values(side.board ?? {}).flatMap((units) =>
          units.map((unit) => (typeof unit === "string" ? unit : unit.card)),
        ),
      ]),
    ),
  ]),
];
