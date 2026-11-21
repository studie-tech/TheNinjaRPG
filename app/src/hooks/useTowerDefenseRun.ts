import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { nanoid } from "nanoid";
import { useCallback, useMemo } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getDojoPurchaseUpdate, getRunClaimUpdate } from "@/deltas/towerDefense";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import {
  RETRY_SAVED_MESSAGE,
  RETRY_UNSAVED_MESSAGE,
  type TowerDefenseBackend,
  type TowerDefenseClaimResult,
  useTowerDefenseSession,
} from "@/hooks/useTowerDefenseSession";
import { showMutationToast } from "@/libs/toast";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import { TD_SIM_VERSION } from "@/libs/towerDefense/sim";
import { isRetryableTrpcError } from "@/utils/error";
import { useUserInfo } from "@/utils/UserContext";

export type {
  TowerDefenseOutcome,
  TowerDefensePause,
} from "@/hooks/useTowerDefenseSession";

const GUEST_STORAGE_KEY = "towerDefenseRun:guest";

/**
 * A tower-defense run on the game server: signed-in players start signed runs and claim
 * them for scrolls, ryo and the daily Guard Hall duty, and buy Guard Hall upgrades. Guests
 * play the same game locally without a token, so nothing is claimed or saved.
 */
export const useTowerDefenseRun = (userId: string | undefined) => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser, refreshUser } = useUserInfo();
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<
    RouterOutputs["towerDefense"]["getProgress"]
  >(getQueryKey(api.towerDefense.getProgress, undefined, "query"));
  const { mutateAsync: startSignedRun, isPending: isStarting } =
    api.towerDefense.startRun.useMutation();
  // A claim uploads a long log and replays it, so it travels alone instead of holding up
  // the requests batched beside it.
  const { mutateAsync: claimSignedRun } = api.towerDefense.claimRun.useMutation({
    meta: { handlesTransportError: true },
    trpc: { context: { skipBatch: true } },
  });
  const { mutateAsync: purchase, isPending: isPurchasing } =
    api.towerDefense.purchaseDojoUpgrade.useMutation();

  const startRun = useCallback<TowerDefenseBackend["startRun"]>(
    async (startWave, challenge) => {
      if (!userId)
        return {
          config: { seed: nanoid(), startWave: 1, bestWave: 0, level: 1, dojo: {} },
          token: null,
        };
      // The server makes every started run the player's only claimable one. Two tabs
      // starting at the same moment can therefore retire the run the other one keeps; the
      // cost stays on this account and is one run's scrolls, so the start stays unguarded.
      const result = await startSignedRun({ startWave, challenge });
      if (!result.success || !result.token || !result.config) {
        showMutationToast(result);
        return null;
      }
      return { config: result.config, token: result.token };
    },
    [startSignedRun, userId],
  );

  const claimRun = useCallback<TowerDefenseBackend["claimRun"]>(
    async ({ token, actions, endTick, state, unsaved }) => {
      const snapshot = prepareUpdate();
      const userRevision = prepareUserUpdate();
      const response = await claimSignedRun({
        token,
        actions,
        endTick,
        simVersion: TD_SIM_VERSION,
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      if ("error" in response) {
        const { error } = response;
        const code =
          error instanceof TRPCClientError
            ? (error.data as { code?: string } | undefined)?.code
            : undefined;
        // The server refused to read the log itself; resubmitting it cannot change that.
        const rejected = code === "BAD_REQUEST";
        return {
          settled: rejected,
          claimed: false,
          retryable: !rejected,
          reloadRequired: false,
          message: rejected
            ? "This run's record could not be read, so it cannot be claimed."
            : error instanceof TRPCClientError && !isRetryableTrpcError(error)
              ? error.message
              : unsaved
                ? RETRY_UNSAVED_MESSAGE
                : RETRY_SAVED_MESSAGE,
        } satisfies TowerDefenseClaimResult;
      }
      const { result } = response;
      if (result.success) {
        // A quest challenge pays no scrolls and leaves the best wave alone.
        if (!state.config.challenge)
          void updateCache(
            getRunClaimUpdate({
              pointsEarned: result.pointsEarned ?? 0,
              wave: result.wave ?? state.wave,
            }),
            snapshot,
          );
        // The daily Guard Hall duty and its reward, or a completed challenge objective.
        void updateUser(result, { revision: userRevision });
      } else if (result.alreadyClaimed) {
        // An earlier attempt paid out, but its response never arrived.
        void utils.towerDefense.getProgress.invalidate();
        void refreshUser();
      }
      return {
        // A refusal for good can only repeat; a paid or already paid run is done.
        settled: result.success || !!result.alreadyClaimed || !!result.permanent,
        claimed: result.success || !!result.alreadyClaimed,
        retryable: !result.permanent && !result.reloadRequired,
        reloadRequired: !!result.reloadRequired,
        points: result.pointsEarned,
        message: result.message,
      } satisfies TowerDefenseClaimResult;
    },
    [
      claimSignedRun,
      prepareUpdate,
      prepareUserUpdate,
      refreshUser,
      updateCache,
      updateUser,
      utils,
    ],
  );

  const backend = useMemo<TowerDefenseBackend>(
    () => ({
      storageKey: userId ? `towerDefenseRun:${userId}` : GUEST_STORAGE_KEY,
      isStarting,
      startRun,
      claimRun,
    }),
    [claimRun, isStarting, startRun, userId],
  );
  const session = useTowerDefenseSession(backend);

  const buyDojo = useCallback(
    async (upgradeId: TdDojoUpgrade) => {
      const snapshot = prepareUpdate();
      const result = await purchase({ upgradeId });
      if (
        result.success &&
        result.level !== undefined &&
        result.pointsSpent !== undefined
      )
        void updateCache(
          getDojoPurchaseUpdate(upgradeId, {
            level: result.level,
            pointsSpent: result.pointsSpent,
          }),
          snapshot,
        );
      else showMutationToast(result);
    },
    [prepareUpdate, purchase, updateCache],
  );

  return { ...session, isPurchasing, buyDojo };
};
