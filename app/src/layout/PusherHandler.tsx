"use client";

import { hashKey, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useStore } from "jotai";
import type Pusher from "pusher-js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { SuperJSONResult } from "superjson";
import superjson from "superjson";
import type { UserWithRelations } from "@/api/routers/profile";
import { api } from "@/app/_trpc/client";
import { ToastAction } from "@/components/ui/toast";
import {
  addConversationMention,
  incrementInboxNotifications,
  isInboxDeliveryAfterProfile,
} from "@/deltas/chat";
import { getKessenPvpLobbyWithoutChallenge } from "@/deltas/kessenPvp";
import { BATTLE_ALERT_SFX_URL, MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { env } from "@/env/client.mjs";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useCraftingServiceEvents } from "@/hooks/useCraftingServiceEvents";
import { useEventTournamentNoticeCache } from "@/hooks/useEventTournamentNotices";
import Link from "@/layout/Link";
import { getAudioPreference } from "@/libs/audioPreferences";
import type { CaravanNoticeView } from "@/libs/caravan";
import {
  chatMentionsAtom,
  chatPanelAtom,
  chatViewedConversationsAtom,
  isConversationMuted,
} from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import { createModuleLoader } from "@/utils/async";
import {
  addUserInteractionListeners,
  playPreloadedAudio,
  preloadAudioBuffers,
  savedSfxVolume,
  unlockAudioPlayback,
} from "@/utils/audio";
import { transformImageUrl } from "@/utils/image";
import { pushToCombat, usePublicPathname } from "@/utils/routing";
import { updateUserCache, updateUserNotifications } from "@/utils/userCache";
import type { UserRecovery } from "@/validators/base";

/** The websocket client, which loads once a player is signed in. */
const loadPusherClient = createModuleLoader(() => import("pusher-js"));

/** Longest wait between attempts to download the websocket client. */
const MAX_CLIENT_RETRY_MS = 30_000;

// Events sent to the user from websockets
export type UserEvent = {
  type: string;
  originSocketId?: string;
  userRecovery?: SuperJSONResult;
  message?: string;
  /** Toast display duration in milliseconds. */
  duration?: number;
  route?: string;
  routeText?: string;
  battleId?: string;
  /** Human defenders receive attack alerts; initiators stay silent in every tab. */
  isDefender?: boolean;
  dungeonRunId?: string;
  alertType?: string;
  sector?: number;
  conversationId?: string;
  isPublic?: boolean;
  /** Server time just before a delivered private message starts counting in inbox news. */
  countedAt?: number;
  /** The message accompanies a committed crafting escrow, delivery or refund. */
  craftingService?: boolean;
  /** Profile, caravan and trade route views the notice announces a change to. */
  refresh?: CaravanNoticeView[];
  /** A Kessen duel notice riding on a `userMessage`: a challenge arrived or a duel began. */
  kessen?: {
    event: "challengeReceived" | "matchStarted";
    matchId?: string;
    kind?: string;
  };
  /** What happened to a Kessen challenge (`kessenChallenge`). */
  event?: "rejected" | "cancelled";
  requestId?: string;
};

/**
 * Reconcile live game events with notifications and cached game state.
 * Alert hidden defenders with their current sound-effect preference and volume.
 */
export const usePusherHandler = (
  userId?: string | null,
  userData?: Pick<NonNullable<UserWithRelations>, "clanId" | "villageId">,
  refreshUser?: () => Promise<unknown>,
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
  const { refreshServiceViews } = useCraftingServiceEvents(refreshUser);
  const store = useStore();

  // Pusher connection
  const [pusher, setPusher] = useState<Pusher | undefined>(undefined);

  // Pending chat events belong to the account, including across membership-channel rebinding.
  const notificationSession = useRef<symbol | undefined>(undefined);
  // Retain battle deduplication through membership rebinding, but reset it on account changes.
  const lastBattleNotification = useRef<string | undefined>(undefined);
  useEffect(() => {
    notificationSession.current = Symbol();
    lastBattleNotification.current = undefined;
    return () => {
      notificationSession.current = undefined;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void preloadAudioBuffers([transformImageUrl(BATTLE_ALERT_SFX_URL)]);
    // Unlock during a foreground gesture so an incoming background alert can play.
    return addUserInteractionListeners(unlockAudioPlayback);
  }, [userId]);

  // Listen on user channel for live updates on things
  useEffect(() => {
    if (userId) {
      const session = notificationSession.current;
      /** Keep notifications in the active account and unread conversation; pings bypass mutes. */
      const canNotifyConversation = (
        conversationId: string | undefined,
        isPing = false,
      ) => {
        const user = utils.profile.getUser.getData()?.userData;
        return (
          !!session &&
          notificationSession.current === session &&
          user?.userId === userId &&
          (isPing || !isConversationMuted(user, conversationId)) &&
          (!conversationId || !store.get(chatViewedConversationsAtom)[conversationId])
        );
      };
      const inboxKey = getQueryKey(
        api.comments.getUserConversations,
        undefined,
        "query",
      );
      const inboxHash = hashKey(inboxKey);
      const profileHash = hashKey(getQueryKey(api.profile.getUser, undefined, "query"));
      // A list read resets inbox news, even when its observer unmounts before delivery.
      // Successful server reads establish ordering without comparing client and server clocks.
      let inboxAcknowledged = queryClient.getQueryData(inboxKey) !== undefined;
      let inboxReadRevision = 0;
      let profileInboxRevision: number | undefined;
      let hasSubscribedProfileRead = false;
      const unsubscribeInboxReads = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated") return;
        if (event.query.queryHash === profileHash && event.action.type === "fetch") {
          profileInboxRevision = inboxReadRevision;
          hasSubscribedProfileRead = true;
        }
        if (event.action.type !== "success" || event.action.manual) return;
        if (event.query.queryHash === inboxHash) {
          inboxAcknowledged = true;
          inboxReadRevision += 1;
        } else if (
          event.query.queryHash === profileHash &&
          profileInboxRevision === inboxReadRevision
        ) {
          // A profile response can supersede only acknowledgements known when its read began.
          inboxAcknowledged = false;
        }
      });
      /** Whether a visible inbox list observes the conversation listing. */
      const inboxQuery = () =>
        queryClient.getQueryCache().find({ queryKey: inboxKey, exact: true });
      const isInboxListShown = () => !!inboxQuery()?.isActive();
      /** Wait for the initial profile before applying account, visibility and mute guards. */
      const resolveNotificationProfile = async (
        conversationId: string | undefined,
        isPing = false,
      ) => {
        if (!utils.profile.getUser.getData()?.userData) {
          try {
            // Join the initial profile request so its loading and error state can settle normally.
            await utils.profile.getUser.fetch(undefined, { staleTime: Infinity });
          } catch {
            // UserContext owns the profile failure and the page's recovery/redirect UX.
            return;
          }
        }
        return canNotifyConversation(conversationId, isPing);
      };
      const pendingBattleSubscriptions = new Set<() => void>();
      const applyBattleEvent = async (
        battleId: string,
        ownOrigin: boolean,
        userRecovery?: UserRecovery,
      ) => {
        const canApply = () => {
          const user = utils.profile.getUser.getData()?.userData;
          return (
            !!session &&
            notificationSession.current === session &&
            user?.userId === userId &&
            (!ownOrigin || user.battleId !== battleId)
          );
        };
        if (!canApply()) return;
        // UserContext obtains its socket from this hook; patch known admission before navigation.
        await utils.profile.getUser.cancel();
        if (!canApply()) return;
        await updateUserCache(
          queryClient,
          getQueryKey(api.profile.getUser, undefined, "query"),
          { status: "BATTLE", battleId, updatedAt: new Date() },
          { refetch: false, userRecovery },
        );
        pushToCombat(router, battleId);
        void utils.combat.getBattle.invalidate();
      };
      /** Bind the account's channels once the client has loaded. */
      const subscribe = (pusher: Pusher) => {
        // Listening on userId channel
        const channel = pusher.subscribe(userId);
        channel.bind("pusher:subscription_succeeded", async () => {
          if (isCancelled || notificationSession.current !== session) return;
          hasSubscribedProfileRead = false;
          // A snapshot read before subscription can miss events during the client download.
          // Join initial loading, then reconcile unless a read already began after binding.
          const profile = await utils.profile.getUser
            .fetch(undefined, {
              staleTime: Infinity,
            })
            .catch(() => {
              // UserContext exposes profile failures and owns their recovery/redirect UX.
              return undefined;
            });
          if (
            !profile ||
            isCancelled ||
            notificationSession.current !== session ||
            profile.userData?.userId !== userId ||
            hasSubscribedProfileRead
          )
            return;
          try {
            await utils.profile.getUser.invalidate();
          } catch {
            return;
          }
          const user = utils.profile.getUser.getData()?.userData;
          // A recovered admission must enter combat just like its missed live event.
          // An unchanged battle leaves deliberate navigation away from combat alone.
          if (
            !isCancelled &&
            notificationSession.current === session &&
            user?.userId === userId &&
            user.status === "BATTLE" &&
            user.battleId &&
            user.battleId !== profile.userData.battleId
          ) {
            pushToCombat(router, user.battleId);
            void utils.combat.getBattle.invalidate();
          }
        });
        channel.bind("event", async (data: UserEvent) => {
          if (data.type === "battle") {
            if (!data.battleId) return;
            const battleId = data.battleId;
            const user = utils.profile.getUser.getData()?.userData;
            if (
              notificationSession.current === session &&
              user?.userId === userId &&
              lastBattleNotification.current !== battleId
            ) {
              // Record silent admissions too, so a duplicate cannot sound after the tab is hidden.
              lastBattleNotification.current = battleId;
              if (
                data.isDefender &&
                document.hidden &&
                getAudioPreference("sfxOn", user.sfxOn)
              ) {
                void playPreloadedAudio(
                  transformImageUrl(BATTLE_ALERT_SFX_URL),
                  savedSfxVolume(),
                );
              }
            }
            const userRecovery = data.userRecovery
              ? superjson.deserialize<UserRecovery>(data.userRecovery)
              : undefined;
            const ownOrigin =
              !!data.originSocketId &&
              data.originSocketId === pusher.connection.socket_id;
            if (ownOrigin) {
              // Preserve the admission mutation's revision until its recovery and costs settle.
              const mutationCache = queryClient.getMutationCache();
              const pending = mutationCache
                .findAll({ status: "pending" })
                .filter((mutation) => {
                  const variables = mutation.state.variables;
                  return (
                    !!variables &&
                    typeof variables === "object" &&
                    "originSocketId" in variables &&
                    variables.originSocketId === data.originSocketId
                  );
                });
              if (pending.length) {
                const unsubscribe = mutationCache.subscribe(() => {
                  if (pending.some((mutation) => mutation.state.status === "pending"))
                    return;
                  unsubscribe();
                  pendingBattleSubscriptions.delete(unsubscribe);
                  // The socket confirms admission even when the response with costs is lost.
                  void applyBattleEvent(battleId, true, userRecovery);
                });
                pendingBattleSubscriptions.add(unsubscribe);
                return;
              }
            }
            await applyBattleEvent(battleId, ownOrigin, userRecovery);
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
          } else if (data.type === "dungeonParty") {
            // An open dungeon page shows the invitation at once instead of on its idle poll.
            void utils.coop.dungeon.getState.invalidate();
            showMutationToast({
              success: true,
              message: data.message ?? "You were invited to a dungeon party.",
              title: "Dungeon Party",
              action: (
                <ToastAction altText="Open Dungeons" asChild>
                  <Link href={data.route ?? "/dungeon"}>
                    {data.routeText ?? "Open Dungeons"}
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
            const serviceInboxRevision = inboxReadRevision;
            const serviceProfileConfirmed =
              data.craftingService && notificationSession.current === session
                ? await refreshServiceViews()
                : false;
            const shouldNotify =
              (await resolveNotificationProfile(data.conversationId)) &&
              canNotifyConversation(data.conversationId);
            if (!shouldNotify || isInboxListShown()) {
              // A shown list's reread also resets the server's inbox news, so no count appears.
              void utils.comments.getUserConversations.invalidate();
            } else if (
              serviceProfileConfirmed &&
              serviceInboxRevision === inboxReadRevision &&
              !inboxAcknowledged &&
              inboxQuery()?.state.fetchStatus !== "fetching"
            ) {
              // The committed service delivery is included in this confirmed profile.
              void utils.comments.getUserConversations.invalidate(undefined, {
                refetchType: "none",
              });
            } else if (
              data.craftingService ||
              inboxAcknowledged ||
              inboxQuery()?.state.fetchStatus === "fetching" ||
              !isInboxDeliveryAfterProfile(
                utils.profile.getUser.getData()?.serverTime,
                data.countedAt,
              )
            ) {
              // Profile reads can include a delivery, and list reads can acknowledge it.
              // Either uncertainty needs the authoritative count.
              void utils.comments.getUserConversations.invalidate();
              try {
                await utils.profile.getUser.invalidate(undefined, {
                  refetchType: "all",
                });
              } catch {
                // UserContext exposes a failed refresh; an eligible message can still show its toast.
              }
            } else {
              // The delivery already counted this message in the server's inbox news; the next
              // list read resets that counter and clears this count.
              void utils.comments.getUserConversations.invalidate(undefined, {
                refetchType: "none",
              });
              await updateUserNotifications(
                queryClient,
                getQueryKey(api.profile.getUser, undefined, "query"),
                incrementInboxNotifications,
              );
            }
            if (shouldNotify) {
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
            // Caravan notices can be urgent, so they show without waiting for these reads. A
            // shown caravan list reloads the Warehouse itself when the reread moved stock.
            const refresh = data.refresh ?? [];
            if (refresh.includes("profile")) void utils.profile.getUser.invalidate();
            if (refresh.includes("caravans"))
              void utils.caravan.getCaravans.invalidate();
            if (refresh.includes("routes"))
              void utils.tradeRoute.getRoutes.invalidate();
            if (refresh.includes("controls"))
              void utils.caravanOps.getControls.invalidate();
            // The duel lobby lists the new challenge, or the duel that began.
            if (data.kessen) void utils.kessenPvp.getLobby.invalidate();
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
          } else if (data.type === "kessenChallenge") {
            const requestId = data.requestId;
            if (requestId)
              utils.kessenPvp.getLobby.setData(undefined, (lobby) =>
                lobby ? getKessenPvpLobbyWithoutChallenge(lobby, requestId) : lobby,
              );
            showMutationToast({
              success: true,
              message:
                data.event === "rejected"
                  ? "Your Kessen challenge was declined."
                  : "A Kessen challenge was withdrawn.",
              title: "Notification!",
            });
          } else if (data.type === "pinged") {
            const conversationId = data.conversationId;
            if (
              (await resolveNotificationProfile(conversationId, true)) &&
              canNotifyConversation(conversationId, true)
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
      };
      // pusher-js loads after hydration, and only for a signed-in player.
      let pusher: Pusher | undefined;
      let isCancelled = false;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let failedAttempts = 0;
      const connect = (PusherClient: typeof Pusher) => {
        // A sign-out or account switch during the download must not open a connection.
        if (isCancelled) return;
        const connection = new PusherClient(
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
        pusher = connection;
        setPusher(connection);
        subscribe(connection);
      };
      // A failed download (a flaky network, or a chunk a newer deploy removed) retries
      // with backoff, so the tab does not stay without live updates.
      const load = () => {
        loadPusherClient().then(
          ({ default: PusherClient }) => connect(PusherClient),
          () => {
            if (isCancelled) return;
            failedAttempts += 1;
            retryTimer = setTimeout(
              load,
              Math.min(MAX_CLIENT_RETRY_MS, 1000 * 2 ** failedAttempts),
            );
          },
        );
      };
      load();
      // Cleanup
      return () => {
        isCancelled = true;
        clearTimeout(retryTimer);
        unsubscribeInboxReads();
        for (const unsubscribe of pendingBattleSubscriptions) unsubscribe();
        if (!pusher) return;
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
