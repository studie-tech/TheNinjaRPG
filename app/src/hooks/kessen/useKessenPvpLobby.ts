"use client";

import { getQueryKey } from "@trpc/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  getKessenPvpLobbyAfterStart,
  getKessenPvpLobbyQueueStatus,
  getKessenPvpLobbyWithoutChallenge,
} from "@/deltas/kessenPvp";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type {
  KessenDeckSource,
  KessenPvpLobby,
  KessenPvpMatchPayload,
} from "@/validators/kessen";

/** What a duel lobby action resolves with; `message` explains a rejection next to it. */
export type KessenPvpOutcome = {
  ok: boolean;
  message: string;
  /** The duel an accepted challenge started. */
  match?: KessenPvpMatchPayload;
  /** A duel to open: a ranked opponent found on joining or leaving the queue. */
  matchId?: string;
};

/**
 * The duel lobby (`kessenPvp.getLobby`) and its actions: challenge a player, answer or
 * withdraw a challenge, join or leave the ranked queue. Each action resolves with the
 * server's message and never throws; confirmed answers patch the lobby, and an accepted
 * challenge seeds its duel's `kessenPvp.getMatch` query. A transport failure leaves the
 * outcome unknown, so the lobby is read again.
 */
export const useKessenPvpLobby = (enabled = true) => {
  const lobby = api.kessenPvp.getLobby.useQuery(undefined, {
    enabled,
    staleTime: 15_000,
  });
  const utils = api.useUtils();
  const cache = useKessenPvpLobbyCache();
  const create = api.kessenPvp.createChallenge.useMutation();
  const accept = api.kessenPvp.acceptChallenge.useMutation();
  const reject = api.kessenPvp.rejectChallenge.useMutation();
  const cancel = api.kessenPvp.cancelChallenge.useMutation();
  const join = api.kessenPvp.joinRankedQueue.useMutation();
  const leave = api.kessenPvp.leaveRankedQueue.useMutation();

  /** Runs one action; a failed request reads the lobby again and resolves its reason. */
  const run = async <T>(request: () => Promise<T>, fallback: string) => {
    const sent = await settle(request);
    if (!sent.ok) {
      void utils.kessenPvp.getLobby.invalidate();
      return { data: null, message: errorText(sent.error, fallback) };
    }
    return { data: sent.value, message: "" };
  };

  const createChallenge = async (input: {
    targetId: string;
    deck: KessenDeckSource;
  }): Promise<KessenPvpOutcome> => {
    const { data, message } = await run(
      () => create.mutateAsync(input),
      "The challenge could not be sent.",
    );
    if (!data) return { ok: false, message };
    // The new challenge's id and expiry come from the server.
    if (data.success) void utils.kessenPvp.getLobby.invalidate();
    return { ok: data.success, message: data.message };
  };

  const acceptChallenge = async (input: {
    requestId: string;
    deck: KessenDeckSource;
  }): Promise<KessenPvpOutcome> => {
    const snapshot = cache.prepareUpdate();
    const { data, message } = await run(
      () => accept.mutateAsync(input),
      "The challenge could not be accepted.",
    );
    if (!data) return { ok: false, message };
    if (!data.success || !("match" in data) || !data.match) {
      // A challenge that is gone or expired leaves the list either way.
      void utils.kessenPvp.getLobby.invalidate();
      return { ok: false, message: data.message };
    }
    const match = data.match;
    utils.kessenPvp.getMatch.setData({ matchId: match.id }, { match, log: null });
    await cache.updateCache(
      (current) =>
        getKessenPvpLobbyAfterStart(
          getKessenPvpLobbyWithoutChallenge(current, input.requestId),
          match,
        ),
      snapshot,
    );
    return { ok: true, message: data.message, match };
  };

  const answer =
    (
      mutate: (input: { requestId: string }) => Promise<{
        success: boolean;
        message: string;
      }>,
    ) =>
    async (requestId: string): Promise<KessenPvpOutcome> => {
      const snapshot = cache.prepareUpdate();
      const { data, message } = await run(
        () => mutate({ requestId }),
        "The challenge could not be answered.",
      );
      if (!data) return { ok: false, message };
      // A challenge that was answered elsewhere leaves the list too.
      await cache.updateCache(
        (current) => getKessenPvpLobbyWithoutChallenge(current, requestId),
        snapshot,
      );
      return { ok: data.success, message: data.message };
    };

  const joinRankedQueue = async (deck: KessenDeckSource): Promise<KessenPvpOutcome> => {
    const snapshot = cache.prepareUpdate();
    const { data, message } = await run(
      () => join.mutateAsync({ deck }),
      "The queue could not be joined.",
    );
    if (!data) return { ok: false, message };
    if (!data.success || !("inQueue" in data)) {
      void utils.kessenPvp.getLobby.invalidate();
      return { ok: false, message: data.message };
    }
    if (data.matchId) {
      void utils.kessenPvp.getLobby.invalidate();
      return { ok: true, message: data.message, matchId: data.matchId };
    }
    await cache.updateCache(
      (current) => getKessenPvpLobbyQueueStatus(current, data),
      snapshot,
    );
    return { ok: true, message: data.message };
  };

  const leaveRankedQueue = async (): Promise<KessenPvpOutcome> => {
    const snapshot = cache.prepareUpdate();
    const { data, message } = await run(
      () => leave.mutateAsync(),
      "The queue could not be left.",
    );
    if (!data) return { ok: false, message };
    const matchId = "matchId" in data && data.matchId ? data.matchId : undefined;
    if (matchId) {
      void utils.kessenPvp.getLobby.invalidate();
      return { ok: false, message: data.message, matchId };
    }
    // Left, or not queued any more: either way no queue row remains.
    await cache.updateCache(
      (current) =>
        getKessenPvpLobbyQueueStatus(current, { inQueue: false, queuedAt: null }),
      snapshot,
    );
    return { ok: data.success, message: data.message };
  };

  return {
    lobby,
    createChallenge,
    acceptChallenge,
    rejectChallenge: answer(reject.mutateAsync),
    cancelChallenge: answer(cancel.mutateAsync),
    joinRankedQueue,
    leaveRankedQueue,
    isChallenging: create.isPending,
    isAnswering: accept.isPending || reject.isPending || cancel.isPending,
    isJoining: join.isPending,
    isLeaving: leave.isPending,
  };
};

/**
 * Polls the ranked queue every ten seconds while the lobby holds a queue row: each poll
 * is the queue's heartbeat and runs matchmaking. A found duel calls `onMatchFound` and
 * reads the lobby again; a row the server removed clears the queue and returns its
 * message. Polls are not player actions, so a transport failure stays silent and the
 * next poll retries.
 */
export const useRankedQueuePolling = (
  lobby: KessenPvpLobby | undefined,
  onMatchFound: (matchId: string) => void,
) => {
  const utils = api.useUtils();
  const cache = useKessenPvpLobbyCache();
  const [message, setMessage] = useState<string | null>(null);
  const check = api.kessenPvp.checkRankedQueue.useMutation({
    meta: { handlesTransportError: true },
  });
  const queuedAt = lobby?.queue?.queuedAt ?? null;
  const queued = queuedAt !== null;

  const poll = useEffectEvent(async () => {
    if (check.isPending) return;
    const snapshot = cache.prepareUpdate();
    const sent = await settle(() => check.mutateAsync());
    if (!sent.ok) return;
    const status = sent.value;
    if (status.matchId) {
      setMessage(null);
      onMatchFound(status.matchId);
      void utils.kessenPvp.getLobby.invalidate();
      return;
    }
    if (!status.inQueue) setMessage(status.message || null);
    await cache.updateCache(
      (current) => getKessenPvpLobbyQueueStatus(current, status),
      snapshot,
    );
  });

  useEffect(() => {
    if (!queued) return;
    setMessage(null);
    const timer = window.setInterval(() => void poll(), RANKED_QUEUE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [queued]);

  return { message, clearMessage: () => setMessage(null) };
};

/** The ranked ladder's top players and the viewer's own place. */
export const useKessenLeaderboard = (enabled = true) =>
  api.kessenPvp.getLeaderboard.useQuery(
    { limit: LEADERBOARD_SIZE },
    { enabled, staleTime: 60_000 },
  );

/** The lobby's query cache, for confirmed patches. */
export const useKessenPvpLobbyCache = () =>
  useQueryCacheUpdate<KessenPvpLobby>(
    getQueryKey(api.kessenPvp.getLobby, undefined, "query"),
  );

/**
 * Runs a request and reports a rejection as a value, which keeps `try` out of the
 * hook (the React Compiler cannot lower value blocks inside one).
 */
const settle = async <T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
};

/** A client error keeps its own reason; transport and server failures use `fallback`. */
const errorText = (error: unknown, fallback: string) => {
  const httpStatus = (error as { data?: { httpStatus?: unknown } } | null)?.data
    ?.httpStatus;
  return error instanceof Error &&
    error.message &&
    typeof httpStatus === "number" &&
    httpStatus < 500
    ? error.message
    : fallback;
};

// Three heartbeats per `KESSEN_RANKED_QUEUE_HEARTBEAT_SECONDS`; a found duel is also pushed.
const RANKED_QUEUE_POLL_MS = 10_000;
const LEADERBOARD_SIZE = 20;
