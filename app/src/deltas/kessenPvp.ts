import type {
  KessenEvent,
  KessenMatchLog,
  KessenPvpLobby,
  KessenPvpMatchPayload,
  KessenPvpMatchQuery,
} from "@/validators/kessen";

/**
 * A play log of `events` (already redacted for the player) at match `version`, naming
 * only the instances the events refer to from `inst`. Instance ids name one card for
 * the whole match, so later views extend the names without changing them.
 */
export const getKessenMatchLog = (
  events: readonly KessenEvent[],
  inst: Readonly<Record<string, string>>,
  version: number,
): KessenMatchLog => {
  const names: Record<string, string> = {};
  for (const event of events) {
    for (const id of kessenEventInstances(event)) {
      const cardId = inst[id];
      if (cardId !== undefined) names[id] = cardId;
    }
  }
  return { version, events: [...events], inst: names };
};

/**
 * The cached duel after a confirmed response or a refetch: the newer of the cached and
 * the confirmed payload (the opponent's push can land before this seat's own response).
 * A cached play log in step with the cached duel gains the response's `events`; a log
 * that is not in step is kept until `getMatch` replaces it.
 */
export const getKessenPvpMatchCache = (
  current: KessenPvpMatchQuery | undefined,
  confirmed: KessenPvpMatchPayload,
  events: readonly KessenEvent[] = [],
): KessenPvpMatchQuery => {
  const cached = current?.match;
  if (cached && cached.id === confirmed.id && cached.version > confirmed.version)
    return current ?? { match: cached, log: null };
  const log = cached?.id === confirmed.id ? (current?.log ?? null) : null;
  if (!log || !cached || events.length === 0 || log.version !== cached.version)
    return { match: confirmed, log };
  return {
    match: confirmed,
    log: getKessenMatchLog(
      [...log.events, ...events],
      { ...cached.view.inst, ...confirmed.view.inst, ...log.inst },
      confirmed.version,
    ),
  };
};

/** Whether a `{ version }` push on a duel's channel is newer than the cached duel. */
export const isNewerKessenPvpVersion = (
  current: KessenPvpMatchQuery | undefined,
  pushed: { version: number },
) => !current?.match || pushed.version > current.match.version;

/** The lobby after a challenge was answered or withdrawn: it leaves the list. */
export const getKessenPvpLobbyWithoutChallenge = (
  lobby: KessenPvpLobby,
  requestId: string,
): KessenPvpLobby => ({
  ...lobby,
  challenges: lobby.challenges.filter((challenge) => challenge.id !== requestId),
});

/**
 * The lobby once a duel began (an accepted challenge or a ranked match): it is the
 * active duel, and the player is no longer queued.
 */
export const getKessenPvpLobbyAfterStart = (
  lobby: KessenPvpLobby,
  match: KessenPvpMatchPayload,
): KessenPvpLobby => {
  const opponentSeat = match.seat === 0 ? 1 : 0;
  const opponent = match.players[opponentSeat];
  return {
    ...lobby,
    queue: null,
    activeMatch: {
      id: match.id,
      kind: match.kind,
      seat: match.seat,
      opponent: { userId: opponent.userId, username: opponent.username },
      deadline: match.clock.deadline,
      yourTurn: match.clock.acting.includes(match.seat),
    },
  };
};

/**
 * The lobby after a duel ended: no active duel, and a settled ranked result moves the
 * rating, the record and today's rewarded wins. A result still settling changes only
 * the active duel; the lobby is refetched once it settles.
 */
export const getKessenPvpLobbyAfterEnd = (
  lobby: KessenPvpLobby,
  match: KessenPvpMatchPayload,
): KessenPvpLobby => {
  const result = match.result;
  const base = {
    ...lobby,
    activeMatch: lobby.activeMatch?.id === match.id ? null : lobby.activeMatch,
  };
  if (!result?.rating || result.settling) return base;
  const { ranked } = lobby;
  return {
    ...base,
    ranked: {
      ...ranked,
      rating: result.rating.you.after,
      played: ranked.played + 1,
      wins: ranked.wins + (result.outcome === "win" ? 1 : 0),
      losses: ranked.losses + (result.outcome === "loss" ? 1 : 0),
      draws: ranked.draws + (result.outcome === "draw" ? 1 : 0),
      rewardedToday: ranked.rewardedToday + (result.reward ? 1 : 0),
      weeklyWins: ranked.weeklyWins + (result.reward ? 1 : 0),
    },
  };
};

/**
 * The lobby after a ranked queue response (joining, a poll or leaving): the queue row
 * while the player is still searching, none once they left, were removed or a duel was
 * found, and the latest count of players searching.
 */
export const getKessenPvpLobbyQueueStatus = (
  lobby: KessenPvpLobby,
  status: { inQueue: boolean; queuedAt: Date | null; queueCount?: number },
): KessenPvpLobby => ({
  ...lobby,
  queue:
    status.inQueue && status.queuedAt
      ? { queuedAt: status.queuedAt, matchId: null }
      : null,
  queueCount: status.queueCount ?? lobby.queueCount,
});

/** Instance ids an event names; redacted ids (`?`) are skipped. */
const kessenEventInstances = (event: KessenEvent): string[] => {
  const ids: string[] = [];
  if ("id" in event) ids.push(event.id);
  if (event.t === "drawn") ids.push(...event.cards);
  if (event.t === "mulligan") ids.push(...event.removed, ...event.drawn);
  if (event.t === "cleanup")
    ids.push(...event.kept, ...event.discarded, ...event.banished);
  return ids.filter((id) => id !== "?");
};
