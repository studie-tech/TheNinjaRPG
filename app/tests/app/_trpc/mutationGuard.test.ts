import { describe, expect, it } from "vitest";
import {
  createMutationGuard,
  PUBLIC_MUTATIONS,
  SIGN_IN_REQUIRED_MUTATION_MESSAGE,
} from "@/app/_trpc/client";

describe("createMutationGuard", () => {
  it("throws the sign-in message when signed out", () => {
    const guard = createMutationGuard(() => false);
    expect(() => guard("profile.updateUser")).toThrowError(
      SIGN_IN_REQUIRED_MUTATION_MESSAGE,
    );
  });

  it("throws while Clerk has not loaded yet (undefined)", () => {
    const guard = createMutationGuard(() => undefined);
    expect(() => guard("profile.updateUser")).toThrowError(
      SIGN_IN_REQUIRED_MUTATION_MESSAGE,
    );
  });

  it("allows mutations when signed in", () => {
    const guard = createMutationGuard(() => true);
    expect(() => guard("profile.updateUser")).not.toThrow();
    expect(() => guard(undefined)).not.toThrow();
  });

  it("allows public mutations regardless of auth state", () => {
    const guard = createMutationGuard(() => false);
    for (const path of PUBLIC_MUTATIONS) {
      expect(() => guard(path)).not.toThrow();
    }
  });

  it("reads the signed-in state at call time, not at creation time", () => {
    // Regression: the guard instance is captured ONCE by the QueryClient's
    // MutationCache, which is created before clerk-js loads (isSignedIn is
    // undefined on the first render). The same instance must observe Clerk
    // finishing its load — a value frozen at creation blocked every mutation
    // with a false "sign in" error for the tab's whole lifetime.
    let isSignedIn: boolean | undefined = undefined;
    const guard = createMutationGuard(() => isSignedIn);
    expect(() => guard("home.toggleSleep")).toThrowError(
      SIGN_IN_REQUIRED_MUTATION_MESSAGE,
    );
    isSignedIn = true;
    expect(() => guard("home.toggleSleep")).not.toThrow();
    isSignedIn = false;
    expect(() => guard("home.toggleSleep")).toThrowError(
      SIGN_IN_REQUIRED_MUTATION_MESSAGE,
    );
  });
});
