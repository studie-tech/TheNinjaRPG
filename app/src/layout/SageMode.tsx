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
 * Show the user's current sage mode and let them remove it.
 */
interface CurrentSageModeProps {
  sageModeId: string;
  initialBreak?: boolean;
}

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

  const canRemove = userData?.status === "AWAKE";

  return (
    <ContentBox
      title="Sage Mode"
      subtitle="Your awakened sage mode"
      initialBreak={props.initialBreak}
    >
      {(isFetching || isRemoving) && <Loader explanation="Loading sage mode" />}
      {!isFetching && data && userData && (
        <>
          <ItemWithEffects item={data} key={data.id} />
          <Confirm2
            title="Sage Mode Removal"
            proceed_label="Remove Sage Mode"
            isValid={!isFetching && canRemove}
            disabled={!canRemove}
            button={
              <Button id="check" className="w-full" disabled={!canRemove}>
                <Scissors className="mr-2 h-6 w-6" />
                Remove Sage Mode
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              remove();
            }}
          >
            <p>
              {canRemove ? (
                <>
                  Abandon your current sage mode. This costs{" "}
                  <b>{REMOVAL_COST} reputation points</b>.
                </>
              ) : (
                <>You cannot remove sage mode while {userData.status.toLowerCase()}.</>
              )}
            </p>
          </Confirm2>
        </>
      )}
    </ContentBox>
  );
};
