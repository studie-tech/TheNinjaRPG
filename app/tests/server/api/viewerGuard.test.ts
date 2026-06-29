import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { VIEWER_SESSION_MISMATCH_MESSAGE } from "@/app/_trpc/authHeaders";
import { assertViewerMatchesSession } from "@/server/api/viewerGuard";

describe("assertViewerMatchesSession", () => {
  it("does not throw when the client-asserted viewer matches the session user", () => {
    expect(() => assertViewerMatchesSession("user_A", "user_A")).not.toThrow();
  });

  it("does not throw when no viewer is asserted (backward-compatible callers)", () => {
    expect(() => assertViewerMatchesSession("user_A", undefined)).not.toThrow();
  });

  it("throws FORBIDDEN for an empty asserted viewer id (not treated as unasserted)", () => {
    // "" is never a valid Clerk id; the guard must not silently bypass on it.
    expect(() => assertViewerMatchesSession("user_A", "")).toThrow(TRPCError);
  });

  it("throws FORBIDDEN when the asserted viewer does not match the session user", () => {
    expect(() => assertViewerMatchesSession("user_A", "user_B")).toThrow(TRPCError);
    try {
      assertViewerMatchesSession("user_A", "user_B");
      throw new Error("expected assertViewerMatchesSession to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      // The message is the shared contract the client filters on; pin it so a
      // server-side reword can't silently break the client's suppression.
      expect((error as TRPCError).message).toBe(VIEWER_SESSION_MISMATCH_MESSAGE);
    }
  });
});
