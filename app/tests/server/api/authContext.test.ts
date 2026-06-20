import { describe, expect, it } from "vitest";
import { resolveAuthedUserId } from "@/server/api/authContext";

describe("resolveAuthedUserId", () => {
  it("returns the session user for a normal request (no fail-closed marker)", () => {
    expect(
      resolveAuthedUserId("user_A", {
        hasAuthorizationHeader: false,
        tabAuthFailed: false,
      }),
    ).toBe("user_A");
  });

  it("returns the session user when an Authorization header is present, even if the marker is set", () => {
    expect(
      resolveAuthedUserId("user_A", {
        hasAuthorizationHeader: true,
        tabAuthFailed: true,
      }),
    ).toBe("user_A");
  });

  it("fails closed (null) when the tab signalled auth failure and no Authorization header arrived", () => {
    // Clerk multi-session: do not let the shared __session cookie authenticate as
    // a possibly-different account when the tab could not produce its own token.
    expect(
      resolveAuthedUserId("user_from_cookie", {
        hasAuthorizationHeader: false,
        tabAuthFailed: true,
      }),
    ).toBeNull();
  });

  it("returns null when there is no session at all", () => {
    expect(
      resolveAuthedUserId(null, {
        hasAuthorizationHeader: false,
        tabAuthFailed: false,
      }),
    ).toBeNull();
  });
});
