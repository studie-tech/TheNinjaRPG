import { Scissors } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { REMOVAL_COST } from "@/drizzle/constants";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Equipped sage mode card plus paid removal. Hidden modes still load via
 * `sageMode.get`. Set `embedded` when the parent already provides a titled box
 * (profile edit accordion) so this does not wrap a second `ContentBox`.
 */
interface CurrentSageModeProps {
  sageModeId: string;
  initialBreak?: boolean;
  /** Render without ContentBox chrome (e.g. inside a titled accordion). */
  embedded?: boolean;
}

/** Equipped-mode viewer and reputation-paid removal control. */
export const CurrentSageMode: React.FC<CurrentSageModeProps> = (props) => {
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const { data, isFetching } = api.sageMode.get.useQuery({ id: props.sageModeId }, {});

  const { mutate: remove, isPending: isRemoving } =
    api.sageMode.removeSageMode.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const canAfford = (userData?.reputationPoints ?? 0) >= REMOVAL_COST;
  const canRemove = userData?.status === "AWAKE";
  const canProceed = canAfford && canRemove;
  const repsNeeded = Math.max(0, REMOVAL_COST - (userData?.reputationPoints ?? 0));

  const body = (
    <>
      {(isFetching || isRemoving) && <Loader explanation="Loading sage mode" />}
      {!isFetching && data && userData && (
        <>
          <ItemWithEffects item={data} key={data.id} />
          <Confirm2
            title="Sage Mode Removal"
            proceed_label={
              canAfford
                ? `Remove for ${REMOVAL_COST} reps`
                : `Need ${repsNeeded} more reps`
            }
            isValid={!isFetching && canProceed}
            disabled={!canProceed}
            button={
              <Button id="check" className="w-full" disabled={!canProceed}>
                <Scissors className="mr-2 h-6 w-6" />
                Remove Sage Mode
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              if (canProceed) remove();
            }}
          >
            <p>
              {!canRemove ? (
                <>You cannot remove sage mode while {userData.status.toLowerCase()}.</>
              ) : canAfford ? (
                <>
                  Abandon your current sage mode. This costs{" "}
                  <b>{REMOVAL_COST} reputation points</b>.
                </>
              ) : (
                <>
                  You need <b>{repsNeeded} more reputation points</b> to abandon your
                  sage mode ({REMOVAL_COST} required).
                </>
              )}
            </p>
          </Confirm2>
        </>
      )}
    </>
  );

  if (props.embedded) {
    return body;
  }

  return (
    <ContentBox
      title="Sage Mode"
      subtitle="Your awakened sage mode"
      initialBreak={props.initialBreak}
    >
      {body}
    </ContentBox>
  );
};
