"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "@/app/_trpc/client";
import {
  applyUserDelta,
  prepareUserDelta,
  type UserDeltaPatch,
} from "@/utils/userDelta";
import type { UserDelta } from "@/validators/userCache";

export const useUserDelta = () => {
  const client = useQueryClient();
  const key = getQueryKey(api.profile.getUser, undefined, "query");
  return {
    onMutate: () => prepareUserDelta(client, key),
    updateUserDelta: (
      delta: UserDelta | undefined,
      revision: number | undefined,
      patch?: UserDeltaPatch,
    ) => applyUserDelta(client, key, delta, revision, patch),
  };
};
