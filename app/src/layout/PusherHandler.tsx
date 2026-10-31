"use client";

import Pusher from "pusher-js";
import { useEffect, useState } from "react";
import type { UserWithRelations } from "@/api/routers/profile";
import { api } from "@/app/_trpc/client";
import { ToastAction } from "@/components/ui/toast";
import { env } from "@/env/client.mjs";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import Link from "@/layout/Link";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat, usePublicPathname } from "@/utils/routing";

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
};

export const usePusherHandler = (
  userId?: string | null,
  userData?: UserWithRelations,
) => {
  // Extra parameter
  const clanId = userData?.clanId;
  const villageId = userData?.villageId;

  // Navigation
  const router = useRouter();
  const pathname = usePublicPathname();

  // tRPC utility
  const utils = api.useUtils();

  // Pusher connection
  const [pusher, setPusher] = useState<Pusher | undefined>(undefined);

  // Listen on user channel for live updates on things
  useEffect(() => {
    if (userId) {
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
            // NOTE: for some reason using updateUser does not work from this hook
            await utils.profile.getUser.cancel();
            // Update user data with battle status
            utils.profile.getUser.setData(undefined, (old) => {
              if (!old) return old;
              return {
                ...old,
                userData: {
                  ...old.userData,
                  status: "BATTLE",
                  battleId: data.battleId,
                  updatedAt: new Date(),
                },
                notifications: [
                  ...(old.notifications || []),
                  { href: "/combat", name: "In combat", color: "red" },
                ],
              } as typeof old;
            });
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
            utils.tournament.getEventNotices.invalidate(),
            utils.tournament.getEvent.invalidate(),
            utils.tournament.listEvents.invalidate(),
          ]);
        } else if (data.type === "parentalControlsChanged") {
          // Drop cached chat history in every open tab when a parent changes access.
          void utils.parentalControls.get.invalidate();
          void utils.comments.getUserConversations.invalidate();
          void utils.comments.getConversationComments.reset();
        } else if (data.type === "newInbox") {
          if (!pathname.includes("/inbox")) {
            showMutationToast({
              success: true,
              message: "You have a new message",
              duration: data.duration,
              title: "Notification!",
              action: (
                <ToastAction altText="To Inbox">
                  <Link href="/inbox">To Inbox</Link>
                </ToastAction>
              ),
            });
          }
        } else if (data.type === "userMessage" || data.type === "homeInvitation") {
          if (data.type === "homeInvitation")
            await utils.home.getHomeRequests.invalidate();
          showMutationToast({
            success: true,
            message: data.message ?? "You have a new message",
            duration: data.duration,
            title: "Notification!",
            action: (
              <ToastAction altText="To Arena">
                <Link
                  href={data.route ?? "/battlearena"}
                  onNavigate={(event) => {
                    const url = new URL(
                      data.route ?? "/battlearena",
                      window.location.href,
                    );
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
                  {data.routeText ?? "To Profile"}
                </Link>
              </ToastAction>
            ),
          });
        } else if (data.type === "pinged") {
          showMutationToast({
            success: true,
            message: data.message ?? "You have been pinged",
            duration: data.duration,
            title: "Notification!",
          });
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
              action: (
                <ToastAction altText="To Arena">
                  <Link href={data.route ?? "/battlearena"}>
                    {data.routeText ?? "To Profile"}
                  </Link>
                </ToastAction>
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
              action: data.route ? (
                <ToastAction altText="Action">
                  <Link href={data.route}>{data.routeText ?? "Go"}</Link>
                </ToastAction>
              ) : undefined,
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
  }, [userId, clanId, villageId, router, utils]);

  return pusher;
};
