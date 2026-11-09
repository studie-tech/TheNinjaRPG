import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { usePetMutationFeedback } from "@/hooks/usePetMutationFeedback";
import { useRequiredUserData } from "@/utils/UserContext";

/** Reconcile revealed potential and two-companion transfers through shared mutation feedback. */
export const usePetPotential = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [message, setMessage] = useState<string | null>(null);
  const { finishMutation, failMutation } = usePetMutationFeedback({
    setMessage,
    updateUser,
  });
  // Reveals return a hidden roll; transfers affect both pets and progression-dependent views.
  const options = {
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  };
  const reveal = api.pets.revealPotential.useMutation(options);
  const transfer = api.pets.transferExperience.useMutation(options);
  return {
    reveal,
    transfer,
    message,
    isPending: reveal.isPending || transfer.isPending,
  };
};
