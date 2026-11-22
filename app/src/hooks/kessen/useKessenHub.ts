"use client";

import { api, type RouterInputs } from "@/app/_trpc/client";
import { getKessenHubAfterStart } from "@/deltas/kessen";
import { useKessenHubCache } from "@/hooks/kessen/useKessenHubCache";
import type { KessenMatchPayload } from "@/validators/kessen";

/** What `kessen.startMatch` takes. */
export type KessenStartInput = RouterInputs["kessen"]["startMatch"];

/** The deck a match is played with: saved, today's loaner, or a saved deck filled up. */
export type KessenDeckSource = KessenStartInput["deck"];

/**
 * The Card Hall's data: the player's hub (`kessen.getHub`) and the CDN-cached public
 * catalog (`kessen.getCatalog`, never refetched after actions).
 */
export const useKessenHub = (enabled = true) => {
  const hub = api.kessen.getHub.useQuery(undefined, { enabled, staleTime: 60_000 });
  const catalog = useKessenCatalog(enabled);
  return { hub, catalog };
};

/** The public card catalog alone, for screens without the hub. */
export const useKessenCatalog = (enabled = true) =>
  api.kessen.getCatalog.useQuery(undefined, {
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

/** What `kessen.startLesson` takes. */
export type KessenLessonInput = RouterInputs["kessen"]["startLesson"];

/**
 * What starting a match resolves with; `activeMatchId` names the match to resume and
 * `activeDuelId` the duel that blocks the start.
 */
export type KessenStartOutcome = {
  ok: boolean;
  match?: KessenMatchPayload;
  activeMatchId?: string;
  activeDuelId?: string;
  message: string;
};

/**
 * Starts a Circuit match (`start`) or an Academy lesson at Lemu's table (`startLesson`).
 * The confirmed match seeds its `kessen.getMatch` query and becomes the hub's active
 * match; a rejection (locked NPC or lesson, invalid deck, another active match or duel)
 * resolves with the server's message for display next to the start button.
 */
export const useStartKessenMatch = () => {
  const utils = api.useUtils();
  const hubCache = useKessenHubCache();
  const mutation = api.kessen.startMatch.useMutation();
  const lessonMutation = api.kessen.startLesson.useMutation();

  const open = async (
    request: () => ReturnType<typeof mutation.mutateAsync>,
  ): Promise<KessenStartOutcome> => {
    const snapshot = hubCache.prepareHubUpdate();
    let failure: unknown = null;
    const data = await request().catch((error: unknown) => {
      failure = error;
      return null;
    });
    if (!data) {
      // A match may have started before the failure; the hub names it if so. The read
      // is not awaited: during an outage it retries with backoff, and the message
      // belongs next to the start button now.
      void utils.kessen.getHub.invalidate();
      return {
        ok: false,
        message:
          failure instanceof Error && failure.message
            ? failure.message
            : "The server could not confirm the match start.",
      };
    }
    if (!data.success || !("match" in data) || !data.match) {
      return {
        ok: false,
        message: data.message,
        activeMatchId: "activeMatchId" in data ? data.activeMatchId : undefined,
        activeDuelId: "activeDuelId" in data ? data.activeDuelId : undefined,
      };
    }
    const match = data.match;
    utils.kessen.getMatch.setData({ matchId: match.id }, { match });
    await hubCache.updateHub(
      (current) => getKessenHubAfterStart(current, match),
      snapshot,
    );
    return { ok: true, match, message: data.message };
  };

  const start = (input: KessenStartInput) => open(() => mutation.mutateAsync(input));
  const startLesson = (input: KessenLessonInput) =>
    open(() => lessonMutation.mutateAsync(input));

  return {
    start,
    startLesson,
    isStarting: mutation.isPending || lessonMutation.isPending,
  };
};
