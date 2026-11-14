"use client";

import { useStore } from "jotai";
import type Pusher from "pusher-js";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { addConversationMention, retainTavernActivity } from "@/deltas/chat";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { useTaverns } from "@/hooks/useTaverns";
import {
  chatTavernActivityAtom,
  chatViewedConversationsAtom,
  isTavernMuted,
} from "@/libs/chatPanel";
import { subscribeConversation } from "@/libs/conversationEvents";
import type { UserWithoutPosition } from "@/utils/UserContext";

/** Conversation ids of the taverns the player can open, with their names. */
export const useTavernIds = (userData: UserWithoutPosition | null | undefined) => {
  const { availTaverns, isLoading } = useTaverns(userData);
  const canRead =
    !!userData &&
    userData.level >= MESSAGING_MIN_LEVEL &&
    !userData.isBanned &&
    !userData.isSilenced;
  const { data } = api.comments.getTavernIds.useQuery(
    { titles: availTaverns },
    { enabled: canRead && !isLoading && availTaverns.length > 0, staleTime: Infinity },
  );
  if (!canRead) return [];
  return isLoading ? undefined : data;
};

/**
 * Count new messages from other players in every tavern the player unmuted and is not
 * looking at. Only comments the server permits the player to read count.
 */
export const useTavernActivity = (
  pusher: Pusher | undefined,
  userData: UserWithoutPosition | null | undefined,
) => {
  const store = useStore();
  const { mutateAsync: fetchComment } =
    api.comments.fetchConversationComment.useMutation();
  const taverns = useTavernIds(userData);
  const userId = userData?.userId;
  const available = taverns?.map((tavern) => tavern.id).join(",");
  const followed = (taverns ?? [])
    .filter((tavern) => !isTavernMuted(userData, tavern.id))
    .map((tavern) => tavern.id)
    .join(",");

  // Counts belong to one account; another account starts without them.
  useEffect(() => {
    if (!userId) return;
    return () => store.set(chatTavernActivityAtom, {});
  }, [userId, store]);

  useEffect(() => {
    // Keep counts during lookup, then discard taverns the player can no longer open.
    if (available === undefined) return;
    store.set(chatTavernActivityAtom, (current) =>
      retainTavernActivity(current, available ? available.split(",") : []),
    );
  }, [available, store]);

  useEffect(() => {
    if (!pusher || !userId || !followed) return;
    let isFollowing = true;
    const unsubscribes = followed.split(",").map((conversationId) => {
      let viewRevision = 0;
      const stopObserving = store.sub(chatViewedConversationsAtom, () => {
        if (store.get(chatViewedConversationsAtom)[conversationId]) viewRevision += 1;
      });
      const unsubscribe = subscribeConversation(
        pusher,
        conversationId,
        "tavern-activity",
        (event) => {
          const senderId = event.fromId;
          if (
            event.message !== "new" ||
            !senderId ||
            senderId === userId ||
            !event.commentId
          )
            return;
          if (store.get(chatViewedConversationsAtom)[conversationId]) return;
          const receivedViewRevision = viewRevision;
          // Public event metadata cannot establish reader-specific comment visibility.
          void fetchComment({ commentId: event.commentId, conversationId })
            .catch(() => undefined)
            .then((comment) => {
              if (!isFollowing || !comment) return;
              // A tavern viewed during lookup stays read even if it has since closed.
              if (receivedViewRevision !== viewRevision) return;
              store.set(chatTavernActivityAtom, (current) =>
                addConversationMention(current, conversationId),
              );
            });
        },
      );
      return () => {
        stopObserving();
        unsubscribe();
      };
    });
    return () => {
      isFollowing = false;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [pusher, userId, followed, store, fetchComment]);
};
