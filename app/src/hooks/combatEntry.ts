import { useCallback } from "react";
import { api } from "@/app/_trpc/client";
import { fetchLpcSceneCatalog } from "@/hooks/lpc";
import { useNavigationRouter } from "@/hooks/navigation";

/** The battlefield scene, shared by the pages that render it and the battle starts that warm it. */
export const loadCombat = () => import("@/layout/Combat");

/**
 * Overlaps battle entry with the request that starts the battle.
 *
 * `prepareCombatEntry` belongs in a battle-start mutation's `onMutate`: it downloads the
 * /combat route, the battlefield scene and the character catalog while the server admits the
 * player, so the page renders as soon as the battle exists. Nothing it loads has side effects;
 * a refused start only costs the download.
 *
 * `loadBattle` belongs at the start of the success handler, before the profile update that
 * enables the page's own battle query. It requests the battle under the page's query key, so
 * the page finds it loading or loaded when it mounts, instead of asking only after it renders.
 */
export const useCombatEntry = () => {
  const router = useNavigationRouter();
  const utils = api.useUtils();
  const prepareCombatEntry = useCallback(() => {
    // After the next paint, so the start request and the button's pending state go first.
    requestAnimationFrame(() =>
      setTimeout(() => {
        router.prefetch("/combat");
        void loadCombat().catch(() => undefined);
        void fetchLpcSceneCatalog(utils).catch(() => undefined);
      }),
    );
  }, [router, utils]);
  const loadBattle = useCallback(
    (battleId: string) => void utils.combat.getBattle.prefetch({ battleId }),
    [utils],
  );
  return { prepareCombatEntry, loadBattle };
};
