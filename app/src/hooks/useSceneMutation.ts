import { type MutationOptions, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

/**
 * Execute scene actions through the shared mutation cache without a React status observer.
 * useMutation subscribes to every status transition; scenes keep motion state in refs instead.
 * Cache defaults and global auth/session guards still run before optimistic callbacks.
 */
export const useSceneMutation = <TData, TVariables, TContext = unknown>(
  options: MutationOptions<TData, Error, TVariables, TContext>,
) => {
  const client = useQueryClient();
  const latest = useRef(options);
  latest.current = options;
  return useCallback(
    (variables: TVariables) =>
      client.getMutationCache().build(client, latest.current).execute(variables),
    [client],
  );
};
