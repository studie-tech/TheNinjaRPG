"use client";

import { getQueryKey } from "@trpc/react-query";
import { useEffect, useRef } from "react";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import { kessenGrantsPacks } from "@/deltas/kessen";
import {
  getKessenPvpLobbyAfterEnd,
  getKessenPvpMatchCache,
  isNewerKessenPvpVersion,
} from "@/deltas/kessenPvp";
import { errorText, settle } from "@/hooks/kessen/settle";
import { useKessenPvpLobbyCache } from "@/hooks/kessen/useKessenPvpLobby";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useUserDataSelector, useUserInfo } from "@/utils/UserContext";
import type {
  KessenEvent,
  KessenPvpMatchPayload,
  KessenPvpMatchQuery,
} from "@/validators/kessen";

/** What a duel decision resolves with; `message` explains a rejection next to it. */
export type KessenDuelOutcome = {
  ok: boolean;
  payload?: KessenPvpMatchPayload;
  events?: KessenEvent[];
  message?: string;
};

type DuelAction = RouterInputs["kessenPvp"]["playTurn"]["action"];
type DuelResponse =
  | RouterOutputs["kessenPvp"]["playTurn"]
  | RouterOutputs["kessenPvp"]["concede"];

/**
 * One duel seat: the `kessenPvp.getMatch` payload and play log, `play` and `concede`.
 * The duel's channel pushes `{ version }` after every change; a newer version reads this
 * seat's own view again (pushes carry nothing else, so hidden cards never travel). A
 * push during this seat's own request waits for its response. When the clock's deadline
 * passes, the duel is read about a second later so the server applies the timeout; a
 * result still settling is read again until it is settled, and a settled ending reads the
 * lobby again. Confirmed responses patch the duel (with their events appended to the
 * log) and, once it ended, the lobby; paid ryo and packs reach the profile and inventory.
 */
export const useKessenDuel = (matchId: string | null) => {
  const input = { matchId: matchId ?? "" };
  const query = api.kessenPvp.getMatch.useQuery(input, {
    enabled: !!matchId,
    staleTime: 5_000,
  });
  const utils = api.useUtils();
  const matchCache = useQueryCacheUpdate<KessenPvpMatchQuery>(
    getQueryKey(api.kessenPvp.getMatch, input, "query"),
  );
  const lobbyCache = useKessenPvpLobbyCache();
  const { pusher } = useUserDataSelector(selectUserId);
  const { prepareUserUpdate, updateUser } = useUserInfo();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const playTurn = api.kessenPvp.playTurn.useMutation();
  const concedeDuel = api.kessenPvp.concede.useMutation();
  const pending = playTurn.isPending || concedeDuel.isPending;
  // A version pushed while this seat's own request was out, read once it settles.
  const pushedDuringRequest = useRef(0);
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const match = query.data?.match ?? null;

  const refetch = () => {
    if (matchId) void utils.kessenPvp.getMatch.invalidate({ matchId });
  };

  // The duel's channel: a newer version reads this seat's view again.
  useEffect(() => {
    if (!matchId || !pusher) return;
    const channel = pusher.subscribe(matchId);
    const onUpdate = (data: { version?: number }) => {
      if (typeof data.version !== "number") return;
      const current = utils.kessenPvp.getMatch.getData({ matchId });
      if (!isNewerKessenPvpVersion(current, { version: data.version })) return;
      if (pendingRef.current) {
        pushedDuringRequest.current = Math.max(
          pushedDuringRequest.current,
          data.version,
        );
        return;
      }
      void utils.kessenPvp.getMatch.invalidate({ matchId });
    };
    channel.bind("event", onUpdate);
    return () => {
      channel.unbind("event", onUpdate);
      pusher.unsubscribe(matchId);
    };
  }, [matchId, pusher]);

  // A push that landed during this seat's own request is read once it settled.
  useEffect(() => {
    if (pending || !match) return;
    if (pushedDuringRequest.current > match.version) refetch();
    pushedDuringRequest.current = 0;
  }, [pending, match?.version]);

  // The deadline driver: about a second after the clock runs out, the read applies the
  // timeout (the server resolves it lazily) and pushes it to both seats. Each read
  // measures the wait again from its own server time.
  const deadline = match?.clock.deadline
    ? new Date(match.clock.deadline).getTime()
    : null;
  const serverNow = match ? new Date(match.clock.serverNow).getTime() : 0;
  useEffect(() => {
    if (deadline === null) return;
    const wait = Math.max(0, deadline - serverNow) + DEADLINE_GRACE_MS;
    const timer = window.setTimeout(refetch, wait);
    return () => window.clearTimeout(timer);
  }, [deadline, serverNow]);

  // An ending this seat learns from a read (the opponent's last play or concession, a
  // timeout) frees the lobby's active duel and may move the ranked record: the lobby is
  // read again once the result is settled.
  const endedAndSettled =
    !!match && match.status !== "ACTIVE" && !match.result?.settling;
  useEffect(() => {
    if (endedAndSettled) void utils.kessenPvp.getLobby.invalidate();
  }, [endedAndSettled, match?.id]);

  // A result between its ending write and its settlement is read again shortly.
  const settling = match?.result?.settling === true;
  useEffect(() => {
    if (!settling) return;
    const timer = window.setTimeout(refetch, SETTLING_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [settling, match?.version]);

  const reconcile = async (
    snapshot: {
      match: ReturnType<typeof matchCache.prepareUpdate>;
      user: ReturnType<typeof prepareUserUpdate>;
    },
    lobbySnapshot: ReturnType<typeof lobbyCache.prepareUpdate>,
    data: DuelResponse,
  ) => {
    const confirmed = "match" in data ? data.match : undefined;
    if (!confirmed) return;
    const events = "events" in data ? data.events : [];
    const ended = confirmed.status !== "ACTIVE";
    const granted = "granted" in data ? (data.granted ?? []) : [];
    if (granted.length > 0) void invalidateInventory();
    // A pack reward adds a stack the Card Hall lists from its hub read.
    if (kessenGrantsPacks(granted)) void utils.kessen.getHub.invalidate();
    // A result still settling moves the lobby once it settles.
    if (ended && confirmed.result?.settling) void utils.kessenPvp.getLobby.invalidate();
    const userDelta = "userDelta" in data ? data.userDelta : undefined;
    await Promise.all([
      matchCache.updateCache(
        (current) => getKessenPvpMatchCache(current, confirmed, events),
        snapshot.match,
      ),
      ended
        ? lobbyCache.updateCache(
            (lobby) => getKessenPvpLobbyAfterEnd(lobby, confirmed),
            lobbySnapshot,
          )
        : null,
      userDelta
        ? updateUser({ success: data.success, userDelta }, { revision: snapshot.user })
        : null,
    ]);
  };

  const send = async (
    request: () => Promise<DuelResponse>,
  ): Promise<KessenDuelOutcome> => {
    if (!match) return { ok: false, message: "The duel is still loading." };
    const snapshot = { match: matchCache.prepareUpdate(), user: prepareUserUpdate() };
    const lobbySnapshot = lobbyCache.prepareUpdate();
    const sent = await settle(request);
    if (!sent.ok) {
      // The outcome is unknown: read the duel, the lobby and the profile again.
      refetch();
      void utils.kessenPvp.getLobby.invalidate();
      void updateUser(undefined);
      return { ok: false, message: errorText(sent.error) };
    }
    const data = sent.value;
    await reconcile(snapshot, lobbySnapshot, data);
    return {
      ok: data.success,
      payload: "match" in data ? data.match : undefined,
      events: "events" in data ? data.events : undefined,
      message: data.message,
    };
  };

  const play = (action: DuelAction) =>
    send(() =>
      playTurn.mutateAsync({
        matchId: match?.id ?? "",
        version: match?.version ?? 0,
        action,
      }),
    );

  const concede = () =>
    send(() => concedeDuel.mutateAsync({ matchId: match?.id ?? "" }));

  return {
    ...query,
    match,
    log: query.data?.log ?? null,
    play,
    concede,
    isActing: pending,
  };
};

/**
 * A duel watched without a seat: the `kessenPvp.watchMatch` payload and play log, both
 * hands hidden. Like a seat it reads the duel again when its channel pushes a newer
 * version; the seats drive the clock, so watching never writes.
 */
export const useWatchedKessenDuel = (matchId: string, enabled = true) => {
  const query = api.kessenPvp.watchMatch.useQuery(
    { matchId },
    { enabled, staleTime: 5_000 },
  );
  const utils = api.useUtils();
  const { pusher } = useUserDataSelector(selectUserId);
  useEffect(() => {
    if (!enabled || !pusher) return;
    const channel = pusher.subscribe(matchId);
    const onUpdate = (data: { version?: number }) => {
      if (typeof data.version !== "number") return;
      const current = utils.kessenPvp.watchMatch.getData({ matchId });
      if (isNewerKessenPvpVersion(current, { version: data.version }))
        void utils.kessenPvp.watchMatch.invalidate({ matchId });
    };
    channel.bind("event", onUpdate);
    return () => {
      channel.unbind("event", onUpdate);
      pusher.unsubscribe(matchId);
    };
  }, [matchId, pusher, enabled]);
  return { ...query, match: query.data?.match ?? null, log: query.data?.log ?? null };
};

const selectUserId = (user: { userId: string }) => ({ userId: user.userId });

/** Read the duel this long after its deadline, so the server's clock has passed it. */
const DEADLINE_GRACE_MS = 1_000;
/** Read a settling result again after this long. */
const SETTLING_RETRY_MS = 1_500;
