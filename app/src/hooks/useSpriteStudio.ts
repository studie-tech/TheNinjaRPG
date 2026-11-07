import { useCallback, useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { isSpriteGenerationActive } from "@/libs/spriteStudio";
import { showMutationToast } from "@/libs/toast";

/** gameasset.dev jobs take minutes; each sync polls it once per running request. */
const SYNC_INTERVAL_MS = 10_000;

/** The shared queue and every action on it, kept current while remote work is running. */
export const useSpriteStudio = () => {
  const utils = api.useUtils();
  const account = api.spriteStudio.getAccount.useQuery();
  const generations = api.spriteStudio.getGenerations.useQuery(undefined, {
    enabled: !!account.data?.enabled,
  });
  const refresh = useCallback(
    () =>
      Promise.all([
        utils.spriteStudio.getAccount.invalidate(),
        utils.spriteStudio.getGenerations.invalidate(),
      ]),
    [utils],
  );
  const notify = async (result: { success: boolean; message: string }) => {
    showMutationToast(result);
    if (result.success) await refresh();
  };
  const { mutate: sync } = api.spriteStudio.sync.useMutation({
    // Another editor's sync may have finished a row, so this reloads either way.
    onSuccess: () => utils.spriteStudio.getGenerations.invalidate(),
  });
  const generate = api.spriteStudio.generate.useMutation({ onSuccess: notify });
  const regenerate = api.spriteStudio.regenerate.useMutation({ onSuccess: notify });
  const accept = api.spriteStudio.accept.useMutation({ onSuccess: notify });
  const discard = api.spriteStudio.discard.useMutation({ onSuccess: notify });
  const running = !!generations.data?.some((row) =>
    isSpriteGenerationActive(row.status),
  );
  useEffect(() => {
    if (!running) return;
    sync();
    const timer = window.setInterval(() => sync(), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, sync]);
  return { account, generations, generate, regenerate, accept, discard };
};
