import { describe, expect, it } from "vitest";
import {
  buildClerkAuthFailureHeaders,
  buildClerkAuthHeaders,
  TAB_AUTH_REQUIRED_HEADER,
} from "@/app/_trpc/authHeaders";

describe("buildClerkAuthHeaders", () => {
  it("returns a Bearer Authorization header when a token is present", () => {
    expect(buildClerkAuthHeaders("jwt-123")).toEqual({
      Authorization: "Bearer jwt-123",
    });
  });

  it("omits the Authorization header when there is no token (never sends 'Bearer null')", () => {
    expect(buildClerkAuthHeaders(null)).toEqual({});
    expect(buildClerkAuthHeaders(undefined)).toEqual({});
    expect(buildClerkAuthHeaders("")).toEqual({});
  });
});

describe("buildClerkAuthFailureHeaders", () => {
  it("signals fail-closed only when the browser has multiple Clerk sessions", () => {
    expect(buildClerkAuthFailureHeaders(true)).toEqual({
      [TAB_AUTH_REQUIRED_HEADER]: "1",
    });
  });

  it("sends no marker for a single-session browser (cookie fallback is the user's own account)", () => {
    expect(buildClerkAuthFailureHeaders(false)).toEqual({});
  });
});
