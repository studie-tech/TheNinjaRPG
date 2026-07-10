/**
 * This is the client-side entrypoint for your tRPC API.
 */

import { useUser } from "@clerk/nextjs";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";
import type { AppRouter } from "@/api/root";
import { toast } from "@/components/ui/use-toast";

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCReact<AppRouter>({
  // Abort on onmount, see: https://trpc.io/docs/client/react/aborting-procedure-calls
  abortOnUnmount: false,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const SIGN_IN_REQUIRED_MUTATION_MESSAGE =
  "You need to be signed in to perform this action.";

export const onError = (err: unknown) => {
  if (err instanceof TRPCClientError) {
    toast({
      variant: "destructive",
      title: err?.data?.code ?? "Unknown",
      description: err.message,
    });
  } else if (err instanceof Error) {
    toast({
      variant: "destructive",
      title: "Error",
      description: err.message,
    });
  }
};

/**
 * List of tRPC mutation paths that are allowed for unauthenticated users.
 * These mutations have publicProcedure on the server and should not be blocked client-side.
 */
export const PUBLIC_MUTATIONS: string[] = ["towerDefense.initiateGuestSession"];

/**
 * Builds the mutation guard from a GETTER so the signed-in state is read at
 * mutation time, never captured. The guard is stored once inside the
 * QueryClient's MutationCache (created in a one-shot useState in
 * TrpcClientProvider), so a closed-over boolean would freeze whatever value the
 * first render had — and the first render happens before clerk-js loads, when
 * `isSignedIn` is still undefined. That frozen value would block every mutation
 * with a false "sign in" error for the tab's whole lifetime.
 */
export const createMutationGuard = (
  getIsSignedIn: () => boolean | undefined,
): ((mutationPath?: string) => void) => {
  return (mutationPath?: string) => {
    // Skip check for public mutations
    if (mutationPath && PUBLIC_MUTATIONS.includes(mutationPath)) {
      return;
    }
    if (!getIsSignedIn()) {
      throw new Error(SIGN_IN_REQUIRED_MUTATION_MESSAGE);
    }
  };
};

export const useGlobalOnMutateProtect = () => {
  const { isSignedIn } = useUser();
  // Ref keeps the guard reading the LIVE Clerk state (see createMutationGuard).
  const isSignedInRef = useRef(isSignedIn);
  isSignedInRef.current = isSignedIn;
  const [guard] = useState(() => createMutationGuard(() => isSignedInRef.current));
  return guard;
};
