import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";

/** Ally-offer handlers for `UserRequestSystem`, sharing one pending flag. */
export const useAllyOfferActions = () => {
  const utils = api.useUtils();
  const onOfferClosed = async (data: { success: boolean; message: string }) => {
    showMutationToast(data);
    if (data.success) {
      await utils.war.getAllyOffers.invalidate();
    }
  };
  const accept = api.war.acceptAllyOffer.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.war.getActiveWars.invalidate(),
          utils.war.getRaidOptions.invalidate(),
          utils.war.getEndedWars.invalidate(),
          utils.war.getAllyOffers.invalidate(),
        ]);
      }
    },
  });
  const reject = api.war.rejectAllyOffer.useMutation({ onSuccess: onOfferClosed });
  const cancel = api.war.cancelAllyOffer.useMutation({ onSuccess: onOfferClosed });
  return {
    isPending: accept.isPending || reject.isPending || cancel.isPending,
    onAccept: ({ id }: { id: string }) => accept.mutate({ offerId: id }),
    onReject: ({ id }: { id: string }) => reject.mutate({ id }),
    onCancel: ({ id }: { id: string }) => cancel.mutate({ offerId: id }),
  };
};

/** Administrative war removal; its confirmation dialog stays open if the server refuses. */
export const useAdminEndWar = (warId: string) => {
  const utils = api.useUtils();
  const [showDialog, setShowDialog] = useState(false);
  const { mutate, isPending } = api.war.adminEndWar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (!data.success) return;
      setShowDialog(false);
      await Promise.all([
        utils.war.getActiveWars.invalidate(),
        utils.war.getRaidOptions.invalidate(),
        utils.war.getEndedWars.invalidate(),
        utils.war.getAllyOffers.invalidate(),
      ]);
    },
  });
  return { isPending, showDialog, setShowDialog, endWar: () => mutate({ warId }) };
};
