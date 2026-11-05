"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useStore } from "jotai";
import Pusher from "pusher-js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { UserWithRelations } from "@/api/routers/profile";
import { api } from "@/app/_trpc/client";
import { ToastAction } from "@/components/ui/toast";
import { addConversationMention } from "@/deltas/chat";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { env } from "@/env/client.mjs";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useEventTournamentNoticeCache } from "@/hooks/useEventTournamentNotices";
import Link from "@/layout/Link";
import {
  chatMentionsAtom,
  chatPanelAtom,
  chatViewedConversationsAtom,
  isConversationMuted,
} from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat, usePublicPathname } from "@/utils/routing";
import { updateUserCache } from "@/utils/userCache";

// Events sent to the user from websockets
export type UserEvent = {
  type: string;
  originSocketId?: string;
  message?: string;
  /** Toast display duration in milliseconds. */
  duration?: number;
  route?: string;
  routeText?: string;
  battleId?: string;
  dungeonRunId?: string;
  alertType?: string;
  sector?: number;
  conversationId?: string;
  isPublic?: boolean;
};

export const usePusherHandler = (
  userId?: string | null,
  userData?: Pick<NonNullable<UserWithRelations>, "clanId" | "villageId">,
) => {
  // Extra parameter
  const clanId = userData?.clanId;
  const villageId = userData?.villageId;

  // Navigation
  const router = useRouter();
  const pathname = usePublicPathname();
  // Read at event time so the subscription does not reconnect on every navigation
  const isOnInbox = useEffectEvent(() => pathname.includes("/inbox"));

  // tRPC utility
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const { refreshEventTournamentNotices } = useEventTournamentNoticeCache();
  const store = useStore();

  // Pusher connection
  const [pusher, setPusher] = useState<Pusher | undefined>(undefined);

  // Pending chat events belong to the account, including across membership-channel rebinding.
  const notificationSession = useRef<symbol | undefined>(undefined);
  useEffect(() => {
    notificationSession.current = Symbol();
    return () => {
      notificationSession.current = undefined;
    };
  }, [userId]);

  // Listen on user channel for live updates on things
  useEffect(() => {
    if (userId) {
      const session = notificationSession.current;
      const canNotifyConversation = (conversationId: string | undefined) => {
        const user = utils.profile.getUser.getData()?.userData;
        return (
          !!session &&
          notificationSession.current === session &&
          user?.userId === userId &&
          !isConversationMuted(user, conversationId) &&
          (!conversationId || !store.get(chatViewedConversationsAtom)[conversationId])
        );
      };
      const resolveNotificationProfile = async (conversationId: string | undefined) => {
        if (!utils.profile.getUser.getData()?.userData) {
          try {
            // Join the initial profile request so its loading and error state can settle normally.
            await utils.profile.getUser.fetch(undefined, { staleTime: Infinity });
          } catch {
            // UserContext owns the profile failure and the page's recovery/redirect UX.
            return;
          }
        }
        return canNotifyConversation(conversationId);
      };
      // Pusher Channel
      const pusher = new Pusher(
        process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
        env.NEXT_PUBLIC_NODE_ENV === "development"
          ? {
              wsHost: "127.0.0.1",
              wsPort: 6001,
              wssPort: 6001,
              forceTLS: false,
              disableStats: true,
              enabledTransports: ["ws", "wss"],
              cluster: process.env.NEXT_PUBLIC_PUSHER_APP_CLUSTER,
            }
          : {
              wsHost: "soketi.theninja-rpg.com",
              forceTLS: true,
              disableStats: true,
              enabledTransports: ["ws", "wss"],
              cluster: process.env.NEXT_PUBLIC_PUSHER_APP_CLUSTER,
            },
      );
      setPusher(pusher);
      // Listening on userId channel
      const channel = pusher.subscribe(userId);
      channel.bind("event", async (data: UserEvent) => {
        if (data.type === "battle") {
          if (data?.battleId) {
            // UserContext's updateUser is not available here: this hook runs inside its
            // provider. Cancelling first applies the patch before navigating, without
            // waiting on the refetch updateUserCache runs for an unfinished read.
            await utils.profile.getUser.cancel();
            void updateUserCache(
              queryClient,
              getQueryKey(api.profile.getUser, undefined, "query"),
              { status: "BATTLE", battleId: data.battleId, updatedAt: new Date() },
            );
            pushToCombat(router, data.battleId);
            void utils.combat.getBattle.invalidate();
          }
        } else if (data.type === "battleEnded") {
          // The deleting socket recovers through its mutation response or transport-error callback.
          if (
            data.originSocketId &&
            data.originSocketId === pusher.connection.socket_id
          )
            return;
          await utils.profile.getUser.cancel();
          await utils.profile.getUser.invalidate();
          void utils.combat.getBattle.invalidate();
          if (data.dungeonRunId) {
            void utils.coop.dungeon.getState.invalidate();
            router.push("/dungeon");
          }
        } else if (data.type === "questTeam") {
          // Membership changes affect the roster, personal quest projection and reward offers.
          await Promise.all([
            utils.profile.getUser.invalidate(),
            utils.coop.quest.overview.invalidate(),
            utils.quests.getPendingRewardChoices.invalidate(),
          ]);
          if (data.message)
            showMutationToast({
              success: true,
              message: data.message,
              title: "Quest Team",
              action: (
                <ToastAction altText="Open Quest Teams">
                  <Link href={data.route ?? "/questteams"}>
                    {data.routeText ?? "Open team"}
                  </Link>
                </ToastAction>
              ),
            });
        } else if (data.type === "eventTournament") {
          // The originating action reconciles its response, including transport failure.
          if (
            data.originSocketId &&
            data.originSocketId === pusher.connection.socket_id
          )
            return;
          // Invitations and substitutions can make an idle tab a ready-check participant.
          await Promise.all([
            utils.profile.getUser.invalidate(),
            refreshEventTournamentNotices(),
            utils.tournament.getEvent.invalidate(),
            utils.tournament.listEvents.invalidate(),
          ]);
        } else if (data.type === "parentalControlsChanged") {
          // Drop cached chat history in every open tab when a parent changes access.
          void utils.parentalControls.get.invalidate();
          void utils.comments.getUserConversations.invalidate();
          void utils.comments.getTavernIds.invalidate();
          void utils.comments.getConversationComments.reset();
        } else if (data.type === "newInbox") {
          void utils.comments.getUserConversations.invalidate();
          const shouldNotify = await resolveNotificationProfile(data.conversationId);
          if (shouldNotify && canNotifyConversation(data.conversationId)) {
            try {
              // Cancel cached refreshes so the authoritative read starts after this delivery.
              await utils.profile.getUser.invalidate(undefined, { refetchType: "all" });
            } catch {
              // UserContext exposes a failed refresh; an eligible message can still show its toast.
            }
            if (!canNotifyConversation(data.conversationId)) return;
            if (!isOnInbox()) {
              const canOpenChat =
                (utils.profile.getUser.getData()?.userData?.level ?? 0) >=
                MESSAGING_MIN_LEVEL;
              showMutationToast({
                success: true,
                message: "You have a new message",
                duration: data.duration,
                title: "Notification!",
                action: (
                  <ToastAction
                    altText={canOpenChat ? "Open chat" : "To Inbox"}
                    onClick={() => {
                      if (!canOpenChat) {
                        router.push("/inbox");
                        return;
                      }
                      store.set(chatPanelAtom, (current) => ({
                        ...current,
                        openRequested: true,
                        tab: "inbox",
                        conversationId: data.conversationId,
                      }));
                    }}
                  >
                    {canOpenChat ? "Open chat" : "To Inbox"}
                  </ToastAction>
                ),
              });
            }
          }
        } else if (data.type === "userMessage" || data.type === "homeInvitation") {
          if (data.type === "homeInvitation")
            await utils.home.getHomeRequests.invalidate();
          showMutationToast({
            success: true,
            message: data.message ?? "You have a new message",
            duration: data.duration,
            title: "Notification!",
            action: routeToastAction(
              "To Arena",
              data.route ?? "/battlearena",
              data.routeText ?? "To Profile",
            ),
          });
        } else if (data.type === "pinged") {
          const conversationId = data.conversationId;
          if (
            (await resolveNotificationProfile(conversationId)) &&
            canNotifyConversation(conversationId)
          ) {
            if (conversationId && data.isPublic) {
              store.set(chatMentionsAtom, (old) =>
                addConversationMention(old, conversationId),
              );
            }
            showMutationToast({
              success: true,
              message: data.message ?? "You have been pinged",
              duration: data.duration,
              title: "Notification!",
            });
          }
        }
      });
      // Listen on clanId channel
      if (clanId) {
        const clanChannel = pusher.subscribe(clanId);
        clanChannel.bind("event", (data: UserEvent) => {
          if (data.type === "userMessage") {
            showMutationToast({
              success: true,
              message: data.message ?? "You have a new message",
              duration: data.duration,
              title: "Notification!",
              action: routeToastAction(
                "To Arena",
                data.route ?? "/battlearena",
                data.routeText ?? "To Profile",
              ),
            });
          }
        });
      }
      // Listen on village channel
      if (villageId) {
        const villageChannel = pusher.subscribe(`village-${villageId}`);
        villageChannel.bind("event", (data: UserEvent) => {
          if (data.type === "villageAlert") {
            showMutationToast({
              success: true,
              message: data.message ?? "Village alert!",
              duration: data.duration,
              title: "Village Notification!",
              action: data.route
                ? routeToastAction("Action", data.route, data.routeText ?? "Go")
                : undefined,
            });
          }
        });
      }
      // Cleanup
      return () => {
        pusher.unsubscribe(userId);
        if (clanId) pusher.unsubscribe(clanId);
        if (villageId) pusher.unsubscribe(`village-${villageId}`);
        pusher.disconnect();
      };
    }
  }, [
    userId,
    clanId,
    villageId,
    router,
    utils,
    queryClient,
    store,
    refreshEventTournamentNotices,
  ]);

  return pusher;
};

/** Link action for a notification toast. */
const routeToastAction = (altText: string, route: string, label: string) => (
  <ToastAction altText={altText}>
    <Link
      href={route}
      onNavigate={(event) => {
        const url = new URL(route, window.location.href);
        if (
          url.hash &&
          url.origin === window.location.origin &&
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          // Fragment tabs need the native hashchange event to select their panel.
          event.preventDefault();
          window.location.assign(url.href);
        }
      }}
    >
      {label}
    </Link>
  </ToastAction>
);
