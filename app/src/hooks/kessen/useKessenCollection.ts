"use client";

import { api, type RouterInputs } from "@/app/_trpc/client";
import {
  withAutoSell,
  withoutDeck,
  withSavedDeck,
  withStarterGranted,
} from "@/deltas/kessenCollection";
import { KESSEN_DECK_NAME_MAX_LENGTH } from "@/drizzle/constants";
import { useKessenHubCache } from "@/hooks/kessen/useKessenHubCache";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useItemConsumptionCacheUpdate } from "@/hooks/useItemConsumptionCacheUpdate";
import {
  finishItemConsumeRequest,
  getItemConsumeRequestId,
} from "@/libs/itemConsumption";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { formatTrpcErrorMessage, isRetryableTrpcError } from "@/utils/error";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Card Hall collection mutations bound to the `kessen.getHub` cache: deck saves and
 * deletes, the starter choice, pack openings (which also reconcile the profile and the
 * inventory like an item-page use) and the auto-sell toggle. Confirmed results patch the
 * hub; rejections leave it untouched. Confirmed deck saves and deletes resolve with their
 * message and do not toast, because the deck builder answers them in place.
 */
export const useKessenCollection = () => {
  const hub = useKessenHubCache();
  const {
    data: userId,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector(selectUserId);
  const { prepareConsumptionUpdate, updateConsumption } =
    useItemConsumptionCacheUpdate();
  const { invalidateInventory } = useInventoryCacheUpdate();

  const saveDeckMutation = api.kessenCollection.saveDeck.useMutation({
    onMutate: () => hub.prepareHubUpdate(),
    onSuccess: async (data, _variables, snapshot) => {
      if (data.success) {
        const { deck } = data;
        await hub.updateHub((current) => withSavedDeck(current, deck), snapshot);
      }
    },
    // A rejection reads as a sentence rather than the raw input issues.
    onError: (error) =>
      showMutationToast({ success: false, message: deckSaveErrorMessage(error) }),
  });

  const deleteDeck = api.kessenCollection.deleteDeck.useMutation({
    onMutate: () => hub.prepareHubUpdate(),
    onSuccess: async (data, variables, snapshot) => {
      if (data.success)
        await hub.updateHub((current) => withoutDeck(current, variables.id), snapshot);
    },
  });

  // A granted starter is confirmed by the First Bundle's ceremony, which opens at once
  // (the page toasts only when it cannot open), so only a refusal toasts here.
  const chooseStarter = api.kessenCollection.chooseStarter.useMutation({
    onMutate: () => hub.prepareHubUpdate(),
    onSuccess: async (data, variables, snapshot) => {
      if (!data.success) showMutationToast(data);
      if (data.success) {
        const { granted, deck } = data;
        // The grant creates inventory rows whose ids only the server knows.
        await Promise.all([
          hub.updateHub(
            (current) =>
              withStarterGranted(current, {
                faction: variables.faction,
                granted,
                deck,
              }),
            snapshot,
          ),
          invalidateInventory(),
        ]);
      }
    },
  });

  const openPackMutation = api.kessenCollection.openPack.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      consumption: prepareConsumptionUpdate(),
    }),
    onSuccess: async (data, variables, context) => {
      if (userId) finishItemConsumeRequest(userId, variables.userItemId);
      if (!data.success) {
        showMutationToast(data);
        return;
      }
      // The reveal is the feedback; reconciliation (profile, inventory and the hub's owned
      // cards and pity, like an item-page use) stays off the opening animation's path.
      void Promise.allSettled([
        updateUser(data, { revision: context.userRevision }).then((profileApplied) =>
          updateConsumption(data, context.consumption, profileApplied),
        ),
      ]);
    },
    onError: async (error, _variables, context) => {
      // A transport failure leaves the opening uncertain; retrying replays its receipt.
      if (isRetryableTrpcError(error))
        showMutationToast({
          success: false,
          message: "Could not confirm the opening. Open the pack again to check it.",
        });
      await updateUser(undefined);
      await updateConsumption(
        undefined,
        context?.consumption ?? prepareConsumptionUpdate(),
        false,
      );
    },
  });

  const setAutoSell = api.kessenCollection.setAutoSell.useMutation({
    onMutate: () => hub.prepareHubUpdate(),
    onSuccess: async (data, variables, snapshot) => {
      showMutationToast(data);
      if (data.success)
        await hub.updateHub(
          (current) => withAutoSell(current, variables.enabled),
          snapshot,
        );
    },
  });

  /**
   * Saves a deck. A name over the limit is refused before sending, and a request that
   * throws resolves as a failed response with a readable message.
   */
  const saveDeck = async (input: KessenDeckSaveRequest) => {
    if (input.name.trim().length > KESSEN_DECK_NAME_MAX_LENGTH) {
      return { success: false as const, message: DECK_NAME_TOO_LONG };
    }
    return saveDeckMutation.mutateAsync(input).catch((error: unknown) => ({
      success: false as const,
      message: deckSaveErrorMessage(error),
    }));
  };

  /** Opens one pack of a stack; a retry after a lost response replays the same opening. */
  const openPack = (userItemId: string) =>
    openPackMutation.mutateAsync({
      userItemId,
      ...(userId ? { requestId: getItemConsumeRequestId(userId, userItemId) } : {}),
    });

  return {
    saveDeck,
    isSavingDeck: saveDeckMutation.isPending,
    deleteDeck: deleteDeck.mutateAsync,
    isDeletingDeck: deleteDeck.isPending,
    chooseStarter: chooseStarter.mutateAsync,
    isChoosingStarter: chooseStarter.isPending,
    openPack,
    isOpeningPack: openPackMutation.isPending,
    setAutoSell: setAutoSell.mutateAsync,
    isSettingAutoSell: setAutoSell.isPending,
  };
};

/** Subscribe to account identity without observing unrelated profile fields. */
const selectUserId = (user: NonNullable<UserWithRelations>) => user.userId;

const DECK_NAME_TOO_LONG = `Deck names can be at most ${KESSEN_DECK_NAME_MAX_LENGTH} characters.`;

/** A failed deck save as one sentence: the name rule, a lost response or the reason. */
const deckSaveErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "The deck could not be saved.";
  if (isRetryableTrpcError(error)) {
    return "Could not confirm the save. Refresh the page to check the deck before saving again.";
  }
  const issues = (error as { data?: { zodError?: InputIssue[] | null } }).data
    ?.zodError;
  if (issues?.some((issue) => issue.path?.[0] === "name" && issue.code === "too_big"))
    return DECK_NAME_TOO_LONG;
  return formatTrpcErrorMessage(error) || "The deck could not be saved.";
};

type KessenDeckSaveRequest = RouterInputs["kessenCollection"]["saveDeck"];

type InputIssue = { code?: string; path?: PropertyKey[] };
