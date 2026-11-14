import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { useCombatEntry } from "@/hooks/combatEntry";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserInfo } from "@/utils/UserContext";

/**
 * Start an arena battle and move the player into it. A success navigates away, so only a
 * failure frees the claim. `start` reports whether this call was the one that went through.
 */
export const useStartArenaBattle = (
  onStarted: (result: RouterOutputs["combat"]["startArenaBattle"]) => void,
) => {
  const { pusher, prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const router = useRouter();
  const flight = useSingleFlight();
  const { prepareCombatEntry, loadBattle } = useCombatEntry();

  const { mutate, isPending: isAttacking } = api.combat.startArenaBattle.useMutation({
    onMutate: () => {
      prepareCombatEntry();
      return prepareUserUpdate();
    },
    onSuccess: async (result, _variables, revision) => {
      if (result.success && result.battleId) {
        loadBattle(result.battleId);
        await updateUser(result, { revision, refetch: false });
        pushToCombat(router, result.battleId);
        onStarted(result);
      } else {
        if (result.userRecovery) await updateUser(result, { revision, refetch: false });
        flight.release();
        showMutationToast(result);
      }
    },
    onError: (error) => {
      flight.release();
      showMutationToast({ success: false, message: error.message });
    },
  });

  const start = (input: RouterInputs["combat"]["startArenaBattle"]) => {
    if (isAttacking || !flight.claim()) return false;
    mutate({ ...input, originSocketId: pusher?.connection.socket_id });
    return true;
  };

  return { start, isAttacking };
};
