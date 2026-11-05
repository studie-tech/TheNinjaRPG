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
  isConversationMuted,
} from "@/libs/chatPanel";
import { subscribeConversation } from "@/libs/conversationEvents";
import type { UserWithRelations } from "@/routers/profile";

/** Conversation ids of the taverns the player can open, with their names. */
export const useTavernIds = (userData: UserWithRelations | null | undefined) => {
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
 * Count new messages from other players in every unmuted tavern the player is not
 * looking at. Blocked players' messages stay hidden in the tavern, so they do not count.
 */
export const useTavernActivity = (
  pusher: Pusher | undefined,
  userData: UserWithRelations | null | undefined,
) => {
  const store = useStore();
  const utils = api.useUtils();
  const taverns = useTavernIds(userData);
  const userId = userData?.userId;
  const available = taverns?.map((tavern) => tavern.id).join(",");
  const followed = (taverns ?? [])
    .filter((tavern) => !isConversationMuted(userData, tavern.id))
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
    const unsubscribes = followed.split(",").map((conversationId) =>
      subscribeConversation(pusher, conversationId, "tavern-activity", (event) => {
        const senderId = event.fromId;
        if (event.message !== "new" || !senderId || senderId === userId) return;
        if (store.get(chatViewedConversationsAtom)[conversationId]) return;
        void utils.profile.getBlacklist
          .fetch(undefined, { staleTime: Infinity })
          .catch(() => undefined)
          .then((blocked) => {
            if (!isFollowing || !blocked) return;
            // Opening the tavern during the lookup must keep its count clear.
            if (store.get(chatViewedConversationsAtom)[conversationId]) return;
            if (blocked.some((entry) => entry.targetUserId === senderId)) return;
            store.set(chatTavernActivityAtom, (current) =>
              addConversationMention(current, conversationId),
            );
          });
      }),
    );
    return () => {
      isFollowing = false;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [pusher, userId, followed, store, utils]);
};
