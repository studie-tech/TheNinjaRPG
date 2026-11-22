import { describe, expect, it } from "bun:test";
import { KESSEN_ACADEMY_GRADUATION_PACK_ID } from "@/drizzle/constants";
import { academyLessonState, KESSEN_ACADEMY_LESSON_KEYS } from "@/libs/kessen/academy";
import { KESSEN_DECK_FACTIONS, starterDeck } from "@/libs/kessen/deck";
import { KESSEN_NPCS } from "@/libs/kessen/npcs";
import { createNpcMatch } from "@/libs/kessen/npcTurns";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { TOKEN_CARD_ID } from "@/libs/kessen/rules";
import { reservedContentDeletionError } from "@/libs/reservedContent";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const reservedCards = KESSEN_SEED_CATALOG.filter((card) =>
  reservedContentDeletionError("item", card.id),
);

describe("Kessen reserved content", () => {
  it("can start every Academy lesson with only reserved definitions", () => {
    for (const key of KESSEN_ACADEMY_LESSON_KEYS) {
      expect(academyLessonState(key, reservedCards)).not.toHaveProperty("error");
    }
  });

  it("can start every NPC variant against each starter deck with only reserved definitions", () => {
    for (const npc of KESSEN_NPCS) {
      for (const variant of [npc.standard, npc.ascended]) {
        if (!variant) continue;
        for (const faction of KESSEN_DECK_FACTIONS) {
          expect(
            createNpcMatch({
              seed: "reserved-content",
              deck: starterDeck(faction),
              variant,
              cards: reservedCards,
            }),
          ).not.toBeNull();
        }
      }
    }
  });

  it("protects fixed pack rewards and NPC first-win item choices", () => {
    const rewardIds = [
      TOKEN_CARD_ID,
      KESSEN_PACK_IDS.first,
      KESSEN_PACK_IDS.paper,
      KESSEN_PACK_IDS.lacquer,
      KESSEN_ACADEMY_GRADUATION_PACK_ID,
      ...KESSEN_DECK_FACTIONS.map(KESSEN_PACK_IDS.village),
      ...KESSEN_NPCS.flatMap((npc) =>
        [npc.standard, npc.ascended].flatMap((variant) => [
          ...(variant?.firstWin.items ?? []).map(({ itemId }) => itemId),
          ...(variant?.firstWin.choice?.kind === "items"
            ? variant.firstWin.choice.itemIds
            : []),
        ]),
      ),
    ];
    for (const id of rewardIds)
      expect(reservedContentDeletionError("item", id)).toContain("reserved content");
    expect(reservedContentDeletionError("item", "kessen-staff-card")).toBeNull();
  });
});
