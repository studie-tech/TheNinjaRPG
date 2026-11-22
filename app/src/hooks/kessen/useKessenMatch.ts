"use client";

import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import {
  getKessenHubAfterClaim,
  getKessenHubAfterEnd,
  getKessenHubAfterTurn,
  getKessenMatchCache,
  kessenEndNeedsHubRefresh,
  kessenGrantsPacks,
  kessenResultGrantsItems,
} from "@/deltas/kessen";
import { errorText, settle } from "@/hooks/kessen/settle";
import { useKessenHubCache } from "@/hooks/kessen/useKessenHubCache";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useUserInfo } from "@/utils/UserContext";
import type { KessenEvent, KessenMatchPayload } from "@/validators/kessen";
import type { UserCachePatch } from "@/validators/userCache";

/** What a match action resolves with; `message` explains a rejection next to the action. */
export type KessenActionOutcome = {
  ok: boolean;
  payload?: KessenMatchPayload;
  events?: KessenEvent[];
  message?: string;
};

type MatchCache = RouterOutputs["kessen"]["getMatch"];
type KessenActionInput = RouterInputs["kessen"]["playTurn"]["action"];
type TurnResponse =
  | RouterOutputs["kessen"]["playTurn"]
  | RouterOutputs["kessen"]["concede"];

/**
 * One Kessen match: the `kessen.getMatch` payload plus `play`, `concede` and
 * `claimChoice`, each resolving with the confirmed payload. Confirmed responses patch the
 * match query (a stale version returns the fresh match, which replaces the cache) and the
 * hub: the active match's standing while it goes on; once it ended, the counters, cards
 * and open picks, with paid ryo (or a quest challenge's finished objective) applied to
 * the profile. The inventory (and the hub after a first win) refreshes in the background
 * so playback starts at once. A transport or server failure resolves at once with a
 * rejection the table shows next to the action; the outcome is unknown, so the match,
 * hub, profile and inventory are read again in the background.
 */
export const useKessenMatch = (matchId: string | null) => {
  const input = { matchId: matchId ?? "" };
  const query = api.kessen.getMatch.useQuery(input, {
    enabled: !!matchId,
    staleTime: 30_000,
  });
  const utils = api.useUtils();
  const matchCache = useQueryCacheUpdate<MatchCache>(
    getQueryKey(api.kessen.getMatch, input, "query"),
  );
  const hubCache = useKessenHubCache();
  const { prepareUserUpdate, updateUser } = useUserInfo();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const playTurn = api.kessen.playTurn.useMutation();
  const concedeMatch = api.kessen.concede.useMutation();
  const claimFirstWinChoice = api.kessen.claimFirstWinChoice.useMutation();

  /** Capture the caches this match's key points at when the action starts. */
  const prepare = () => ({
    match: matchCache.prepareUpdate(),
    hub: hubCache.prepareHubUpdate(),
    user: prepareUserUpdate(),
  });

  const reconcile = async (
    snapshot: ReturnType<typeof prepare>,
    data: {
      success: boolean;
      match?: KessenMatchPayload;
      granted?: { itemId: string; quantity: number }[];
      userDelta?: { money?: number };
      userPatch?: UserCachePatch;
    },
  ) => {
    const confirmed = data.match;
    if (!confirmed) return;
    const ended = confirmed.status !== "ACTIVE";
    const granted = data.granted ?? [];
    const grantsItems = ended && kessenResultGrantsItems(confirmed);
    // Refetches run in the background: the confirmed patches below are what playback
    // needs. Grants create inventory rows whose ids only the server knows (the hub's pack
    // stacks among them), and a result whose grants this response does not list leaves
    // the hub's owned cards unknown.
    if (
      ended &&
      (kessenEndNeedsHubRefresh(confirmed) ||
        kessenGrantsPacks(granted) ||
        (grantsItems && granted.length === 0))
    )
      void utils.kessen.getHub.invalidate();
    if (granted.length > 0 || grantsItems) void invalidateInventory();
    await Promise.all([
      matchCache.updateCache(
        (current) => getKessenMatchCache(current, confirmed),
        snapshot.match,
      ),
      hubCache.updateHub(
        (current) =>
          ended
            ? getKessenHubAfterEnd(current, confirmed, granted)
            : getKessenHubAfterTurn(current, confirmed),
        snapshot.hub,
      ),
      data.userDelta || data.userPatch
        ? updateUser(data, { revision: snapshot.user })
        : null,
    ]);
  };

  /**
   * The outcome is unknown after a transport failure (a finishing turn may have paid
   * ryo and cards), so the match, hub, profile and inventory are read again. Callers
   * do not await it: during an outage these reads retry with backoff, and the table must
   * release the action meanwhile.
   */
  const recover = async (id: string) => {
    await Promise.allSettled([
      utils.kessen.getMatch.invalidate({ matchId: id }),
      utils.kessen.getHub.invalidate(),
      updateUser(undefined),
      invalidateInventory(),
    ]);
  };

  const send = async (
    request: (current: KessenMatchPayload) => Promise<TurnResponse>,
  ): Promise<KessenActionOutcome> => {
    const current = query.data?.match;
    if (!current) return { ok: false, message: "The match is still loading." };
    const snapshot = prepare();
    const sent = await settle(() => request(current));
    if (!sent.ok) {
      void recover(current.id);
      return { ok: false, message: errorText(sent.error) };
    }
    const data = sent.value;
    await reconcile(snapshot, data);
    return {
      ok: data.success,
      payload: "match" in data ? data.match : undefined,
      events: "events" in data ? data.events : undefined,
      message: data.message,
    };
  };

  const play = (action: KessenActionInput) =>
    send((current) =>
      playTurn.mutateAsync({ matchId: current.id, version: current.version, action }),
    );

  const concede = () =>
    send((current) =>
      concedeMatch.mutateAsync({ matchId: current.id, version: current.version }),
    );

  /** Picks the card of a first-win choice (`result.firstWin.choice`). */
  const claimChoice = async (itemId: string): Promise<KessenActionOutcome> => {
    const current = query.data?.match;
    if (!current) return { ok: false, message: "The match is still loading." };
    const snapshot = prepare();
    const sent = await settle(() =>
      claimFirstWinChoice.mutateAsync({ matchId: current.id, itemId }),
    );
    if (!sent.ok) {
      void recover(current.id);
      return { ok: false, message: errorText(sent.error) };
    }
    const data = sent.value;
    if (!data.success || !("match" in data))
      return { ok: false, message: data.message };
    void invalidateInventory();
    if (kessenGrantsPacks(data.granted)) void utils.kessen.getHub.invalidate();
    await Promise.all([
      matchCache.updateCache(
        (cached) => getKessenMatchCache(cached, data.match),
        snapshot.match,
      ),
      hubCache.updateHub(
        (hub) => getKessenHubAfterClaim(hub, current.id, data.granted),
        snapshot.hub,
      ),
    ]);
    return { ok: true, payload: data.match, message: data.message };
  };

  return {
    ...query,
    match: query.data?.match ?? null,
    play,
    concede,
    claimChoice,
    isActing:
      playTurn.isPending || concedeMatch.isPending || claimFirstWinChoice.isPending,
  };
};
