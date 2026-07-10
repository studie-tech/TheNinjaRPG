import { describe, expect, it } from "vitest";
import {
  buildClerkRequestHeaders,
  computeIsMultiSession,
  isTransientMultiSessionAuthError,
  TAB_AUTH_REQUIRED_HEADER,
  VIEWER_SESSION_MISMATCH_MESSAGE,
} from "@/app/_trpc/authHeaders";

describe("buildClerkRequestHeaders", () => {
  it("sends a Bearer Authorization header when the tab has its own token", () => {
    expect(buildClerkRequestHeaders("jwt-123", false)).toEqual({
      Authorization: "Bearer jwt-123",
    });
    // token wins regardless of session count
    expect(buildClerkRequestHeaders("jwt-123", true)).toEqual({
      Authorization: "Bearer jwt-123",
    });
  });

  it("never sends an Authorization header when the token is absent (no 'Bearer null')", () => {
    expect(buildClerkRequestHeaders(null, false)).not.toHaveProperty("Authorization");
    expect(buildClerkRequestHeaders(undefined, false)).not.toHaveProperty("Authorization");
    expect(buildClerkRequestHeaders("", false)).not.toHaveProperty("Authorization");
  });

  it("fails closed with a marker when there is no token AND the browser has multiple sessions", () => {
    // covers both getToken() -> null and getToken() throwing (caller passes null)
    expect(buildClerkRequestHeaders(null, true)).toEqual({
      [TAB_AUTH_REQUIRED_HEADER]: "1",
    });
    expect(buildClerkRequestHeaders(undefined, true)).toEqual({
      [TAB_AUTH_REQUIRED_HEADER]: "1",
    });
  });

  it("sends no marker for a single-session browser with no token (cookie is the user's own account)", () => {
    expect(buildClerkRequestHeaders(null, false)).toEqual({});
  });
});

describe("isTransientMultiSessionAuthError", () => {
  it("matches the server's fail-closed UNAUTHORIZED regardless of message", () => {
    expect(
      isTransientMultiSessionAuthError(
        "UNAUTHORIZED",
        "Unauthorized for tRPC endpoint. Path: profile.getUser",
      ),
    ).toBe(true);
  });

  it("matches the FORBIDDEN viewer/session mismatch guard", () => {
    expect(
      isTransientMultiSessionAuthError("FORBIDDEN", VIEWER_SESSION_MISMATCH_MESSAGE),
    ).toBe(true);
  });

  it("does not match other FORBIDDEN errors or other codes", () => {
    expect(isTransientMultiSessionAuthError("FORBIDDEN", "No access to feature")).toBe(
      false,
    );
    expect(isTransientMultiSessionAuthError("INTERNAL_SERVER_ERROR", "boom")).toBe(
      false,
    );
    expect(
      isTransientMultiSessionAuthError(undefined, VIEWER_SESSION_MISMATCH_MESSAGE),
    ).toBe(false);
  });
});

describe("computeIsMultiSession", () => {
  it("treats an unknown session count (Clerk still loading) as multi-session, so the no-token path fails closed", () => {
    expect(computeIsMultiSession(undefined)).toBe(true);
  });

  it("treats zero or one signed-in session as single-session (normal cookie path)", () => {
    expect(computeIsMultiSession(0)).toBe(false);
    expect(computeIsMultiSession(1)).toBe(false);
  });

  it("treats more than one signed-in session as multi-session", () => {
    expect(computeIsMultiSession(2)).toBe(true);
    expect(computeIsMultiSession(3)).toBe(true);
  });
});
