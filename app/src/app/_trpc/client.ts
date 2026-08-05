/**
 * This is the client-side entrypoint for your tRPC API.
 */

import { useUser } from "@clerk/nextjs";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
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
 * Every publicProcedure mutation belongs here, otherwise the guard below throws before
 * the request is ever sent and the signed-out flow silently breaks.
 */
export const PUBLIC_MUTATIONS: string[] = [
  "towerDefense.initiateGuestSession",
  // Landing-page analytics: writes VisitorLog and the A/B "loaded" events. Only ever
  // runs for signed-out visitors, so blocking it here disabled recruitment tracking.
  "misc.trackVisitor",
  // Email preference links are followed straight from an email, usually signed out.
  "misc.toggleEmailReminder",
  "misc.deleteEmailReminder",
];

export const useGlobalOnMutateProtect = () => {
  const { isSignedIn } = useUser();
  return (mutationPath?: string) => {
    // Skip check for public mutations
    if (mutationPath && PUBLIC_MUTATIONS.includes(mutationPath)) {
      return;
    }
    if (!isSignedIn) {
      throw new Error(SIGN_IN_REQUIRED_MUTATION_MESSAGE);
    }
  };
};
