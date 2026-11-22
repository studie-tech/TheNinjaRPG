import { isKessenPackId } from "@/libs/kessen/packs";
import type {
  KessenEvent,
  KessenHub,
  KessenMatchLog,
  KessenMatchPayload,
  KessenMatchQuery,
} from "@/validators/kessen";

/** Ryo a finished match paid, credited to the cached profile; nothing for unpaid matches. */
export const getKessenPayoutUserUpdate = (ryo: number) =>
  ryo > 0 ? { userDelta: { money: ryo } } : {};

/**
 * The cached match after a confirmed response: the server's payload, unless the cache
 * already holds a newer version of the same match (a later response landed first). A
 * cached play log in step with the cached match gains the response's `events`; without
 * events it keeps the version it reflects.
 */
export const getKessenMatchCache = (
  current: KessenMatchQuery | undefined,
  confirmed: KessenMatchPayload,
  events: readonly KessenEvent[] = [],
): KessenMatchQuery => {
  const cached = current?.match;
  if (cached && cached.id === confirmed.id && cached.version > confirmed.version)
    return current ?? { match: cached };
  const log = cached?.id === confirmed.id ? current?.log : undefined;
  if (!log || !cached) return { match: confirmed };
  if (events.length === 0 || log.version !== cached.version)
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

/** The hub after a match started: it is now the active match; a replaced one is gone. */
export const getKessenHubAfterStart = (
  hub: KessenHub,
  match: KessenMatchPayload,
): KessenHub => ({ ...hub, activeMatch: kessenActiveMatchOf(match) });

/**
 * The hub after a confirmed turn of a match that goes on: the active match's round,
 * round wins and turn follow the confirmed view. Another match leaves the hub as is.
 */
export const getKessenHubAfterTurn = (
  hub: KessenHub,
  match: KessenMatchPayload,
): KessenHub =>
  hub.activeMatch?.id === match.id && match.status === "ACTIVE"
    ? { ...hub, activeMatch: kessenActiveMatchOf(match) }
    : hub;

/** The hub's summary of an active match, read from the player's view of it. */
const kessenActiveMatchOf = (
  match: KessenMatchPayload,
): NonNullable<KessenHub["activeMatch"]> => {
  const { view } = match;
  return {
    id: match.id,
    npcKey: match.npcKey,
    mode: match.mode,
    lesson: match.lesson,
    challenge: match.challenge ?? null,
    round: view.round,
    roundWins: [
      view.history.filter((round) => round.winner === view.me).length,
      view.history.filter((round) => round.winner !== null && round.winner !== view.me)
        .length,
    ],
    yourTurn:
      view.phase === "mulligan"
        ? view.seats[view.me].mullPending
        : view.phase === "play" && view.turn === view.me,
  };
};

/**
 * The hub after a match ended (finish, concession or expiry): no active match, today's
 * counters, the week's first-win pack (a rewarded win uses it), the granted cards and a
 * first-win pick it leaves open. Unlocks and first wins are not projected; callers
 * refetch the hub when the result reports a first win or a completed lesson.
 */
export const getKessenHubAfterEnd = (
  hub: KessenHub,
  match: KessenMatchPayload,
  granted: readonly { itemId: string; quantity: number }[],
): KessenHub => {
  const result = match.result;
  const pick = kessenPendingPickOf(match);
  return {
    ...getKessenHubWithGrants(hub, granted),
    activeMatch: hub.activeMatch?.id === match.id ? null : hub.activeMatch,
    pendingPicks: pick
      ? [pick, ...hub.pendingPicks.filter((entry) => entry.matchId !== match.id)]
      : hub.pendingPicks,
    today: result?.rewarded
      ? {
          ...hub.today,
          rewarded: hub.today.rewarded + 1,
          drops:
            hub.today.drops +
            (result.winner === 0 && hub.today.drops < hub.today.dropsCap ? 1 : 0),
        }
      : hub.today,
    week:
      result?.rewarded && result.winner === 0
        ? { ...hub.week, firstWinPack: false }
        : hub.week,
  };
};

/** The hub after a first-win pick was claimed: the pick leaves and its card is owned. */
export const getKessenHubAfterClaim = (
  hub: KessenHub,
  matchId: string,
  granted: readonly { itemId: string; quantity: number }[],
): KessenHub => {
  const next = getKessenHubWithGrants(hub, granted);
  return {
    ...next,
    pendingPicks: next.pendingPicks.filter((entry) => entry.matchId !== matchId),
  };
};

/** The first-win card pick a finished match still offers, or null. */
export const kessenPendingPickOf = (
  match: KessenMatchPayload,
): KessenHub["pendingPicks"][number] | null => {
  const choice = match.result?.firstWin?.choice;
  return match.status === "FINISHED" &&
    (choice?.kind === "items" || choice?.kind === "unownedLegendary") &&
    choice.options.length > 0 &&
    choice.claimed === null
    ? { matchId: match.id, npcKey: match.npcKey }
    : null;
};

/** The hub with granted cards added to the owned copies; packs are not cards. */
export const getKessenHubWithGrants = (
  hub: KessenHub,
  granted: readonly { itemId: string; quantity: number }[],
): KessenHub => {
  const cards = granted.filter((grant) => !isKessenPackId(grant.itemId));
  if (cards.length === 0) return hub;
  const owned = { ...hub.owned };
  for (const grant of cards)
    owned[grant.itemId] = (owned[grant.itemId] ?? 0) + grant.quantity;
  return { ...hub, owned };
};

/**
 * Whether an ended match's result put items in the inventory: kept drops, first-win
 * cards or packs, or the weekly first-win pack. A response can report such a result
 * without listing the grants (another request settled the match), so callers refresh
 * the inventory, and the hub when no grants were listed, from the result itself.
 */
export const kessenResultGrantsItems = (match: KessenMatchPayload) => {
  const result = match.result;
  if (!result || match.status === "ACTIVE") return false;
  return (
    result.drops.some((drop) => drop.soldFor === null) ||
    (result.firstWin?.itemIds.length ?? 0) > 0 ||
    result.weeklyFirstWinPack
  );
};

/** Whether confirmed grants include packs, whose stacks only a hub read can name. */
export const kessenGrantsPacks = (granted: readonly { itemId: string }[]) =>
  granted.some((grant) => isKessenPackId(grant.itemId));

/** Whether an ended match changed what the hub derives from progress (unlocks, starter). */
export const kessenEndNeedsHubRefresh = (match: KessenMatchPayload) =>
  !!match.result?.firstWin || !!match.result?.lessonCompleted;

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
