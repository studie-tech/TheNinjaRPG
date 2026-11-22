import { api } from "@/app/_trpc/client";

/**
 * Sends a sparring challenge; a confirmed one reads the challenge list again, since the
 * new challenge's id and expiry come from the server.
 */
export const useCreateSparChallenge = () => {
  const utils = api.useUtils();
  return api.sparring.createChallenge.useMutation({
    onSuccess: async (data) => {
      if (data.success) await utils.sparring.getUserChallenges.invalidate();
    },
  });
};
