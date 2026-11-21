import { nanoid } from "nanoid";
import { z } from "zod";
import {
  KESSEN_DECK_NAME_MAX_LENGTH,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_MAX_DECKS,
} from "@/drizzle/constants";
import { finishedFirstLesson } from "@/libs/kessen/academy";
import { kessenCatalogCards, ownedCardCounts } from "@/libs/kessen/catalog";
import {
  catalogById,
  fillWithBorrowed,
  normalizeDeckCards,
  starterDeck,
  validateDeck,
} from "@/libs/kessen/deck";
import { isKessenPackId, KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import {
  countKessenDecks,
  deleteKessenDeck,
  findKessenDeck,
  findKessenProgress,
  findUserItemForOpenPack,
  insertKessenDeck,
  listItemForKessenGrant,
  listKessenCards,
  listOwnedKessenCards,
  updateKessenDeck,
  updateKessenProgressForChooseStarter,
  upsertKessenProgressAutoSell,
} from "@/queries/kessen";
import { itemRouter } from "@/server/api/routers/item";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { grantUserItems } from "@/server/utils/itemGrants";
import { getUtcDayKey } from "@/utils/time";
import { type KessenDeckRow, kessenDeckFactionSchema } from "@/validators/kessen";

/** The Kessen collection: saved decks, the one-time starter grant, packs and auto-sell. */
export const kessenCollectionRouter = createTRPCRouter({
  /**
   * Saves a deck that is valid, or one that breaks only the size and ownership rules but
   * can be completed with borrowed cards (`needsFill`): matches then start it with
   * `{ source: "fill" }`, which lends the missing copies anew each time.
   */
  saveDeck: protectedProcedure
    .meta({ mcp: { description: "Create or update a saved Kessen deck" } })
    .input(
      z.object({
        id: z.string().min(1).max(191).optional(),
        name: z.string().trim().min(1).max(KESSEN_DECK_NAME_MAX_LENGTH),
        leaderItemId: z.string().min(1).max(191),
        cards: z
          .array(
            z.object({
              itemId: z.string().min(1).max(191),
              count: z.int().min(1).max(30),
            }),
          )
          .max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [cardRows, ownedRows, deckCount, [existing]] = await Promise.all([
        listKessenCards(ctx.drizzle),
        listOwnedKessenCards(ctx.drizzle, ctx.userId),
        countKessenDecks(ctx.drizzle, ctx.userId),
        input.id ? findKessenDeck(ctx.drizzle, ctx.userId, input.id) : [],
      ]);
      // Guard
      if (input.id && !existing) return errorResponse("Deck not found");
      if (!input.id && (deckCount[0]?.decks ?? 0) >= KESSEN_MAX_DECKS)
        return errorResponse(
          `You can save up to ${KESSEN_MAX_DECKS} decks. Delete one to save another.`,
        );
      const cards = normalizeDeckCards(input.cards);
      const catalog = kessenCatalogCards(cardRows);
      const owned = ownedCardCounts(ownedRows).free;
      const list = { leaderId: input.leaderItemId, cards };
      const validation = validateDeck(list, catalogById(catalog), { owned });
      const needsFill = !validation.ok;
      const [firstError] = validation.errors;
      if (firstError) {
        const fillable =
          validation.errors.every(
            (error) => error.code === "size" || error.code === "notOwned",
          ) &&
          fillWithBorrowed({
            userId: ctx.userId,
            dayKey: getUtcDayKey(),
            deck: list,
            owned,
            cards: catalog,
          }) !== null;
        // A size error is what fill repairs, so another rule names the real problem.
        const blocking =
          validation.errors.find((error) => error.code !== "size") ?? firstError;
        if (!fillable) return errorResponse(blocking.message);
      }
      // Mutate. Two simultaneous creates can pass the deck cap together; the extra deck
      // stays the player's own and can be deleted, so the count is read, not locked.
      const now = new Date();
      const deck: KessenDeckRow = {
        id: existing?.id ?? nanoid(),
        name: input.name,
        leaderItemId: input.leaderItemId,
        cards,
        updatedAt: now,
      };
      if (existing) {
        const updated = await updateKessenDeck(ctx.drizzle, ctx.userId, deck.id, {
          name: deck.name,
          leaderItemId: deck.leaderItemId,
          cards: deck.cards,
          updatedAt: now,
        });
        if (updated.rowsAffected === 0) return errorResponse("Deck not found");
      } else {
        await insertKessenDeck(ctx.drizzle, {
          ...deck,
          userId: ctx.userId,
          createdAt: now,
        });
      }
      return {
        success: true as const,
        message: needsFill
          ? `Saved ${deck.name}. Matches fill its missing cards with borrowed copies.`
          : `Saved ${deck.name}`,
        deck,
        needsFill,
      };
    }),
  deleteDeck: protectedProcedure
    .meta({ mcp: { description: "Delete a saved Kessen deck" } })
    .input(z.object({ id: z.string().min(1).max(191) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const deleted = await deleteKessenDeck(ctx.drizzle, ctx.userId, input.id);
      if (deleted.rowsAffected === 0) return errorResponse("Deck not found");
      return { success: true, message: "Deck deleted" };
    }),
  chooseStarter: protectedProcedure
    .meta({
      mcp: {
        description:
          "Choose the faction of the one-time Kessen starter deck after Lemu's first Academy lesson",
      },
    })
    .input(z.object({ faction: kessenDeckFactionSchema }))
    .mutation(async ({ ctx, input }) => {
      const starter = starterDeck(input.faction);
      const granted = [
        ...starter.cards.map((entry) => ({
          itemId: entry.itemId,
          quantity: entry.count,
        })),
        { itemId: starter.leaderId, quantity: 1 },
        { itemId: KESSEN_FIRST_BUNDLE_ITEM_ID, quantity: 1 },
      ];
      // Query
      const [[progress], items, deckCount] = await Promise.all([
        findKessenProgress(ctx.drizzle, ctx.userId),
        listItemForKessenGrant(
          ctx.drizzle,
          granted.map((grant) => grant.itemId),
        ),
        countKessenDecks(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!progress || !finishedFirstLesson(progress.academy))
        return errorResponse(
          "Finish Lemu's first Academy lesson before choosing a starter deck.",
        );
      if (progress.starterGranted)
        return errorResponse("You already received your starter deck.");
      const found = new Set(items.map((row) => row.id));
      if (granted.some((grant) => !found.has(grant.itemId)))
        return errorResponse(
          "The starter cards are not available right now. Please contact staff.",
        );
      // Mutate: the claim succeeds once per account, so only its winner grants.
      const claimed = await updateKessenProgressForChooseStarter(
        ctx.drizzle,
        ctx.userId,
        input.faction,
      );
      if (claimed.rowsAffected !== 1)
        return errorResponse("You already received your starter deck.");
      const now = new Date();
      const deck: KessenDeckRow | null =
        (deckCount[0]?.decks ?? 0) < KESSEN_MAX_DECKS
          ? {
              id: nanoid(),
              name: `${KESSEN_FACTION_NAMES[input.faction]} Starter`,
              leaderItemId: starter.leaderId,
              cards: normalizeDeckCards(starter.cards),
              updatedAt: now,
            }
          : null;
      await Promise.all([
        grantUserItems(ctx.drizzle, ctx.userId, granted),
        deck
          ? insertKessenDeck(ctx.drizzle, {
              ...deck,
              userId: ctx.userId,
              createdAt: now,
            })
          : undefined,
      ]);
      return {
        success: true as const,
        message: `You received the ${KESSEN_FACTION_NAMES[input.faction]} starter deck and a First Bundle.`,
        granted,
        deck,
      };
    }),
  openPack: protectedProcedure
    .meta({ mcp: { description: "Open a Kessen card pack from the inventory" } })
    .input(
      z.object({
        userItemId: z.string().min(1).max(191),
        /** Retry identity of this opening; a lost response is replayed, not reopened. */
        requestId: z
          .string()
          .regex(/^[\w-]{10,64}$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [stack] = await findUserItemForOpenPack(
        ctx.drizzle,
        ctx.userId,
        input.userItemId,
      );
      if (!stack) return errorResponse("Card pack not found");
      if (!isKessenPackId(stack.itemId))
        return errorResponse("This item is not a card pack");
      // Packs open through the item consume path, which applies the card hooks. Like
      // every consumable they skip BotID: the item page opens them through
      // `item.consume`, and what a player can open is bounded by what they bought or won.
      const response = await itemRouter.createCaller(ctx).consume({
        userItemId: input.userItemId,
        requestId: input.requestId ?? nanoid(24),
      });
      if (!response.success) return response;
      return {
        ...response,
        reveal: "kessenReveal" in response ? response.kessenReveal : undefined,
      };
    }),
  setAutoSell: protectedProcedure
    .meta({
      mcp: { description: "Sell surplus Kessen cards automatically when granted" },
    })
    .input(z.object({ enabled: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await upsertKessenProgressAutoSell(ctx.drizzle, ctx.userId, input.enabled);
      return {
        success: true,
        message: input.enabled
          ? "Surplus cards will be sold automatically"
          : "Surplus cards will be kept",
      };
    }),
});
