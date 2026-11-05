import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Start an arena battle and move the player into it. A success navigates away, so only a
 * failure frees the claim. `start` reports whether this call was the one that went through.
 */
export const useStartArenaBattle = (
  onStarted: (result: RouterOutputs["combat"]["startArenaBattle"]) => void,
) => {
  const { updateUser } = useRequiredUserData();
  const router = useRouter();
  const flight = useSingleFlight();

  const { mutate, isPending: isAttacking } = api.combat.startArenaBattle.useMutation({
    onSuccess: (result) => {
      if (result.success && result.battleId) {
        void updateUser({
          status: "BATTLE",
          battleId: result.battleId,
          updatedAt: new Date(),
        });
        pushToCombat(router, result.battleId);
        onStarted(result);
      } else {
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
    mutate(input);
    return true;
  };

  return { start, isAttacking };
};
